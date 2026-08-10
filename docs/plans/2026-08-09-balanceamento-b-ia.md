# Plano B — Balanceamento: IA Gemini (análise + chat)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **REGRA DO PROJETO: SEM GIT.** Nenhum passo de commit. Verificação = testes + build.
> **Pré-requisito:** Plano A aplicado (tela Balanceamento existe).

**Goal:** Painel de IA na tela Balanceamento: botão "Analisar balanceamento" (relatório) + chat, com contexto = fichas selecionadas + notas de regras + catálogos; chaves Gemini com failover em 429.

**Architecture:** Cliente REST Gemini em `src/lib/gemini.ts` (fetch direto do webview; `fetch`/config injetáveis pra teste). Chaves na tabela `config` (SQLite) via comandos Tauri novos `config_get`/`config_set` (repositório Rust já existe). Render do relatório com parser markdown próprio (sem `innerHTML` — saída é estrutura React, imune a XSS).

**Tech Stack:** React 19 + TS, React Query v5, vitest; Rust: rusqlite (nada novo). API: `POST https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent`, header `x-goog-api-key` (confirmado via context7 em 2026-08-09). Modelo default `gemini-2.5-flash`, sobrescrevível por `config("gemini_modelo")`.

**Nota de cota:** rate limit do Gemini é **por projeto Google, não por chave** — o failover só ajuda porque as chaves do usuário são de projetos distintos.

**Spec:** `docs/specs/2026-08-09-balanceamento-comparacao-ia.md` (§5)

---

### Task 1: Expor `config_get`/`config_set` como comandos Tauri

**Files:**
- Modify: `src-tauri/src/db/repositorios.rs` (adicionar `mod tests_config` no fim, junto aos outros `#[cfg(test)]`)
- Modify: `src-tauri/src/lib.rs` (2 comandos + registro no `generate_handler!` da linha ~982)

- [ ] **Step 1: Teste de caracterização do repositório (funções já existem)**

No fim de `repositorios.rs`, seguindo o padrão de `tests_nota` (linha 1826):

```rust
#[cfg(test)]
mod tests_config {
    use super::*;
    use crate::db::connection::open_in_memory;

    #[test]
    fn roundtrip_e_ausente() {
        let conn = open_in_memory().unwrap();
        assert_eq!(config_get(&conn, "gemini_api_keys").unwrap(), None);
        config_set(&conn, "gemini_api_keys", "k1,k2").unwrap();
        assert_eq!(
            config_get(&conn, "gemini_api_keys").unwrap(),
            Some("k1,k2".to_string())
        );
        // upsert: mesma chave sobrescreve
        config_set(&conn, "gemini_api_keys", "k3").unwrap();
        assert_eq!(config_get(&conn, "gemini_api_keys").unwrap(), Some("k3".to_string()));
    }
}
```

- [ ] **Step 2: Rodar (deve passar — funções já existem; é cobertura de regressão)**

Run: `cargo test tests_config` (em `src-tauri/`)
Expected: `1 passed`.

- [ ] **Step 3: Comandos Tauri em `lib.rs`** (junto aos comandos de nota, ~linha 870)

```rust
// ---------- Config (KV — usado pela tela Balanceamento p/ chaves Gemini) ----------

#[tauri::command]
fn config_get(db: tauri::State<Db>, chave: String) -> Result<Option<String>, AppError> {
    let conn = db.conn()?;
    db::repositorios::config_get(&conn, &chave)
}

#[tauri::command]
fn config_set(db: tauri::State<Db>, chave: String, valor: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::config_set(&conn, &chave, &valor)
}
```

- [ ] **Step 4: Registrar no `generate_handler!`** (lib.rs:982, adicionar à lista)

```rust
config_get,
config_set,
```

- [ ] **Step 5: Verificar**

Run: `cargo build` (em `src-tauri/`)
Expected: compila sem erro (warning de nome igual ao do repositório não ocorre — chamada é qualificada `db::repositorios::config_get`).

---

### Task 2: Bindings TS de config

**Files:**
- Modify: `src/lib/api.ts` (fim do arquivo)

- [ ] **Step 1: Bindings**

```ts
/* --------------------------------- Config --------------------------------- */

export const configGet = (chave: string) =>
  invoke<string | null>("config_get", { chave });

export const configSet = (chave: string, valor: string) =>
  invoke<void>("config_set", { chave, valor });
```

- [ ] **Step 2: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 3: Cliente Gemini com failover (`src/lib/gemini.ts`) — TDD

**Files:**
- Create: `src/lib/gemini.ts`
- Test: `src/lib/gemini.test.ts`

- [ ] **Step 1: Testes (falhando)**

```ts
// src/lib/gemini.test.ts
import { describe, expect, test, vi } from "vitest";
import {
  ErroCotaEsgotada,
  ErroSemChave,
  extrairTexto,
  gerarConteudo,
  montarCorpo,
} from "./gemini";

/** Config fake em memória. */
function configFake(inicial: Record<string, string>) {
  const dados = { ...inicial };
  return {
    obterConfig: async (chave: string) => dados[chave] ?? null,
    gravarConfig: async (chave: string, valor: string) => {
      dados[chave] = valor;
    },
    dados,
  };
}

function respostaOk(texto: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
    { status: 200 },
  );
}

const resposta429 = () => new Response("quota", { status: 429 });

describe("montarCorpo", () => {
  test("inclui system_instruction e contents com roles", () => {
    const corpo = montarCorpo(
      [{ role: "user", texto: "oi" }, { role: "model", texto: "olá" }],
      { systemPrompt: "seja breve" },
    ) as Record<string, unknown>;
    expect(corpo).toEqual({
      system_instruction: { parts: [{ text: "seja breve" }] },
      contents: [
        { role: "user", parts: [{ text: "oi" }] },
        { role: "model", parts: [{ text: "olá" }] },
      ],
    });
  });

  test("responseSchema liga generationConfig JSON", () => {
    const schema = { type: "ARRAY", items: { type: "STRING" } };
    const corpo = montarCorpo([{ role: "user", texto: "x" }], {
      responseSchema: schema,
    }) as { generationConfig?: Record<string, unknown> };
    expect(corpo.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: schema,
    });
  });
});

describe("extrairTexto", () => {
  test("concatena parts do primeiro candidato", () => {
    expect(
      extrairTexto({
        candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
      }),
    ).toBe("ab");
  });

  test("resposta sem candidato vira erro legível", () => {
    expect(() => extrairTexto({})).toThrow(/resposta vazia/i);
  });
});

describe("gerarConteudo — failover", () => {
  test("sem chave configurada lança ErroSemChave", async () => {
    const cfg = configFake({});
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], {
        fetchFn: vi.fn(),
        ...cfg,
      }),
    ).rejects.toBeInstanceOf(ErroSemChave);
  });

  test("sucesso na primeira chave usa header x-goog-api-key", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("resp"));
    const r = await gerarConteudo([{ role: "user", texto: "x" }], {
      fetchFn,
      ...cfg,
    });
    expect(r).toBe("resp");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("/models/gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("k1");
  });

  test("429 na 1ª cai pra 2ª, persiste índice e avisa a UI", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2,k3" });
    const aoTrocarChave = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta429())
      .mockResolvedValueOnce(respostaOk("ok2"));
    const r = await gerarConteudo([{ role: "user", texto: "x" }], {
      fetchFn,
      aoTrocarChave,
      ...cfg,
    });
    expect(r).toBe("ok2");
    expect(fetchFn.mock.calls[1][1].headers["x-goog-api-key"]).toBe("k2");
    expect(cfg.dados.gemini_chave_ativa).toBe("1");
    expect(aoTrocarChave).toHaveBeenCalledWith(1);
  });

  test("começa da chave ativa persistida", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2,k3", gemini_chave_ativa: "2" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(fetchFn.mock.calls[0][1].headers["x-goog-api-key"]).toBe("k3");
  });

  test("todas em 429 lança ErroCotaEsgotada", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(resposta429());
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg }),
    ).rejects.toBeInstanceOf(ErroCotaEsgotada);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("erro não-429 propaga com status", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg }),
    ).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(1); // não faz failover em erro não-cota
  });

  test("modelo configurado substitui o default", async () => {
    const cfg = configFake({ gemini_api_keys: "k1", gemini_modelo: "gemini-3.5-flash" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(String(fetchFn.mock.calls[0][0])).toContain("gemini-3.5-flash");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/gemini.test.ts`
Expected: FAIL — módulo `./gemini` não existe.

- [ ] **Step 3: Implementar**

```ts
// src/lib/gemini.ts
import { configGet, configSet } from "./api";

/** Uma mensagem do histórico (formato da API Gemini: user/model). */
export interface MensagemIA {
  role: "user" | "model";
  texto: string;
}

export class ErroSemChave extends Error {
  constructor() {
    super("Nenhuma chave Gemini configurada.");
  }
}

export class ErroCotaEsgotada extends Error {
  constructor() {
    super("Cota esgotada em todas as chaves Gemini — tente mais tarde.");
  }
}

export const CONFIG_CHAVES = "gemini_api_keys";
export const CONFIG_ATIVA = "gemini_chave_ativa";
export const CONFIG_MODELO = "gemini_modelo";
export const MODELO_PADRAO = "gemini-2.5-flash";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface OpcoesGeracao {
  systemPrompt?: string;
  /** Schema REST (generationConfig.responseSchema) — força resposta JSON. */
  responseSchema?: unknown;
  /** Chamado quando o failover troca de chave (índice novo, 0-based) — a UI mostra toast. */
  aoTrocarChave?: (indice: number) => void;
  /** Injetáveis pra teste; default: fetch real e tabela config via Tauri. */
  fetchFn?: typeof fetch;
  obterConfig?: (chave: string) => Promise<string | null>;
  gravarConfig?: (chave: string, valor: string) => Promise<void>;
}

/** Corpo do POST generateContent — função pura, testável. */
export function montarCorpo(mensagens: MensagemIA[], opts: OpcoesGeracao = {}): unknown {
  const corpo: Record<string, unknown> = {
    contents: mensagens.map((m) => ({ role: m.role, parts: [{ text: m.texto }] })),
  };
  if (opts.systemPrompt) {
    corpo.system_instruction = { parts: [{ text: opts.systemPrompt }] };
  }
  if (opts.responseSchema) {
    corpo.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: opts.responseSchema,
    };
  }
  return corpo;
}

/** Texto do primeiro candidato — função pura, testável. */
export function extrairTexto(resposta: unknown): string {
  const parts = (resposta as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }).candidates?.[0]?.content?.parts;
  if (!parts?.length) throw new Error("Gemini: resposta vazia (sem candidatos).");
  return parts.map((p) => p.text ?? "").join("");
}

/**
 * Chama o Gemini com failover: começa na chave ativa; em 429 tenta a próxima
 * e persiste qual funcionou. Cota é por projeto Google — o failover pressupõe
 * chaves de projetos distintos.
 */
export async function gerarConteudo(
  mensagens: MensagemIA[],
  opts: OpcoesGeracao = {},
): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const obterConfig = opts.obterConfig ?? configGet;
  const gravarConfig = opts.gravarConfig ?? configSet;

  const csv = (await obterConfig(CONFIG_CHAVES)) ?? "";
  const chaves = csv.split(",").map((c) => c.trim()).filter(Boolean);
  if (chaves.length === 0) throw new ErroSemChave();

  const bruto = parseInt((await obterConfig(CONFIG_ATIVA)) ?? "0", 10);
  const inicio = Number.isFinite(bruto)
    ? Math.min(Math.max(bruto, 0), chaves.length - 1)
    : 0;
  const modelo = (await obterConfig(CONFIG_MODELO)) ?? MODELO_PADRAO;
  const corpo = JSON.stringify(montarCorpo(mensagens, opts));

  for (let tentativa = 0; tentativa < chaves.length; tentativa++) {
    const idx = (inicio + tentativa) % chaves.length;
    const r = await fetchFn(`${BASE_URL}/${modelo}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chaves[idx] },
      body: corpo,
    });
    if (r.status === 429) continue; // cota desta chave estourou: próxima
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${await r.text()}`);
    if (idx !== inicio) {
      await gravarConfig(CONFIG_ATIVA, String(idx));
      opts.aoTrocarChave?.(idx);
    }
    return extrairTexto(await r.json());
  }
  throw new ErroCotaEsgotada();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/gemini.test.ts`
Expected: PASS (12 testes).

---

### Task 4: Parser markdown seguro — TDD

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `src/components/Markdown.tsx`
- Test: `src/lib/markdown.test.ts`

- [ ] **Step 1: Testes (falhando)**

```ts
// src/lib/markdown.test.ts
import { describe, expect, test } from "vitest";
import { parseMarkdown, segmentar } from "./markdown";

describe("segmentar", () => {
  test("texto simples vira um segmento", () => {
    expect(segmentar("oi")).toEqual([{ texto: "oi", negrito: false }]);
  });

  test("**negrito** intercala segmentos", () => {
    expect(segmentar("a **b** c")).toEqual([
      { texto: "a ", negrito: false },
      { texto: "b", negrito: true },
      { texto: " c", negrito: false },
    ]);
  });

  test("asterisco solto não quebra", () => {
    expect(segmentar("2 * 3")).toEqual([{ texto: "2 * 3", negrito: false }]);
  });
});

describe("parseMarkdown", () => {
  test("títulos, itens e parágrafos", () => {
    const blocos = parseMarkdown("## Resumo\n\n- item um\n- item dois\n\ntexto final");
    expect(blocos).toEqual([
      { tipo: "titulo", nivel: 2, segmentos: [{ texto: "Resumo", negrito: false }] },
      { tipo: "item", segmentos: [{ texto: "item um", negrito: false }] },
      { tipo: "item", segmentos: [{ texto: "item dois", negrito: false }] },
      { tipo: "paragrafo", segmentos: [{ texto: "texto final", negrito: false }] },
    ]);
  });

  test("### vira nível 3; # vira nível 2 (não usamos h1)", () => {
    expect(parseMarkdown("### Sub")[0]).toMatchObject({ tipo: "titulo", nivel: 3 });
    expect(parseMarkdown("# Top")[0]).toMatchObject({ tipo: "titulo", nivel: 2 });
  });

  test("* também é marcador de item", () => {
    expect(parseMarkdown("* item")[0].tipo).toBe("item");
  });

  test("linhas vazias não geram bloco", () => {
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/markdown.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar parser**

```ts
// src/lib/markdown.ts
// Subconjunto de markdown que o Gemini usa em relatórios (títulos, listas,
// negrito). Saída é estrutura de dados — o render é 100% React, sem innerHTML.

export interface Segmento {
  texto: string;
  negrito: boolean;
}

export type Bloco =
  | { tipo: "titulo"; nivel: 2 | 3; segmentos: Segmento[] }
  | { tipo: "item"; segmentos: Segmento[] }
  | { tipo: "paragrafo"; segmentos: Segmento[] };

/** Divide uma linha em segmentos normais/negrito (delimitador `**`). */
export function segmentar(linha: string): Segmento[] {
  const partes = linha.split("**");
  // Sem par de ** (0 ou 1 delimitador): linha inteira é texto normal.
  if (partes.length < 3) return [{ texto: linha, negrito: false }];
  return partes
    .map((texto, i) => ({ texto, negrito: i % 2 === 1 }))
    .filter((s) => s.texto !== "");
}

export function parseMarkdown(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  for (const linhaCrua of texto.split("\n")) {
    const linha = linhaCrua.trim();
    if (!linha) continue;

    const titulo = linha.match(/^(#{1,3})\s+(.*)$/);
    if (titulo) {
      blocos.push({
        tipo: "titulo",
        nivel: titulo[1].length >= 3 ? 3 : 2,
        segmentos: segmentar(titulo[2]),
      });
      continue;
    }

    const item = linha.match(/^[-*]\s+(.*)$/);
    if (item) {
      blocos.push({ tipo: "item", segmentos: segmentar(item[1]) });
      continue;
    }

    blocos.push({ tipo: "paragrafo", segmentos: segmentar(linha) });
  }
  return blocos;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/markdown.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Componente de render**

```tsx
// src/components/Markdown.tsx
import { parseMarkdown, type Segmento } from "../lib/markdown";

function Trecho({ segmentos }: { segmentos: Segmento[] }) {
  return (
    <>
      {segmentos.map((s, i) =>
        s.negrito ? (
          <strong key={i} className="font-semibold text-slate-100">
            {s.texto}
          </strong>
        ) : (
          <span key={i}>{s.texto}</span>
        ),
      )}
    </>
  );
}

/** Render seguro do markdown do relatório — sem dangerouslySetInnerHTML. */
export default function Markdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-300">
      {parseMarkdown(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          return b.nivel === 2 ? (
            <h3 key={i} className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-200">
              <Trecho segmentos={b.segmentos} />
            </h3>
          ) : (
            <h4 key={i} className="pt-1 text-sm font-semibold text-slate-200">
              <Trecho segmentos={b.segmentos} />
            </h4>
          );
        }
        if (b.tipo === "item") {
          return (
            <p key={i} className="flex gap-2 pl-2">
              <span className="text-slate-600">•</span>
              <span>
                <Trecho segmentos={b.segmentos} />
              </span>
            </p>
          );
        }
        return (
          <p key={i}>
            <Trecho segmentos={b.segmentos} />
          </p>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 5: Contexto + prompts da análise

**Files:**
- Create: `src/features/balanceamento/prompts.ts`
- Test: `src/features/balanceamento/prompts.test.ts`

- [ ] **Step 1: Teste (falhando) — retratos não vão pro modelo**

```ts
// src/features/balanceamento/prompts.test.ts
import { describe, expect, test } from "vitest";
import { montarContextoTexto } from "./prompts";
import type { Catalogos, Nota, PersonagemCompleto } from "../../lib/types";

const ficha = {
  id: 1,
  tipo: "jogador",
  nome: "Luffy",
  descricao: "borracha",
  hp: 120,
  sp: 40,
  escudo: 0,
  retrato: "c:/img/luffy.png",
  atributos: [{ nome: "forca", valor: 8, rank: 5 }],
  habilidades: [],
  pericias: [],
  vantagens: [],
  desvantagens: [],
  transformacoes: [
    { nome: "Gear 2", descricao: "", retrato: "c:/img/g2.png", modificadores: [], habilidades: [] },
  ],
  etiquetas: [],
} as unknown as PersonagemCompleto;

const catalogos: Catalogos = { pericias: [], vantagens: [], desvantagens: [] };

describe("montarContextoTexto", () => {
  test("inclui nome/atributos e remove caminhos de retrato", () => {
    const ctx = montarContextoTexto([ficha], [], catalogos);
    expect(ctx).toContain("Luffy");
    expect(ctx).toContain("forca");
    expect(ctx).not.toContain("luffy.png");
    expect(ctx).not.toContain("g2.png");
  });

  test("inclui corpo das notas de regras", () => {
    const nota = { id: 1, titulo: "#mecânicas", corpo: "rank 13 é o teto", criado_em: "", atualizado_em: "" } as Nota;
    expect(montarContextoTexto([ficha], [nota], catalogos)).toContain("rank 13 é o teto");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/balanceamento/prompts.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// src/features/balanceamento/prompts.ts
import type { Catalogos, Nota, PersonagemCompleto } from "../../lib/types";

export const SYSTEM_PROMPT_ANALISE = `Você é o assistente de balanceamento de um RPG de mesa homebrew inspirado em One Piece. Responda sempre em português do Brasil.

O mestre vai te mandar: as regras do sistema (sincronizadas do Discord), os catálogos de perícias/vantagens/desvantagens e as fichas dos personagens a comparar (8 atributos com rank 0–13, HP/SP/escudo, habilidades com custo/dano/cooldown em texto livre, transformações, perícias, vantagens e desvantagens).

Sua análise deve, nesta ordem:
## Leitura por personagem — 2-3 frases sobre o papel e os pontos fortes/fracos de cada um.
## Desequilíbrios — compare os personagens entre si À LUZ DAS REGRAS fornecidas; aponte quem está acima/abaixo da curva e POR QUÊ (cite números das fichas).
## Sugestões — ajustes concretos e numéricos (ex.: "reduzir agilidade de 9 pra 7", "aumentar custo da habilidade X de 10 SP pra 15 SP"). Nada vago.

Se as regras não foram fornecidas, diga isso na primeira linha e analise só com o que há nas fichas.`;

/** Ficha sem os caminhos de retrato — inútil pro modelo e polui o contexto. */
function fichaEnxuta(p: PersonagemCompleto): unknown {
  const { retrato: _r, transformacoes, ...resto } = p;
  return {
    ...resto,
    transformacoes: transformacoes.map(({ retrato: _t, ...t }) => t),
  };
}

/** Texto único de contexto: regras + catálogos + fichas. Puro e testável. */
export function montarContextoTexto(
  fichas: PersonagemCompleto[],
  notasRegras: Nota[],
  catalogos: Catalogos,
): string {
  const regras =
    notasRegras.length > 0
      ? notasRegras.map((n) => `### ${n.titulo}\n${n.corpo}`).join("\n\n")
      : "(regras não sincronizadas)";
  return [
    "# REGRAS DO SISTEMA",
    regras,
    "# CATÁLOGOS",
    JSON.stringify(catalogos),
    "# FICHAS A COMPARAR",
    JSON.stringify(fichas.map(fichaEnxuta)),
  ].join("\n\n");
}

/** Chave em config com os títulos (JSON string[]) das notas que são regras. */
export const CONFIG_REGRAS_NOTAS = "regras_notas";
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/balanceamento/prompts.test.ts`
Expected: PASS (2 testes).

---

### Task 6: UI — ConfigChaves + PainelIA na tela

**Files:**
- Create: `src/features/balanceamento/ConfigChaves.tsx`
- Create: `src/features/balanceamento/PainelIA.tsx`
- Modify: `src/features/balanceamento/BalanceamentoScreen.tsx`

- [ ] **Step 1: ConfigChaves**

```tsx
// src/features/balanceamento/ConfigChaves.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configGet, configSet } from "../../lib/api";
import { CONFIG_ATIVA, CONFIG_CHAVES } from "../../lib/gemini";
import { useToast } from "../../components/Toast";

export default function ConfigChaves() {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const toast = useToast();
  const qc = useQueryClient();

  const { data: csv } = useQuery({
    queryKey: ["config", CONFIG_CHAVES],
    queryFn: () => configGet(CONFIG_CHAVES),
  });
  const { data: ativa } = useQuery({
    queryKey: ["config", CONFIG_ATIVA],
    queryFn: () => configGet(CONFIG_ATIVA),
  });

  const total = (csv ?? "").split(",").filter((c) => c.trim()).length;

  const salvarMut = useMutation({
    mutationFn: async (valor: string) => {
      const limpo = valor
        .split(/[\s,]+/)
        .map((c) => c.trim())
        .filter(Boolean)
        .join(",");
      if (!limpo) throw new Error("Cole ao menos uma chave.");
      await configSet(CONFIG_CHAVES, limpo);
      await configSet(CONFIG_ATIVA, "0");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      setTexto("");
      setAberto(false);
      toast.sucesso("Chaves salvas.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between text-left text-sm text-slate-400 hover:text-slate-200"
      >
        <span>
          Chaves Gemini:{" "}
          {total > 0 ? (
            <span className="text-slate-200">
              {total} configurada{total > 1 ? "s" : ""} · ativa #{Number(ativa ?? "0") + 1}
            </span>
          ) : (
            <span className="text-amber-400">nenhuma configurada</span>
          )}
        </span>
        <span className="text-xs">{aberto ? "fechar" : "configurar"}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="Cole as chaves separadas por vírgula ou quebra de linha…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
          />
          <p className="text-[11px] text-slate-600">
            Ficam só no banco local. Cota do Gemini é por projeto Google — o failover
            pressupõe chaves de projetos distintos. Rotacionar várias chaves free
            pra estender cota vai contra os ToS do Google (risco: banimento).
          </p>
          <button
            type="button"
            disabled={salvarMut.isPending}
            onClick={() => salvarMut.mutate(texto)}
            className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
          >
            {salvarMut.isPending ? "Salvando…" : "Salvar chaves"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: PainelIA**

```tsx
// src/features/balanceamento/PainelIA.tsx
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { configGet, getNota, listarCatalogos, listarNotas, getPersonagem } from "../../lib/api";
import { ErroSemChave, gerarConteudo, type MensagemIA } from "../../lib/gemini";
import type { Nota, PersonagemCompleto } from "../../lib/types";
import Markdown from "../../components/Markdown";
import { useToast } from "../../components/Toast";
import { CONFIG_REGRAS_NOTAS, montarContextoTexto, SYSTEM_PROMPT_ANALISE } from "./prompts";
import ConfigChaves from "./ConfigChaves";

export default function PainelIA({ ids }: { ids: number[] }) {
  const [historico, setHistorico] = useState<MensagemIA[]>([]);
  const [pergunta, setPergunta] = useState("");
  const toast = useToast();

  const fichasQ = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["personagem", id],
      queryFn: () => getPersonagem(id),
    })),
  });
  const { data: catalogos } = useQuery({
    queryKey: ["catalogos"],
    queryFn: listarCatalogos,
  });
  const { data: titulosRegras } = useQuery({
    queryKey: ["config", CONFIG_REGRAS_NOTAS],
    queryFn: async () => {
      const bruto = await configGet(CONFIG_REGRAS_NOTAS);
      try {
        return bruto ? (JSON.parse(bruto) as string[]) : [];
      } catch {
        return [];
      }
    },
  });
  const { data: notasRegras = [] } = useQuery({
    queryKey: ["notas", "regras", titulosRegras],
    enabled: titulosRegras !== undefined,
    queryFn: async (): Promise<Nota[]> => {
      if (!titulosRegras?.length) return [];
      const resumos = await listarNotas();
      const alvo = resumos.filter((r) => titulosRegras.includes(r.titulo));
      return Promise.all(alvo.map((r) => getNota(r.id)));
    },
  });

  const prontas =
    fichasQ.every((f) => f.data) && catalogos && titulosRegras !== undefined;

  function contexto(): string {
    const fichas = fichasQ.map((f) => f.data as PersonagemCompleto);
    return montarContextoTexto(fichas, notasRegras, catalogos!);
  }

  const qc = useQueryClient();
  const chamarMut = useMutation({
    mutationFn: (mensagens: MensagemIA[]) =>
      gerarConteudo(mensagens, {
        systemPrompt: SYSTEM_PROMPT_ANALISE,
        aoTrocarChave: (i) => {
          toast.sucesso(`Chave anterior esgotou — usando a chave ${i + 1}.`);
          qc.invalidateQueries({ queryKey: ["config"] });
        },
      }),
    onError: (e) => {
      if (e instanceof ErroSemChave) toast.erro("Configure as chaves Gemini acima.");
      else toast.erro(String(e));
    },
  });

  function analisar() {
    const mensagens: MensagemIA[] = [
      { role: "user", texto: `${contexto()}\n\nAnalise o balanceamento desses personagens.` },
    ];
    chamarMut.mutate(mensagens, {
      onSuccess: (resposta) =>
        setHistorico([...mensagens, { role: "model", texto: resposta }]),
    });
  }

  function perguntar() {
    const p = pergunta.trim();
    if (!p) return;
    const mensagens: MensagemIA[] = [...historico, { role: "user", texto: p }];
    setPergunta("");
    chamarMut.mutate(mensagens, {
      onSuccess: (resposta) =>
        setHistorico([...mensagens, { role: "model", texto: resposta }]),
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Análise com IA
      </h2>
      <ConfigChaves />
      {(titulosRegras?.length ?? 0) === 0 && (
        <p className="text-[11px] text-amber-400/80">
          Regras do Discord ainda não sincronizadas — a análise vai usar só fichas e
          catálogos.
        </p>
      )}
      <button
        type="button"
        disabled={!prontas || chamarMut.isPending}
        onClick={analisar}
        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
      >
        {chamarMut.isPending && historico.length === 0
          ? "Analisando…"
          : "Analisar balanceamento"}
      </button>

      {historico.length > 0 && (
        <div className="space-y-3">
          {historico.slice(1).map((m, i) =>
            m.role === "model" ? (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <Markdown texto={m.texto} />
              </div>
            ) : (
              <p key={i} className="pl-4 text-sm italic text-slate-400">
                Você: {m.texto}
              </p>
            ),
          )}
          {/* histórico[0] é o contexto gigante — nunca renderizar */}
          <div className="flex gap-2">
            <input
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chamarMut.isPending && perguntar()}
              placeholder='Pergunte algo ("e se eu subir a agilidade do Zoro?")…'
              className="h-9 flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={chamarMut.isPending || !pergunta.trim()}
              onClick={perguntar}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {chamarMut.isPending ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Ligar na tela**

Em `BalanceamentoScreen.tsx`, import + render depois da tabela:

```tsx
import PainelIA from "./PainelIA";
```

```tsx
      ) : (
        <>
          <TabelaComparacao ids={selecionados} />
          <PainelIA ids={selecionados} />
        </>
      )}
```

- [ ] **Step 4: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 7: Verificação final da fatia

- [ ] **Step 1: Testes**

Run: `npm test` → Expected: todos passam (logica, gemini, markdown, prompts, mapa).

- [ ] **Step 2: Builds**

Run: `cargo build` (em `src-tauri/`) e `npm run build` → Expected: sem erro.

- [ ] **Step 3: Teste manual (`npm run tauri dev`)** — usuário cola as chaves reais

Checklist:
- Sem chave: painel avisa "nenhuma configurada"; Analisar → toast pedindo configuração.
- Colar as chaves (vírgula ou quebra de linha) → "N configuradas · ativa #1"; persistem após fechar/reabrir o app (estão na tabela `config`).
- Selecionar 2+ personagens → Analisar → relatório em PT-BR com seções Leitura/Desequilíbrios/Sugestões renderizadas (títulos, listas, negrito).
- Aviso âmbar de "regras não sincronizadas" aparece (Fatia C ainda não rodou).
- Chat: pergunta de acompanhamento responde referenciando os personagens da análise.
- Derrubar a rede → Analisar → toast de erro, botão volta a habilitar.

- [ ] **Step 4: Reportar resultado honesto**

O que passou, o que não foi testável, com evidência (saída de comando).

---

# ADENDA 2026-08-09 — IA na criação/edição de ficha (pedido do usuário mid-execução)

Muda as Tasks 5 e 6 e adiciona a Task 6b. Tasks 1-4 não mudam. Spec atualizada em §5 ("IA na criação/edição de ficha").

## Delta na Task 5 (prompts.ts)

`montarContextoTexto` passa a receber `FichaParaContexto[]` (tipo neutro) em vez de `PersonagemCompleto[]`; conversores puros fazem a ponte. `fichaEnxuta` some (conversores já limpam retrato/uid). Dois system prompts.

```ts
// src/features/balanceamento/prompts.ts (substitui a versão da Task 5 original)
import type {
  Catalogos,
  HabilidadeDto,
  ModificadorDto,
  Nota,
  PericiaDto,
  PersonagemCompleto,
  PersonagemInput,
  Tipo,
  TracoDto,
} from "../../lib/types";

/** Ficha no formato neutro que vira contexto da IA — vale pra ficha salva OU form. */
export interface FichaParaContexto {
  tipo: Tipo;
  nome: string;
  descricao: string;
  hp: number;
  sp: number;
  escudo: number;
  /** `rank` ausente quando a ficha vem do form (não salva) — a IA infere pelas regras. */
  atributos: { nome: string; valor: number; rank?: number }[];
  habilidades: HabilidadeDto[];
  pericias: PericiaDto[];
  vantagens: TracoDto[];
  desvantagens: TracoDto[];
  transformacoes: {
    nome: string;
    descricao: string;
    modificadores: ModificadorDto[];
    habilidades: HabilidadeDto[];
  }[];
}

/** Remove a chave client-only de render (`uid`) — ruído pro modelo. */
function semUid<T extends { uid?: string }>(lista: T[]): Omit<T, "uid">[] {
  return lista.map(({ uid: _u, ...resto }) => resto);
}

export function dePersonagemCompleto(p: PersonagemCompleto): FichaParaContexto {
  return {
    tipo: p.tipo,
    nome: p.nome,
    descricao: p.descricao,
    hp: p.hp,
    sp: p.sp,
    escudo: p.escudo,
    atributos: p.atributos.map(({ nome, valor, rank }) => ({ nome, valor, rank })),
    habilidades: p.habilidades,
    pericias: p.pericias,
    vantagens: p.vantagens,
    desvantagens: p.desvantagens,
    transformacoes: p.transformacoes.map(({ retrato: _r, ...t }) => t),
  };
}

const ATRIBUTOS_INPUT = [
  "forca",
  "agilidade",
  "percepcao",
  "resistencia",
  "intuicao",
  "espirito",
  "carisma",
  "determinacao",
] as const;

export function dePersonagemInput(input: PersonagemInput): FichaParaContexto {
  return {
    tipo: input.tipo,
    nome: input.nome || "(sem nome)",
    descricao: input.descricao,
    hp: input.hp,
    sp: input.sp,
    escudo: input.escudo,
    atributos: ATRIBUTOS_INPUT.map((nome) => ({ nome, valor: input[nome] })),
    habilidades: semUid(input.habilidades),
    pericias: semUid(input.pericias),
    vantagens: semUid(input.vantagens),
    desvantagens: semUid(input.desvantagens),
    transformacoes: input.transformacoes.map((t) => ({
      nome: t.nome,
      descricao: t.descricao,
      modificadores: semUid(t.modificadores),
      habilidades: semUid(t.habilidades),
    })),
  };
}

const CABECALHO_SYSTEM = `Você é o assistente de balanceamento de um RPG de mesa homebrew inspirado em One Piece. Responda sempre em português do Brasil.

O mestre vai te mandar: as regras do sistema (sincronizadas do Discord), os catálogos de perícias/vantagens/desvantagens e ficha(s) de personagem (8 atributos com rank 0–13, HP/SP/escudo, habilidades com custo/dano/cooldown em texto livre, transformações, perícias, vantagens e desvantagens).

Se as regras não foram fornecidas, diga isso na primeira linha e analise só com o que há nas fichas.`;

export const SYSTEM_PROMPT_ANALISE = `${CABECALHO_SYSTEM}

Sua análise comparativa deve, nesta ordem:
## Leitura por personagem — 2-3 frases sobre o papel e os pontos fortes/fracos de cada um.
## Desequilíbrios — compare os personagens entre si À LUZ DAS REGRAS fornecidas; aponte quem está acima/abaixo da curva e POR QUÊ (cite números das fichas).
## Sugestões — ajustes concretos e numéricos (ex.: "reduzir agilidade de 9 pra 7", "aumentar custo da habilidade X de 10 SP pra 15 SP"). Nada vago.`;

export const SYSTEM_PROMPT_FICHA = `${CABECALHO_SYSTEM}

É UMA ficha só (pode estar em criação, incompleta). Sua análise deve, nesta ordem:
## Leitura — papel e identidade mecânica da ficha em 2-3 frases.
## Equilíbrio — está acima/abaixo da curva do sistema À LUZ DAS REGRAS? Cite números.
## Sugestões — ajustes concretos e numéricos; se algo essencial está faltando (ex.: sem habilidades), aponte.`;

/** Prompt certo pro tamanho da seleção: 1 ficha = análise individual. */
export function systemPromptPara(quantidade: number): string {
  return quantidade === 1 ? SYSTEM_PROMPT_FICHA : SYSTEM_PROMPT_ANALISE;
}

/** Texto único de contexto: regras + catálogos + fichas. Puro e testável. */
export function montarContextoTexto(
  fichas: FichaParaContexto[],
  notasRegras: Nota[],
  catalogos: Catalogos,
): string {
  const regras =
    notasRegras.length > 0
      ? notasRegras.map((n) => `### ${n.titulo}\n${n.corpo}`).join("\n\n")
      : "(regras não sincronizadas)";
  return [
    "# REGRAS DO SISTEMA",
    regras,
    "# CATÁLOGOS",
    JSON.stringify(catalogos),
    "# FICHAS",
    JSON.stringify(fichas),
  ].join("\n\n");
}

/** Chave em config com os títulos (JSON string[]) das notas que são regras. */
export const CONFIG_REGRAS_NOTAS = "regras_notas";

## Delta na Task 5 (testes)

`prompts.test.ts` testa os conversores no lugar de `fichaEnxuta`:

```ts
// src/features/balanceamento/prompts.test.ts (substitui a versão da Task 5 original)
import { describe, expect, test } from "vitest";
import {
  dePersonagemCompleto,
  dePersonagemInput,
  montarContextoTexto,
  systemPromptPara,
  SYSTEM_PROMPT_ANALISE,
  SYSTEM_PROMPT_FICHA,
} from "./prompts";
import type { Catalogos, Nota, PersonagemCompleto, PersonagemInput } from "../../lib/types";

const completo = {
  id: 1,
  tipo: "jogador",
  nome: "Luffy",
  descricao: "borracha",
  hp: 120,
  sp: 40,
  escudo: 0,
  retrato: "c:/img/luffy.png",
  atributos: [{ nome: "forca", valor: 8, rank: 5 }],
  habilidades: [],
  pericias: [],
  vantagens: [],
  desvantagens: [],
  transformacoes: [
    { nome: "Gear 2", descricao: "", retrato: "c:/img/g2.png", modificadores: [], habilidades: [] },
  ],
  etiquetas: [],
} as unknown as PersonagemCompleto;

const doForm = {
  tipo: "npc",
  nome: "",
  descricao: "vilão",
  hp: 300,
  sp: 50,
  escudo: 100,
  forca: 13,
  agilidade: 7,
  percepcao: 6,
  resistencia: 12,
  intuicao: 5,
  espirito: 8,
  carisma: 4,
  determinacao: 9,
  retrato: { modo: "nenhum" },
  habilidades: [{ nome: "Soco", descricao: "d", tempo: "", custo: "", dano: "", uid: "x1" }],
  pericias: [],
  vantagens: [],
  desvantagens: [],
  transformacoes: [],
  etiquetas: [],
} as unknown as PersonagemInput;

const catalogos: Catalogos = { pericias: [], vantagens: [], desvantagens: [] };

describe("dePersonagemCompleto", () => {
  test("preserva atributos com rank e remove retratos", () => {
    const f = dePersonagemCompleto(completo);
    expect(f.atributos[0]).toEqual({ nome: "forca", valor: 8, rank: 5 });
    expect(JSON.stringify(f)).not.toContain("luffy.png");
    expect(JSON.stringify(f)).not.toContain("g2.png");
  });
});

describe("dePersonagemInput", () => {
  test("monta os 8 atributos sem rank e sem uid", () => {
    const f = dePersonagemInput(doForm);
    expect(f.atributos).toHaveLength(8);
    expect(f.atributos[0]).toEqual({ nome: "forca", valor: 13 });
    expect(JSON.stringify(f)).not.toContain("uid");
    expect(JSON.stringify(f)).not.toContain("retrato");
  });

  test("nome vazio vira placeholder", () => {
    expect(dePersonagemInput(doForm).nome).toBe("(sem nome)");
  });
});

describe("systemPromptPara", () => {
  test("1 ficha usa prompt individual; 2+ usa comparativo", () => {
    expect(systemPromptPara(1)).toBe(SYSTEM_PROMPT_FICHA);
    expect(systemPromptPara(2)).toBe(SYSTEM_PROMPT_ANALISE);
  });
});

describe("montarContextoTexto", () => {
  test("inclui fichas convertidas e corpo das notas de regras", () => {
    const nota = {
      id: 1,
      titulo: "#mecânicas",
      corpo: "rank 13 é o teto",
      criado_em: "",
      atualizado_em: "",
    } as Nota;
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [nota], catalogos);
    expect(ctx).toContain("Luffy");
    expect(ctx).toContain("rank 13 é o teto");
  });

  test("sem notas marca regras como não sincronizadas", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx).toContain("(regras não sincronizadas)");
  });
});
```

## Delta na Task 6 (PainelIA desacoplado de ids)

`PainelIA.tsx` recebe `fichas: FichaParaContexto[]` + `prontas: boolean` + `titulo?: string` (default "Análise com IA"). As queries de personagem saem dele; ganham um wrapper. Mudanças pontuais sobre o código da Task 6 original:

1. Props: `{ fichas, prontas, titulo = "Análise com IA" }: { fichas: FichaParaContexto[]; prontas: boolean; titulo?: string }` — remove `ids`, remove o `useQueries` de personagens e o import de `getPersonagem`.
2. `prontasTudo = prontas && catalogos && titulosRegras !== undefined` (substitui o `prontas` antigo).
3. `contexto()` vira `montarContextoTexto(fichas, notasRegras, catalogos!)` direto.
4. A chamada usa `systemPrompt: systemPromptPara(fichas.length)` (import de `systemPromptPara` no lugar de `SYSTEM_PROMPT_ANALISE`).
5. Botão: `fichas.length === 1 ? "Analisar esta ficha" : "Analisar balanceamento"`; `analisar()` usa texto `"Analise o balanceamento."` (o system prompt certo já direciona).
6. `<h2>` usa `{titulo}`.
7. No MESMO arquivo, export nomeado do wrapper por ids (usado pela tela Balanceamento):

```tsx
/** Variante por ids (tela Balanceamento): busca as fichas e converte. */
export function PainelIAPersonagens({ ids }: { ids: number[] }) {
  const consultas = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["personagem", id],
      queryFn: () => getPersonagem(id),
    })),
  });
  const prontas = consultas.every((c) => c.data);
  const fichas = prontas
    ? consultas.map((c) => dePersonagemCompleto(c.data as PersonagemCompleto))
    : [];
  return <PainelIA fichas={fichas} prontas={prontas} />;
}
```

(`useQueries`, `getPersonagem`, `PersonagemCompleto` e `dePersonagemCompleto` importados aqui.) `BalanceamentoScreen.tsx` renderiza `<PainelIAPersonagens ids={selecionados} />`.

## Task 6b: painel "Discutir com IA" no FichaForm

**Files:**
- Modify: `src/features/characters/FichaForm.tsx`

- [ ] **Step 1: Imports** (junto aos existentes)

```tsx
import PainelIA from "../balanceamento/PainelIA";
import { dePersonagemInput } from "../balanceamento/prompts";
```

- [ ] **Step 2: Painel colapsável no fim da coluna principal** (logo após o bloco de Tabs, dentro da coluna de conteúdo — o estado `form` já existe na linha ~63):

```tsx
<details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 [&[open]>summary]:mb-3">
  <summary className="cursor-pointer select-none text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200">
    Discutir com IA
  </summary>
  <PainelIA
    fichas={[dePersonagemInput(form)]}
    prontas
    titulo="Discutir esta ficha"
  />
</details>
```

Nota: `<details>` nativo evita estado React novo; o conteúdo interno (PainelIA) preserva histórico de chat enquanto o form estiver montado. A ficha enviada é o estado ATUAL do form (não salvo) — recolher/abrir de novo não refaz análise sozinho.

- [ ] **Step 3: Verificar**

Run: `rtk proxy npm run build` → sem erro. Funciona em criação (`/fichas/novo`) e edição (`/fichas/:id/editar`) — mesma árvore.

## Delta na Task 7 (verificação manual — itens extras)

- Abrir `/fichas/novo`, preencher parcialmente, abrir "Discutir com IA" → Analisar esta ficha → relatório individual (prompt de ficha única).
- Perguntar no chat algo sobre a ficha em edição → resposta coerente com os dados NÃO salvos.
- Tela Balanceamento continua funcionando igual (agora via `PainelIAPersonagens`).
