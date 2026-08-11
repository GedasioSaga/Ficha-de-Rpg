//! Cliente enxuto do Google Drive: só o necessário para o modelo de UM arquivo
//! (`docs/plans/2026-08-11-sync-google-drive.md`, Fase 2). Adaptado de
//! `grimorio/src-tauri/src/drive.rs`, mas sem o motor de reconciliação de
//! árvore inteira — aqui existe uma pasta e, dentro dela, um único arquivo
//! (`sincronizacao_nuvem::NOME_PACOTE`).
//!
//! O access token nunca é logado nem guardado em struct: cada função recebe
//! `&str` só pelo tempo da chamada, igual `auth::access_token` já garante.
//! Erros de rede/API viram [`AppError::Msg`] com mensagem pronta para a UI —
//! nunca `panic`.
//!
//! **Upload é sempre `uploadType=resumable`** (nunca multipart, que recusa
//! acima de 5MB — o `.rpgpack` com imagens passa disso fácil). "Resumable"
//! aqui não retoma upload interrompido no meio (isso fica para quando houver
//! evidência de queda no meio de um upload real); o ganho de hoje é só
//! escapar do teto de 5MB do multipart.

use std::path::Path;

use crate::db::error::AppError;
use crate::db::sincronizacao_nuvem::{self, Manifesto};

const API: &str = "https://www.googleapis.com/drive/v3/files";
const API_UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const MIME_PASTA: &str = "application/vnd.google-apps.folder";
/// O `.rpgpack` é um banco SQLite; para o Drive é só um binário opaco.
const MIME_PACOTE: &str = "application/octet-stream";

/// Máximo que o Drive aceita por página de listagem.
const POR_PAGINA: &str = "1000";

/// Campos pedidos nas consultas: só o que este módulo usa.
const CAMPOS: &str = "id,name,mimeType,size,modifiedTime,trashed";

/// Um arquivo já achado no Drive: o suficiente para o transporte decidir se
/// cria ou substitui, e para preencher diagnóstico na UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArquivoRemoto {
    pub file_id: String,
    pub modified: Option<String>,
    pub size: Option<u64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArquivoDrive {
    id: String,
    size: Option<String>,
    modified_time: Option<String>,
    #[serde(default)]
    trashed: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagina {
    #[serde(default)]
    files: Vec<ArquivoDrive>,
    next_page_token: Option<String>,
}

fn tamanho_de(arquivo: &ArquivoDrive) -> Option<u64> {
    arquivo.size.as_deref()?.parse().ok()
}

fn arquivo_remoto(arquivo: &ArquivoDrive) -> ArquivoRemoto {
    ArquivoRemoto {
        file_id: arquivo.id.clone(),
        modified: arquivo.modified_time.clone(),
        size: tamanho_de(arquivo),
    }
}

/// Escapa um valor para dentro do parâmetro `q` do Drive (delimitado por
/// aspas simples). A barra precisa ser dobrada ANTES da aspa, senão a barra
/// recém-inserida seria escapada de novo.
fn escapar_q(valor: &str) -> String {
    valor.replace('\\', "\\\\").replace('\'', "\\'")
}

fn query_pasta(nome: &str) -> String {
    format!(
        "name = '{}' and mimeType = '{MIME_PASTA}' and trashed = false",
        escapar_q(nome)
    )
}

fn query_arquivo_na_pasta(folder_id: &str, nome: &str) -> String {
    format!(
        "'{}' in parents and name = '{}' and trashed = false",
        escapar_q(folder_id),
        escapar_q(nome)
    )
}

/// Recência por texto: `modifiedTime` do Drive é RFC 3339 em UTC com casas
/// fixas, então comparar como string dá o mesmo resultado que comparar como
/// data. Usado só para desempatar o raro caso de duas pastas/arquivos com o
/// mesmo nome (duas máquinas criando ao mesmo tempo).
fn mais_recente<'a>(a: &'a ArquivoDrive, b: &'a ArquivoDrive) -> &'a ArquivoDrive {
    if a.modified_time.as_deref().unwrap_or("") >= b.modified_time.as_deref().unwrap_or("") {
        a
    } else {
        b
    }
}

/// Traduz a falha da API sem nunca ecoar a requisição — o token viaja no
/// cabeçalho `Authorization`.
fn descrever_falha(status: u16, mensagem: Option<&str>) -> String {
    let base = match status {
        401 => "a sessão com o Google expirou — entre de novo com a sua conta",
        403 => "o Google recusou a operação no Drive (pode ser cota do dia ou permissão)",
        404 => "este arquivo já não existe no Google Drive",
        429 | 500..=599 => {
            "o Google está instável ou pediu para desacelerar — tente de novo em instantes"
        }
        _ => "o Google recusou a operação no Drive",
    };
    match mensagem {
        Some(detalhe) if !detalhe.is_empty() => format!("{base} (HTTP {status}: {detalhe})"),
        _ => format!("{base} (HTTP {status})"),
    }
}

#[derive(serde::Deserialize)]
struct EnvelopeErro {
    error: DetalheErro,
}

#[derive(serde::Deserialize)]
struct DetalheErro {
    message: Option<String>,
}

fn erro_de_rede() -> AppError {
    AppError::Msg(
        "não foi possível falar com o Google Drive — verifique a conexão com a internet"
            .to_string(),
    )
}

/// Cliente sem seguir redirecionamento: um redirect seguido às cegas levaria
/// o cabeçalho `Authorization` para um host que não é a API do Drive.
///
/// Timeout (FIX A da revisão adversarial, 2026-08-11): sem teto, uma rede que
/// TRAVA (firewall/captive portal que derruba pacote sem RST, em vez de
/// recusar a conexão) pendura a chamada pra sempre — em `sync_enviar`/
/// `sync_baixar` isso trava com o `MutexGuard` do `Db` preso, e todo comando
/// futuro fica esperando junto.
pub fn http() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| {
            AppError::Msg("não foi possível iniciar o cliente HTTP para falar com o Drive".to_string())
        })
}

fn autorizar(pedido: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    pedido.bearer_auth(token)
}

async fn falha(resposta: reqwest::Response) -> AppError {
    let status = resposta.status().as_u16();
    let corpo = resposta.text().await.unwrap_or_default();
    let mensagem = serde_json::from_str::<EnvelopeErro>(&corpo).ok().and_then(|e| e.error.message);
    AppError::Msg(descrever_falha(status, mensagem.as_deref()))
}

async fn ler_json<T: serde::de::DeserializeOwned>(
    pedido: reqwest::RequestBuilder,
) -> Result<T, AppError> {
    let resposta = pedido.send().await.map_err(|_| erro_de_rede())?;
    if !resposta.status().is_success() {
        return Err(falha(resposta).await);
    }
    resposta
        .json::<T>()
        .await
        .map_err(|_| AppError::Msg("o Google Drive respondeu em um formato inesperado".to_string()))
}

/// Uma consulta `files.list`, já paginada até o fim. Como o escopo é
/// `drive.file`, cada resultado já nasce restrito ao que este app criou.
async fn consultar(
    http: &reqwest::Client,
    token: &str,
    q: &str,
) -> Result<Vec<ArquivoDrive>, AppError> {
    let campos = format!("nextPageToken,files({CAMPOS})");
    let mut todos = Vec::new();
    let mut proxima: Option<String> = None;

    loop {
        let mut params = vec![
            ("q", q),
            ("fields", campos.as_str()),
            ("pageSize", POR_PAGINA),
            ("spaces", "drive"),
            ("orderBy", "createdTime"),
        ];
        if let Some(token_pagina) = proxima.as_deref() {
            params.push(("pageToken", token_pagina));
        }

        let pagina: Pagina = ler_json(autorizar(http.get(API), token).query(&params)).await?;
        todos.extend(pagina.files.into_iter().filter(|a| !a.trashed));
        proxima = pagina.next_page_token;
        if proxima.is_none() {
            return Ok(todos);
        }
    }
}

async fn criar_pasta(
    http: &reqwest::Client,
    token: &str,
    nome: &str,
) -> Result<String, AppError> {
    let corpo = serde_json::json!({ "name": nome, "mimeType": MIME_PASTA });
    let criada: ArquivoDrive = ler_json(
        autorizar(http.post(API), token)
            .query(&[("fields", "id,name")])
            .json(&corpo),
    )
    .await?;
    Ok(criada.id)
}

/// Id da pasta "Ficha de RPG" no Drive do usuário, criando-a na primeira vez.
/// Idempotente: rodar de novo devolve o mesmo id sem criar nada, desde que a
/// pasta continue existindo com esse nome (a busca é só por `name`, sem
/// marcador — a raiz é única de propósito e o usuário não deveria criar uma
/// segunda "Ficha de RPG" no Drive à mão).
pub async fn garantir_pasta(
    http: &reqwest::Client,
    token: &str,
    nome: &str,
) -> Result<String, AppError> {
    let achadas = consultar(http, token, &query_pasta(nome)).await?;
    // Empate (duas pastas de mesmo nome criadas por dois PCs ao mesmo tempo)
    // resolve pela mais antiga: é o resultado para o qual as duas convergem.
    if let Some(pasta) = achadas.first() {
        return Ok(pasta.id.clone());
    }
    criar_pasta(http, token, nome).await
}

/// Acha `rpg-estado.rpgpack` dentro da pasta, se existir. `None` = primeira
/// sync desta pasta (nada para baixar ainda).
pub async fn achar_arquivo(
    http: &reqwest::Client,
    token: &str,
    folder_id: &str,
    nome: &str,
) -> Result<Option<ArquivoRemoto>, AppError> {
    let achados = consultar(http, token, &query_arquivo_na_pasta(folder_id, nome)).await?;
    // Duas máquinas enviando ao mesmo tempo poderiam (raramente) criar dois
    // arquivos com o mesmo nome; o mais recente é o que importa.
    let vencedor = achados.iter().fold(None::<&ArquivoDrive>, |atual, candidato| {
        Some(match atual {
            Some(atual) => mais_recente(atual, candidato),
            None => candidato,
        })
    });
    Ok(vencedor.map(arquivo_remoto))
}

fn destino_do_redirecionamento(resposta: &reqwest::Response) -> Option<String> {
    if !resposta.status().is_redirection() {
        return None;
    }
    resposta
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// Grava num temporário e renomeia por cima. Escrever direto no destino
/// deixaria, numa queda no meio do download, um arquivo truncado que o
/// próximo passo poderia ler como se fosse o pacote completo.
fn gravar_baixado(destino: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(mae) = destino.parent() {
        std::fs::create_dir_all(mae)?;
    }
    let nome = destino
        .file_name()
        .ok_or_else(|| AppError::Msg("caminho de destino sem nome de arquivo".to_string()))?
        .to_string_lossy()
        .to_string();
    let temporario = destino.with_file_name(format!("{nome}.baixando"));
    std::fs::write(&temporario, bytes)?;

    let mut resultado = std::fs::rename(&temporario, destino);
    for espera_ms in [50, 100] {
        if resultado.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(espera_ms));
        resultado = std::fs::rename(&temporario, destino);
    }
    resultado.map_err(|e| {
        let _ = std::fs::remove_file(&temporario);
        AppError::from(e)
    })
}

/// Baixa o conteúdo do arquivo `file_id` para `destino_local`.
pub async fn baixar(
    http: &reqwest::Client,
    token: &str,
    file_id: &str,
    destino_local: &Path,
) -> Result<(), AppError> {
    let resposta = autorizar(http.get(format!("{API}/{file_id}")), token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|_| erro_de_rede())?;

    let resposta = match destino_do_redirecionamento(&resposta) {
        // Sem `Authorization` de propósito: o destino é um host de conteúdo
        // do Google, com a autorização já embutida na URL assinada.
        Some(url) => http.get(url).send().await.map_err(|_| erro_de_rede())?,
        None => resposta,
    };
    if !resposta.status().is_success() {
        return Err(falha(resposta).await);
    }

    let bytes = resposta
        .bytes()
        .await
        .map_err(|_| AppError::Msg("o download do arquivo foi interrompido".to_string()))?;
    gravar_baixado(destino_local, &bytes)
}

/// Método e URL do envio. `file_id: Some` substitui o conteúdo existente
/// (`PATCH`); `None` cria um arquivo novo (`POST`).
fn destino_do_envio(file_id: Option<&str>) -> (reqwest::Method, String) {
    match file_id {
        Some(id) => (
            reqwest::Method::PATCH,
            format!("{API_UPLOAD}/{id}?uploadType=resumable"),
        ),
        None => (reqwest::Method::POST, format!("{API_UPLOAD}?uploadType=resumable")),
    }
}

/// Metadados que abrem a sessão resumable. Na substituição não vai `parents`
/// nem `name` de propósito: `parents` não é gravável em update (o Drive
/// exige `addParents`/`removeParents` e recusa se o campo aparecer no
/// corpo), e reenviar `name` sobrescreveria uma renomeação feita à mão no
/// drive.google.com sem que nada tivesse pedido isso.
fn metadados_envio(nome: &str, folder_id: &str, file_id: Option<&str>) -> serde_json::Value {
    match file_id {
        Some(_) => serde_json::json!({}),
        None => serde_json::json!({ "name": nome, "parents": [folder_id] }),
    }
}

/// Sobe `origem_local` para o Drive via sessão resumable (nunca multipart —
/// o `.rpgpack` com imagens passa fácil do teto de 5MB do multipart).
/// `file_id: None` cria; `Some` substitui o conteúdo do arquivo existente.
/// Devolve o `file_id` resultante (novo, ou o mesmo recebido).
pub async fn enviar_resumable(
    http: &reqwest::Client,
    token: &str,
    folder_id: &str,
    file_id: Option<&str>,
    nome: &str,
    origem_local: &Path,
) -> Result<String, AppError> {
    let conteudo = std::fs::read(origem_local)?;
    let metadados = metadados_envio(nome, folder_id, file_id).to_string();
    let (metodo, url) = destino_do_envio(file_id);

    let abertura = autorizar(http.request(metodo, url), token)
        .header("X-Upload-Content-Type", MIME_PACOTE)
        .header("X-Upload-Content-Length", conteudo.len().to_string())
        .header(reqwest::header::CONTENT_TYPE, "application/json; charset=UTF-8")
        .body(metadados)
        .send()
        .await
        .map_err(|_| erro_de_rede())?;

    if !abertura.status().is_success() {
        return Err(falha(abertura).await);
    }
    let sessao = abertura
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            AppError::Msg("o Google Drive não abriu a sessão de envio do arquivo".to_string())
        })?
        .to_string();

    let enviado: ArquivoDrive = ler_json(
        autorizar(http.put(sessao), token)
            .header(reqwest::header::CONTENT_TYPE, MIME_PACOTE)
            .query(&[("fields", "id")])
            .body(conteudo),
    )
    .await?;
    Ok(enviado.id)
}

/// Lê só o manifesto (`_pacote_manifesto`) do pacote que está no Drive.
///
/// Baixa o pacote inteiro para um temporário e reusa
/// [`sincronizacao_nuvem::ler_manifesto`] — otimização de "ler só um range de
/// bytes" fica para depois (plano, Fase 2, fora de escopo). O temporário é
/// sempre apagado, mesmo se a leitura falhar.
pub async fn ler_manifesto_remoto(
    http: &reqwest::Client,
    token: &str,
    file_id: &str,
) -> Result<Manifesto, AppError> {
    let temp = std::env::temp_dir().join(format!(
        "rpg-manifesto-remoto-{}-{}.rpgpack",
        std::process::id(),
        epoch_nanos()
    ));
    baixar(http, token, file_id, &temp).await?;
    let resultado = sincronizacao_nuvem::ler_manifesto(&temp);
    let _ = std::fs::remove_file(&temp);
    resultado
}

fn epoch_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapa_aspa_e_barra_na_consulta() {
        assert_eq!(escapar_q("O'Brien"), "O\\'Brien");
        assert_eq!(escapar_q("a\\b'c"), "a\\\\b\\'c");
    }

    #[test]
    fn query_pasta_filtra_por_nome_e_tipo() {
        let q = query_pasta("Ficha de RPG");
        assert!(q.contains("name = 'Ficha de RPG'"));
        assert!(q.contains(MIME_PASTA));
        assert!(q.contains("trashed = false"));
    }

    #[test]
    fn query_arquivo_filtra_pela_pasta_mae() {
        let q = query_arquivo_na_pasta("folder123", "rpg-estado.rpgpack");
        assert!(q.contains("'folder123' in parents"));
        assert!(q.contains("name = 'rpg-estado.rpgpack'"));
    }

    #[test]
    fn criar_usa_post_e_substituir_usa_patch() {
        let (metodo, url) = destino_do_envio(None);
        assert_eq!(metodo, reqwest::Method::POST);
        assert!(url.starts_with(&format!("{API_UPLOAD}?")), "url inesperada: {url}");
        assert!(url.contains("uploadType=resumable"));

        let (metodo, url) = destino_do_envio(Some("id123"));
        assert_eq!(metodo, reqwest::Method::PATCH);
        assert!(url.starts_with(&format!("{API_UPLOAD}/id123?")), "url inesperada: {url}");
    }

    #[test]
    fn substituicao_nao_manda_parents_nem_name() {
        let novo = metadados_envio("rpg-estado.rpgpack", "pasta1", None);
        assert_eq!(novo["name"], "rpg-estado.rpgpack");
        assert_eq!(novo["parents"][0], "pasta1");

        let existente = metadados_envio("rpg-estado.rpgpack", "pasta1", Some("id123"));
        assert!(existente.get("parents").is_none(), "mandou parents no update");
        assert!(existente.get("name").is_none(), "mandou name no update");
    }

    #[test]
    fn traduz_a_falha_pelo_status() {
        assert!(descrever_falha(401, None).contains("expirou"));
        assert!(descrever_falha(404, None).contains("já não existe"));
        assert!(descrever_falha(429, None).contains("desacelerar"));
        assert!(descrever_falha(503, None).contains("desacelerar"));
        let com_detalhe = descrever_falha(403, Some("Rate Limit Exceeded"));
        assert!(com_detalhe.contains("Rate Limit Exceeded"), "perdeu o detalhe: {com_detalhe}");
    }

    #[test]
    fn le_resposta_do_drive_com_tamanho_em_texto() {
        let json = r#"{ "id": "a1", "name": "rpg-estado.rpgpack",
            "mimeType": "application/octet-stream", "size": "1234",
            "modifiedTime": "2026-08-11T10:00:00.000Z" }"#;
        let arquivo: ArquivoDrive = serde_json::from_str(json).unwrap();
        assert_eq!(tamanho_de(&arquivo), Some(1234));
        let remoto = arquivo_remoto(&arquivo);
        assert_eq!(remoto.file_id, "a1");
        assert_eq!(remoto.size, Some(1234));
    }

    /// Teste de integração real, roda manual com uma conta Google de verdade.
    ///
    /// Não roda em `cargo test` normal (`#[ignore]`) porque precisa de rede e
    /// de um access token válido. Uso: obtenha um access token (ex.: rodando
    /// `google_login` no `tauri dev` e capturando via um log temporário, ou
    /// trocando o refresh token guardado no Windows) e exporte
    /// `RPG_GOOGLE_ACCESS_TOKEN_TESTE` antes de rodar:
    /// `cargo test --package projeto-rpg-v2 -- --ignored teste_integracao_drive`
    #[test]
    #[ignore]
    fn teste_integracao_drive_sobe_e_baixa_com_sha256_igual() {
        use sha2::Digest;

        let token = std::env::var("RPG_GOOGLE_ACCESS_TOKEN_TESTE")
            .expect("defina RPG_GOOGLE_ACCESS_TOKEN_TESTE com um access token válido");

        // `#[tokio::test]` exigiria a feature `macros` do tokio, que este
        // projeto não habilita (só `sync`+`time`, aprovado no plano). Um
        // runtime construído à mão via `new_current_thread` já basta — este
        // teste roda uma vez, manual, nunca em paralelo.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("não foi possível montar o runtime tokio para o teste manual");

        runtime.block_on(async {
            let http = http().unwrap();

            let pasta_id = garantir_pasta(&http, &token, "Ficha de RPG (teste automatizado)")
                .await
                .expect("garantir_pasta falhou");

            let origem = std::env::temp_dir().join("rpg_teste_drive_origem.bin");
            std::fs::write(&origem, b"conteudo de teste do cliente drive enxuto").unwrap();

            let file_id =
                enviar_resumable(&http, &token, &pasta_id, None, "rpg-teste.bin", &origem)
                    .await
                    .expect("enviar_resumable falhou");

            let destino = std::env::temp_dir().join("rpg_teste_drive_destino.bin");
            baixar(&http, &token, &file_id, &destino).await.expect("baixar falhou");

            let hash_origem = hex::encode(sha2::Sha256::digest(std::fs::read(&origem).unwrap()));
            let hash_destino = hex::encode(sha2::Sha256::digest(std::fs::read(&destino).unwrap()));
            assert_eq!(hash_origem, hash_destino, "sha256 divergiu entre envio e download");

            let _ = std::fs::remove_file(&origem);
            let _ = std::fs::remove_file(&destino);
        });
    }
}
