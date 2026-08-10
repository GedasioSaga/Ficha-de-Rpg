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
