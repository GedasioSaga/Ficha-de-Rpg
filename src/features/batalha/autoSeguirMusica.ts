// Store de módulo da preferência "Bot me segue" (auto-seguir por nick no
// Discord) — mesmo padrão de `usePlayerMusica`/`janelaMusica`/`modoMusica`: o
// valor vive fora do React porque o player tem várias "skins" montadas ao
// mesmo tempo (`PainelMusica` em coluna, flutuante ou cheia) e o `Tabs`
// desmonta a aba inativa. Um `useState` local em cada skin voltaria pro
// padrão a cada troca de aba enquanto o sidecar seguia com o valor antigo —
// exatamente a divergência que fazia o bot entrar na call "sozinho".

import { useSyncExternalStore } from "react";
import { discordAutoSeguir } from "../../lib/api";

/** Nick padrão que o auto-seguir persegue no Discord. */
export const NICK_PADRAO_AUTO_SEGUIR = "gedasiosaga";

/** Preferência do auto-seguir: a caixa "Bot me segue" + o nick perseguido. */
export interface PrefAutoSeguir {
  ativo: boolean;
  nick: string;
}

let prefAutoSeguir: PrefAutoSeguir = { ativo: false, nick: NICK_PADRAO_AUTO_SEGUIR };
const ouvintes = new Set<() => void>();

function ler(): PrefAutoSeguir {
  return prefAutoSeguir;
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

/**
 * Manda a preferência atual pro sidecar. O sidecar nasce com o auto-seguir
 * DESLIGADO e não guarda nada entre execuções, então esta preferência é a
 * única fonte da verdade: empurra ao montar, a cada (re)conexão do bot e a
 * cada mudança.
 *
 * Erro é engolido de propósito: a falha esperada é "sidecar não iniciado"
 * (player montado sem ninguém ter conectado o Discord ainda), e aí não há
 * divergência pra corrigir — um sidecar novo nasce desligado.
 */
export function empurrarAutoSeguir(): void {
  const { ativo, nick } = prefAutoSeguir;
  discordAutoSeguir(ativo, nick.trim() || NICK_PADRAO_AUTO_SEGUIR).catch(() => {});
}

/** Guarda o nick enquanto o usuário digita; o sidecar só ouve no blur (ver `aplicarNickAutoSeguir`). */
export function editarNickAutoSeguir(nick: string): void {
  prefAutoSeguir = { ...prefAutoSeguir, nick };
  notificar();
}

/** Grava a preferência e empurra pro sidecar — os dois lados sempre juntos. */
export function definirAutoSeguir(pref: PrefAutoSeguir): void {
  prefAutoSeguir = pref;
  notificar();
  empurrarAutoSeguir();
}

/** Hook reativo pra preferência de auto-seguir, compartilhada por todas as skins do player. */
export function useAutoSeguirMusica(): PrefAutoSeguir {
  return useSyncExternalStore(assinar, ler);
}
