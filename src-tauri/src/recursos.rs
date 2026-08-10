//! Resolução de recursos empacotados (`src-tauri/resources/`, declarados em
//! `tauri.conf.json` como `bundle.resources`) — arquivos que o app carrega
//! prontos (ffmpeg, `discord_config.json` do v1) em vez de gerar em runtime.
//! Usado tanto pelo seed de favoritos (`lib.rs`) quanto pelas env vars do
//! sidecar (`discord/mod.rs`); mora num módulo à parte pra não duplicar entre
//! os dois.

use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Resolve `resources/<nome>` via `BaseDirectory::Resource` — mesma resolução
/// em dev (`target/debug/resources/...`, copiado pelo build.rs a cada `cargo
/// build` que roda depois de `bundle.resources` declarado) e no app empacotado
/// (`resources/...` ao lado do binário). Fallback só em dev: se o
/// `BaseDirectory::Resource` não enxergar o arquivo (ex.: build.rs não rodou
/// de novo desde que o resource foi declarado), tenta o caminho bruto em
/// `CARGO_MANIFEST_DIR/resources/<nome>`. Nunca falha — devolve `None` e loga
/// no stderr; quem chama decide o que fazer sem o recurso.
pub fn resolver_recurso(app: &AppHandle, nome: &str) -> Option<PathBuf> {
    let relativo = format!("resources/{nome}");
    if let Ok(caminho) = app.path().resolve(&relativo, BaseDirectory::Resource) {
        if caminho.exists() {
            return Some(caminho);
        }
    }

    if let Some(caminho) = caminho_dev_fallback(nome) {
        return Some(caminho);
    }

    eprintln!("[recursos] '{nome}' não encontrado (nem via BaseDirectory::Resource, nem fallback de dev)");
    None
}

/// Caminho bruto em `CARGO_MANIFEST_DIR/resources/<nome>` — só existe como
/// função porque o fallback é exclusivo de dev (não faz sentido apontar pro
/// `src-tauri/` de quem desenvolveu dentro do binário instalado do cliente).
#[cfg(debug_assertions)]
fn caminho_dev_fallback(nome: &str) -> Option<PathBuf> {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(nome);
    caminho.exists().then_some(caminho)
}

#[cfg(not(debug_assertions))]
fn caminho_dev_fallback(_nome: &str) -> Option<PathBuf> {
    None
}
