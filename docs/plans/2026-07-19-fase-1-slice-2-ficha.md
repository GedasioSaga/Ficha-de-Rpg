# Fase 1 · Slice 2 — Ficha detalhada · Plano

> SUB-SKILL: subagent-driven-development. **SEM GIT** (checkpoint = builds verdes). Base: `C:\dev\projeto-rpg-v2`.

**Goal:** Clicar num card da galeria abre a **ficha** do personagem: 2 colunas — bloco de status (retrato, HP/SP/escudo, 8 atributos **com rank**) à esquerda; abas (Habilidades, Perícias, Vantagens, Desvantagens, Transformações) à direita.

**Escopo:** SÓ leitura da ficha. CRUD/edição = Slice 3. Sem shadcn (abas em componente próprio simples). Design travado: Ficha = 2 colunas + abas (A).

---

## Contrato `PersonagemCompleto` (backend ↔ frontend batem nisto)

**Rust** (adicionar em `src-tauri/src/domain/modelos.rs`):
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtributoRank { pub nome: String, pub valor: i64, pub rank: u8 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabilidadeDto { pub nome: String, pub descricao: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PericiaDto { pub nome: String, pub descricao: String, pub atributo: String, pub nivel: i64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracoDto { pub nome: String, pub descricao: String, pub efeito: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModificadorDto { pub atributo: String, pub delta: i64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformacaoDto {
    pub nome: String, pub descricao: String, pub retrato: Option<String>,
    pub modificadores: Vec<ModificadorDto>, pub habilidades: Vec<HabilidadeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonagemCompleto {
    pub id: i64, pub tipo: String, pub nome: String, pub descricao: String,
    pub hp: i64, pub sp: i64, pub escudo: i64, pub retrato: Option<String>,
    pub atributos: Vec<AtributoRank>,        // 8, ordem fixa (ver abaixo)
    pub habilidades: Vec<HabilidadeDto>,
    pub pericias: Vec<PericiaDto>,
    pub vantagens: Vec<TracoDto>,
    pub desvantagens: Vec<TracoDto>,
    pub transformacoes: Vec<TransformacaoDto>,
}
```
**Ordem fixa dos 8 atributos:** `forca, agilidade, percepcao, resistencia, intuicao, espirito, carisma, determinacao`. Cada `AtributoRank.valor` vem da coluna do `personagem`; `rank = calcular_rank(nome, valor)`.

---

## Backend (Rust)

### Task B2.1: portar o rank calculator do v1
**Files:** Create `src-tauri/src/domain/rank.rs`; Modify `src-tauri/src/domain/mod.rs`

- [ ] **LER o arquivo do v1 e portar VERBATIM** as tabelas de threshold:
  `C:\Users\gedasio.filho\OneDrive - Vertis Capital\Área de Trabalho\One Piece\Projeto Rpg\src\utils\rank_calculator.py`
  (Só leitura. É o gerenciador de RPG "One Piece RPG"; o arquivo tem tabelas por atributo mapeando valor→rank 0–13, não-linear.)
- [ ] Expor: `pub fn calcular_rank(atributo: &str, valor: i64) -> u8` — mesma lógica/tabelas do Python, retornando 0..=13. Se o Python usa uma tabela por atributo, replique cada uma; se algum atributo cai numa tabela default, replique isso também.
- [ ] `src/domain/mod.rs`: `pub mod rank;`
- [ ] **Teste** `rank.rs`: derive 3–5 casos conhecidos DIRETO do arquivo Python (ex.: um valor logo abaixo e logo acima de um threshold, por atributo) e asserte que `calcular_rank` bate. Documente no teste de onde tirou cada caso.
- [ ] Verificar: `cargo test rank` verde.

### Task B2.2: comando `get_personagem`
**Files:** Modify `src-tauri/src/db/repositorios.rs`, `src-tauri/src/lib.rs`

- [ ] Em `repositorios.rs`, `pub fn get_personagem(conn: &Connection, id: i64) -> Result<PersonagemCompleto, AppError>`:
  - Busca a linha de `personagem` (todos os campos + retrato via `LEFT JOIN imagem ON imagem.id = personagem.retrato_id`, pegando `imagem.caminho`). Se não achar, `Err(AppError::Msg("personagem não encontrado".into()))`.
  - Monta `atributos` = os 8, na ordem fixa, com `valor` da coluna e `rank = crate::domain::rank::calcular_rank(nome, valor)`.
  - `habilidades`: `SELECT nome,descricao FROM habilidade WHERE personagem_id=?1 ORDER BY ordem`.
  - `pericias`: `SELECT nome,descricao,atributo,nivel FROM personagem_pericia WHERE personagem_id=?1 ORDER BY id`.
  - `vantagens`/`desvantagens`: `SELECT nome,descricao,efeito FROM personagem_vantagem/_desvantagem WHERE personagem_id=?1 ORDER BY id`.
  - `transformacoes`: `SELECT id,nome,descricao,(caminho via LEFT JOIN imagem) FROM transformacao WHERE personagem_id=?1 ORDER BY ordem`; para cada uma, buscar `modificadores` (`SELECT atributo,delta FROM transformacao_modificador WHERE transformacao_id=?1`) e `habilidades` (`SELECT nome,descricao FROM transformacao_habilidade WHERE transformacao_id=?1`).
- [ ] Em `lib.rs`, comando:
```rust
#[tauri::command]
fn get_personagem(db: tauri::State<Db>, id: i64) -> Result<PersonagemCompleto, AppError> {
    let conn = db.conn()?;
    db::repositorios::get_personagem(&conn, id)
}
```
  Registrar em `generate_handler![... , get_personagem]`. Importar `PersonagemCompleto` no `use`.
- [ ] **Teste** (`repositorios.rs`): num banco in-memory, inserir 1 personagem + 1 habilidade + 1 pericia + 1 transformação c/ 1 modificador; `get_personagem` retorna as contagens certas (atributos.len()==8, habilidades.len()==1, transformacoes[0].modificadores.len()==1) e o rank de um atributo bate com `calcular_rank`.
- [ ] Verificar: `cargo test` verde, `cargo build` limpo.

---

## Frontend (React/TS/Tailwind)

### Task F2.1: tipos + api
**Files:** Modify `src/lib/types.ts`, `src/lib/api.ts`
- [ ] `types.ts`: adicionar interfaces espelhando o contrato (`AtributoRank`, `HabilidadeDto`, `PericiaDto`, `TracoDto`, `ModificadorDto`, `TransformacaoDto`, `PersonagemCompleto`).
- [ ] `api.ts`: `export const getPersonagem = (id: number) => invoke<PersonagemCompleto>("get_personagem", { id });`

### Task F2.2: card clicável
**Files:** Modify `src/features/characters/CharacterCard.tsx`
- [ ] Envolver o card num `<Link to={`/fichas/${p.id}`}>` (ou `useNavigate`) — clicar abre a ficha. Manter o hover ring.

### Task F2.3: rota da ficha
**Files:** Modify `src/App.tsx`
- [ ] Adicionar dentro do layout `AppShell`: `<Route path="/fichas/:id" element={<CharacterSheet />} />` (mantendo a rota index da galeria).

### Task F2.4: `CharacterSheet` (2 colunas + abas)
**Files:** Create `src/features/characters/CharacterSheet.tsx`, `src/features/characters/StatBlock.tsx`, `src/components/Tabs.tsx`
- [ ] `Tabs.tsx`: componente simples e acessível (sem shadcn) — recebe `abas: {id, label, conteudo}[]`, estado local da aba ativa, botões no topo (aba ativa destacada), painel abaixo. Teclado: setas opcional.
- [ ] `CharacterSheet.tsx`:
  - `const { id } = useParams()`; `useQuery(["personagem", id], () => getPersonagem(Number(id)))`.
  - Botão "← Fichas" (volta pra `/`).
  - Layout 2 colunas: `grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-6`.
  - **Esquerda** = `<StatBlock p={data} />` (fixa/sticky no topo em telas largas).
  - **Direita** = `<Tabs>` com 5 abas: Habilidades, Perícias, Vantagens, Desvantagens, Transformações. Cada painel renderiza a lista respectiva (cards/linhas com nome + descrição + campos extras: perícia mostra atributo+nível; vantagem/desvantagem mostram efeito; transformação mostra retrato + lista de modificadores [ex: `AGI +3`] + habilidades especiais). Aba vazia → "nenhum(a)…".
  - Estados loading/erro (personagem não encontrado).
- [ ] `StatBlock.tsx`:
  - Retrato grande (via `retratoDataUrl`, ou placeholder de iniciais), nome, badge tipo, descrição.
  - 3 chips de pool: HP (vermelho), SP (azul), Escudo (cinza) com os valores.
  - 8 `AttributeRow`: label do atributo + valor + **badge de rank** (0–13). Pode reusar/definir inline. Destaque visual sutil por faixa de rank (opcional, não exagerar).

---

## Verificação (DoD — Slice 2)
- [ ] `cargo test` verde (rank + get_personagem); `cargo build` limpo; `npm run build` ok.
- [ ] Clicar num card da galeria abre `/fichas/:id`.
- [ ] Ficha mostra: retrato grande, HP/SP/escudo, **8 atributos com rank**, e as 5 abas populadas (ex.: um jogador com perícias/vantagens; uma transformação com modificadores).
- [ ] "← Fichas" volta pra galeria. Sem erro no console.

## Fora de escopo
- Slice 3: editar/criar/excluir, upload de retrato, pickers de catálogo, aplicar transformação (isso é batalha/Fase 2). Aqui a ficha é só leitura.

## Notas de qualidade
- Contrato de tipos: os nomes de campo TS devem bater 1:1 com o `serde` do Rust (snake_case). Rust serializa os campos como estão (`hp`, `sp`, `escudo`, `atributos`, etc.) — use os mesmos no TS.
- Componentes pequenos e focados. Sem SQL no front. Sem `any`. Acabamento: consultar skill de UI (frontend-design / emil-kowalski-ui-craft) pra hierarquia e transições sutis.
