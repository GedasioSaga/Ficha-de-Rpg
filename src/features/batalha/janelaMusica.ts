// Store de módulo do "destacar" do player de música: o mini-player docado e a
// janela flutuante (`JanelaMusicaFlutuante`) são dois "skins" do mesmo player,
// e o `Tabs` desmonta a aba inativa — mesmo padrão de `prefAutoSeguir`/
// `ultimaMusica` (ver `usePlayerMusica.ts`): o valor vive fora do React, então
// sobrevive à troca de aba e ao ligar/desligar o modo música.

import { useSyncExternalStore } from "react";

/** Posição da janela flutuante (canto superior-esquerdo, em px de tela). */
export interface PosicaoJanela {
  x: number;
  y: number;
}

interface EstadoJanelaMusica {
  /** true = o player virou uma janelinha flutuante (fixed) por cima do cockpit. */
  destacada: boolean;
  /** null = ainda não foi arrastada (usa a posição padrão, via CSS). */
  pos: PosicaoJanela | null;
}

let estado: EstadoJanelaMusica = { destacada: false, pos: null };
const ouvintes = new Set<() => void>();

function ler(): EstadoJanelaMusica {
  return estado;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function notificar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Destaca o player: vira uma janelinha flutuante sobreposta ao cockpit. */
export function destacarPlayer(): void {
  estado = { ...estado, destacada: true };
  notificar();
}

/** Encaixa o player de volta no lugar docado (painel/mini-player normal). */
export function docarPlayer(): void {
  estado = { ...estado, destacada: false };
  notificar();
}

/** Grava a posição da janela flutuante depois de um arrasto. */
export function moverJanelaMusica(pos: PosicaoJanela): void {
  estado = { ...estado, pos };
  notificar();
}

/** Hook reativo pro estado da janela flutuante. */
export function useJanelaMusica(): EstadoJanelaMusica {
  return useSyncExternalStore(assinar, ler);
}
