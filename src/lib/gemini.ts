// src/lib/gemini.ts
import { configGet, configSet } from "./api";

/** Uma imagem inline pro Gemini (formato REST: inline_data). */
export interface ImagemIA {
  /** Ex.: "image/png", "image/jpeg". */
  mimeType: string;
  /** Base64 puro, SEM o prefixo `data:...;base64,`. */
  base64: string;
}

/** Uma mensagem do histórico (formato da API Gemini: user/model). */
export interface MensagemIA {
  role: "user" | "model";
  texto: string;
  imagens?: ImagemIA[];
}

const REGEX_DATA_URL_BASE64 = /^data:([^;,]+);base64,(.+)$/s;

/** Converte uma data URL (`data:image/png;base64,AAA…`) em ImagemIA; null se não for uma. */
export function imagemDeDataUrl(dataUrl: string | null | undefined): ImagemIA | null {
  if (!dataUrl) return null;
  const m = REGEX_DATA_URL_BASE64.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
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

/**
 * Fonte única de verdade do formato do CSV de chaves: a UI conta o mesmo que a
 * chamada usa, então "3 configuradas" nunca discorda do que o failover enxerga.
 */
export function parseChaves(csv: string | null | undefined): string[] {
  return (csv ?? "").split(",").map((c) => c.trim()).filter(Boolean);
}

/** Um modelo Gemini oferecido na tela de Configurações. */
export interface ModeloGemini {
  id: string;
  rotulo: string;
  /** USD por 1M tokens de entrada/saída — fonte: ai.google.dev/gemini-api/docs/pricing (2026-08-09). */
  precoEntrada: number;
  precoSaida: number;
  /** Nota curta de quando usar (uma linha). */
  nota: string;
  freeTier: boolean;
}

/**
 * Ordenado do mais barato ao mais caro (pelo preço de saída, que é o que pesa
 * na conta: o app manda contexto curto e recebe análise longa). Todos aceitam
 * imagem — o app manda o retrato do personagem junto da pergunta.
 */
export const MODELOS_GEMINI: ModeloGemini[] = [
  {
    id: "gemini-2.5-flash-lite",
    rotulo: "Gemini 2.5 Flash Lite",
    precoEntrada: 0.1,
    precoSaida: 0.4,
    nota: "Dia a dia: conversa, consulta de regras e leitura de retrato.",
    freeTier: true,
  },
  {
    id: "gemini-3.1-flash-lite",
    rotulo: "Gemini 3.1 Flash Lite",
    precoEntrada: 0.25,
    precoSaida: 1.5,
    nota: "Um degrau de raciocínio acima, ainda na faixa barata.",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash-lite",
    rotulo: "Gemini 3.5 Flash Lite",
    precoEntrada: 0.3,
    precoSaida: 2.5,
    nota: "Leve da geração 3.5 — segura melhor conversa longa.",
    freeTier: true,
  },
  {
    id: "gemini-2.5-flash",
    rotulo: "Gemini 2.5 Flash",
    precoEntrada: 0.3,
    precoSaida: 2.5,
    nota: "Equilíbrio clássico; dá conta de análise de balanceamento.",
    freeTier: true,
  },
  {
    id: "gemini-3-flash-preview",
    rotulo: "Gemini 3 Flash (preview)",
    precoEntrada: 0.5,
    precoSaida: 3,
    nota: "Preview: raciocínio bom, mas pode mudar sem aviso.",
    freeTier: true,
  },
  {
    id: "gemini-3.6-flash",
    rotulo: "Gemini 3.6 Flash",
    precoEntrada: 1.5,
    precoSaida: 7.5,
    nota: "Simulação de combate mais detalhada e consistente.",
    freeTier: true,
  },
  {
    id: "gemini-3.5-flash",
    rotulo: "Gemini 3.5 Flash",
    precoEntrada: 1.5,
    precoSaida: 9,
    nota: "Raciocínio forte para relatórios longos de equilíbrio.",
    freeTier: true,
  },
  {
    id: "gemini-2.5-pro",
    rotulo: "Gemini 2.5 Pro",
    precoEntrada: 1.25,
    precoSaida: 10,
    nota: "Melhor julgamento quando a regra é ambígua.",
    freeTier: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    rotulo: "Gemini 3.1 Pro (preview)",
    precoEntrada: 2,
    precoSaida: 12,
    nota: "O mais capaz — só quando a resposta precisa sair impecável.",
    freeTier: false,
  },
];

/**
 * O mais barato da lista: decisão do dono do jogo — usar o mais barato por
 * padrão e só subir de modelo quando a tarefa exigir.
 */
export const MODELO_PADRAO = "gemini-2.5-flash-lite";

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
    contents: mensagens.map((m) => ({
      role: m.role,
      parts: [
        { text: m.texto },
        ...(m.imagens ?? []).map((img) => ({
          inline_data: { mime_type: img.mimeType, data: img.base64 },
        })),
      ],
    })),
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

  const chaves = parseChaves(await obterConfig(CONFIG_CHAVES));
  if (chaves.length === 0) throw new ErroSemChave();

  const bruto = parseInt((await obterConfig(CONFIG_ATIVA)) ?? "0", 10);
  const inicio = Number.isFinite(bruto)
    ? Math.min(Math.max(bruto, 0), chaves.length - 1)
    : 0;
  // Id gravado por uma versão antiga (ou editado no SQLite) daria 404 sem pista:
  // se não está no catálogo, cai no mesmo padrão que a tela mostra.
  const salvo = await obterConfig(CONFIG_MODELO);
  const modelo = MODELOS_GEMINI.some((m) => m.id === salvo) ? (salvo as string) : MODELO_PADRAO;
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
    let json: unknown;
    try {
      json = await r.json();
    } catch {
      throw new Error("Gemini: resposta inválida (JSON malformado).");
    }
    return extrairTexto(json);
  }
  throw new ErroCotaEsgotada();
}
