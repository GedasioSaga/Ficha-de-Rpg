import type { HabilidadeDto } from "../../../lib/types";

let seq = 0;

/** Chave de render estável por item de lista no formulário (client-only; o backend ignora). */
export const novaChave = (): string => `k${seq++}`;

/**
 * Técnica em branco — fonte única para forma base e transformação, senão cada
 * campo novo do `HabilidadeDto` precisa ser lembrado em dois lugares.
 */
export const habilidadeVazia = (uid: string): HabilidadeDto => ({
  nome: "",
  descricao: "",
  acao: "",
  efeito: "",
  custo: "",
  tempo: "",
  dano: "",
  campos_extras: [],
  uid,
});
