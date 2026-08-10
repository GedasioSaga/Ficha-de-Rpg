// Store de módulo do "modo música": encolhe a UI (esconde a sidebar — ver
// `AppShell`) pra usar a janela do app estreita ao lado de outro programa.
// Guardado fora do React (mesmo padrão dos outros stores desta feature) porque
// quem liga (botão no player, atalho Ctrl+M) e quem reage (AppShell, dono da
// sidebar) são componentes bem distantes na árvore. Persiste em `localStorage`
// — a preferência sobrevive a fechar o app.

import { useSyncExternalStore } from "react";

const CHAVE_STORAGE = "rpgv2.batalha.modoMusica";

function lerPersistido(): boolean {
  try {
    return localStorage.getItem(CHAVE_STORAGE) === "1";
  } catch {
    return false;
  }
}

let ativo = lerPersistido();
const ouvintes = new Set<() => void>();

function ler(): boolean {
  return ativo;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Liga/desliga o modo música e persiste a preferência. No-op se já estiver no valor pedido. */
export function definirModoMusica(valor: boolean): void {
  if (valor === ativo) return;
  ativo = valor;
  try {
    localStorage.setItem(CHAVE_STORAGE, valor ? "1" : "0");
  } catch {
    // localStorage indisponível (ex.: modo privado) — a preferência só não persiste.
  }
  for (const ouvinte of ouvintes) ouvinte();
}

/** Alterna o modo música (atalho Ctrl+M e botão do player usam este). */
export function alternarModoMusica(): void {
  definirModoMusica(!ativo);
}

/** Hook reativo pro modo música. */
export function useModoMusica(): boolean {
  return useSyncExternalStore(assinar, ler);
}
