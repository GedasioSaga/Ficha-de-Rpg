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
