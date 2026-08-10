import type { Mapa, MapaInput } from "../../lib/types";

export const COLUNAS_MIN = 6;
export const COLUNAS_MAX = 26;
export const LINHAS_MIN = 3;
export const LINHAS_MAX = 50;
export const CELULA_VAZIA = "-";
export const LIMITE_DISCORD = 2000;
/** A partir de quantos % do limite o aviso vira "atenção" (âmbar). */
const LIMIAR_ATENCAO_DISCORD = 0.85;

export type NivelLimiteDiscord = "normal" | "atencao" | "estourado";

export interface StatusLimiteDiscord {
  nivel: NivelLimiteDiscord;
  /** Texto extra pro caso não-normal (acessibilidade: não depender só da cor). "" quando normal. */
  aviso: string;
}

/**
 * Caracteres pintáveis fixos (a "letra qualquer" continua valendo como ponto de
 * interesse solto).
 *
 * Só ASCII de propósito: a grade vai pro Discord num code block monoespaçado, e
 * símbolo Unicode (☠, ✟, emoji) costuma não existir na fonte mono, cair num
 * fallback de largura diferente e **entortar a coluna inteira**. ASCII sempre
 * ocupa exatamente uma casa.
 *
 * ATENÇÃO: os nomes aqui são só pros botões do editor. Quem escreve a legenda
 * que vai pro Discord é `nome_do_terreno` em `src-tauri/src/domain/mapa/render.rs`
 * — mexeu aqui, mexa lá também, senão o botão diz uma coisa e o Discord outra.
 */
export const PALETA: { char: string; nome: string }[] = [
  { char: "-", nome: "vazio" },
  { char: ".", nome: "chão" },
  { char: "#", nome: "pedra" },
  { char: "X", nome: "árvore" },
  { char: "~", nome: "água" },
  { char: "^", nome: "elevação" },
  { char: "=", nome: "ponte/convés" },
  { char: "+", nome: "porta" },
  { char: "*", nome: "fogo/perigo" },
  { char: "%", nome: "escombros" },
];

/**
 * Cor (classe Tailwind) por tipo de célula. Só no app — o Discord vai
 * monoespaçado sem cor.
 *
 * `cores` são as customizações do mestre (`useCoresTerreno`), passadas por
 * parâmetro em vez de lidas de um store aqui dentro: esta função é pura e
 * usada em 4 telas, e um import de `coresTerreno.ts` criaria ciclo (ele importa
 * a `PALETA` daqui).
 */
export function corDaCelula(c: string, cores?: Record<string, string>): string {
  const escolhida = cores?.[c];
  if (escolhida) return escolhida;
  switch (c) {
    case "X": return "text-emerald-400";
    case "~": return "text-sky-400";
    case "#": return "text-stone-400";
    case ".": return "text-amber-300/80";
    case "-": return "text-slate-700";
    case "^": return "text-orange-300/90"; // elevação
    case "=": return "text-yellow-600"; // ponte/convés (madeira)
    case "+": return "text-teal-300"; // porta
    case "*": return "text-rose-400"; // fogo/perigo
    case "%": return "text-stone-500"; // escombros
    default: return "text-indigo-300"; // ponto de interesse (letras/dígitos)
  }
}

/** Rótulo de coluna: 0→"A", 1→"B", ... (até 25→"Z"). */
export function rotuloColuna(i: number): string {
  return String.fromCharCode(65 + i);
}

/**
 * Conta caracteres do jeito que o Discord conta: code points, não unidades UTF-16.
 * `String.length` do JS conta UTF-16 (emoji e acentos compostos podem virar 2), enquanto o
 * backend usa `.chars().count()` do Rust (code points). `[...texto].length` itera por code
 * point e bate com a contagem do Rust.
 */
export function contarCaracteresDiscord(texto: string): number {
  return [...texto].length;
}

/** Classifica o tamanho do texto contra o limite de 2000 chars de uma mensagem do Discord. */
export function statusLimiteDiscord(tamanho: number): StatusLimiteDiscord {
  if (tamanho > LIMITE_DISCORD) return { nivel: "estourado", aviso: "não cabe numa mensagem" };
  if (tamanho >= LIMITE_DISCORD * LIMIAR_ATENCAO_DISCORD) return { nivel: "atencao", aviso: "perto do limite" };
  return { nivel: "normal", aviso: "" };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Espelha a normalização do Rust pra resposta imediata na UI. */
export function normalizarGrade(grade: string[], colunas: number, linhas: number): string[] {
  const cols = clamp(Math.round(colunas) || COLUNAS_MIN, COLUNAS_MIN, COLUNAS_MAX);
  const lins = clamp(Math.round(linhas) || LINHAS_MIN, LINHAS_MIN, LINHAS_MAX);
  const out: string[] = [];
  for (let i = 0; i < lins; i++) {
    const origem = [...(grade[i] ?? "")];
    let linha = "";
    for (let j = 0; j < cols; j++) {
      const ch = origem[j];
      linha += ch && ch.trim() !== "" ? ch : CELULA_VAZIA;
    }
    out.push(linha);
  }
  return out;
}

export function gradeVazia(colunas: number, linhas: number): string[] {
  return normalizarGrade([], colunas, linhas);
}

/** Pinta a célula (r,c) com `char`, retornando uma nova grade (imutável). */
export function pintar(grade: string[], r: number, c: number, char: string): string[] {
  return grade.map((linha, i) => {
    if (i !== r) return linha;
    const arr = [...linha];
    arr[c] = char;
    return arr.join("");
  });
}

/** Descarta id/timestamps pra montar o input de save/render. */
export function mapaParaInput(m: Mapa): MapaInput {
  return {
    titulo: m.titulo,
    colunas: m.colunas,
    linhas: m.linhas,
    grade: m.grade,
    legenda: m.legenda,
    efeito: m.efeito,
  };
}

/** Input de um mapa novo em branco. */
export function inputVazio(): MapaInput {
  return {
    titulo: "Novo mapa",
    colunas: 26,
    linhas: 7,
    grade: gradeVazia(26, 7),
    legenda: "",
    efeito: "",
  };
}
