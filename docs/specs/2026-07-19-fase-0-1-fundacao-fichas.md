# Projeto RPG v2 — Spec Fase 0 + Fase 1 (Fundação + Fichas)

**Data:** 2026-07-19
**Status:** Aprovado pelo usuário
**Base directory:** `C:\dev\projeto-rpg-v2` (fora do OneDrive — evita sync thrash/locks de `target/` e `node_modules/`)
**Fases cobertas:** 0 (Fundação) e 1 (Fichas). Batalha, Mapa, Discord e Acessórios têm specs próprios.

---

## 1. Contexto e objetivo

Reescrita do **RPG Battle Manager** (sistema próprio "One Piece RPG", v1 em PyQt6 + JSON) como app desktop moderno. O v1 tem ~24k LOC Python, dos quais ~14k são UI PyQt descartada; a lógica de domínio real a portar é modesta (~1,1–1,4k LOC).

**Meta do v2:** UI moderna (web), 1 binário, storage em banco de verdade, uso **local single-user** (só a máquina do usuário).

### Decisões travadas (via grilling)

| Tema | Decisão | Motivo |
|---|---|---|
| Uso | Local single-user | Sem server/sync; SQLite basta |
| Frontend | React + TypeScript + Tailwind (v4) | UI moderna pedida |
| Backend | **Rust** (sem Python) | Rust cobre tudo, inclusive Discord |
| Banco | **SQLite** (via `rusqlite`) | Local, embutido, leve |
| Discord/voz | **serenity + songbird** (Rust) | Substitui discord.py; premissa "só Python faz Discord" era falsa |
| Empacotamento | **Tauri v2** (2.x) | Shell Rust nativo, 1 binário |
| Versionamento | **Sem git** | Projeto pessoal do usuário — não usar git aqui |
| Local no disco | **`C:\dev\projeto-rpg-v2`** | Fora do OneDrive (sync quebra build Rust+Node) |

---

## 2. Arquitetura geral

```
┌─────────────────────────────────────────────┐
│  Tauri v2 (shell Rust + WebView)             │
│                                              │
│  React/TS/Tailwind  ──invoke()──►  Rust      │
│  (frontend)         ◄──JSON────   commands   │
│                                     │        │
│                                     ▼        │
│                         Repositórios (Rust)  │
│                                     │        │
│                                     ▼        │
│                          SQLite (rusqlite)   │
│                                              │
│  Imagens: arquivos em app-data/images/,      │
│  exibidas via asset protocol do Tauri        │
└─────────────────────────────────────────────┘
```

**Princípios (alinhados às regras do usuário):**
- **Camadas claras:** SQL vive só no Rust (módulo `db/`), nunca no React. O frontend só chama comandos tipados.
- **I/O separado de lógica pura:** o cálculo de rank e as regras são funções puras testáveis; persistência é isolada nos repositórios.
- **Tipos espelhados:** structs Rust (`serde`) ↔ interfaces TS mantidas em `src/types/`.

**Acesso ao SQLite — decisão:** `rusqlite` com `Connection` em estado gerenciado (`tauri::State<Mutex<Connection>>`), migrations versionadas (crate `rusqlite_migration`). Mantém todo SQL no Rust.
- *Alternativa rejeitada:* `tauri-plugin-sql` (oficial) expõe SQL ao JS — viola a regra "sem SQL no componente React".

---

## 3. Escopo desta spec

### DENTRO (Fase 0 + 1)
- **Fase 0:** scaffold do projeto, schema SQLite + migrations, camada de comandos Rust, **migração dos dados do v1** (fichas + catálogos + imagens).
- **Fase 1:** gerenciar personagens ponta-a-ponta — galeria de retratos, ficha em duas colunas + abas, CRUD completo, upload de retrato.

### FORA (fases posteriores, spec própria)
- Batalha (Fase 2) — inclui migrar `batalhas_salvas.json`.
- Mapa visual (Fase 3).
- Bot Discord (Fase 4).
- Anotações/mídia, sessões, marcadores, compêndio de regras (Fase 5).
- `inimigos_simulacao.json` → **descartado** (schema órfão de feature abandonada).

---

## 4. Modelo de dados (SQLite)

Personagens (jogadores + NPCs) compartilham o núcleo → **uma tabela `personagem`** com discriminador `tipo`. NPCs só não terão linhas em perícias/vantagens/desvantagens. Atributos são 8 colunas fixas. IDs **sintéticos** (o v1 usa nome como PK — frágil a rename).

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

**Rank:** não é coluna — é derivado do total do atributo via `rank_calculator` (8 tabelas de threshold, 0–13), calculado no Rust e devolvido no `get_personagem`. (Fase 1: total = valor base; modificadores de transformação em batalha são Fase 2.)

---

## 5. Migração v1 → SQLite (Fase 0)

Importador em Rust (`migration/`), lê os JSONs do v1 (em `...\Projeto Rpg\src\data`, que segue no OneDrive — só leitura).

| Fonte v1 | Destino | Notas |
|---|---|---|
| `jogadores.json` (6) | `personagem` (tipo='jogador') + filhos | Extrai `forma_base.imagem_data` base64 → arquivo PNG |
| `npcs.json` (13) | `personagem` (tipo='npc') + habilidades/transformações | Sem perícias/vant/desvant |
| `habilidades[]` | `habilidade` | |
| `pericias[]` (jogador) | `personagem_pericia` | |
| `vantagens[]`/`desvantagens[]` | `personagem_vantagem`/`_desvantagem` | |
| `transformacoes[]` | `transformacao` + `_modificador` + `_habilidade` (+imagem) | |
| `pericias/vantagens/desvantagens.json` | `catalogo_*` | Seed |
| `batalhas_salvas.json` | — | **Deferido Fase 2** |
| `inimigos_simulacao.json` | — | **Descartado** |

**Regras:** imagens base64 → `app-data/images/<sha256>.<fmt>` (dedup por sha256), nunca base64 no SQLite; IDs sintéticos (nome vira campo); importar só em banco vazio (setup único); ao fim asserir contagens (6 jogadores, 13 NPCs, imagens > 0).

---

## 6. Camada de comandos Rust (API Fase 1)

Todos `#[tauri::command]`, registrados em `lib.rs` via `generate_handler!`, retornam `Result<T, AppError>`.

```
list_personagens(tipo: Option<Tipo>) -> Vec<PersonagemResumo>   // galeria
get_personagem(id) -> PersonagemCompleto                        // núcleo + rank + listas
criar_personagem(input) / atualizar_personagem(id, input) / excluir_personagem(id)
definir_retrato(id, bytes|caminho, formato) -> imagem_id
salvar_habilidades / _pericias / _vantagens / _desvantagens / _transformacoes(personagem_id, Vec<...>)
list_catalogo_pericias / _vantagens / _desvantagens() -> Vec<...>
calcular_rank(atributo, total) -> u8   // 0..13
```

**Imagens no frontend:** retornar URL do asset protocol (`convertFileSrc`), nunca base64 pelo IPC. Escopo do asset em `tauri.conf.json` → `app-data/images/`.

---

## 7. Frontend (React/TS/Tailwind) — Fase 1

**Stack:** Vite + React + TS. Router: React Router. Estado de servidor: **TanStack Query**. Primitivos: **shadcn/ui** (Tabs, Dialog, Toast). Estado local mínimo (YAGNI).

**Telas (decisões do companion visual):**
1. **App Shell** — *Sidebar colapsável* (A). Seções: Fichas (ativa), Batalha, Mapa, Discord, Notas, Compêndio (futuras "em breve"). Colapsa p/ ícones.
2. **Fichas — Galeria de retratos** (A). Toggle Jogadores/NPCs, busca, grid de `PersonagemCard` (retrato + nome + mini-stats). Clique → `/fichas/:id`.
3. **Ficha — Duas colunas + abas** (A). Esquerda fixa: retrato, HP/SP/escudo, 8 atributos + rank. Direita: abas Habilidades/Perícias/Vantagens/Desvantagens/Transformações. Modo edição + upload de retrato.

---

## 8. Estrutura de pastas

```
C:\dev\projeto-rpg-v2\
├── src/                    # React (components/ features/ lib/ types/)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # builder, State, generate_handler!
│   │   ├── db/             # connection.rs, repositorios.rs, error.rs
│   │   ├── domain/         # modelos.rs, rank.rs (Fase 1)
│   │   └── migration/      # importador_v1.rs
│   ├── migrations/         # 0001_init.sql
│   ├── Cargo.toml  tauri.conf.json
├── docs/specs  docs/plans
```

---

## 9. Testes e verificação

- **Rust:** `rank.rs` paridade com as 8 tabelas v1; `importador_v1` com JSON de amostra; repositórios round-trip.
- **Migração:** confirmar 6 jogadores + 13 NPCs + contagens de filhos + nº de imagens em disco.
- **Frontend (manual):** galeria mostra 19 com retrato; abrir ficha (pools, 8 atributos+rank, 5 abas); editar atributo → rank recalcula; CRUD persiste.

---

## 10. Critérios de aceite

**Fase 0:** scaffold builda/abre; SQLite via migrations; importador traz 6+13 + catálogos + imagens (por contagem); app mostra prova de dados consultáveis.
**Fase 1:** galeria; ficha 2 colunas + abas; CRUD completo (personagem + listas + retrato); persiste ao reabrir.

---

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Extração de imagens (base64/formatos) | Testar contagem + abrir amostras |
| Paridade `rank_calculator` (8 tabelas) | Portar verbatim + testes de valores conhecidos |
| Colisão de nomes (nome era PK) | IDs sintéticos; logar duplicatas |
| Asset protocol p/ imagens (CSP/escopo) | Configurar escopo cedo; validar no boot |
| OneDrive quebrando build | Projeto em `C:\dev` (fora do OneDrive) — resolvido |

---

## 12. Próximas fases
- **Fase 2 — Batalha:** engine turnos/iniciativa, pools, calculadora dano/cura, transformações aplica/reverte, cooldowns, undo/snapshot, multi-batalha, save/load, migração `batalhas_salvas.json`. Máquina de estado limpa em Rust.
- **Fase 3 — Mapa:** grid visual React. **Fase 4 — Discord:** serenity+songbird. **Fase 5 — Acessórios.**
