// src/lib/markdown.test.ts
import { describe, expect, test } from "vitest";
import { parseMarkdown, segmentar } from "./markdown";

describe("segmentar", () => {
  test("texto simples vira um segmento", () => {
    expect(segmentar("oi")).toEqual([{ texto: "oi", negrito: false }]);
  });

  test("**negrito** intercala segmentos", () => {
    expect(segmentar("a **b** c")).toEqual([
      { texto: "a ", negrito: false },
      { texto: "b", negrito: true },
      { texto: " c", negrito: false },
    ]);
  });

  test("asterisco solto não quebra", () => {
    expect(segmentar("2 * 3")).toEqual([{ texto: "2 * 3", negrito: false }]);
  });

  test("** desbalanceado vira texto literal (sem negrito fantasma)", () => {
    expect(segmentar("**a**b**c")).toEqual([{ texto: "**a**b**c", negrito: false }]);
  });

  test("linha só de delimitadores preserva o literal", () => {
    expect(segmentar("****")).toEqual([{ texto: "****", negrito: false }]);
  });
});

describe("parseMarkdown", () => {
  test("títulos, itens e parágrafos", () => {
    const blocos = parseMarkdown("## Resumo\n\n- item um\n- item dois\n\ntexto final");
    expect(blocos).toEqual([
      { tipo: "titulo", nivel: 2, segmentos: [{ texto: "Resumo", negrito: false }] },
      { tipo: "item", segmentos: [{ texto: "item um", negrito: false }] },
      { tipo: "item", segmentos: [{ texto: "item dois", negrito: false }] },
      { tipo: "paragrafo", segmentos: [{ texto: "texto final", negrito: false }] },
    ]);
  });

  test("### vira nível 3; # vira nível 2 (não usamos h1)", () => {
    expect(parseMarkdown("### Sub")[0]).toMatchObject({ tipo: "titulo", nivel: 3 });
    expect(parseMarkdown("# Top")[0]).toMatchObject({ tipo: "titulo", nivel: 2 });
  });

  test("* também é marcador de item", () => {
    expect(parseMarkdown("* item")[0].tipo).toBe("item");
  });

  test("linhas vazias não geram bloco", () => {
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});
