# Mapa (Fase 3) — Plano B: Frontend

> **Para workers:** implemente tarefa-a-tarefa. Steps usam checkbox (`- [ ]`).
> **REGRA DO v2 — SEM GIT.** Sem commit. Cada tarefa fecha em `npm run build` (type-check) e a verificação final é no **app rodando** (`npm run tauri dev`).
> **Pré-requisito:** Plano **A** (backend) concluído e `cargo test` verde — os comandos `listar_mapas/get_mapa/criar_mapa/atualizar_mapa/duplicar_mapa/excluir_mapa/render_mapa_discord` precisam existir.
> **Spec:** `docs/specs/2026-07-20-fase-3-mapa.md`.

**Goal:** Tela `/mapa` com biblioteca de mapas, editor de grade clicável, campos de texto, preview ao vivo, auto-save, undo/redo e "Copiar pro Discord".

**Architecture:** `MapaScreen` orquestra (react-query pra dados + `useReducer` pro estado do editor com histórico undo/redo + auto-save debounced). Filhos são apresentacionais: `ListaMapas`, `CamposMapa`, `GradeEditor`, `PreviewMapa`. Helpers puros (cores, normalização no cliente, pintura imutável) em `logica.ts`.

**Tech Stack:** React 19 + TS, @tanstack/react-query 5, Tailwind v4. Sem test-runner no front — verificação = `npm run build` (tsc) + app rodando.

> **Comandos:** `npm run build` e `npm run tauri dev` rodam em `C:\dev\projeto-rpg-v2` (PowerShell). `npm run build` = `tsc && vite build` (type-check + build). Convenções: import de tipo usa `import type`; sem imports/variáveis não-usadas; nada de `import React`.

---

### Task B1: Tipos + bindings de API

**Files:**
- Modify: `src/lib/types.ts` (adicionar tipos do mapa ao fim)
- Modify: `src/lib/api.ts` (adicionar import de tipos + bindings ao fim)

- [ ] **Step 1: Adicionar os tipos** ao fim de `src/lib/types.ts` (campos em snake_case, 1:1 com o serde do Rust):
```ts
/* ----------------------------------- Mapa ---------------------------------- */
export interface Mapa {
  id: number;
  titulo: string;
  colunas: number;
  linhas: number;
  grade: string[];
  ordem_navegacao: string;
  legenda: string;
  efeito: string;
  criado_em: string;
  atualizado_em: string;
}

export interface MapaResumo {
  id: number;
  titulo: string;
  atualizado_em: string;
}

export interface MapaInput {
  titulo: string;
  colunas: number;
  linhas: number;
  grade: string[];
  ordem_navegacao: string;
  legenda: string;
  efeito: string;
}
```

- [ ] **Step 2: Adicionar os tipos ao import** no topo de `src/lib/api.ts` — incluir `Mapa`, `MapaInput`, `MapaResumo` no bloco `import type { ... } from "./types";` já existente.

- [ ] **Step 3: Adicionar os bindings** ao fim de `src/lib/api.ts`:
```ts
/* ----------------------------------- Mapa ---------------------------------- */
/** Lista os mapas (resumo) pra biblioteca lateral. */
export const listarMapas = () => invoke<MapaResumo[]>("listar_mapas", {});

/** Carrega um mapa completo (grade normalizada). */
export const getMapa = (id: number) => invoke<Mapa>("get_mapa", { id });

/** Cria um mapa; devolve o mapa criado (com id). */
export const criarMapa = (input: MapaInput) => invoke<Mapa>("criar_mapa", { input });

/** Salva um mapa inteiro; devolve o mapa atualizado. */
export const atualizarMapa = (id: number, input: MapaInput) =>
  invoke<Mapa>("atualizar_mapa", { id, input });

/** Duplica um mapa (título + " (cópia)"); devolve a cópia. */
export const duplicarMapa = (id: number) => invoke<Mapa>("duplicar_mapa", { id });

/** Exclui um mapa. */
export const excluirMapa = (id: number) => invoke<void>("excluir_mapa", { id });

/** Render do estado atual do editor no formato do Discord (fonte única). */
export const renderMapaDiscord = (input: MapaInput) =>
  invoke<string>("render_mapa_discord", { input });
```

- [ ] **Step 4: Checkpoint**

Run: `npm run build`
Expected: type-check + build sem erros.

---

### Task B2: Helpers puros (`logica.ts`)

**Files:**
- Create: `src/features/mapa/logica.ts`

- [ ] **Step 1: Criar `src/features/mapa/logica.ts`:**
```ts
import type { Mapa, MapaInput } from "../../lib/types";

export const COLUNAS_MIN = 6;
export const COLUNAS_MAX = 26;
export const LINHAS_MIN = 3;
export const LINHAS_MAX = 50;
export const CELULA_VAZIA = "-";
export const LIMITE_DISCORD = 2000;

/** Caracteres pintáveis fixos (a "letra qualquer" é ponto de interesse). */
export const PALETA: { char: string; nome: string }[] = [
  { char: "-", nome: "vazio" },
  { char: "X", nome: "árvore" },
  { char: "~", nome: "água" },
  { char: "#", nome: "pedra" },
  { char: ".", nome: "chão" },
];

/** Cor (classe Tailwind) por tipo de célula. Só no app — o Discord vai monoespaçado sem cor. */
export function corDaCelula(c: string): string {
  switch (c) {
    case "X": return "text-emerald-400";
    case "~": return "text-sky-400";
    case "#": return "text-stone-400";
    case ".": return "text-amber-300/80";
    case "-": return "text-slate-700";
    default: return "text-indigo-300"; // ponto de interesse (letras/dígitos)
  }
}

/** Rótulo de coluna: 0→"A", 1→"B", ... (até 25→"Z"). */
export function rotuloColuna(i: number): string {
  return String.fromCharCode(65 + i);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Espelha a normalização do Rust pra resposta imediata na UI. */
export function normalizarGrade(grade: string[], colunas: number, linhas: number): string[] {
  const cols = clamp(Math.round(colunas) || COLUNAS_MIN, COLUNAS_MIN, COLUNAS_MAX);
  const lins = clamp(Math.round(linhas) || LINHAS_MIN, LINHAS_MIN, LINHAS_MAX);
  const out: string[] = [];
  for (let i = 0; i < lins; i++) {
    const origem = [...(grade[i] ?? "")];
    let linha = "";
    for (let j = 0; j < cols; j++) {
      const ch = origem[j];
      linha += ch && ch.trim() !== "" ? ch : CELULA_VAZIA;
    }
    out.push(linha);
  }
  return out;
}

export function gradeVazia(colunas: number, linhas: number): string[] {
  return normalizarGrade([], colunas, linhas);
}

/** Pinta a célula (r,c) com `char`, retornando uma nova grade (imutável). */
export function pintar(grade: string[], r: number, c: number, char: string): string[] {
  return grade.map((linha, i) => {
    if (i !== r) return linha;
    const arr = [...linha];
    arr[c] = char;
    return arr.join("");
  });
}

/** Descarta id/timestamps pra montar o input de save/render. */
export function mapaParaInput(m: Mapa): MapaInput {
  return {
    titulo: m.titulo,
    colunas: m.colunas,
    linhas: m.linhas,
    grade: m.grade,
    ordem_navegacao: m.ordem_navegacao,
    legenda: m.legenda,
    efeito: m.efeito,
  };
}

/** Input de um mapa novo em branco. */
export function inputVazio(): MapaInput {
  return {
    titulo: "Novo mapa",
    colunas: 26,
    linhas: 7,
    grade: gradeVazia(26, 7),
    ordem_navegacao: "",
    legenda: "",
    efeito: "",
  };
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B3: Campos de texto (`CamposMapa.tsx`)

**Files:**
- Create: `src/features/mapa/CamposMapa.tsx`

- [ ] **Step 1: Criar `src/features/mapa/CamposMapa.tsx`:**
```tsx
import type { MapaInput } from "../../lib/types";

export default function CamposMapa({
  input,
  onEditar,
}: {
  input: MapaInput;
  onEditar: (patch: Partial<MapaInput>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <input
        value={input.titulo}
        onChange={(e) => onEditar({ titulo: e.target.value })}
        placeholder="Título do mapa"
        className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-600"
      />
      <Campo rotulo="Ordem" valor={input.ordem_navegacao} onChange={(v) => onEditar({ ordem_navegacao: v })} />
      <Campo rotulo="Legenda" valor={input.legenda} onChange={(v) => onEditar({ legenda: v })} />
      <Campo rotulo="Efeito" valor={input.efeito} onChange={(v) => onEditar({ efeito: v })} textarea />
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  textarea,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const classe =
    "w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</span>
      {textarea ? (
        <textarea value={valor} onChange={(e) => onChange(e.target.value)} rows={3} className={`${classe} resize-y`} />
      ) : (
        <input value={valor} onChange={(e) => onChange(e.target.value)} className={classe} />
      )}
    </label>
  );
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B4: Editor de grade (`GradeEditor.tsx`)

**Files:**
- Create: `src/features/mapa/GradeEditor.tsx`

- [ ] **Step 1: Criar `src/features/mapa/GradeEditor.tsx`:**
```tsx
import { useState } from "react";
import type { MapaInput } from "../../lib/types";
import {
  COLUNAS_MAX,
  COLUNAS_MIN,
  LINHAS_MAX,
  LINHAS_MIN,
  PALETA,
  corDaCelula,
  normalizarGrade,
  pintar,
  rotuloColuna,
} from "./logica";

export default function GradeEditor({
  input,
  onEditar,
}: {
  input: MapaInput;
  onEditar: (patch: Partial<MapaInput>) => void;
}) {
  const [ativo, setAtivo] = useState("X");
  const [pintando, setPintando] = useState(false);

  function aplicar(r: number, c: number) {
    onEditar({ grade: pintar(input.grade, r, c, ativo) });
  }
  function mudarDim(colunas: number, linhas: number) {
    const cols = Math.max(COLUNAS_MIN, Math.min(COLUNAS_MAX, colunas || COLUNAS_MIN));
    const lins = Math.max(LINHAS_MIN, Math.min(LINHAS_MAX, linhas || LINHAS_MIN));
    onEditar({ colunas: cols, linhas: lins, grade: normalizarGrade(input.grade, cols, lins) });
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PALETA.map((p) => (
          <button
            key={p.char}
            type="button"
            title={p.nome}
            onClick={() => setAtivo(p.char)}
            className={`h-8 w-8 rounded font-mono text-base ${corDaCelula(p.char)} ${
              ativo === p.char ? "ring-2 ring-indigo-400" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {p.char}
          </button>
        ))}
        <input
          value={ativo}
          maxLength={1}
          onChange={(e) => setAtivo((e.target.value || "-").slice(-1))}
          title="Ponto de interesse (qualquer letra)"
          className="h-8 w-10 rounded bg-slate-800 text-center font-mono text-base text-indigo-300 outline-none"
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <label>
            col
            <input
              type="number"
              min={COLUNAS_MIN}
              max={COLUNAS_MAX}
              value={input.colunas}
              onChange={(e) => mudarDim(Number(e.target.value), input.linhas)}
              className="ml-1 w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
            />
          </label>
          <label>
            lin
            <input
              type="number"
              min={LINHAS_MIN}
              max={LINHAS_MAX}
              value={input.linhas}
              onChange={(e) => mudarDim(input.colunas, Number(e.target.value))}
              className="ml-1 w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
            />
          </label>
        </div>
      </div>

      <div className="overflow-auto">
        <table
          className="border-separate border-spacing-0 select-none font-mono text-sm leading-none"
          onMouseLeave={() => setPintando(false)}
        >
          <thead>
            <tr>
              <th className="w-6" />
              {Array.from({ length: input.colunas }, (_, c) => (
                <th key={c} className="w-6 pb-1 text-center text-[10px] font-normal text-slate-500">
                  {rotuloColuna(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {input.grade.map((linha, r) => (
              <tr key={r}>
                <td className="pr-1 text-right text-[10px] text-slate-500">{r + 1}</td>
                {Array.from({ length: input.colunas }, (_, c) => {
                  const ch = [...linha][c] ?? "-";
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        onMouseDown={() => {
                          setPintando(true);
                          aplicar(r, c);
                        }}
                        onMouseEnter={() => {
                          if (pintando) aplicar(r, c);
                        }}
                        onMouseUp={() => setPintando(false)}
                        className={`flex h-6 w-6 items-center justify-center rounded-sm hover:bg-slate-700/50 ${corDaCelula(ch)}`}
                      >
                        {ch}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Clique/arraste pra pintar com <span className="font-mono text-slate-300">{ativo}</span>. Ctrl+Z desfaz.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B5: Lista/biblioteca (`ListaMapas.tsx`)

**Files:**
- Create: `src/features/mapa/ListaMapas.tsx`

- [ ] **Step 1: Criar `src/features/mapa/ListaMapas.tsx`:**
```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { duplicarMapa, excluirMapa } from "../../lib/api";
import type { MapaResumo } from "../../lib/types";
import Dialog from "../../components/Dialog";
import { useToast } from "../../components/Toast";

export default function ListaMapas({
  mapas,
  selecionado,
  onSelecionar,
  onNovo,
  onMudou,
  onExcluiuSelecionado,
}: {
  mapas: MapaResumo[];
  selecionado: number | null;
  onSelecionar: (id: number) => void;
  onNovo: () => void;
  onMudou: () => void;
  onExcluiuSelecionado: () => void;
}) {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<MapaResumo | null>(null);

  const duplicar = useMutation({
    mutationFn: (id: number) => duplicarMapa(id),
    onSuccess: (m) => {
      onMudou();
      onSelecionar(m.id);
      toast.sucesso("Mapa duplicado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const excluir = useMutation({
    mutationFn: (id: number) => excluirMapa(id),
    onSuccess: (_res, id) => {
      onMudou();
      if (id === selecionado) onExcluiuSelecionado();
      setConfirmar(null);
      toast.sucesso("Mapa excluído.");
    },
    onError: (e) => {
      setConfirmar(null);
      toast.erro(String(e));
    },
  });

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-2">
      <button
        type="button"
        onClick={onNovo}
        className="mb-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20"
      >
        + Novo mapa
      </button>
      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {mapas.map((m) => (
          <li key={m.id}>
            <div
              className={`group flex items-center rounded-lg px-2 py-1.5 text-sm ${
                m.id === selecionado ? "bg-indigo-500/10 text-indigo-200" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelecionar(m.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {m.titulo || "(sem título)"}
              </button>
              <button
                type="button"
                title="Duplicar"
                onClick={() => duplicar.mutate(m.id)}
                className="ml-1 hidden rounded px-1 text-xs text-slate-400 hover:text-slate-100 group-hover:block"
              >
                dup
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => setConfirmar(m)}
                className="ml-1 hidden rounded px-1 text-xs text-rose-400 hover:text-rose-300 group-hover:block"
              >
                del
              </button>
            </div>
          </li>
        ))}
        {mapas.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-slate-500">Nenhum mapa ainda.</li>
        )}
      </ul>
      <Dialog
        aberto={confirmar !== null}
        titulo="Excluir mapa?"
        descricao={confirmar ? `"${confirmar.titulo || "(sem título)"}" será removido. Não dá pra desfazer.` : ""}
        textoConfirmar={excluir.isPending ? "Excluindo…" : "Excluir"}
        perigo
        onConfirmar={() => confirmar && excluir.mutate(confirmar.id)}
        onCancelar={() => setConfirmar(null)}
      />
    </aside>
  );
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B6: Preview + Copiar (`PreviewMapa.tsx`)

**Files:**
- Create: `src/features/mapa/PreviewMapa.tsx`

- [ ] **Step 1: Criar `src/features/mapa/PreviewMapa.tsx`:**
```tsx
import { useState } from "react";
import { renderMapaDiscord } from "../../lib/api";
import type { MapaInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { LIMITE_DISCORD, corDaCelula, rotuloColuna } from "./logica";

export default function PreviewMapa({ input }: { input: MapaInput }) {
  const toast = useToast();
  const [textoDiscord, setTextoDiscord] = useState<string | null>(null);

  async function copiar() {
    try {
      const texto = await renderMapaDiscord(input);
      await navigator.clipboard.writeText(texto);
      if ([...texto].length > LIMITE_DISCORD) {
        toast.erro("Copiado, mas passa de 2000 caracteres — o Discord vai cortar.");
      } else {
        toast.sucesso("Mapa copiado pro Discord.");
      }
    } catch (e) {
      toast.erro(String(e));
    }
  }

  async function verTexto() {
    try {
      setTextoDiscord(await renderMapaDiscord(input));
    } catch (e) {
      toast.erro(String(e));
    }
  }

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-400">Preview</h3>
      <div className="min-h-0 flex-1 overflow-auto">
        {input.titulo && <div className="mb-2 text-base font-semibold text-slate-100">{input.titulo}</div>}
        <div className="inline-block rounded-lg bg-slate-900 p-3 font-mono text-xs leading-tight">
          <div className="flex">
            <span className="w-5" />
            {Array.from({ length: input.colunas }, (_, c) => (
              <span key={c} className="w-4 text-center text-slate-500">
                {rotuloColuna(c)}
              </span>
            ))}
          </div>
          {input.grade.map((linha, r) => (
            <div key={r} className="flex">
              <span className="w-5 pr-1 text-right text-slate-500">{r + 1}</span>
              {Array.from({ length: input.colunas }, (_, c) => {
                const ch = [...linha][c] ?? "-";
                return (
                  <span key={c} className={`w-4 text-center ${corDaCelula(ch)}`}>
                    {ch}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        {input.ordem_navegacao && (
          <p className="mt-3 text-sm text-slate-300">
            <b>Ordem:</b> {input.ordem_navegacao}
          </p>
        )}
        {input.legenda && (
          <p className="mt-1 text-sm text-slate-300">
            <b>Legenda:</b> {input.legenda}
          </p>
        )}
        {input.efeito && (
          <p className="mt-1 text-sm text-slate-300">
            <b>Efeito:</b> {input.efeito}
          </p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copiar}
          className="flex-1 rounded-lg bg-indigo-500/15 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/25"
        >
          Copiar pro Discord
        </button>
        <button
          type="button"
          onClick={verTexto}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Ver texto
        </button>
      </div>
      {textoDiscord !== null && (
        <div className="mt-2">
          <pre className="max-h-48 overflow-auto rounded-lg bg-black/60 p-2 text-[11px] text-slate-300">
            {textoDiscord}
          </pre>
          {[...textoDiscord].length > LIMITE_DISCORD && (
            <p className="mt-1 text-xs text-rose-400">
              {[...textoDiscord].length} caracteres — passa de 2000, o Discord corta.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B7: Orquestrador (`MapaScreen.tsx`)

**Files:**
- Create: `src/features/mapa/MapaScreen.tsx`

- [ ] **Step 1: Criar `src/features/mapa/MapaScreen.tsx`** (react-query + `useReducer` com histórico undo/redo + auto-save debounced):
```tsx
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atualizarMapa, criarMapa, getMapa, listarMapas } from "../../lib/api";
import type { MapaInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { inputVazio, mapaParaInput } from "./logica";
import ListaMapas from "./ListaMapas";
import CamposMapa from "./CamposMapa";
import GradeEditor from "./GradeEditor";
import PreviewMapa from "./PreviewMapa";

type HistEstado = { presente: MapaInput; passado: MapaInput[]; futuro: MapaInput[]; sujo: boolean };
type HistAcao =
  | { tipo: "set"; input: MapaInput }
  | { tipo: "editar"; input: MapaInput }
  | { tipo: "undo" }
  | { tipo: "redo" };

function reduzir(e: HistEstado, a: HistAcao): HistEstado {
  switch (a.tipo) {
    case "set":
      return { presente: a.input, passado: [], futuro: [], sujo: false };
    case "editar":
      return { presente: a.input, passado: [...e.passado, e.presente].slice(-100), futuro: [], sujo: true };
    case "undo": {
      if (e.passado.length === 0) return e;
      const anterior = e.passado[e.passado.length - 1];
      return { presente: anterior, passado: e.passado.slice(0, -1), futuro: [e.presente, ...e.futuro], sujo: true };
    }
    case "redo": {
      if (e.futuro.length === 0) return e;
      const proximo = e.futuro[0];
      return { presente: proximo, passado: [...e.passado, e.presente], futuro: e.futuro.slice(1), sujo: true };
    }
  }
}

export default function MapaScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [estado, dispatch] = useReducer(reduzir, {
    presente: inputVazio(),
    passado: [],
    futuro: [],
    sujo: false,
  });
  const input = estado.presente;

  const { data: mapas } = useQuery({ queryKey: ["mapas"], queryFn: listarMapas });

  const { data: mapaCarregado } = useQuery({
    queryKey: ["mapa", selecionado],
    queryFn: () => getMapa(selecionado as number),
    enabled: selecionado !== null,
  });
  useEffect(() => {
    if (mapaCarregado) dispatch({ tipo: "set", input: mapaParaInput(mapaCarregado) });
  }, [mapaCarregado]);

  // seleciona o primeiro mapa quando a lista chega e nada está selecionado
  useEffect(() => {
    if (selecionado === null && mapas && mapas.length > 0) setSelecionado(mapas[0].id);
  }, [mapas, selecionado]);

  // auto-save debounced (só quando há edição real — sujo)
  const salvar = useMutation({
    mutationFn: (p: { id: number; input: MapaInput }) => atualizarMapa(p.id, p.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mapas"] }),
    onError: (e) => toast.erro(String(e)),
  });
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    if (selecionado === null || !estado.sujo) return;
    const t = setTimeout(() => salvarRef.current.mutate({ id: selecionado, input }), 500);
    return () => clearTimeout(t);
  }, [input, selecionado, estado.sujo]);

  // atalhos undo/redo
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        dispatch(ev.shiftKey ? { tipo: "redo" } : { tipo: "undo" });
      } else if (ctrl && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        dispatch({ tipo: "redo" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const editar = useCallback(
    (patch: Partial<MapaInput>) => {
      dispatch({ tipo: "editar", input: { ...estado.presente, ...patch } });
    },
    [estado.presente],
  );

  const criar = useMutation({
    mutationFn: () => criarMapa(inputVazio()),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["mapas"] });
      setSelecionado(m.id);
      toast.sucesso("Mapa criado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  return (
    <div className="grid h-full grid-cols-[220px_1fr_minmax(280px,380px)] gap-4 p-4">
      <ListaMapas
        mapas={mapas ?? []}
        selecionado={selecionado}
        onSelecionar={setSelecionado}
        onNovo={() => criar.mutate()}
        onMudou={() => qc.invalidateQueries({ queryKey: ["mapas"] })}
        onExcluiuSelecionado={() => setSelecionado(null)}
      />
      <div className="min-w-0 space-y-4 overflow-auto">
        <CamposMapa input={input} onEditar={editar} />
        <GradeEditor input={input} onEditar={editar} />
      </div>
      <PreviewMapa input={input} />
    </div>
  );
}
```

- [ ] **Step 2: Checkpoint** — `npm run build` → sem erros.

---

### Task B8: Rota + item na sidebar + verificação no app

**Files:**
- Modify: `src/App.tsx` (import + rota)
- Modify: `src/components/Sidebar.tsx` (item `mapa` ganha `to`)

- [ ] **Step 1: Adicionar a rota** em `src/App.tsx` — o import junto aos outros e a `<Route>` dentro do `<AppShell />`:
```tsx
import MapaScreen from "./features/mapa/MapaScreen";
```
```tsx
        <Route path="/batalha" element={<BatalhaScreen />} />
        <Route path="/mapa" element={<MapaScreen />} />
```

- [ ] **Step 2: Ativar o item na sidebar** — em `src/components/Sidebar.tsx`, trocar a linha do item `mapa` (hoje sem `to`) por:
```tsx
  { id: "mapa", label: "Mapa", icon: IconMapa, to: "/mapa" },
```

- [ ] **Step 3: Checkpoint de build**

Run: `npm run build`
Expected: type-check + build sem erros.

- [ ] **Step 4: Verificação no app rodando** (a verificação de UI de vocês)

Run: `npm run tauri dev`
Na janela do app, confira:
- [ ] Sidebar mostra "Mapa" **ativo** (sem "em breve"); clicar abre `/mapa`.
- [ ] "+ Novo mapa" cria e seleciona um mapa; ele aparece na lista.
- [ ] Escolher `X` na paleta e clicar/arrastar na grade pinta as células (verde). Trocar pra `~` pinta azul. Digitar uma letra no campo de ponto de interesse e pintar mostra a letra em destaque.
- [ ] Mudar **col**/**lin** redimensiona a grade preservando o desenho.
- [ ] Editar Título/Ordem/Legenda/Efeito reflete no **Preview** ao vivo.
- [ ] Trocar de mapa e voltar: as edições persistiram (auto-save ~0,5s). Recarregar o app mantém o mapa salvo.
- [ ] **Ctrl+Z** desfaz a última pintura; **Ctrl+Shift+Z**/**Ctrl+Y** refaz.
- [ ] "Duplicar" cria "(cópia)"; "Excluir" pede confirmação e remove.
- [ ] "Copiar pro Discord" → colar num editor de texto → título, grade alinhada dentro de ``` e Ordem/Legenda/Efeito embaixo. "Ver texto" mostra a mesma string; mapa grande (26×50 cheio) dispara o aviso de +2000.

Reproduzir o print "Floresta de Noite" (X = árvores) e comparar com a referência da spec.

---

## Self-review (feito ao escrever)

**Cobertura da spec (§8 UI):** tela `/mapa` (B8) ✓; biblioteca criar/duplicar/apagar/selecionar (B5) ✓; grade clicável + paleta + resize + arraste (B4) ✓; campos Título/Ordem/Legenda/Efeito (B3) ✓; preview ao vivo + "ver texto" + Copiar com aviso 2000 (B6) ✓; auto-save debounced (B7) ✓; undo/redo (B7) ✓; render é sempre a do Rust via `renderMapaDiscord` (B6, fonte única) ✓; rota + sidebar (B8) ✓.
**Consistência de tipos:** `MapaInput`/`Mapa`/`MapaResumo` em `types.ts` ↔ `api.ts` ↔ componentes; `onEditar(patch: Partial<MapaInput>)` uniforme em CamposMapa/GradeEditor; `renderMapaDiscord(input)` recebe `MapaInput`.
**Sem placeholders / imports limpos:** todo componente tem código completo; imports de tipo com `import type`; sem variável/import não-usado; sem `import React`.
**Riscos conhecidos (aceitos p/ v1):** clicar num mapa pode reordenar a lista se um auto-save disparar (mitigado pelo flag `sujo` — load não salva); pintura por arraste gera 1 entrada de undo por célula.
```
