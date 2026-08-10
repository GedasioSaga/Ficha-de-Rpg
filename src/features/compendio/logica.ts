import type {
  CatalogoPericia,
  CatalogoPericiaInput,
  CatalogoTraco,
  CatalogoTracoInput,
} from "../../lib/types";

/** Descarta o id pra montar o input de save de uma perícia do catálogo. */
export function periciaParaInput(p: CatalogoPericia): CatalogoPericiaInput {
  return { nome: p.nome, descricao: p.descricao, atributo: p.atributo };
}

/** Input de uma perícia nova em branco. */
export function periciaInputVazio(): CatalogoPericiaInput {
  return { nome: "", descricao: "", atributo: "forca" };
}

/** Descarta o id pra montar o input de save de uma vantagem/desvantagem do catálogo. */
export function tracoParaInput(t: CatalogoTraco): CatalogoTracoInput {
  return { nome: t.nome, descricao: t.descricao, efeito: t.efeito };
}

/** Input de um traço (vantagem/desvantagem) novo em branco. */
export function tracoInputVazio(): CatalogoTracoInput {
  return { nome: "", descricao: "", efeito: "" };
}

/** Filtro client-side por substring em nome/descrição (case-insensitive). */
export function filtrarPorBusca<T extends { nome: string; descricao: string }>(
  itens: T[],
  busca: string,
): T[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return itens;
  return itens.filter(
    (it) => it.nome.toLowerCase().includes(termo) || it.descricao.toLowerCase().includes(termo),
  );
}
