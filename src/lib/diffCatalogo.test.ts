import { describe, expect, test } from "vitest";
import { concatenarMensagens, diffPorNome } from "./diffCatalogo";
import type { MensagemCanal } from "./types";

const msg = (texto: string): MensagemCanal => ({ autor: "Mestre", texto, timestamp: "" });

describe("concatenarMensagens", () => {
  test("junta textos com linha em branco, ignorando vazios", () => {
    expect(concatenarMensagens([msg("a"), msg(""), msg("b")])).toBe("a\n\nb");
  });

  test("lista vazia vira string vazia", () => {
    expect(concatenarMensagens([])).toBe("");
  });
});

interface Atual { id: number; nome: string; descricao: string; }
interface Nova { nome: string; descricao: string; }

const iguais = (a: Atual, n: Nova) => a.descricao === n.descricao;

describe("diffPorNome", () => {
  const atuais: Atual[] = [
    { id: 1, nome: "Furtividade", descricao: "andar quieto" },
    { id: 2, nome: "Pesca", descricao: "pescar" },
  ];

  test("nome inexistente entra em criar", () => {
    const d = diffPorNome(atuais, [{ nome: "Culinária", descricao: "cozinhar" }], iguais);
    expect(d.criar).toEqual([{ nome: "Culinária", descricao: "cozinhar" }]);
    expect(d.atualizar).toEqual([]);
  });

  test("nome existente com conteúdo diferente entra em atualizar (leva o id)", () => {
    const d = diffPorNome(atuais, [{ nome: "Pesca", descricao: "pescar melhor" }], iguais);
    expect(d.atualizar).toEqual([
      { id: 2, nomeAtual: "Pesca", nova: { nome: "Pesca", descricao: "pescar melhor" } },
    ]);
  });

  test("nome existente idêntico entra em manter", () => {
    const d = diffPorNome(atuais, [{ nome: "Pesca", descricao: "pescar" }], iguais);
    expect(d.manter).toEqual(["Pesca"]);
    expect(d.atualizar).toEqual([]);
  });

  test("casamento de nome é case-insensitive e ignora espaços das pontas", () => {
    const d = diffPorNome(atuais, [{ nome: "  FURTIVIDADE ", descricao: "andar quieto" }], iguais);
    expect(d.manter).toEqual(["Furtividade"]);
  });

  test("duplicata na extração: a última ganha", () => {
    const d = diffPorNome(
      atuais,
      [
        { nome: "Culinária", descricao: "v1" },
        { nome: "culinária", descricao: "v2" },
      ],
      iguais,
    );
    expect(d.criar).toEqual([{ nome: "culinária", descricao: "v2" }]);
  });
});
