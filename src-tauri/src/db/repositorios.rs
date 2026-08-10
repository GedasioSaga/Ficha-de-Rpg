use crate::db::error::AppError;
use crate::db::imagens;
use crate::domain::batalha::Estado;
use crate::domain::mapa::{
    normalizar, normalizar_grade, Mapa, MapaInput, MapaResumo, COLUNAS_MAX, COLUNAS_MIN,
    LINHAS_MAX, LINHAS_MIN,
};
use crate::domain::modelos::{
    AtributoRank, CampoExtra, CatalogoPericia, CatalogoPericiaInput, CatalogoTraco,
    CatalogoTracoInput, Catalogos, Etiqueta, EtiquetaInput, Favorito, FavoritoInput, HabilidadeDto,
    ModificadorDto, Nota, NotaInput, NotaResumo, PericiaDto, PersonagemCompleto, PersonagemInput,
    PersonagemResumo, TracoDto, TransformacaoDto,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

/// Nomes dos 8 atributos na ordem fixa da ficha.
const ATRIBUTOS: [&str; 8] = [
    "forca",
    "agilidade",
    "percepcao",
    "resistencia",
    "intuicao",
    "espirito",
    "carisma",
    "determinacao",
];

pub struct NovoPersonagem {
    pub tipo: String,
    pub nome: String,
    pub descricao: String,
    pub hp: i64,
    pub sp: i64,
    pub escudo: i64,
    pub forca: i64,
    pub agilidade: i64,
    pub percepcao: i64,
    pub resistencia: i64,
    pub intuicao: i64,
    pub espirito: i64,
    pub carisma: i64,
    pub determinacao: i64,
    pub retrato_id: Option<i64>,
}

pub fn inserir_personagem(conn: &Connection, p: &NovoPersonagem) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO personagem
         (tipo,nome,descricao,hp,sp,escudo,forca,agilidade,percepcao,resistencia,
          intuicao,espirito,carisma,determinacao,retrato_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            p.tipo, p.nome, p.descricao, p.hp, p.sp, p.escudo,
            p.forca, p.agilidade, p.percepcao, p.resistencia,
            p.intuicao, p.espirito, p.carisma, p.determinacao, p.retrato_id
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

fn linha_para_resumo(row: &Row) -> rusqlite::Result<PersonagemResumo> {
    Ok(PersonagemResumo {
        id: row.get(0)?,
        tipo: row.get(1)?,
        nome: row.get(2)?,
        retrato: row.get(3)?,
        forca: row.get(4)?,
        agilidade: row.get(5)?,
        percepcao: row.get(6)?,
        resistencia: row.get(7)?,
        intuicao: row.get(8)?,
        espirito: row.get(9)?,
        carisma: row.get(10)?,
        determinacao: row.get(11)?,
        etiquetas: Vec::new(), // preenchido depois, em lote (ver listar_personagens)
    })
}

pub fn listar_personagens(
    conn: &Connection,
    tipo: Option<&str>,
) -> Result<Vec<PersonagemResumo>, AppError> {
    let base = "SELECT p.id,p.tipo,p.nome,i.caminho,p.forca,p.agilidade,p.percepcao,\
                p.resistencia,p.intuicao,p.espirito,p.carisma,p.determinacao \
                FROM personagem p LEFT JOIN imagem i ON i.id = p.retrato_id";
    let mut out = match tipo {
        Some(t) => {
            let mut stmt = conn.prepare(&format!("{base} WHERE p.tipo = ?1 ORDER BY p.nome"))?;
            let r = stmt
                .query_map([t], linha_para_resumo)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            r
        }
        None => {
            let mut stmt = conn.prepare(&format!("{base} ORDER BY p.nome"))?;
            let r = stmt
                .query_map([], linha_para_resumo)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            r
        }
    };

    // Uma query só pro vínculo inteiro (em vez de N+1): a galeria e a Batalha
    // pedem a lista completa a cada render de filtro.
    let mut por_personagem = etiquetas_por_personagem(conn)?;
    for p in &mut out {
        if let Some(nomes) = por_personagem.remove(&p.id) {
            p.etiquetas = nomes;
        }
    }
    Ok(out)
}

/// Mapa `personagem_id -> nomes de etiqueta` (ordenados por nome).
fn etiquetas_por_personagem(
    conn: &Connection,
) -> Result<std::collections::HashMap<i64, Vec<String>>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT pe.personagem_id, e.nome FROM personagem_etiqueta pe \
         JOIN etiqueta e ON e.id = pe.etiqueta_id ORDER BY e.nome",
    )?;
    let mut mapa: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    let linhas = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (pid, nome) in linhas {
        mapa.entry(pid).or_default().push(nome);
    }
    Ok(mapa)
}

/// Nomes das etiquetas de um personagem (ordenados por nome).
pub fn etiquetas_do_personagem(
    conn: &Connection,
    personagem_id: i64,
) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT e.nome FROM personagem_etiqueta pe \
         JOIN etiqueta e ON e.id = pe.etiqueta_id \
         WHERE pe.personagem_id = ?1 ORDER BY e.nome",
    )?;
    let out = stmt
        .query_map([personagem_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Campos escalares da linha `personagem` (os 8 atributos em `valores`,
/// na ordem de [`ATRIBUTOS`]).
struct LinhaBase {
    tipo: String,
    nome: String,
    descricao: String,
    hp: i64,
    sp: i64,
    escudo: i64,
    valores: [i64; 8],
    retrato: Option<String>,
}

/// Monta a ficha completa de um personagem (com rank calculado por atributo).
/// `Err(AppError::Msg)` se o id não existir.
pub fn get_personagem(conn: &Connection, id: i64) -> Result<PersonagemCompleto, AppError> {
    let base = conn
        .query_row(
            "SELECT p.tipo,p.nome,p.descricao,p.hp,p.sp,p.escudo,\
             p.forca,p.agilidade,p.percepcao,p.resistencia,p.intuicao,p.espirito,p.carisma,p.determinacao,\
             i.caminho \
             FROM personagem p LEFT JOIN imagem i ON i.id = p.retrato_id \
             WHERE p.id = ?1",
            [id],
            |r| {
                Ok(LinhaBase {
                    tipo: r.get(0)?,
                    nome: r.get(1)?,
                    descricao: r.get(2)?,
                    hp: r.get(3)?,
                    sp: r.get(4)?,
                    escudo: r.get(5)?,
                    valores: [
                        r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                        r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    ],
                    retrato: r.get(14)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| AppError::Msg("personagem não encontrado".into()))?;

    let atributos = ATRIBUTOS
        .iter()
        .zip(base.valores)
        .map(|(&nome, valor)| AtributoRank {
            nome: nome.to_string(),
            valor,
            rank: crate::domain::rank::calcular_rank(nome, valor),
        })
        .collect();

    Ok(PersonagemCompleto {
        id,
        tipo: base.tipo,
        nome: base.nome,
        descricao: base.descricao,
        hp: base.hp,
        sp: base.sp,
        escudo: base.escudo,
        retrato: base.retrato,
        atributos,
        habilidades: carregar_habilidades(conn, id)?,
        pericias: carregar_pericias(conn, id)?,
        vantagens: carregar_tracos(conn, id, "personagem_vantagem")?,
        desvantagens: carregar_tracos(conn, id, "personagem_desvantagem")?,
        transformacoes: carregar_transformacoes(conn, id)?,
        etiquetas: etiquetas_do_personagem(conn, id)?,
    })
}

/// Decodifica a coluna `campos_extras`. O banco é do usuário: JSON quebrado,
/// NULL ou vazio vira lista vazia em vez de derrubar a ficha inteira.
fn decodificar_campos_extras(bruto: Option<String>) -> Vec<CampoExtra> {
    let Some(json) = bruto.as_deref().filter(|s| !s.trim().is_empty()) else {
        return Vec::new();
    };
    match serde_json::from_str(json) {
        Ok(campos) => campos,
        // O save é replace-all: sem esse rastro, o conteúdo ilegível some no
        // primeiro save sem deixar sinal nenhum (ver quarentena em lib.rs).
        Err(e) => {
            eprintln!("[campos_extras] JSON ilegível descartado ({e}): {json}");
            Vec::new()
        }
    }
}

/// Codifica os campos personalizados pra coluna. Falha de serialização (não
/// acontece com `Vec<CampoExtra>`) vira lista vazia, nunca aborta o save.
fn codificar_campos_extras(campos: &[CampoExtra]) -> String {
    serde_json::to_string(campos).unwrap_or_else(|_| "[]".into())
}

fn carregar_habilidades(
    conn: &Connection,
    personagem_id: i64,
) -> Result<Vec<HabilidadeDto>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT nome,descricao,acao,efeito,tempo,custo,dano,campos_extras FROM habilidade \
         WHERE personagem_id=?1 ORDER BY ordem",
    )?;
    let out = stmt
        .query_map([personagem_id], |r| {
            Ok(HabilidadeDto {
                nome: r.get(0)?,
                descricao: r.get(1)?,
                acao: r.get(2)?,
                efeito: r.get(3)?,
                tempo: r.get(4)?,
                custo: r.get(5)?,
                dano: r.get(6)?,
                // `.ok().flatten()`: nem tipo inesperado na coluna derruba a leitura.
                campos_extras: decodificar_campos_extras(
                    r.get::<_, Option<String>>(7).ok().flatten(),
                ),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

fn carregar_pericias(conn: &Connection, personagem_id: i64) -> Result<Vec<PericiaDto>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT nome,descricao,atributo,nivel FROM personagem_pericia \
         WHERE personagem_id=?1 ORDER BY id",
    )?;
    let out = stmt
        .query_map([personagem_id], |r| {
            Ok(PericiaDto {
                nome: r.get(0)?,
                descricao: r.get(1)?,
                atributo: r.get(2)?,
                nivel: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

fn carregar_tracos(
    conn: &Connection,
    personagem_id: i64,
    tabela: &str,
) -> Result<Vec<TracoDto>, AppError> {
    // `tabela` é sempre um literal interno controlado, nunca input do usuário.
    let sql =
        format!("SELECT nome,descricao,efeito FROM {tabela} WHERE personagem_id=?1 ORDER BY id");
    let mut stmt = conn.prepare(&sql)?;
    let out = stmt
        .query_map([personagem_id], |r| {
            Ok(TracoDto {
                nome: r.get(0)?,
                descricao: r.get(1)?,
                efeito: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

fn carregar_transformacoes(
    conn: &Connection,
    personagem_id: i64,
) -> Result<Vec<TransformacaoDto>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.id,t.nome,t.descricao,i.caminho \
         FROM transformacao t LEFT JOIN imagem i ON i.id = t.imagem_id \
         WHERE t.personagem_id=?1 ORDER BY t.ordem",
    )?;
    // Coleta as linhas antes das consultas aninhadas (não dá pra reusar `conn`
    // dentro do closure de `query_map`).
    let linhas = stmt
        .query_map([personagem_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut out = Vec::with_capacity(linhas.len());
    for (tid, nome, descricao, retrato) in linhas {
        out.push(TransformacaoDto {
            nome,
            descricao,
            retrato,
            modificadores: carregar_modificadores(conn, tid)?,
            habilidades: carregar_habilidades_transformacao(conn, tid)?,
        });
    }
    Ok(out)
}

fn carregar_modificadores(
    conn: &Connection,
    transformacao_id: i64,
) -> Result<Vec<ModificadorDto>, AppError> {
    let mut stmt = conn
        .prepare("SELECT atributo,delta FROM transformacao_modificador WHERE transformacao_id=?1")?;
    let out = stmt
        .query_map([transformacao_id], |r| {
            Ok(ModificadorDto { atributo: r.get(0)?, delta: r.get(1)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

fn carregar_habilidades_transformacao(
    conn: &Connection,
    transformacao_id: i64,
) -> Result<Vec<HabilidadeDto>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT nome,descricao,acao,efeito,tempo,custo,dano,campos_extras \
         FROM transformacao_habilidade WHERE transformacao_id=?1",
    )?;
    let out = stmt
        .query_map([transformacao_id], |r| {
            Ok(HabilidadeDto {
                nome: r.get(0)?,
                descricao: r.get(1)?,
                acao: r.get(2)?,
                efeito: r.get(3)?,
                tempo: r.get(4)?,
                custo: r.get(5)?,
                dano: r.get(6)?,
                campos_extras: decodificar_campos_extras(
                    r.get::<_, Option<String>>(7).ok().flatten(),
                ),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/* ------------------------------ Escrita (CRUD) ---------------------------- */

fn validar(input: &PersonagemInput) -> Result<(), AppError> {
    if input.nome.trim().is_empty() {
        return Err(AppError::Msg("nome obrigatório".into()));
    }
    if input.tipo != "jogador" && input.tipo != "npc" {
        return Err(AppError::Msg("tipo inválido".into()));
    }
    Ok(())
}

/// Insere um personagem novo com todas as coleções. Espera-se estar dentro de
/// uma transação (o comando Tauri abre uma por save).
pub fn criar_personagem(
    conn: &Connection,
    images_dir: &Path,
    input: &PersonagemInput,
) -> Result<i64, AppError> {
    validar(input)?;
    let retrato_id = imagens::resolver_retrato(conn, images_dir, &input.retrato)?;
    let np = NovoPersonagem {
        tipo: input.tipo.clone(),
        nome: input.nome.clone(),
        descricao: input.descricao.clone(),
        hp: input.hp,
        sp: input.sp,
        escudo: input.escudo,
        forca: input.forca,
        agilidade: input.agilidade,
        percepcao: input.percepcao,
        resistencia: input.resistencia,
        intuicao: input.intuicao,
        espirito: input.espirito,
        carisma: input.carisma,
        determinacao: input.determinacao,
        retrato_id,
    };
    let pid = inserir_personagem(conn, &np)?;
    escrever_colecoes(conn, images_dir, pid, input)?;
    Ok(pid)
}

/// Atualiza um personagem existente com replace-all das coleções.
/// `Err` se o id não existir.
pub fn atualizar_personagem(
    conn: &Connection,
    images_dir: &Path,
    id: i64,
    input: &PersonagemInput,
) -> Result<(), AppError> {
    validar(input)?;
    let retrato_id = imagens::resolver_retrato(conn, images_dir, &input.retrato)?;
    let n = conn.execute(
        "UPDATE personagem SET \
         tipo=?1,nome=?2,descricao=?3,hp=?4,sp=?5,escudo=?6,\
         forca=?7,agilidade=?8,percepcao=?9,resistencia=?10,\
         intuicao=?11,espirito=?12,carisma=?13,determinacao=?14,\
         retrato_id=?15,atualizado_em=datetime('now') WHERE id=?16",
        params![
            input.tipo, input.nome, input.descricao, input.hp, input.sp, input.escudo,
            input.forca, input.agilidade, input.percepcao, input.resistencia,
            input.intuicao, input.espirito, input.carisma, input.determinacao,
            retrato_id, id
        ],
    )?;
    if n == 0 {
        return Err(AppError::Msg("personagem não encontrado".into()));
    }
    escrever_colecoes(conn, images_dir, id, input)?;
    Ok(())
}

/// Zera e reinsere todas as coleções filhas do personagem (replace-all).
/// Idempotente no `criar` (o delete não acerta nada).
fn escrever_colecoes(
    conn: &Connection,
    images_dir: &Path,
    pid: i64,
    input: &PersonagemInput,
) -> Result<(), AppError> {
    // Nomes de tabela são literais internos controlados, nunca input do usuário.
    // `transformacao` derruba seus filhos por ON DELETE CASCADE.
    for tabela in [
        "habilidade",
        "personagem_pericia",
        "personagem_vantagem",
        "personagem_desvantagem",
        "transformacao",
    ] {
        conn.execute(&format!("DELETE FROM {tabela} WHERE personagem_id=?1"), [pid])?;
    }

    for (ordem, h) in input.habilidades.iter().enumerate() {
        conn.execute(
            "INSERT INTO habilidade \
             (personagem_id,nome,descricao,ordem,acao,efeito,tempo,custo,dano,campos_extras) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                pid,
                h.nome,
                h.descricao,
                ordem as i64,
                h.acao,
                h.efeito,
                h.tempo,
                h.custo,
                h.dano,
                codificar_campos_extras(&h.campos_extras)
            ],
        )?;
    }
    for p in &input.pericias {
        conn.execute(
            "INSERT INTO personagem_pericia (personagem_id,nome,descricao,atributo,nivel) \
             VALUES (?1,?2,?3,?4,?5)",
            params![pid, p.nome, p.descricao, p.atributo, p.nivel],
        )?;
    }
    for (lista, tabela) in [
        (&input.vantagens, "personagem_vantagem"),
        (&input.desvantagens, "personagem_desvantagem"),
    ] {
        for v in lista {
            conn.execute(
                &format!(
                    "INSERT INTO {tabela} (personagem_id,nome,descricao,efeito) VALUES (?1,?2,?3,?4)"
                ),
                params![pid, v.nome, v.descricao, v.efeito],
            )?;
        }
    }
    for (ordem, t) in input.transformacoes.iter().enumerate() {
        let img = imagens::resolver_retrato(conn, images_dir, &t.retrato)?;
        conn.execute(
            "INSERT INTO transformacao (personagem_id,nome,descricao,imagem_id,ordem) \
             VALUES (?1,?2,?3,?4,?5)",
            params![pid, t.nome, t.descricao, img, ordem as i64],
        )?;
        let tid = conn.last_insert_rowid();
        for m in &t.modificadores {
            conn.execute(
                "INSERT INTO transformacao_modificador (transformacao_id,atributo,delta) \
                 VALUES (?1,?2,?3)",
                params![tid, m.atributo, m.delta],
            )?;
        }
        for h in &t.habilidades {
            conn.execute(
                "INSERT INTO transformacao_habilidade \
                 (transformacao_id,nome,descricao,acao,efeito,tempo,custo,dano,campos_extras) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    tid,
                    h.nome,
                    h.descricao,
                    h.acao,
                    h.efeito,
                    h.tempo,
                    h.custo,
                    h.dano,
                    codificar_campos_extras(&h.campos_extras)
                ],
            )?;
        }
    }
    escrever_etiquetas(conn, pid, &input.tipo, &input.etiquetas)?;
    Ok(())
}

/* --------------------------------- Etiquetas ------------------------------- */

/// Paleta fixa aceita em `etiqueta.cor`. O frontend mapeia token → classes
/// Tailwind; validar aqui impede token inventado virar chip sem cor na UI.
const CORES_ETIQUETA: [&str; 8] = [
    "slate", "rose", "amber", "emerald", "sky", "violet", "orange", "cyan",
];

fn validar_cor(cor: &str) -> Result<String, AppError> {
    let c = cor.trim();
    if c.is_empty() {
        return Ok("slate".into());
    }
    if !CORES_ETIQUETA.contains(&c) {
        return Err(AppError::Msg(format!("cor inválida: {c}")));
    }
    Ok(c.to_string())
}

fn validar_nome_etiqueta(nome: &str) -> Result<String, AppError> {
    let n = nome.trim();
    if n.is_empty() {
        return Err(AppError::Msg("nome da etiqueta obrigatório".into()));
    }
    Ok(n.to_string())
}

/// Devolve o id da etiqueta com esse nome, criando se não existir.
/// A coluna é `UNIQUE COLLATE NOCASE`, então "Marinha" e "marinha" caem na mesma.
fn etiqueta_upsert(conn: &Connection, nome: &str) -> Result<i64, AppError> {
    if let Some(id) = conn
        .query_row("SELECT id FROM etiqueta WHERE nome = ?1", [nome], |r| {
            r.get::<_, i64>(0)
        })
        .optional()?
    {
        return Ok(id);
    }
    conn.execute("INSERT INTO etiqueta (nome) VALUES (?1)", [nome])?;
    Ok(conn.last_insert_rowid())
}

/// Replace-all do vínculo personagem↔etiqueta, com upsert das etiquetas por nome.
/// **Jogador nunca recebe etiqueta** — a lista de jogadores é curta e fixa, e
/// mantê-la plana foi decisão explícita (ver 0009_etiqueta.sql).
fn escrever_etiquetas(
    conn: &Connection,
    pid: i64,
    tipo: &str,
    nomes: &[String],
) -> Result<(), AppError> {
    conn.execute("DELETE FROM personagem_etiqueta WHERE personagem_id=?1", [pid])?;
    if tipo != "npc" {
        return Ok(());
    }
    for nome in nomes {
        let n = nome.trim();
        if n.is_empty() {
            continue;
        }
        let eid = etiqueta_upsert(conn, n)?;
        conn.execute(
            "INSERT OR IGNORE INTO personagem_etiqueta (personagem_id,etiqueta_id) VALUES (?1,?2)",
            params![pid, eid],
        )?;
    }
    Ok(())
}

/// Todas as etiquetas com a contagem de uso (a chip do filtro mostra o total).
pub fn listar_etiquetas(conn: &Connection) -> Result<Vec<Etiqueta>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.nome, e.cor, \
         (SELECT count(*) FROM personagem_etiqueta pe WHERE pe.etiqueta_id = e.id) \
         FROM etiqueta e ORDER BY e.nome",
    )?;
    let out = stmt
        .query_map([], |r| {
            Ok(Etiqueta {
                id: r.get(0)?,
                nome: r.get(1)?,
                cor: r.get(2)?,
                total: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

fn etiqueta_get(conn: &Connection, id: i64) -> Result<Etiqueta, AppError> {
    listar_etiquetas(conn)?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::Msg("etiqueta não encontrada".into()))
}

pub fn etiqueta_criar(conn: &Connection, input: &EtiquetaInput) -> Result<Etiqueta, AppError> {
    let nome = validar_nome_etiqueta(&input.nome)?;
    let cor = validar_cor(&input.cor)?;
    if conn
        .query_row("SELECT id FROM etiqueta WHERE nome = ?1", [&nome], |r| {
            r.get::<_, i64>(0)
        })
        .optional()?
        .is_some()
    {
        return Err(AppError::Msg(format!("já existe a etiqueta \"{nome}\"")));
    }
    conn.execute(
        "INSERT INTO etiqueta (nome,cor) VALUES (?1,?2)",
        params![nome, cor],
    )?;
    etiqueta_get(conn, conn.last_insert_rowid())
}

pub fn etiqueta_atualizar(
    conn: &Connection,
    id: i64,
    input: &EtiquetaInput,
) -> Result<Etiqueta, AppError> {
    let nome = validar_nome_etiqueta(&input.nome)?;
    let cor = validar_cor(&input.cor)?;
    if let Some(outro) = conn
        .query_row("SELECT id FROM etiqueta WHERE nome = ?1", [&nome], |r| {
            r.get::<_, i64>(0)
        })
        .optional()?
    {
        if outro != id {
            return Err(AppError::Msg(format!("já existe a etiqueta \"{nome}\"")));
        }
    }
    let n = conn.execute(
        "UPDATE etiqueta SET nome=?1,cor=?2,atualizado_em=datetime('now') WHERE id=?3",
        params![nome, cor, id],
    )?;
    if n == 0 {
        return Err(AppError::Msg("etiqueta não encontrada".into()));
    }
    etiqueta_get(conn, id)
}

/// Exclui a etiqueta; os vínculos caem por ON DELETE CASCADE (os personagens
/// ficam, só perdem a etiqueta).
pub fn etiqueta_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM etiqueta WHERE id=?1", [id])?;
    if n == 0 {
        return Err(AppError::Msg("etiqueta não encontrada".into()));
    }
    Ok(())
}

/// Atribuição rápida a partir da galeria/Batalha, sem abrir o formulário.
pub fn definir_etiquetas_personagem(
    conn: &Connection,
    personagem_id: i64,
    nomes: &[String],
) -> Result<Vec<String>, AppError> {
    let tipo: String = conn
        .query_row("SELECT tipo FROM personagem WHERE id=?1", [personagem_id], |r| {
            r.get(0)
        })
        .optional()?
        .ok_or_else(|| AppError::Msg("personagem não encontrado".into()))?;
    escrever_etiquetas(conn, personagem_id, &tipo, nomes)?;
    etiquetas_do_personagem(conn, personagem_id)
}

/// Exclui o personagem (filhos caem por ON DELETE CASCADE). `Err` se não existir.
pub fn excluir_personagem(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM personagem WHERE id=?1", [id])?;
    if n == 0 {
        return Err(AppError::Msg("personagem não encontrado".into()));
    }
    Ok(())
}

/// Catálogos (perícias/vantagens/desvantagens) pros pickers do formulário.
pub fn listar_catalogos(conn: &Connection) -> Result<Catalogos, AppError> {
    let mut stmt = conn
        .prepare("SELECT id,nome,descricao,atributo FROM catalogo_pericia ORDER BY nome")?;
    let pericias = stmt
        .query_map([], |r| {
            Ok(CatalogoPericia {
                id: r.get(0)?,
                nome: r.get(1)?,
                descricao: r.get(2)?,
                atributo: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Catalogos {
        pericias,
        vantagens: carregar_catalogo_tracos(conn, "catalogo_vantagem")?,
        desvantagens: carregar_catalogo_tracos(conn, "catalogo_desvantagem")?,
    })
}

fn carregar_catalogo_tracos(
    conn: &Connection,
    tabela: &str,
) -> Result<Vec<CatalogoTraco>, AppError> {
    // `tabela` é literal interno controlado, nunca input do usuário.
    let sql = format!("SELECT id,nome,descricao,efeito FROM {tabela} ORDER BY nome");
    let mut stmt = conn.prepare(&sql)?;
    let out = stmt
        .query_map([], |r| {
            Ok(CatalogoTraco {
                id: r.get(0)?,
                nome: r.get(1)?,
                descricao: r.get(2)?,
                efeito: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/* --------------------- Catálogo: CRUD (Compêndio) --------------------- */

fn validar_catalogo_nome(nome: &str) -> Result<(), AppError> {
    if nome.trim().is_empty() {
        return Err(AppError::Msg("nome obrigatório".into()));
    }
    Ok(())
}

fn catalogo_pericia_get(conn: &Connection, id: i64) -> Result<CatalogoPericia, AppError> {
    conn.query_row(
        "SELECT id,nome,descricao,atributo FROM catalogo_pericia WHERE id=?1",
        [id],
        |r| {
            Ok(CatalogoPericia {
                id: r.get(0)?,
                nome: r.get(1)?,
                descricao: r.get(2)?,
                atributo: r.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::Msg("perícia do catálogo não encontrada".into()))
}

/// Cria uma perícia no catálogo. `Err` se `nome` vier vazio.
pub fn catalogo_pericia_criar(
    conn: &Connection,
    input: &CatalogoPericiaInput,
) -> Result<CatalogoPericia, AppError> {
    validar_catalogo_nome(&input.nome)?;
    conn.execute(
        "INSERT INTO catalogo_pericia (nome,descricao,atributo) VALUES (?1,?2,?3)",
        params![input.nome, input.descricao, input.atributo],
    )?;
    catalogo_pericia_get(conn, conn.last_insert_rowid())
}

/// Atualiza uma perícia do catálogo existente. `Err` se o id não existir.
pub fn catalogo_pericia_atualizar(
    conn: &Connection,
    id: i64,
    input: &CatalogoPericiaInput,
) -> Result<CatalogoPericia, AppError> {
    validar_catalogo_nome(&input.nome)?;
    let n = conn.execute(
        "UPDATE catalogo_pericia SET nome=?1,descricao=?2,atributo=?3 WHERE id=?4",
        params![input.nome, input.descricao, input.atributo, id],
    )?;
    if n == 0 {
        return Err(AppError::Msg("perícia do catálogo não encontrada".into()));
    }
    catalogo_pericia_get(conn, id)
}

/// Exclui uma perícia do catálogo. Não há FK de `personagem_pericia` pra cá —
/// fichas copiam os campos por valor no momento de escolher no picker — então
/// excluir aqui não afeta fichas já salvas. `Err` se o id não existir.
pub fn catalogo_pericia_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM catalogo_pericia WHERE id=?1", params![id])?;
    if n == 0 {
        return Err(AppError::Msg("perícia do catálogo não encontrada".into()));
    }
    Ok(())
}

/// Mapeia `tipo` ("vantagem"|"desvantagem") pro nome real da tabela. `tipo` vem
/// do frontend — nunca interpolado direto na query, só o literal validado aqui.
fn tabela_catalogo_traco(tipo: &str) -> Result<&'static str, AppError> {
    match tipo {
        "vantagem" => Ok("catalogo_vantagem"),
        "desvantagem" => Ok("catalogo_desvantagem"),
        _ => Err(AppError::Msg(format!("tipo de catálogo inválido: {tipo}"))),
    }
}

fn catalogo_traco_get(
    conn: &Connection,
    tabela: &str,
    id: i64,
) -> Result<CatalogoTraco, AppError> {
    let sql = format!("SELECT id,nome,descricao,efeito FROM {tabela} WHERE id=?1");
    conn.query_row(&sql, [id], |r| {
        Ok(CatalogoTraco {
            id: r.get(0)?,
            nome: r.get(1)?,
            descricao: r.get(2)?,
            efeito: r.get(3)?,
        })
    })
    .optional()?
    .ok_or_else(|| AppError::Msg("entrada do catálogo não encontrada".into()))
}

/// Cria uma vantagem/desvantagem no catálogo (`tipo` escolhe a tabela). `Err`
/// se `nome` vier vazio ou `tipo` for inválido.
pub fn catalogo_traco_criar(
    conn: &Connection,
    tipo: &str,
    input: &CatalogoTracoInput,
) -> Result<CatalogoTraco, AppError> {
    validar_catalogo_nome(&input.nome)?;
    let tabela = tabela_catalogo_traco(tipo)?;
    conn.execute(
        &format!("INSERT INTO {tabela} (nome,descricao,efeito) VALUES (?1,?2,?3)"),
        params![input.nome, input.descricao, input.efeito],
    )?;
    catalogo_traco_get(conn, tabela, conn.last_insert_rowid())
}

/// Atualiza uma vantagem/desvantagem existente do catálogo. `Err` se o id não
/// existir ou `tipo` for inválido.
pub fn catalogo_traco_atualizar(
    conn: &Connection,
    tipo: &str,
    id: i64,
    input: &CatalogoTracoInput,
) -> Result<CatalogoTraco, AppError> {
    validar_catalogo_nome(&input.nome)?;
    let tabela = tabela_catalogo_traco(tipo)?;
    let n = conn.execute(
        &format!("UPDATE {tabela} SET nome=?1,descricao=?2,efeito=?3 WHERE id=?4"),
        params![input.nome, input.descricao, input.efeito, id],
    )?;
    if n == 0 {
        return Err(AppError::Msg("entrada do catálogo não encontrada".into()));
    }
    catalogo_traco_get(conn, tabela, id)
}

/// Exclui uma vantagem/desvantagem do catálogo. Mesma garantia de ausência de
/// FK que `catalogo_pericia_excluir`. `Err` se o id não existir ou `tipo` for
/// inválido.
pub fn catalogo_traco_excluir(conn: &Connection, tipo: &str, id: i64) -> Result<(), AppError> {
    let tabela = tabela_catalogo_traco(tipo)?;
    let n = conn.execute(&format!("DELETE FROM {tabela} WHERE id=?1"), params![id])?;
    if n == 0 {
        return Err(AppError::Msg("entrada do catálogo não encontrada".into()));
    }
    Ok(())
}

// ------------------------------- Mapa -------------------------------

fn linha_para_mapa(row: &Row) -> rusqlite::Result<Mapa> {
    let grade_json: String = row.get(4)?;
    // grade inválida no banco → vazia; mapa_get normaliza depois.
    let grade: Vec<String> = serde_json::from_str(&grade_json).unwrap_or_default();
    Ok(Mapa {
        id: row.get(0)?,
        titulo: row.get(1)?,
        colunas: row.get(2)?,
        linhas: row.get(3)?,
        grade,
        legenda: row.get(5)?,
        efeito: row.get(6)?,
        criado_em: row.get(7)?,
        atualizado_em: row.get(8)?,
    })
}

pub fn mapa_listar(conn: &Connection) -> Result<Vec<MapaResumo>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,titulo,atualizado_em FROM mapa ORDER BY atualizado_em DESC, id DESC",
    )?;
    let out = stmt
        .query_map([], |r| {
            Ok(MapaResumo {
                id: r.get(0)?,
                titulo: r.get(1)?,
                atualizado_em: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

pub fn mapa_get(conn: &Connection, id: i64) -> Result<Mapa, AppError> {
    let mut m = conn
        .query_row(
            "SELECT id,titulo,colunas,linhas,grade,legenda,efeito,criado_em,atualizado_em \
             FROM mapa WHERE id=?1",
            [id],
            linha_para_mapa,
        )
        .optional()?
        .ok_or_else(|| AppError::Msg("mapa não encontrado".into()))?;
    m.colunas = m.colunas.clamp(COLUNAS_MIN, COLUNAS_MAX);
    m.linhas = m.linhas.clamp(LINHAS_MIN, LINHAS_MAX);
    m.grade = normalizar_grade(&m.grade, m.colunas, m.linhas);
    Ok(m)
}

pub fn mapa_criar(conn: &Connection, input: &MapaInput) -> Result<Mapa, AppError> {
    let input = normalizar(input.clone());
    let grade_json = serde_json::to_string(&input.grade)?;
    conn.execute(
        "INSERT INTO mapa (titulo,colunas,linhas,grade,legenda,efeito) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            input.titulo, input.colunas, input.linhas, grade_json,
            input.legenda, input.efeito
        ],
    )?;
    mapa_get(conn, conn.last_insert_rowid())
}

pub fn mapa_atualizar(conn: &Connection, id: i64, input: &MapaInput) -> Result<Mapa, AppError> {
    let input = normalizar(input.clone());
    let grade_json = serde_json::to_string(&input.grade)?;
    let n = conn.execute(
        "UPDATE mapa SET titulo=?1,colunas=?2,linhas=?3,grade=?4,\
         legenda=?5,efeito=?6,atualizado_em=datetime('now') WHERE id=?7",
        params![
            input.titulo, input.colunas, input.linhas, grade_json,
            input.legenda, input.efeito, id
        ],
    )?;
    if n == 0 {
        return Err(AppError::Msg("mapa não encontrado".into()));
    }
    mapa_get(conn, id)
}

pub fn mapa_duplicar(conn: &Connection, id: i64) -> Result<Mapa, AppError> {
    let orig = mapa_get(conn, id)?;
    let input = MapaInput {
        titulo: format!("{} (cópia)", orig.titulo),
        colunas: orig.colunas,
        linhas: orig.linhas,
        grade: orig.grade,
        legenda: orig.legenda,
        efeito: orig.efeito,
    };
    mapa_criar(conn, &input)
}

pub fn mapa_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM mapa WHERE id=?1", params![id])?;
    if n == 0 {
        return Err(AppError::Msg("mapa não encontrado".into()));
    }
    Ok(())
}

// ------------------------------- Nota -------------------------------

fn linha_para_nota(row: &Row) -> rusqlite::Result<Nota> {
    Ok(Nota {
        id: row.get(0)?,
        titulo: row.get(1)?,
        corpo: row.get(2)?,
        criado_em: row.get(3)?,
        atualizado_em: row.get(4)?,
    })
}

pub fn nota_listar(conn: &Connection) -> Result<Vec<NotaResumo>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,titulo,atualizado_em FROM nota ORDER BY atualizado_em DESC, id DESC",
    )?;
    let out = stmt
        .query_map([], |r| {
            Ok(NotaResumo {
                id: r.get(0)?,
                titulo: r.get(1)?,
                atualizado_em: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

pub fn nota_get(conn: &Connection, id: i64) -> Result<Nota, AppError> {
    conn.query_row(
        "SELECT id,titulo,corpo,criado_em,atualizado_em FROM nota WHERE id=?1",
        [id],
        linha_para_nota,
    )
    .optional()?
    .ok_or_else(|| AppError::Msg("nota não encontrada".into()))
}

pub fn nota_criar(conn: &Connection, input: &NotaInput) -> Result<Nota, AppError> {
    conn.execute(
        "INSERT INTO nota (titulo,corpo) VALUES (?1,?2)",
        params![input.titulo, input.corpo],
    )?;
    nota_get(conn, conn.last_insert_rowid())
}

pub fn nota_atualizar(conn: &Connection, id: i64, input: &NotaInput) -> Result<Nota, AppError> {
    let n = conn.execute(
        "UPDATE nota SET titulo=?1,corpo=?2,atualizado_em=datetime('now') WHERE id=?3",
        params![input.titulo, input.corpo, id],
    )?;
    if n == 0 {
        return Err(AppError::Msg("nota não encontrada".into()));
    }
    nota_get(conn, id)
}

pub fn nota_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM nota WHERE id=?1", params![id])?;
    if n == 0 {
        return Err(AppError::Msg("nota não encontrada".into()));
    }
    Ok(())
}

// ------------------------------- Favorito -------------------------------

fn linha_para_favorito(row: &Row) -> rusqlite::Result<Favorito> {
    Ok(Favorito {
        id: row.get(0)?,
        nome: row.get(1)?,
        url: row.get(2)?,
        categoria: row.get(3)?,
        criado_em: row.get(4)?,
        atualizado_em: row.get(5)?,
    })
}

pub fn favorito_get(conn: &Connection, id: i64) -> Result<Favorito, AppError> {
    conn.query_row(
        "SELECT id,nome,url,categoria,criado_em,atualizado_em FROM favorito WHERE id=?1",
        [id],
        linha_para_favorito,
    )
    .optional()?
    .ok_or_else(|| AppError::Msg("favorito não encontrado".into()))
}

pub fn favorito_listar(conn: &Connection) -> Result<Vec<Favorito>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,nome,url,categoria,criado_em,atualizado_em FROM favorito \
         ORDER BY categoria IS NULL, categoria, nome",
    )?;
    let out = stmt
        .query_map([], linha_para_favorito)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

pub fn favorito_criar(conn: &Connection, input: &FavoritoInput) -> Result<Favorito, AppError> {
    conn.execute(
        "INSERT INTO favorito (nome,url,categoria) VALUES (?1,?2,?3)",
        params![input.nome, input.url, input.categoria],
    )?;
    favorito_get(conn, conn.last_insert_rowid())
}

pub fn favorito_atualizar(
    conn: &Connection,
    id: i64,
    input: &FavoritoInput,
) -> Result<Favorito, AppError> {
    let n = conn.execute(
        "UPDATE favorito SET nome=?1,url=?2,categoria=?3,atualizado_em=datetime('now') WHERE id=?4",
        params![input.nome, input.url, input.categoria, id],
    )?;
    if n == 0 {
        return Err(AppError::Msg("favorito não encontrado".into()));
    }
    favorito_get(conn, id)
}

pub fn favorito_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let n = conn.execute("DELETE FROM favorito WHERE id=?1", params![id])?;
    if n == 0 {
        return Err(AppError::Msg("favorito não encontrado".into()));
    }
    Ok(())
}

/// Config do v1 (`discord_config.json`) — só os campos que interessam pro seed.
#[derive(serde::Deserialize)]
struct ConfigFavoritosV1 {
    #[serde(default)]
    favorites: Vec<FavoritoV1>,
}

#[derive(serde::Deserialize)]
struct FavoritoV1 {
    name: String,
    url: String,
    #[serde(default)]
    category: Option<String>,
}

/// Seed único: só roda se a tabela estiver VAZIA, importando os favoritos do
/// `discord_config.json` do v1. Robusto — arquivo ausente ou JSON inválido PULA
/// o seed sem erro (retorna `Ok(0)`). Nunca escreve de volta no json do v1.
pub fn favorito_seed_se_vazio(conn: &Connection, caminho_json_v1: &Path) -> Result<usize, AppError> {
    let ja_tem: i64 = conn.query_row("SELECT count(*) FROM favorito", [], |r| r.get(0))?;
    if ja_tem > 0 {
        return Ok(0);
    }
    let Ok(json) = std::fs::read_to_string(caminho_json_v1) else {
        return Ok(0); // arquivo do v1 ausente nesta máquina → sem seed, sem erro
    };
    let Ok(cfg) = serde_json::from_str::<ConfigFavoritosV1>(&json) else {
        return Ok(0); // json fora do formato esperado → pula
    };
    let tx = conn.unchecked_transaction()?;
    for f in &cfg.favorites {
        tx.execute(
            "INSERT INTO favorito (nome,url,categoria) VALUES (?1,?2,?3)",
            params![f.name, f.url, f.category],
        )?;
    }
    tx.commit()?;
    Ok(cfg.favorites.len())
}

// ------------------------------- Config (KV) -------------------------------

/// Lê um valor de config por chave. `None` = chave ausente.
pub fn config_get(conn: &Connection, chave: &str) -> Result<Option<String>, AppError> {
    Ok(conn
        .query_row("SELECT valor FROM config WHERE chave=?1", [chave], |r| r.get(0))
        .optional()?)
}

/// Grava (upsert) um valor de config por chave — mesma chave sobrescreve.
pub fn config_set(conn: &Connection, chave: &str, valor: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO config (chave,valor) VALUES (?1,?2) \
         ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=datetime('now')",
        params![chave, valor],
    )?;
    Ok(())
}

// ------------------------------- Batalha ativa -------------------------------

/// Grava (upsert) o snapshot da batalha ativa (linha única, `id = 1`).
pub fn batalha_salvar(conn: &Connection, estado: &Estado, proximo_id: i64) -> Result<(), AppError> {
    let estado_json = serde_json::to_string(estado)?;
    conn.execute(
        "INSERT INTO batalha_ativa (id,estado,proximo_id) VALUES (1,?1,?2) \
         ON CONFLICT(id) DO UPDATE SET \
         estado=excluded.estado, proximo_id=excluded.proximo_id, atualizado_em=datetime('now')",
        params![estado_json, proximo_id],
    )?;
    Ok(())
}

/// Carrega a batalha salva. `None` = banco vazio (batalha nova) OU snapshot
/// corrompido/incompatível — um schema antigo não pode impedir o app de abrir,
/// então o erro de desserialização é logado em stderr e tratado como ausência.
/// Resultado de tentar carregar a batalha salva.
///
/// `Ilegivel` existe para separar "não havia batalha" de "havia e não deu pra
/// ler": os dois acabam abrindo uma batalha nova, mas só o segundo está prestes
/// a **destruir** o save do usuário no próximo UPSERT. Carregando o texto cru
/// junto, quem chama consegue pôr em quarentena antes de sobrescrever.
pub enum CargaBatalha {
    /// Primeira execução, ou depois de um reset — nada a restaurar.
    Vazia,
    Restaurada(Estado, i64),
    /// Havia uma linha, mas o JSON não desserializa (schema mudou entre versões
    /// do app, arquivo adulterado). Traz o conteúdo cru para não se perder.
    Ilegivel(String),
}

pub fn batalha_carregar(conn: &Connection) -> Result<CargaBatalha, AppError> {
    let linha: Option<(String, i64)> = conn
        .query_row("SELECT estado,proximo_id FROM batalha_ativa WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((estado_json, proximo_id)) = linha else {
        return Ok(CargaBatalha::Vazia);
    };
    match serde_json::from_str::<Estado>(&estado_json) {
        Ok(estado) => Ok(CargaBatalha::Restaurada(estado, proximo_id)),
        Err(e) => {
            eprintln!("[batalha_carregar] snapshot incompatível: {e}");
            Ok(CargaBatalha::Ilegivel(estado_json))
        }
    }
}

// ------------------------------- Presets de batalha -------------------------------

/// Resumo de um preset de encontro, para o card da lista (`batalha_preset_listar`)
/// e como retorno de toda mutação (salvar/sobrescrever/renomear).
#[derive(serde::Serialize)]
pub struct PresetResumo {
    pub id: i64,
    pub nome: String,
    pub descricao: String,
    pub combatentes: usize,
    pub criado_em: String,
    pub atualizado_em: String,
}

/// Conta combatentes olhando só o array `combatentes` do JSON bruto, sem
/// desserializar `Estado` inteiro — a lista de presets não pode quebrar
/// porque um schema mais antigo do resto do snapshot não bate mais; só
/// `batalha_preset_obter` (que de fato RESTAURA o preset) exige o parse
/// completo e falha alto se não der.
fn contar_combatentes(estado_json: &str) -> usize {
    serde_json::from_str::<serde_json::Value>(estado_json)
        .ok()
        .and_then(|v| v.get("combatentes").and_then(|c| c.as_array().map(Vec::len)))
        .unwrap_or(0)
}

fn preset_resumo_da_linha(row: &Row) -> rusqlite::Result<PresetResumo> {
    let estado_json: String = row.get("estado")?;
    Ok(PresetResumo {
        id: row.get("id")?,
        nome: row.get("nome")?,
        descricao: row.get("descricao")?,
        combatentes: contar_combatentes(&estado_json),
        criado_em: row.get("criado_em")?,
        atualizado_em: row.get("atualizado_em")?,
    })
}

fn batalha_preset_obter_resumo(conn: &Connection, id: i64) -> Result<PresetResumo, AppError> {
    Ok(conn.query_row(
        "SELECT id,nome,descricao,estado,criado_em,atualizado_em FROM batalha_salva WHERE id=?1",
        [id],
        preset_resumo_da_linha,
    )?)
}

/// Salva um NOVO preset a partir do snapshot atual da batalha ativa.
pub fn batalha_preset_salvar(
    conn: &Connection,
    nome: &str,
    descricao: &str,
    estado: &Estado,
    proximo_id: i64,
) -> Result<PresetResumo, AppError> {
    let estado_json = serde_json::to_string(estado)?;
    conn.execute(
        "INSERT INTO batalha_salva (nome,descricao,estado,proximo_id) VALUES (?1,?2,?3,?4)",
        params![nome, descricao, estado_json, proximo_id],
    )?;
    batalha_preset_obter_resumo(conn, conn.last_insert_rowid())
}

/// Lista os presets salvos, ordenado por nome (mesmo critério de `etiqueta`).
pub fn batalha_preset_listar(conn: &Connection) -> Result<Vec<PresetResumo>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id,nome,descricao,estado,criado_em,atualizado_em FROM batalha_salva \
         ORDER BY nome COLLATE NOCASE ASC, id ASC",
    )?;
    let linhas = stmt
        .query_map([], preset_resumo_da_linha)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(linhas)
}

/// Lê o snapshot de um preset para RESTAURAR (substituir a batalha ativa).
/// Diferente da listagem, aqui o parse tem que ser completo e falhar alto: um
/// snapshot ilegível não pode virar silenciosamente uma batalha vazia — o
/// mestre pediu pra carregar aquele preset específico, e um "vazio" no lugar
/// destrói a percepção de que algo deu errado (ver `CargaBatalha::Ilegivel`
/// acima, mesmo raciocínio, mas presets não têm quarentena: são N linhas
/// independentes, não uma única linha que o próximo save sobrescreveria).
pub fn batalha_preset_obter(conn: &Connection, id: i64) -> Result<(Estado, i64, String), AppError> {
    let linha: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT estado,proximo_id,nome FROM batalha_salva WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (estado_json, proximo_id, nome) =
        linha.ok_or_else(|| AppError::Msg(format!("preset {id} não encontrado")))?;
    let estado = serde_json::from_str::<Estado>(&estado_json).map_err(|e| {
        AppError::Msg(format!("preset {id} ('{nome}'): snapshot corrompido/incompatível: {e}"))
    })?;
    Ok((estado, proximo_id, nome))
}

/// Sobrescreve o snapshot de um preset já existente com o estado ATUAL da
/// batalha ativa (nome/descrição não mudam).
pub fn batalha_preset_sobrescrever(
    conn: &Connection,
    id: i64,
    estado: &Estado,
    proximo_id: i64,
) -> Result<PresetResumo, AppError> {
    let estado_json = serde_json::to_string(estado)?;
    let linhas = conn.execute(
        "UPDATE batalha_salva SET estado=?1, proximo_id=?2, atualizado_em=datetime('now') WHERE id=?3",
        params![estado_json, proximo_id, id],
    )?;
    if linhas == 0 {
        return Err(AppError::Msg(format!("preset {id} não encontrado")));
    }
    batalha_preset_obter_resumo(conn, id)
}

pub fn batalha_preset_renomear(
    conn: &Connection,
    id: i64,
    nome: &str,
    descricao: &str,
) -> Result<PresetResumo, AppError> {
    let linhas = conn.execute(
        "UPDATE batalha_salva SET nome=?1, descricao=?2, atualizado_em=datetime('now') WHERE id=?3",
        params![nome, descricao, id],
    )?;
    if linhas == 0 {
        return Err(AppError::Msg(format!("preset {id} não encontrado")));
    }
    batalha_preset_obter_resumo(conn, id)
}

pub fn batalha_preset_excluir(conn: &Connection, id: i64) -> Result<(), AppError> {
    let linhas = conn.execute("DELETE FROM batalha_salva WHERE id=?1", [id])?;
    if linhas == 0 {
        return Err(AppError::Msg(format!("preset {id} não encontrado")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::modelos::{
        HabilidadeInput, ModificadorInput, PericiaInput, RetratoInput, TracoInput,
        TransformacaoInput,
    };

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HBGWAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    /// Habilidade só com nome — todos os campos da técnica vazios.
    fn habilidade_vazia(nome: &str) -> HabilidadeInput {
        HabilidadeInput {
            nome: nome.into(),
            descricao: String::new(),
            acao: String::new(),
            efeito: String::new(),
            tempo: String::new(),
            custo: String::new(),
            dano: String::new(),
            campos_extras: vec![],
        }
    }

    fn img_dir(sufixo: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rpgv2_test_{sufixo}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn input_base() -> PersonagemInput {
        PersonagemInput {
            tipo: "jogador".into(),
            nome: "Luffy".into(),
            descricao: "cap".into(),
            hp: 100, sp: 10, escudo: 5,
            forca: 9, agilidade: 8, percepcao: 5, resistencia: 7,
            intuicao: 4, espirito: 6, carisma: 9, determinacao: 10,
            retrato: RetratoInput::Nenhum,
            habilidades: vec![],
            pericias: vec![],
            vantagens: vec![],
            desvantagens: vec![],
            transformacoes: vec![],
            etiquetas: vec![],
        }
    }

    fn png(base64: &str) -> RetratoInput {
        RetratoInput::Novo { base64: base64.into(), formato: "png".into() }
    }

    #[test]
    fn favorito_crud() {
        let conn = open_in_memory().unwrap();
        assert!(favorito_listar(&conn).unwrap().is_empty());

        let f = favorito_criar(
            &conn,
            &FavoritoInput {
                nome: "Tema".into(),
                url: "http://x".into(),
                categoria: Some("Batalha".into()),
            },
        )
        .unwrap();
        assert_eq!(f.categoria.as_deref(), Some("Batalha"));

        let f2 = favorito_atualizar(
            &conn,
            f.id,
            &FavoritoInput { nome: "Tema 2".into(), url: "http://y".into(), categoria: None },
        )
        .unwrap();
        assert_eq!(f2.nome, "Tema 2");
        assert_eq!(f2.categoria, None);
        assert_eq!(favorito_listar(&conn).unwrap().len(), 1);

        favorito_excluir(&conn, f.id).unwrap();
        assert!(favorito_listar(&conn).unwrap().is_empty());
        assert!(favorito_excluir(&conn, f.id).is_err());
    }

    #[test]
    fn config_get_set_upsert() {
        let conn = open_in_memory().unwrap();
        assert_eq!(config_get(&conn, "discord_canal_id").unwrap(), None);

        config_set(&conn, "discord_canal_id", "123").unwrap();
        assert_eq!(config_get(&conn, "discord_canal_id").unwrap(), Some("123".into()));

        // upsert: mesma chave sobrescreve, não duplica linha
        config_set(&conn, "discord_canal_id", "456").unwrap();
        assert_eq!(config_get(&conn, "discord_canal_id").unwrap(), Some("456".into()));
        let n: i64 = conn.query_row("SELECT count(*) FROM config", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn favorito_seed_idempotente_e_robusto() {
        let conn = open_in_memory().unwrap();

        // arquivo ausente → pula sem erro
        let ausente = std::env::temp_dir().join("rpgv2_seed_inexistente_zzz.json");
        let _ = std::fs::remove_file(&ausente);
        assert_eq!(favorito_seed_se_vazio(&conn, &ausente).unwrap(), 0);

        // arquivo válido → semeia (categoria ausente vira NULL)
        let caminho = std::env::temp_dir().join("rpgv2_seed_favoritos.json");
        std::fs::write(
            &caminho,
            r#"{"favorites":[
                {"name":"A","url":"http://a","category":"Batalha"},
                {"name":"B","url":"http://b"}
            ]}"#,
        )
        .unwrap();
        assert_eq!(favorito_seed_se_vazio(&conn, &caminho).unwrap(), 2);
        let fs = favorito_listar(&conn).unwrap();
        assert_eq!(fs.len(), 2);
        assert!(fs.iter().any(|f| f.nome == "B" && f.categoria.is_none()));

        // segundo seed é no-op (tabela já tem dados)
        assert_eq!(favorito_seed_se_vazio(&conn, &caminho).unwrap(), 0);
        let _ = std::fs::remove_file(&caminho);
    }

    #[test]
    fn criar_e_get_round_trip() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_roundtrip");

        let mut input = input_base();
        input.retrato = png(PNG_1X1);
        input.habilidades = vec![HabilidadeInput {
            nome: "Gomu".into(),
            descricao: "borracha".into(),
            acao: "Ação Completa".into(),
            efeito: "Nenhum".into(),
            tempo: "2".into(),
            custo: "-10 SP".into(),
            dano: "50".into(),
            campos_extras: vec![CampoExtra { nome: "Alcance".into(), valor: "15m".into() }],
        }];
        input.pericias = vec![PericiaInput {
            nome: "Luta".into(),
            descricao: String::new(),
            atributo: "forca".into(),
            nivel: 3,
        }];
        input.vantagens = vec![TracoInput {
            nome: "Sortudo".into(),
            descricao: String::new(),
            efeito: "+1 sorte".into(),
        }];
        input.transformacoes = vec![TransformacaoInput {
            nome: "Gear 2".into(),
            descricao: String::new(),
            retrato: png(PNG_1X1),
            modificadores: vec![ModificadorInput { atributo: "agilidade".into(), delta: 3 }],
            habilidades: vec![HabilidadeInput {
                nome: "Jet".into(),
                descricao: String::new(),
                acao: "Ação Livre".into(),
                efeito: "Velocidade dobrada".into(),
                tempo: String::new(),
                custo: String::new(),
                dano: String::new(),
                campos_extras: vec![CampoExtra {
                    nome: "Requisito".into(),
                    valor: "Haki desperto".into(),
                }],
            }],
        }];

        let id = criar_personagem(&conn, &dir, &input).unwrap();
        let ficha = get_personagem(&conn, id).unwrap();
        assert_eq!(ficha.atributos.len(), 8);
        assert_eq!(ficha.habilidades.len(), 1);
        // Campos da técnica round-tripam (escrever_colecoes -> carregar_habilidades),
        // na ordem canônica Ação, Efeito, Custo, Tempo, Dano + os personalizados.
        let h = &ficha.habilidades[0];
        assert_eq!(h.acao, "Ação Completa");
        assert_eq!(h.efeito, "Nenhum");
        assert_eq!(h.tempo, "2");
        assert_eq!(h.custo, "-10 SP");
        assert_eq!(h.dano, "50");
        assert_eq!(
            h.campos_extras,
            vec![CampoExtra { nome: "Alcance".into(), valor: "15m".into() }]
        );
        assert_eq!(ficha.pericias.len(), 1);
        assert_eq!(ficha.vantagens.len(), 1);
        assert_eq!(ficha.transformacoes.len(), 1);
        assert_eq!(ficha.transformacoes[0].modificadores.len(), 1);
        assert_eq!(ficha.transformacoes[0].habilidades.len(), 1);
        // Mesmos campos novos valem dentro da transformação.
        let ht = &ficha.transformacoes[0].habilidades[0];
        assert_eq!(ht.acao, "Ação Livre");
        assert_eq!(ht.efeito, "Velocidade dobrada");
        assert_eq!(
            ht.campos_extras,
            vec![CampoExtra { nome: "Requisito".into(), valor: "Haki desperto".into() }]
        );
        assert!(ficha.retrato.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Linha escrita fora do repositório (migration antiga, edição manual do
    /// banco) não traz os campos da 0011 — o DEFAULT tem que segurar.
    #[test]
    fn habilidade_sem_campos_novos_cai_no_default() {
        let conn = open_in_memory().unwrap();
        let p = NovoPersonagem {
            tipo: "jogador".into(),
            nome: "Luffy".into(),
            descricao: String::new(),
            hp: 100, sp: 10, escudo: 5,
            forca: 9, agilidade: 8, percepcao: 5, resistencia: 7,
            intuicao: 4, espirito: 6, carisma: 9, determinacao: 10,
            retrato_id: None,
        };
        let id = inserir_personagem(&conn, &p).unwrap();
        conn.execute(
            "INSERT INTO habilidade (personagem_id,nome,descricao,ordem) VALUES (?1,'Gomu','',0)",
            [id],
        )
        .unwrap();

        let h = &get_personagem(&conn, id).unwrap().habilidades[0];
        assert_eq!(h.acao, "");
        assert_eq!(h.efeito, "");
        assert!(h.campos_extras.is_empty());
    }

    /// O banco é do usuário: `campos_extras` corrompido vira lista vazia em vez
    /// de derrubar a ficha inteira. Vale nas duas tabelas.
    #[test]
    fn campos_extras_invalido_vira_lista_vazia() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_campos_extras_invalido");

        let mut input = input_base();
        input.habilidades = vec![habilidade_vazia("A")];
        input.transformacoes = vec![TransformacaoInput {
            nome: "T".into(),
            descricao: String::new(),
            retrato: RetratoInput::Nenhum,
            modificadores: vec![],
            habilidades: vec![habilidade_vazia("B")],
        }];
        let id = criar_personagem(&conn, &dir, &input).unwrap();

        // JSON quebrado na forma base; string vazia na transformação.
        conn.execute("UPDATE habilidade SET campos_extras='{nao é json'", []).unwrap();
        conn.execute("UPDATE transformacao_habilidade SET campos_extras=''", []).unwrap();

        let ficha = get_personagem(&conn, id).unwrap();
        assert!(ficha.habilidades[0].campos_extras.is_empty());
        assert!(ficha.transformacoes[0].habilidades[0].campos_extras.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atualizar_faz_replace_all() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_replace");

        let mut input = input_base();
        input.habilidades = vec![
            habilidade_vazia("A"),
            habilidade_vazia("B"),
        ];
        let id = criar_personagem(&conn, &dir, &input).unwrap();

        let mut novo = input_base();
        novo.nome = "Luffy G5".into();
        novo.habilidades = vec![]; // 0 habilidades
        novo.pericias = vec![
            PericiaInput { nome: "P1".into(), descricao: String::new(), atributo: "forca".into(), nivel: 1 },
            PericiaInput { nome: "P2".into(), descricao: String::new(), atributo: "agilidade".into(), nivel: 2 },
        ];
        atualizar_personagem(&conn, &dir, id, &novo).unwrap();

        let ficha = get_personagem(&conn, id).unwrap();
        assert_eq!(ficha.nome, "Luffy G5");
        assert_eq!(ficha.habilidades.len(), 0);
        assert_eq!(ficha.pericias.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn retrato_manter_e_nenhum() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_retrato");

        let mut input = input_base();
        input.retrato = png(PNG_1X1);
        let id = criar_personagem(&conn, &dir, &input).unwrap();
        let caminho = get_personagem(&conn, id).unwrap().retrato.unwrap();

        let mut manter = input_base();
        manter.retrato = RetratoInput::Manter { caminho: caminho.clone() };
        atualizar_personagem(&conn, &dir, id, &manter).unwrap();
        assert_eq!(get_personagem(&conn, id).unwrap().retrato, Some(caminho));

        let mut nenhum = input_base();
        nenhum.retrato = RetratoInput::Nenhum;
        atualizar_personagem(&conn, &dir, id, &nenhum).unwrap();
        assert!(get_personagem(&conn, id).unwrap().retrato.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dedup_imagem_no_mesmo_save() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_dedup");

        let mut input = input_base();
        input.transformacoes = vec![
            TransformacaoInput {
                nome: "T1".into(),
                descricao: String::new(),
                retrato: png(PNG_1X1),
                modificadores: vec![],
                habilidades: vec![],
            },
            TransformacaoInput {
                nome: "T2".into(),
                descricao: String::new(),
                retrato: png(PNG_1X1),
                modificadores: vec![],
                habilidades: vec![],
            },
        ];
        criar_personagem(&conn, &dir, &input).unwrap();

        let n: i64 = conn.query_row("SELECT count(*) FROM imagem", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1); // mesmo sha256 -> uma imagem só

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn excluir_remove_filhos_em_cascata() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_excluir");

        let mut input = input_base();
        input.habilidades = vec![habilidade_vazia("A")];
        input.transformacoes = vec![TransformacaoInput {
            nome: "T".into(),
            descricao: String::new(),
            retrato: RetratoInput::Nenhum,
            modificadores: vec![ModificadorInput { atributo: "forca".into(), delta: 1 }],
            habilidades: vec![],
        }];
        let id = criar_personagem(&conn, &dir, &input).unwrap();

        excluir_personagem(&conn, id).unwrap();
        assert!(get_personagem(&conn, id).is_err());

        let c = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(c("SELECT count(*) FROM habilidade"), 0);
        assert_eq!(c("SELECT count(*) FROM transformacao"), 0);
        assert_eq!(c("SELECT count(*) FROM transformacao_modificador"), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validacao_e_excluir_inexistente() {
        let conn = open_in_memory().unwrap();
        let dir = img_dir("crud_valida");

        let mut vazio = input_base();
        vazio.nome = "   ".into();
        assert!(criar_personagem(&conn, &dir, &vazio).is_err());

        let mut tipo_ruim = input_base();
        tipo_ruim.tipo = "foo".into();
        assert!(criar_personagem(&conn, &dir, &tipo_ruim).is_err());

        assert!(excluir_personagem(&conn, 999).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn listar_catalogos_conta_certo() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO catalogo_pericia (nome,descricao,atributo) VALUES ('Furtividade','d','agilidade')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO catalogo_vantagem (nome,descricao,efeito) VALUES ('Sortudo','d','e')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO catalogo_desvantagem (nome,descricao,efeito) VALUES ('Codigo','d','e')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO catalogo_desvantagem (nome,descricao,efeito) VALUES ('Medo','d','e')",
            [],
        )
        .unwrap();

        let cat = listar_catalogos(&conn).unwrap();
        assert_eq!(cat.pericias.len(), 1);
        assert_eq!(cat.vantagens.len(), 1);
        assert_eq!(cat.desvantagens.len(), 2);
    }

    #[test]
    fn insere_e_lista_personagem() {
        let conn = open_in_memory().unwrap();
        let p = NovoPersonagem {
            tipo: "jogador".into(),
            nome: "Zoro".into(),
            descricao: "espadachim".into(),
            hp: 120, sp: 8, escudo: 0,
            forca: 9, agilidade: 7, percepcao: 6, resistencia: 8,
            intuicao: 5, espirito: 6, carisma: 4, determinacao: 10,
            retrato_id: None,
        };
        let id = inserir_personagem(&conn, &p).unwrap();
        assert!(id > 0);
        let lista = listar_personagens(&conn, Some("jogador")).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].nome, "Zoro");
        assert_eq!(lista[0].forca, 9);
        assert_eq!(listar_personagens(&conn, Some("npc")).unwrap().len(), 0);
    }

    #[test]
    fn get_personagem_monta_ficha_completa() {
        let conn = open_in_memory().unwrap();
        let p = NovoPersonagem {
            tipo: "jogador".into(),
            nome: "Luffy".into(),
            descricao: "capitão".into(),
            hp: 100, sp: 10, escudo: 5,
            forca: 9, agilidade: 8, percepcao: 5, resistencia: 7,
            intuicao: 4, espirito: 6, carisma: 9, determinacao: 10,
            retrato_id: None,
        };
        let id = inserir_personagem(&conn, &p).unwrap();

        conn.execute(
            "INSERT INTO habilidade (personagem_id,nome,descricao,ordem) VALUES (?1,'Gomu','borracha',0)",
            [id],
        ).unwrap();
        conn.execute(
            "INSERT INTO personagem_pericia (personagem_id,nome,descricao,atributo,nivel) \
             VALUES (?1,'Luta','','forca',3)",
            [id],
        ).unwrap();
        conn.execute(
            "INSERT INTO personagem_vantagem (personagem_id,nome,descricao,efeito) \
             VALUES (?1,'Sortudo','','+1 sorte')",
            [id],
        ).unwrap();
        conn.execute(
            "INSERT INTO transformacao (personagem_id,nome,descricao,ordem) VALUES (?1,'Gear 2','',0)",
            [id],
        ).unwrap();
        let tid = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO transformacao_modificador (transformacao_id,atributo,delta) \
             VALUES (?1,'agilidade',3)",
            [tid],
        ).unwrap();

        let ficha = get_personagem(&conn, id).unwrap();
        assert_eq!(ficha.nome, "Luffy");
        assert_eq!(ficha.hp, 100);
        assert_eq!(ficha.escudo, 5);
        assert_eq!(ficha.atributos.len(), 8);
        assert_eq!(ficha.atributos[0].nome, "forca");
        assert_eq!(ficha.atributos[0].valor, 9);
        // rank bate com o calculador (forca 9 < 40 -> rank 1)
        assert_eq!(
            ficha.atributos[0].rank,
            crate::domain::rank::calcular_rank("forca", 9)
        );
        assert_eq!(ficha.habilidades.len(), 1);
        assert_eq!(ficha.pericias.len(), 1);
        assert_eq!(ficha.pericias[0].nivel, 3);
        assert_eq!(ficha.vantagens.len(), 1);
        assert_eq!(ficha.desvantagens.len(), 0);
        assert_eq!(ficha.transformacoes.len(), 1);
        assert_eq!(ficha.transformacoes[0].modificadores.len(), 1);
        assert_eq!(ficha.transformacoes[0].modificadores[0].atributo, "agilidade");
    }

    #[test]
    fn get_personagem_inexistente_erra() {
        let conn = open_in_memory().unwrap();
        assert!(get_personagem(&conn, 999).is_err());
    }
}

#[cfg(test)]
mod tests_mapa {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::mapa::MapaInput;

    fn input(titulo: &str) -> MapaInput {
        MapaInput {
            titulo: titulo.into(),
            colunas: 8,
            linhas: 3,
            grade: vec!["XX------".into(), "--~~----".into(), String::new()],
            legenda: "X = arv".into(),
            efeito: "noite".into(),
        }
    }

    #[test]
    fn cria_lista_e_pega() {
        let conn = open_in_memory().unwrap();
        let m = mapa_criar(&conn, &input("Floresta")).unwrap();
        assert!(m.id > 0);
        assert_eq!(m.titulo, "Floresta");
        assert_eq!(m.grade.len(), 3);
        assert_eq!(m.grade[0], "XX------"); // 8 chars, normalizado
        assert_eq!(m.grade[2], "--------"); // linha vazia normalizada
        let lista = mapa_listar(&conn).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].titulo, "Floresta");
        assert_eq!(mapa_get(&conn, m.id).unwrap().legenda, "X = arv");
    }

    #[test]
    fn atualiza_e_erro_em_id_inexistente() {
        let conn = open_in_memory().unwrap();
        let m = mapa_criar(&conn, &input("A")).unwrap();
        let mut inp = input("A renomeado");
        inp.efeito = "dia".into();
        let atual = mapa_atualizar(&conn, m.id, &inp).unwrap();
        assert_eq!(atual.titulo, "A renomeado");
        assert_eq!(atual.efeito, "dia");
        assert!(mapa_atualizar(&conn, 9999, &inp).is_err());
    }

    #[test]
    fn duplica_e_exclui() {
        let conn = open_in_memory().unwrap();
        let m = mapa_criar(&conn, &input("Base")).unwrap();
        let copia = mapa_duplicar(&conn, m.id).unwrap();
        assert_eq!(copia.titulo, "Base (cópia)");
        assert_ne!(copia.id, m.id);
        assert_eq!(mapa_listar(&conn).unwrap().len(), 2);
        mapa_excluir(&conn, m.id).unwrap();
        assert_eq!(mapa_listar(&conn).unwrap().len(), 1);
        assert!(mapa_excluir(&conn, m.id).is_err());
    }
}

#[cfg(test)]
mod tests_nota {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::modelos::NotaInput;

    fn input(titulo: &str, corpo: &str) -> NotaInput {
        NotaInput { titulo: titulo.into(), corpo: corpo.into() }
    }

    #[test]
    fn cria_lista_e_pega() {
        let conn = open_in_memory().unwrap();
        let n = nota_criar(&conn, &input("Sessão 1", "resumo da sessão")).unwrap();
        assert!(n.id > 0);
        assert_eq!(n.titulo, "Sessão 1");
        assert_eq!(n.corpo, "resumo da sessão");
        let lista = nota_listar(&conn).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].titulo, "Sessão 1");
        assert_eq!(nota_get(&conn, n.id).unwrap().corpo, "resumo da sessão");
    }

    #[test]
    fn atualiza_e_erro_em_id_inexistente() {
        let conn = open_in_memory().unwrap();
        let n = nota_criar(&conn, &input("A", "x")).unwrap();
        let atual = nota_atualizar(&conn, n.id, &input("A renomeada", "y")).unwrap();
        assert_eq!(atual.titulo, "A renomeada");
        assert_eq!(atual.corpo, "y");
        assert!(nota_atualizar(&conn, 9999, &input("A", "x")).is_err());
    }

    #[test]
    fn exclui_e_erro_em_id_inexistente() {
        let conn = open_in_memory().unwrap();
        let n = nota_criar(&conn, &input("A", "x")).unwrap();
        nota_excluir(&conn, n.id).unwrap();
        assert!(nota_get(&conn, n.id).is_err());
        assert!(nota_excluir(&conn, n.id).is_err());
    }
}

#[cfg(test)]
mod tests_catalogo {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::modelos::{CatalogoPericiaInput, CatalogoTracoInput};

    fn pericia(nome: &str, atributo: &str) -> CatalogoPericiaInput {
        CatalogoPericiaInput { nome: nome.into(), descricao: "d".into(), atributo: atributo.into() }
    }

    fn traco(nome: &str, efeito: &str) -> CatalogoTracoInput {
        CatalogoTracoInput { nome: nome.into(), descricao: "d".into(), efeito: efeito.into() }
    }

    #[test]
    fn pericia_cria_lista_atualiza_e_exclui() {
        let conn = open_in_memory().unwrap();
        let p = catalogo_pericia_criar(&conn, &pericia("Furtividade", "agilidade")).unwrap();
        assert!(p.id > 0);
        assert_eq!(listar_catalogos(&conn).unwrap().pericias.len(), 1);

        let atualizada =
            catalogo_pericia_atualizar(&conn, p.id, &pericia("Furtividade+", "percepcao")).unwrap();
        assert_eq!(atualizada.nome, "Furtividade+");
        assert_eq!(atualizada.atributo, "percepcao");

        catalogo_pericia_excluir(&conn, p.id).unwrap();
        assert_eq!(listar_catalogos(&conn).unwrap().pericias.len(), 0);
    }

    #[test]
    fn pericia_rejeita_nome_vazio_e_id_inexistente() {
        let conn = open_in_memory().unwrap();
        assert!(catalogo_pericia_criar(&conn, &pericia("   ", "forca")).is_err());
        assert!(catalogo_pericia_atualizar(&conn, 999, &pericia("X", "forca")).is_err());
        assert!(catalogo_pericia_excluir(&conn, 999).is_err());
    }

    #[test]
    fn traco_cria_atualiza_e_exclui_vantagem_e_desvantagem_isoladas() {
        let conn = open_in_memory().unwrap();
        let v = catalogo_traco_criar(&conn, "vantagem", &traco("Sortudo", "+1 sorte")).unwrap();
        let d = catalogo_traco_criar(&conn, "desvantagem", &traco("Sortudo", "+1 sorte")).unwrap();
        assert!(v.id > 0 && d.id > 0);

        let atualizada =
            catalogo_traco_atualizar(&conn, "vantagem", v.id, &traco("Sortudo+", "+2 sorte")).unwrap();
        assert_eq!(atualizada.nome, "Sortudo+");

        catalogo_traco_excluir(&conn, "vantagem", v.id).unwrap();
        // exclusão na tabela de vantagem não derruba a entrada correspondente de desvantagem
        assert!(catalogo_traco_atualizar(&conn, "desvantagem", d.id, &traco("Sortudo", "+1")).is_ok());
        assert!(catalogo_traco_excluir(&conn, "vantagem", v.id).is_err());
    }

    #[test]
    fn traco_rejeita_tipo_invalido() {
        let conn = open_in_memory().unwrap();
        assert!(catalogo_traco_criar(&conn, "invalido", &traco("X", "e")).is_err());
        assert!(catalogo_traco_atualizar(&conn, "invalido", 1, &traco("X", "e")).is_err());
        assert!(catalogo_traco_excluir(&conn, "invalido", 1).is_err());
    }
}

#[cfg(test)]
mod tests_batalha_ativa {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::batalha::{
        Atributo, Combatente, Cooldown, DanoDistribuido, EfeitoRecorrente, Modificador,
        OrigemModificador, Pools, Tipo,
    };

    /// Estado "cheio": combatentes, pools, cooldowns, efeitos recorrentes e
    /// posições no mapa — a mesma superfície que a Parte A promete persistir.
    fn estado_cheio() -> Estado {
        let combatente = Combatente {
            id: 1,
            personagem_ref: Some(42),
            nome: "Bariarte".into(),
            tipo: Tipo::Jogador,
            faccao: Some("Chapéus de Palha".into()),
            base: [9, 8, 5, 7, 4, 6, 9, 10],
            pools: Pools { hp: 80, sp: 30, escudo: 10 },
            modificadores: vec![Modificador {
                origem: OrigemModificador::Transformacao("Gear 2".into()),
                deltas: vec![(Atributo::Agilidade, 10)],
                duracao: None,
            }],
            cooldowns: vec![Cooldown { habilidade: "Gomu Gomu".into(), turnos_restantes: Some(2) }],
            efeitos_recorrentes: vec![EfeitoRecorrente {
                origem: "Veneno".into(),
                dano: DanoDistribuido { hp: 5, sp: 0, escudo: 0, escudo_transborda: false },
                duracao: 3,
            }],
            turnos_extras: 1,
            posicao: Some((2, 5)),
        };
        Estado {
            combatentes: vec![combatente],
            ordem: vec![1],
            ordem_manual: true,
            rodada: 3,
            indice_turno: 1,
            historico: Vec::new(),
            mapa_id: Some(7),
        }
    }

    #[test]
    fn round_trip_preserva_estado_inteiro() {
        let conn = open_in_memory().unwrap();
        let estado = estado_cheio();
        batalha_salvar(&conn, &estado, 2).unwrap();
        let CargaBatalha::Restaurada(carregado, proximo_id) = batalha_carregar(&conn).unwrap()
        else {
            panic!("esperava batalha restaurada");
        };
        assert_eq!(carregado, estado);
        assert_eq!(proximo_id, 2);
    }

    #[test]
    fn salvar_de_novo_faz_upsert_sem_duplicar_linha() {
        let conn = open_in_memory().unwrap();
        batalha_salvar(&conn, &estado_cheio(), 2).unwrap();
        let mut outro = estado_cheio();
        outro.rodada = 9;
        batalha_salvar(&conn, &outro, 5).unwrap();

        let n: i64 = conn.query_row("SELECT count(*) FROM batalha_ativa", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let CargaBatalha::Restaurada(carregado, proximo_id) = batalha_carregar(&conn).unwrap()
        else {
            panic!("esperava batalha restaurada");
        };
        assert_eq!(carregado.rodada, 9);
        assert_eq!(proximo_id, 5);
    }

    #[test]
    fn carregar_de_banco_vazio_devolve_vazia() {
        let conn = open_in_memory().unwrap();
        assert!(matches!(batalha_carregar(&conn).unwrap(), CargaBatalha::Vazia));
    }

    /// JSON quebrado não pode virar `Vazia`: os dois abrem batalha nova, mas só
    /// este está prestes a apagar um save de verdade no próximo UPSERT. Tem que
    /// devolver o cru pra quem chama poder guardar em quarentena.
    #[test]
    fn carregar_com_json_corrompido_devolve_o_cru_em_vez_de_descartar() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO batalha_ativa (id,estado,proximo_id) VALUES (1,'{not valid json',1)",
            [],
        )
        .unwrap();
        let CargaBatalha::Ilegivel(bruto) = batalha_carregar(&conn).unwrap() else {
            panic!("esperava Ilegivel, não descarte silencioso");
        };
        assert_eq!(bruto, "{not valid json");
    }
}

#[cfg(test)]
mod tests_batalha_preset {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::batalha::{Combatente, Pools, Tipo};

    fn combatente(id: u32, nome: &str) -> Combatente {
        Combatente {
            id,
            personagem_ref: None,
            nome: nome.into(),
            tipo: Tipo::Npc,
            faccao: None,
            base: [1, 1, 1, 1, 1, 1, 1, 1],
            pools: Pools { hp: 10, sp: 0, escudo: 0 },
            modificadores: Vec::new(),
            cooldowns: Vec::new(),
            efeitos_recorrentes: Vec::new(),
            turnos_extras: 0,
            posicao: None,
        }
    }

    fn estado_com(combatentes: Vec<Combatente>) -> Estado {
        Estado {
            ordem: combatentes.iter().map(|c| c.id).collect(),
            combatentes,
            ordem_manual: false,
            rodada: 1,
            indice_turno: 0,
            historico: Vec::new(),
            mapa_id: None,
        }
    }

    #[test]
    fn salvar_e_listar() {
        let conn = open_in_memory().unwrap();
        let estado = estado_com(vec![combatente(1, "Bandido"), combatente(2, "Bandido 2")]);

        let salvo = batalha_preset_salvar(&conn, "Emboscada", "3 bandidos na estrada", &estado, 3)
            .unwrap();
        assert_eq!(salvo.nome, "Emboscada");
        assert_eq!(salvo.combatentes, 2);

        let lista = batalha_preset_listar(&conn).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].id, salvo.id);
        assert_eq!(lista[0].combatentes, 2);
    }

    #[test]
    fn carregar_de_volta_preserva_estado_e_proximo_id() {
        let conn = open_in_memory().unwrap();
        let estado = estado_com(vec![combatente(1, "Bandido")]);
        let salvo = batalha_preset_salvar(&conn, "Emboscada", "", &estado, 2).unwrap();

        let (carregado, proximo_id, nome) = batalha_preset_obter(&conn, salvo.id).unwrap();
        assert_eq!(carregado, estado);
        assert_eq!(proximo_id, 2);
        assert_eq!(nome, "Emboscada");
    }

    #[test]
    fn sobrescrever_atualiza_snapshot_mas_mantem_nome() {
        let conn = open_in_memory().unwrap();
        let original = estado_com(vec![combatente(1, "Bandido")]);
        let salvo = batalha_preset_salvar(&conn, "Emboscada", "desc", &original, 2).unwrap();

        let atualizado = estado_com(vec![combatente(1, "Bandido"), combatente(2, "Chefe")]);
        let resumo = batalha_preset_sobrescrever(&conn, salvo.id, &atualizado, 3).unwrap();
        assert_eq!(resumo.nome, "Emboscada");
        assert_eq!(resumo.combatentes, 2);

        let (carregado, proximo_id, _) = batalha_preset_obter(&conn, salvo.id).unwrap();
        assert_eq!(carregado, atualizado);
        assert_eq!(proximo_id, 3);

        assert!(batalha_preset_sobrescrever(&conn, 999, &atualizado, 1).is_err());
    }

    #[test]
    fn renomear_e_excluir() {
        let conn = open_in_memory().unwrap();
        let estado = estado_com(vec![]);
        let salvo = batalha_preset_salvar(&conn, "Rascunho", "", &estado, 1).unwrap();

        let renomeado = batalha_preset_renomear(&conn, salvo.id, "Emboscada Final", "revisado")
            .unwrap();
        assert_eq!(renomeado.nome, "Emboscada Final");
        assert_eq!(renomeado.descricao, "revisado");
        assert!(batalha_preset_renomear(&conn, 999, "X", "").is_err());

        batalha_preset_excluir(&conn, salvo.id).unwrap();
        assert!(batalha_preset_listar(&conn).unwrap().is_empty());
        assert!(batalha_preset_excluir(&conn, salvo.id).is_err());
    }

    /// Mesmo raciocínio de `carregar_com_json_corrompido_devolve_o_cru_em_vez_de_descartar`
    /// na batalha ativa: um preset ilegível tem que dar erro claro ao CARREGAR
    /// (não virar preset vazio silenciosamente). A listagem, por outro lado, é
    /// só leitura e não pode quebrar por causa de uma linha corrompida.
    #[test]
    fn preset_com_json_ilegivel_falha_ao_carregar_mas_nao_derruba_a_listagem() {
        let conn = open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO batalha_salva (id,nome,descricao,estado,proximo_id) \
             VALUES (1,'Corrompido','','{not valid json',1)",
            [],
        )
        .unwrap();

        let erro = batalha_preset_obter(&conn, 1).unwrap_err();
        assert!(erro.to_string().contains("Corrompido"));

        let lista = batalha_preset_listar(&conn).unwrap();
        assert_eq!(lista.len(), 1);
        assert_eq!(lista[0].combatentes, 0);
    }
}
