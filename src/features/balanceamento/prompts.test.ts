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
  selecionarNotasRegras,
  systemPromptPara,
  SYSTEM_PROMPT_ANALISE,
  SYSTEM_PROMPT_FICHA,
  SYSTEM_PROMPT_GERAL,
} from "./prompts";
import type { FichaParaContexto } from "./prompts";
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
  raca: "Humano",
  oficio: "",
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
  raca: "Ogro",
  oficio: "Ferreiro",
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

  test("leva raça, ofício e etiquetas — não descarta em silêncio", () => {
    const f = dePersonagemCompleto({ ...completo, etiquetas: ["Marinha"] });
    expect(f.raca).toBe("Humano");
    expect(f.oficio).toBe("");
    expect(f.etiquetas).toEqual(["Marinha"]);
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

  test("leva raça e ofício do form", () => {
    const f = dePersonagemInput(doForm);
    expect(f.raca).toBe("Ogro");
    expect(f.oficio).toBe("Ferreiro");
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

  test("seção omitida vira uma linha, não silêncio", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos, "", [
      "#pericias",
    ]);
    expect(ctx).toContain('(seção "#pericias" não enviada nesta pergunta — peça se precisar)');
  });

  test("repete a regra de ouro no fim do bloco, antes da pergunta do mestre", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx.trim().endsWith("desvantagem que não esteja aqui.")).toBe(true);
  });

  test("ficha citada que falhou ao carregar vira uma linha declarada, não silêncio", () => {
    const ctx = montarContextoTexto(
      [dePersonagemCompleto(completo)],
      [],
      catalogos,
      "",
      [],
      ["Vagn Kane"],
    );
    expect(ctx).toContain(
      "(ficha detalhada de Vagn Kane não pôde ser carregada — só o resumo do índice está disponível)",
    );
  });

  test("sem ficha falhada não aparece a seção", () => {
    const ctx = montarContextoTexto([dePersonagemCompleto(completo)], [], catalogos);
    expect(ctx).not.toContain("FICHAS QUE FALHARAM");
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
    raca: "",
    ...extra,
  } as PersonagemResumo;
}

/** Elenco reduzido: aqui a string do índice é asserida caractere a caractere. */
const elencoIndice: PersonagemResumo[] = [
  resumo(1, "Vagn Kane", { raca: "Humano" }),
  resumo(2, "Siegfried", { tipo: "npc", forca: 13, raca: "Ogro", etiquetas: ["Marinha"] }),
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
    expect(linhas[0]).toBe(
      "Vagn Kane (PJ) — FOR 12 AGI 9 PER 7 RES 11 INT 6 ESP 8 CAR 5 DET 10 · Humano",
    );
    expect(linhas[1]).toBe(
      "Siegfried (NPC) — FOR 13 AGI 9 PER 7 RES 11 INT 6 ESP 8 CAR 5 DET 10 · Ogro, Marinha",
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

/** Nota de regra mínima — só o que `selecionarNotasRegras` olha. */
function nota(titulo: string, corpo = "x"): Nota {
  return { id: Math.random(), titulo, corpo, criado_em: "", atualizado_em: "" } as Nota;
}

const NOTAS_REGRAS = [
  nota("#mecânicas"),
  nota("#status"),
  nota("#ações-de-combate"),
  nota("#humano"),
  nota("#ogro"),
  nota("#mink"),
  nota("#pericias"),
  nota("#vantagens"),
  nota("#desvantagens"),
  nota("#oficios"),
  nota("#akuma-no-mi"),
  nota("#dicas-do-mestre"), // título fora de qualquer categoria conhecida
];

function ficha(raca: string): FichaParaContexto {
  return dePersonagemInput({ ...doForm, raca });
}

describe("selecionarNotasRegras", () => {
  test("o núcleo (mecânicas/status/ações-de-combate) sempre entra", () => {
    const { incluidas } = selecionarNotasRegras("qualquer pergunta banal", [], NOTAS_REGRAS);
    const titulos = incluidas.map((n) => n.titulo);
    expect(titulos).toContain("#mecânicas");
    expect(titulos).toContain("#status");
    expect(titulos).toContain("#ações-de-combate");
  });

  test("raça da ficha no contexto traz a nota de raça, mesmo sem citar na pergunta", () => {
    const { incluidas } = selecionarNotasRegras("como ele se sai?", [ficha("Ogro")], NOTAS_REGRAS);
    expect(incluidas.map((n) => n.titulo)).toContain("#ogro");
    expect(incluidas.map((n) => n.titulo)).not.toContain("#humano");
  });

  test("raça citada na pergunta traz a nota, mesmo sem ficha nenhuma", () => {
    const { incluidas } = selecionarNotasRegras("como o Humano se compara ao Ogro?", [], NOTAS_REGRAS);
    const titulos = incluidas.map((n) => n.titulo);
    expect(titulos).toContain("#humano");
    expect(titulos).toContain("#ogro");
  });

  test("palavra-chave da pergunta traz só a nota correspondente", () => {
    const { incluidas, omitidas } = selecionarNotasRegras("quanto vale essa perícia?", [], NOTAS_REGRAS);
    expect(incluidas.map((n) => n.titulo)).toContain("#pericias");
    expect(omitidas).toContain("#vantagens");
  });

  test("'desvantagem' não arrasta '#vantagens' junto", () => {
    const { incluidas } = selecionarNotasRegras("essa desvantagem é forte demais", [], NOTAS_REGRAS);
    const titulos = incluidas.map((n) => n.titulo);
    expect(titulos).toContain("#desvantagens");
    expect(titulos).not.toContain("#vantagens");
  });

  test("citar o nome de um ofício conta como pedir #oficios", () => {
    const { incluidas } = selecionarNotasRegras("um Ferreiro consegue fazer isso?", [], NOTAS_REGRAS);
    expect(incluidas.map((n) => n.titulo)).toContain("#oficios");
  });

  test("tudo = true ignora o filtro inteiro", () => {
    const { incluidas, omitidas } = selecionarNotasRegras("oi", [], NOTAS_REGRAS, true);
    expect(incluidas).toHaveLength(NOTAS_REGRAS.length);
    expect(omitidas).toEqual([]);
  });

  test("título desconhecido pelo mapa de categorias sempre entra", () => {
    const { incluidas, omitidas } = selecionarNotasRegras("pergunta qualquer", [], NOTAS_REGRAS);
    expect(incluidas.map((n) => n.titulo)).toContain("#dicas-do-mestre");
    expect(omitidas).not.toContain("#dicas-do-mestre");
  });

  test("título duplicado na config entra uma vez só", () => {
    const { incluidas } = selecionarNotasRegras("oi", [], [...NOTAS_REGRAS, nota("#mecânicas")]);
    expect(incluidas.filter((n) => n.titulo === "#mecânicas")).toHaveLength(1);
  });

  test("raça no PLURAL na pergunta ainda traz a nota — \\b não casa fronteira letra→letra", () => {
    const { incluidas } = selecionarNotasRegras(
      "Como os Ogros se comparam aos Humanos em combate?",
      [],
      NOTAS_REGRAS,
    );
    const titulos = incluidas.map((n) => n.titulo);
    expect(titulos).toContain("#ogro");
    expect(titulos).toContain("#humano");
  });

  test("'frutas'/'logias' no plural ainda trazem #akuma-no-mi", () => {
    expect(
      selecionarNotasRegras("essas frutas do tipo logias são raras?", [], NOTAS_REGRAS).incluidas.map(
        (n) => n.titulo,
      ),
    ).toContain("#akuma-no-mi");
  });

  test("nome de ofício no PLURAL também conta como pedir #oficios", () => {
    const { incluidas } = selecionarNotasRegras("os ferreiros dessa vila são bons?", [], NOTAS_REGRAS);
    expect(incluidas.map((n) => n.titulo)).toContain("#oficios");
  });

  test("raiz curta não casa palavra maior por coincidência (falso positivo)", () => {
    // "mink" não pode casar "minkowski" nem "minigame" — a raiz é curta demais
    // pra sustentar a diferença de letras (MAX_LETRAS_FLEXAO).
    const { incluidas } = selecionarNotasRegras(
      "essa curva de minkowski explica o minigame?",
      [],
      NOTAS_REGRAS,
    );
    expect(incluidas.map((n) => n.titulo)).not.toContain("#mink");
  });
});
