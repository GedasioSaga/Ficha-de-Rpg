# Fase 1 · Slice 1 — Galeria de Fichas · Plano

> SUB-SKILL: subagent-driven-development. **SEM GIT** (checkpoint = build + app abre). Base: `C:\dev\projeto-rpg-v2`.

**Goal:** Trocar a tela-prova por uma **galeria real**: shell com sidebar colapsável + grid de cards dos 19 personagens (retrato + nome + tipo + atributos-chave), com toggle Jogadores/NPCs e busca.

**Escopo:** SÓ a galeria (leitura). Ficha detalhada = Slice 2. CRUD = Slice 3. Sem shadcn ainda (só Tailwind); sem rank (é da ficha).

**Design travado (companion):** App Shell = Sidebar colapsável (A). Fichas = Galeria de retratos (A).

**Stack nova:** Tailwind v4 (`@tailwindcss/vite`), React Router, TanStack Query. Imagem via comando Rust `retrato_data_url` (base64 na leitura).

---

## Backend (Rust) — 1 comando novo

### Task B1: comando `retrato_data_url`
**Files:** Modify `src-tauri/src/lib.rs`

- [ ] Adicionar o comando (lê o arquivo de `app_data/images/<caminho>` e devolve data-URL):
```rust
#[tauri::command]
fn retrato_data_url(app: tauri::AppHandle, caminho: String) -> Result<String, AppError> {
    use base64::prelude::{Engine as _, BASE64_STANDARD};
    let p = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .join("images")
        .join(&caminho);
    let bytes = std::fs::read(p)?;
    let b64 = BASE64_STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}
```
- [ ] Registrar no handler: `tauri::generate_handler![listar_personagens, importar_v1, retrato_data_url]`.
- [ ] Verificar: `cargo build` limpo (em `src-tauri`).

**Nota:** `listar_personagens` já devolve `retrato` (nome do arquivo, ou null) + os 8 atributos + tipo + nome + id. Não precisa mudar.

---

## Frontend (React/TS/Tailwind)

### Task F1: setup Tailwind v4 + libs
**Files:** Modify `package.json` (via npm), `vite.config.ts`, `src/index.css` (criar se preciso), `src/main.tsx`

- [ ] Instalar (em `C:\dev\projeto-rpg-v2`): `npm install tailwindcss @tailwindcss/vite react-router-dom @tanstack/react-query`
- [ ] `vite.config.ts`: importar `tailwindcss from "@tailwindcss/vite"` e adicionar `tailwindcss()` no array `plugins` (junto do `react()` já existente).
- [ ] `src/index.css`: primeira linha `@import "tailwindcss";` (manter/limpar o resto; pode apagar `App.css` e sua importação).
- [ ] `src/main.tsx`: garantir `import "./index.css";`, envolver `<App/>` com `<QueryClientProvider client={queryClient}>` (criar `queryClient = new QueryClient()`) e `<BrowserRouter>`.
- [ ] Verificar: `npm run tauri dev` abre sem erro (tela ainda pode ser a antiga).

### Task F2: camada de dados (invoke tipado + hooks)
**Files:** Create `src/lib/api.ts`, `src/lib/types.ts`

- [ ] `src/lib/types.ts`:
```ts
export type Tipo = "jogador" | "npc";
export interface PersonagemResumo {
  id: number; tipo: Tipo; nome: string; retrato: string | null;
  forca: number; agilidade: number; percepcao: number; resistencia: number;
  intuicao: number; espirito: number; carisma: number; determinacao: number;
}
```
- [ ] `src/lib/api.ts`: wrappers tipados sobre `invoke` —
```ts
import { invoke } from "@tauri-apps/api/core";
import type { PersonagemResumo, Tipo } from "./types";

export const listarPersonagens = (tipo: Tipo | null) =>
  invoke<PersonagemResumo[]>("listar_personagens", { tipo });

export const retratoDataUrl = (caminho: string) =>
  invoke<string>("retrato_data_url", { caminho });
```

### Task F3: App Shell (sidebar colapsável)
**Files:** Create `src/components/AppShell.tsx`, `src/components/Sidebar.tsx`; Modify `src/App.tsx`

- [ ] `Sidebar`: coluna fixa à esquerda. Itens: **Fichas** (ativo/rota `/`), e desabilitados "em breve": Batalha, Mapa, Discord, Notas, Compêndio (com ícone/emoji + label). Estado `colapsado` (bool via `useState`): quando colapsado, mostra só ícones (largura ~56px); expandido mostra ícone+label (~200px). Botão de toggle (☰) no topo. Use Tailwind (`flex flex-col`, `transition-all`, cores escuras — tema RPG: fundo `slate-900`, ativo `indigo-500`).
- [ ] `AppShell`: `<div class="flex h-screen">` com `<Sidebar/>` + `<main class="flex-1 overflow-auto">{children/Outlet}</main>`.
- [ ] `App.tsx`: definir rotas com React Router — `AppShell` como layout, rota index `/` → `<FichasGallery/>` (Task F4). Remover a tela-prova antiga.

### Task F4: Galeria de fichas
**Files:** Create `src/features/characters/FichasGallery.tsx`, `src/features/characters/CharacterCard.tsx`

- [ ] `FichasGallery`:
  - Estado: `tipo: Tipo | null` (toggle: Todos / Jogadores / NPCs — 3 botões, default null=Todos), `busca: string` (input).
  - `useQuery(["personagens", tipo], () => listarPersonagens(tipo))`.
  - Filtra client-side por `busca` (nome, case-insensitive).
  - Cabeçalho: título "Fichas", os 3 botões de toggle, e um input de busca à direita.
  - Grid responsivo (`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4`) de `<CharacterCard>`.
  - Estados: loading (skeleton/"carregando…"), vazio ("nenhum personagem").
- [ ] `CharacterCard` (props: `p: PersonagemResumo`):
  - Card com retrato no topo (aspect ~3/4, `object-cover`), nome, badge do tipo (jogador=indigo, npc=slate), e uma linha de 2-3 atributos-chave (ex: FOR/AGI/RES).
  - Retrato: `useQuery(["retrato", p.retrato], () => retratoDataUrl(p.retrato!), { enabled: !!p.retrato })`; enquanto carrega ou se `retrato` for null, mostra um placeholder (iniciais do nome sobre fundo colorido).
  - Hover: leve `scale`/ring (Tailwind `hover:ring-2 ring-indigo-400 transition`).
  - (Sem onClick funcional ainda — Slice 2 abre a ficha. Deixe SEM navegação por ora.)

---

## Verificação (Definition of Done — Slice 1)
- [ ] `cargo build` limpo; `npm run tauri dev` abre.
- [ ] App mostra **sidebar colapsável** (toggle funciona) + **galeria com os 19 personagens**, cada um com **retrato** (ou placeholder com iniciais).
- [ ] Toggle Jogadores/NPCs filtra (6 / 13); busca por nome funciona.
- [ ] Visual limpo/tema escuro, responsivo (redimensionar a janela reflui o grid).
- [ ] Nenhum erro no console do webview.

## Fora de escopo (próximos slices)
- Slice 2: ficha detalhada (2 colunas + abas, rank via `rank_calculator` portado, comando `get_personagem`).
- Slice 3: CRUD (criar/editar/excluir, upload de retrato, pickers de catálogo, shadcn Dialog/Toast).

## Notas de qualidade (para quem implementar)
- Consultar as skills de design de UI (frontend-design / emil-kowalski-ui-craft) para acabamento: espaçamento consistente, transições sutis (não exagerar), hierarquia visual. Evitar cara de template.
- Componentes pequenos e focados (Card separado da Gallery). Sem lógica de SQL no front (só chama comandos). Sem `any` solto no TS.
