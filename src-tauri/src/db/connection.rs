use crate::db::error::AppError;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.0.lock().map_err(|_| AppError::Msg("lock envenenado".into()))
    }
}

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init.sql")),
        M::up(include_str!("../../migrations/0002_habilidade_combate.sql")),
        M::up(include_str!("../../migrations/0003_mapa.sql")),
        M::up(include_str!("../../migrations/0004_nota.sql")),
        M::up(include_str!("../../migrations/0005_favorito.sql")),
        M::up(include_str!("../../migrations/0006_config.sql")),
        M::up(include_str!("../../migrations/0007_batalha_ativa.sql")),
        M::up(include_str!("../../migrations/0008_mapa_remove_ordem.sql")),
        M::up(include_str!("../../migrations/0009_etiqueta.sql")),
        M::up(include_str!("../../migrations/0010_batalha_salva.sql")),
        M::up(include_str!(
            "../../migrations/0011_habilidade_acao_efeito_extras.sql"
        )),
        M::up(include_str!("../../migrations/0012_sync_revisao.sql")),
    ])
}

fn preparar(mut conn: Connection) -> Result<Connection, AppError> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations()
        .to_latest(&mut conn)
        .map_err(|e| AppError::Msg(format!("migration: {e}")))?;
    Ok(conn)
}

pub fn open(path: &Path) -> Result<Connection, AppError> {
    preparar(Connection::open(path)?)
}

/// Banco SQLite em memória, com migrations aplicadas. Usado pelos testes de
/// todo o crate e também como placeholder de `db::sincronizacao_nuvem` /
/// `lib.rs::sync_baixar`: no Windows não dá pra `rename` por cima de um
/// arquivo com handle aberto, então a conexão viva precisa ser trocada por
/// esta (breve) antes de materializar o pacote baixado e reaberta depois.
pub fn open_in_memory() -> Result<Connection, AppError> {
    preparar(Connection::open_in_memory()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_sao_validas() {
        assert!(migrations().validate().is_ok());
    }

    #[test]
    fn aplica_e_cria_tabelas() {
        let conn = open_in_memory().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN (
                 'imagem','personagem','habilidade','personagem_pericia','personagem_vantagem',
                 'personagem_desvantagem','transformacao','transformacao_modificador',
                 'transformacao_habilidade','catalogo_pericia','catalogo_vantagem','catalogo_desvantagem')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 12);
    }
}
