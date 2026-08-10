/** Índices (por coluna) dos maiores e menores valores de uma linha da tabela. */
export interface Extremos {
  maiores: Set<number>;
  menores: Set<number>;
}

/** Linha uniforme ou com <2 valores não destaca nada — destaque só faz sentido com contraste. */
export function extremosLinha(valores: number[]): Extremos {
  const vazio: Extremos = { maiores: new Set(), menores: new Set() };
  if (valores.length < 2) return vazio;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  if (max === min) return vazio;
  const maiores = new Set<number>();
  const menores = new Set<number>();
  valores.forEach((v, i) => {
    if (v === max) maiores.add(i);
    if (v === min) menores.add(i);
  });
  return { maiores, menores };
}

/** Soma bruta dos 8 atributos — referência rápida, não é métrica oficial do sistema. */
export function somaAtributos(atributos: { valor: number }[]): number {
  return atributos.reduce((acc, a) => acc + a.valor, 0);
}

/** Largura (%) da barra proporcional ao máximo da linha; mínimo 4% pra ficar visível. */
export function larguraBarra(valor: number, maxLinha: number): number {
  if (valor <= 0 || maxLinha <= 0) return 0;
  return Math.min(100, Math.max(4, Math.round((valor / maxLinha) * 100)));
}
