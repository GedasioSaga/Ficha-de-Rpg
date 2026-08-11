//! Cofre de segredos: o repositório é público, então token do Discord e
//! chaves Gemini viajam no bundle CIFRADOS (`resources/segredos.enc`) e só
//! viram texto claro dentro da máquina do usuário.
//!
//! Formato do blob (par com `scripts/segredos-cifrar.mjs`, node:crypto):
//! `"RPGSEG1\n"` (8 bytes) + salt (16) + nonce (12) + AES-256-GCM(JSON) com
//! a tag GCM anexada ao fim. Chave derivada da senha-mestra via scrypt
//! (N=2^15, r=8, p=1).
//!
//! Fluxo por máquina:
//! - 1ª vez: UI pede a senha-mestra → `segredos_destravar` decripta o blob,
//!   grava cache local (`%APPDATA%/.../segredos.json`, fora do git) com a
//!   CHAVE DERIVADA (não a senha) + os segredos, e injeta as chaves Gemini
//!   na tabela `config` — as telas existentes continuam lendo de lá.
//! - Updates seguintes: blob novo no bundle (hash difere do cache) é
//!   re-importado em silêncio com a chave derivada cacheada. Rotação de
//!   token = publicar blob novo; ninguém digita nada de novo.
//!
//! O cache local fica no mesmo diretório (e mesmo nível de proteção) do
//! `rpg.db` — perfil do usuário no Windows. Mesmo modelo de ameaça do banco.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::db::error::AppError;

const MAGIC: &[u8; 8] = b"RPGSEG1\n";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
/// scrypt N=2^15, r=8, p=1 — mesmos parâmetros do lado Node.
const SCRYPT_LOG_N: u8 = 15;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;

/// Chave da tabela `config` onde a tela Balanceamento lê as chaves Gemini
/// (espelha `CONFIG_CHAVES` em `src/lib/gemini.ts`).
pub const CONFIG_CHAVES_GEMINI: &str = "gemini_api_keys";

/// Conteúdo decifrado do blob. Campos opcionais: um cofre só com Discord (ou
/// só com Gemini) é válido.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Segredos {
    pub discord_token: Option<String>,
    pub gemini_api_keys: Option<String>,
    /// Credenciais do app OAuth do Google (sync via Drive,
    /// docs/plans/2026-08-11-sync-google-drive.md). Ao contrário das chaves
    /// Gemini, NÃO vão pra tabela `config` do banco — credencial de app não é
    /// dado do usuário, fica só em memória vinda do cofre (`google_credenciais`).
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
}

/// Cache local por máquina: chave derivada (pra re-importar blob futuro sem
/// pedir a senha de novo), hash do blob já importado e os segredos em si.
#[derive(Serialize, Deserialize)]
struct CacheLocal {
    chave_b64: String,
    hash_blob: String,
    segredos: Segredos,
}

/// Estado gerenciado: `None` = cofre não destravado nesta máquina (ou blob
/// ausente do bundle).
pub struct CofreState(pub Mutex<Option<Segredos>>);

impl CofreState {
    pub fn novo(segredos: Option<Segredos>) -> Self {
        Self(Mutex::new(segredos))
    }

    /// Token do Discord, se o cofre estiver destravado e o tiver.
    pub fn discord_token(&self) -> Option<String> {
        self.0.lock().ok()?.as_ref()?.discord_token.clone()
    }

    /// `client_id`/`client_secret` do app OAuth do Google, se o cofre estiver
    /// destravado e os dois estiverem presentes. Usado pelo módulo
    /// `google::auth` em runtime — nunca cruza pro TS.
    pub fn google_credenciais(&self) -> Option<(String, String)> {
        let guarda = self.0.lock().ok()?;
        let segredos = guarda.as_ref()?;
        let id = segredos.google_client_id.clone()?;
        let secret = segredos.google_client_secret.clone()?;
        Some((id, secret))
    }
}

fn caminho_cache(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("segredos.json"))
}

fn caminho_blob(app: &AppHandle) -> Option<PathBuf> {
    crate::recursos::resolver_recurso(app, "segredos.enc")
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn derivar_chave(senha: &str, salt: &[u8]) -> Result<[u8; 32], AppError> {
    let params = scrypt::Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, 32)
        .map_err(|e| AppError::Msg(format!("params scrypt: {e}")))?;
    let mut chave = [0u8; 32];
    scrypt::scrypt(senha.as_bytes(), salt, &params, &mut chave)
        .map_err(|e| AppError::Msg(format!("scrypt: {e}")))?;
    Ok(chave)
}

/// Decifra o blob com a CHAVE já derivada. Erro de autenticação GCM (senha
/// errada, blob adulterado) vira `Err` — nunca meio-resultado.
fn decifrar_com_chave(blob: &[u8], chave: &[u8; 32]) -> Result<Segredos, AppError> {
    let corpo = blob
        .strip_prefix(MAGIC.as_slice())
        .ok_or_else(|| AppError::Msg("segredos.enc: formato desconhecido".into()))?;
    if corpo.len() < SALT_LEN + NONCE_LEN + 16 {
        return Err(AppError::Msg("segredos.enc: truncado".into()));
    }
    let nonce = &corpo[SALT_LEN..SALT_LEN + NONCE_LEN];
    let cifrado = &corpo[SALT_LEN + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(chave));
    let claro = cipher
        .decrypt(Nonce::from_slice(nonce), cifrado)
        .map_err(|_| AppError::Msg("senha incorreta (ou cofre corrompido)".into()))?;
    Ok(serde_json::from_slice(&claro)?)
}

/// Decifra com a SENHA-MESTRA (deriva a chave a partir do salt do próprio
/// blob). Devolve também a chave derivada, pro cache.
fn decifrar_com_senha(blob: &[u8], senha: &str) -> Result<(Segredos, [u8; 32]), AppError> {
    let corpo = blob
        .strip_prefix(MAGIC.as_slice())
        .ok_or_else(|| AppError::Msg("segredos.enc: formato desconhecido".into()))?;
    if corpo.len() < SALT_LEN {
        return Err(AppError::Msg("segredos.enc: truncado".into()));
    }
    let chave = derivar_chave(senha, &corpo[..SALT_LEN])?;
    let segredos = decifrar_com_chave(blob, &chave)?;
    Ok((segredos, chave))
}

fn ler_cache(caminho: &Path) -> Option<CacheLocal> {
    let texto = std::fs::read_to_string(caminho).ok()?;
    serde_json::from_str(&texto).ok()
}

fn gravar_cache(caminho: &Path, cache: &CacheLocal) -> Result<(), AppError> {
    let texto = serde_json::to_string(cache)?;
    std::fs::write(caminho, texto)?;
    Ok(())
}

/// Injeta as chaves Gemini do cofre na `config` do banco (upsert). A semente
/// pública chega SEM essa linha (scrubada no export), então é daqui que as
/// telas de IA voltam a funcionar depois de semear/substituir o banco.
pub fn injetar_gemini(conn: &rusqlite::Connection, segredos: &Segredos) {
    if let Some(chaves) = segredos.gemini_api_keys.as_deref() {
        if !chaves.trim().is_empty() {
            if let Err(e) = crate::db::repositorios::config_set(conn, CONFIG_CHAVES_GEMINI, chaves)
            {
                eprintln!("[segredos] falha ao injetar chaves Gemini na config: {e}");
            }
        }
    }
}

/// Como `injetar_gemini`, mas só quando a config AINDA NÃO TEM chaves — é o
/// reparo pós-substituição do banco (a semente pública chega scrubada). Não
/// sobrescreve valor presente: edição local na tela de chaves vale até o
/// próximo update trazer cofre rotacionado (aí `injetar_gemini` decide).
pub fn injetar_gemini_se_ausente(conn: &rusqlite::Connection, segredos: &Segredos) {
    let atual = crate::db::repositorios::config_get(conn, CONFIG_CHAVES_GEMINI)
        .ok()
        .flatten()
        .unwrap_or_default();
    if atual.trim().is_empty() {
        injetar_gemini(conn, segredos);
    }
}

/// Carrega o cofre no setup do app, sem UI:
/// - cache válido + hash igual ao blob do bundle → usa o cache;
/// - cache válido + blob NOVO no bundle (update/rotação) → re-decifra com a
///   chave cacheada, atualiza cache e re-injeta Gemini na config;
/// - sem cache (máquina nova) → `None`; a UI pede a senha-mestra depois.
/// Falha em qualquer passo nunca derruba o app — vira `None` + stderr.
pub fn carregar_no_setup(app: &AppHandle, conn: &rusqlite::Connection) -> Option<Segredos> {
    let caminho_cache = caminho_cache(app)?;
    let cache = ler_cache(&caminho_cache)?;

    let Some(blob_path) = caminho_blob(app) else {
        // Bundle sem cofre (dev sem segredos.enc): segredos do cache continuam valendo.
        return Some(cache.segredos);
    };
    let blob = match std::fs::read(&blob_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[segredos] blob ilegível: {e}");
            return Some(cache.segredos);
        }
    };

    if sha256_hex(&blob) == cache.hash_blob {
        return Some(cache.segredos);
    }

    // Blob mudou (update do app com segredos rotacionados): re-importa em silêncio.
    use base64::Engine;
    let chave_vec = base64::engine::general_purpose::STANDARD
        .decode(&cache.chave_b64)
        .ok()?;
    let chave: [u8; 32] = chave_vec.try_into().ok()?;
    match decifrar_com_chave(&blob, &chave) {
        Ok(segredos) => {
            injetar_gemini(conn, &segredos);
            let novo_cache = CacheLocal {
                chave_b64: cache.chave_b64,
                hash_blob: sha256_hex(&blob),
                segredos: segredos.clone(),
            };
            if let Err(e) = gravar_cache(&caminho_cache, &novo_cache) {
                eprintln!("[segredos] falha ao atualizar cache: {e}");
            }
            Some(segredos)
        }
        Err(e) => {
            // Senha-mestra mudou entre releases: chave antiga não abre o blob
            // novo. Derruba o cache pro app voltar a pedir a senha.
            eprintln!("[segredos] blob novo não abre com a chave cacheada ({e}); pedindo senha de novo");
            let _ = std::fs::remove_file(&caminho_cache);
            None
        }
    }
}

/// Situação do cofre para a UI decidir se mostra a tela de senha.
#[tauri::command]
pub fn segredos_status(app: AppHandle, cofre: tauri::State<CofreState>) -> String {
    let destravado = cofre.0.lock().map(|s| s.is_some()).unwrap_or(false);
    if destravado {
        "destravado".into()
    } else if caminho_blob(&app).is_some() {
        "trancado".into()
    } else {
        "ausente".into()
    }
}

/// Destrava o cofre com a senha-mestra (1ª vez nesta máquina). Grava o cache
/// local e injeta as chaves Gemini na config. Senha errada → `Err` com
/// mensagem amigável (a GCM autentica, não tem falso positivo).
#[tauri::command]
pub fn segredos_destravar(
    app: AppHandle,
    db: tauri::State<crate::db::connection::Db>,
    cofre: tauri::State<CofreState>,
    senha: String,
) -> Result<(), AppError> {
    let blob_path =
        caminho_blob(&app).ok_or_else(|| AppError::Msg("cofre ausente do bundle".into()))?;
    let blob = std::fs::read(&blob_path)?;
    let (segredos, chave) = decifrar_com_senha(&blob, &senha)?;

    {
        let conn = db.conn()?;
        injetar_gemini(&conn, &segredos);
    }

    use base64::Engine;
    let cache = CacheLocal {
        chave_b64: base64::engine::general_purpose::STANDARD.encode(chave),
        hash_blob: sha256_hex(&blob),
        segredos: segredos.clone(),
    };
    if let Some(caminho) = caminho_cache(&app) {
        gravar_cache(&caminho, &cache)?;
    }

    *cofre.0.lock().map_err(|e| AppError::Msg(e.to_string()))? = Some(segredos);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;

    fn cifrar_para_teste(segredos: &Segredos, senha: &str, salt: &[u8; 16], nonce: &[u8; 12]) -> Vec<u8> {
        let chave = derivar_chave(senha, salt).unwrap();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&chave));
        let claro = serde_json::to_vec(segredos).unwrap();
        let cifrado = cipher.encrypt(Nonce::from_slice(nonce), claro.as_slice()).unwrap();
        let mut blob = Vec::new();
        blob.extend_from_slice(MAGIC);
        blob.extend_from_slice(salt);
        blob.extend_from_slice(nonce);
        blob.extend_from_slice(&cifrado);
        blob
    }

    #[test]
    fn roundtrip_cifra_e_decifra_com_senha() {
        let segredos = Segredos {
            discord_token: Some("token-de-teste".into()),
            gemini_api_keys: Some("chave1,chave2".into()),
            google_client_id: Some("client-id-teste".into()),
            google_client_secret: Some("client-secret-teste".into()),
        };
        let blob = cifrar_para_teste(&segredos, "senha forte", &[7u8; 16], &[9u8; 12]);

        let (aberto, chave) = decifrar_com_senha(&blob, "senha forte").unwrap();
        assert_eq!(aberto.discord_token.as_deref(), Some("token-de-teste"));
        assert_eq!(aberto.gemini_api_keys.as_deref(), Some("chave1,chave2"));
        assert_eq!(aberto.google_client_id.as_deref(), Some("client-id-teste"));
        assert_eq!(aberto.google_client_secret.as_deref(), Some("client-secret-teste"));

        // a chave derivada reabre o blob sozinha (caminho do re-import silencioso)
        let de_novo = decifrar_com_chave(&blob, &chave).unwrap();
        assert_eq!(de_novo.discord_token.as_deref(), Some("token-de-teste"));
    }

    #[test]
    fn senha_errada_falha_sem_meio_resultado() {
        let blob = cifrar_para_teste(&Segredos::default(), "certa", &[1u8; 16], &[2u8; 12]);
        assert!(decifrar_com_senha(&blob, "errada").is_err());
    }

    #[test]
    fn blob_adulterado_falha_na_autenticacao() {
        let mut blob = cifrar_para_teste(&Segredos::default(), "senha", &[3u8; 16], &[4u8; 12]);
        let fim = blob.len() - 1;
        blob[fim] ^= 0xFF;
        assert!(decifrar_com_senha(&blob, "senha").is_err());
    }

    #[test]
    fn formato_desconhecido_e_truncado_sao_erros_claros() {
        assert!(decifrar_com_senha(b"nao e um blob", "x").is_err());
        assert!(decifrar_com_senha(b"RPGSEG1\ncurto", "x").is_err());
    }

    /// Blob gerado pelo `scripts/segredos-cifrar.mjs` real (node:crypto) com
    /// senha "teste-cross-impl", salt e nonce fixos — prova que Node e Rust
    /// falam exatamente o mesmo formato. Se este teste quebrar, os dois lados
    /// divergiram (parâmetros scrypt, layout do blob ou modo GCM).
    #[test]
    fn decifra_blob_gerado_pelo_node() {
        let blob = hex::decode(BLOB_DO_NODE_HEX).unwrap();
        let (segredos, _) = decifrar_com_senha(&blob, "teste-cross-impl").unwrap();
        assert_eq!(segredos.discord_token.as_deref(), Some("tok-node"));
        assert_eq!(segredos.gemini_api_keys.as_deref(), Some("g1,g2"));
        assert_eq!(segredos.google_client_id.as_deref(), Some("cid-node"));
        assert_eq!(segredos.google_client_secret.as_deref(), Some("csec-node"));
    }

    // Gerado por: node scripts/segredos-cifrar.mjs --auto-teste
    const BLOB_DO_NODE_HEX: &str = "525047534547310aababababababababababababababababcdcdcdcdcdcdcdcdcdcdcdcd0e8efedcc196761b38260d1d4b9d5c6120cfffc46fb72900f3223cd8a27b8d02408e0efe0409e445639b5f504932de27974e1123f0b208d5f1e0925e075298bd605577ac45aaddf79ad65b3120c8d5fd9c4e305f85e5097a2e9e9ff19e375350256d630bfbd56a1440aaad197b3f72e5832870de3b5312449dc85ac39d1fdc96f5bdf58d7e8a7d";
}
