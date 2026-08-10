//! Sincronização do banco/imagens com o snapshot empacotado no instalador
//! (`resources/rpg_semente.db` e `resources/imagens_semente/`, resolvidos via
//! `recursos::resolver_recurso` — quem chama este módulo faz essa resolução,
//! pois ela depende do `AppHandle`; aqui dentro só se mexe com `Path`, o que
//! deixa a lógica testável sem precisar subir um app Tauri).
//!
//! Semântica (decisão do usuário, 2026-08-10): **"o que um computador vê,
//! todos veem"**. A máquina master exporta a semente ao publicar; nas outras,
//! cada UPDATE do app substitui o banco local pelo snapshot novo — com backup
//! automático antes (`rpg.db.bak-*`), porque sobrescrever é destrutivo por
//! definição. O controle de "este instalador já importou aqui?" é um marcador
//! em `semente_importada.txt` com a versão do app; sem tocar o app, nada roda
//! duas vezes.
//!
//! Máquina nova (banco inexistente ou sem NENHUM dado do usuário — zero
//! linhas em `personagem`/`nota`/`mapa`) importa direto, sem backup: não há o
//! que perder. Um `rpg.db` que existe mas não abre como SQLite é tratado como
//! "tem dado": backup + substituição (o backup preserva a evidência).
//!
//! Imagens são sempre ADITIVAS (nome = sha256 do conteúdo, nunca sobrescreve
//! nem apaga) — retrato órfão no destino é inofensivo e barato.

use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
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
    /// Marcador já é desta versão do app — nada a fazer.
    EmDia,
    /// Máquina sem dado nenhum: importou sem backup.
    Semeado,
    /// Banco local idêntico à semente (sha256): só marcador + imagens.
    PuladoIdentico,
    /// Substituiu o banco local; backup em `PathBuf`.
    Substituido(PathBuf),
}

/// Sincroniza o banco/imagens locais com a semente do bundle, seguindo a
/// semântica do módulo. `versao_app` é a versão do instalador atual;
/// `marcador` é o arquivo que guarda a última versão importada nesta máquina.
/// Falha de IO propaga; quem chama (setup) loga e segue — semente nunca
/// derruba o app.
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

    // Este instalador já importou aqui — não roda duas vezes.
    let ja_importada = std::fs::read_to_string(marcador)
        .map(|v| v.trim() == versao_app)
        .unwrap_or(false);
    if ja_importada {
        return Ok(Sincronizacao::EmDia);
    }

    // Conteúdo idêntico (caso típico da máquina master logo após publicar):
    // não vale um backup de si mesmo.
    if sha256_do_arquivo(banco_destino).ok() == sha256_do_arquivo(semente).ok()
        && sha256_do_arquivo(semente).is_ok()
    {
        copiar_imagens_faltantes(imagens_destino, imagens_semente)?;
        std::fs::write(marcador, versao_app)?;
        return Ok(Sincronizacao::PuladoIdentico);
    }

    // Update de verdade: backup e substitui.
    let backup = caminho_backup(banco_destino, versao_app);
    std::fs::copy(banco_destino, &backup)?;
    copiar_atomico(semente, banco_destino)?;
    limpar_wal_orfao(banco_destino);
    copiar_imagens_faltantes(imagens_destino, imagens_semente)?;
    std::fs::write(marcador, versao_app)?;
    Ok(Sincronizacao::Substituido(backup))
}

/// `rpg.db.bak-<versao_nova>-<epoch_segundos>` ao lado do banco. A versão no
/// nome é a que SUBSTITUIU (a do instalador rodando) — é o que se procura na
/// prática: "o update pra 0.3.0 comeu minha edição, cadê o banco de antes?".
fn caminho_backup(banco: &Path, versao_app: &str) -> PathBuf {
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    caminho_com_sufixo(banco, &format!(".bak-{versao_app}-{epoch}"))
}

fn sha256_do_arquivo(caminho: &Path) -> std::io::Result<[u8; 32]> {
    let bytes = std::fs::read(caminho)?;
    Ok(Sha256::digest(&bytes).into())
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

    #[test]
    fn update_substitui_banco_com_backup_e_atualiza_marcador() {
        let c = cenario("update", b"banco da versao nova");
        std::fs::write(&c.banco_destino, b"banco antigo com dados do usuario").unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        let r = sincronizar(&c, "0.2.0");

        let Sincronizacao::Substituido(backup) = r else {
            panic!("esperava Substituido, veio {r:?}");
        };
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"banco da versao nova");
        assert_eq!(std::fs::read(&backup).unwrap(), b"banco antigo com dados do usuario");
        assert!(backup.to_string_lossy().contains(".bak-0.2.0-"));
        assert_eq!(std::fs::read_to_string(&c.marcador).unwrap(), "0.2.0");
    }

    #[test]
    fn banco_sem_marcador_mas_com_dado_e_tratado_como_update() {
        // máquina que instalou versão anterior ao marcador existir: tem dado,
        // não tem marcador — precisa entrar na semântica nova (backup + troca).
        let c = cenario("sem_marcador", b"banco da versao nova");
        std::fs::write(&c.banco_destino, b"dados de antes do marcador existir").unwrap();

        let r = sincronizar(&c, "0.2.0");

        assert!(matches!(r, Sincronizacao::Substituido(_)));
        assert_eq!(backups(&c).len(), 1);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"banco da versao nova");
    }

    #[test]
    fn conteudo_identico_so_atualiza_marcador_sem_backup() {
        let c = cenario("identico", b"mesmo conteudo dos dois lados");
        std::fs::write(&c.banco_destino, b"mesmo conteudo dos dois lados").unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        assert_eq!(sincronizar(&c, "0.2.0"), Sincronizacao::PuladoIdentico);
        assert!(backups(&c).is_empty());
        assert_eq!(std::fs::read_to_string(&c.marcador).unwrap(), "0.2.0");
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
    fn banco_com_personagem_e_substituido_no_update_mas_preservado_no_backup() {
        let c = cenario("com_personagem", b"snapshot novo do master");
        {
            let conn = crate::db::connection::open(&c.banco_destino).unwrap();
            conn.execute("INSERT INTO personagem (tipo, nome) VALUES ('npc', 'Teste')", [])
                .unwrap();
        }
        let bytes_antes = std::fs::read(&c.banco_destino).unwrap();
        std::fs::write(&c.marcador, "0.1.0").unwrap();

        let r = sincronizar(&c, "0.2.0");

        let Sincronizacao::Substituido(backup) = r else {
            panic!("esperava Substituido, veio {r:?}");
        };
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"snapshot novo do master");
        assert_eq!(std::fs::read(&backup).unwrap(), bytes_antes);
    }

    #[test]
    fn arquivo_que_nao_e_sqlite_ganha_backup_antes_de_ser_substituido() {
        let c = cenario("nao_sqlite", b"semente saudavel");
        let lixo: &[u8] = &[0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0xFF];
        std::fs::write(&c.banco_destino, lixo).unwrap();

        let r = sincronizar(&c, "0.2.0");

        // corrompido conta como "tem dado" -> backup preserva a evidência
        let Sincronizacao::Substituido(backup) = r else {
            panic!("esperava Substituido, veio {r:?}");
        };
        assert_eq!(std::fs::read(&backup).unwrap(), lixo);
        assert_eq!(std::fs::read(&c.banco_destino).unwrap(), b"semente saudavel");
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
