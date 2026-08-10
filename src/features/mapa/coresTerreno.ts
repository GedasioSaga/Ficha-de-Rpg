// Cores dos símbolos do mapa, escolhidas pelo mestre. Store de módulo com
// persistência em `localStorage` — mesmo padrão de `modoMusica.ts`.
//
// Por que global (e não por mapa): cor aqui é gosto pessoal de quem desenha,
// não conteúdo do mapa. Guardar por mapa exigiria coluna nova no banco e faria
// a cor viajar ao duplicar, o que ninguém pediu.
//
// A cor vive SÓ no app. O mapa postado no Discord é um code block monoespaçado
// sem cor nenhuma — mudar a paleta aqui não altera uma vírgula do que os
// jogadores veem lá.

import { useSyncExternalStore } from "react";

const CHAVE_STORAGE = "rpgv2.mapa.coresTerreno";

/**
 * Cores oferecidas na escolha. Classes Tailwind ESCRITAS POR EXTENSO de
 * propósito: o Tailwind varre o código-fonte procurando nomes de classe
 * literais, então algo como `text-${cor}-400` seria descartado no build e a cor
 * simplesmente não existiria em produção.
 *
 * Todas foram escolhidas para ter contraste no fundo escuro (`slate-950`) —
 * daí não haver tons escuros na lista.
 */
export const CORES_DISPONIVEIS: { nome: string; classe: string }[] = [
  { nome: "cinza", classe: "text-slate-400" },
  { nome: "branco", classe: "text-slate-100" },
  { nome: "pedra", classe: "text-stone-400" },
  { nome: "verde", classe: "text-emerald-400" },
  { nome: "limão", classe: "text-lime-300" },
  { nome: "azul", classe: "text-sky-400" },
  { nome: "ciano", classe: "text-cyan-300" },
  { nome: "índigo", classe: "text-indigo-300" },
  { nome: "violeta", classe: "text-violet-300" },
  { nome: "rosa", classe: "text-rose-400" },
  { nome: "laranja", classe: "text-orange-300" },
  { nome: "âmbar", classe: "text-amber-300" },
];

/** Cor de fábrica de cada símbolo — o "resetar ao padrão" volta exatamente pra cá. */
export const CORES_PADRAO: Readonly<Record<string, string>> = {
  "-": "text-slate-700",
  ".": "text-amber-300/80",
  "#": "text-stone-400",
  X: "text-emerald-400",
  "~": "text-sky-400",
  "^": "text-orange-300/90",
  "=": "text-yellow-600",
  "+": "text-teal-300",
  "*": "text-rose-400",
  "%": "text-stone-500",
};

/** Só o que o usuário mudou; o que não está aqui cai no padrão. */
export type CoresTerreno = Record<string, string>;

function lerPersistido(): CoresTerreno {
  try {
    const cru = localStorage.getItem(CHAVE_STORAGE);
    if (!cru) return {};
    const obj: unknown = JSON.parse(cru);
    if (typeof obj !== "object" || obj === null) return {};
    // Só aceita pares string→string de classes que a gente conhece: um
    // localStorage adulterado (ou de uma versão antiga do app) não pode injetar
    // classe arbitrária no `className`.
    const validas = new Set(CORES_DISPONIVEIS.map((c) => c.classe));
    const limpo: CoresTerreno = {};
    for (const [char, classe] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof classe === "string" && validas.has(classe)) limpo[char] = classe;
    }
    return limpo;
  } catch {
    return {};
  }
}

let cores: CoresTerreno = lerPersistido();
const ouvintes = new Set<() => void>();

function ler(): CoresTerreno {
  return cores;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function publicar(proximo: CoresTerreno): void {
  cores = proximo;
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify(proximo));
  } catch {
    // localStorage indisponível — a escolha só não sobrevive ao restart.
  }
  for (const ouvinte of ouvintes) ouvinte();
}

/** Define a cor de um símbolo. Escolher a cor de fábrica remove a customização. */
export function definirCorTerreno(char: string, classe: string): void {
  const proximo = { ...cores };
  if (classe === CORES_PADRAO[char]) delete proximo[char];
  else proximo[char] = classe;
  publicar(proximo);
}

/** Volta todos os símbolos às cores de fábrica. */
export function resetarCoresTerreno(): void {
  publicar({});
}

/** Hook reativo pras cores customizadas (referência estável entre renders). */
export function useCoresTerreno(): CoresTerreno {
  return useSyncExternalStore(assinar, ler);
}
