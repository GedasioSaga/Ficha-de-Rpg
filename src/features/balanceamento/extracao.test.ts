import { describe, expect, test, vi } from "vitest";
import { extrairPericias, extrairTracos } from "./extracao";

describe("extrairPericias", () => {
  test("parseia o JSON devolvido pelo modelo", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"Pesca","descricao":"pescar","atributo":"percepcao"}]');
    const r = await extrairPericias("texto do canal", gerarFn);
    expect(r).toEqual([{ nome: "Pesca", descricao: "pescar", atributo: "percepcao" }]);
    // prompt leva o texto do canal e pede schema JSON
    expect(gerarFn.mock.calls[0][0][0].texto).toContain("texto do canal");
    expect(gerarFn.mock.calls[0][1].responseSchema).toBeTruthy();
  });

  test("JSON malformado vira erro legível (nada de gravar parcial)", async () => {
    const gerarFn = vi.fn().mockResolvedValue("desculpa, não consegui");
    await expect(extrairPericias("x", gerarFn)).rejects.toThrow(/extração/i);
  });

  test("entrada sem nome é descartada", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"","descricao":"d","atributo":"forca"},{"nome":"Ok","descricao":"d","atributo":"forca"}]');
    const r = await extrairPericias("x", gerarFn);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Ok");
  });
});

describe("extrairTracos", () => {
  test("parseia nome/descricao/efeito", async () => {
    const gerarFn = vi
      .fn()
      .mockResolvedValue('[{"nome":"Sortudo","descricao":"d","efeito":"+1 em tudo"}]');
    const r = await extrairTracos("vantagens do canal", "vantagem", gerarFn);
    expect(r).toEqual([{ nome: "Sortudo", descricao: "d", efeito: "+1 em tudo" }]);
  });
});
