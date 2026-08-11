//! Autenticação com o Google (OAuth 2.0 + PKCE), para o sync com o Google Drive
//! (docs/plans/2026-08-11-sync-google-drive.md). Adaptado de
//! `grimorio/src-tauri/src/auth.rs` — único desvio real: aqui `credenciais()` lê
//! `client_id`/`client_secret` do cofre (`segredos.rs`), não de env var de build,
//! porque o repo é público e o cofre já é o mecanismo de segredo do projeto (Q6).
//!
//! O Rust é dono das credenciais. O refresh token nunca atravessa para o JavaScript
//! e nunca toca em disco: vai direto para o Gerenciador de Credenciais do Windows.
//! Para o front só sobe o e-mail da conta conectada — nunca um access token.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oauth2::basic::BasicClient;
use oauth2::url::Url;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet,
    ErrorResponse, PkceCodeChallenge, RedirectUrl, RefreshToken, RequestTokenError, Scope,
    TokenResponse, TokenUrl,
};
use serde::Serialize;

use crate::segredos::CofreState;

/// Endpoint de autorização. Abre no navegador do sistema, nunca em webview embutida: o
/// Google bloqueia user-agents embutidos com `disallowed_useragent`, e a Microsoft já
/// confirmou que isso atinge o WebView2 — que é exatamente o que o Tauri usa no Windows.
const URL_AUTORIZACAO: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const URL_TOKEN: &str = "https://oauth2.googleapis.com/token";
const URL_USERINFO: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

/// Só `drive.file`: o app enxerga apenas os arquivos que ele mesmo criou. Escopos mais
/// amplos do Drive são *restricted* e obrigariam a uma auditoria de segurança anual paga
/// para distribuir o app publicamente.
const ESCOPO_DRIVE: &str = "https://www.googleapis.com/auth/drive.file";

/// Sem estes o `URL_USERINFO` responde 401, e não 403 como se esperaria de permissão
/// faltando — o endpoint é OIDC e trata token sem identidade como token inválido. São
/// escopos *não sensíveis*: ao contrário do Drive completo, não pedem auditoria.
const ESCOPOS_IDENTIDADE: [&str; 2] = ["openid", "email"];

/// Nome do serviço no Gerenciador de Credenciais do Windows — distinto do usado pelo
/// `grimorio` (mesmo `client_id` do app OAuth, Q1, mas keyring por-app: um refresh
/// token de um não deve ser lido nem apagado pelo outro).
const SERVICO_KEYRING: &str = "com.gedasio.rpgv2";
const ENTRADA_REFRESH: &str = "google-refresh";
const ENTRADA_EMAIL: &str = "google-email";

/// Quanto esperamos o usuário concluir o login no navegador antes de desistir e derrubar
/// o servidor de retorno. Sem isso, uma aba fechada no meio do caminho deixaria uma porta
/// escutando pelo resto da vida do app.
const LIMITE_LOGIN: Duration = Duration::from_secs(300);

/// Renova o access token um pouco antes da hora, para não perder uma chamada por causa de
/// relógio dessincronizado ou latência de rede.
const MARGEM_EXPIRACAO: Duration = Duration::from_secs(60);

/// Validade assumida quando o Google não informa `expires_in`.
const VALIDADE_PADRAO: Duration = Duration::from_secs(3600);

/// Página mostrada no navegador quando o Google devolve o usuário. O plugin injeta nela
/// um `<script>` que devolve a URL completa para o servidor local, então ela precisa ter
/// um `<head>`.
const PAGINA_RETORNO: &str = r#"<html><head><meta charset="utf-8"><title>Ficha de RPG</title></head><body style="font-family:system-ui;text-align:center;padding-top:4rem">Pode voltar para a Ficha de RPG. Esta aba já pode ser fechada.</body></html>"#;

/// Access token vivo apenas em memória. Sem `derive(Debug)` de propósito: nada aqui pode
/// escorregar para um log por acidente.
#[allow(dead_code)] // consumido pelo `google::drive` da Fase 2 (ainda não existe)
struct TokenEmMemoria {
    valor: String,
    expira_em: Instant,
}

/// Estado gerenciado pelo Tauri. Sem `derive(Debug)` pelo mesmo motivo do tipo acima.
#[derive(Default)]
pub struct EstadoGoogle {
    token: Mutex<Option<TokenEmMemoria>>,
}

/// Cliente já com os dois endpoints fixados — é o que o typestate do `oauth2` 5 exige
/// para liberar `exchange_code` e `exchange_refresh_token`.
type ClienteGoogle = BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

/// Status exposto ao frontend — nunca inclui token, só o suficiente pra UI decidir
/// entre "Conectar" e "Desconectar {email}".
#[derive(Serialize)]
pub struct GoogleStatus {
    pub conectado: bool,
    pub email: Option<String>,
}

fn travar(estado: &EstadoGoogle) -> MutexGuard<'_, Option<TokenEmMemoria>> {
    // Envenenamento só aconteceria se algo entrasse em pânico segurando a trava. As seções
    // críticas aqui são atribuições triviais, então seguir com o valor de dentro é seguro.
    estado.token.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Erro de configuração, não erro do usuário: o cofre não tem (ou não foi destravado
/// com) as credenciais do app OAuth do Google.
fn erro_sem_credencial() -> String {
    "Sync com Google Drive indisponível: as credenciais do Google não estão no cofre \
     desta instalação (ausentes ou cofre ainda trancado). Não é nada que você tenha \
     feito de errado."
        .to_string()
}

fn credenciais(cofre: &CofreState) -> Result<(ClientId, ClientSecret), String> {
    let (client_id, client_secret) = cofre.google_credenciais().ok_or_else(erro_sem_credencial)?;
    Ok((ClientId::new(client_id), ClientSecret::new(client_secret)))
}

fn cliente_google(cofre: &CofreState) -> Result<ClienteGoogle, String> {
    let (client_id, client_secret) = credenciais(cofre)?;
    let auth_url = AuthUrl::new(URL_AUTORIZACAO.to_string())
        .map_err(|_| "endpoint de autorização do Google inválido".to_string())?;
    let token_url = TokenUrl::new(URL_TOKEN.to_string())
        .map_err(|_| "endpoint de token do Google inválido".to_string())?;
    Ok(BasicClient::new(client_id)
        .set_client_secret(client_secret)
        .set_auth_uri(auth_url)
        .set_token_uri(token_url))
}

/// Cliente HTTP sem seguir redirecionamento: a própria documentação do `oauth2` alerta que
/// seguir redirect na troca de token abre porta para SSRF / vazamento do code.
///
/// Timeout (FIX A da revisão adversarial, 2026-08-11): sem teto, uma rede que
/// TRAVA (em vez de recusar a conexão) pendura a troca de token pra sempre —
/// dentro do `.setup()` do Tauri isso significa a janela nunca abrir.
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "não foi possível iniciar o cliente HTTP para falar com o Google".to_string())
}

/// Traduz a falha da troca de token sem nunca formatar o corpo cru da resposta.
///
/// `RequestTokenError::Parse` carrega o corpo inteiro em um `Vec<u8>` — que numa resposta
/// de sucesso mal parseada conteria os tokens. Por isso essa variante é descartada sem
/// interpolação. As outras três só carregam texto estruturado do servidor.
fn descrever_erro_token<RE, TE>(erro: RequestTokenError<RE, TE>) -> String
where
    RE: std::error::Error + 'static,
    TE: ErrorResponse + 'static,
{
    match erro {
        RequestTokenError::ServerResponse(resposta) => {
            format!("o Google recusou a autenticação ({resposta})")
        }
        RequestTokenError::Request(_) => {
            "não foi possível falar com o Google para concluir a autenticação — verifique a \
             conexão com a internet"
                .to_string()
        }
        RequestTokenError::Parse(..) => {
            "o Google respondeu em um formato inesperado durante a autenticação".to_string()
        }
        RequestTokenError::Other(detalhe) => {
            format!("erro inesperado ao autenticar com o Google ({detalhe})")
        }
    }
}

fn entrada(usuario: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICO_KEYRING, usuario)
        .map_err(|_| "não foi possível acessar o Gerenciador de Credenciais do Windows".to_string())
}

/// `Ok(None)` quando a entrada nunca existiu — `keyring` sinaliza isso com `Error::NoEntry`,
/// que aqui é ausência de conta, não falha.
fn ler_segredo(usuario: &str) -> Result<Option<String>, String> {
    match entrada(usuario)?.get_password() {
        Ok(valor) => Ok(Some(valor)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("não foi possível ler a conta guardada no Windows".to_string()),
    }
}

fn gravar_segredo(usuario: &str, valor: &str) -> Result<(), String> {
    entrada(usuario)?
        .set_password(valor)
        .map_err(|_| "não foi possível guardar a conta no Gerenciador de Credenciais".to_string())
}

/// Apagar algo que já não existe é sucesso — desconectar precisa ser idempotente.
fn apagar_segredo(usuario: &str) -> Result<(), String> {
    match entrada(usuario)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("não foi possível remover a conta do Gerenciador de Credenciais".to_string()),
    }
}

fn guardar_em_memoria(estado: &EstadoGoogle, valor: &str, validade: Option<Duration>) {
    let validade = validade.unwrap_or(VALIDADE_PADRAO);
    *travar(estado) = Some(TokenEmMemoria {
        valor: valor.to_string(),
        expira_em: Instant::now() + validade.saturating_sub(MARGEM_EXPIRACAO),
    });
}

#[allow(dead_code)] // consumido por `access_token`, que a Fase 2 (`google::drive`) chama
fn access_token_em_memoria(estado: &EstadoGoogle) -> Option<String> {
    let guarda = travar(estado);
    let token = guarda.as_ref()?;
    (Instant::now() < token.expira_em).then(|| token.valor.clone())
}

/// A porta do loopback é aberta e sem autenticação: qualquer processo local poderia bater
/// nela. Conferir o `state` é o que amarra a resposta ao pedido que este app fez.
fn extrair_code(url_retorno: &str, state_esperado: &str) -> Result<String, String> {
    let url = Url::parse(url_retorno)
        .map_err(|_| "o Google devolveu um endereço de retorno ilegível".to_string())?;

    let mut code = None;
    let mut state = None;
    let mut erro = None;
    for (chave, valor) in url.query_pairs() {
        match chave.as_ref() {
            "code" => code = Some(valor.into_owned()),
            "state" => state = Some(valor.into_owned()),
            "error" => erro = Some(valor.into_owned()),
            _ => {}
        }
    }

    if let Some(erro) = erro {
        return Err(format!("o Google recusou a autorização ({erro})"));
    }
    if state.as_deref() != Some(state_esperado) {
        return Err("a resposta do login não corresponde ao pedido feito pelo app — \
                    autenticação cancelada por segurança"
            .to_string());
    }
    code.ok_or_else(|| "o Google não devolveu o código de autorização".to_string())
}

#[derive(serde::Deserialize)]
struct RespostaUserinfo {
    email: Option<String>,
}

async fn buscar_email(http: &reqwest::Client, access_token: &str) -> Result<String, String> {
    let resposta = http
        .get(URL_USERINFO)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| "não foi possível consultar o e-mail da conta no Google".to_string())?;

    if !resposta.status().is_success() {
        return Err(format!(
            "o Google recusou a consulta do e-mail da conta (HTTP {})",
            resposta.status().as_u16()
        ));
    }

    resposta
        .json::<RespostaUserinfo>()
        .await
        .map_err(|_| "o Google respondeu o e-mail da conta em formato inesperado".to_string())?
        .email
        .ok_or_else(|| "a conta do Google não informou um e-mail".to_string())
}

/// Faz o login completo e devolve o e-mail da conta conectada.
///
/// O refresh token resultante fica só no Gerenciador de Credenciais; ele não volta daqui.
#[tauri::command]
pub async fn google_login(
    estado: tauri::State<'_, EstadoGoogle>,
    cofre: tauri::State<'_, CofreState>,
) -> Result<String, String> {
    let cliente = cliente_google(&cofre)?;
    let (desafio_pkce, verificador_pkce) = PkceCodeChallenge::new_random_sha256();

    let (remetente, receptor) = tokio::sync::oneshot::channel::<String>();
    let mut remetente = Some(remetente);
    let config = tauri_plugin_oauth::OauthConfig {
        ports: None,
        response: Some(PAGINA_RETORNO.into()),
        redirect_uri: None,
    };
    // O handler é `FnMut`, mas o canal só pode ser usado uma vez; daí o `Option` + `take`.
    let porta = tauri_plugin_oauth::start_with_config(config, move |url| {
        if let Some(remetente) = remetente.take() {
            let _ = remetente.send(url);
        }
    })
    .map_err(|_| "não foi possível abrir a porta local que recebe a resposta do Google".to_string())?;

    let resultado = concluir_login(&cliente, porta, desafio_pkce, verificador_pkce, receptor, &estado).await;

    if resultado.is_err() {
        // O servidor do plugin só se encerra sozinho depois de atender o callback. Em
        // qualquer caminho de erro (timeout, `state` errado, troca recusada) ele ainda pode
        // estar escutando, e uma porta esquecida num app de vida longa é problema de verdade.
        let _ = tauri_plugin_oauth::cancel(porta);
    }
    resultado
}

async fn concluir_login(
    cliente: &ClienteGoogle,
    porta: u16,
    desafio_pkce: PkceCodeChallenge,
    verificador_pkce: oauth2::PkceCodeVerifier,
    receptor: tokio::sync::oneshot::Receiver<String>,
    estado: &EstadoGoogle,
) -> Result<String, String> {
    let redirect = RedirectUrl::new(format!("http://127.0.0.1:{porta}"))
        .map_err(|_| "endereço de retorno local inválido".to_string())?;
    let cliente = cliente.clone().set_redirect_uri(redirect);

    let (url_autorizacao, csrf) = cliente
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new(ESCOPO_DRIVE.to_string()))
        .add_scopes(ESCOPOS_IDENTIDADE.map(|e| Scope::new(e.to_string())))
        // `offline` + `consent` juntos são o que garante um refresh token: sem `consent`,
        // um usuário que já autorizou antes recebe só o access token.
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .set_pkce_challenge(desafio_pkce)
        .url();

    tauri_plugin_opener::open_url(url_autorizacao.to_string(), None::<&str>)
        .map_err(|_| "não foi possível abrir o navegador para o login do Google".to_string())?;

    let url_retorno = match tokio::time::timeout(LIMITE_LOGIN, receptor).await {
        Ok(Ok(url)) => url,
        Ok(Err(_)) => return Err("o login foi interrompido antes de terminar".to_string()),
        Err(_) => {
            return Err("o login demorou demais e foi cancelado — tente entrar de novo".to_string())
        }
    };

    let code = extrair_code(&url_retorno, csrf.secret())?;
    let http = http()?;
    let resposta = cliente
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(verificador_pkce)
        .request_async(&http)
        .await
        .map_err(descrever_erro_token)?;

    let refresh = resposta.refresh_token().ok_or_else(|| {
        "o Google não devolveu um token de renovação — remova o acesso da Ficha de RPG na sua \
         Conta Google e tente entrar de novo"
            .to_string()
    })?;
    let access_token = resposta.access_token().secret().clone();
    guardar_em_memoria(estado, &access_token, resposta.expires_in());

    // O e-mail é buscado antes de qualquer gravação de propósito. Gravando o refresh
    // primeiro, uma falha aqui — que é uma chamada de rede, a parte mais frágil do fluxo —
    // deixava um token órfão no Gerenciador de Credenciais: a aba dizia "desconectado"
    // porque lê o e-mail, enquanto o token continuava guardado sem conta correspondente.
    let email = buscar_email(&http, &access_token).await?;
    gravar_segredo(ENTRADA_REFRESH, refresh.secret())?;
    gravar_segredo(ENTRADA_EMAIL, &email)?;
    Ok(email)
}

/// Devolve um access token válido, renovando pelo refresh token quando o de memória
/// expirou ou nunca existiu. **Não** é comando — nunca cruza pro TS (Q6/plano Fase 1);
/// só o módulo `google::drive` (Fase 2) chama isto.
#[allow(dead_code)] // sem consumidor até a Fase 2 (`google::drive`) existir
pub async fn access_token(estado: &EstadoGoogle, cofre: &CofreState) -> Result<String, String> {
    if let Some(token) = access_token_em_memoria(estado) {
        return Ok(token);
    }

    let refresh = ler_segredo(ENTRADA_REFRESH)?
        .ok_or_else(|| "nenhuma conta do Google conectada — entre com o Google primeiro".to_string())?;

    let cliente = cliente_google(cofre)?;
    let http = http()?;
    let resposta = cliente
        .exchange_refresh_token(&RefreshToken::new(refresh))
        .request_async(&http)
        .await
        .map_err(descrever_erro_token)?;

    let access_token = resposta.access_token().secret().clone();
    guardar_em_memoria(estado, &access_token, resposta.expires_in());

    // O Google costuma reaproveitar o refresh token, mas pode rotacioná-lo; se vier um
    // novo, o antigo deixa de valer e precisamos guardar o substituto.
    if let Some(novo_refresh) = resposta.refresh_token() {
        gravar_segredo(ENTRADA_REFRESH, novo_refresh.secret())?;
    }

    Ok(access_token)
}

/// Situação da conexão com o Google para a UI: conectado + e-mail, ou desconectado.
#[tauri::command]
pub fn google_status() -> Result<GoogleStatus, String> {
    let Some(email) = ler_segredo(ENTRADA_REFRESH)?.and(ler_segredo(ENTRADA_EMAIL)?) else {
        return Ok(GoogleStatus { conectado: false, email: None });
    };
    Ok(GoogleStatus { conectado: true, email: Some(email) })
}

/// Esquece a conta: apaga o refresh token do Windows e o access token da memória.
#[tauri::command]
pub fn google_logout(estado: tauri::State<'_, EstadoGoogle>) -> Result<(), String> {
    *travar(&estado) = None;
    apagar_segredo(ENTRADA_REFRESH)?;
    apagar_segredo(ENTRADA_EMAIL)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RETORNO: &str = "http://127.0.0.1:41234/?code=abc123&state=esperado";

    #[test]
    fn extrai_o_code_quando_o_state_confere() {
        assert_eq!(extrair_code(RETORNO, "esperado").unwrap(), "abc123");
    }

    #[test]
    fn recusa_retorno_com_state_diferente() {
        // Qualquer processo local pode bater na porta do loopback; sem essa recusa, um
        // code plantado por outro programa seria trocado por um token desta conta.
        assert!(extrair_code(RETORNO, "outro").is_err());
    }

    #[test]
    fn recusa_retorno_sem_state() {
        assert!(extrair_code("http://127.0.0.1:41234/?code=abc123", "esperado").is_err());
    }

    #[test]
    fn propaga_recusa_do_google() {
        let erro = extrair_code(
            "http://127.0.0.1:41234/?error=access_denied&state=esperado",
            "esperado",
        )
        .unwrap_err();
        assert!(erro.contains("access_denied"), "erro inesperado: {erro}");
    }

    /// Cofre sem as credenciais Google (ausentes ou trancado) falha em runtime com
    /// mensagem clara — nunca panic.
    #[test]
    fn cofre_sem_credenciais_falha_com_mensagem_clara() {
        let cofre = CofreState::novo(None);
        let erro = credenciais(&cofre).unwrap_err();
        assert!(erro.contains("cofre"), "erro inesperado: {erro}");
    }

    #[test]
    fn cofre_com_credenciais_libera_o_par_client_id_secret() {
        let cofre = CofreState::novo(Some(crate::segredos::Segredos {
            discord_token: None,
            gemini_api_keys: None,
            google_client_id: Some("id-teste".into()),
            google_client_secret: Some("secret-teste".into()),
        }));
        let (id, secret) = credenciais(&cofre).unwrap();
        assert_eq!(id.as_str(), "id-teste");
        assert_eq!(secret.secret(), "secret-teste");
    }
}
