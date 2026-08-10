# Mapa (Fase 3) — Plano A: Backend

> **Para workers:** implemente tarefa-a-tarefa. Steps usam checkbox (`- [ ]`).
> **REGRA DO v2 — SEM GIT.** Não há passo de commit. Cada tarefa fecha num **checkpoint de verificação** (`cargo test` / `cargo build`). Não rodar `git` em lugar nenhum.
> **Spec:** `docs/specs/2026-07-20-fase-3-mapa.md`. Este é o Plano **A** (backend); o Plano **B** (frontend) é o arquivo irmão.

**Goal:** Persistir mapas ASCII no SQLite e expor 7 comandos Tauri, incluindo a render pura `render_discord` (fonte única do texto que vai pro Discord), tudo coberto por `cargo test`.

**Architecture:** Lógica pura e testável em `domain/mapa/` (modelos + normalização + render). Persistência em `db/repositorios.rs` (funções livres `conn: &Connection`, padrão do projeto). Comandos finos em `lib.rs` acessando `db: State<Db>`. Migration aditiva `0003_mapa.sql`.

**Tech Stack:** Rust, rusqlite 0.32 (bundled) + rusqlite_migration 1.2, serde/serde_json, thiserror. Testes: `cargo test` com `open_in_memory()`.

> **Onde rodar os comandos:** todos os `cargo ...` rodam no diretório `C:\dev\projeto-rpg-v2\src-tauri` (PowerShell). Os testes de lógica pura não precisam de banco; os de repositório usam SQLite `:memory:` via `open_in_memory()`.

---

### Task A1: Migration `0003_mapa.sql` + registro

**Files:**
- Create: `src-tauri/migrations/0003_mapa.sql`
- Modify: `src-tauri/src/db/connection.rs` (função `migrations()`)

- [ ] **Step 1: Criar o arquivo de migration**

`src-tauri/migrations/0003_mapa.sql`:
```sql
CREATE TABLE mapa (
    id               INTEGER PRIMARY KEY,
    titulo           TEXT NOT NULL DEFAULT '',
    colunas          INTEGER NOT NULL DEFAULT 26,
    linhas           INTEGER NOT NULL DEFAULT 7,
    grade            TEXT NOT NULL DEFAULT '[]',
    ordem_navegacao  TEXT NOT NULL DEFAULT '',
    legenda          TEXT NOT NULL DEFAULT '',
    efeito           TEXT NOT NULL DEFAULT '',
    criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Registrar a migration** em `src-tauri/src/db/connection.rs`, adicionando a linha `0003` ao final do `vec!` da função `migrations()`:

```rust
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init.sql")),
        M::up(include_str!("../../migrations/0002_habilidade_combate.sql")),
        M::up(include_str!("../../migrations/0003_mapa.sql")),
    ])
}
```

- [ ] **Step 3: Checkpoint — migrations válidas**

Run: `cargo test --lib db::connection`
Expected: PASS (inclui `migrations_sao_validas` e `aplica_e_cria_tabelas`).
Se `aplica_e_cria_tabelas` afirmar uma contagem fixa de tabelas e falhar (13 em vez de 12), atualize o número esperado nesse teste em `connection.rs` para incluir `mapa`. (Se o teste usa uma lista `IN (...)` de nomes, ele passa sem mudança.)

---

### Task A2: Modelos + normalização (`domain/mapa/modelos.rs`)

**Files:**
- Create: `src-tauri/src/domain/mapa/modelos.rs`
- Create: `src-tauri/src/domain/mapa/mod.rs`
- Modify: `src-tauri/src/domain/mod.rs` (adicionar `pub mod mapa;`)

- [ ] **Step 1: Criar `modelos.rs` com os structs, constantes e a normalização**

`src-tauri/src/domain/mapa/modelos.rs`:
```rust
use serde::{Deserialize, Serialize};

pub const CELULA_VAZIA: char = '-';
pub const COLUNAS_MIN: u8 = 6;
pub const COLUNAS_MAX: u8 = 26;
pub const LINHAS_MIN: u8 = 3;
pub const LINHAS_MAX: u8 = 50;
pub const LIMITE_DISCORD: usize = 2000;

/// Mapa completo (grade já normalizada: `linhas` strings de `colunas` chars).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mapa {
    pub id: i64,
    pub titulo: String,
    pub colunas: u8,
    pub linhas: u8,
    pub grade: Vec<String>,
    pub ordem_navegacao: String,
    pub legenda: String,
    pub efeito: String,
    pub criado_em: String,
    pub atualizado_em: String,
}

/// Resumo pra lista lateral (sem a grade).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapaResumo {
    pub id: i64,
    pub titulo: String,
    pub atualizado_em: String,
}

/// Entrada de criação/atualização vinda da UI.
#[derive(Debug, Clone, Deserialize)]
pub struct MapaInput {
    pub titulo: String,
    pub colunas: u8,
    pub linhas: u8,
    pub grade: Vec<String>,
    pub ordem_navegacao: String,
    pub legenda: String,
    pub efeito: String,
}

/// Força a grade ao formato exato: `linhas` strings de `colunas` chars.
/// Célula ausente → CELULA_VAZIA; whitespace/controle numa célula → CELULA_VAZIA.
/// Dimensões são clampadas nos limites.
pub fn normalizar_grade(grade: &[String], colunas: u8, linhas: u8) -> Vec<String> {
    let colunas = colunas.clamp(COLUNAS_MIN, COLUNAS_MAX);
    let linhas = linhas.clamp(LINHAS_MIN, LINHAS_MAX);
    let mut out = Vec::with_capacity(linhas as usize);
    for i in 0..linhas as usize {
        let origem = grade.get(i).map(String::as_str).unwrap_or("");
        let mut chars = origem.chars();
        let mut linha = String::with_capacity(colunas as usize);
        for _ in 0..colunas {
            let c = match chars.next() {
                Some(c) if !c.is_control() && !c.is_whitespace() => c,
                _ => CELULA_VAZIA,
            };
            linha.push(c);
        }
        out.push(linha);
    }
    out
}

/// Normaliza um input inteiro (dimensões clampadas + grade no formato exato).
pub fn normalizar(mut input: MapaInput) -> MapaInput {
    let colunas = input.colunas.clamp(COLUNAS_MIN, COLUNAS_MAX);
    let linhas = input.linhas.clamp(LINHAS_MIN, LINHAS_MAX);
    input.grade = normalizar_grade(&input.grade, colunas, linhas);
    input.colunas = colunas;
    input.linhas = linhas;
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp(colunas: u8, linhas: u8, grade: &[&str]) -> MapaInput {
        MapaInput {
            titulo: String::new(),
            colunas,
            linhas,
            grade: grade.iter().map(|s| s.to_string()).collect(),
            ordem_navegacao: String::new(),
            legenda: String::new(),
            efeito: String::new(),
        }
    }

    #[test]
    fn normaliza_pad_e_crop() {
        let n = normalizar(inp(6, 3, &["XX", "XXXXXXXX"]));
        assert_eq!(n.grade.len(), 3);
        assert_eq!(n.grade[0], "XX----"); // pad até 6
        assert_eq!(n.grade[1], "XXXXXX"); // crop pra 6
        assert_eq!(n.grade[2], "------"); // linha nova
    }

    #[test]
    fn normaliza_clampa_dimensoes() {
        let n = normalizar(inp(100, 1, &[]));
        assert_eq!(n.colunas, 26);
        assert_eq!(n.linhas, 3);
        assert_eq!(n.grade.len(), 3);
        assert_eq!(n.grade[0].chars().count(), 26);
        let n2 = normalizar(inp(2, 99, &[]));
        assert_eq!(n2.colunas, 6);
        assert_eq!(n2.linhas, 50);
    }

    #[test]
    fn normaliza_whitespace_vira_vazio() {
        let n = normalizar(inp(3, 1, &["X X"]));
        assert_eq!(n.grade[0], "X-X"); // o espaço do meio vira '-'
    }
}
```

- [ ] **Step 2: Criar `mod.rs` do módulo mapa** (`render` é adicionado na Task A3; a linha `pub mod render;` já entra aqui pra o módulo compilar após A3 — por ora deixe só `modelos` e adicione `render` na A3):

`src-tauri/src/domain/mapa/mod.rs`:
```rust
pub mod modelos;

pub use modelos::{
    normalizar, normalizar_grade, Mapa, MapaInput, MapaResumo, CELULA_VAZIA, COLUNAS_MAX,
    COLUNAS_MIN, LIMITE_DISCORD, LINHAS_MAX, LINHAS_MIN,
};
```

- [ ] **Step 3: Registrar o módulo** em `src-tauri/src/domain/mod.rs` — adicionar `pub mod mapa;` (manter as linhas existentes):
```rust
pub mod batalha;
pub mod mapa;
pub mod modelos;
pub mod rank;
```

- [ ] **Step 4: Checkpoint**

Run: `cargo test --lib domain::mapa::modelos`
Expected: PASS (3 testes: `normaliza_pad_e_crop`, `normaliza_clampa_dimensoes`, `normaliza_whitespace_vira_vazio`).

---

### Task A3: Render pro Discord (`domain/mapa/render.rs`)

**Files:**
- Create: `src-tauri/src/domain/mapa/render.rs`
- Modify: `src-tauri/src/domain/mapa/mod.rs` (adicionar `render`)

- [ ] **Step 1: Escrever `render.rs` com os testes de formato exato primeiro** (TDD — o corpo das funções vem no mesmo arquivo já implementado; rode depois pra confirmar):

`src-tauri/src/domain/mapa/render.rs`:
```rust
use super::modelos::{Mapa, LIMITE_DISCORD};

/// Rótulo de coluna: 0→'A', 1→'B', ... (até 25→'Z').
fn rotulo_coluna(indice: usize) -> char {
    (b'A' + indice as u8) as char
}

/// Renderiza o mapa no formato EXATO que vai pro Discord:
/// título `**negrito**`, grade num bloco ``` monoespaçado,
/// Ordem/Legenda/Efeito como texto normal (fora do bloco), só os não-vazios.
pub fn render_discord(m: &Mapa) -> String {
    let mut out = String::new();

    if !m.titulo.trim().is_empty() {
        out.push_str("**");
        out.push_str(m.titulo.trim());
        out.push_str("**\n\n");
    }

    let largura_rotulo = m.linhas.to_string().len();

    out.push_str("```\n");
    // cabeçalho de colunas: (largura_rotulo + 1) espaços, depois A B C ...
    for _ in 0..largura_rotulo + 1 {
        out.push(' ');
    }
    for c in 0..m.colunas as usize {
        out.push(rotulo_coluna(c));
        if c + 1 < m.colunas as usize {
            out.push(' ');
        }
    }
    out.push('\n');
    // linhas
    for (i, linha) in m.grade.iter().enumerate() {
        out.push_str(&format!("{:>width$}", i + 1, width = largura_rotulo));
        out.push(' ');
        let mut chars = linha.chars();
        for c in 0..m.colunas as usize {
            out.push(chars.next().unwrap_or('-'));
            if c + 1 < m.colunas as usize {
                out.push(' ');
            }
        }
        out.push('\n');
    }
    out.push_str("```");

    // textos fora do bloco (só os preenchidos)
    let extras = [
        ("Ordem", m.ordem_navegacao.trim()),
        ("Legenda", m.legenda.trim()),
        ("Efeito", m.efeito.trim()),
    ];
    let mut primeiro = true;
    for (rotulo, valor) in extras {
        if !valor.is_empty() {
            out.push_str(if primeiro { "\n\n" } else { "\n" });
            primeiro = false;
            out.push_str(&format!("**{rotulo}:** {valor}"));
        }
    }

    out
}

/// True se o texto renderizado passa do limite de caracteres do Discord.
pub fn excede_discord(s: &str) -> bool {
    s.chars().count() > LIMITE_DISCORD
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapa(titulo: &str, colunas: u8, linhas: u8, grade: &[&str], ordem: &str, legenda: &str, efeito: &str) -> Mapa {
        Mapa {
            id: 0,
            titulo: titulo.into(),
            colunas,
            linhas,
            grade: grade.iter().map(|s| s.to_string()).collect(),
            ordem_navegacao: ordem.into(),
            legenda: legenda.into(),
            efeito: efeito.into(),
            criado_em: String::new(),
            atualizado_em: String::new(),
        }
    }

    #[test]
    fn formato_exato_com_titulo_e_extras() {
        let m = mapa("Teste", 3, 2, &["-XX", "X--"], "-> ->", "X = arv", "");
        let esperado = "**Teste**\n\n```\n  A B C\n1 - X X\n2 X - -\n```\n\n**Ordem:** -> ->\n**Legenda:** X = arv";
        assert_eq!(render_discord(&m), esperado);
    }

    #[test]
    fn sem_titulo_comeca_no_bloco_e_padda_linha_curta() {
        let m = mapa("", 3, 2, &["X", ""], "", "", "");
        // "X" vira "X - -" (pad), linha vazia vira "- - -"
        let esperado = "```\n  A B C\n1 X - -\n2 - - -\n```";
        assert_eq!(render_discord(&m), esperado);
    }

    #[test]
    fn largura_rotulo_dois_digitos() {
        let mut grade = Vec::new();
        for _ in 0..10 {
            grade.push("------".to_string());
        }
        let refs: Vec<&str> = grade.iter().map(String::as_str).collect();
        let m = mapa("", 6, 10, &refs, "", "", "");
        let out = render_discord(&m);
        // largura_rotulo = 2 → cabeçalho começa com 3 espaços; linha 1 com " 1"
        assert!(out.starts_with("```\n   A B C D E F\n 1 "));
        assert!(out.contains("\n10 "));
    }

    #[test]
    fn excede_discord_no_limite() {
        assert!(!excede_discord("abc"));
        assert!(excede_discord(&"a".repeat(2001)));
        // mapa cheio 26x50 estoura
        let linha = "X".repeat(26);
        let grade: Vec<String> = std::iter::repeat(linha).take(50).collect();
        let refs: Vec<&str> = grade.iter().map(String::as_str).collect();
        let m = mapa("Grande", 26, 50, &refs, "", "", "");
        assert!(excede_discord(&render_discord(&m)));
    }
}
```

- [ ] **Step 2: Adicionar `render` ao `mod.rs`** (`src-tauri/src/domain/mapa/mod.rs`):
```rust
pub mod modelos;
pub mod render;

pub use modelos::{
    normalizar, normalizar_grade, Mapa, MapaInput, MapaResumo, CELULA_VAZIA, COLUNAS_MAX,
    COLUNAS_MIN, LIMITE_DISCORD, LINHAS_MAX, LINHAS_MIN,
};
pub use render::{excede_discord, render_discord};
```

- [ ] **Step 3: Checkpoint**

Run: `cargo test --lib domain::mapa`
Expected: PASS (os 3 de modelos + os 4 de render). Se `formato_exato_com_titulo_e_extras` falhar, compare o diff exato — o alinhamento do cabeçalho depende de `largura_rotulo + 1` espaços.

---

### Task A4: Repositório (`db/repositorios.rs`)

**Files:**
- Modify: `src-tauri/src/db/repositorios.rs` (imports no topo + funções `mapa_*` + módulo de teste no fim)

- [ ] **Step 1: Adicionar imports do mapa no topo do arquivo** (junto aos `use` existentes):
```rust
use crate::domain::mapa::{
    normalizar, normalizar_grade, Mapa, MapaInput, MapaResumo, COLUNAS_MAX, COLUNAS_MIN,
    LINHAS_MAX, LINHAS_MIN,
};
```

- [ ] **Step 2: Adicionar as funções do repositório** (em qualquer ponto do corpo do arquivo, fora do `mod tests`):
```rust
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
        ordem_navegacao: row.get(5)?,
        legenda: row.get(6)?,
        efeito: row.get(7)?,
        criado_em: row.get(8)?,
        atualizado_em: row.get(9)?,
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
            "SELECT id,titulo,colunas,linhas,grade,ordem_navegacao,legenda,efeito,criado_em,atualizado_em \
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
        "INSERT INTO mapa (titulo,colunas,linhas,grade,ordem_navegacao,legenda,efeito) \
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            input.titulo, input.colunas, input.linhas, grade_json,
            input.ordem_navegacao, input.legenda, input.efeito
        ],
    )?;
    mapa_get(conn, conn.last_insert_rowid())
}

pub fn mapa_atualizar(conn: &Connection, id: i64, input: &MapaInput) -> Result<Mapa, AppError> {
    let input = normalizar(input.clone());
    let grade_json = serde_json::to_string(&input.grade)?;
    let n = conn.execute(
        "UPDATE mapa SET titulo=?1,colunas=?2,linhas=?3,grade=?4,ordem_navegacao=?5,\
         legenda=?6,efeito=?7,atualizado_em=datetime('now') WHERE id=?8",
        params![
            input.titulo, input.colunas, input.linhas, grade_json,
            input.ordem_navegacao, input.legenda, input.efeito, id
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
        ordem_navegacao: orig.ordem_navegacao,
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
```

- [ ] **Step 3: Adicionar o módulo de teste no fim do arquivo** (novo `mod`, não mexer no `mod tests` existente):
```rust
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
            ordem_navegacao: "n1 -> n2".into(),
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
```

- [ ] **Step 4: Checkpoint**

Run: `cargo test --lib db::repositorios::tests_mapa`
Expected: PASS (`cria_lista_e_pega`, `atualiza_e_erro_em_id_inexistente`, `duplica_e_exclui`).

---

### Task A5: Comandos Tauri (`lib.rs`)

**Files:**
- Modify: `src-tauri/src/lib.rs` (imports + 7 comandos + `generate_handler!`)

- [ ] **Step 1: Adicionar o import do módulo mapa** no topo do `lib.rs` (junto aos `use domain::...` existentes):
```rust
use domain::mapa::{normalizar, render_discord, Mapa, MapaInput, MapaResumo};
```

- [ ] **Step 2: Adicionar os 7 comandos** (perto dos outros `#[tauri::command]`):
```rust
#[tauri::command]
fn listar_mapas(db: tauri::State<Db>) -> Result<Vec<MapaResumo>, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_listar(&conn)
}

#[tauri::command]
fn get_mapa(db: tauri::State<Db>, id: i64) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_get(&conn, id)
}

#[tauri::command]
fn criar_mapa(db: tauri::State<Db>, input: MapaInput) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_mapa(db: tauri::State<Db>, id: i64, input: MapaInput) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_atualizar(&conn, id, &input)
}

#[tauri::command]
fn duplicar_mapa(db: tauri::State<Db>, id: i64) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_duplicar(&conn, id)
}

#[tauri::command]
fn excluir_mapa(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_excluir(&conn, id)
}

/// Render do estado ATUAL do editor (não precisa de banco). Fonte única do texto do Discord.
#[tauri::command]
fn render_mapa_discord(input: MapaInput) -> String {
    let input = normalizar(input);
    let m = Mapa {
        id: 0,
        titulo: input.titulo,
        colunas: input.colunas,
        linhas: input.linhas,
        grade: input.grade,
        ordem_navegacao: input.ordem_navegacao,
        legenda: input.legenda,
        efeito: input.efeito,
        criado_em: String::new(),
        atualizado_em: String::new(),
    };
    render_discord(&m)
}
```

- [ ] **Step 3: Registrar no `generate_handler!`** — adicionar vírgula após `calcular_rank` e listar os 7 (último sem vírgula):
```rust
            calcular_rank,
            listar_mapas,
            get_mapa,
            criar_mapa,
            atualizar_mapa,
            duplicar_mapa,
            excluir_mapa,
            render_mapa_discord
        ])
```

- [ ] **Step 4: Checkpoint — build + suíte inteira**

Run: `cargo build`
Expected: compila limpo (sem erros; warnings de import não-usado = corrigir removendo o que sobrar).

Run: `cargo test`
Expected: TODA a suíte PASS (os testes novos de mapa + os ~25 de batalha e os de connection inalterados).

---

## Self-review (feito ao escrever)

**Cobertura da spec (§):** tabela `mapa` (A1) ✓; `domain/mapa/` modelos+normalizar (A2) ✓ e render+excede_discord (A3) ✓; repositório 6 funções (A4) ✓; 7 comandos incl. `render_mapa_discord` (A5) ✓; grade como JSON texto (A4 `serde_json`) ✓; normalização defensiva na leitura (`mapa_get`, A4) ✓; sem deps novas ✓.
**Consistência de tipos:** `Mapa`/`MapaResumo`/`MapaInput` idênticos entre modelos, repo, comandos; `render_discord(&Mapa)`; `normalizar(MapaInput)`; colunas/linhas `u8` (rusqlite lê/grava u8 ok). `render_mapa_discord` monta `Mapa` transitório a partir de `MapaInput` normalizado.
**Sem placeholders:** todo passo tem código real e comando com resultado esperado.
**Fora do escopo (confirmado):** sync com bot, import de mapas v1, cor no Discord — não neste plano.
```
