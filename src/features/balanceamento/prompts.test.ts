import { describe, expect, test } from "vitest";
import {
  dePersonagemCompleto,
  dePersonagemInput,
  detectarMencoes,
  idsSemFicha,
  limitarMencoes,
  MAX_FICHAS_CONTEXTO,
  montarContextoTexto,
  montarIndiceElenco,
  systemPromptPara,
  SYSTEM_PROMPT_ANALISE,
  SYSTEM_PROMPT_FICHA,
  SYSTEM_PROMPT_GERAL,
} from "./prompts";
import type {
  Catalogos,
  Nota,
  PersonagemCompleto,
  PersonagemInput,
  PersonagemResumo,
} from "../../lib/types";

const completo = {
  id: 1,
  tipo: "jogador",
  nome: "Luffy",
  descricao: "borracha",
  hp: 120,
  sp: 40,
  escudo: 0,
  retrato: "c:/img/luffy.png",
  atributos: [{ nome: "forca", valor: 8, rank: 5 }],
  habilidades: [],
  pericias: [],
  vantagens: [],
  desvantagens: [],
  transformacoes: [
    { nome: "Gear 2", descricao: "", retrato: "c:/img/g2.png", modificadores: [], habilidades: [] },
  ],
  etiquetas: [],
} as PersonagemCompleto;

const doForm = {
  tipo: "npc",
  nome: "",
  descricao: "vilão",
  hp: 300,
  sp: 50,
  escudo: 100,
  forca: 13,
  agilidade: 7,
  percepcao: 6,
  resistencia: 12,
  intuicao: 5,
  espirito: 8,
  carisma: 4,
  determinacao: 9,
  retrato: { modo: "nenhum" },
  habilidades: [
    {
      nome: "Soco",
      descricao: "d",
      acao: "Ação Completa",
      efeito: "Nenhum",
      custo: "",
      tempo: "",
      dano: "",
      campos_extras: [{ nome: "Alcance", valor: "5m", uid: "c1" }],
      uid: "x1",
    },
  ],
  pericias: [],
  vantagens: [],
  desvantagens: [],
  transformacoes: [],
  etiquetas: [],
} as PersonagemInput;

const catalogos: Catalogos = { pericias: [], vantagens: [], desvantagens: [] };

describe("dePersonagemCompleto", () => {
  test("preserva atributos com rank e remove retratos", () => {
    const f = dePersonagemCompleto(completo);
    expect(f.atributos[0]).toEqual({ nome: "forca", valor: 8, rank: 5 });
    expect(JSON.stringify(f)).not.toContain("luffy.png");
    expect(JSON.stringify(f)).not.toContain("g2.png");
  });

  test("leva o id junto, pra dedupe", () => {
    expect(dePersonagemCompleto(completo).id).toBe(1);
  });
});

describe("dePersonagemInput", () => {
  test("monta os 8 atributos sem rank e sem uid", () => {
    const f = dePersonagemInput(doForm);
    expect(f.atributos).toHaveLength(8);
    expect(f.atributos[0]).toEqual({ nome: "forca", valor: 13 });
    expect(JSON.stringify(f)).not.toContain("uid");
    expect(JSON.stringify(f)).not.toContain("retrato");
  });

  test("nome vazio vira placeholder", () => {
    expect(dePersonagemInput(doForm).nome).toBe("(sem nome)");
  });

  test("ficha nova não tem id; ficha em edição recebe o id do form", () => {
    expect(dePersonagemInput(doForm).id).toBeUndefined();
    expect(dePersonagemInput(doForm, 7).id).toBe(7);
  });
});

describe("systemPromptPara", () => {
  test("1 ficha usa prompt individual; 2+ usa comparativo", () => {
    expect(systemPromptPara(1)).toBe(SYSTEM_PROMPT_FICHA);
    expect(systemPromptPara(2)).toBe(SYSTEM_PROMPT_ANALISE);
  });

  test("sem ficha usa prompt geral", () => {
    expect(systemPromptPara(0)).toBe(SYSTEM_PROMPT_GERAL);
  });

  test("sem índice no contexto o prompt não promete o elenco", () => {
    expect(systemPromptPara(1, false)).not.toContain("ÍNDICE");
    expect(systemPromptPara(0)).not.toContain("ÍNDICE");
  });

  test("com índice o parágrafo do elenco entra depois do prompt base", () => {
    const p = systemPromptPara(1, true);
    expect(p).toContain("ÍNDICE");
    expect(p.startsWith(SYSTEM_PROMPT_FICHA)).toBe(true);
  });
});

describe("montarContextoTexto", () => {
  test("inclui fichas convertidas e corpo das notas de regras", () => {
    const nota = {
      id: 1,
      titulo: "#mecânicas",
      corpo: "rank 13 é o teto",
      criado_em: "",
      atualizado_em: "",
    } as Nota;
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [nota], catalogos);
    expect(ctx).toContain("Luffy");
    expect(ctx).toContain("rank 13 é o teto");
  });

  test("sem notas marca regras como não sincronizadas", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx).toContain("(regras não sincronizadas)");
  });

  test("índice do elenco entra em bloco próprio, antes das fichas detalhadas", () => {
    const ctx = montarContextoTexto(
      [dePersonagemCompleto(completo)],
      [],
      catalogos,
      montarIndiceElenco(elencoIndice),
    );
    expect(ctx).toContain("# ELENCO (resumo de todos os personagens)");
    expect(ctx).toContain("Vagn Kane (PJ)");
    expect(ctx.indexOf("# ELENCO")).toBeLessThan(ctx.indexOf("# FICHAS DETALHADAS"));
  });

  test("sem índice o bloco de elenco é omitido", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx).not.toContain("# ELENCO");
  });

  test("o id da ficha é interno e não vaza pro texto", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx).toContain("Luffy");
    expect(ctx).not.toContain('"id":1');
  });
});

/** Elenco de teste: `PersonagemResumo` não tem HP/SP/escudo — só os 8 atributos. */
function resumo(id: number, nome: string, extra: Partial<PersonagemResumo> = {}) {
  return {
    id,
    tipo: "jogador",
    nome,
    retrato: null,
    forca: 12,
    agilidade: 9,
    percepcao: 7,
    resistencia: 11,
    intuicao: 6,
    espirito: 8,
    carisma: 5,
    determinacao: 10,
    etiquetas: [],
    ...extra,
  } as PersonagemResumo;
}

/** Elenco reduzido: aqui a string do índice é asserida caractere a caractere. */
const elencoIndice: PersonagemResumo[] = [
  resumo(1, "Vagn Kane"),
  resumo(2, "Siegfried", { tipo: "npc", forca: 13, etiquetas: ["Marinha"] }),
];

const npc = { tipo: "npc" } as Partial<PersonagemResumo>;

/**
 * Elenco REAL do mestre (mesmos ids e nomes do banco). A detecção de menções só
 * vale se acertar contra esses nomes — foi elenco sintético que deixou passar
 * "no segundo turno" carregando a ficha do Jimboy Segundo.
 */
const elenco: PersonagemResumo[] = [
  resumo(1, "Aira"),
  resumo(2, "Harvey Solferino"),
  resumo(3, "Jimboy Segundo"),
  resumo(4, "Ryoko D. Violet"),
  resumo(5, "Siegfried"),
  resumo(6, "Vagn Kane"),
  resumo(7, "Bariarte", npc),
  resumo(8, "Barril", npc),
  resumo(9, "Escorpião", npc),
  resumo(10, "Macaco Rei", npc),
  resumo(11, "Malvadeza", npc),
  resumo(12, "Portegeist", npc),
  resumo(13, "Sea King(Goa)", npc),
  resumo(14, "Seu Sirigueijo", npc),
  resumo(15, "Zaza", npc),
  resumo(16, "Zeze", npc),
  resumo(17, "Zizi", npc),
  resumo(18, "Zozo", npc),
  resumo(19, "Zuzu", npc),
];

describe("montarIndiceElenco", () => {
  test("uma linha densa por personagem, com tipo e os 8 atributos", () => {
    const linhas = montarIndiceElenco(elencoIndice).split("\n");
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe("Vagn Kane (PJ) — FOR 12 AGI 9 PER 7 RES 11 INT 6 ESP 8 CAR 5 DET 10");
    expect(linhas[1]).toBe(
      "Siegfried (NPC) — FOR 13 AGI 9 PER 7 RES 11 INT 6 ESP 8 CAR 5 DET 10 · Marinha",
    );
  });

  test("elenco vazio devolve string vazia", () => {
    expect(montarIndiceElenco([])).toBe("");
  });
});

describe("detectarMencoes", () => {
  test("casa o nome inteiro", () => {
    expect(detectarMencoes("como está o Vagn Kane?", elenco)).toEqual([6]);
  });

  test("casa só o primeiro nome", () => {
    expect(detectarMencoes("o Vagn aguenta esse combate?", elenco)).toEqual([6]);
  });

  test("casa prefixo de 4+ letras", () => {
    expect(detectarMencoes("e o Sieg, está forte demais?", elenco)).toEqual([5]);
  });

  test("ignora acento e maiúsculas", () => {
    expect(detectarMencoes("compara ZAZA com o resto", elenco)).toEqual([15]);
  });

  test("palavra de 3 letras ou menos nunca casa", () => {
    expect(detectarMencoes("quem é o rei da mesa?", elenco)).toEqual([]);
  });

  test("não repete o mesmo personagem citado duas vezes", () => {
    expect(detectarMencoes("Vagn contra Vagn Kane", elenco)).toEqual([6]);
  });

  test("devolve na ordem de aparição no texto", () => {
    expect(detectarMencoes("faz uma comparação entre Sieg e Vagn", elenco)).toEqual([5, 6]);
    expect(detectarMencoes("faz uma comparação entre Vagn e Sieg", elenco)).toEqual([6, 5]);
  });

  test("ordem estável com três menções", () => {
    expect(detectarMencoes("compara Vagn, Sieg e Aira", elenco)).toEqual([6, 5, 1]);
  });

  test("sem menção nenhuma devolve lista vazia", () => {
    expect(detectarMencoes("qual o teto de rank do sistema?", elenco)).toEqual([]);
  });

  test("nome cujo primeiro termo é curto casa pelo termo longo", () => {
    expect(detectarMencoes("o Seu Sirigueijo apareceu", elenco)).toEqual([14]);
    expect(detectarMencoes("e o Sea King?", elenco)).toEqual([13]);
  });

  test("pontuação no nome não gruda no termo seguinte", () => {
    // Só casa se "Sea King(Goa)" for tokenizado como sea/king/goa.
    expect(detectarMencoes("os kings do East Blue", elenco)).toEqual([13]);
  });

  test("citar um Z não arrasta a família inteira", () => {
    expect(detectarMencoes("como está o Zaza?", elenco)).toEqual([15]);
    expect(detectarMencoes("Zuzu e Zozo brigaram", elenco)).toEqual([19, 18]);
  });

  test("flexão curta do nome ainda casa", () => {
    expect(detectarMencoes("os escorpiões atacam a vila", elenco)).toEqual([9]);
    expect(detectarMencoes("e a Violeta, está bem?", elenco)).toEqual([4]);
    expect(detectarMencoes("os macacos fugiram", elenco)).toEqual([10]);
  });
});

describe("detectarMencoes — falsos positivos", () => {
  test("'segundo' não carrega o Jimboy Segundo", () => {
    expect(detectarMencoes("no segundo turno, quanto de dano o inimigo faz?", elenco)).toEqual([]);
    expect(detectarMencoes("segundo as regras, qual o teto de rank?", elenco)).toEqual([]);
    expect(detectarMencoes("espera 30 segundos antes de atacar", elenco)).toEqual([]);
  });

  test("'porte' não carrega o Portegeist", () => {
    expect(detectarMencoes("um ataque de grande porte quebra o escudo?", elenco)).toEqual([]);
  });

  test("'siri' não carrega o Seu Sirigueijo", () => {
    expect(detectarMencoes("ele pesca um siri no porto", elenco)).toEqual([]);
  });

  test("o nome inteiro ainda casa, mesmo com palavra comum no meio", () => {
    expect(detectarMencoes("o Jimboy Segundo aguenta?", elenco)).toEqual([3]);
    expect(detectarMencoes("o Portegeist ataca primeiro", elenco)).toEqual([12]);
  });
});

describe("limitarMencoes", () => {
  test("corta no teto de fichas do contexto", () => {
    expect(limitarMencoes([1, 2, 3, 4, 5, 6], 0)).toEqual([1, 2, 3, 4]);
    expect(MAX_FICHAS_CONTEXTO).toBe(4);
  });

  test("desconta as fichas que já estão no contexto", () => {
    expect(limitarMencoes([1, 2, 3, 4, 5], 1)).toEqual([1, 2, 3]);
  });

  test("contexto já cheio não aceita mais ficha citada", () => {
    expect(limitarMencoes([1, 2], 4)).toEqual([]);
    expect(limitarMencoes([1, 2], 9)).toEqual([]);
  });

  test("abaixo do teto devolve tudo, na ordem", () => {
    expect(limitarMencoes([7, 3], 1)).toEqual([7, 3]);
  });
});

describe("idsSemFicha", () => {
  test("descarta quem já tem ficha detalhada no contexto", () => {
    const fichas = [dePersonagemCompleto({ ...completo, id: 5, nome: "Siegfried" })];
    expect(idsSemFicha([6, 5], elenco, fichas)).toEqual([6]);
  });

  test("id já no contexto é descartado mesmo com nome diferente (rename em curso)", () => {
    const fichas = [dePersonagemInput({ ...doForm, nome: "Vagn Kane II" }, 6)];
    expect(idsSemFicha([6, 5], elenco, fichas)).toEqual([5]);
  });

  test("ficha do form ainda sem id dedupa por nome, sem acento e sem caixa", () => {
    const fichas = [dePersonagemInput({ ...doForm, nome: "ZAZÁ" })];
    expect(idsSemFicha([15], elenco, fichas)).toEqual([]);
  });

  test("id fora do elenco é descartado", () => {
    expect(idsSemFicha([99], elenco, [])).toEqual([]);
  });
});
