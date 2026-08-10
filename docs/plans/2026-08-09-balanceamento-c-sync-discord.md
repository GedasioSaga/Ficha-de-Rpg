# Plano C — Balanceamento: sync de regras Discord → Notas/Compêndio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **REGRA DO PROJETO: SEM GIT.** Nenhum passo de commit. Verificação = testes + build.
> **Pré-requisito:** Planos A e B aplicados (tela + `gemini.ts` + `configGet/Set` existem).

**Goal:** Botão "Sincronizar regras" que lê canais do Discord escolhidos pelo usuário: canais gerais viram Notas (upsert por título); `#pericias`/`#vantagens`/`#desvantagens` são extraídos via Gemini e entram no Compêndio após preview + confirmação.

**Architecture:** Sidecar Python ganha comando `ler_canal` (`channel.history`, exige intent `message_content`). Rust repassa via `chamar()` (padrão dos comandos Discord). Front orquestra: concatena → nota OU extrai (Gemini com `responseSchema`) → diff puro → preview inline → aplica via CRUD existente do catálogo.

**Tech Stack:** discord.py 2.7.1 (sidecar, PyInstaller), Rust/serde, React Query, `gerarConteudo` do Plano B com `responseSchema` (REST `generationConfig.responseMimeType + responseSchema`, confirmado via context7).

**Spec:** `docs/specs/2026-08-09-balanceamento-comparacao-ia.md` (§6)

---

### Task 1: Sidecar — intent `message_content` + comando `ler_canal`

**Files:**
- Modify: `sidecar/bot_sidecar.py:207-219` (intents + prefixo)
- Modify: `sidecar/bot_sidecar.py` (novo handler perto de `_cmd_listar_canais_texto`, linha ~374)
- Modify: `sidecar/bot_sidecar.py:1377` (dict `COMANDOS`)

- [ ] **Step 1 (MANUAL, USUÁRIO, BLOQUEANTE): habilitar o intent no portal**

Discord Developer Portal → sua aplicação do bot → aba **Bot** → **Privileged Gateway Intents** → ligar **MESSAGE CONTENT INTENT** → Save.
Sem isso o bot **falha no login** com `PrivilegedIntentsRequired` depois da mudança de código abaixo.

- [ ] **Step 2: Intents + prefixo sentinela**

Trocar o bloco `bot_sidecar.py:207-219` por:

```python
    intents = discord.Intents.default()
    # voice_states habilita o evento on_voice_state_update, usado pelo
    # auto-join do "gedasiosaga" (F5). NÃO é intent privilegiado — não
    # precisa de configuração no dev portal. (Em discord.py 2.x já vem
    # ligado no default(), mas deixamos explícito por clareza e robustez
    # a mudanças de versão.)
    intents.voice_states = True
    # message_content É privilegiado (ligar também no dev portal): sem ele,
    # channel.history() devolve mensagens com content vazio — o sync de
    # regras (comando ler_canal) depende disso.
    intents.message_content = True
    # Com message_content ligado, comandos de prefixo PASSARIAM a disparar.
    # O prefixo vira uma sentinela impossível de digitar: o cog de música
    # continua carregável (precisa de commands.Bot), mas ninguém no servidor
    # aciona comando por texto.
    cliente = commands.Bot(command_prefix="\u0000rpgv2\u0000", intents=intents)
```

- [ ] **Step 3: Handler `ler_canal`** (logo após `_cmd_listar_canais_texto`, ~linha 386)

```python
def _cmd_ler_canal(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Lê até `limite` mensagens de texto do canal `canal_id`, da mais antiga
    pra mais nova. Só `content` — anexos/embeds ficam de fora."""
    canal_id = args.get("canal_id")
    limite = int(args.get("limite") or 200)
    if not canal_id:
        raise RuntimeError("canal_id obrigatório")

    async def _coletar() -> list[dict[str, Any]]:
        assert _bot is not None
        canal = _bot.get_channel(int(canal_id))
        if canal is None:
            raise RuntimeError(f"canal {canal_id} não encontrado (bot está no servidor?)")
        return [
            {
                "autor": m.author.display_name,
                "texto": m.content,
                "timestamp": m.created_at.isoformat(),
            }
            async for m in canal.history(limit=limite, oldest_first=True)
        ]

    return _agendar_no_bot(_coletar())
```

- [ ] **Step 4: Registrar no dict `COMANDOS`** (linha 1377, junto ao grupo F4.1)

```python
    "ler_canal": _cmd_ler_canal,
```

- [ ] **Step 5: Rebuild do sidecar**

```powershell
cd C:\dev\projeto-rpg-v2\sidecar
pyinstaller bot_sidecar.spec
```

Copiar o `bot_sidecar.exe` gerado em `dist\` (raiz ou subpasta `bot_sidecar\`, conforme o spec) por cima de:
`C:\dev\projeto-rpg-v2\src-tauri\binaries\bot_sidecar-x86_64-pc-windows-msvc.exe`

- [ ] **Step 6: Verificar login**

Run: `npm run tauri dev` → tela Discord → Conectar.
Expected: conecta normal (nome do bot + guilds). Se falhar com `PrivilegedIntentsRequired`, o Step 1 não foi feito no portal.
Verificar também: player de música continua funcionando (cog carrega; prefixo sentinela não quebra nada).

---

### Task 2: Rust — `discord_ler_canal`

**Files:**
- Modify: `src-tauri/src/discord/protocolo.rs` (struct nova)
- Modify: `src-tauri/src/discord/mod.rs` (comando novo, após `discord_listar_canais`, ~linha 243)
- Modify: `src-tauri/src/lib.rs` (registro no `generate_handler!`, junto aos outros `discord_*`)

- [ ] **Step 1: Struct em `protocolo.rs`** (após `CanalTexto`)

```rust
/// Uma mensagem de canal — item da resposta de `ler_canal` (sync de regras).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MensagemCanal {
    pub autor: String,
    pub texto: String,
    pub timestamp: String,
}
```

- [ ] **Step 2: Comando em `mod.rs`**

```rust
/// Lê até `limite` mensagens (ordem cronológica) de um canal de texto — usado
/// pelo sync de regras da tela Balanceamento.
#[tauri::command]
pub async fn discord_ler_canal(
    estado: State<'_, SidecarState>,
    canal_id: String,
    limite: u32,
) -> Result<Vec<MensagemCanal>, AppError> {
    let data = chamar(
        estado.inner(),
        "ler_canal",
        json!({ "canal_id": canal_id, "limite": limite }),
    )
    .await?;
    Ok(serde_json::from_value(data)?)
}
```

(Se `MensagemCanal` não estiver no `use` de protocolo no topo do `mod.rs`, adicionar ao import existente.)

- [ ] **Step 3: Registrar** em `lib.rs` no `generate_handler!`, na mesma lista onde `discord_listar_canais` está (mesmo prefixo de caminho usado pelos outros comandos `discord_*`):

```rust
discord_ler_canal,
```

- [ ] **Step 4: Verificar**

Run: `cargo build` (em `src-tauri/`) → Expected: compila sem erro.

---

### Task 3: Bindings TS

**Files:**
- Modify: `src/lib/types.ts` (junto ao bloco Discord)
- Modify: `src/lib/api.ts` (junto aos bindings discord)

- [ ] **Step 1: Tipo**

```ts
/** Uma mensagem lida de um canal (sync de regras). Espelha `MensagemCanal` do Rust. */
export interface MensagemCanal {
  autor: string;
  texto: string;
  timestamp: string;
}
```

- [ ] **Step 2: Binding**

```ts
export const discordLerCanal = (canalId: string, limite: number) =>
  invoke<MensagemCanal[]>("discord_ler_canal", { canalId, limite });
```

(Adicionar `MensagemCanal` ao import de types no topo do `api.ts`.)

- [ ] **Step 3: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 4: Diff do catálogo + concatenação — TDD

**Files:**
- Create: `src/lib/diffCatalogo.ts`
- Test: `src/lib/diffCatalogo.test.ts`

- [ ] **Step 1: Testes (falhando)**

```ts
// src/lib/diffCatalogo.test.ts
import { describe, expect, test } from "vitest";
import { concatenarMensagens, diffPorNome } from "./diffCatalogo";
import type { MensagemCanal } from "./types";

const msg = (texto: string): MensagemCanal => ({ autor: "Mestre", texto, timestamp: "" });

describe("concatenarMensagens", () => {
  test("junta textos com linha em branco, ignorando vazios", () => {
    expect(concatenarMensagens([msg("a"), msg(""), msg("b")])).toBe("a\n\nb");
  });

  test("lista vazia vira string vazia", () => {
    expect(concatenarMensagens([])).toBe("");
  });
});

interface Atual { id: number; nome: string; descricao: string; }
interface Nova { nome: string; descricao: string; }

const iguais = (a: Atual, n: Nova) => a.descricao === n.descricao;

describe("diffPorNome", () => {
  const atuais: Atual[] = [
    { id: 1, nome: "Furtividade", descricao: "andar quieto" },
    { id: 2, nome: "Pesca", descricao: "pescar" },
  ];

  test("nome inexistente entra em criar", () => {
    const d = diffPorNome(atuais, [{ nome: "Culinária", descricao: "cozinhar" }], iguais);
    expect(d.criar).toEqual([{ nome: "Culinária", descricao: "cozinhar" }]);
    expect(d.atualizar).toEqual([]);
  });

  test("nome existente com conteúdo diferente entra em atualizar (leva o id)", () => {
    const d = diffPorNome(atuais, [{ nome: "Pesca", descricao: "pescar melhor" }], iguais);
    expect(d.atualizar).toEqual([
      { id: 2, nomeAtual: "Pesca", nova: { nome: "Pesca", descricao: "pescar melhor" } },
    ]);
  });

  test("nome existente idêntico entra em manter", () => {
    const d = diffPorNome(atuais, [{ nome: "Pesca", descricao: "pescar" }], iguais);
    expect(d.manter).toEqual(["Pesca"]);
    expect(d.atualizar).toEqual([]);
  });

  test("casamento de nome é case-insensitive e ignora espaços das pontas", () => {
    const d = diffPorNome(atuais, [{ nome: "  FURTIVIDADE ", descricao: "andar quieto" }], iguais);
    expect(d.manter).toEqual(["Furtividade"]);
  });

  test("duplicata na extração: a última ganha", () => {
    const d = diffPorNome(
      atuais,
      [
        { nome: "Culinária", descricao: "v1" },
        { nome: "culinária", descricao: "v2" },
      ],
      iguais,
    );
    expect(d.criar).toEqual([{ nome: "culinária", descricao: "v2" }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/diffCatalogo.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// src/lib/diffCatalogo.ts
import type { MensagemCanal } from "./types";

/** Texto único do canal: só o conteúdo, mensagens separadas por linha em branco. */
export function concatenarMensagens(mensagens: MensagemCanal[]): string {
  return mensagens
    .map((m) => m.texto.trim())
    .filter(Boolean)
    .join("\n\n");
}

const norma = (nome: string) => nome.trim().toLowerCase();

export interface DiffResultado<TNova> {
  criar: TNova[];
  atualizar: { id: number; nomeAtual: string; nova: TNova }[];
  /** Nomes (como estão no catálogo) que já batem com o extraído. */
  manter: string[];
}

/**
 * Compara extraído × catálogo por nome normalizado (trim + lowercase).
 * `iguais` decide se o conteúdo bate (aí é "manter"). Duplicatas na
 * extração: a última ocorrência ganha.
 */
export function diffPorNome<
  TAtual extends { id: number; nome: string },
  TNova extends { nome: string },
>(
  atuais: TAtual[],
  novas: TNova[],
  iguais: (atual: TAtual, nova: TNova) => boolean,
): DiffResultado<TNova> {
  const dedup = new Map<string, TNova>();
  for (const n of novas) dedup.set(norma(n.nome), n);

  const porNome = new Map(atuais.map((a) => [norma(a.nome), a]));
  const resultado: DiffResultado<TNova> = { criar: [], atualizar: [], manter: [] };

  for (const [chave, nova] of dedup) {
    const atual = porNome.get(chave);
    if (!atual) {
      resultado.criar.push(nova);
    } else if (iguais(atual, nova)) {
      resultado.manter.push(atual.nome);
    } else {
      resultado.atualizar.push({ id: atual.id, nomeAtual: atual.nome, nova });
    }
  }
  return resultado;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/diffCatalogo.test.ts`
Expected: PASS (7 testes).

---

### Task 5: Extração estruturada via Gemini — TDD

**Files:**
- Create: `src/features/balanceamento/extracao.ts`
- Test: `src/features/balanceamento/extracao.test.ts`

- [ ] **Step 1: Testes (falhando)**

```ts
// src/features/balanceamento/extracao.test.ts
import { describe, expect, test, vi } from "vitest";
import { extrairPericias, extrairTracos } from "./extracao";

describe("extrairPericias", () => {
  test("parseia o JSON devolvido pelo modelo", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"Pesca","descricao":"pescar","atributo":"percepcao"}]');
    const r = await extrairPericias("texto do canal", gerarFn);
    expect(r).toEqual([{ nome: "Pesca", descricao: "pescar", atributo: "percepcao" }]);
    // prompt leva o texto do canal e pede schema JSON
    expect(gerarFn.mock.calls[0][0][0].texto).toContain("texto do canal");
    expect(gerarFn.mock.calls[0][1].responseSchema).toBeTruthy();
  });

  test("JSON malformado vira erro legível (nada de gravar parcial)", async () => {
    const gerarFn = vi.fn().mockResolvedValue("desculpa, não consegui");
    await expect(extrairPericias("x", gerarFn)).rejects.toThrow(/extração/i);
  });

  test("entrada sem nome é descartada", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"","descricao":"d","atributo":"forca"},{"nome":"Ok","descricao":"d","atributo":"forca"}]');
    const r = await extrairPericias("x", gerarFn);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Ok");
  });
});

describe("extrairTracos", () => {
  test("parseia nome/descricao/efeito", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"Sortudo","descricao":"d","efeito":"+1 em tudo"}]');
    const r = await extrairTracos("vantagens do canal", "vantagem", gerarFn);
    expect(r).toEqual([{ nome: "Sortudo", descricao: "d", efeito: "+1 em tudo" }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/balanceamento/extracao.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// src/features/balanceamento/extracao.ts
import { gerarConteudo, type MensagemIA, type OpcoesGeracao } from "../../lib/gemini";
import type { CatalogoPericiaInput, CatalogoTracoInput, TipoTraco } from "../../lib/types";

/** Assinatura injetável (default: gerarConteudo real) — facilita teste. */
export type GerarFn = (mensagens: MensagemIA[], opts: OpcoesGeracao) => Promise<string>;

const SCHEMA_PERICIAS = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      nome: { type: "STRING" },
      descricao: { type: "STRING" },
      atributo: { type: "STRING" },
    },
    required: ["nome", "descricao", "atributo"],
  },
};

const SCHEMA_TRACOS = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      nome: { type: "STRING" },
      descricao: { type: "STRING" },
      efeito: { type: "STRING" },
    },
    required: ["nome", "descricao", "efeito"],
  },
};

function parseLista<T extends { nome: string }>(bruto: string, contexto: string): T[] {
  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    throw new Error(`Falha na extração de ${contexto}: o modelo não devolveu JSON válido.`);
  }
  if (!Array.isArray(dados)) {
    throw new Error(`Falha na extração de ${contexto}: esperava uma lista.`);
  }
  return (dados as T[]).filter((e) => e && typeof e.nome === "string" && e.nome.trim() !== "");
}

export async function extrairPericias(
  textoCanal: string,
  gerarFn: GerarFn = gerarConteudo,
): Promise<CatalogoPericiaInput[]> {
  const bruto = await gerarFn(
    [
      {
        role: "user",
        texto: `Extraia TODAS as perícias descritas neste canal do Discord de um RPG homebrew. "atributo" é o atributo-base citado (forca, agilidade, percepcao, resistencia, intuicao, espirito, carisma ou determinacao — minúsculo, sem acento). Não invente entradas.\n\n${textoCanal}`,
      },
    ],
    { responseSchema: SCHEMA_PERICIAS },
  );
  return parseLista<CatalogoPericiaInput>(bruto, "perícias");
}

export async function extrairTracos(
  textoCanal: string,
  tipo: TipoTraco,
  gerarFn: GerarFn = gerarConteudo,
): Promise<CatalogoTracoInput[]> {
  const rotulo = tipo === "vantagem" ? "vantagens" : "desvantagens";
  const bruto = await gerarFn(
    [
      {
        role: "user",
        texto: `Extraia TODAS as ${rotulo} descritas neste canal do Discord de um RPG homebrew. "efeito" é o efeito mecânico resumido. Não invente entradas.\n\n${textoCanal}`,
      },
    ],
    { responseSchema: SCHEMA_TRACOS },
  );
  return parseLista<CatalogoTracoInput>(bruto, rotulo);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/balanceamento/extracao.test.ts`
Expected: PASS (4 testes).

---

### Task 6: UI — seção "Regras do jogo" na tela Discord

**Files:**
- Create: `src/features/batalha/SyncRegras.tsx`
- Modify: `src/features/batalha/DiscordPainel.tsx` (renderizar a seção nova depois da seção de canal, passando os canais já carregados)

- [ ] **Step 1: Componente**

```tsx
// src/features/batalha/SyncRegras.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  atualizarCatalogoPericia,
  atualizarCatalogoTraco,
  atualizarNota,
  configGet,
  configSet,
  criarCatalogoPericia,
  criarCatalogoTraco,
  criarNota,
  discordLerCanal,
  listarCatalogos,
  listarNotas,
} from "../../lib/api";
import type {
  CanalTexto,
  CatalogoPericiaInput,
  CatalogoTracoInput,
} from "../../lib/types";
import { concatenarMensagens, diffPorNome, type DiffResultado } from "../../lib/diffCatalogo";
import { extrairPericias, extrairTracos } from "../balanceamento/extracao";
import { CONFIG_REGRAS_NOTAS } from "../balanceamento/prompts";
import { useToast } from "../../components/Toast";

const CONFIG_MAPA = "sync_regras_mapa";
const LIMITE_MENSAGENS = 200;

type Destino = "" | "nota" | "pericias" | "vantagens" | "desvantagens";

type Preview =
  | { destino: "pericias"; canalNome: string; diff: DiffResultado<CatalogoPericiaInput> }
  | {
      destino: "vantagens" | "desvantagens";
      canalNome: string;
      diff: DiffResultado<CatalogoTracoInput>;
    };

/** Upsert de nota por título: atualiza se existir, cria se não. */
async function upsertNotaPorTitulo(titulo: string, corpo: string): Promise<void> {
  const resumos = await listarNotas();
  const existente = resumos.find((r) => r.titulo === titulo);
  if (existente) await atualizarNota(existente.id, { titulo, corpo });
  else await criarNota({ titulo, corpo });
}

export default function SyncRegras({
  canais,
  conectado,
}: {
  canais: CanalTexto[];
  conectado: boolean;
}) {
  const [mapa, setMapa] = useState<Record<string, Destino>>({});
  const [previews, setPreviews] = useState<Preview[]>([]);
  const toast = useToast();
  const qc = useQueryClient();

  const { data: mapaSalvo } = useQuery({
    queryKey: ["config", CONFIG_MAPA],
    queryFn: () => configGet(CONFIG_MAPA),
  });
  useEffect(() => {
    if (mapaSalvo) {
      try {
        setMapa(JSON.parse(mapaSalvo) as Record<string, Destino>);
      } catch {
        // config corrompida: começa vazio, próximo salvar conserta
      }
    }
  }, [mapaSalvo]);

  function definirDestino(canalId: string, destino: Destino) {
    const novo = { ...mapa, [canalId]: destino };
    if (!destino) delete novo[canalId];
    setMapa(novo);
    void configSet(CONFIG_MAPA, JSON.stringify(novo));
  }

  const sincronizarMut = useMutation({
    mutationFn: async () => {
      const escolhidos = canais.filter((c) => mapa[c.id]);
      if (escolhidos.length === 0) throw new Error("Nenhum canal com destino definido.");
      const titulosNotas: string[] = [];
      const novosPreviews: Preview[] = [];
      const catalogos = await listarCatalogos();

      for (const canal of escolhidos) {
        const texto = concatenarMensagens(await discordLerCanal(canal.id, LIMITE_MENSAGENS));
        if (!texto) continue; // canal vazio (ou intent do portal desligado)
        const destino = mapa[canal.id];

        if (destino === "nota") {
          const titulo = `#${canal.nome}`;
          await upsertNotaPorTitulo(titulo, texto);
          titulosNotas.push(titulo);
        } else if (destino === "pericias") {
          const extraidas = await extrairPericias(texto);
          novosPreviews.push({
            destino,
            canalNome: canal.nome,
            diff: diffPorNome(catalogos.pericias, extraidas, (a, n) =>
              a.descricao === n.descricao && a.atributo === n.atributo,
            ),
          });
        } else if (destino === "vantagens" || destino === "desvantagens") {
          const extraidas = await extrairTracos(
            texto,
            destino === "vantagens" ? "vantagem" : "desvantagem",
          );
          const atuais = destino === "vantagens" ? catalogos.vantagens : catalogos.desvantagens;
          novosPreviews.push({
            destino,
            canalNome: canal.nome,
            diff: diffPorNome(atuais, extraidas, (a, n) =>
              a.descricao === n.descricao && a.efeito === n.efeito,
            ),
          });
        }
      }

      await configSet(CONFIG_REGRAS_NOTAS, JSON.stringify(titulosNotas));
      return { titulosNotas, novosPreviews };
    },
    onSuccess: ({ titulosNotas, novosPreviews }) => {
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["config"] });
      setPreviews(novosPreviews);
      toast.sucesso(
        `${titulosNotas.length} nota(s) sincronizada(s)` +
          (novosPreviews.length > 0 ? " — revise o catálogo abaixo." : "."),
      );
    },
    onError: (e) => toast.erro(String(e)),
  });

  const aplicarMut = useMutation({
    mutationFn: async () => {
      for (const p of previews) {
        if (p.destino === "pericias") {
          for (const nova of p.diff.criar) await criarCatalogoPericia(nova);
          for (const a of p.diff.atualizar) await atualizarCatalogoPericia(a.id, a.nova);
        } else {
          const tipo = p.destino === "vantagens" ? "vantagem" : "desvantagem";
          for (const nova of p.diff.criar) await criarCatalogoTraco(tipo, nova);
          for (const a of p.diff.atualizar) await atualizarCatalogoTraco(tipo, a.id, a.nova);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogos"] });
      setPreviews([]);
      toast.sucesso("Compêndio atualizado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  if (!conectado) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Regras do jogo
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Escolha o destino de cada canal: Nota (texto fiel) ou Compêndio (extração
          via IA, com revisão antes de gravar).
        </p>
      </div>

      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {canais.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-slate-300">#{c.nome}</span>
            <select
              value={mapa[c.id] ?? ""}
              onChange={(e) => definirDestino(c.id, e.target.value as Destino)}
              className="h-8 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">— ignorar</option>
              <option value="nota">Nota</option>
              <option value="pericias">Compêndio: perícias</option>
              <option value="vantagens">Compêndio: vantagens</option>
              <option value="desvantagens">Compêndio: desvantagens</option>
            </select>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={sincronizarMut.isPending}
        onClick={() => sincronizarMut.mutate()}
        className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
      >
        {sincronizarMut.isPending ? "Sincronizando…" : "Sincronizar regras"}
      </button>

      {previews.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">
            Revisão do Compêndio — nada foi gravado ainda:
          </p>
          {previews.map((p, i) => (
            <div key={i} className="text-sm text-slate-300">
              <p className="font-medium text-slate-200">
                #{p.canalNome} → {p.destino}
              </p>
              <ul className="mt-1 space-y-0.5 pl-4 text-xs">
                {p.diff.criar.map((n) => (
                  <li key={`c-${n.nome}`} className="text-emerald-300">
                    + criar: {n.nome}
                  </li>
                ))}
                {p.diff.atualizar.map((a) => (
                  <li key={`a-${a.id}`} className="text-amber-300">
                    ~ atualizar: {a.nomeAtual}
                  </li>
                ))}
                <li className="text-slate-500">= manter: {p.diff.manter.length}</li>
              </ul>
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={aplicarMut.isPending}
              onClick={() => aplicarMut.mutate()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {aplicarMut.isPending ? "Aplicando…" : "Aplicar no Compêndio"}
            </button>
            <button
              type="button"
              onClick={() => setPreviews([])}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Renderizar no `DiscordPainel.tsx`**

Adicionar o import:

```tsx
import SyncRegras from "./SyncRegras";
```

E renderizar após a seção de canal existente (linhas ~208-241), passando os dados que a tela já tem — a query de canais (`canais.data ?? []`) e o boolean de conectado usados nas seções atuais:

```tsx
<SyncRegras canais={canais.data ?? []} conectado={conectado} />
```

(Usar os nomes reais das variáveis locais do componente — `canais`/`conectado` conforme já definidos no arquivo.)

- [ ] **Step 3: Verificar**

Run: `npm run build` → Expected: sem erro.

---

### Task 7: Verificação final da fatia

- [ ] **Step 1: Testes**

Run: `npm test` → Expected: todos passam (diffCatalogo, extracao + os anteriores).

- [ ] **Step 2: Builds**

Run: `cargo build` (em `src-tauri/`) e `npm run build` → Expected: sem erro.

- [ ] **Step 3: Teste manual real (`npm run tauri dev`, bot no servidor do usuário)**

Checklist:
- Conectar Discord → seção "Regras do jogo" aparece com os canais reais.
- Mapear `#mecânicas` → Nota; `#pericias` → Compêndio: perícias. Reabrir o app: mapeamento persiste.
- Sincronizar: nota `#mecânicas` aparece na tela Notas com o texto do canal (conteúdo NÃO vazio — se vier vazio, o intent do portal não está ligado).
- Preview do catálogo lista criar/atualizar/manter coerentes; Descartar não grava nada; Aplicar grava e o Compêndio mostra as entradas.
- Rodar Sincronizar de novo sem mudanças no Discord → tudo em "manter", nada duplica.
- Tela Balanceamento: aviso âmbar de "regras não sincronizadas" sumiu; Analisar agora cita regras do sistema.
- Bot desconectado → Sincronizar → erro claro, sem crash.

- [ ] **Step 4: Reportar resultado honesto**

O que passou, o que não foi testável, com evidência (saída de comando).
