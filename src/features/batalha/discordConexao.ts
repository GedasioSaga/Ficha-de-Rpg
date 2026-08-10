// Store de módulo da CONEXÃO com o Discord (bot logado + canal escolhido),
// guardado fora do React — mesmo padrão de `syncMapaDiscord`/`modoMusica`.
//
// Por que não `useMutation().isSuccess`: quem está conectado é o bot dentro do
// sidecar (processo Python), que vive enquanto o app viver. Amarrar esse fato ao
// ciclo de vida de um componente era um bug — o `Tabs` desmonta a aba inativa e o
// modo música desmonta o `<Tabs>` inteiro, então ir até a música e voltar zerava
// `isSuccess` e a UI dizia "desconectado" com o bot ainda logado. Aqui o valor é
// único, sobrevive a qualquer desmontagem, e só muda por fato real: conectou,
// caiu (evento do sidecar) ou o usuário desconectou de propósito.
//
// NÃO persiste em `localStorage` de propósito: ao reabrir o app o sidecar é um
// processo novo e o bot não está logado — persistir mostraria "conectado" mentindo.

import { useSyncExternalStore } from "react";
import type { InfoConexao } from "../../lib/types";

/**
 * - `ocioso`: nunca conectou nesta sessão do app (ou desconectou de propósito).
 * - `conectando`: handshake em voo.
 * - `conectado`: bot logado; navegar pela UI não muda isso.
 * - `caiu`: queda real reportada pelo sidecar (token revogado, processo morto).
 */
export type EstadoConexao = "ocioso" | "conectando" | "conectado" | "caiu";

export interface ConexaoDiscord {
  estado: EstadoConexao;
  /** Usuário logado + guilds visíveis; null enquanto não houve conexão. */
  info: InfoConexao | null;
  /** Canal de texto de destino escolhido no seletor; "" = nenhum. */
  canalId: string;
}

const INICIAL: ConexaoDiscord = { estado: "ocioso", info: null, canalId: "" };

let conexao: ConexaoDiscord = INICIAL;
const ouvintes = new Set<() => void>();

function ler(): ConexaoDiscord {
  return conexao;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Merge no estado da conexão; no-op (sem notificar) quando nada muda. */
export function definirConexao(parcial: Partial<ConexaoDiscord>): void {
  const proximo = { ...conexao, ...parcial };
  if (
    proximo.estado === conexao.estado &&
    proximo.info === conexao.info &&
    proximo.canalId === conexao.canalId
  ) {
    return;
  }
  conexao = proximo;
  for (const ouvinte of ouvintes) ouvinte();
}

/**
 * Registra uma queda reportada pelo sidecar. Só derruba quem estava de pé: um
 * evento atrasado (a queda anterior chegando enquanto o usuário já clicou
 * "Reconectar") não pode marcar como caída uma tentativa em voo — quem decide o
 * destino dessa tentativa é o resultado dela, não o eco da queda passada.
 */
export function marcarQueda(): void {
  if (conexao.estado !== "conectado") return;
  definirConexao({ estado: "caiu" });
}

/**
 * Zera a conexão — usado no "Desconectar" manual (recovery, escondido no debug).
 * Queda espontânea NÃO passa por aqui: vira `estado: "caiu"`, que preserva o
 * `info`/`canalId` pra oferecer "Reconectar" sem o usuário reescolher tudo.
 */
export function resetarConexao(): void {
  definirConexao(INICIAL);
}

/** Hook reativo pra conexão (referência estável entre renders sem mudança). */
export function useConexaoDiscord(): ConexaoDiscord {
  return useSyncExternalStore(assinar, ler);
}
