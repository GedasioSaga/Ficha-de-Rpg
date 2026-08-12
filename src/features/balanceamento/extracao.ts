import { gerarConteudo, type MensagemIA, type OpcoesGeracao } from "../../lib/gemini";
import { ATRIBUTOS } from "../characters/atributos";
import type { CatalogoPericiaInput, CatalogoTracoInput, TipoTraco } from "../../lib/types";

/** Assinatura injetável (default: gerarConteudo real) — facilita teste. */
export type GerarFn = (mensagens: MensagemIA[], opts: OpcoesGeracao) => Promise<string>;

/**
 * `atributo` é lista (não string livre): é a origem de "(Intuição)" e "..." no
 * banco quando o Gemini devolvia texto livre. `enum` trava nos 8 slugs
 * canônicos; a lista existe porque perícia pode ter mais de um atributo-base.
 */
const SCHEMA_PERICIAS = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      nome: { type: "STRING" },
      descricao: { type: "STRING" },
      atributo: {
        type: "ARRAY",
        items: { type: "STRING", enum: [...ATRIBUTOS] },
      },
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

/** Formato bruto que sai do Gemini: `atributo` ainda é lista de slugs, não CSV. */
interface PericiaBruta {
  nome: string;
  descricao: string;
  atributo: string[];
}

export async function extrairPericias(
  textoCanal: string,
  gerarFn: GerarFn = gerarConteudo,
): Promise<CatalogoPericiaInput[]> {
  const bruto = await gerarFn(
    [
      {
        role: "user",
        texto: `Extraia TODAS as perícias descritas neste canal do Discord de um RPG homebrew. "atributo" é uma LISTA com o(s) atributo-base citado(s), cada um um dos 8 slugs (forca, agilidade, percepcao, resistencia, intuicao, espirito, carisma, determinacao). Perícia pode ter mais de um: "(Percepção/Intuição)" no texto original significa a lista ["percepcao", "intuicao"]. Não invente entradas.\n\n${textoCanal}`,
      },
    ],
    { responseSchema: SCHEMA_PERICIAS },
  );
  return parseLista<PericiaBruta>(bruto, "perícias").map(({ atributo, ...resto }) => ({
    ...resto,
    atributo: atributo.join(","),
  }));
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
