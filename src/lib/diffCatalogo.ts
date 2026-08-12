import type { MensagemCanal } from "./types";

/** Espaço em branco colapsado, pra dedupe não ser enganado por espaçamento diferente. */
const normalizarEspaco = (texto: string) => texto.trim().replace(/\s+/g, " ");

/**
 * Texto único do canal: só o conteúdo, mensagens separadas por linha em branco.
 * Descarta apenas os dois casos que motivam isso — canal de raça com o BLOCO
 * INTEIRO postado duas vezes (segunda metade da sequência espelha a primeira)
 * e repetição adjacente (mensagem igual à imediatamente anterior). Mensagem
 * legítima que só coincide em texto sem ser adjacente é preservada.
 */
export function concatenarMensagens(mensagens: MensagemCanal[]): string {
  const textos = mensagens.map((m) => m.texto.trim()).filter(Boolean);
  return descartarAdjacentesRepetidos(descartarCanalDuplicado(textos)).join("\n\n");
}

/** Canal inteiro postado 2x: a segunda metade da sequência espelha a primeira. */
function descartarCanalDuplicado(textos: string[]): string[] {
  const metade = textos.length / 2;
  if (!Number.isInteger(metade) || metade === 0) return textos;

  const primeira = textos.slice(0, metade);
  const segunda = textos.slice(metade);
  const espelhado = primeira.every(
    (texto, i) => normalizarEspaco(texto) === normalizarEspaco(segunda[i]),
  );
  return espelhado ? primeira : textos;
}

/** Mensagem igual à imediatamente anterior (após normalizar espaço) é descartada. */
function descartarAdjacentesRepetidos(textos: string[]): string[] {
  return textos.filter(
    (texto, i) => i === 0 || normalizarEspaco(texto) !== normalizarEspaco(textos[i - 1]),
  );
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
