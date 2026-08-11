//! Sincronização do banco/imagens com o snapshot empacotado no instalador
//! (`resources/rpg_semente.db` e `resources/imagens_semente/`, resolvidos via
//! `recursos::resolver_recurso` — quem chama este módulo faz essa resolução,
//! pois ela depende do `AppHandle`; aqui dentro só se mexe com `Path`, o que
//! deixa a lógica testável sem precisar subir um app Tauri).
//!
//! Semântica (revisada 2026-08-10 — Modelo A, `docs/plans/2026-08-10-sync-nuvem.md`
//! §2 Q1, que **revoga** a semântica anterior "o que um computador vê todos
//! veem"): **update do app mexe só no app.** A semente é só o *bootstrap* de
//! máquina vazia — depois que o banco tem dado do usuário, a semente nunca
//! mais o toca, em UPDATE nenhum. Sincronizar dado entre PCs passa a ser
//! responsabilidade explícita do usuário via `db::sincronizacao_nuvem`
//! (Fase 1+ do plano), não algo que acontece sozinho num update de instalador.
//!
//! Máquina nova (banco inexistente ou sem NENHUM dado do usuário — zero
//! linhas em `personagem`/`nota`/`mapa`) importa direto: não há o que perder.
//! Banco com dado (inclusive um `rpg.db` corrompido que não abre como SQLite,
//! tratado como "tem dado" por precaução) é sempre no-op — `EmDia`, nunca
//! sobrescrito, nunca precisa de backup porque nada é substituído.
//!
//! Imagens da semente só entram no bootstrap (junto do banco vazio). Um banco
//! com dado não ganha imagens novas da semente — isso também virou tarefa da
//! sincronização de nuvem.

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

/// Tabelas cuja presença de qualquer linha conta como "tem dado do usuário".
/// Cobre fichas (`personagem`), diário de mesa (`nota`) e tabuleiro (`mapa`)
/// — as três superfícies que o usuário edita direto. Catálogos/config não
/// entram: também vêm preenchidos pela semente e não são "dado do jogador"
/// no sentido que motivou essa checagem.
const TABELAS_DE_DADO_DO_USUARIO: [&str; 3] = ["personagem", "nota", "mapa"];

/// O que a sincronização decidiu fazer — só pra log e teste; nenhum chamador
/// muda de rumo por causa disso.
#[derive(Debug, PartialEq, Eq)]
pub enum Sincronizacao {
    /// Sem recurso de semente no bundle (dev sem build, instalador incompleto).
    SemRecurso,
    /// Banco já tem dado do usuário: no-op, a semente não toca (Modelo A).
    EmDia,
    /// Máquina sem dado nenhum: importou sem backup (bootstrap).
    Semeado,
}

/// Sincroniza o banco/imagens locais com a semente do bundle, seguindo a
/// semântica do módulo: só age em bootstrap (banco vazio/inexistente); banco
/// com dado do usuário é sempre no-op (Modelo A — a semente nunca mais
/// sobrescreve depois do primeiro dado gravado). `versao_app` e `marcador`
/// seguem existindo só para marcar QUANDO o bootstrap aconteceu (diagnóstico);
/// não controlam mais se a semente roda ou não. Falha de IO propaga; quem
/// chama (setup) loga e segue — semente nunca derruba o app.
pub fn sincronizar_semente(
    banco_destino: &Path,
    banco_semente: Option<&Path>,
    imagens_destino: &Path,
    imagens_semente: Option<&Path>,
    versao_app: &str,
    marcador: &Path,
) -> std::io::Result<Sincronizacao> {
    let Some(semente) = banco_semente else {
        return Ok(Sincronizacao::SemRecurso);
    };

    // Máquina sem dado: importa direto, sem backup (não há o que perder).
    if !banco_destino.exists() || banco_esta_vazio(banco_destino) {
        copiar_atomico(semente, banco_destino)?;
        limpar_wal_orfao(banco_destino);
        copiar_imagens_faltantes(imagens_destino, imagens_semente)?;
        std::fs::write(marcador, versao_app)?;
        return Ok(Sincronizacao::Semeado);
    }

    // Banco já tem dado do usuário: a semente NUNCA MAIS toca (Modelo A).
    // Update do app é só update do app; dado só muda por sync explícita
    // (ver db::sincronizacao_nuvem).
    Ok(Sincronizacao::EmDia)
}

/// Verdadeiro só quando `banco` abre como SQLite e não tem nenhuma linha nas
/// tabelas de `TABELAS_DE_DADO_DO_USUARIO`. Qualquer erro ao abrir/consultar
/// (corrompido, lock, formato inesperado) conta como "não está vazio" — o
/// caminho com backup é o que preserva evidência.
fn banco_esta_vazio(banco: &Path) -> bool {
    match total_de_linhas_do_usuario(banco) {
        Ok(total) => total == 0,
        Err(e) => {
            eprintln!("[semente] '{}' existe mas não abriu como SQLite: {e}", banco.display());
            false
        }
    }
}

fn total_de_linhas_do_usuario(banco: &Path) -> rusqlite::Result<i64> {
    let conn = Connection::open_with_flags(banco, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut total = 0i64;
    for tabela in TABELAS_DE_DADO_DO_USUARIO {
        total += contar_linhas_se_tabela_existir(&conn, tabela)?;
    }
    Ok(total)
}

/// Conta linhas de `tabela`, tratando tabela ausente (schema de uma versão
/// anterior das migrations, sem essa tabela ainda) como zero em vez de
/// propagar erro de "no such table". Consulta `sqlite_master` antes de
/// contar por isso.
fn contar_linhas_se_tabela_existir(conn: &Connection, tabela: &str) -> rusqlite::Result<i64> {
    let existe: bool = conn.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [tabela],
        |r| r.get(0),
    )?;
    if !existe {
        return Ok(0);
    }
    // `tabela` vem só de TABELAS_DE_DADO_DO_USUARIO (constante interna, nunca
    // input externo) — não dá pra parametrizar nome de tabela com `?`, então
    // esse `format!` é literal fixo do código, não concatenação de dado hostil.
    let sql = format!("SELECT count(*) FROM {tabela}");
    conn.query_row(&sql, [], |r| r.get(0))
}

/// Apaga `<banco>-wal`/`<banco>-shm` órfãos depois de substituir o banco — um
/// WAL apontando pro arquivo antigo corromperia o banco novo na próxima
/// abertura. Defensivo: o projeto não liga `journal_mode=WAL` hoje (ver
/// `db::connection::preparar`), mas a limpeza não custa nada e evita uma
/// classe de bug caso isso mude no futuro. Silencioso: arquivo ausente não é
/// erro.
fn limpar_wal_orfao(banco: &Path) {
    for sufixo in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(caminho_com_sufixo(banco, sufixo));
    }
}

fn caminho_com_sufixo(banco: &Path, sufixo: &str) -> PathBuf {
    let mut nome = banco.as_os_str().to_os_string();
    nome.push(sufixo);
    PathBuf::from(nome)
}

/// Copia via arquivo temporário + rename. Rename é atômico no mesmo volume,
/// então `destino` nunca fica visível pela metade: se `fs::copy` falhar no
/// meio (disco cheio, etc.), o `.tmp` é descartado — no pior caso o destino
/// segue como estava (ou ausente), nunca corrompido pela metade.
fn copiar_atomico(origem: &Path, destino: &Path) -> std::io::Result<()> {
    let tmp = destino.with_extension("tmp");
    let resultado = std::fs::copy(origem, &tmp).and_then(|_| std::fs::rename(&tmp, destino));
    if resultado.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    resultado.map(|_| ())
}

/// Copia pra `destino` os arquivos de `semente` cujo nome ainda não existe lá.
/// Nomes são hash sha256 do conteúdo (ver `db::imagens::salvar_imagem_base64`),
/// então nome igual = conteúdo igual: nunca sobrescreve, nunca apaga nada.
fn copiar_imagens_faltantes(destino: &Path, semente: Option<&Path>) -> std::io::Result<()> {
    let Some(semente) = semente else {
        return Ok(());
    };
    if !semente.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(destino)?;
    for entrada in std::fs::read_dir(semente)? {
        let entrada = entrada?;
        let alvo = destino.join(entrada.file_name());
        if !alvo.exists() {
            copiar_atomico(&entrada.path(), &alvo)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Diretório de trabalho isolado em `%TEMP%`, limpo antes de cada teste —
    /// nunca toca no `app_data_dir` real do usuário.
    fn dir_teste(sufixo: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rpgv2_test_semente_{sufixo}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct Cenario {
        banco_destino: PathBuf,
        imagens_destino: PathBuf,
        marcador: PathBuf,
        origem_banco: PathBuf,
    }

    fn cenario(sufixo: &str, conteudo_semente: &[u8]) -> Cenario {
        let raiz = dir_teste(sufixo);
        let origem_banco = raiz.join("origem.db");
        std::fs::write(&origem_banco, conteudo_semente).unwrap();
        let banco_destino = raiz.join("app_data").join("rpg.db");
        std::fs::create_dir_all(banco_destino.parent().unwrap()).unwrap();
        Cenario {
            imagens_destino: raiz.join("app_data").join("images"),
            marcador: raiz.join("app_data").join("semente_importada.txt"),
            banco_destino,
            origem_banco,
        }
    }

    fn sincronizar(c: &Cenario, versao: &str) -> Sincronizacao {
        sincronizar_semente(
            &c.banco_destino,
            Some(&c.origem_banco),
            &c.imagens_destino,
            None,
            versao,
            &c.marcador,
        )
        .unwrap()
    }

    fn backups(c: &Cenario) -> Vec<PathBuf> {
        std::fs::read_dir(c.banco_destino.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().unwrap().to_string_lossy().contains(".bak-"))
            .collect()
    }

    #[test]
    fn semeia_banco_e_imagens_e_marcador_quando_destino_vazio() {
        let raiz = dir_teste("vazio");
        let origem_banco = raiz.join("origem.db");
        std::fs::write(&origem_banco, b"conteudo do banco semente").unwrap();
        let origem_imagens = raiz.join("origem_imagens");
        std::fs::create_dir_all(&origem_imagens).unwrap();
        std::fs::write(origem_imagens.join("aaa.png"), b"imagem 1").unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        let imagens_destino = raiz.join("app_data").join("images");
        let marcador = raiz.join("app_data").join("semente_importada.txt");
        std::fs::create_dir_all(banco_destino.parent().unwrap()).unwrap();

        let r = sincronizar_semente(
            &banco_destino,
            Some(&origem_banco),
            &imagens_destino,
            Some(&origem_imagens),
            "0.2.0",
            &marcador,
        )
        .unwrap();

        assert_eq!(r, Sincronizacao::Semeado);
        assert_eq!(std::fs::read(&banco_destino).unwrap(), b"conteudo do banco semente");
        assert_eq!(std::fs::read(imagens_destino.join("aaa.png")).unwrap(), b"imagem 1");
        assert_eq!(std::fs::read_to_string(&marcador).unwrap(), "0.2.0");
    }

    #[test]
    fn nao_toca_banco_quando_marcador_ja_e_desta_versao() {
        let c = cenario("em_dia", b"semente qualquer");
        std::fs::write(&c.banco_destino, b"dados reais do usuario").unwrap();
        // marcador diz que 0.2.0 já importou aqui
        std::fs::write(&c.marcador, "0.2.0").unwrap();

        assert_eq!(sincronizar(&c, "0.2.0"), Sincronizacao::EmDia);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"dados reais do usuario");
        assert!(backups(&c).is_empty());
    }

    /// Modelo A (2026-08-10): banco com dado do usuário é sempre no-op, mesmo
    /// num update de verdade (marcador de versão antiga). A semente NUNCA MAIS
    /// substitui depois do primeiro dado gravado — isso é o ponto central da
    /// mudança de semântica, então este teste é o mais sensível do módulo.
    #[test]
    fn update_com_banco_de_dados_do_usuario_nao_sobrescreve() {
        let c = cenario("update", b"banco da versao nova");
        std::fs::write(&c.banco_destino, b"banco antigo com dados do usuario").unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        let r = sincronizar(&c, "0.2.0");

        assert_eq!(r, Sincronizacao::EmDia);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"banco antigo com dados do usuario");
        assert!(backups(&c).is_empty(), "no-op não precisa de backup: nada foi substituído");
    }

    #[test]
    fn banco_sem_marcador_mas_com_dado_tambem_nao_e_sobrescrito() {
        // máquina que instalou versão anterior ao marcador existir: tem dado,
        // não tem marcador — mesmo assim entra no no-op (dado sempre vence).
        let c = cenario("sem_marcador", b"banco da versao nova");
        std::fs::write(&c.banco_destino, b"dados de antes do marcador existir").unwrap();

        let r = sincronizar(&c, "0.2.0");

        assert_eq!(r, Sincronizacao::EmDia);
        assert!(backups(&c).is_empty());
        assert_eq!(
            std::fs::read(&c.banco_destino).unwrap(),
            b"dados de antes do marcador existir"
        );
    }

    #[test]
    fn conteudo_identico_ao_da_semente_tambem_e_no_op() {
        let c = cenario("identico", b"mesmo conteudo dos dois lados");
        std::fs::write(&c.banco_destino, b"mesmo conteudo dos dois lados").unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        assert_eq!(sincronizar(&c, "0.2.0"), Sincronizacao::EmDia);
        assert!(backups(&c).is_empty());
    }

    #[test]
    fn nao_falha_quando_recurso_semente_ausente() {
        let raiz = dir_teste("sem_recurso");
        let banco_destino = raiz.join("app_data").join("rpg.db");
        let marcador = raiz.join("app_data").join("m.txt");

        let r = sincronizar_semente(
            &banco_destino,
            None,
            &raiz.join("app_data").join("images"),
            None,
            "0.2.0",
            &marcador,
        )
        .unwrap();

        assert_eq!(r, Sincronizacao::SemRecurso);
        assert!(!banco_destino.exists());
        assert!(!marcador.exists());
    }

    #[test]
    fn banco_existente_mas_vazio_por_dentro_semeia_sem_backup() {
        let c = cenario("vazio_por_dentro", b"banco semente de verdade");
        // simula instalador anterior: migrations rodaram, ninguém salvou nada.
        drop(crate::db::connection::open(&c.banco_destino).unwrap());

        assert_eq!(sincronizar(&c, "0.2.0"), Sincronizacao::Semeado);
        assert!(backups(&c).is_empty());
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"banco semente de verdade");
    }

    #[test]
    fn banco_com_personagem_nunca_e_sobrescrito_pela_semente() {
        let c = cenario("com_personagem", b"snapshot novo do master");
        {
            let conn = crate::db::connection::open(&c.banco_destino).unwrap();
            conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Teste')", [])
                .unwrap();
        }
        let bytes_antes = std::fs::read(&c.banco_destino).unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        let r = sincronizar(&c, "0.2.0");

        assert_eq!(r, Sincronizacao::EmDia);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), bytes_antes);
        assert!(backups(&c).is_empty());
    }

    #[test]
    fn arquivo_que_nao_e_sqlite_tambem_conta_como_tem_dado_e_fica_intocado() {
        let c = cenario("nao_sqlite", b"semente saudavel");
        let lixo: &[u8] = &[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0xFF];
        std::fs::write(&c.banco_destino, lixo).unwrap();

        let r = sincronizar(&c, "0.2.0");

        // corrompido conta como "tem dado" (por precaução) -> no-op, não vira semente
        assert_eq!(r, Sincronizacao::EmDia);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), lixo);
        assert!(backups(&c).is_empty());
    }

    #[test]
    fn imagens_sao_aditivas_nunca_sobrescrevem() {
        let raiz = dir_teste("imagens");
        let origem_banco = raiz.join("origem.db");
        std::fs::write(&origem_banco, b"semente").unwrap();
        let origem_imagens = raiz.join("origem_imagens");
        std::fs::create_dir_all(&origem_imagens).unwrap();
        std::fs::write(origem_imagens.join("existente.png"), b"conteudo da semente").unwrap();
        std::fs::write(origem_imagens.join("nova.png"), b"imagem nova").unwrap();

        let banco_destino = raiz.join("app_data").join("rpg.db");
        let imagens_destino = raiz.join("app_data").join("images");
        std::fs::create_dir_all(&imagens_destino).unwrap();
        std::fs::write(imagens_destino.join("existente.png"), b"conteudo local").unwrap();

        sincronizar_semente(
            &banco_destino,
            Some(&origem_banco),
            &imagens_destino,
            Some(&origem_imagens),
            "0.2.0",
            &raiz.join("app_data").join("m.txt"),
        )
        .unwrap();

        assert_eq!(
            std::fs::read(imagens_destino.join("existente.png")).unwrap(),
            b"conteudo local"
        );
        assert_eq!(std::fs::read(imagens_destino.join("nova.png")).unwrap(), b"imagem nova");
    }
}
