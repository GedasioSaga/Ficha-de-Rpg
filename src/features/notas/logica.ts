import type { Nota, NotaInput } from "../../lib/types";

/** Descarta id/timestamps pra montar o input de save. */
export function notaParaInput(n: Nota): NotaInput {
  return { titulo: n.titulo, corpo: n.corpo };
}

/** Input de uma nota nova em branco. */
export function inputVazio(): NotaInput {
  return { titulo: "", corpo: "" };
}
