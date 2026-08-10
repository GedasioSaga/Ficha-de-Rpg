import type {
  Catalogos,
  HabilidadeDto,
  ModificadorDto,
  Nota,
  PericiaDto,
  PersonagemCompleto,
  PersonagemInput,
  PersonagemResumo,
  Tipo,
  TracoDto,
} from "../../lib/types";
import { ABREV_ATRIBUTO, ATRIBUTOS } from "../characters/atributos";

/** Ficha no formato neutro que vira contexto da IA — vale pra ficha salva OU form. */
export interface FichaParaContexto {
  /**
   * Id do personagem salvo. Serve só pra dedupe (o nome muda no meio de um
   * rename, o id não) e é removido antes de o contexto virar texto.
   */
  id?: number;
  tipo: Tipo;
  nome: string;
  descricao: string;
  hp: number;
  sp: number;
  escudo: number;
  /** `rank` ausente quando a ficha vem do form (não salva) — a IA infere pelas regras. */
  atributos: { nome: string; valor: number; rank?: number }[];
  habilidades: HabilidadeDto[];
  pericias: PericiaDto[];
  vantagens: TracoDto[];
  desvantagens: TracoDto[];
  transformacoes: {
    nome: string;
    descricao: string;
    modificadores: ModificadorDto[];
    habilidades: HabilidadeDto[];
  }[];
}

/** Remove a chave client-only de render (`uid`) — ruído pro modelo. */
function semUid<T extends { uid?: string }>(lista: T[]): Omit<T, "uid">[] {
  return lista.map(({ uid: _u, ...resto }) => resto);
}

/**
 * Técnica sem `uid` — inclusive o dos campos personalizados, que são aninhados.
 * `campos_extras` tolera ausência: a técnica pode vir de um backend anterior à
 * migration 0011 (app aberto antes do rebuild) ou de um JSON de import editado à
 * mão, e montar o contexto da IA não pode derrubar a tela inteira por isso.
 */
function habilidadesLimpas(lista: HabilidadeDto[]) {
  return semUid(lista ?? []).map((h) => ({
    ...h,
    campos_extras: semUid(h.campos_extras ?? []),
  }));
}

export function dePersonagemCompleto(p: PersonagemCompleto): FichaParaContexto {
  return {
    id: p.id,
    tipo: p.tipo,
    nome: p.nome,
    descricao: p.descricao,
    hp: p.hp,
    sp: p.sp,
    escudo: p.escudo,
    atributos: p.atributos.map(({ nome, valor, rank }) => ({ nome, valor, rank })),
    habilidades: habilidadesLimpas(p.habilidades),
    pericias: p.pericias,
    vantagens: p.vantagens,
    desvantagens: p.desvantagens,
    transformacoes: p.transformacoes.map(({ retrato: _r, habilidades, ...t }) => ({
      ...t,
      habilidades: habilidadesLimpas(habilidades),
    })),
  };
}

/** `id` só existe quando a ficha do form já foi salva — é o que dedupa depois de um rename. */
export function dePersonagemInput(input: PersonagemInput, id?: number): FichaParaContexto {
  return {
    id,
    tipo: input.tipo,
    nome: input.nome || "(sem nome)",
    descricao: input.descricao,
    hp: input.hp,
    sp: input.sp,
    escudo: input.escudo,
    atributos: ATRIBUTOS.map((nome) => ({ nome, valor: input[nome] })),
    habilidades: habilidadesLimpas(input.habilidades),
    pericias: semUid(input.pericias),
    vantagens: semUid(input.vantagens),
    desvantagens: semUid(input.desvantagens),
    transformacoes: input.transformacoes.map((t) => ({
      nome: t.nome,
      descricao: t.descricao,
      modificadores: semUid(t.modificadores),
      habilidades: habilidadesLimpas(t.habilidades),
    })),
  };
}

/* ------------------------- Índice do elenco e menções ---------------------- */

const ROTULO_TIPO: Record<Tipo, string> = { jogador: "PJ", npc: "NPC" };

/**
 * Linha densa por personagem: o que basta pra IA saber quem existe e comparar
 * grosso. `PersonagemResumo` não traz HP/SP/escudo — esses vêm na ficha
 * detalhada, carregada quando o mestre cita o nome.
 */
export function montarIndiceElenco(resumos: PersonagemResumo[]): string {
  return (resumos ?? [])
    .map((p) => {
      const atributos = ATRIBUTOS.map((a) => `${ABREV_ATRIBUTO[a]} ${p[a] ?? 0}`).join(" ");
      const etiquetas = (p.etiquetas ?? []).length > 0 ? ` · ${p.etiquetas.join(", ")}` : "";
      return `${p.nome} (${ROTULO_TIPO[p.tipo]}) — ${atributos}${etiquetas}`;
    })
    .join("\n");
}

/** Marcas de acento que a decomposição NFD separa da letra base. */
const ACENTOS_COMBINANTES = /\p{Diacritic}/gu;

/** Minúsculas e sem acento, dos dois lados do casamento de nome. */
function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(ACENTOS_COMBINANTES, "").toLowerCase();
}

/** Abaixo disso o pedaço é ambíguo demais ("Rei", "de") e nunca casa. */
const MIN_LETRAS_MENCAO = 4;

/** Letras a mais que uma flexão pode ter sobre o nome ("macacos" → "macaco"). */
const MAX_LETRAS_FLEXAO = 2;

/**
 * Palavras comuns de mesa que também são pedaço de nome do elenco e disparavam
 * ficha inteira à toa: "no segundo turno" carregava Jimboy Segundo, "de grande
 * porte" carregava Portegeist, "um siri" carregava Seu Sirigueijo. Nenhum
 * personagem se chama SÓ por uma dessas — quem é citado de verdade casa por
 * outra palavra do nome ("Jimboy", "Portegeist", "Sirigueijo").
 */
const PALAVRAS_COMUNS = new Set([
  "segundo",
  "segundos",
  "segunda",
  "segundas",
  "primeiro",
  "primeira",
  "terceiro",
  "terceira",
  "porte",
  "portes",
  "siri",
  "siris",
  "parte",
  "partes",
  "sobre",
  "contra",
  "entre",
]);

/** Palavras (letras/números) com a posição — mesmo corte nos dois lados do casamento. */
function palavrasDe(textoNormalizado: string): { palavra: string; posicao: number }[] {
  return [...textoNormalizado.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    palavra: m[0],
    posicao: m.index ?? 0,
  }));
}

/**
 * Casa uma palavra do texto contra uma palavra do nome:
 * - prefixo do nome ("sieg" → "siegfried"), que é como o mestre abrevia;
 * - flexão curta do nome ("macacos" → "macaco", "violeta" → "violet"), incluindo
 *   o plural em -ões, que sem acento vira "-oes" ("escorpioes" → "escorpiao").
 * A flexão só vale pra palavra de nome já longa, senão "reino" casaria "Rei".
 */
function casaPalavraNome(palavraNome: string, token: string): boolean {
  if (palavraNome.startsWith(token)) return true;
  if (palavraNome.length < MIN_LETRAS_MENCAO) return false;
  return [token, token.replace(/oes$/, "ao")].some(
    (v) => v.startsWith(palavraNome) && v.length - palavraNome.length <= MAX_LETRAS_FLEXAO,
  );
}

/**
 * Ids dos personagens citados no texto da pergunta, sem acento e sem diferenciar
 * maiúsculas. Ordem = ordem de aparição.
 */
export function detectarMencoes(texto: string, resumos: PersonagemResumo[]): number[] {
  const palavrasTexto = palavrasDe(normalizarTexto(texto)).filter(
    (t) => t.palavra.length >= MIN_LETRAS_MENCAO && !PALAVRAS_COMUNS.has(t.palavra),
  );

  const achados: { id: number; posicao: number }[] = [];
  for (const p of resumos) {
    const palavrasNome = palavrasDe(normalizarTexto(p.nome)).map((n) => n.palavra);
    let posicao = Infinity;
    for (const t of palavrasTexto) {
      if (palavrasNome.some((n) => casaPalavraNome(n, t.palavra))) {
        posicao = Math.min(posicao, t.posicao);
      }
    }
    if (posicao < Infinity) achados.push({ id: p.id, posicao });
  }
  return achados.sort((a, b) => a.posicao - b.posicao).map((a) => a.id);
}

/**
 * Dos ids mencionados, os que ainda não têm ficha detalhada no contexto. Dedupe
 * por id, que sobrevive a rename; o nome só decide pra ficha do form ainda sem
 * id (personagem novo), onde é o único dado disponível.
 */
export function idsSemFicha(
  ids: number[],
  resumos: PersonagemResumo[],
  fichas: FichaParaContexto[],
): number[] {
  const idsNoContexto = new Set(fichas.map((f) => f.id).filter((id) => id !== undefined));
  const nomesSemId = new Set(
    fichas.filter((f) => f.id === undefined).map((f) => normalizarTexto(f.nome)),
  );
  return ids.filter((id) => {
    if (idsNoContexto.has(id)) return false;
    const resumo = resumos.find((p) => p.id === id);
    return resumo !== undefined && !nomesSemId.has(normalizarTexto(resumo.nome));
  });
}

/**
 * Teto de fichas detalhadas por pergunta: cada uma pesa 3-15 mil caracteres,
 * ordens de grandeza acima do índice do elenco inteiro. 4 cobre "compara A, B e
 * C" dentro do editor (a ficha aberta + 3 citadas) e trava o pior caso.
 */
export const MAX_FICHAS_CONTEXTO = 4;

/** Corta as menções que não cabem no teto — a ordem já é a de aparição no texto. */
export function limitarMencoes(ids: number[], jaNoContexto: number): number[] {
  return ids.slice(0, Math.max(0, MAX_FICHAS_CONTEXTO - jaNoContexto));
}

const CABECALHO_SYSTEM = `Você é o assistente do mestre de um RPG de mesa homebrew inspirado em One Piece. Responda sempre em português do Brasil, direto ao ponto.

Você recebe: as regras do sistema (quando sincronizadas do Discord), os catálogos de perícias/vantagens/desvantagens e as fichas em discussão — 8 atributos com rank 0–13, HP/SP/escudo, habilidades (com custo, dano e cooldown em texto livre), transformações, perícias com nível, vantagens e desvantagens.

O mestre pode te pedir três coisas:
1. CONVERSA — dúvidas sobre fichas, regras e criação de personagem.
2. EQUILÍBRIO — comparar personagens, apontar quem está acima/abaixo da curva e sugerir ajustes NUMÉRICOS concretos.
3. SIMULAÇÃO DE COMBATE — ex.: "quanto tempo esse jogador sobrevive contra 3 soldados?". Nesse caso: use as REGRAS fornecidas (dado de reação, iniciativa, custos, cooldowns) e considere TUDO da ficha — habilidades ativas E passivas, perícias, vantagens/desvantagens, transformações e escudo. Estime rodada a rodada (dano de cada lado, HP/SP/escudo restantes), diga o resultado provável e a margem de incerteza, e liste as premissas que você assumiu quando faltar regra.

Quando receber uma IMAGEM do personagem, use o visual como referência de conceito pra sugerir habilidades, traços e temática coerentes — sempre respeitando as mecânicas do sistema.

COMO ESCREVER (regra dura — o mestre lê isso numa barra lateral estreita, no meio da mesa):
- Seja CRIATIVO no conteúdo e ECONÔMICO nas palavras. Ideia ousada, texto curto.
- Teto de ~150 palavras. Só passe disso se o mestre pedir detalhe/passo a passo explicitamente.
- Vá direto à resposta na PRIMEIRA linha. Nada de preâmbulo, resumo do que foi perguntado, nem "que ótima pergunta".
- Não repita de volta os dados da ficha: o mestre já os tem na tela. Cite um número só quando ele sustentar o argumento.
- Prefira bullets curtos a parágrafos. No máximo 3 bullets por bloco.
- Nada de encerramento genérico ("espero ter ajudado", "me avise se quiser ajustar").
- Se a pergunta for aberta ("me dá ideia de técnica"), entregue 2-3 opções enxutas — nome + efeito em uma linha cada — e pare. O mestre pede detalhe da que gostar.
- Se as regras do sistema não foram fornecidas, diga isso em UMA linha curta no começo e siga.`;

/** Sem ficha selecionada: conversa livre sobre o sistema. */
export const SYSTEM_PROMPT_GERAL = CABECALHO_SYSTEM;

export const SYSTEM_PROMPT_ANALISE = `${CABECALHO_SYSTEM}

Só quando o mestre pedir uma ANÁLISE comparativa, use este formato — enxuto, uma linha por bullet:
## Leitura — um bullet por personagem: papel + maior força/fraqueza.
## Desequilíbrios — até 3 bullets: quem está fora da curva e o número que prova.
## Sugestões — até 3 ajustes numéricos concretos ("agilidade 9 → 7", "custo 10 → 15 SP").
Em conversa normal NÃO use esse formato: responda direto, sem seções.`;

export const SYSTEM_PROMPT_FICHA = `${CABECALHO_SYSTEM}

É UMA ficha só (pode estar em criação, incompleta). Só quando o mestre pedir uma ANÁLISE, use este formato — enxuto, uma linha por bullet:
## Leitura — 1-2 bullets: papel e identidade mecânica.
## Equilíbrio — até 3 bullets: acima/abaixo da curva, com o número que prova.
## Sugestões — até 3 ajustes numéricos; aponte o que falta (ex.: nenhuma técnica).
Em conversa normal NÃO use esse formato: responda direto, sem seções.`;

/**
 * Só entra quando o índice do elenco foi mesmo montado. Se o elenco ainda não
 * chegou (ou a consulta falhou), afirmar que ele está no contexto é convite pra
 * o modelo inventar personagem — o oposto do que a instrução quer.
 */
const PARAGRAFO_INDICE = `Você recebe também um ÍNDICE com TODOS os personagens do jogo (nome, tipo e os 8 atributos) e as fichas DETALHADAS só de quem o mestre está discutindo — basta ele citar um nome pra ficha detalhada daquele personagem entrar. Nunca responda "não me forneceu a ficha" de quem está no índice: use o resumo e diga em uma linha o que precisaria de detalhe.`;

/** Prompt certo pro tamanho da seleção: 0 = conversa geral, 1 = ficha, 2+ = comparativo. */
export function systemPromptPara(quantidade: number, temIndice = false): string {
  const base =
    quantidade === 0
      ? SYSTEM_PROMPT_GERAL
      : quantidade === 1
        ? SYSTEM_PROMPT_FICHA
        : SYSTEM_PROMPT_ANALISE;
  return temIndice ? `${base}\n\n${PARAGRAFO_INDICE}` : base;
}

/** Texto único de contexto: regras + catálogos + índice do elenco + fichas. Puro e testável. */
export function montarContextoTexto(
  fichas: FichaParaContexto[],
  notasRegras: Nota[],
  catalogos: Catalogos,
  indiceElenco = "",
): string {
  const regras =
    notasRegras.length > 0
      ? notasRegras.map((n) => `### ${n.titulo}\n${n.corpo}`).join("\n\n")
      : "(regras não sincronizadas)";
  const partes = ["# REGRAS DO SISTEMA", regras, "# CATÁLOGOS", JSON.stringify(catalogos)];
  if (indiceElenco) partes.push("# ELENCO (resumo de todos os personagens)", indiceElenco);
  // O id é interno (serve pra dedupe): não diz nada ao modelo e só ocupa espaço.
  const semId = fichas.map(({ id: _id, ...ficha }) => ficha);
  partes.push("# FICHAS DETALHADAS", JSON.stringify(semId));
  return partes.join("\n\n");
}

/** Chave em config com os títulos (JSON string[]) das notas que são regras. */
export const CONFIG_REGRAS_NOTAS = "regras_notas";
