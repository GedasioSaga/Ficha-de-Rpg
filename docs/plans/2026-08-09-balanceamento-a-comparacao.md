# Plano A — Balanceamento: comparação determinística

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **REGRA DO PROJETO: SEM GIT.** Nenhum passo de commit. Verificação = testes + build.

**Goal:** Tela "Balanceamento" na sidebar comparando 2+ personagens lado a lado (8 atributos com rank, HP/SP/escudo, contagens), sem IA.

**Architecture:** Feature nova `src/features/balanceamento/` seguindo o padrão das telas existentes (React Query + bindings de `src/lib/api.ts`). Lógica de destaque/barras em funções puras (`logica.ts`) testadas com vitest. Zero mudança no Rust.

**Tech Stack:** React 19 + TS, React Query v5 (`useQuery`/`useQueries`), Tailwind v4, vitest. Sem dependência nova.

**Spec:** `docs/specs/2026-08-09-balanceamento-comparacao-ia.md` (§4)

---

### Task 1: Lógica pura de comparação (`logica.ts`)

**Files:**
- Create: `src/features/balanceamento/logica.ts`
- Test: `src/features/balanceamento/logica.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// src/features/balanceamento/logica.test.ts
import { describe, expect, test } from "vitest";
import { extremosLinha, larguraBarra, somaAtributos } from "./logica";

describe("extremosLinha", () => {
  test("destaca maior e menor", () => {
    const r = extremosLinha([8, 3, 5]);
    expect(r.maiores).toEqual(new Set([0]));
    expect(r.menores).toEqual(new Set([1]));
  });

  test("empate no maior destaca ambos", () => {
    const r = extremosLinha([8, 8, 5]);
    expect(r.maiores).toEqual(new Set([0, 1]));
    expect(r.menores).toEqual(new Set([2]));
  });

  test("linha uniforme não destaca nada", () => {
    const r = extremosLinha([5, 5, 5]);
    expect(r.maiores.size).toBe(0);
    expect(r.menores.size).toBe(0);
  });

  test("menos de 2 valores não destaca", () => {
    expect(extremosLinha([7]).maiores.size).toBe(0);
    expect(extremosLinha([]).menores.size).toBe(0);
  });
});

describe("somaAtributos", () => {
  test("soma os valores", () => {
    expect(somaAtributos([{ valor: 3 }, { valor: 4 }])).toBe(7);
  });

  test("lista vazia soma 0", () => {
    expect(somaAtributos([])).toBe(0);
  });
});

describe("larguraBarra", () => {
  test("proporcional ao máximo da linha", () => {
    expect(larguraBarra(5, 10)).toBe(50);
  });

  test("valor pequeno mas positivo tem largura mínima 4", () => {
    expect(larguraBarra(1, 100)).toBe(4);
  });

  test("valor 0 tem barra 0 (não desenha)", () => {
    expect(larguraBarra(0, 10)).toBe(0);
  });

  test("máximo 0 ou negativo vira 0 (sem divisão por zero)", () => {
    expect(larguraBarra(5, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/balanceamento/logica.test.ts`
Expected: FAIL — `Cannot find module './logica'` (ou equivalente).

- [ ] **Step 3: Implementar**

```ts
// src/features/balanceamento/logica.ts
/** Índices (por coluna) dos maiores e menores valores de uma linha da tabela. */
export interface Extremos {
  maiores: Set<number>;
  menores: Set<number>;
}

/** Linha uniforme ou com <2 valores não destaca nada — destaque só faz sentido com contraste. */
export function extremosLinha(valores: number[]): Extremos {
  const vazio: Extremos = { maiores: new Set(), menores: new Set() };
  if (valores.length < 2) return vazio;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  if (max === min) return vazio;
  const maiores = new Set<number>();
  const menores = new Set<number>();
  valores.forEach((v, i) => {
    if (v === max) maiores.add(i);
    if (v === min) menores.add(i);
  });
  return { maiores, menores };
}

/** Soma bruta dos 8 atributos — referência rápida, não é métrica oficial do sistema. */
export function somaAtributos(atributos: { valor: number }[]): number {
  return atributos.reduce((acc, a) => acc + a.valor, 0);
}

/** Largura (%) da barra proporcional ao máximo da linha; mínimo 4% pra ficar visível. */
export function larguraBarra(valor: number, maxLinha: number): number {
  if (valor <= 0 || maxLinha <= 0) return 0;
  return Math.max(4, Math.round((valor / maxLinha) * 100));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/balanceamento/logica.test.ts`
Expected: PASS (10 testes).

---

### Task 2: Ícone + rota + sidebar + tela esqueleto

**Files:**
- Modify: `src/components/icons.tsx` (adicionar ícone no fim do arquivo)
- Modify: `src/components/Sidebar.tsx:21-26` (array `ITENS`)
- Modify: `src/App.tsx` (import + rota)
- Create: `src/features/balanceamento/BalanceamentoScreen.tsx`

- [ ] **Step 1: Ícone (balança) no fim de `icons.tsx`**

```tsx
/** Balanceamento — balança. */
export function IconBalanceamento(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v16" />
      <path d="M6 7h12" />
      <path d="M6 7l-2.5 5.5a2.9 2.9 0 0 0 5 0L6 7Z" />
      <path d="M18 7l-2.5 5.5a2.9 2.9 0 0 0 5 0L18 7Z" />
      <path d="M8.5 20h7" />
    </Icon>
  );
}
```

- [ ] **Step 2: Tela esqueleto**

```tsx
// src/features/balanceamento/BalanceamentoScreen.tsx
export default function BalanceamentoScreen() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Balanceamento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Selecione dois ou mais personagens pra comparar atributos, pools e habilidades.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rota em `App.tsx`**

Import junto aos demais:

```tsx
import BalanceamentoScreen from "./features/balanceamento/BalanceamentoScreen";
```

Rota dentro do `<Route element={<AppShell />}>`, depois de `/compendio`:

```tsx
<Route path="/balanceamento" element={<BalanceamentoScreen />} />
```

- [ ] **Step 4: Item na sidebar**

Em `Sidebar.tsx`, adicionar `IconBalanceamento` ao import de `./icons` e ao array `ITENS` (depois de `compendio`):

```tsx
{ id: "balanceamento", label: "Balanceamento", icon: IconBalanceamento, to: "/balanceamento" },
```

- [ ] **Step 5: Verificar**

Run: `npm run build`
Expected: sem erro de TS/vite.
Run: `npm run tauri dev` → clicar "Balanceamento" na sidebar.
Expected: tela abre com título e subtítulo; item marca ativo (indigo).

---

### Task 3: Seletor de personagens

**Files:**
- Create: `src/features/balanceamento/SeletorPersonagens.tsx`
- Modify: `src/features/balanceamento/BalanceamentoScreen.tsx`

- [ ] **Step 1: Componente seletor**

```tsx
// src/features/balanceamento/SeletorPersonagens.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarEtiquetas, listarPersonagens } from "../../lib/api";
import type { PersonagemResumo } from "../../lib/types";

interface Props {
  selecionados: number[];
  onAlternar: (id: number) => void;
}

export default function SeletorPersonagens({ selecionados, onAlternar }: Props) {
  const [busca, setBusca] = useState("");
  const [etiqueta, setEtiqueta] = useState("");

  const { data: personagens = [] } = useQuery({
    // Mesma chave de BatalhaScreen (mesma chamada) — reaproveita o cache.
    queryKey: ["personagens", null],
    queryFn: () => listarPersonagens(null),
  });
  const { data: etiquetas = [] } = useQuery({
    queryKey: ["etiquetas"],
    queryFn: listarEtiquetas,
  });

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return personagens.filter((p: PersonagemResumo) => {
      if (q && !p.nome.toLowerCase().includes(q)) return false;
      if (etiqueta && !p.etiquetas.includes(etiqueta)) return false;
      return true;
    });
  }, [personagens, busca, etiqueta]);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Personagens
      </h2>
      <div className="flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome…"
          className="h-9 flex-1 min-w-40 rounded-lg border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          className="h-9 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-sm text-slate-300 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas as etiquetas</option>
          {etiquetas.map((et) => (
            <option key={et.id} value={et.nome}>
              {et.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
        {filtrados.map((p) => {
          const ativo = selecionados.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onAlternar(p.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                ativo
                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                  : "border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              {p.nome}
              <span className="ml-1.5 text-[10px] uppercase text-slate-500">
                {p.tipo === "npc" ? "NPC" : "PJ"}
              </span>
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <p className="text-sm text-slate-600">Nenhum personagem encontrado.</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Ligar na tela (estado de seleção)**

```tsx
// src/features/balanceamento/BalanceamentoScreen.tsx (substituir o arquivo)
import { useState } from "react";
import SeletorPersonagens from "./SeletorPersonagens";

export default function BalanceamentoScreen() {
  const [selecionados, setSelecionados] = useState<number[]>([]);

  function alternar(id: number) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id],
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Balanceamento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Selecione dois ou mais personagens pra comparar atributos, pools e habilidades.
        </p>
      </div>
      <SeletorPersonagens selecionados={selecionados} onAlternar={alternar} />
      {selecionados.length < 2 && (
        <p className="text-sm text-slate-600">
          Selecione pelo menos 2 personagens pra ver a comparação.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar**

Run: `npm run build` → Expected: sem erro.
Manual (`npm run tauri dev`): busca filtra; etiqueta filtra; clique alterna chip (indigo quando ativo); aviso "pelo menos 2" some só de mostrar a tabela na Task 4 (por ora sempre visível com <2).

---

### Task 4: Tabela de comparação

**Files:**
- Create: `src/features/balanceamento/TabelaComparacao.tsx`
- Modify: `src/features/balanceamento/BalanceamentoScreen.tsx`

- [ ] **Step 1: Componente da tabela**

```tsx
// src/features/balanceamento/TabelaComparacao.tsx
import { useQueries } from "@tanstack/react-query";
import { getPersonagem } from "../../lib/api";
import type { PersonagemCompleto } from "../../lib/types";
import { extremosLinha, larguraBarra, somaAtributos } from "./logica";

/** Linha genérica: rótulo + um valor por personagem, com destaque e barra opcional. */
function Linha({
  rotulo,
  valores,
  sufixos,
  comBarra,
}: {
  rotulo: string;
  valores: number[];
  /** Texto pequeno ao lado do valor (ex.: rank) — mesmo índice das colunas. */
  sufixos?: string[];
  comBarra?: boolean;
}) {
  const ext = extremosLinha(valores);
  const max = Math.max(...valores, 0);
  return (
    <tr className="border-t border-slate-800/60">
      <th
        scope="row"
        className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {rotulo}
      </th>
      {valores.map((v, i) => (
        <td key={i} className="px-3 py-2 align-middle">
          <div
            className={`text-sm tabular-nums ${
              ext.maiores.has(i)
                ? "font-semibold text-emerald-300"
                : ext.menores.has(i)
                  ? "text-rose-400"
                  : "text-slate-200"
            }`}
          >
            {v}
            {sufixos?.[i] && (
              <span className="ml-1.5 text-[10px] text-slate-500">{sufixos[i]}</span>
            )}
          </div>
          {comBarra && (
            <div className="mt-1 h-1 w-full rounded bg-slate-800">
              <div
                className="h-1 rounded bg-indigo-500"
                style={{ width: `${larguraBarra(v, max)}%` }}
              />
            </div>
          )}
        </td>
      ))}
    </tr>
  );
}

export default function TabelaComparacao({ ids }: { ids: number[] }) {
  const consultas = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["personagem", id],
      queryFn: () => getPersonagem(id),
    })),
  });

  const erro = consultas.find((c) => c.error);
  if (erro) {
    return (
      <p className="text-sm text-rose-400">
        Erro ao carregar ficha: {String(erro.error)}
      </p>
    );
  }
  if (consultas.some((c) => !c.data)) {
    return <p className="text-sm text-slate-500">Carregando fichas…</p>;
  }

  const fichas = consultas.map((c) => c.data as PersonagemCompleto);
  // Ordem das linhas de atributo = ordem do primeiro personagem (backend é consistente).
  const nomesAtributos = fichas[0].atributos.map((a) => a.nome);
  const valorDe = (f: PersonagemCompleto, nome: string) =>
    f.atributos.find((a) => a.nome === nome);

  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr>
            <th className="pb-2 pr-4" />
            {fichas.map((f) => (
              <th
                key={f.id}
                className="px-3 pb-2 text-left text-sm font-semibold text-slate-100"
              >
                {f.nome}
                <span className="ml-1.5 text-[10px] font-normal uppercase text-slate-500">
                  {f.tipo === "npc" ? "NPC" : "PJ"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nomesAtributos.map((nome) => (
            <Linha
              key={nome}
              rotulo={nome}
              valores={fichas.map((f) => valorDe(f, nome)?.valor ?? 0)}
              sufixos={fichas.map((f) => {
                const a = valorDe(f, nome);
                return a ? `R${a.rank}` : "";
              })}
              comBarra
            />
          ))}
          <Linha
            rotulo="Total atributos"
            valores={fichas.map((f) => somaAtributos(f.atributos))}
          />
          <Linha rotulo="HP" valores={fichas.map((f) => f.hp)} comBarra />
          <Linha rotulo="SP" valores={fichas.map((f) => f.sp)} comBarra />
          <Linha rotulo="Escudo" valores={fichas.map((f) => f.escudo)} />
          <Linha
            rotulo="Habilidades"
            valores={fichas.map((f) => f.habilidades.length)}
          />
          <Linha
            rotulo="Transformações"
            valores={fichas.map((f) => f.transformacoes.length)}
          />
          <Linha rotulo="Perícias" valores={fichas.map((f) => f.pericias.length)} />
          <Linha rotulo="Vantagens" valores={fichas.map((f) => f.vantagens.length)} />
          <Linha
            rotulo="Desvantagens"
            valores={fichas.map((f) => f.desvantagens.length)}
          />
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-slate-600">
        Verde = melhor da linha · vermelho = pior · R = rank (0–13) · total é soma
        bruta, não métrica oficial.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Renderizar na tela quando ≥2 selecionados**

Em `BalanceamentoScreen.tsx`, adicionar o import e trocar o bloco final do JSX:

```tsx
import TabelaComparacao from "./TabelaComparacao";
```

```tsx
      <SeletorPersonagens selecionados={selecionados} onAlternar={alternar} />
      {selecionados.length < 2 ? (
        <p className="text-sm text-slate-600">
          Selecione pelo menos 2 personagens pra ver a comparação.
        </p>
      ) : (
        <TabelaComparacao ids={selecionados} />
      )}
```

- [ ] **Step 3: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 5: Verificação final da fatia

- [ ] **Step 1: Testes**

Run: `npm test`
Expected: todos passam (incluindo os 10 de `logica.test.ts` e os testes pré-existentes de mapa).

- [ ] **Step 2: Build completo**

Run: `npm run build`
Expected: `tsc` + vite sem erro.

- [ ] **Step 3: Teste manual no app (`npm run tauri dev`)**

Checklist:
- Sidebar mostra "Balanceamento" com ícone de balança; colapsada mostra só o ícone.
- Selecionar 1 personagem → aviso "pelo menos 2".
- Selecionar 3 (misturar PJ e NPC) → tabela com 3 colunas.
- Cada linha de atributo: valor + `R<rank>`; melhor em verde, pior em vermelho; empate destaca os empatados; linha com todos iguais sem destaque.
- Barras proporcionais nas linhas de atributos/HP/SP.
- Personagem com escudo 0 → barra ausente na célula, valor `0` normal.
- Desmarcar personagem → coluna some na hora.

- [ ] **Step 4: Reportar resultado honesto**

O que passou, o que não foi testável, com evidência (saída de comando).
