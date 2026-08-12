//! Pacote atômico (`.rpgpack`) para sincronizar banco+imagens entre PCs via
//! pasta na nuvem (OneDrive/Drive/Dropbox), ver `docs/plans/2026-08-10-sync-nuvem.md`.
//! Lógica pura — recebe `Path`s, não `AppHandle` (mesmo padrão de `semente.rs`),
//! o que deixa tudo testável sem subir um app Tauri.
//!
//! O pacote É um banco SQLite (sem dependência nova pra zip, decisão §3 do
//! plano):
//! - `montar_pacote` faz `VACUUM INTO` do banco vivo (snapshot consistente),
//!   scrub das chaves Gemini (mesmo tratamento de `exportar_semente.rs`),
//!   embute as imagens como BLOB em `_pacote_imagem` e grava o carimbo em
//!   `_pacote_manifesto`. Gravação atômica: monta em `<destino>.tmp` e faz
//!   `rename` no final.
//! - `ler_manifesto` abre o pacote read-only e lê só o carimbo — não toca no
//!   resto, então serve pra decidir a ação sem aplicar nada ainda.
//! - `aplicar_pacote` faz backup do banco atual (se existir), extrai as
//!   imagens do pacote de forma ADITIVA (nunca apaga, nunca sobrescreve —
//!   nome = sha256 do conteúdo, igual `semente.rs`) e materializa um `rpg.db`
//!   limpo (copia o pacote, derruba as tabelas `_pacote_*`, `VACUUM`, rename
//!   atômico).
//! - `decidir_acao` é a guarda leve (plano §4): pura, compara o contador
//!   monotônico do carimbo local com o do manifesto da nuvem e leva em conta
//!   se o banco local está "sujo" (revisão avançou desde a última sync —
//!   `banco_esta_sujo`, que pega INSERT/UPDATE/DELETE via `sync_revisao`).

use crate::db::error::AppError;
use crate::db::repositorios::{config_get, config_set};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Mutex, PoisonError};

/// Nome do arquivo único na pasta da nuvem (plano §3 — "um arquivo atômico só").
pub const NOME_PACOTE: &str = "rpg-estado.rpgpack";

/// Versão do formato do pacote (`_pacote_manifesto.schema_pacote`). Sobe se o
/// layout das tabelas `_pacote_*` mudar de um jeito incompatível.
const SCHEMA_PACOTE_ATUAL: i32 = 1;

/// Chaves do carimbo local no `config` KV (plano §4). NÃO sincronizam — cada
/// PC grava as suas.
pub const CHAVE_SYNC_PASTA: &str = "sync_pasta";
pub const CHAVE_SYNC_MACHINE_ID: &str = "sync_machine_id";
pub const CHAVE_SYNC_CONTADOR: &str = "sync_contador";
pub const CHAVE_SYNC_HORA: &str = "sync_hora";
/// Snapshot de `sync_revisao.valor` gravado a cada sync bem-sucedida — é a
/// baseline que [`banco_esta_sujo`] compara com o valor atual (FIX2: um
/// `MAX(atualizado_em)` sozinho não pega DELETE, porque a linha apagada leva
/// o carimbo junto).
pub const CHAVE_SYNC_REVISAO_BASE: &str = "sync_revisao_base";
/// Qual [`Transporte`] está configurado (Fase 3,
/// docs/plans/2026-08-11-sync-google-drive.md): `"pasta"` (padrão, também o
/// que uma instalação sem essa chave ainda gravada assume — compatível com
/// quem já tinha `sync_pasta` configurado antes desta fase existir) ou
/// `"drive"`. `sync_pasta` só é lido/vale quando esta chave é `"pasta"`.
pub const CHAVE_SYNC_TRANSPORTE: &str = "sync_transporte";

/// Linhas de `config` que NUNCA podem sair desta máquina — nem no pacote de
/// sync (é segredo), nem na semente pública do instalador (é carimbo por-PC;
/// ver FIX6/`exportar_semente.rs`). Centralizado aqui pra não divergir entre
/// os dois scrubs.
pub const CONFIG_NAO_EXPORTAR: &[&str] = &[
    "gemini_api_keys",
    CHAVE_SYNC_PASTA,
    CHAVE_SYNC_MACHINE_ID,
    CHAVE_SYNC_CONTADOR,
    CHAVE_SYNC_HORA,
    CHAVE_SYNC_REVISAO_BASE,
    CHAVE_SYNC_TRANSPORTE,
];

/// Qual transporte uma instalação está configurada para usar. Lido de
/// `config.sync_transporte`; ausente (instalação anterior à Fase 3, ou nunca
/// mexeu na tela Sync) cai em [`TipoTransporte::Pasta`] — mesmo comportamento
/// de hoje.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TipoTransporte {
    Pasta,
    Drive,
}

impl TipoTransporte {
    pub fn ler(conn: &Connection) -> Result<Self, AppError> {
        match config_get(conn, CHAVE_SYNC_TRANSPORTE)?.as_deref() {
            Some("drive") => Ok(Self::Drive),
            _ => Ok(Self::Pasta),
        }
    }
}

/// Carimbo gravado dentro do pacote (`_pacote_manifesto`). `contador` é o
/// número monotônico que decide qual lado é mais novo (plano §4); os outros
/// campos são metadado/diagnóstico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifesto {
    pub contador: i64,
    pub epoch: i64,
    pub machine_id: String,
    pub hash_dados: String,
    pub versao_app: String,
    pub schema_pacote: i32,
}

/// Carimbo local (vive no `config` do banco do usuário — não sincroniza,
/// cada PC tem o seu). Só o `contador` importa para `decidir_acao`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Carimbo {
    pub contador: i64,
}

/// O que a guarda leve decidiu (plano §4). Função pura: nenhum I/O aqui,
/// então cobrir todas as combinações em teste é barato e vale a pena — é o
/// coração da proteção contra sobrescrita de dado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Acao {
    /// Mesmo contador dos dois lados: nada a fazer.
    EmDia,
    /// Nuvem tem contador maior e o local está limpo: pode baixar sozinho.
    NuvemMaisNova,
    /// Local tem contador maior (este PC enviou por último, ainda não bateu
    /// com o que teria vindo de outro PC): nada a baixar.
    LocalMaisNovo,
    /// Nuvem tem contador maior, mas o local tem mudança não enviada: para e
    /// pergunta, nunca decide sozinho.
    Conflito,
    /// Não há pacote na nuvem ainda (primeira vez que essa pasta é usada).
    SemNuvem,
}

/// Compara o carimbo local com o manifesto da nuvem (se houver) e devolve a
/// ação recomendada. `sujo` = "o banco local tem mudança desde a última sync"
/// (quem chama calcula isso fora, por [`banco_esta_sujo`] — ver plano §4).
pub fn decidir_acao(local: Carimbo, nuvem: Option<&Manifesto>, sujo: bool) -> Acao {
    let Some(nuvem) = nuvem else {
        return Acao::SemNuvem;
    };
    // FIX4: contador==0 é "nunca sincronizou nesta máquina" — não há
    // baseline pra conflitar (o "sujo" aqui é só o bootstrap da semente).
    // Aplica direto; o backup em `aplicar_pacote` protege.
    if local.contador == 0 {
        return Acao::NuvemMaisNova;
    }
    if nuvem.contador > local.contador {
        if sujo {
            Acao::Conflito
        } else {
            Acao::NuvemMaisNova
        }
    } else if nuvem.contador < local.contador {
        Acao::LocalMaisNovo
    } else {
        Acao::EmDia
    }
}

/// Caminho do pacote único dentro da pasta da nuvem escolhida pelo usuário.
pub fn caminho_pacote(pasta_nuvem: &Path) -> PathBuf {
    pasta_nuvem.join(NOME_PACOTE)
}

/// Futuro devolvido pelos métodos de [`Transporte`], boxado à mão (sem a dep
/// `async-trait`, fora das 5 aprovadas no plano) — é o que permite `&dyn
/// Transporte` nas assinaturas do núcleo (`enviar`/`planejar_baixar`/
/// `planejar_boot`). `Send` porque essas chamadas atravessam
/// `tauri::async_runtime::block_on` a partir de comandos e do `setup()`.
pub type RespostaTransporte<'a, T> = Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'a>>;

/// Onde o pacote `.rpgpack` mora — pasta local (`TransportePasta`, o
/// comportamento de sempre) ou Google Drive (`TransporteDrive`, Fase 3 do
/// plano). O núcleo nunca sabe qual dos dois está por trás: só fala com esta
/// interface, e cada implementação decide como materializar/publicar em
/// disco local o que só ele entende (cópia de arquivo, ou download/upload
/// pela API do Drive).
pub trait Transporte: Send + Sync {
    /// Lê o manifesto do pacote remoto, se ele existir. `None` = ainda não há
    /// pacote nesse transporte (primeira sync).
    fn ler_manifesto(&self) -> RespostaTransporte<'_, Option<Manifesto>>;

    /// Materializa o pacote remoto inteiro em `destino_temp` (arquivo local).
    fn baixar_pacote_para<'a>(&'a self, destino_temp: &'a Path) -> RespostaTransporte<'a, ()>;

    /// Publica `origem_temp` — já montado e scrubado (FIX1) — como o novo
    /// conteúdo do pacote remoto.
    fn publicar_pacote<'a>(&'a self, origem_temp: &'a Path) -> RespostaTransporte<'a, ()>;

    /// Faz backup do pacote remoto ATUAL antes de ser sobrescrito (FIX5/Q2 —
    /// backup dos dois lados, não só do banco local em [`aplicar_pacote`]).
    /// `None` = não havia pacote remoto para fazer backup.
    fn backup_remoto_se_existir(&self) -> RespostaTransporte<'_, Option<String>>;
}

/// Transporte de hoje: a pasta local sincronizada por uma nuvem de arquivos
/// (OneDrive/Drive/Dropbox instalado) ou um pen drive — o app só enxerga um
/// caminho no sistema de arquivos, nunca fala com nenhuma API.
pub struct TransportePasta {
    pasta_nuvem: PathBuf,
}

impl TransportePasta {
    pub fn new(pasta_nuvem: impl Into<PathBuf>) -> Self {
        Self { pasta_nuvem: pasta_nuvem.into() }
    }

    fn caminho(&self) -> PathBuf {
        caminho_pacote(&self.pasta_nuvem)
    }
}

impl Transporte for TransportePasta {
    fn ler_manifesto(&self) -> RespostaTransporte<'_, Option<Manifesto>> {
        Box::pin(async move {
            let caminho = self.caminho();
            if !caminho.exists() {
                return Ok(None);
            }
            ler_manifesto(&caminho).map(Some)
        })
    }

    fn baixar_pacote_para<'a>(&'a self, destino_temp: &'a Path) -> RespostaTransporte<'a, ()> {
        Box::pin(async move { std::fs::copy(self.caminho(), destino_temp).map(|_| ()).map_err(AppError::from) })
    }

    fn publicar_pacote<'a>(&'a self, origem_temp: &'a Path) -> RespostaTransporte<'a, ()> {
        Box::pin(async move {
            std::fs::create_dir_all(&self.pasta_nuvem)?;
            publicar_pacote_na_nuvem(origem_temp, &self.caminho())
        })
    }

    fn backup_remoto_se_existir(&self) -> RespostaTransporte<'_, Option<String>> {
        Box::pin(async move {
            let caminho = self.caminho();
            if !caminho.exists() {
                return Ok(None);
            }
            let alvo = caminho_backup_sync(&caminho);
            std::fs::copy(&caminho, &alvo)?;
            Ok(Some(alvo.display().to_string()))
        })
    }
}

/// Cache em memória do `TransporteDrive`: `&self` é compartilhado (o trait
/// não dá `&mut self`), então a pasta/arquivo já achados na sessão vivem
/// atrás de um `Mutex` pra não repetir `files.list` a cada chamada. Nunca é
/// mantido travado durante um `.await` — cada acesso é lido/gravado numa
/// instrução isolada.
#[derive(Default)]
struct CacheDrive {
    folder_id: Option<String>,
    /// `Some(None)` = já verificou nesta sessão e não existe pacote ainda;
    /// `None` = ainda não verificou.
    arquivo: Option<Option<crate::google::drive::ArquivoRemoto>>,
}

/// Transporte via Google Drive (Fase 3 do plano): o pacote remoto é UM
/// arquivo (`NOME_PACOTE`) dentro de uma pasta (`nome_pasta`) no Drive do
/// usuário, alcançado pela API REST (`crate::google::drive`). Todo
/// download/upload passa por um arquivo LOCAL temporário — o núcleo
/// (`aplicar_pacote`/`montar_pacote`) nunca fala com o Drive diretamente.
pub struct TransporteDrive {
    http: reqwest::Client,
    token: String,
    nome_pasta: String,
    /// Onde ficam os backups baixados por [`Transporte::backup_remoto_se_existir`]
    /// (FIX5/Q2) — diretório local, nunca a pasta do Drive em si.
    dir_backup_local: PathBuf,
    cache: Mutex<CacheDrive>,
}

impl TransporteDrive {
    pub fn new(
        http: reqwest::Client,
        token: String,
        nome_pasta: impl Into<String>,
        dir_backup_local: impl Into<PathBuf>,
    ) -> Self {
        Self {
            http,
            token,
            nome_pasta: nome_pasta.into(),
            dir_backup_local: dir_backup_local.into(),
            cache: Mutex::new(CacheDrive::default()),
        }
    }

    fn cache(&self) -> std::sync::MutexGuard<'_, CacheDrive> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    async fn folder_id(&self) -> Result<String, AppError> {
        if let Some(id) = self.cache().folder_id.clone() {
            return Ok(id);
        }
        let id = crate::google::drive::garantir_pasta(&self.http, &self.token, &self.nome_pasta).await?;
        self.cache().folder_id = Some(id.clone());
        Ok(id)
    }

    async fn arquivo(&self) -> Result<Option<crate::google::drive::ArquivoRemoto>, AppError> {
        if let Some(achado) = self.cache().arquivo.clone() {
            return Ok(achado);
        }
        let folder_id = self.folder_id().await?;
        let achado =
            crate::google::drive::achar_arquivo(&self.http, &self.token, &folder_id, NOME_PACOTE).await?;
        self.cache().arquivo = Some(achado.clone());
        Ok(achado)
    }
}

impl Transporte for TransporteDrive {
    fn ler_manifesto(&self) -> RespostaTransporte<'_, Option<Manifesto>> {
        Box::pin(async move {
            let Some(arquivo) = self.arquivo().await? else {
                return Ok(None);
            };
            crate::google::drive::ler_manifesto_remoto(&self.http, &self.token, &arquivo.file_id)
                .await
                .map(Some)
        })
    }

    fn baixar_pacote_para<'a>(&'a self, destino_temp: &'a Path) -> RespostaTransporte<'a, ()> {
        Box::pin(async move {
            let arquivo = self
                .arquivo()
                .await?
                .ok_or_else(|| AppError::Msg("nenhum pacote no Google Drive ainda".into()))?;
            crate::google::drive::baixar(&self.http, &self.token, &arquivo.file_id, destino_temp).await
        })
    }

    fn publicar_pacote<'a>(&'a self, origem_temp: &'a Path) -> RespostaTransporte<'a, ()> {
        Box::pin(async move {
            let folder_id = self.folder_id().await?;
            let file_id_atual = self.arquivo().await?.map(|a| a.file_id);
            let novo_id = crate::google::drive::enviar_resumable(
                &self.http,
                &self.token,
                &folder_id,
                file_id_atual.as_deref(),
                NOME_PACOTE,
                origem_temp,
            )
            .await?;
            self.cache().arquivo =
                Some(Some(crate::google::drive::ArquivoRemoto { file_id: novo_id, modified: None, size: None }));
            Ok(())
        })
    }

    fn backup_remoto_se_existir(&self) -> RespostaTransporte<'_, Option<String>> {
        Box::pin(async move {
            let Some(arquivo) = self.arquivo().await? else {
                return Ok(None);
            };
            std::fs::create_dir_all(&self.dir_backup_local)?;
            let alvo = self.dir_backup_local.join(format!("{NOME_PACOTE}.bak-sync-drive-{}", epoch_agora()));
            crate::google::drive::baixar(&self.http, &self.token, &arquivo.file_id, &alvo).await?;
            Ok(Some(alvo.display().to_string()))
        })
    }
}

/// Gera um `machine_id` novo, aleatório o bastante pra distinguir um punhado
/// de PCs (não é segredo, não precisa de RNG criptográfico). Combina o
/// espalhamento de `RandomState` (semeado pelo SO) com relógio e PID pra não
/// repetir mesmo se duas máquinas chamarem isso no mesmo instante.
pub fn gerar_machine_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let espalhado = RandomState::new().build_hasher().finish();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let mut hasher = Sha256::new();
    hasher.update(espalhado.to_le_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    hex::encode(&hasher.finalize()[..8])
}

/// Carimbo local lido do `config` KV (plano §4). `contador` ausente vira `0`
/// (nunca sincronizou); os demais campos ausentes viram `None`.
#[derive(Debug, Clone, Default)]
pub struct CarimboLocal {
    pub pasta: Option<String>,
    pub machine_id: Option<String>,
    pub contador: i64,
    pub hora: Option<String>,
}

/// Lê o carimbo local inteiro do `config` KV.
pub fn carimbo_ler(conn: &Connection) -> Result<CarimboLocal, AppError> {
    Ok(CarimboLocal {
        pasta: config_get(conn, CHAVE_SYNC_PASTA)?,
        machine_id: config_get(conn, CHAVE_SYNC_MACHINE_ID)?,
        contador: config_get(conn, CHAVE_SYNC_CONTADOR)?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0),
        hora: config_get(conn, CHAVE_SYNC_HORA)?,
    })
}

/// Grava `contador`/`hora` do carimbo local após uma sync bem-sucedida
/// (Enviar ou Baixar). Não mexe em `pasta`/`machine_id` — esses têm gravação
/// própria (`sync_definir_pasta`, setup de `machine_id`). Também grava a
/// baseline de `sync_revisao` (FIX2) usada por [`banco_esta_sujo`].
pub fn carimbo_gravar(conn: &Connection, contador: i64, hora: &str) -> Result<(), AppError> {
    config_set(conn, CHAVE_SYNC_CONTADOR, &contador.to_string())?;
    config_set(conn, CHAVE_SYNC_HORA, hora)?;
    let revisao = revisao_atual(conn)?;
    config_set(conn, CHAVE_SYNC_REVISAO_BASE, &revisao.to_string())?;
    Ok(())
}

/// Identidade local desta máquina no sync — pasta escolhida, `machine_id` e
/// transporte configurado (FIX B, revisão adversarial 2026-08-11). Capturada
/// ANTES de aplicar um pacote (`aplicar_pacote`/`baixar_e_aplicar`) e regravada
/// DEPOIS: como o pacote agora scruba `CONFIG_NAO_EXPORTAR` inteiro (não só a
/// chave Gemini) e `materializar_banco` troca o `rpg.db` inteiro pelo do
/// pacote, essas chaves simplesmente desaparecem do banco aplicado se
/// ninguém as repuser. O `machine_id`/`sync_transporte` da RECEPTORA nunca
/// podem virar os da emissora por causa de um Baixar/boot-sync — senão volta
/// o mesmo drift que o scrub do FIX B corrigiu do outro lado.
#[derive(Debug, Clone, Default)]
pub struct IdentidadeLocal {
    pub pasta: Option<String>,
    pub machine_id: Option<String>,
    pub transporte: Option<String>,
}

/// Lê a identidade local ANTES de aplicar um pacote (ver [`IdentidadeLocal`]).
pub fn identidade_local_preservar(conn: &Connection) -> Result<IdentidadeLocal, AppError> {
    Ok(IdentidadeLocal {
        pasta: config_get(conn, CHAVE_SYNC_PASTA)?,
        machine_id: config_get(conn, CHAVE_SYNC_MACHINE_ID)?,
        transporte: config_get(conn, CHAVE_SYNC_TRANSPORTE)?,
    })
}

/// Regrava a identidade local DEPOIS de aplicar um pacote (ver
/// [`IdentidadeLocal`]). Só regrava o que já existia antes — uma máquina que
/// nunca teve `sync_transporte`/`sync_machine_id` gravado continua sem, não
/// ganha um valor do nada.
pub fn identidade_local_restaurar(conn: &Connection, identidade: &IdentidadeLocal) -> Result<(), AppError> {
    if let Some(pasta) = &identidade.pasta {
        config_set(conn, CHAVE_SYNC_PASTA, pasta)?;
    }
    if let Some(machine_id) = &identidade.machine_id {
        config_set(conn, CHAVE_SYNC_MACHINE_ID, machine_id)?;
    }
    if let Some(transporte) = &identidade.transporte {
        config_set(conn, CHAVE_SYNC_TRANSPORTE, transporte)?;
    }
    Ok(())
}

/// `datetime('now')` da conexão do SQLite — mesma origem/formato de
/// `atualizado_em`, então comparar strings com [`banco_esta_sujo`] não sofre
/// de deriva de relógio entre o app e o SQLite. `pub` porque `lib.rs` lê isto
/// na Fase 1 (lock breve) de `sync_enviar`, ANTES da rede de `enviar`.
pub fn sqlite_agora(conn: &Connection) -> Result<String, AppError> {
    conn.query_row("SELECT datetime('now')", [], |r| r.get(0)).map_err(AppError::from)
}

/// Valor atual de `sync_revisao` — soma 1 a cada INSERT/UPDATE/DELETE nas
/// tabelas de dado do usuário (triggers da migration `0012_sync_revisao`).
fn revisao_atual(conn: &Connection) -> Result<i64, AppError> {
    conn.query_row("SELECT valor FROM sync_revisao WHERE id = 1", [], |r| r.get(0))
        .map_err(AppError::from)
}

/// "Local sujo" (plano §4, FIX2) = `sync_revisao` avançou desde a última sync
/// bem-sucedida. Substitui a comparação antiga por `MAX(atualizado_em)`, que
/// não pegava DELETE (a linha apagada leva o carimbo junto — um
/// `excluir_personagem` sem Enviar ficava invisível e podia ser ressuscitado
/// por uma sync vinda de outro PC). Leitura pura.
pub fn banco_esta_sujo(conn: &Connection) -> Result<bool, AppError> {
    let atual = revisao_atual(conn)?;
    let base = config_get(conn, CHAVE_SYNC_REVISAO_BASE)?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    Ok(atual != base)
}

fn hash_arquivo(caminho: &Path) -> Result<String, AppError> {
    let bytes = std::fs::read(caminho)?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}

fn epoch_agora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Status pronto pra UI: `sync_status` (plano Fase 1). Contrato TS: campos já
/// em snake_case, `acao` serializa como string minúscula (`"em_dia"` etc.).
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub acao: Acao,
    pub contador_nuvem: Option<i64>,
    pub contador_local: i64,
    pub sujo: bool,
    pub hora: Option<String>,
}

/// Resultado de `sync_enviar`/`sync_baixar`. `sucesso = false` é um caminho
/// normal (guarda leve recusando), não uma falha de Rust — o comando ainda
/// devolve `Ok`, e a UI mostra `mensagem`.
#[derive(Debug, Clone, Serialize)]
pub struct SyncResultado {
    pub sucesso: bool,
    pub mensagem: String,
    pub contador: Option<i64>,
    pub backup: Option<String>,
}

impl SyncResultado {
    fn recusado(mensagem: impl Into<String>) -> Self {
        Self { sucesso: false, mensagem: mensagem.into(), contador: None, backup: None }
    }
}

/// Monta `SyncStatus` combinando carimbo local + manifesto do transporte
/// configurado (se houver pacote nele) + `banco_esta_sujo`, e roda
/// [`decidir_acao`].
///
/// FIX C (revisão adversarial, 2026-08-11): antes lia só `caminho_pacote` de
/// `carimbo.pasta`, o que ignorava o transporte Drive por completo — com
/// Drive configurado, `carimbo.pasta` é `None`, então o status sempre
/// devolvia `SemNuvem` mesmo com um pacote real (e mais novo) do outro lado.
/// A tela Sync mostrava "sem nuvem" e escondia um conflito de verdade. Agora
/// recebe `&dyn Transporte` (mesmo padrão de `planejar_baixar`/
/// `planejar_boot`) e lê o manifesto por ele, pasta ou Drive por igual.
/// Vira `async` por causa disso; o teto de tempo vem do timeout do
/// `reqwest::Client` (FIX A) — não trava o boot/tela mesmo com Drive fora do
/// ar.
///
/// Deadlock de I/O de rede sob o Mutex do banco (docs/plans/2026-08-11-sync-google-drive.md,
/// fix pós-Fase 3): esta função NÃO recebe mais `&Connection` — só
/// `carimbo`/`sujo` já lidos por quem chama. Garantia estrutural: como a
/// assinatura não tem `Connection` em lugar nenhum, é impossível segurar o
/// `MutexGuard<Connection>` do `Db` gerenciado durante o `.await` de rede
/// (`transporte.ler_manifesto()`) daqui pra dentro — o compilador não
/// deixaria compilar um `conn` que este código nem enxerga.
pub async fn status(
    carimbo: &CarimboLocal,
    sujo: bool,
    transporte: &dyn Transporte,
) -> Result<SyncStatus, AppError> {
    let nuvem = transporte.ler_manifesto().await?;
    let acao = decidir_acao(Carimbo { contador: carimbo.contador }, nuvem.as_ref(), sujo);
    Ok(SyncStatus {
        acao,
        contador_nuvem: nuvem.map(|m| m.contador),
        contador_local: carimbo.contador,
        sujo,
        hora: carimbo.hora.clone(),
    })
}

/// O que `enviar` decidiu, devolvido SEM gravar nada no banco — quem chama
/// (`lib.rs`) grava o carimbo (ver [`finalizar_enviar`]) já com o `Mutex` do
/// `Db` travado de novo, DEPOIS que a rede (dentro de `enviar`) já terminou e
/// soltou. `agora` só atravessa esta função de volta pra quem chamou; nunca é
/// lido daqui (ver doc de [`enviar`]).
pub enum PlanoEnvio {
    /// Guarda leve recusou (nada foi publicado); a UI só mostra a mensagem.
    Recusado(SyncResultado),
    /// Publicado com sucesso: o carimbo a gravar e o backup remoto, se houve
    /// (FIX5).
    Enviado { novo_contador: i64, agora: String, backup: Option<String> },
}

/// Envia o estado local pro pacote no transporte configurado (plano §4
/// "Enviar", Fase 3 — transporte abstrai pasta local ou Google Drive). Guarda
/// leve: se o lado remoto já tem contador maior que o local e `forcar` é
/// falso, recusa com o aviso "por cima de algo mais novo"; `forcar=true`
/// sobrescreve mesmo assim (com backup do pacote antigo do lado remoto —
/// FIX5).
///
/// Deadlock de I/O de rede sob o Mutex do banco (docs/plans/2026-08-11-sync-google-drive.md,
/// fix pós-Fase 3): esta função NÃO recebe mais `&Connection` — `carimbo` e
/// `agora` já vêm lidos por quem chama, e ela NÃO grava carimbo nenhum
/// (devolve [`PlanoEnvio`] pra quem chama gravar, com o Mutex travado de novo
/// só depois da rede). Garantia estrutural: sem `Connection` na assinatura, o
/// `MutexGuard` do `Db` gerenciado não pode atravessar o `.await` de rede
/// (`ler_manifesto`/`backup_remoto_se_existir`/`publicar_pacote`) que mora
/// aqui dentro — o compilador não teria como.
pub async fn enviar(
    carimbo: &CarimboLocal,
    agora: &str,
    banco_vivo: &Path,
    imagens_dir: &Path,
    transporte: &dyn Transporte,
    forcar: bool,
) -> Result<PlanoEnvio, AppError> {
    let nuvem = transporte.ler_manifesto().await?;
    let nuvem_mais_nova_que_local = match &nuvem {
        Some(n) => n.contador > carimbo.contador,
        None => false,
    };

    if !forcar && nuvem_mais_nova_que_local {
        return Ok(PlanoEnvio::Recusado(SyncResultado::recusado(format!(
            "enviando por cima de algo mais novo na nuvem (v{})",
            nuvem.expect("nuvem_mais_nova_que_local só é true com nuvem Some").contador
        ))));
    }

    // FIX5: `forcar` por cima de uma nuvem mais nova — backup do pacote atual
    // da nuvem antes de sobrescrever (Q2: backup dos DOIS lados, não só do
    // local em `aplicar_pacote`).
    let backup_nuvem =
        if forcar && nuvem_mais_nova_que_local { transporte.backup_remoto_se_existir().await? } else { None };

    let novo_contador = carimbo.contador.max(nuvem.map(|n| n.contador).unwrap_or(0)) + 1;
    let manifesto = Manifesto {
        contador: novo_contador,
        epoch: epoch_agora(),
        machine_id: carimbo.machine_id.clone().unwrap_or_default(),
        hash_dados: hash_arquivo(banco_vivo)?,
        versao_app: env!("CARGO_PKG_VERSION").to_string(),
        schema_pacote: SCHEMA_PACOTE_ATUAL,
    };

    // FIX1: o `VACUUM INTO` do banco vivo grava a chave Gemini CRUA antes do
    // scrub — `montar_pacote` monta tudo (VACUUM + scrub + imagens +
    // manifesto) num staging LOCAL, fora de qualquer pasta observada por uma
    // nuvem de arquivos, e só DEPOIS de já estar scrubado é que o resultado é
    // publicado pelo transporte (cópia pra pasta, ou upload pro Drive).
    // Staging é limpo em sucesso E em erro.
    let staging_dir = diretorio_staging_local(imagens_dir);
    std::fs::create_dir_all(&staging_dir)?;
    let staging_pacote = staging_dir.join(NOME_PACOTE);
    let resultado = match montar_pacote(banco_vivo, imagens_dir, &staging_pacote, &manifesto) {
        Ok(()) => transporte.publicar_pacote(&staging_pacote).await,
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_file(&staging_pacote);
    let _ = std::fs::remove_file(staging_pacote.with_extension("tmp"));
    resultado?;

    Ok(PlanoEnvio::Enviado { novo_contador, agora: agora.to_string(), backup: backup_nuvem })
}

/// Grava o carimbo local após um `enviar` bem-sucedido e monta o
/// `SyncResultado` — espelha [`finalizar_baixar`]. Chamado por quem chamou
/// `enviar` (`lib.rs`), com o Mutex do `Db` travado de novo (rede já
/// terminou).
pub fn finalizar_enviar(
    conn: &Connection,
    novo_contador: i64,
    agora: &str,
    backup: Option<String>,
) -> Result<SyncResultado, AppError> {
    carimbo_gravar(conn, novo_contador, agora)?;
    Ok(SyncResultado {
        sucesso: true,
        mensagem: format!("enviado (v{novo_contador})"),
        contador: Some(novo_contador),
        backup,
    })
}

/// Diretório de staging LOCAL (nunca dentro da pasta da nuvem) onde o pacote
/// é montado por inteiro antes de ser publicado (FIX1). Usa um subdiretório
/// do app_data (pai de `imagens_dir`, mesmo diretório do banco vivo) quando
/// dá pra descobrir; cai pro temp do SO senão.
fn diretorio_staging_local(imagens_dir: &Path) -> PathBuf {
    match imagens_dir.parent() {
        Some(app_data) => app_data.join("sync_tmp"),
        None => std::env::temp_dir().join("rpgv2_sync_tmp"),
    }
}

/// Copia o pacote JÁ MONTADO E SCRUBADO do staging local pra dentro da pasta
/// da nuvem, via tmp+rename (mesmo padrão de `copiar_atomico` em
/// `semente.rs`). Diferente do staging, esse `.tmp` fica visível pra nuvem —
/// mas como o conteúdo já passou pelo scrub, não há mais byte cru em jogo.
fn publicar_pacote_na_nuvem(pacote_local: &Path, destino: &Path) -> Result<(), AppError> {
    let tmp = destino.with_extension("tmp");
    let resultado = std::fs::copy(pacote_local, &tmp).and_then(|_| std::fs::rename(&tmp, destino));
    if resultado.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    resultado.map_err(AppError::from)
}

/// O que `sync_baixar` deve fazer, decidido ANTES de qualquer I/O de
/// substituição — separa a decisão (pura, testável) da aplicação (que em
/// `lib.rs` precisa fechar/reabrir a conexão viva antes do `rename`).
pub enum PlanoBaixar {
    /// Guarda leve recusou (nada a aplicar); a UI só mostra a mensagem.
    Recusar(SyncResultado),
    /// Pode aplicar: o manifesto que será gravado no carimbo após aplicar.
    Aplicar(Manifesto),
}

/// Decide o plano de Baixar (plano §4 "Baixar (manual)", Fase 3 — transporte
/// abstrai pasta local ou Google Drive): sem pacote remoto, já em dia, local
/// mais novo, ou sujo (conflito) recusam; senão libera aplicar. `forcar=true`
/// pula todas as guardas exceto "sem pacote".
///
/// Deadlock de I/O de rede sob o Mutex do banco (docs/plans/2026-08-11-sync-google-drive.md,
/// fix pós-Fase 3): esta função NÃO recebe mais `&Connection` — `carimbo` e
/// `sujo` já vêm lidos por quem chama. Garantia estrutural: sem `Connection`
/// na assinatura, o `MutexGuard` do `Db` gerenciado não pode atravessar o
/// `.await` de rede (`ler_manifesto`) que mora aqui dentro.
pub async fn planejar_baixar(
    carimbo: &CarimboLocal,
    sujo: bool,
    transporte: &dyn Transporte,
    forcar: bool,
) -> Result<PlanoBaixar, AppError> {
    let Some(nuvem) = transporte.ler_manifesto().await? else {
        return Ok(PlanoBaixar::Recusar(SyncResultado::recusado("nenhum pacote na nuvem ainda")));
    };
    if forcar {
        return Ok(PlanoBaixar::Aplicar(nuvem));
    }

    // Roteia pela MESMA `decidir_acao` do boot (`planejar_boot`). Antes havia
    // lógica de conflito duplicada aqui, que não passava pelo caso
    // `contador==0` do FIX4 — a primeira sync manual (máquina nova, semente
    // marca "sujo") caía em falso conflito. Uma fonte só pros dois caminhos.
    match decidir_acao(Carimbo { contador: carimbo.contador }, Some(&nuvem), sujo) {
        Acao::NuvemMaisNova => Ok(PlanoBaixar::Aplicar(nuvem)),
        Acao::Conflito => Ok(PlanoBaixar::Recusar(SyncResultado::recusado(format!(
            "nuvem tem v{} mais nova, mas há mudanças locais não enviadas",
            nuvem.contador
        )))),
        Acao::EmDia => Ok(PlanoBaixar::Recusar(SyncResultado::recusado("já está em dia"))),
        Acao::LocalMaisNovo => Ok(PlanoBaixar::Recusar(SyncResultado::recusado(format!(
            "local já está mais novo (v{})",
            carimbo.contador
        )))),
        // `transporte.ler_manifesto()` acima já garantiu pacote remoto —
        // `SemNuvem` é inalcançável aqui; tratado só por exaustividade do match.
        Acao::SemNuvem => {
            Ok(PlanoBaixar::Recusar(SyncResultado::recusado("nenhum pacote na nuvem ainda")))
        }
    }
}

/// O que a verificação de boot encontrou na nuvem — mesma separação
/// decisão/aplicação de [`PlanoBaixar`], só que aqui NENHUMA das variantes
/// aplica: o boot virou aviso puro (ver [`EventoBootSync`]). `Conflito` e
/// `NuvemMaisNova` diferem só na mensagem que a UI mostra.
pub enum PlanoBoot {
    /// Sem pacote no transporte, em dia, ou local mais novo: nada a avisar.
    /// ("Sem transporte configurado" é decidido por quem CHAMA — ver
    /// `lib.rs::montar_transporte` — antes mesmo de existir um `&dyn
    /// Transporte` pra passar aqui.)
    Nenhum,
    /// Nuvem mais nova e local limpo: baixar não perderia nada.
    NuvemMaisNova(Manifesto),
    /// Nuvem mais nova mas local sujo: baixar sobrescreveria mudanças deste
    /// PC — a UI avisa com texto mais forte.
    Conflito(Manifesto),
}

/// Decide o que o boot vai AVISAR (plano §4, Fase 3 — transporte abstrai
/// pasta local ou Google Drive): lê o manifesto remoto se houver pacote lá, e
/// roda [`decidir_acao`]. Não aplica nada — só decide. Espelha
/// `planejar_baixar`, mas sem `forcar` (o boot nunca força) e mapeando
/// `Conflito` pro seu próprio caso em vez de recusar com mensagem.
///
/// Mesma garantia estrutural de [`planejar_baixar`]/[`status`]/[`enviar`]:
/// não recebe `&Connection`, então o `.await` de rede (`ler_manifesto`) não
/// pode acontecer com o `MutexGuard` do `Db` travado.
pub async fn planejar_boot(
    carimbo: &CarimboLocal,
    sujo: bool,
    transporte: &dyn Transporte,
) -> Result<PlanoBoot, AppError> {
    let Some(nuvem) = transporte.ler_manifesto().await? else {
        return Ok(PlanoBoot::Nenhum);
    };
    match decidir_acao(Carimbo { contador: carimbo.contador }, Some(&nuvem), sujo) {
        Acao::NuvemMaisNova => Ok(PlanoBoot::NuvemMaisNova(nuvem)),
        Acao::Conflito => Ok(PlanoBoot::Conflito(nuvem)),
        Acao::EmDia | Acao::LocalMaisNovo | Acao::SemNuvem => Ok(PlanoBoot::Nenhum),
    }
}

/// O que a verificação de boot ENCONTROU — nunca o que ela fez: desde
/// 2026-08-11 (pedido do usuário: "só sincroniza quando eu apertar enviar ou
/// baixar") o boot não move dado nenhum, só lê o manifesto remoto e avisa. As
/// duas variantes abaixo viram o mesmo banner discreto no topo
/// (`SyncBootDriver`), que manda o usuário até a tela Sincronização.
/// `tipo` é o discriminante no JSON (`#[serde(tag = "tipo")]`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum EventoBootSync {
    /// Nada a avisar (sem pasta, sem pacote, em dia, ou local mais novo).
    Nenhum,
    /// Nuvem mais nova + local limpo: dá pra baixar sem perder nada, mas quem
    /// aperta Baixar é o usuário.
    NuvemMaisNova { contador: i64 },
    /// Nuvem mais nova + local sujo: baixar sobrescreveria mudanças deste PC.
    ConflitoPendente { contador_nuvem: i64 },
}

/// Grava o carimbo local após um `aplicar_pacote` bem-sucedido e monta o
/// `SyncResultado` (o `backup`, se houve, é preenchido por quem chama, que é
/// quem sabe o caminho devolvido por `aplicar_pacote`).
pub fn finalizar_baixar(
    conn: &Connection,
    manifesto: &Manifesto,
    backup: Option<PathBuf>,
) -> Result<SyncResultado, AppError> {
    let agora = sqlite_agora(conn)?;
    carimbo_gravar(conn, manifesto.contador, &agora)?;
    Ok(SyncResultado {
        sucesso: true,
        mensagem: format!("baixado (v{})", manifesto.contador),
        contador: Some(manifesto.contador),
        backup: backup.map(|p| p.display().to_string()),
    })
}

/// Baixa o pacote do transporte para um arquivo temporário DENTRO de
/// `diretorio_staging` (local, nunca a pasta/API remota) e aplica sobre
/// `banco_destino`/`imagens_dir` via [`aplicar_pacote`] — que continua
/// intocado, só recebe o temp em vez do caminho direto na pasta da nuvem.
/// Usado por `sync_baixar`/boot depois que `planejar_baixar`/`planejar_boot`
/// já liberou `Aplicar`. O temp é sempre removido, em sucesso ou erro.
pub async fn baixar_e_aplicar(
    transporte: &dyn Transporte,
    diretorio_staging: &Path,
    banco_destino: &Path,
    imagens_dir: &Path,
) -> Result<Option<PathBuf>, AppError> {
    std::fs::create_dir_all(diretorio_staging)?;
    let temp_pacote = diretorio_staging.join(format!("{NOME_PACOTE}.baixado"));
    let resultado = transporte.baixar_pacote_para(&temp_pacote).await;
    let resultado = resultado.and_then(|()| aplicar_pacote(&temp_pacote, banco_destino, imagens_dir));
    let _ = std::fs::remove_file(&temp_pacote);
    resultado
}

/// Monta o pacote em `destino` a partir do banco vivo em `banco_vivo` e das
/// imagens em `imagens_dir`. Gravação atômica (`<destino>.tmp` + rename).
pub fn montar_pacote(
    banco_vivo: &Path,
    imagens_dir: &Path,
    destino: &Path,
    manifesto: &Manifesto,
) -> Result<(), AppError> {
    let tmp = destino.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);

    // VACUUM INTO: snapshot consistente do banco vivo, mesmo com o app aberto
    // (mesmo mecanismo de `exportar_semente.rs::exportar_banco`).
    {
        let origem = Connection::open_with_flags(banco_vivo, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let tmp_str = tmp.to_str().ok_or_else(|| AppError::Msg("caminho tmp não-UTF8".into()))?;
        origem.execute("VACUUM INTO ?1", [tmp_str])?;
    }

    let pacote = Connection::open(&tmp)?;
    // `secure_delete` zera os bytes no DELETE, senão a chave Gemini apagada
    // continuaria legível nas páginas livres do arquivo até o VACUUM final.
    pacote.pragma_update(None, "secure_delete", "ON")?;
    // FIX B (revisão adversarial, 2026-08-11): scrub tinha que cobrir
    // `CONFIG_NAO_EXPORTAR` (gemini + o carimbo local inteiro), não só a
    // chave Gemini — senão `sync_pasta`/`sync_machine_id`/`sync_transporte`
    // da máquina EMISSORA viajavam dentro do pacote e, ao aplicar do lado da
    // receptora, sobrescreviam o carimbo dela: drift silencioso (o
    // transporte/pasta local mudava sozinho) e `machine_id` colidido entre
    // PCs. `config_local_preservar`/`config_local_restaurar` (lib.rs) cuidam
    // de a receptora manter o SEU carimbo depois de aplicar.
    for chave in CONFIG_NAO_EXPORTAR {
        pacote.execute("DELETE FROM config WHERE chave = ?1", [chave])?;
    }
    embutir_imagens(&pacote, imagens_dir)?;
    gravar_manifesto(&pacote, manifesto)?;
    pacote.execute("VACUUM", [])?;
    drop(pacote);

    std::fs::rename(&tmp, destino)?;
    Ok(())
}

fn embutir_imagens(pacote: &Connection, imagens_dir: &Path) -> Result<(), AppError> {
    pacote.execute("CREATE TABLE _pacote_imagem (nome TEXT PRIMARY KEY, bytes BLOB NOT NULL)", [])?;
    if !imagens_dir.is_dir() {
        return Ok(());
    }
    for entrada in std::fs::read_dir(imagens_dir)? {
        let entrada = entrada?;
        if !entrada.file_type()?.is_file() {
            continue;
        }
        let nome = entrada.file_name().to_string_lossy().into_owned();
        let bytes = std::fs::read(entrada.path())?;
        pacote.execute("INSERT INTO _pacote_imagem (nome, bytes) VALUES (?1, ?2)", params![nome, bytes])?;
    }
    Ok(())
}

fn gravar_manifesto(pacote: &Connection, m: &Manifesto) -> Result<(), AppError> {
    pacote.execute(
        "CREATE TABLE _pacote_manifesto (
            contador      INTEGER NOT NULL,
            epoch         INTEGER NOT NULL,
            machine_id    TEXT NOT NULL,
            hash_dados    TEXT NOT NULL,
            versao_app    TEXT NOT NULL,
            schema_pacote INTEGER NOT NULL
        )",
        [],
    )?;
    pacote.execute(
        "INSERT INTO _pacote_manifesto
         (contador, epoch, machine_id, hash_dados, versao_app, schema_pacote)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![m.contador, m.epoch, m.machine_id, m.hash_dados, m.versao_app, m.schema_pacote],
    )?;
    Ok(())
}

/// Lê só o carimbo do pacote, sem tocar em mais nada — serve pra `sync_status`
/// decidir a ação antes de aplicar qualquer coisa.
pub fn ler_manifesto(pacote: &Path) -> Result<Manifesto, AppError> {
    let conn = Connection::open_with_flags(pacote, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.query_row(
        "SELECT contador, epoch, machine_id, hash_dados, versao_app, schema_pacote
         FROM _pacote_manifesto",
        [],
        |r| {
            Ok(Manifesto {
                contador: r.get(0)?,
                epoch: r.get(1)?,
                machine_id: r.get(2)?,
                hash_dados: r.get(3)?,
                versao_app: r.get(4)?,
                schema_pacote: r.get(5)?,
            })
        },
    )
    .map_err(AppError::from)
}

/// Aplica `pacote` sobre `banco_destino`: checa a versão do formato
/// (FIX7 — recusa em vez de falhar obscuro num pacote futuro incompatível),
/// faz backup do banco atual (se existir; devolve o caminho), extrai as
/// imagens de forma ADITIVA e materializa um `rpg.db` limpo a partir do
/// pacote. Rename atômico no final.
pub fn aplicar_pacote(
    pacote: &Path,
    banco_destino: &Path,
    imagens_dir: &Path,
) -> Result<Option<PathBuf>, AppError> {
    let manifesto = ler_manifesto(pacote)?;
    if manifesto.schema_pacote != SCHEMA_PACOTE_ATUAL {
        return Err(AppError::Msg(format!(
            "pacote em formato incompatível (schema {}, este app entende até {}) — atualize o app antes de sincronizar",
            manifesto.schema_pacote, SCHEMA_PACOTE_ATUAL
        )));
    }

    let backup = if banco_destino.exists() {
        let alvo = caminho_backup_sync(banco_destino);
        std::fs::copy(banco_destino, &alvo)?;
        Some(alvo)
    } else {
        None
    };

    extrair_imagens(pacote, imagens_dir)?;
    materializar_banco(pacote, banco_destino)?;

    Ok(backup)
}

/// `rpg.db.bak-sync-<epoch_segundos>` ao lado do banco — mesmo padrão de nome
/// de `semente.rs` (era `caminho_backup`, específico de versão de instalador;
/// aqui não há "versão", então o marcador é `sync`).
fn caminho_backup_sync(banco: &Path) -> PathBuf {
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut nome = banco.as_os_str().to_os_string();
    nome.push(format!(".bak-sync-{epoch}"));
    PathBuf::from(nome)
}

/// Copia pra `imagens_dir` os BLOBs de `_pacote_imagem` cujo nome ainda não
/// existe lá. Nomes são sha256 do conteúdo (contrato de `db::imagens`), então
/// nunca sobrescreve nem apaga — imagem órfã no destino é inofensiva.
fn extrair_imagens(pacote: &Path, imagens_dir: &Path) -> Result<(), AppError> {
    let conn = Connection::open_with_flags(pacote, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let tem_tabela: bool = conn.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = '_pacote_imagem'",
        [],
        |r| r.get(0),
    )?;
    if !tem_tabela {
        return Ok(());
    }
    std::fs::create_dir_all(imagens_dir)?;
    let mut stmt = conn.prepare("SELECT nome, bytes FROM _pacote_imagem")?;
    let linhas = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))?;
    for linha in linhas {
        let (nome, bytes) = linha?;
        let alvo = imagens_dir.join(&nome);
        if !alvo.exists() {
            escrever_atomico(&alvo, &bytes)?;
        }
    }
    Ok(())
}

/// Escreve `bytes` em `alvo` via tmp+rename (FIX3 — mesmo padrão de
/// `copiar_atomico` em `semente.rs`). Sem isso, um crash no meio do
/// `fs::write` deixa um arquivo com o nome final (sha256 do conteúdo
/// completo) mas conteúdo truncado — e como `extrair_imagens` só checa
/// `exists()`, nunca seria reparado.
fn escrever_atomico(alvo: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let tmp = alvo.with_extension("tmp");
    let resultado = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, alvo));
    if resultado.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    resultado.map_err(AppError::from)
}

/// Copia `pacote` pra um tmp ao lado de `banco_destino`, derruba as tabelas
/// de controle (`_pacote_*`) que não fazem parte do schema do app, compacta
/// com `VACUUM` e faz rename atômico por cima de `banco_destino`.
fn materializar_banco(pacote: &Path, banco_destino: &Path) -> Result<(), AppError> {
    let tmp = banco_destino.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(pacote, &tmp)?;

    let conn = Connection::open(&tmp)?;
    conn.execute("DROP TABLE IF EXISTS _pacote_imagem", [])?;
    conn.execute("DROP TABLE IF EXISTS _pacote_manifesto", [])?;
    conn.execute("VACUUM", [])?;
    drop(conn);

    // Um WAL/SHM órfão apontando pro banco antigo corromperia o banco novo
    // na próxima abertura (mesma cautela de `semente.rs::limpar_wal_orfao`).
    for sufixo in ["-wal", "-shm"] {
        let mut nome = banco_destino.as_os_str().to_os_string();
        nome.push(sufixo);
        let _ = std::fs::remove_file(PathBuf::from(nome));
    }

    std::fs::rename(&tmp, banco_destino)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;

    fn dir_teste(sufixo: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rpgv2_test_sync_nuvem_{sufixo}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifesto_teste(contador: i64) -> Manifesto {
        Manifesto {
            contador,
            epoch: 1_700_000_000,
            machine_id: "pc-teste".into(),
            hash_dados: "hash-fake".into(),
            versao_app: "0.3.0".into(),
            schema_pacote: 1,
        }
    }

    /// Roda um futuro do núcleo assíncrono (Fase 3) até completar, num
    /// runtime de thread única — mesma técnica do teste de integração
    /// `#[ignore]` de `google::drive` (prova que a feature `rt` do tokio já
    /// está disponível por unificação, mesmo o `Cargo.toml` deste crate só
    /// pedindo `sync`+`time`). `TransportePasta` e `FakeTransporte` não têm
    /// ponto de suspensão real (só disco/memória) — isto só dá um executor
    /// pro `.await`.
    fn bloquear<F: Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime tokio de teste")
            .block_on(fut)
    }

    /// Transporte FAKE em memória (item 5 do plano — "TransporteDrive com um
    /// FAKE in-memory do trait, sem rede real"): o "pacote remoto" é só um
    /// `Vec<u8>` atrás de um `Mutex`, nunca um arquivo num diretório
    /// observado. Cobre o mesmo contrato que `TransporteDrive` cobre —
    /// manifesto/download/upload/backup só acessíveis via materialização em
    /// temp local — sem precisar de rede nem mockar HTTP.
    struct FakeTransporte {
        remoto: Mutex<Option<Vec<u8>>>,
        dir_local: PathBuf,
        contador_temp: Mutex<u64>,
    }

    impl FakeTransporte {
        fn vazio(dir_local: impl Into<PathBuf>) -> Self {
            Self { remoto: Mutex::new(None), dir_local: dir_local.into(), contador_temp: Mutex::new(0) }
        }

        fn temp(&self) -> PathBuf {
            let mut n = self.contador_temp.lock().unwrap_or_else(PoisonError::into_inner);
            *n += 1;
            self.dir_local.join(format!("fake_transporte_{n}.rpgpack"))
        }
    }

    impl Transporte for FakeTransporte {
        fn ler_manifesto(&self) -> RespostaTransporte<'_, Option<Manifesto>> {
            Box::pin(async move {
                let bytes = self.remoto.lock().unwrap_or_else(PoisonError::into_inner).clone();
                let Some(bytes) = bytes else {
                    return Ok(None);
                };
                std::fs::create_dir_all(&self.dir_local)?;
                let temp = self.temp();
                std::fs::write(&temp, &bytes)?;
                let manifesto = ler_manifesto(&temp);
                let _ = std::fs::remove_file(&temp);
                manifesto.map(Some)
            })
        }

        fn baixar_pacote_para<'a>(&'a self, destino_temp: &'a Path) -> RespostaTransporte<'a, ()> {
            Box::pin(async move {
                let bytes = self.remoto.lock().unwrap_or_else(PoisonError::into_inner).clone();
                let bytes = bytes.ok_or_else(|| AppError::Msg("fake: nenhum pacote remoto ainda".into()))?;
                std::fs::write(destino_temp, bytes).map_err(AppError::from)
            })
        }

        fn publicar_pacote<'a>(&'a self, origem_temp: &'a Path) -> RespostaTransporte<'a, ()> {
            Box::pin(async move {
                let bytes = std::fs::read(origem_temp)?;
                *self.remoto.lock().unwrap_or_else(PoisonError::into_inner) = Some(bytes);
                Ok(())
            })
        }

        fn backup_remoto_se_existir(&self) -> RespostaTransporte<'_, Option<String>> {
            Box::pin(async move {
                let bytes = self.remoto.lock().unwrap_or_else(PoisonError::into_inner).clone();
                let Some(bytes) = bytes else {
                    return Ok(None);
                };
                std::fs::create_dir_all(&self.dir_local)?;
                let alvo = self.dir_local.join(format!("fake.bak-sync-{}", epoch_agora()));
                std::fs::write(&alvo, bytes)?;
                Ok(Some(alvo.display().to_string()))
            })
        }
    }

    /// Helpers de teste que espelham o faseamento do Mutex que `lib.rs` faz
    /// nos comandos reais (fix pós-Fase 3,
    /// docs/plans/2026-08-11-sync-google-drive.md): lê `carimbo`/`sujo` do
    /// `conn` de teste (Fase 1 — "lock breve"), chama a função async que NÃO
    /// recebe mais `Connection` (Fase 2 — "rede sem lock"), e grava o carimbo
    /// no fim quando aplicável (Fase 3 — "lock breve" de novo). Existem só
    /// pra manter os testes de comportamento legíveis; a garantia estrutural
    /// em si (rede sem `Connection` na assinatura) já está provada pelo
    /// próprio `enviar`/`status`/`planejar_baixar`/`planejar_boot` compilarem
    /// sem o parâmetro.
    fn status_teste(conn: &Connection, transporte: &dyn Transporte) -> SyncStatus {
        let carimbo = carimbo_ler(conn).unwrap();
        let sujo = banco_esta_sujo(conn).unwrap();
        bloquear(status(&carimbo, sujo, transporte)).unwrap()
    }

    fn enviar_teste(
        conn: &Connection,
        banco_vivo: &Path,
        imagens_dir: &Path,
        transporte: &dyn Transporte,
        forcar: bool,
    ) -> SyncResultado {
        let carimbo = carimbo_ler(conn).unwrap();
        let agora = sqlite_agora(conn).unwrap();
        match bloquear(enviar(&carimbo, &agora, banco_vivo, imagens_dir, transporte, forcar)).unwrap() {
            PlanoEnvio::Recusado(r) => r,
            PlanoEnvio::Enviado { novo_contador, agora, backup } => {
                finalizar_enviar(conn, novo_contador, &agora, backup).unwrap()
            }
        }
    }

    fn planejar_baixar_teste(conn: &Connection, transporte: &dyn Transporte, forcar: bool) -> PlanoBaixar {
        let carimbo = carimbo_ler(conn).unwrap();
        let sujo = banco_esta_sujo(conn).unwrap();
        bloquear(planejar_baixar(&carimbo, sujo, transporte, forcar)).unwrap()
    }

    fn planejar_boot_teste(conn: &Connection, transporte: &dyn Transporte) -> PlanoBoot {
        let carimbo = carimbo_ler(conn).unwrap();
        let sujo = banco_esta_sujo(conn).unwrap();
        bloquear(planejar_boot(&carimbo, sujo, transporte)).unwrap()
    }

    /* ------------------------------ decidir_acao ------------------------------ */

    #[test]
    fn decidir_acao_cobre_toda_a_matriz_contador_x_sujo() {
        let m = |c| manifesto_teste(c);

        // sem pacote na nuvem: sempre SemNuvem, independente de sujo/contador.
        assert_eq!(decidir_acao(Carimbo { contador: 0 }, None, false), Acao::SemNuvem);
        assert_eq!(decidir_acao(Carimbo { contador: 5 }, None, true), Acao::SemNuvem);

        // mesmo contador dos dois lados: em dia, sujo não muda nada (é o
        // mesmo pacote que já está aplicado).
        assert_eq!(decidir_acao(Carimbo { contador: 3 }, Some(&m(3)), false), Acao::EmDia);
        assert_eq!(decidir_acao(Carimbo { contador: 3 }, Some(&m(3)), true), Acao::EmDia);

        // nuvem mais nova + local limpo: pode baixar sozinho.
        assert_eq!(decidir_acao(Carimbo { contador: 2 }, Some(&m(3)), false), Acao::NuvemMaisNova);
        // primeira sync (contador local 0): mesmo caminho.
        assert_eq!(decidir_acao(Carimbo { contador: 0 }, Some(&m(1)), false), Acao::NuvemMaisNova);
        // FIX4: contador local 0 + local "sujo" (dado do bootstrap da semente,
        // sem baseline pra comparar) também aplica direto — não há o que
        // conflitar, o backup em aplicar_pacote protege.
        assert_eq!(decidir_acao(Carimbo { contador: 0 }, Some(&m(1)), true), Acao::NuvemMaisNova);

        // nuvem mais nova + local sujo (contador > 0, já tem baseline):
        // conflito, nunca decide sozinho.
        assert_eq!(decidir_acao(Carimbo { contador: 2 }, Some(&m(3)), true), Acao::Conflito);

        // local mais novo (este PC já enviou depois do que a nuvem tem):
        // nada a baixar, sujo não entra na conta (não há o que baixar).
        assert_eq!(decidir_acao(Carimbo { contador: 5 }, Some(&m(3)), false), Acao::LocalMaisNovo);
        assert_eq!(decidir_acao(Carimbo { contador: 5 }, Some(&m(3)), true), Acao::LocalMaisNovo);
    }

    /* -------------------------------- round-trip ------------------------------- */

    fn preparar_banco_vivo(caminho: &Path) {
        let conn = crate::db::connection::open(caminho).unwrap();
        conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Teste Sync')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO config (chave, valor) VALUES ('gemini_api_keys', 'chave-secreta-nao-pode-viajar')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO config (chave, valor) VALUES ('canal_discord', '123456')", [])
            .unwrap();
    }

    #[test]
    fn round_trip_preserva_dado_scruba_gemini_e_leva_imagens() {
        let raiz = dir_teste("round_trip");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);

        let imagens_origem = raiz.join("images_origem");
        std::fs::create_dir_all(&imagens_origem).unwrap();
        std::fs::write(imagens_origem.join("retrato.png"), b"bytes do retrato").unwrap();

        let pacote = raiz.join("rpg-estado.rpgpack");
        montar_pacote(&banco_vivo, &imagens_origem, &pacote, &manifesto_teste(1)).unwrap();

        // manifesto lido sem aplicar nada.
        let lido = ler_manifesto(&pacote).unwrap();
        assert_eq!(lido, manifesto_teste(1));

        // aplica num destino novo (máquina B).
        let banco_destino = raiz.join("app_data").join("rpg.db");
        let imagens_destino = raiz.join("app_data").join("images");
        std::fs::create_dir_all(banco_destino.parent().unwrap()).unwrap();
        let backup = aplicar_pacote(&pacote, &banco_destino, &imagens_destino).unwrap();
        assert!(backup.is_none(), "banco destino não existia: sem o que fazer backup");

        let conn = crate::db::connection::open(&banco_destino).unwrap();
        let nome: String = conn
            .query_row("SELECT nome FROM personagem WHERE tipo='npc'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(nome, "Teste Sync");

        // Gemini nunca viajou.
        let gemini: Option<String> = conn
            .query_row("SELECT valor FROM config WHERE chave='gemini_api_keys'", [], |r| r.get(0))
            .optional()
            .unwrap();
        assert_eq!(gemini, None, "chave Gemini deve estar ausente no pacote/aplicado");

        // outra config não-segredo sobrevive normalmente.
        let canal: String = conn
            .query_row("SELECT valor FROM config WHERE chave='canal_discord'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(canal, "123456");

        // tabelas de controle do pacote não vazam pro banco aplicado.
        let tabelas_de_controle: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE '\\_pacote\\_%' ESCAPE '\\'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tabelas_de_controle, 0);

        // imagem embutida chegou no destino.
        assert_eq!(
            std::fs::read(imagens_destino.join("retrato.png")).unwrap(),
            b"bytes do retrato"
        );
    }

    #[test]
    fn aplicar_pacote_faz_backup_quando_ja_havia_banco_no_destino() {
        let raiz = dir_teste("backup");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);
        let pacote = raiz.join("rpg-estado.rpgpack");
        montar_pacote(&banco_vivo, &raiz.join("sem_imagens"), &pacote, &manifesto_teste(2)).unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        std::fs::create_dir_all(banco_destino.parent().unwrap()).unwrap();
        std::fs::write(&banco_destino, b"banco anterior do destino").unwrap();

        let backup = aplicar_pacote(&pacote, &banco_destino, &raiz.join("app_data").join("images")).unwrap();

        let backup = backup.expect("banco destino já existia: precisa de backup");
        assert_eq!(std::fs::read(&backup).unwrap(), b"banco anterior do destino");
        assert_ne!(std::fs::read(&banco_destino).unwrap(), b"banco anterior do destino");
    }

    #[test]
    fn extrair_imagens_e_aditivo_nunca_sobrescreve() {
        let raiz = dir_teste("imagens_aditivo");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);

        let imagens_origem = raiz.join("images_origem");
        std::fs::create_dir_all(&imagens_origem).unwrap();
        std::fs::write(imagens_origem.join("existente.png"), b"conteudo do pacote").unwrap();
        std::fs::write(imagens_origem.join("nova.png"), b"imagem nova do pacote").unwrap();

        let pacote = raiz.join("rpg-estado.rpgpack");
        montar_pacote(&banco_vivo, &imagens_origem, &pacote, &manifesto_teste(1)).unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        let imagens_destino = raiz.join("app_data").join("images");
        std::fs::create_dir_all(&imagens_destino).unwrap();
        std::fs::write(imagens_destino.join("existente.png"), b"conteudo local, mais novo").unwrap();

        aplicar_pacote(&pacote, &banco_destino, &imagens_destino).unwrap();

        assert_eq!(
            std::fs::read(imagens_destino.join("existente.png")).unwrap(),
            b"conteudo local, mais novo",
            "imagem local não pode ser sobrescrita pela do pacote"
        );
        assert_eq!(
            std::fs::read(imagens_destino.join("nova.png")).unwrap(),
            b"imagem nova do pacote"
        );
    }

    /* --------------------------- Fase 1: comandos --------------------------- */

    /// `app_data` isolado com banco já migrado — mesmo padrão dos testes de
    /// comando de `semente.rs` (`mod tests`, linha ~219-247).
    fn app_data_teste(sufixo: &str) -> (PathBuf, Connection) {
        let raiz = dir_teste(&format!("fase1_{sufixo}"));
        let banco = raiz.join("app_data").join("rpg.db");
        std::fs::create_dir_all(banco.parent().unwrap()).unwrap();
        let conn = crate::db::connection::open(&banco).unwrap();
        (raiz, conn)
    }

    #[test]
    fn gerar_machine_id_nao_repete_entre_chamadas() {
        let a = gerar_machine_id();
        let b = gerar_machine_id();
        assert_ne!(a, b);
        assert!(!a.is_empty());
    }

    #[test]
    fn carimbo_ler_sem_nada_gravado_devolve_default() {
        let (_raiz, conn) = app_data_teste("carimbo_vazio");
        let c = carimbo_ler(&conn).unwrap();
        assert_eq!(c.contador, 0);
        assert_eq!(c.pasta, None);
        assert_eq!(c.machine_id, None);
        assert_eq!(c.hora, None);
    }

    #[test]
    fn carimbo_gravar_e_depois_ler_faz_round_trip() {
        let (_raiz, conn) = app_data_teste("carimbo_round_trip");
        carimbo_gravar(&conn, 7, "2026-08-10 12:00:00").unwrap();
        let c = carimbo_ler(&conn).unwrap();
        assert_eq!(c.contador, 7);
        assert_eq!(c.hora.as_deref(), Some("2026-08-10 12:00:00"));
    }

    #[test]
    fn banco_esta_sujo_usa_o_contador_de_revisao_como_baseline() {
        let (_raiz, conn) = app_data_teste("sujo");
        // sem baseline gravada e sem nenhuma edição: revisão atual (0) ==
        // base default (0) -> não sujo.
        assert!(!banco_esta_sujo(&conn).unwrap());

        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();
        assert!(banco_esta_sujo(&conn).unwrap(), "revisão avançou (INSERT), deve marcar sujo");

        carimbo_gravar(&conn, 1, "2026-08-10 12:00:00").unwrap();
        assert!(!banco_esta_sujo(&conn).unwrap(), "logo após gravar carimbo, baseline == revisão atual");
    }

    /// FIX2: `MAX(atualizado_em)` sozinho não pegava DELETE (a linha some, o
    /// carimbo some junto) — o contador de revisão soma em qualquer mudança,
    /// inclusive apagar.
    #[test]
    fn banco_esta_sujo_detecta_delete_que_atualizado_em_nao_pegava() {
        let (_raiz, conn) = app_data_teste("sujo_delete");
        conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Sanji')", []).unwrap();
        carimbo_gravar(&conn, 1, "2026-08-10 12:00:00").unwrap();
        assert!(!banco_esta_sujo(&conn).unwrap(), "logo após sync, sem sujeira");

        conn.execute("DELETE FROM personagem WHERE nome = 'Sanji'", []).unwrap();

        assert!(banco_esta_sujo(&conn).unwrap(), "DELETE sem Enviar deve marcar sujo");
    }

    #[test]
    fn status_sem_pasta_e_sem_dado_e_sem_nuvem() {
        let (raiz, conn) = app_data_teste("status_sem_nuvem");
        let s = status_teste(&conn, &TransportePasta::new(raiz.join("nuvem")));
        assert_eq!(s.acao, Acao::SemNuvem);
        assert_eq!(s.contador_local, 0);
        assert_eq!(s.contador_nuvem, None);
    }

    /// FIX C (revisão adversarial, 2026-08-11): antes, `status()` só lia
    /// `carimbo.pasta` — com transporte Drive, essa coluna é sempre `None`
    /// (não existe pasta local nenhuma), então o status mentia "sem nuvem"
    /// mesmo com um pacote real do outro lado. Usa `FakeTransporte` (mesmo
    /// contrato que `TransporteDrive` cobre: manifesto só via
    /// materialização, nunca um caminho de arquivo local) pra provar que o
    /// status agora enxerga esse pacote.
    #[test]
    fn status_enxerga_pacote_num_transporte_sem_pasta_local() {
        let (raiz, conn) = app_data_teste("status_drive");
        let transporte = FakeTransporte::vazio(raiz.join("fake_local"));
        // Ninguém gravou `carimbo.pasta` nesta máquina (é o caso real do
        // transporte Drive): confirma a pré-condição do bug.
        assert_eq!(carimbo_ler(&conn).unwrap().pasta, None);

        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pacote = raiz.join("staging.rpgpack");
        montar_pacote(&banco_vivo, &imagens, &pacote, &manifesto_teste(4)).unwrap();
        bloquear(transporte.publicar_pacote(&pacote)).unwrap();

        let s = status_teste(&conn, &transporte);
        assert_eq!(s.acao, Acao::NuvemMaisNova, "pacote real no transporte não pode virar SemNuvem");
        assert_eq!(s.contador_nuvem, Some(4));
    }

    #[test]
    fn enviar_grava_pacote_e_avanca_contador() {
        let (raiz, conn) = app_data_teste("enviar_ok");
        conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Zoro')", []).unwrap();
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pasta_nuvem = raiz.join("nuvem");

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &TransportePasta::new(&pasta_nuvem), false);

        assert!(r.sucesso);
        assert_eq!(r.contador, Some(1));
        assert!(caminho_pacote(&pasta_nuvem).exists());
        assert_eq!(carimbo_ler(&conn).unwrap().contador, 1);
    }

    #[test]
    fn enviar_sem_forcar_recusa_por_cima_de_nuvem_mais_nova() {
        let (raiz, conn) = app_data_teste("enviar_guarda");
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(&banco_vivo, &imagens, &caminho_pacote(&pasta_nuvem), &manifesto_teste(5)).unwrap();

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &TransportePasta::new(&pasta_nuvem), false);

        assert!(!r.sucesso);
        assert_eq!(carimbo_ler(&conn).unwrap().contador, 0, "recusado não deve avançar o carimbo");
    }

    #[test]
    fn enviar_com_forcar_ignora_a_guarda() {
        let (raiz, conn) = app_data_teste("enviar_forcar");
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(&banco_vivo, &imagens, &caminho_pacote(&pasta_nuvem), &manifesto_teste(5)).unwrap();

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &TransportePasta::new(&pasta_nuvem), true);

        assert!(r.sucesso);
        assert_eq!(r.contador, Some(6), "novo = max(local, nuvem) + 1");
    }

    /// FIX5: `forcar` por cima de uma nuvem mais nova deve fazer backup do
    /// pacote antigo ANTES de sobrescrever (Q2 do plano: backup dos DOIS
    /// lados, não só do banco local em `aplicar_pacote`).
    #[test]
    fn enviar_com_forcar_faz_backup_do_pacote_antigo_da_nuvem() {
        let (raiz, conn) = app_data_teste("enviar_forcar_backup");
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(&banco_vivo, &imagens, &caminho_pacote(&pasta_nuvem), &manifesto_teste(5)).unwrap();
        let conteudo_antigo = std::fs::read(caminho_pacote(&pasta_nuvem)).unwrap();

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &TransportePasta::new(&pasta_nuvem), true);

        assert!(r.sucesso);
        let backup = r.backup.expect("forcar por cima de nuvem mais nova deve gerar backup");
        assert_eq!(
            std::fs::read(&backup).unwrap(),
            conteudo_antigo,
            "backup deve preservar o pacote antigo da nuvem, não o recém-escrito"
        );
    }

    /// FIX1: o pacote é montado (VACUUM INTO cru + scrub) num staging LOCAL,
    /// nunca dentro da pasta da nuvem — depois de `enviar`, não pode sobrar
    /// nada no staging nem `.tmp` órfão na pasta sincronizada.
    #[test]
    fn enviar_nao_deixa_staging_local_nem_tmp_orfao_na_nuvem() {
        let (raiz, conn) = app_data_teste("enviar_staging");
        conn.execute(
            "INSERT INTO config (chave, valor) VALUES ('gemini_api_keys', 'chave-crua-nao-pode-vazar')",
            [],
        )
        .unwrap();
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let pasta_nuvem = raiz.join("nuvem");

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &TransportePasta::new(&pasta_nuvem), false);
        assert!(r.sucesso);

        let staging_dir = raiz.join("app_data").join("sync_tmp");
        let sobras_staging = if staging_dir.exists() {
            std::fs::read_dir(&staging_dir).unwrap().count()
        } else {
            0
        };
        assert_eq!(sobras_staging, 0, "staging local deve ficar vazio após enviar");

        let arquivos_nuvem: Vec<_> =
            std::fs::read_dir(&pasta_nuvem).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(
            arquivos_nuvem,
            vec![std::ffi::OsString::from(NOME_PACOTE)],
            "só o pacote final deve sobrar na pasta da nuvem, nenhum .tmp cru"
        );
    }

    #[test]
    fn planejar_baixar_sem_pacote_recusa() {
        let (raiz, conn) = app_data_teste("baixar_sem_pacote");
        match planejar_baixar_teste(&conn, &TransportePasta::new(raiz.join("nuvem")), false) {
            PlanoBaixar::Recusar(r) => assert!(!r.sucesso),
            PlanoBaixar::Aplicar(_) => panic!("não devia liberar aplicar sem pacote"),
        }
    }

    #[test]
    fn planejar_baixar_em_dia_recusa() {
        let (raiz, conn) = app_data_teste("baixar_em_dia");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(3),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();

        match planejar_baixar_teste(&conn, &TransportePasta::new(&pasta_nuvem), false) {
            PlanoBaixar::Recusar(r) => assert!(!r.sucesso),
            PlanoBaixar::Aplicar(_) => panic!("em dia não devia liberar aplicar"),
        }
    }

    #[test]
    fn planejar_baixar_nuvem_mais_nova_e_local_limpo_libera_aplicar() {
        let (raiz, conn) = app_data_teste("baixar_libera");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(4),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();

        match planejar_baixar_teste(&conn, &TransportePasta::new(&pasta_nuvem), false) {
            PlanoBaixar::Aplicar(m) => assert_eq!(m.contador, 4),
            PlanoBaixar::Recusar(r) => panic!("devia liberar aplicar, recusou: {}", r.mensagem),
        }
    }

    #[test]
    fn planejar_baixar_local_sujo_entra_em_conflito() {
        let (raiz, conn) = app_data_teste("baixar_conflito");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(4),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();
        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();

        match planejar_baixar_teste(&conn, &TransportePasta::new(&pasta_nuvem), false) {
            PlanoBaixar::Recusar(r) => assert!(r.mensagem.contains("mudanças locais")),
            PlanoBaixar::Aplicar(_) => panic!("local sujo não pode baixar sozinho"),
        }
    }

    #[test]
    fn planejar_baixar_primeira_sync_ignora_sujo_e_libera_aplicar() {
        // Máquina nova: nunca sincronizou (contador==0), mas o bootstrap da
        // semente já gravou dados (revisão avançou => sujo). Não há baseline
        // pra conflitar — FIX4 manda aplicar (o backup protege), não recusar.
        // Antes de rotear por `decidir_acao`, o Baixar manual caía em falso
        // conflito aqui (o boot, via `planejar_boot`, já estava correto).
        let (raiz, conn) = app_data_teste("baixar_primeira_sync");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(4),
        )
        .unwrap();
        // Sem `carimbo_gravar`: contador==0. Bootstrap deixa o banco "sujo":
        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();
        assert!(banco_esta_sujo(&conn).unwrap(), "pré-condição: local sujo");

        match planejar_baixar_teste(&conn, &TransportePasta::new(&pasta_nuvem), false) {
            PlanoBaixar::Aplicar(m) => assert_eq!(m.contador, 4),
            PlanoBaixar::Recusar(r) => panic!("primeira sync devia aplicar, recusou: {}", r.mensagem),
        }
    }

    /* ------------------------- Fase 3: boot automático ------------------------ */

    // A antiga `planejar_boot_sem_pasta_definida_nao_faz_nada` não existe mais
    // nesta camada: `planejar_boot` (Fase 3) recebe `&dyn Transporte` já
    // construído — "sem pasta configurada" virou "sem transporte pra
    // construir", decidido por quem chama (`lib.rs::montar_transporte`, que
    // devolve `None` e nem chega a invocar `planejar_boot`) antes de existir
    // um transporte pra passar aqui. O caso equivalente testável neste nível
    // é "transporte configurado, mas sem pacote nele ainda", coberto abaixo.

    #[test]
    fn planejar_boot_pasta_definida_sem_pacote_na_nuvem_nao_faz_nada() {
        let (raiz, conn) = app_data_teste("boot_sem_pacote");
        let pasta_nuvem = raiz.join("nuvem");
        match planejar_boot_teste(&conn, &TransportePasta::new(&pasta_nuvem)) {
            PlanoBoot::Nenhum => {}
            _ => panic!("sem pacote na nuvem não deve decidir nada"),
        }
    }

    #[test]
    fn planejar_boot_em_dia_nao_faz_nada() {
        let (raiz, conn) = app_data_teste("boot_em_dia");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(3),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();

        match planejar_boot_teste(&conn, &TransportePasta::new(&pasta_nuvem)) {
            PlanoBoot::Nenhum => {}
            _ => panic!("em dia não deve decidir nada"),
        }
    }

    #[test]
    fn planejar_boot_nuvem_mais_nova_e_local_limpo_avisa_nuvem_mais_nova() {
        let (raiz, conn) = app_data_teste("boot_aplicar");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(4),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();

        match planejar_boot_teste(&conn, &TransportePasta::new(&pasta_nuvem)) {
            PlanoBoot::NuvemMaisNova(m) => assert_eq!(m.contador, 4),
            _ => panic!("nuvem mais nova + local limpo devia avisar nuvem mais nova"),
        }
    }

    #[test]
    fn planejar_boot_nuvem_mais_nova_e_local_sujo_e_conflito_nunca_baixa_limpo() {
        let (raiz, conn) = app_data_teste("boot_conflito");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(4),
        )
        .unwrap();
        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();
        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();

        match planejar_boot_teste(&conn, &TransportePasta::new(&pasta_nuvem)) {
            PlanoBoot::Conflito(m) => assert_eq!(m.contador, 4),
            PlanoBoot::NuvemMaisNova(_) => {
                panic!("local sujo NUNCA pode virar aviso de 'baixar sem perder nada'")
            }
            PlanoBoot::Nenhum => panic!("devia sinalizar conflito, não ficar em silêncio"),
        }
    }

    #[test]
    fn planejar_boot_local_mais_novo_nao_faz_nada() {
        let (raiz, conn) = app_data_teste("boot_local_mais_novo");
        let pasta_nuvem = raiz.join("nuvem");
        std::fs::create_dir_all(&pasta_nuvem).unwrap();
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("app_data").join("images"),
            &caminho_pacote(&pasta_nuvem),
            &manifesto_teste(2),
        )
        .unwrap();
        carimbo_gravar(&conn, 5, "2026-08-10 10:00:00").unwrap();

        match planejar_boot_teste(&conn, &TransportePasta::new(&pasta_nuvem)) {
            PlanoBoot::Nenhum => {}
            _ => panic!("local mais novo não deve decidir nada"),
        }
    }

    #[test]
    fn finalizar_baixar_grava_carimbo_com_contador_do_manifesto() {
        let (_raiz, conn) = app_data_teste("finalizar_baixar");
        let r = finalizar_baixar(&conn, &manifesto_teste(9), Some(PathBuf::from("rpg.db.bak-sync-1"))).unwrap();

        assert!(r.sucesso);
        assert_eq!(r.backup.as_deref(), Some("rpg.db.bak-sync-1"));
        assert_eq!(carimbo_ler(&conn).unwrap().contador, 9);
    }

    /* ------------------------------- FIX3/FIX7 -------------------------------- */

    /// FIX3: sem tmp+rename, um crash no meio do `fs::write` deixaria um
    /// arquivo com nome final mas conteúdo truncado. Aqui só confirma que a
    /// escrita normal não deixa `.tmp` órfão pra trás.
    #[test]
    fn escrever_atomico_grava_conteudo_e_nao_deixa_tmp_orfao() {
        let raiz = dir_teste("escrever_atomico");
        let alvo = raiz.join("retrato.png");

        escrever_atomico(&alvo, b"bytes completos da imagem").unwrap();

        assert_eq!(std::fs::read(&alvo).unwrap(), b"bytes completos da imagem");
        assert!(!alvo.with_extension("tmp").exists());
    }

    #[test]
    fn aplicar_pacote_recusa_schema_pacote_incompativel() {
        let raiz = dir_teste("schema_incompativel");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);
        let pacote = raiz.join("rpg-estado.rpgpack");
        let mut manifesto_futuro = manifesto_teste(1);
        manifesto_futuro.schema_pacote = SCHEMA_PACOTE_ATUAL + 1;
        montar_pacote(&banco_vivo, &raiz.join("sem_imagens"), &pacote, &manifesto_futuro).unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        let imagens_destino = raiz.join("app_data").join("images");

        let erro = aplicar_pacote(&pacote, &banco_destino, &imagens_destino)
            .expect_err("pacote de schema futuro incompatível deve ser recusado");

        assert!(matches!(erro, AppError::Msg(_)));
        assert!(!banco_destino.exists(), "não deve materializar banco a partir de pacote incompatível");
    }

    /* ---------------------------------- FIX6 ----------------------------------- */

    #[test]
    fn config_nao_exportar_cobre_gemini_e_todo_o_carimbo_de_sync() {
        assert!(CONFIG_NAO_EXPORTAR.contains(&"gemini_api_keys"));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_PASTA));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_MACHINE_ID));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_CONTADOR));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_HORA));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_REVISAO_BASE));
        assert!(CONFIG_NAO_EXPORTAR.contains(&CHAVE_SYNC_TRANSPORTE));
    }

    /* ----------------------------------- FIX B ---------------------------------- */
    // Revisão adversarial 2026-08-11: `montar_pacote` scrubava só
    // `gemini_api_keys`, deixando `sync_pasta`/`sync_machine_id`/
    // `sync_transporte` da máquina EMISSORA vazarem pro pacote e sobrescrever
    // o carimbo da receptora ao aplicar.

    /// O `.rpgpack` em si não pode carregar nenhuma chave de
    /// `CONFIG_NAO_EXPORTAR` — não só a Gemini. Abre o pacote como SQLite cru
    /// (sem passar por `aplicar_pacote`) pra provar que o scrub aconteceu na
    /// MONTAGEM, antes de qualquer coisa viajar.
    #[test]
    fn montar_pacote_scruba_o_carimbo_de_sync_inteiro_nao_so_gemini() {
        let raiz = dir_teste("scrub_carimbo");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);
        {
            let conn = crate::db::connection::open(&banco_vivo).unwrap();
            carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();
            config_set(&conn, CHAVE_SYNC_PASTA, r"C:\nuvem\da-emissora").unwrap();
            config_set(&conn, CHAVE_SYNC_MACHINE_ID, "machine-id-da-emissora").unwrap();
            config_set(&conn, CHAVE_SYNC_TRANSPORTE, "drive").unwrap();
        }

        let pacote = raiz.join("rpg-estado.rpgpack");
        montar_pacote(&banco_vivo, &raiz.join("sem_imagens"), &pacote, &manifesto_teste(1)).unwrap();

        let conn_pacote = Connection::open_with_flags(&pacote, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        for chave in CONFIG_NAO_EXPORTAR {
            let valor: Option<String> = conn_pacote
                .query_row("SELECT valor FROM config WHERE chave = ?1", [chave], |r| r.get(0))
                .optional()
                .unwrap();
            assert_eq!(valor, None, "{chave} não pode viajar dentro do .rpgpack");
        }
    }

    /// Round-trip de [`identidade_local_preservar`]/[`identidade_local_restaurar`]:
    /// o que estava lá antes continua lá depois, mesmo que no meio o `config`
    /// tenha sido zerado (simula `materializar_banco` trocando o `rpg.db`
    /// inteiro pelo pacote scrubado).
    #[test]
    fn identidade_local_preservar_e_restaurar_faz_round_trip() {
        let (_raiz, conn) = app_data_teste("identidade_round_trip");
        config_set(&conn, CHAVE_SYNC_PASTA, r"C:\nuvem\local").unwrap();
        config_set(&conn, CHAVE_SYNC_MACHINE_ID, "machine-id-local").unwrap();
        config_set(&conn, CHAVE_SYNC_TRANSPORTE, "drive").unwrap();

        let preservada = identidade_local_preservar(&conn).unwrap();

        // Simula o pacote aplicado sobrescrevendo o config sem essas chaves.
        conn.execute("DELETE FROM config WHERE chave IN (?1, ?2, ?3)", params![
            CHAVE_SYNC_PASTA,
            CHAVE_SYNC_MACHINE_ID,
            CHAVE_SYNC_TRANSPORTE
        ])
        .unwrap();
        assert_eq!(config_get(&conn, CHAVE_SYNC_MACHINE_ID).unwrap(), None);

        identidade_local_restaurar(&conn, &preservada).unwrap();

        assert_eq!(config_get(&conn, CHAVE_SYNC_PASTA).unwrap().as_deref(), Some(r"C:\nuvem\local"));
        assert_eq!(
            config_get(&conn, CHAVE_SYNC_MACHINE_ID).unwrap().as_deref(),
            Some("machine-id-local"),
            "machine_id da receptora não pode se perder nem virar o de outra máquina"
        );
        assert_eq!(config_get(&conn, CHAVE_SYNC_TRANSPORTE).unwrap().as_deref(), Some("drive"));
    }

    /// Sem `identidade_local_preservar`/`restaurar` (o que `lib.rs::sync_baixar`
    /// e `aplicar_boot_sync` agora fazem ao redor de `aplicar_pacote`), o
    /// `machine_id` da receptora simplesmente desaparece depois de aplicar —
    /// prova que o scrub do FIX B por si só criaria um novo bug (identidade
    /// perdida) se ninguém repusesse essas chaves por fora.
    #[test]
    fn aplicar_pacote_sozinho_nao_preserva_a_identidade_local_por_isso_lib_rs_precisa_restaurar() {
        let raiz = dir_teste("aplicar_sem_restaurar");
        let banco_vivo = raiz.join("rpg.db");
        preparar_banco_vivo(&banco_vivo);
        let pacote = raiz.join("rpg-estado.rpgpack");
        montar_pacote(&banco_vivo, &raiz.join("sem_imagens"), &pacote, &manifesto_teste(1)).unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        std::fs::create_dir_all(banco_destino.parent().unwrap()).unwrap();
        {
            let conn = crate::db::connection::open(&banco_destino).unwrap();
            config_set(&conn, CHAVE_SYNC_MACHINE_ID, "machine-id-da-receptora").unwrap();
        }

        aplicar_pacote(&pacote, &banco_destino, &raiz.join("app_data").join("images")).unwrap();

        let conn = crate::db::connection::open(&banco_destino).unwrap();
        assert_eq!(
            config_get(&conn, CHAVE_SYNC_MACHINE_ID).unwrap(),
            None,
            "documenta o comportamento cru de aplicar_pacote: quem chama é responsável por restaurar"
        );
    }

    /* ------------------- Fase 3: transporte abstrato (FakeTransporte) ------------------- */
    // Item 5 do plano: os testes acima já provam que TransportePasta preserva
    // o comportamento de sempre; estes provam que o MESMO núcleo
    // (enviar/planejar_baixar/planejar_boot/baixar_e_aplicar) funciona igual
    // quando o "remoto" não é um arquivo numa pasta observada, e sim um
    // `Vec<u8>` em memória (o formato que `TransporteDrive` teria: só
    // acessível via materialização em temp local) — sem precisar de rede real
    // nem mockar HTTP.

    #[test]
    fn fake_enviar_publica_no_transporte_e_avanca_contador() {
        let (raiz, conn) = app_data_teste("fake_enviar");
        conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Fake')", []).unwrap();
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let transporte = FakeTransporte::vazio(raiz.join("fake_local"));

        let r = enviar_teste(&conn, &banco_vivo, &imagens, &transporte, false);

        assert!(r.sucesso);
        assert_eq!(r.contador, Some(1));
        assert_eq!(carimbo_ler(&conn).unwrap().contador, 1);
        let lido = bloquear(transporte.ler_manifesto()).unwrap();
        assert_eq!(lido.map(|m| m.contador), Some(1), "o que foi publicado deve ser lido de volta");
    }

    #[test]
    fn fake_baixar_materializa_em_temp_local_e_aplica() {
        let (raiz, conn) = app_data_teste("fake_baixar");
        // Destino DIFERENTE do banco que `app_data_teste` já abriu como `conn`
        // (o carimbo local) — no Windows um `rename` por cima de um arquivo
        // com handle aberto falha com "Acesso negado"; aqui simula a máquina
        // B, que ainda não tem banco nenhum.
        let banco_destino = raiz.join("maquina_b").join("rpg.db");
        let imagens_destino = raiz.join("maquina_b").join("images");
        let transporte = FakeTransporte::vazio(raiz.join("fake_local"));

        // simula um pacote já publicado por outra máquina.
        let pacote_alheio = raiz.join("pacote_alheio.rpgpack");
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("sem_imagens"),
            &pacote_alheio,
            &manifesto_teste(4),
        )
        .unwrap();
        bloquear(transporte.publicar_pacote(&pacote_alheio)).unwrap();

        match planejar_baixar_teste(&conn, &transporte, false) {
            PlanoBaixar::Aplicar(m) => assert_eq!(m.contador, 4),
            PlanoBaixar::Recusar(r) => panic!("devia liberar aplicar: {}", r.mensagem),
        }

        let staging = raiz.join("staging_baixar");
        let backup =
            bloquear(baixar_e_aplicar(&transporte, &staging, &banco_destino, &imagens_destino)).unwrap();
        assert!(backup.is_none(), "banco destino não existia ainda: sem o que fazer backup");
        assert!(banco_destino.exists());
        assert_eq!(
            std::fs::read_dir(&staging).unwrap().count(),
            0,
            "temp de materialização deve ser removido após aplicar"
        );
    }

    #[test]
    fn fake_conflito_nao_aplica_e_forcar_faz_backup_remoto() {
        let (raiz, conn) = app_data_teste("fake_conflito");
        let transporte = FakeTransporte::vazio(raiz.join("fake_local"));
        let pacote_alheio = raiz.join("pacote_alheio.rpgpack");
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("sem_imagens"),
            &pacote_alheio,
            &manifesto_teste(4),
        )
        .unwrap();
        bloquear(transporte.publicar_pacote(&pacote_alheio)).unwrap();

        carimbo_gravar(&conn, 3, "2026-08-10 10:00:00").unwrap();
        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();

        match planejar_boot_teste(&conn, &transporte) {
            PlanoBoot::Conflito(m) => assert_eq!(m.contador, 4),
            _ => panic!("nuvem mais nova + local sujo devia conflitar, nunca aplicar sozinho"),
        }

        // FIX5/Q2: forçar por cima do transporte mais novo faz backup remoto
        // ANTES de sobrescrever — igual TransportePasta, mas aqui o "remoto"
        // nunca tocou um diretório observado.
        let banco_vivo = raiz.join("app_data").join("rpg.db");
        let imagens = raiz.join("app_data").join("images");
        let r = enviar_teste(&conn, &banco_vivo, &imagens, &transporte, true);
        assert!(r.sucesso);
        let backup = r.backup.expect("forcar por cima do remoto mais novo deve gerar backup");
        assert!(std::path::Path::new(&backup).exists(), "backup remoto devia existir em disco local: {backup}");
    }

    #[test]
    fn fake_primeira_sync_ignora_sujo_e_libera_aplicar() {
        let (raiz, conn) = app_data_teste("fake_primeira_sync");
        let transporte = FakeTransporte::vazio(raiz.join("fake_local"));
        let pacote_alheio = raiz.join("pacote_alheio.rpgpack");
        montar_pacote(
            &raiz.join("app_data").join("rpg.db"),
            &raiz.join("sem_imagens"),
            &pacote_alheio,
            &manifesto_teste(1),
        )
        .unwrap();
        bloquear(transporte.publicar_pacote(&pacote_alheio)).unwrap();

        // Sem `carimbo_gravar`: contador==0 (nunca sincronizou nesta
        // máquina). Bootstrap da semente deixa o banco "sujo":
        conn.execute("INSERT INTO nota (titulo, corpo) VALUES ('t', 'c')", []).unwrap();

        match planejar_boot_teste(&conn, &transporte) {
            PlanoBoot::NuvemMaisNova(m) => assert_eq!(m.contador, 1),
            _ => panic!("FIX4: primeira sync (contador 0) devia avisar mesmo com sujo"),
        }
    }
}
