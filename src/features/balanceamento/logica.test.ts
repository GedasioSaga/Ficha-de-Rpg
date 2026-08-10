import { describe, expect, test } from "vitest";
import { extremosLinha, larguraBarra, somaAtributos } from "./logica";

describe("extremosLinha", () => {
  test("destaca maior e menor", () => {
    const r = extremosLinha([8, 3, 5]);
    expect(r.maiores).toEqual(new Set([0]));
    expect(r.menores).toEqual(new Set([1]));
  });

  test("empate no maior destaca ambos", () => {
    const r = extremosLinha([8, 8, 5]);
    expect(r.maiores).toEqual(new Set([0, 1]));
    expect(r.menores).toEqual(new Set([2]));
  });

  test("empate no menor destaca ambos", () => {
    const r = extremosLinha([8, 3, 3]);
    expect(r.maiores).toEqual(new Set([0]));
    expect(r.menores).toEqual(new Set([1, 2]));
  });

  test("linha uniforme não destaca nada", () => {
    const r = extremosLinha([5, 5, 5]);
    expect(r.maiores.size).toBe(0);
    expect(r.menores.size).toBe(0);
  });

  test("menos de 2 valores não destaca", () => {
    expect(extremosLinha([7]).maiores.size).toBe(0);
    expect(extremosLinha([]).menores.size).toBe(0);
  });
});

describe("somaAtributos", () => {
  test("soma os valores", () => {
    expect(somaAtributos([{ valor: 3 }, { valor: 4 }])).toBe(7);
  });

  test("lista vazia soma 0", () => {
    expect(somaAtributos([])).toBe(0);
  });
});

describe("larguraBarra", () => {
  test("proporcional ao máximo da linha", () => {
    expect(larguraBarra(5, 10)).toBe(50);
  });

  test("valor pequeno mas positivo tem largura mínima 4", () => {
    expect(larguraBarra(1, 100)).toBe(4);
  });

  test("valor 0 tem barra 0 (não desenha)", () => {
    expect(larguraBarra(0, 10)).toBe(0);
  });

  test("máximo 0 ou negativo vira 0 (sem divisão por zero)", () => {
    expect(larguraBarra(5, 0)).toBe(0);
  });

  test("valor negativo vira 0", () => {
    expect(larguraBarra(-5, 10)).toBe(0);
  });

  test("valor igual ao máximo é 100", () => {
    expect(larguraBarra(10, 10)).toBe(100);
  });

  test("valor maior que o máximo tem clamp em 100", () => {
    expect(larguraBarra(20, 10)).toBe(100);
  });
});
