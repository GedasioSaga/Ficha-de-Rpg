// src/lib/gemini.test.ts
import { describe, expect, test, vi } from "vitest";
import {
  ErroCotaEsgotada,
  ErroSemChave,
  extrairTexto,
  gerarConteudo,
  imagemDeDataUrl,
  MODELO_PADRAO,
  MODELOS_GEMINI,
  montarCorpo,
  parseChaves,
} from "./gemini";

/** Config fake em memória. */
function configFake(inicial: Record<string, string>) {
  const dados = { ...inicial };
  return {
    obterConfig: async (chave: string) => dados[chave] ?? null,
    gravarConfig: async (chave: string, valor: string) => {
      dados[chave] = valor;
    },
    dados,
  };
}

function respostaOk(texto: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
    { status: 200 },
  );
}

const resposta429 = () => new Response("quota", { status: 429 });

describe("montarCorpo", () => {
  test("inclui system_instruction e contents com roles", () => {
    const corpo = montarCorpo(
      [{ role: "user", texto: "oi" }, { role: "model", texto: "olá" }],
      { systemPrompt: "seja breve" },
    ) as Record<string, unknown>;
    expect(corpo).toEqual({
      system_instruction: { parts: [{ text: "seja breve" }] },
      contents: [
        { role: "user", parts: [{ text: "oi" }] },
        { role: "model", parts: [{ text: "olá" }] },
      ],
    });
  });

  test("responseSchema liga generationConfig JSON", () => {
    const schema = { type: "ARRAY", items: { type: "STRING" } };
    const corpo = montarCorpo([{ role: "user", texto: "x" }], {
      responseSchema: schema,
    }) as { generationConfig?: Record<string, unknown> };
    expect(corpo.generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: schema,
    });
  });

  test("mensagem com imagens inclui inline_data com mime_type/data", () => {
    const corpo = montarCorpo([
      {
        role: "user",
        texto: "o que acha?",
        imagens: [{ mimeType: "image/png", base64: "AAA" }],
      },
    ]) as { contents: { parts: unknown[] }[] };
    expect(corpo.contents[0].parts).toEqual([
      { text: "o que acha?" },
      { inline_data: { mime_type: "image/png", data: "AAA" } },
    ]);
  });

  test("mensagem sem imagens continua com parts: [{ text }] exato", () => {
    const corpo = montarCorpo([
      { role: "user", texto: "oi" },
    ]) as { contents: { parts: unknown[] }[] };
    expect(corpo.contents[0].parts).toEqual([{ text: "oi" }]);
  });

  test("mensagem com 2 imagens gera 1 part de texto + 2 parts de imagem, nessa ordem", () => {
    const corpo = montarCorpo([
      {
        role: "user",
        texto: "compara",
        imagens: [
          { mimeType: "image/png", base64: "AAA" },
          { mimeType: "image/jpeg", base64: "BBB" },
        ],
      },
    ]) as { contents: { parts: unknown[] }[] };
    expect(corpo.contents[0].parts).toEqual([
      { text: "compara" },
      { inline_data: { mime_type: "image/png", data: "AAA" } },
      { inline_data: { mime_type: "image/jpeg", data: "BBB" } },
    ]);
  });
});

describe("imagemDeDataUrl", () => {
  test("data URL png válida vira ImagemIA", () => {
    expect(imagemDeDataUrl("data:image/png;base64,AAA")).toEqual({
      mimeType: "image/png",
      base64: "AAA",
    });
  });

  test("data URL jpeg válida vira ImagemIA", () => {
    expect(imagemDeDataUrl("data:image/jpeg;base64,BBB")).toEqual({
      mimeType: "image/jpeg",
      base64: "BBB",
    });
  });

  test("null, undefined e string vazia viram null", () => {
    expect(imagemDeDataUrl(null)).toBeNull();
    expect(imagemDeDataUrl(undefined)).toBeNull();
    expect(imagemDeDataUrl("")).toBeNull();
  });

  test("URL que não é data URL vira null", () => {
    expect(imagemDeDataUrl("https://exemplo.com/x.png")).toBeNull();
  });

  test("data URL sem base64 vira null", () => {
    expect(imagemDeDataUrl("data:image/png,SEMBASE64")).toBeNull();
  });
});

describe("extrairTexto", () => {
  test("concatena parts do primeiro candidato", () => {
    expect(
      extrairTexto({
        candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }],
      }),
    ).toBe("ab");
  });

  test("resposta sem candidato vira erro legível", () => {
    expect(() => extrairTexto({})).toThrow(/resposta vazia/i);
  });
});

describe("gerarConteudo — failover", () => {
  test("sem chave configurada lança ErroSemChave", async () => {
    const cfg = configFake({});
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], {
        fetchFn: vi.fn(),
        ...cfg,
      }),
    ).rejects.toBeInstanceOf(ErroSemChave);
  });

  test("sucesso na primeira chave usa header x-goog-api-key", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("resp"));
    const r = await gerarConteudo([{ role: "user", texto: "x" }], {
      fetchFn,
      ...cfg,
    });
    expect(r).toBe("resp");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain(`/models/${MODELO_PADRAO}:generateContent`);
    expect(init.headers["x-goog-api-key"]).toBe("k1");
  });

  test("429 na 1ª cai pra 2ª, persiste índice e avisa a UI", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2,k3" });
    const aoTrocarChave = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resposta429())
      .mockResolvedValueOnce(respostaOk("ok2"));
    const r = await gerarConteudo([{ role: "user", texto: "x" }], {
      fetchFn,
      aoTrocarChave,
      ...cfg,
    });
    expect(r).toBe("ok2");
    expect(fetchFn.mock.calls[1][1].headers["x-goog-api-key"]).toBe("k2");
    expect(cfg.dados.gemini_chave_ativa).toBe("1");
    expect(aoTrocarChave).toHaveBeenCalledWith(1);
  });

  test("começa da chave ativa persistida", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2,k3", gemini_chave_ativa: "2" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(fetchFn.mock.calls[0][1].headers["x-goog-api-key"]).toBe("k3");
  });

  test("índice ativo fora do range é clampado pra última chave", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2", gemini_chave_ativa: "10" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(fetchFn.mock.calls[0][1].headers["x-goog-api-key"]).toBe("k2");
  });

  test("todas em 429 lança ErroCotaEsgotada", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(resposta429());
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg }),
    ).rejects.toBeInstanceOf(ErroCotaEsgotada);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("erro não-429 propaga com status", async () => {
    const cfg = configFake({ gemini_api_keys: "k1,k2" });
    const fetchFn = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(
      gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg }),
    ).rejects.toThrow(/500/);
    expect(fetchFn).toHaveBeenCalledTimes(1); // não faz failover em erro não-cota
  });

  test("modelo configurado substitui o default", async () => {
    const cfg = configFake({ gemini_api_keys: "k1", gemini_modelo: "gemini-3.5-flash" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(String(fetchFn.mock.calls[0][0])).toContain("gemini-3.5-flash");
  });

  test("modelo fora do catálogo cai no padrão em vez de dar 404", async () => {
    const cfg = configFake({ gemini_api_keys: "k1", gemini_modelo: "gemini-1.0-inexistente" });
    const fetchFn = vi.fn().mockResolvedValue(respostaOk("ok"));
    await gerarConteudo([{ role: "user", texto: "x" }], { fetchFn, ...cfg });
    expect(String(fetchFn.mock.calls[0][0])).toContain(`/models/${MODELO_PADRAO}:`);
  });
});

describe("parseChaves", () => {
  test("apara espaços e descarta itens vazios", () => {
    expect(parseChaves(" k1 , ,k2,, k3 ")).toEqual(["k1", "k2", "k3"]);
  });

  test("null, undefined e string vazia viram lista vazia", () => {
    expect(parseChaves(null)).toEqual([]);
    expect(parseChaves(undefined)).toEqual([]);
    expect(parseChaves("")).toEqual([]);
  });
});

describe("catálogo de modelos", () => {
  test("está ordenado do mais barato ao mais caro pelo preço de saída", () => {
    const saidas = MODELOS_GEMINI.map((m) => m.precoSaida);
    expect(saidas).toEqual([...saidas].sort((a, b) => a - b));
  });

  test("o padrão é o primeiro (mais barato) da lista", () => {
    expect(MODELO_PADRAO).toBe(MODELOS_GEMINI[0].id);
  });

  test("não tem id repetido", () => {
    const ids = MODELOS_GEMINI.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
