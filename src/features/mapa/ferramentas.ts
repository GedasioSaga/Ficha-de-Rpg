/**
 * Ferramentas de desenho do editor de mapa: lógica pura, sem React.
 * Toda função recebe a grade atual e devolve uma grade NOVA (imutável — nunca muta a original).
 *
 * A grade é `string[]` (uma string por linha). O mapa é monoespaçado e vai pro Discord num
 * code block, então cada célula é sempre 1 caractere. Como o usuário pinta símbolos Unicode
 * (ex.: "✟"), toda leitura/escrita de célula passa por `[...linha]` (array de code points),
 * nunca por índice de string cru — fatiar por unidade UTF-16 corromperia o caractere.
 */
import { CELULA_VAZIA } from "./logica";

export interface Celula {
  r: number;
  c: number;
}

/** Converte a grade (linhas como string) numa matriz de code points, pronta pra editar em memória. */
function paraMatriz(grade: string[]): string[][] {
  return grade.map((linha) => [...linha]);
}

/** Reconstrói as strings da grade a partir da matriz de code points. */
function paraGrade(matriz: string[][]): string[] {
  return matriz.map((linha) => linha.join(""));
}

/**
 * Pinta várias células de uma vez, numa única passada imutável. Base de todas as ferramentas
 * que afetam mais de uma célula (balde, linha, retângulo) — assim cada ferramenta gera UMA
 * grade nova só, e quem chama decide se isso vira um único passo de undo.
 */
export function pintarVarias(grade: string[], celulas: Celula[], char: string): string[] {
  const matriz = paraMatriz(grade);
  for (const { r, c } of celulas) {
    if (r < 0 || r >= matriz.length) continue;
    const linha = matriz[r];
    if (c < 0 || c >= linha.length) continue;
    linha[c] = char;
  }
  return paraGrade(matriz);
}

/**
 * Balde: preenchimento por área (flood fill 4-direções) trocando a região conectada de mesmo
 * caractere. Pilha iterativa — 26×50 = 1300 células poderiam estourar a pilha de chamada numa
 * versão recursiva. Se o char alvo já é o char novo, devolve a grade inalterada (senão a busca
 * nunca converge: toda célula já bate com o alvo e ficaria "achando" vizinhos pra sempre).
 */
export function balde(grade: string[], r: number, c: number, novoChar: string): string[] {
  const matriz = paraMatriz(grade);
  if (r < 0 || r >= matriz.length) return grade;
  const linhaAlvo = matriz[r];
  if (c < 0 || c >= linhaAlvo.length) return grade;

  const charAlvo = linhaAlvo[c];
  if (charAlvo === novoChar) return grade;

  const pilha: Celula[] = [{ r, c }];
  while (pilha.length > 0) {
    const atual = pilha.pop() as Celula;
    if (atual.r < 0 || atual.r >= matriz.length) continue;
    const linha = matriz[atual.r];
    if (atual.c < 0 || atual.c >= linha.length) continue;
    if (linha[atual.c] !== charAlvo) continue;

    linha[atual.c] = novoChar;
    pilha.push(
      { r: atual.r - 1, c: atual.c },
      { r: atual.r + 1, c: atual.c },
      { r: atual.r, c: atual.c - 1 },
      { r: atual.r, c: atual.c + 1 },
    );
  }
  return paraGrade(matriz);
}

/** Lista as células de uma linha reta entre dois pontos (algoritmo de Bresenham). */
export function celulasLinha(r0: number, c0: number, r1: number, c1: number): Celula[] {
  const pontos: Celula[] = [];
  let x = c0;
  let y = r0;
  const dx = Math.abs(c1 - c0);
  const dy = -Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1;
  const sy = r0 < r1 ? 1 : -1;
  let erro = dx + dy;

  while (true) {
    pontos.push({ r: y, c: x });
    if (x === c1 && y === r1) break;
    const e2 = 2 * erro;
    if (e2 >= dy) {
      erro += dy;
      x += sx;
    }
    if (e2 <= dx) {
      erro += dx;
      y += sy;
    }
  }
  return pontos;
}

/** Traça uma linha reta entre duas células, retornando a grade nova. */
export function linhaReta(grade: string[], r0: number, c0: number, r1: number, c1: number, char: string): string[] {
  return pintarVarias(grade, celulasLinha(r0, c0, r1, c1), char);
}

/** Lista as células de um retângulo (contorno ou preenchido) entre duas células opostas. */
export function celulasRetangulo(r0: number, c0: number, r1: number, c1: number, preenchido: boolean): Celula[] {
  const rMin = Math.min(r0, r1);
  const rMax = Math.max(r0, r1);
  const cMin = Math.min(c0, c1);
  const cMax = Math.max(c0, c1);
  const pontos: Celula[] = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const naBorda = r === rMin || r === rMax || c === cMin || c === cMax;
      if (preenchido || naBorda) pontos.push({ r, c });
    }
  }
  return pontos;
}

/** Desenha um retângulo (contorno ou preenchido) entre duas células opostas. */
export function retangulo(
  grade: string[],
  r0: number,
  c0: number,
  r1: number,
  c1: number,
  char: string,
  preenchido: boolean,
): string[] {
  return pintarVarias(grade, celulasRetangulo(r0, c0, r1, c1, preenchido), char);
}

/** Limpa a grade inteira, preenchendo com o char vazio (mantém dimensões). */
export function limparTudo(grade: string[], charVazio: string = CELULA_VAZIA): string[] {
  return grade.map((linha) => charVazio.repeat([...linha].length));
}

/** Substitui todas as ocorrências de um char por outro na grade inteira. */
export function substituirTodos(grade: string[], charAlvo: string, charNovo: string): string[] {
  if (charAlvo === charNovo) return grade;
  return grade.map((linha) => [...linha].map((ch) => (ch === charAlvo ? charNovo : ch)).join(""));
}
