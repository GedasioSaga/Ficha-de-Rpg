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
  // `split` com N delimitadores gera N+1 partes: N par (balanceado) → partes
  // ímpares. Sem par de ** ou com ** órfão, a linha inteira é texto normal.
  if (partes.length < 3 || partes.length % 2 === 0) {
    return [{ texto: linha, negrito: false }];
  }
  const segmentos = partes
    .map((texto, i) => ({ texto, negrito: i % 2 === 1 }))
    .filter((s) => s.texto !== "");
  // Só delimitadores (ex.: "****"): nada sobra — preserva o literal.
  return segmentos.length > 0 ? segmentos : [{ texto: linha, negrito: false }];
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
