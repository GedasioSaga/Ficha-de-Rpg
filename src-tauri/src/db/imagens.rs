use crate::db::error::AppError;
use crate::domain::modelos::RetratoInput;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Grava uma imagem base64 no disco (`images_dir`) e registra em `imagem`,
/// deduplicando por sha256: se os mesmos bytes já existem, reusa o id.
/// Devolve `None` quando o base64 é vazio.
pub fn salvar_imagem_base64(
    conn: &Connection,
    images_dir: &Path,
    data_b64: &str,
    fmt: &str,
) -> Result<Option<i64>, AppError> {
    let data = data_b64.trim();
    if data.is_empty() {
        return Ok(None);
    }
    let bytes = BASE64_STANDARD.decode(data)?;
    let sha = hex::encode(Sha256::digest(&bytes));
    if let Ok(id) = conn.query_row(
        "SELECT id FROM imagem WHERE sha256 = ?1",
        [&sha],
        |r| r.get::<_, i64>(0),
    ) {
        return Ok(Some(id));
    }
    let ext = if fmt.trim().is_empty() { "png" } else { fmt.trim() };
    let nome_arq = format!("{sha}.{ext}");
    std::fs::create_dir_all(images_dir)?;
    std::fs::write(images_dir.join(&nome_arq), &bytes)?;
    conn.execute(
        "INSERT INTO imagem (caminho,formato,sha256) VALUES (?1,?2,?3)",
        params![nome_arq, ext, sha],
    )?;
    Ok(Some(conn.last_insert_rowid()))
}

/// Resolve o retrato de um save (vindo do frontend) para um `imagem_id`.
pub fn resolver_retrato(
    conn: &Connection,
    images_dir: &Path,
    r: &RetratoInput,
) -> Result<Option<i64>, AppError> {
    match r {
        RetratoInput::Novo { base64, formato } => {
            salvar_imagem_base64(conn, images_dir, base64, formato)
        }
        RetratoInput::Manter { caminho } => Ok(conn
            .query_row(
                "SELECT id FROM imagem WHERE caminho = ?1",
                [caminho],
                |row| row.get::<_, i64>(0),
            )
            .optional()?), // se o arquivo sumiu, vira None (não falha o save)
        RetratoInput::Nenhum => Ok(None),
    }
}
