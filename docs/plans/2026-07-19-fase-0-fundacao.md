# Fase 0 — Fundação · Plano de Implementação

> **Para workers agênticos:** SUB-SKILL: use superpowers:subagent-driven-development. Passos usam checkbox (`- [ ]`).
>
> ⚠️ **SEM GIT NESTE PROJETO.** NÃO rodar `git init/add/commit` nem worktree. Onde o padrão pediria "commit", o checkpoint é **build + testes verdes**.

**Base directory:** `C:\dev\projeto-rpg-v2` (fora do OneDrive).

**Goal:** Esqueleto do `projeto-rpg-v2` (Tauri v2 + React/TS) rodando, SQLite criado por migrations, dados do v1 importados (fichas + catálogos + imagens em disco), e prova end-to-end de que o frontend consulta os dados via comando Rust.

**Architecture:** Tauri v2, backend Rust. React/TS chama `#[tauri::command]`s via `invoke`. SQLite só no Rust (`rusqlite`, `Connection` em `tauri::State<Mutex<Connection>>`), schema por `rusqlite_migration`. Imagens base64 do v1 → arquivos em `app_data_dir/images/`; o banco guarda só o caminho.

**Tech Stack:** Tauri v2, React 19 + TS + Vite, rusqlite (bundled) + rusqlite_migration, serde/serde_json, base64, sha2, hex, thiserror.

**Escopo:** SÓ Fase 0. Galeria/ficha/CRUD = Fase 1. Rank, batalha, mapa, discord, acessórios = depois.

---

## Status de execução (atualizado durante o run)

- [x] **Task 0 — Pré-requisitos:** rustc/cargo 1.97, node v22.16, npm 10.9, rustup 1.29; **linker MSVC OK** (pre-flight `cargo build` de hello-world = exit 0).
- [x] **Task 1 — Scaffold:** `create-tauri-app` template `react-ts`, `--tauri-version 2`, identifier `com.gedasio.rpgv2`, em `C:\dev\projeto-rpg-v2`. Template já traz comando `greet` + `.plugin(tauri_plugin_opener::init())` em `src-tauri/src/lib.rs` (Task 7 mantém o plugin, remove o greet). `npm install` ainda pendente (Task 2/8).
- [x] **Task 2–9 — COMPLETAS.** Backend Rust (5 módulos, 6 testes verdes, review de spec + qualidade), migração v1→SQLite, comandos Tauri, prova no frontend. Fix extra: **idempotência** do import (clicar 2× não duplica) com teste de regressão `importar_v1_completo_e_idempotente`.

**FASE 0 CONCLUÍDA E VERIFICADA (2026-07-19):** banco `rpg.db` com 6 jogadores + 13 NPCs (19 total), 24 imagens extraídas pra `app_data/images/`, catálogos seedados. App abre, importa, lista e persiste.

---

## Estrutura de arquivos (Fase 0)

```
C:\dev\projeto-rpg-v2\
├── src/App.tsx                   # MODIFY (Task 8): prova importar+listar
├── src-tauri/
│   ├── Cargo.toml                # MODIFY (Task 2)
│   ├── migrations/0001_init.sql  # CREATE (Task 3)
│   └── src/
│       ├── lib.rs                # MODIFY (Task 7)
│       ├── db/{mod,error,connection,repositorios}.rs   # CREATE (3,5)
│       ├── domain/{mod,modelos}.rs                      # CREATE (4)
│       └── migration/{mod,importador_v1}.rs            # CREATE (6)
```

Cada arquivo Rust = uma responsabilidade. Nenhum SQL fora de `db/` e `migration/`.

---

## Task 2: Dependências Rust

**Files:** Modify `src-tauri/Cargo.toml`

- [ ] **Step 1: Adicionar deps em `[dependencies]`** (manter `tauri`, `tauri-plugin-opener`, `serde`, `serde_json` já presentes):
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
rusqlite_migration = "1.2"
base64 = "0.22"
sha2 = "0.10"
hex = "0.4"
thiserror = "1"
```

- [ ] **Step 2: Compilar.** Run em `src-tauri/`: `cargo build`. Esperado: baixa/compila sem erro (bundled compila SQLite, ~1-2 min). Se alguma versão não resolver, subir p/ a última compatível.

- [ ] **Step 3: Checkpoint** — `cargo build` verde.

---

## Task 3: Schema SQLite + conexão + migrations

**Files:** Create `src-tauri/migrations/0001_init.sql`, `src-tauri/src/db/{mod,error,connection}.rs`; Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: Escrever `src-tauri/migrations/0001_init.sql`** — todo o schema:
```sql
CREATE TABLE imagem (
    id        INTEGER PRIMARY KEY,
    caminho   TEXT NOT NULL,
    formato   TEXT NOT NULL,
    sha256    TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE personagem (
    id            INTEGER PRIMARY KEY,
    tipo          TEXT NOT NULL CHECK (tipo IN ('jogador','npc')),
    nome          TEXT NOT NULL,
    descricao     TEXT NOT NULL DEFAULT '',
    hp            INTEGER NOT NULL DEFAULT 0,
    sp            INTEGER NOT NULL DEFAULT 0,
    escudo        INTEGER NOT NULL DEFAULT 0,
    forca         INTEGER NOT NULL DEFAULT 0,
    agilidade     INTEGER NOT NULL DEFAULT 0,
    percepcao     INTEGER NOT NULL DEFAULT 0,
    resistencia   INTEGER NOT NULL DEFAULT 0,
    intuicao      INTEGER NOT NULL DEFAULT 0,
    espirito      INTEGER NOT NULL DEFAULT 0,
    carisma       INTEGER NOT NULL DEFAULT 0,
    determinacao  INTEGER NOT NULL DEFAULT 0,
    retrato_id    INTEGER REFERENCES imagem(id) ON DELETE SET NULL,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_personagem_tipo ON personagem(tipo);
CREATE TABLE habilidade (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE personagem_pericia (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', atributo TEXT NOT NULL DEFAULT '', nivel INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE personagem_vantagem (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT ''
);
CREATE TABLE personagem_desvantagem (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT ''
);
CREATE TABLE transformacao (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '',
    imagem_id INTEGER REFERENCES imagem(id) ON DELETE SET NULL, ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE transformacao_modificador (
    id INTEGER PRIMARY KEY,
    transformacao_id INTEGER NOT NULL REFERENCES transformacao(id) ON DELETE CASCADE,
    atributo TEXT NOT NULL, delta INTEGER NOT NULL
);
CREATE TABLE transformacao_habilidade (
    id INTEGER PRIMARY KEY,
    transformacao_id INTEGER NOT NULL REFERENCES transformacao(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT ''
);
CREATE TABLE catalogo_pericia (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', atributo TEXT NOT NULL DEFAULT '');
CREATE TABLE catalogo_vantagem (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT '');
CREATE TABLE catalogo_desvantagem (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT '');
```

- [ ] **Step 2: Criar `src-tauri/src/db/error.rs`:**
```rust
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("base64: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("{0}")]
    Msg(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

- [ ] **Step 3: Criar `src-tauri/src/db/connection.rs`:**
```rust
use crate::db::error::AppError;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(include_str!("../../migrations/0001_init.sql"))])
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

#[cfg(test)]
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
                "SELECT count(*) FROM sqlite_master WHERE type='table' \
                 AND name IN ('personagem','imagem','habilidade','transformacao', \
                 'transformacao_modificador','catalogo_pericia')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 6);
    }
}
```

- [ ] **Step 4: Criar `src-tauri/src/db/mod.rs`:**
```rust
pub mod connection;
pub mod error;
pub mod repositorios;
```
(Se rodar o teste da Task 3 antes da Task 5, comente `pub mod repositorios;` temporariamente e reative na Task 5.)

- [ ] **Step 5: Declarar `mod db;` no topo de `src-tauri/src/lib.rs`.**

- [ ] **Step 6: Rodar os testes.** Run em `src-tauri/`: `cargo test connection`. Esperado: `migrations_sao_validas` + `aplica_e_cria_tabelas` PASS.

- [ ] **Step 7: Checkpoint** — migrations válidas e criam as 6 tabelas.

---

## Task 4: Modelos de domínio

**Files:** Create `src-tauri/src/domain/{mod,modelos}.rs`; Modify `lib.rs`

- [ ] **Step 1: `src-tauri/src/domain/modelos.rs`:**
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonagemResumo {
    pub id: i64,
    pub tipo: String,
    pub nome: String,
    pub retrato: Option<String>,
    pub forca: i64,
    pub agilidade: i64,
    pub percepcao: i64,
    pub resistencia: i64,
    pub intuicao: i64,
    pub espirito: i64,
    pub carisma: i64,
    pub determinacao: i64,
}
```

- [ ] **Step 2: `src-tauri/src/domain/mod.rs`:** `pub mod modelos;`

- [ ] **Step 3:** adicionar `mod domain;` em `lib.rs`.

- [ ] **Step 4: Compilar.** `cargo build` (em `src-tauri/`). Esperado: compila (warning de não-uso ok).

- [ ] **Step 5: Checkpoint** — build verde.

---

## Task 5: Repositório de personagem (inserir + listar)

**Files:** Create `src-tauri/src/db/repositorios.rs`; Modify `db/mod.rs`

- [ ] **Step 1:** garantir `pub mod repositorios;` ativo em `db/mod.rs`.

- [ ] **Step 2: Criar `src-tauri/src/db/repositorios.rs` completo** (impl + teste):
```rust
use crate::db::error::AppError;
use crate::domain::modelos::PersonagemResumo;
use rusqlite::{params, Connection, Row};

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
    })
}

pub fn listar_personagens(
    conn: &Connection,
    tipo: Option<&str>,
) -> Result<Vec<PersonagemResumo>, AppError> {
    let base = "SELECT p.id,p.tipo,p.nome,i.caminho,p.forca,p.agilidade,p.percepcao,\
                p.resistencia,p.intuicao,p.espirito,p.carisma,p.determinacao \
                FROM personagem p LEFT JOIN imagem i ON i.id = p.retrato_id";
    let out = match tipo {
        Some(t) => {
            let mut stmt = conn.prepare(&format!("{base} WHERE p.tipo = ?1 ORDER BY p.nome"))?;
            stmt.query_map([t], linha_para_resumo)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let mut stmt = conn.prepare(&format!("{base} ORDER BY p.nome"))?;
            stmt.query_map([], linha_para_resumo)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        }
    };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;

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
}
```

- [ ] **Step 3: Rodar o teste.** `cargo test insere_e_lista_personagem`. Esperado: PASS.

- [ ] **Step 4: Checkpoint** — round-trip verde.

---

## Task 6: Importador do v1

**Files:** Create `src-tauri/src/migration/{mod,importador_v1}.rs`; Modify `lib.rs`

- [ ] **Step 1: `src-tauri/src/migration/mod.rs`:** `pub mod importador_v1;`

- [ ] **Step 2:** adicionar `mod migration;` em `lib.rs`.

- [ ] **Step 3: Criar `src-tauri/src/migration/importador_v1.rs` completo:**
```rust
use crate::db::error::AppError;
use crate::db::repositorios::{inserir_personagem, NovoPersonagem};
use base64::prelude::{Engine as _, BASE64_STANDARD};
use rusqlite::{params, Connection};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn i(v: &Value, k: &str) -> i64 {
    v.get(k).and_then(|x| x.as_i64()).unwrap_or(0)
}

fn salvar_imagem(
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

fn importar_registro(
    conn: &Connection,
    images_dir: &Path,
    tipo: &str,
    reg: &Value,
) -> Result<i64, AppError> {
    let retrato_id = match reg.get("forma_base") {
        Some(fb) => salvar_imagem(conn, images_dir, &s(fb, "imagem_data"), &s(fb, "imagem_formato"))?,
        None => None,
    };
    let np = NovoPersonagem {
        tipo: tipo.into(),
        nome: s(reg, "nome"),
        descricao: s(reg, "descricao"),
        hp: i(reg, "hp"),
        sp: i(reg, "sp"),
        escudo: i(reg, "escudo"),
        forca: i(reg, "forca"),
        agilidade: i(reg, "agilidade"),
        percepcao: i(reg, "percepcao"),
        resistencia: i(reg, "resistencia"),
        intuicao: i(reg, "intuicao"),
        espirito: i(reg, "espirito"),
        carisma: i(reg, "carisma"),
        determinacao: i(reg, "determinacao"),
        retrato_id,
    };
    let pid = inserir_personagem(conn, &np)?;

    if let Some(arr) = reg.get("habilidades").and_then(|x| x.as_array()) {
        for (ordem, h) in arr.iter().enumerate() {
            conn.execute(
                "INSERT INTO habilidade (personagem_id,nome,descricao,ordem) VALUES (?1,?2,?3,?4)",
                params![pid, s(h, "nome"), s(h, "descricao"), ordem as i64],
            )?;
        }
    }
    if let Some(arr) = reg.get("pericias").and_then(|x| x.as_array()) {
        for p in arr {
            conn.execute(
                "INSERT INTO personagem_pericia (personagem_id,nome,descricao,atributo,nivel) \
                 VALUES (?1,?2,?3,?4,?5)",
                params![pid, s(p, "nome"), s(p, "descricao"), s(p, "atributo"), i(p, "nivel")],
            )?;
        }
    }
    for (campo, tabela) in [
        ("vantagens", "personagem_vantagem"),
        ("desvantagens", "personagem_desvantagem"),
    ] {
        if let Some(arr) = reg.get(campo).and_then(|x| x.as_array()) {
            for v in arr {
                conn.execute(
                    &format!(
                        "INSERT INTO {tabela} (personagem_id,nome,descricao,efeito) VALUES (?1,?2,?3,?4)"
                    ),
                    params![pid, s(v, "nome"), s(v, "descricao"), s(v, "efeito")],
                )?;
            }
        }
    }
    if let Some(arr) = reg.get("transformacoes").and_then(|x| x.as_array()) {
        for (ordem, t) in arr.iter().enumerate() {
            let img = salvar_imagem(conn, images_dir, &s(t, "imagem_data"), &s(t, "imagem_formato"))?;
            conn.execute(
                "INSERT INTO transformacao (personagem_id,nome,descricao,imagem_id,ordem) \
                 VALUES (?1,?2,?3,?4,?5)",
                params![pid, s(t, "nome"), s(t, "descricao"), img, ordem as i64],
            )?;
            let tid = conn.last_insert_rowid();
            if let Some(mods) = t.get("modificadores").and_then(|x| x.as_object()) {
                for (atr, delta) in mods {
                    conn.execute(
                        "INSERT INTO transformacao_modificador (transformacao_id,atributo,delta) \
                         VALUES (?1,?2,?3)",
                        params![tid, atr, delta.as_i64().unwrap_or(0)],
                    )?;
                }
            }
            if let Some(hs) = t.get("habilidades_especiais").and_then(|x| x.as_array()) {
                for h in hs {
                    let (nome, desc) = if h.is_string() {
                        (h.as_str().unwrap_or("").to_string(), String::new())
                    } else {
                        (s(h, "nome"), s(h, "descricao"))
                    };
                    conn.execute(
                        "INSERT INTO transformacao_habilidade (transformacao_id,nome,descricao) \
                         VALUES (?1,?2,?3)",
                        params![tid, nome, desc],
                    )?;
                }
            }
        }
    }
    Ok(pid)
}

pub fn importar_jogadores_npcs(
    conn: &Connection,
    images_dir: &Path,
    jogadores_json: &str,
    npcs_json: &str,
) -> Result<(usize, usize), AppError> {
    let jog: Value = serde_json::from_str(jogadores_json)?;
    let npc: Value = serde_json::from_str(npcs_json)?;
    let mut nj = 0usize;
    let mut nn = 0usize;
    if let Some(obj) = jog.as_object() {
        for (_nome, reg) in obj {
            importar_registro(conn, images_dir, "jogador", reg)?;
            nj += 1;
        }
    }
    if let Some(obj) = npc.as_object() {
        for (_nome, reg) in obj {
            importar_registro(conn, images_dir, "npc", reg)?;
            nn += 1;
        }
    }
    Ok((nj, nn))
}

pub fn importar_catalogos(
    conn: &Connection,
    pericias_json: &str,
    vantagens_json: &str,
    desvantagens_json: &str,
) -> Result<(), AppError> {
    let p: Value = serde_json::from_str(pericias_json)?;
    if let Some(arr) = p.get("pericias").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_pericia (nome,descricao,atributo) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "atributo")],
            )?;
        }
    }
    let v: Value = serde_json::from_str(vantagens_json)?;
    if let Some(arr) = v.get("vantagens").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_vantagem (nome,descricao,efeito) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "efeito")],
            )?;
        }
    }
    let d: Value = serde_json::from_str(desvantagens_json)?;
    if let Some(arr) = d.get("desvantagens").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_desvantagem (nome,descricao,efeito) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "efeito")],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HBGWAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn importa_jogador_com_imagem_filhos_e_transformacao() {
        let conn = open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("rpgv2_test_imgs");
        let _ = std::fs::remove_dir_all(&tmp);

        let jog = format!(
            r#"{{"Luffy":{{"nome":"Luffy","descricao":"cap","hp":100,"sp":10,"escudo":0,
            "forca":9,"agilidade":8,"percepcao":5,"resistencia":7,"intuicao":4,"espirito":6,
            "carisma":9,"determinacao":10,
            "habilidades":[{{"nome":"Gomu","descricao":"borracha","status":"disponivel"}}],
            "pericias":[{{"nome":"Luta","descricao":"","atributo":"forca","nivel":3}}],
            "vantagens":[],"desvantagens":[],
            "forma_base":{{"imagem_data":"{PNG_1X1}","imagem_formato":"png"}},
            "transformacoes":[{{"nome":"Gear 2","descricao":"","modificadores":{{"agilidade":3,"forca":2}},
            "habilidades_especiais":["Jet"],"imagem_data":"","imagem_formato":""}}]}}}}"#
        );
        let npc = "{}";

        let (nj, nn) = importar_jogadores_npcs(&conn, &tmp, &jog, npc).unwrap();
        assert_eq!((nj, nn), (1, 0));

        let contar = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(contar("SELECT count(*) FROM personagem WHERE tipo='jogador'"), 1);
        assert_eq!(contar("SELECT count(*) FROM habilidade"), 1);
        assert_eq!(contar("SELECT count(*) FROM personagem_pericia"), 1);
        assert_eq!(contar("SELECT count(*) FROM transformacao"), 1);
        assert_eq!(contar("SELECT count(*) FROM transformacao_modificador"), 2);
        assert_eq!(contar("SELECT count(*) FROM transformacao_habilidade"), 1);
        assert_eq!(contar("SELECT count(*) FROM imagem"), 1);

        let caminho: String = conn
            .query_row("SELECT caminho FROM imagem", [], |r| r.get(0))
            .unwrap();
        assert!(tmp.join(caminho).exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn importa_catalogos_ok() {
        let conn = open_in_memory().unwrap();
        importar_catalogos(
            &conn,
            r#"{"pericias":[{"nome":"Furtividade","descricao":"d","atributo":"agilidade"}]}"#,
            r#"{"vantagens":[{"nome":"Sortudo","descricao":"d","efeito":"e"}]}"#,
            r#"{"desvantagens":[{"nome":"Codigo","descricao":"d","efeito":"e"}]}"#,
        )
        .unwrap();
        let c = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(c("SELECT count(*) FROM catalogo_pericia"), 1);
        assert_eq!(c("SELECT count(*) FROM catalogo_vantagem"), 1);
        assert_eq!(c("SELECT count(*) FROM catalogo_desvantagem"), 1);
    }
}
```

- [ ] **Step 4: Rodar.** `cargo test importador_v1`. Esperado: 2 testes PASS.

- [ ] **Step 5: Checkpoint** — importador verde.

---

## Task 7: Comandos Tauri + registro

**Files:** Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: Reescrever `src-tauri/src/lib.rs`** (mantendo `mod db; mod domain; mod migration;` e o `.plugin(tauri_plugin_opener::init())`; remover o `greet` do template):
```rust
mod db;
mod domain;
mod migration;

use db::connection::{open, Db};
use db::error::AppError;
use db::repositorios::listar_personagens;
use domain::modelos::PersonagemResumo;
use std::sync::Mutex;
use tauri::Manager;

#[tauri::command]
fn list_personagens(
    db: tauri::State<Db>,
    tipo: Option<String>,
) -> Result<Vec<PersonagemResumo>, AppError> {
    let conn = db.0.lock().map_err(|_| AppError::Msg("lock envenenado".into()))?;
    listar_personagens(&conn, tipo.as_deref())
}

#[tauri::command]
fn importar_v1(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    caminho_data: String,
) -> Result<(usize, usize), AppError> {
    let base = std::path::PathBuf::from(caminho_data);
    let images_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .join("images");

    let jog = std::fs::read_to_string(base.join("jogadores.json"))?;
    let npc = std::fs::read_to_string(base.join("npcs.json"))?;
    let per = std::fs::read_to_string(base.join("pericias.json"))?;
    let van = std::fs::read_to_string(base.join("vantagens.json"))?;
    let des = std::fs::read_to_string(base.join("desvantagens.json"))?;

    let conn = db.0.lock().map_err(|_| AppError::Msg("lock envenenado".into()))?;
    let (nj, nn) =
        migration::importador_v1::importar_jogadores_npcs(&conn, &images_dir, &jog, &npc)?;
    migration::importador_v1::importar_catalogos(&conn, &per, &van, &des)?;
    Ok((nj, nn))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app_data_dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = open(&dir.join("rpg.db")).expect("abrir/migrar SQLite");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_personagens, importar_v1])
        .run(tauri::generate_context!())
        .expect("erro ao rodar o app");
}
```

- [ ] **Step 2: Suíte completa.** `cargo test` (em `src-tauri/`). Esperado: todos os testes das Tasks 3/5/6 PASS.

- [ ] **Step 3: Build.** `cargo build`. Esperado: sem erro.

- [ ] **Step 4: Checkpoint** — suíte + build verdes.

---

## Task 8: Prova end-to-end no frontend

**Files:** Modify `src/App.tsx`

- [ ] **Step 1:** garantir deps JS instaladas — em `C:\dev\projeto-rpg-v2`: `npm install`.

- [ ] **Step 2: Substituir `src/App.tsx`:**
```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Resumo = { id: number; nome: string; tipo: string };

const V1_DATA =
  "C:\\Users\\gedasio.filho\\OneDrive - Vertis Capital\\Área de Trabalho\\One Piece\\Projeto Rpg\\src\\data";

export default function App() {
  const [itens, setItens] = useState<Resumo[]>([]);
  const [msg, setMsg] = useState("");

  async function listar() {
    const r = await invoke<Resumo[]>("list_personagens", { tipo: null });
    setItens(r);
    setMsg(`${r.length} personagens no banco.`);
  }

  async function importar() {
    try {
      const [nj, nn] = await invoke<[number, number]>("importar_v1", {
        caminhoData: V1_DATA,
      });
      setMsg(`Importados: ${nj} jogadores, ${nn} NPCs.`);
      await listar();
    } catch (e) {
      setMsg("Erro: " + String(e));
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>RPG v2 — prova Fase 0</h1>
      <p>Rode "Importar do v1" UMA vez; depois "Listar".</p>
      <button onClick={importar}>Importar do v1</button>{" "}
      <button onClick={listar}>Listar</button>
      <p><strong>{msg}</strong></p>
      <ul>
        {itens.map((i) => (
          <li key={i.id}>[{i.tipo}] {i.nome}</li>
        ))}
      </ul>
    </main>
  );
}
```
**Convenção Tauri:** arg Rust `caminho_data` (snake) é passado do JS como `caminhoData` (camel).

- [ ] **Step 3: Rodar.** Em `C:\dev\projeto-rpg-v2`: `npm run tauri dev`. Clicar **Importar do v1** → "Importados: 6 jogadores, 13 NPCs." Clicar **Listar** → 19 nomes.

- [ ] **Step 4: Persistência.** Fechar, reabrir com `npm run tauri dev`, só **Listar** → 19 continuam (não reimportar).

- [ ] **Step 5: Checkpoint** — prova end-to-end funciona e persiste.

---

## Task 9: Verificação de paridade

- [ ] **Step 1:** localizar `rpg.db` (~ `C:\Users\gedasio.filho\AppData\Roaming\com.gedasio.rpgv2\rpg.db`). Checar: `SELECT tipo, count(*) FROM personagem GROUP BY tipo;` (jogador=6, npc=13), `SELECT count(*) FROM imagem;` (>0), `SELECT count(*) FROM catalogo_pericia;` (>0).
- [ ] **Step 2:** `app_data_dir/images/` tem `.png` (nomes sha256); abrir 1-2 pra confirmar decode ok.
- [ ] **Step 3: Checkpoint** — 6+13 + catálogos + imagens conferidos. **Fase 0 DONE.**

---

## Definition of Done (Fase 0)

- [ ] Scaffold builda e abre.
- [ ] SQLite via `0001_init.sql`.
- [ ] `cargo test` verde (migrations, repositório, importador, catálogos).
- [ ] Importador: 6 jogadores + 13 NPCs + catálogos + imagens (por contagem).
- [ ] Frontend chama `list_personagens`, mostra 19; persiste ao reabrir.

## Cobertura vs spec

| Requisito (Fase 0) | Task |
|---|---|
| Scaffold Tauri v2 + React/TS | 1 (✔ feito) |
| Deps Rust | 2 |
| Schema SQLite via migrations | 3 |
| Tipos serializáveis | 4 |
| Repositório (SQL só no Rust) | 5 |
| Migração v1 + extração de imagens | 6, 8, 9 |
| Comandos Tauri | 7 |
| Prova de dados consultáveis | 8 |
| Paridade 6/13 | 9 |
