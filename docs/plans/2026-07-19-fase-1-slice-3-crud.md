# Fase 1 · Slice 3 — CRUD completo · Plano

> SUB-SKILL: subagent-driven-development. **SEM GIT** (checkpoint = builds+testes verdes). Base: `C:\dev\projeto-rpg-v2`.
> Padrão de execução (HANDOFF §7): implementar lendo este plano → verificar **headless** (`cargo test` + `cargo build` em `src-tauri`; `npm run build` na raiz) → o **usuário** roda `npm run tauri dev` pra validar a GUI. Antes de qualquer `cargo build`: matar `projeto-rpg-v2.exe` rodando (`Get-Process projeto-rpg-v2 -ErrorAction SilentlyContinue | Stop-Process -Force`) senão trava o lock de `target/`.

**Goal:** Criar, editar e excluir personagens (inclui upload de retrato e o editor aninhado de transformações), com **save atômico** da ficha inteira. A ficha (Slice 2) continua a tela de leitura; ganha os botões **Editar** e **Excluir**. A galeria ganha **Novo personagem**.

**Decisões travadas (grilling):**
1. **Escopo:** CRUD completo, **transformações inclusas** (editor aninhado). Sem mudança de schema (as 12 tabelas já cobrem). **Sem shadcn.**
2. **Comandos:** save **atômico** — o payload é o personagem inteiro; 1 transação por save; replace-all das coleções.
3. **Imagens:** viajam no payload como enum serde `RetratoInput` (tag `modo`): `manter{caminho}` | `novo{base64,formato}` | `nenhum`. Dedup sha256 (reusa `salvar_imagem`).
4. **UX:** formulário dedicado `FichaForm`, reusado por `/fichas/novo` e `/fichas/:id/editar`; estado local = ficha inteira; 1 botão Salvar.
5. **Primitivos UI à mão** (zero deps novos), no idioma do `Tabs.tsx`: `Dialog`, `Toast`, `<select>` nativo estilizado, `CatalogoPicker`.
6. **Upload:** `<input type="file" accept="image/*">` + `FileReader.readAsDataURL` → base64 (zero deps).

**Regra de tipos:** nomes de campo TS batem 1:1 com o `serde` do Rust (snake_case). Sem `any`. Sem SQL no front.

---

## Backend (Rust)

### Contrato de entrada — `PersonagemInput` (adicionar em `src-tauri/src/domain/modelos.rs`)

```rust
// --- ENTRADA (Deserialize; vem do frontend) ---

/// Como resolver a imagem de um retrato no save.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "modo", rename_all = "snake_case")]
pub enum RetratoInput {
    /// Mantém a imagem atual (identificada pelo caminho/arquivo já salvo).
    Manter { caminho: String },
    /// Nova imagem: grava com dedup sha256.
    Novo { base64: String, formato: String },
    /// Sem retrato (retrato_id = NULL).
    Nenhum,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HabilidadeInput { pub nome: String, pub descricao: String }

#[derive(Debug, Clone, Deserialize)]
pub struct PericiaInput { pub nome: String, pub descricao: String, pub atributo: String, pub nivel: i64 }

#[derive(Debug, Clone, Deserialize)]
pub struct TracoInput { pub nome: String, pub descricao: String, pub efeito: String }

#[derive(Debug, Clone, Deserialize)]
pub struct ModificadorInput { pub atributo: String, pub delta: i64 }

#[derive(Debug, Clone, Deserialize)]
pub struct TransformacaoInput {
    pub nome: String,
    pub descricao: String,
    pub retrato: RetratoInput,
    pub modificadores: Vec<ModificadorInput>,
    pub habilidades: Vec<HabilidadeInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PersonagemInput {
    pub tipo: String,        // "jogador" | "npc"
    pub nome: String,
    pub descricao: String,
    pub hp: i64, pub sp: i64, pub escudo: i64,
    pub forca: i64, pub agilidade: i64, pub percepcao: i64, pub resistencia: i64,
    pub intuicao: i64, pub espirito: i64, pub carisma: i64, pub determinacao: i64,
    pub retrato: RetratoInput,
    pub habilidades: Vec<HabilidadeInput>,
    pub pericias: Vec<PericiaInput>,
    pub vantagens: Vec<TracoInput>,
    pub desvantagens: Vec<TracoInput>,
    pub transformacoes: Vec<TransformacaoInput>,
}

// --- CATÁLOGOS (Serialize; vai pro frontend) ---

#[derive(Debug, Clone, Serialize)]
pub struct CatalogoPericia { pub nome: String, pub descricao: String, pub atributo: String }

#[derive(Debug, Clone, Serialize)]
pub struct CatalogoTraco { pub nome: String, pub descricao: String, pub efeito: String }

#[derive(Debug, Clone, Serialize)]
pub struct Catalogos {
    pub pericias: Vec<CatalogoPericia>,
    pub vantagens: Vec<CatalogoTraco>,
    pub desvantagens: Vec<CatalogoTraco>,
}
```
`modelos.rs` já usa `use serde::{Deserialize, Serialize};` — manter.

### Task B3.1 — módulo de imagem compartilhado
**Files:** Create `src-tauri/src/db/imagens.rs`; Modify `src-tauri/src/db/mod.rs`, `src-tauri/src/migration/importador_v1.rs`

- [ ] Criar `db/imagens.rs`. Mover a lógica de `salvar_imagem` (hoje **privada** em `importador_v1.rs`, linhas ~16–44) para cá, **verbatim**, como pública:
  ```rust
  pub fn salvar_imagem_base64(
      conn: &Connection, images_dir: &Path, data_b64: &str, fmt: &str,
  ) -> Result<Option<i64>, AppError> { /* corpo idêntico ao salvar_imagem atual: trim, decode, sha256, dedup, write, insert */ }
  ```
- [ ] Adicionar `resolver_retrato`:
  ```rust
  use crate::domain::modelos::RetratoInput;
  pub fn resolver_retrato(
      conn: &Connection, images_dir: &Path, r: &RetratoInput,
  ) -> Result<Option<i64>, AppError> {
      match r {
          RetratoInput::Novo { base64, formato } => salvar_imagem_base64(conn, images_dir, base64, formato),
          RetratoInput::Manter { caminho } => Ok(conn
              .query_row("SELECT id FROM imagem WHERE caminho = ?1", [caminho], |row| row.get::<_, i64>(0))
              .optional()?),   // se sumiu, vira None (não falha o save)
          RetratoInput::Nenhum => Ok(None),
      }
  }
  ```
- [ ] `db/mod.rs`: adicionar `pub mod imagens;`.
- [ ] `importador_v1.rs`: apagar o `fn salvar_imagem` local e trocar as 2 chamadas por `crate::db::imagens::salvar_imagem_base64(...)` (mesma assinatura). Ajustar imports (`base64`, `sha2`, `hex` podem sair do importador se não usados em mais nada — conferir; `Path` continua).
- [ ] Verificar: `cargo test` (os testes do importador continuam verdes — dedup/idempotência inalterados).

### Task B3.2 — repositórios de escrita
**Files:** Modify `src-tauri/src/db/repositorios.rs`

Adicionar (mantendo o estilo do arquivo; `use` de `crate::domain::modelos::{PersonagemInput, ...}` e `crate::db::imagens`):

- [ ] `fn validar(input: &PersonagemInput) -> Result<(), AppError>`:
  - `input.nome.trim().is_empty()` → `Err(AppError::Msg("nome obrigatório".into()))`.
  - `input.tipo` não ∈ {`"jogador"`,`"npc"`} → `Err(AppError::Msg("tipo inválido".into()))`.
- [ ] `pub fn criar_personagem(conn: &Connection, images_dir: &Path, input: &PersonagemInput) -> Result<i64, AppError>`:
  - `validar(input)?;`
  - `let retrato_id = imagens::resolver_retrato(conn, images_dir, &input.retrato)?;`
  - Montar `NovoPersonagem` a partir do `input` (mesmos 8 atributos, pools) + `retrato_id`; `let pid = inserir_personagem(conn, &np)?;`
  - `escrever_colecoes(conn, images_dir, pid, input)?;`
  - `Ok(pid)`
- [ ] `pub fn atualizar_personagem(conn: &Connection, images_dir: &Path, id: i64, input: &PersonagemInput) -> Result<(), AppError>`:
  - `validar(input)?;`
  - `let retrato_id = imagens::resolver_retrato(conn, images_dir, &input.retrato)?;`
  - `UPDATE personagem SET tipo=?,nome=?,descricao=?,hp=?,sp=?,escudo=?,forca=?,agilidade=?,percepcao=?,resistencia=?,intuicao=?,espirito=?,carisma=?,determinacao=?,retrato_id=?,atualizado_em=datetime('now') WHERE id=?` — se `rows_affected == 0` → `Err(AppError::Msg("personagem não encontrado".into()))`.
  - `escrever_colecoes(conn, images_dir, id, input)?;` (delete-all + insert-all — replace-all)
  - `Ok(())`
- [ ] `fn escrever_colecoes(conn: &Connection, images_dir: &Path, pid: i64, input: &PersonagemInput) -> Result<(), AppError>`:
  - **Delete-all** (idempotente; em `criar` não acerta nada): `DELETE FROM habilidade WHERE personagem_id=?1`; idem `personagem_pericia`, `personagem_vantagem`, `personagem_desvantagem`, `transformacao` (os filhos `transformacao_modificador`/`transformacao_habilidade` caem por `ON DELETE CASCADE`).
  - **Insert-all** (espelha o `importador_registro`):
    - habilidades: `INSERT INTO habilidade (personagem_id,nome,descricao,ordem) VALUES (?,?,?,?)` com `ordem = índice`.
    - pericias: `INSERT INTO personagem_pericia (personagem_id,nome,descricao,atributo,nivel) VALUES (?,?,?,?,?)`.
    - vantagens/desvantagens: `INSERT INTO personagem_vantagem|_desvantagem (personagem_id,nome,descricao,efeito) VALUES (?,?,?,?)`.
    - transformações: para cada (com `ordem = índice`): `let img = imagens::resolver_retrato(conn, images_dir, &t.retrato)?;` → `INSERT INTO transformacao (personagem_id,nome,descricao,imagem_id,ordem) VALUES (?,?,?,?,?)`; `let tid = conn.last_insert_rowid();` → inserir `transformacao_modificador (transformacao_id,atributo,delta)` e `transformacao_habilidade (transformacao_id,nome,descricao)`.
- [ ] `pub fn excluir_personagem(conn: &Connection, id: i64) -> Result<(), AppError>`:
  - `let n = conn.execute("DELETE FROM personagem WHERE id=?1", [id])?;` → `n==0` → `Err(AppError::Msg("personagem não encontrado".into()))` senão `Ok(())`. (Filhos caem por cascade.)
- [ ] `pub fn listar_catalogos(conn: &Connection) -> Result<Catalogos, AppError>`:
  - `SELECT nome,descricao,atributo FROM catalogo_pericia ORDER BY nome` → `Vec<CatalogoPericia>`.
  - `SELECT nome,descricao,efeito FROM catalogo_vantagem ORDER BY nome` → `Vec<CatalogoTraco>`.
  - `SELECT nome,descricao,efeito FROM catalogo_desvantagem ORDER BY nome` → `Vec<CatalogoTraco>`.

### Task B3.3 — comandos Tauri
**Files:** Modify `src-tauri/src/lib.rs`

- [ ] Helper pra tirar duplicação do `app_data_dir/images`:
  ```rust
  fn images_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
      Ok(app.path().app_data_dir().map_err(|e| AppError::Msg(e.to_string()))?.join("images"))
  }
  ```
  Usar nos comandos novos; **opcional**: refatorar `importar_v1` e `retrato_data_url` pra usar também (baixo risco, remove repetição).
- [ ] Comandos (todos abrem 1 transação via `conn.unchecked_transaction()` como o `importar_v1_completo`):
  ```rust
  #[tauri::command]
  fn criar_personagem(app: tauri::AppHandle, db: tauri::State<Db>, input: PersonagemInput) -> Result<i64, AppError> {
      let dir = images_dir(&app)?;
      let conn = db.conn()?;
      let tx = conn.unchecked_transaction()?;
      let id = db::repositorios::criar_personagem(&tx, &dir, &input)?;
      tx.commit()?;
      Ok(id)
  }

  #[tauri::command]
  fn atualizar_personagem(app: tauri::AppHandle, db: tauri::State<Db>, id: i64, input: PersonagemInput) -> Result<(), AppError> {
      let dir = images_dir(&app)?;
      let conn = db.conn()?;
      let tx = conn.unchecked_transaction()?;
      db::repositorios::atualizar_personagem(&tx, &dir, id, &input)?;
      tx.commit()?;
      Ok(())
  }

  #[tauri::command]
  fn excluir_personagem(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
      let conn = db.conn()?;
      db::repositorios::excluir_personagem(&conn, id)
  }

  #[tauri::command]
  fn listar_catalogos(db: tauri::State<Db>) -> Result<Catalogos, AppError> {
      let conn = db.conn()?;
      db::repositorios::listar_catalogos(&conn)
  }
  ```
- [ ] `use domain::modelos::{... , PersonagemInput, Catalogos};`
- [ ] Registrar os 4 no `generate_handler![...]`.

### Task B3.4 — testes Rust
**Files:** Modify `src-tauri/src/db/repositorios.rs` (mod tests)

Usar `open_in_memory()` + `std::env::temp_dir().join("rpgv2_test_crud")` como `images_dir` (limpar antes/depois, padrão do importador). Reusar a const base64 `PNG_1X1` (copiar do `importador_v1.rs` tests ou expor).

- [ ] **round-trip criar→get:** montar `PersonagemInput` com 1 habilidade, 1 perícia, 1 vantagem, 1 transformação (com 1 modificador + 1 habilidade + `RetratoInput::Novo{PNG_1X1,"png"}`), retrato base `Novo`. `criar_personagem` → `get_personagem` retorna `atributos.len()==8`, `habilidades.len()==1`, `transformacoes[0].modificadores.len()==1`, retrato `Some`.
- [ ] **atualizar replace-all:** criar; depois `atualizar_personagem` com listas diferentes (ex.: 0 habilidades, 2 perícias). `get` reflete as novas contagens (habilidades==0, pericias==2), sem sobras da versão anterior.
- [ ] **retrato Manter/Nenhum:** após criar com `Novo`, pegar o `caminho` do `get`; `atualizar` com `RetratoInput::Manter{caminho}` → retrato segue `Some` (mesmo arquivo). Depois `atualizar` com `Nenhum` → retrato `None`.
- [ ] **dedup:** duas transformações no mesmo save com o mesmo `PNG_1X1` → `SELECT count(*) FROM imagem` conta a imagem **uma vez** (sha256).
- [ ] **excluir cascata:** criar com filhos; `excluir_personagem` Ok; `get_personagem` erra; `SELECT count(*)` em `habilidade`/`transformacao`/`transformacao_modificador` = 0.
- [ ] **validação:** `nome` vazio → `Err`; `tipo="foo"` → `Err`. `excluir_personagem(id_inexistente)` → `Err`.
- [ ] **catálogos:** inserir à mão em `catalogo_pericia`/`_vantagem`/`_desvantagem`; `listar_catalogos` retorna as contagens certas.
- [ ] Verificar: `cargo test` verde, `cargo build` limpo.

---

## Frontend (React/TS/Tailwind v4)

### Task F3.1 — tipos
**Files:** Modify `src/lib/types.ts`

Espelhar o contrato de entrada (snake_case; reusar os `*Dto` de leitura quando a forma bate):
```ts
export type RetratoInput =
  | { modo: "manter"; caminho: string }
  | { modo: "novo"; base64: string; formato: string }
  | { modo: "nenhum" };

export interface TransformacaoInput {
  nome: string; descricao: string; retrato: RetratoInput;
  modificadores: ModificadorDto[];   // {atributo, delta} — mesma forma
  habilidades: HabilidadeDto[];      // {nome, descricao}
}
export interface PersonagemInput {
  tipo: Tipo; nome: string; descricao: string;
  hp: number; sp: number; escudo: number;
  forca: number; agilidade: number; percepcao: number; resistencia: number;
  intuicao: number; espirito: number; carisma: number; determinacao: number;
  retrato: RetratoInput;
  habilidades: HabilidadeDto[];
  pericias: PericiaDto[];            // {nome, descricao, atributo, nivel}
  vantagens: TracoDto[];            // {nome, descricao, efeito}
  desvantagens: TracoDto[];
  transformacoes: TransformacaoInput[];
}
export interface CatalogoPericia { nome: string; descricao: string; atributo: string }
export interface CatalogoTraco { nome: string; descricao: string; efeito: string }
export interface Catalogos { pericias: CatalogoPericia[]; vantagens: CatalogoTraco[]; desvantagens: CatalogoTraco[] }
```
Constante compartilhada dos 8 atributos (ordem fixa) + rótulos — reaproveitar `ROTULO_ATRIBUTO`/`ABREV_ATRIBUTO` que hoje vivem em `StatBlock.tsx`/`CharacterSheet.tsx`. **Extrair** pra `src/features/characters/atributos.ts` (`ATRIBUTOS: readonly [...8]`, `ROTULO_ATRIBUTO`, `ABREV_ATRIBUTO`) e importar nos 3 lugares (evita divergência).

### Task F3.2 — api
**Files:** Modify `src/lib/api.ts`
```ts
export const criarPersonagem = (input: PersonagemInput) => invoke<number>("criar_personagem", { input });
export const atualizarPersonagem = (id: number, input: PersonagemInput) => invoke<void>("atualizar_personagem", { id, input });
export const excluirPersonagem = (id: number) => invoke<void>("excluir_personagem", { id });
export const listarCatalogos = () => invoke<Catalogos>("listar_catalogos", {});
```

### Task F3.3 — primitivos à mão + ícones
**Files:** Create `src/components/Dialog.tsx`, `src/components/Toast.tsx`; Modify `src/components/icons.tsx`, `src/main.tsx`

- [ ] `icons.tsx`: adicionar (mesmo wrapper `Icon`): `IconMais` (+), `IconLixeira` (trash), `IconFechar` (X), `IconUpload`, `IconEditar` (lápis), `IconCheck`.
- [ ] `Dialog.tsx`: modal de confirmação acessível (`role="dialog" aria-modal`), overlay, Esc fecha, foco inicial no botão de ação, click no overlay cancela. Props: `{ aberto, titulo, descricao?, textoConfirmar, textoCancelar?, perigo?, onConfirmar, onCancelar }`. **Não** disparar `confirm()`/`alert()` nativos. Transições sutis (fade/scale ~150ms), idioma do `Tabs.tsx`.
- [ ] `Toast.tsx`: `ToastProvider` (context) + hook `useToast()` → `toast.sucesso(msg)` / `toast.erro(msg)`. Toasts empilham num canto (bottom-right), somem sozinhos (~3.5s), acessíveis (`role="status"`/`aria-live="polite"`). Zero deps.
- [ ] `main.tsx`: envolver `<App/>` com `<ToastProvider>` (dentro do `QueryClientProvider`).

### Task F3.4 — rotas
**Files:** Modify `src/App.tsx`
```tsx
<Route index element={<FichasGallery />} />
<Route path="/fichas/novo" element={<FichaForm />} />
<Route path="/fichas/:id" element={<CharacterSheet />} />
<Route path="/fichas/:id/editar" element={<FichaForm />} />
```
(`/fichas/novo` **antes** de `/fichas/:id` pra não casar "novo" como id.)

### Task F3.5 — `FichaForm` + sub-editores
**Files:** Create `src/features/characters/FichaForm.tsx` e sub-componentes em `src/features/characters/form/` (`SecaoBase.tsx`, `RetratoUpload.tsx`, `ListaEditavel.tsx`, `PericiasEditor.tsx`, `TransformacoesEditor.tsx`, `CatalogoPicker.tsx`, `Campos.tsx`)

- [ ] **`Campos.tsx`**: inputs reutilizáveis no estilo do projeto — `CampoTexto` (label + input), `CampoNumero` (input `type=number`, `tabular-nums`), `SelectAtributo` (`<select>` nativo estilizado com os 8 atributos de `atributos.ts`), `Textarea`. Sem `any`.
- [ ] **`FichaForm.tsx`**:
  - `const { id } = useParams();` — `editando = id != null`.
  - Se editando: `useQuery(["personagem", Number(id)], () => getPersonagem(Number(id)))` pra prefill; converter `PersonagemCompleto` → estado de form (`PersonagemInput`): `retrato` do personagem/transformação vira `{modo:"manter",caminho}` se tinha imagem, senão `{modo:"nenhum"}`.
  - Se novo: estado inicial vazio (`tipo:"jogador"`, zeros nos 8 atributos e pools, listas `[]`, `retrato:{modo:"nenhum"}`).
  - `useQuery(["catalogos"], listarCatalogos)` (staleTime alto) pros pickers.
  - Estado local único (`useState<PersonagemInput>`); handlers imutáveis por seção.
  - Layout parecido com a ficha: coluna esquerda = `SecaoBase` + `RetratoUpload`; direita = `Tabs` (reusar `components/Tabs.tsx`) com Habilidades / Perícias / Vantagens / Desvantagens / Transformações, cada aba com seu editor.
  - Barra de ação fixa no topo: título ("Novo personagem" / "Editar {nome}"), **Salvar** (`useMutation` → `criarPersonagem`/`atualizarPersonagem`), **Cancelar** (volta sem salvar; se novo → `/`, se editando → `/fichas/:id`).
  - **Validação de UI:** Salvar desabilitado se `nome.trim()` vazio; `tipo` sempre válido (select). Números: coagir `Number(...)`, tratar `NaN`→0, sem negativos onde não faz sentido (pools/atributos `min={0}`).
  - **Mutation success:** `qc.invalidateQueries` → criar: `["personagens"]`, navegar `/fichas/${novoId}`; editar: `["personagens"]` + `["personagem", id]`, navegar `/fichas/${id}`. `toast.sucesso`. **Error:** `toast.erro(String(e))`, permanece no form.
  - Estados: loading (prefill/catálogos), erro de prefill (id inválido → mensagem + voltar).
- [ ] **`SecaoBase.tsx`**: `nome` (CampoTexto), `tipo` (`<select>` jogador/npc), `descricao` (Textarea), pools HP/SP/Escudo (3× CampoNumero), grid dos 8 atributos (CampoNumero cada, rótulos de `atributos.ts`). Recebe `valor`/`onChange` parcial.
- [ ] **`RetratoUpload.tsx`**: preview (usa `retratoDataUrl` quando `modo==="manter"`; quando `modo==="novo"`, monta data-URL local `data:image/{formato};base64,{base64}`; senão placeholder de iniciais/gradiente reusando `retrato.ts`). Botão "Trocar imagem" abre `<input type=file accept="image/*">` escondido → `FileReader.readAsDataURL` → separar `formato` (do mime `image/<x>`) e `base64` (após a vírgula) → `onChange({modo:"novo",base64,formato})`. Botão "Remover" → `{modo:"nenhum"}`. Reaproveitável (personagem e transformação).
- [ ] **`ListaEditavel.tsx`**: editor genérico de lista com add/remover/reordenar-opcional. Usado por Habilidades (nome+descricao) e por Vantagens/Desvantagens (nome+descricao+efeito). Cada item = card com CampoTexto/Textarea + botão lixeira; rodapé "＋ Adicionar" (+ botão "Escolher do catálogo" via `CatalogoPicker` pra vantagens/desvantagens).
- [ ] **`PericiasEditor.tsx`**: lista de perícias — cada linha: nome, descricao, `SelectAtributo`, nível (CampoNumero). "＋ Adicionar" e "Escolher do catálogo" (picker de `catalogos.pericias`, prefill nome/descricao/atributo; nível começa 0). Pode digitar custom.
- [ ] **`TransformacoesEditor.tsx`**: lista de transformações — cada bloco: nome, descricao, `RetratoUpload` próprio, sub-editor de **modificadores** (linhas: `SelectAtributo` + delta CampoNumero + lixeira; "＋ Adicionar modificador") e sub-lista de **habilidades** (reusar `ListaEditavel` forma nome+descricao). "＋ Adicionar transformação" / lixeira por bloco.
- [ ] **`CatalogoPicker.tsx`**: usa `Dialog` (ou popover próprio) com `<input>` de busca + lista filtrada (nome/descrição). Ao escolher, chama `onEscolher(item)` e fecha. Recebe os itens já carregados (perícias ou traços). Busca client-side (como a galeria).

### Task F3.6 — entradas na ficha e na galeria
**Files:** Modify `src/features/characters/CharacterSheet.tsx`, `src/features/characters/FichasGallery.tsx`

- [ ] `CharacterSheet.tsx`: na barra do topo (ao lado do "← Fichas"), botões **Editar** (`<Link to={`/fichas/${id}/editar`}>`, `IconEditar`) e **Excluir** (`IconLixeira`, estilo perigo). Excluir abre `Dialog` de confirmação → `useMutation(excluirPersonagem)` → sucesso: `invalidateQueries(["personagens"])`, `toast.sucesso`, `navigate("/")`. Sem quebrar os estados loading/erro atuais.
- [ ] `FichasGallery.tsx`: botão **＋ Novo personagem** no cabeçalho (`<Link to="/fichas/novo">`, `IconMais`, estilo primário indigo) e como CTA no empty-state (quando não há busca). Atualizar o texto do rodapé da sidebar de "Fase 1 · Slice 1" → "Fase 1 · Slice 3" (`src/components/Sidebar.tsx`).

---

## Verificação (DoD — Slice 3)

**Headless (o subagente roda e reporta):**
- [ ] `cargo test` verde (novos testes de repositório + os antigos intactos).
- [ ] `cargo build` limpo (só o warning benigno do linker MSVC).
- [ ] `npm run build` ok (`tsc` sem erro de tipo; sem `any`; contrato TS↔serde batendo).

**GUI (o usuário roda `npm run tauri dev` e confere):**
- [ ] "Novo personagem" abre form vazio; preencher base + 1 habilidade + 1 perícia (do catálogo) + 1 transformação com 1 modificador + upload de retrato; Salvar → cai na ficha nova com tudo renderizado.
- [ ] "Editar" numa ficha existente prefila tudo; trocar um valor + remover um item + trocar retrato; Salvar → ficha reflete; galeria reflete.
- [ ] "Excluir" pede confirmação e, ao confirmar, some da galeria.
- [ ] Retrato "manter" não perde a imagem ao salvar sem trocar; "remover" zera.
- [ ] Sem erro no console; toasts de sucesso/erro aparecem.

## Fora de escopo / notas
- **Imagens órfãs** (retrato antigo trocado, transformação removida) **não** são coletadas neste slice — dedup por sha256 reusa arquivos; GC fica pra depois.
- **Sem migration nova** — o schema atual já cobre.
- **Título nativo da janela** segue cosmético (não mexer — regra de não tocar em config sem pedido).
- **Aplicar** transformação (somar modificadores nos atributos em batalha) é Fase 2, não aqui — aqui só edita os dados.

## Notas de qualidade
- Uma transação por save; replace-all só dentro dela. Nada de SQL no front.
- Componentes pequenos e focados; reusar `Tabs`, `retrato.ts`, `atributos.ts`. Sem duplicar os rótulos de atributo.
- Acessibilidade: Dialog com foco/Esc, Toast com `aria-live`, `<select>` nativo. Consultar skills de UI (`frontend-design`/`emil-kowalski-ui-craft`) pra transições sutis (não exagerar).
- Depois do Slice 3: **review em sessão limpa** (Writer/Reviewer) e então Fase 2 (Batalha).
