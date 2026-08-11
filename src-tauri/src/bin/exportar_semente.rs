//! Exporta o banco/imagens VIVOS desta máquina (a "master") para os resources
//! da semente que viajam no instalador. Rodado pelo `scripts/publicar.ps1`
//! antes de cada release:
//!
//! ```text
//! cargo run --bin exportar_semente
//! ```
//!
//! - `%APPDATA%/com.gedasio.rpgv2/rpg.db` → `resources/rpg_semente.db`
//!   (snapshot via `VACUUM INTO` — consistente mesmo com o app aberto — e
//!   **scrub** das chaves Gemini: o repo é público, segredo só viaja cifrado
//!   no `segredos.enc`).
//! - `%APPDATA%/com.gedasio.rpgv2/images/` → `resources/imagens_semente/`
//!   (espelho: copia o que falta e remove o que não existe mais na origem,
//!   pra retrato apagado não viajar pra sempre no instalador).

use std::path::{Path, PathBuf};

/// Linhas da `config` que NUNCA podem ir na semente pública: a chave Gemini
/// (segredo) e o carimbo de sync inteiro (FIX6 — `sync_pasta`/`sync_contador`/
/// `sync_machine_id`/`sync_hora`/`sync_revisao_base` são por-PC; se viajassem
/// na semente, toda máquina nova nasceria com o mesmo `machine_id` e um
/// contador não-zero, quebrando a guarda de conflito da sync de nuvem). O
/// canal do Discord fica de fora dessa lista (é um id de canal, não um
/// segredo, e é útil viajar). Lista centralizada em
/// `sincronizacao_nuvem::CONFIG_NAO_EXPORTAR` pra não divergir dos dois scrubs.
const CHAVES_DE_SEGREDO: &[&str] = projeto_rpg_v2_lib::db::sincronizacao_nuvem::CONFIG_NAO_EXPORTAR;

fn main() {
    if let Err(e) = rodar() {
        eprintln!("ERRO: {e}");
        std::process::exit(1);
    }
}

fn rodar() -> Result<(), Box<dyn std::error::Error>> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA não definida")?;
    let origem_dir = Path::new(&appdata).join("com.gedasio.rpgv2");
    let banco_origem = origem_dir.join("rpg.db");
    if !banco_origem.exists() {
        return Err(format!("banco não encontrado em {}", banco_origem.display()).into());
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let recursos = manifest.join("resources");
    std::fs::create_dir_all(&recursos)?;
    let banco_destino = recursos.join("rpg_semente.db");
    let imagens_destino = recursos.join("imagens_semente");
    let imagens_origem = origem_dir.join("images");

    exportar_banco(&banco_origem, &banco_destino)?;
    let (copiadas, removidas) = espelhar_imagens(&imagens_origem, &imagens_destino)?;

    println!("semente exportada: {}", banco_destino.display());
    println!("imagens: {copiadas} copiada(s), {removidas} removida(s)");
    println!("(chave Gemini + carimbo de sync scrubados — segredo só viaja no segredos.enc)");
    Ok(())
}

/// `VACUUM INTO` gera um snapshot consistente e compacto num tmp; o scrub
/// roda NA CÓPIA (nunca no banco vivo); rename final é atômico.
fn exportar_banco(origem: &Path, destino: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let tmp = destino.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);

    let conn = rusqlite::Connection::open_with_flags(
        origem,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    conn.execute(
        "VACUUM INTO ?1",
        [tmp.to_str().ok_or("caminho tmp não-UTF8")?],
    )?;
    drop(conn);

    let copia = rusqlite::Connection::open(&tmp)?;
    // DELETE sozinho não basta: os bytes da linha continuariam legíveis nas
    // páginas livres do arquivo (foi exatamente o que um scan pegou na
    // primeira versão deste export). `secure_delete` zera os bytes no DELETE
    // e o VACUUM final reescreve o arquivo sem as páginas soltas.
    copia.pragma_update(None, "secure_delete", "ON")?;
    for &chave in CHAVES_DE_SEGREDO {
        copia.execute("DELETE FROM config WHERE chave = ?1", [chave])?;
    }
    copia.execute("VACUUM", [])?;
    drop(copia);

    std::fs::rename(&tmp, destino)?;
    Ok(())
}

/// Espelha `origem` em `destino`. Nomes são sha256 do conteúdo (contrato de
/// `db::imagens`), então nome igual = conteúdo igual: nunca precisa
/// sobrescrever, só copiar faltante e apagar sobra.
fn espelhar_imagens(origem: &Path, destino: &Path) -> std::io::Result<(usize, usize)> {
    std::fs::create_dir_all(destino)?;
    let nomes_origem: std::collections::HashSet<_> = if origem.is_dir() {
        std::fs::read_dir(origem)?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name())
            .collect()
    } else {
        Default::default()
    };

    let mut copiadas = 0usize;
    for nome in &nomes_origem {
        let alvo = destino.join(nome);
        if !alvo.exists() {
            std::fs::copy(origem.join(nome), &alvo)?;
            copiadas += 1;
        }
    }

    let mut removidas = 0usize;
    for entrada in std::fs::read_dir(destino)? {
        let entrada = entrada?;
        if !nomes_origem.contains(&entrada.file_name()) {
            std::fs::remove_file(entrada.path())?;
            removidas += 1;
        }
    }
    Ok((copiadas, removidas))
}
