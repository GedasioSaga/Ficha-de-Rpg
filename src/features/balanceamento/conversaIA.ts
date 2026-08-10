// Store de módulo das CONVERSAS com a IA, guardado fora do React — mesmo padrão
// de `discordConexao`/`syncMapaDiscord`.
//
// Por que não `useState` no PainelIA: a rota desmonta ao navegar (Balanceamento →
// Fichas → voltar) e o `Tabs` desmonta a aba inativa, então a conversa inteira
// sumia sem aviso no meio de uma análise. O histórico é trabalho do mestre, não
// estado de tela: vive aqui e sobrevive a qualquer desmontagem.
//
// Chaveado por escopo, não global: a conversa do painel de Balanceamento é outra
// coisa da conversa sobre a ficha X sendo editada — misturar as duas confundiria
// o contexto (e o modelo). Cada painel passa seu escopo.
//
// NÃO persiste em disco de propósito: conversa é volátil por natureza e o
// contexto (fichas, regras) é remontado a cada pergunta; guardar histórico velho
// entre sessões só encheria o banco e ressuscitaria papo sobre ficha já mudada.

import { useSyncExternalStore } from "react";
import type { MensagemIA } from "../../lib/gemini";

const conversas = new Map<string, MensagemIA[]>();
const ouvintes = new Set<() => void>();

/** Mesma referência para escopo sem conversa — `useSyncExternalStore` exige. */
const VAZIA: MensagemIA[] = [];

function notificar(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lerConversa(escopo: string): MensagemIA[] {
  return conversas.get(escopo) ?? VAZIA;
}

export function definirConversa(escopo: string, mensagens: MensagemIA[]): void {
  conversas.set(escopo, mensagens);
  notificar();
}

export function limparConversa(escopo: string): void {
  if (!conversas.has(escopo)) return;
  conversas.delete(escopo);
  notificar();
}

/** Hook reativo da conversa de um escopo (ex.: "balanceamento", "ficha:12"). */
export function useConversa(escopo: string): MensagemIA[] {
  return useSyncExternalStore(
    assinar,
    () => lerConversa(escopo),
    () => VAZIA,
  );
}
