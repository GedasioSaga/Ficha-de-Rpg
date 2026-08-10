import { useSyncExternalStore } from "react";
import type { EstadoBatalha } from "../../lib/types";

/**
 * Estado do sync do mapa com o Discord, guardado FORA do React (escopo de módulo).
 *
 * Por que não `useState`: o toggle "sincronizar ao vivo" e o "postado" viviam no
 * painel do Discord, que o `Tabs` desmonta quando a aba não está ativa — a
 * cada troca de aba o estado voltava ao padrão e o driver de sync (agora sempre
 * montado na `BatalhaScreen`, fora do `Tabs`) não tinha como saber se devia
 * sincronizar. Aqui o valor é único, sobrevive à desmontagem, e o
 * `useSyncExternalStore` mantém quem está montado em sincronia. Mesmo padrão de
 * `prefAutoSeguir`/`ultimaMusica` do `PlayerMusica`.
 */
export interface EstadoSyncMapa {
  /** "Sincronizar ao vivo" ligado pelo usuário (checkbox no painel Discord). */
  sincronizar: boolean;
  /** Já houve um "Postar mapa" bem-sucedido nesta sessão (há mensagem viva pra editar). */
  postado: boolean;
}

let estadoSync: EstadoSyncMapa = { sincronizar: false, postado: false };
const ouvintes = new Set<() => void>();

function ler(): EstadoSyncMapa {
  return estadoSync;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Merge no estado do sync; no-op (sem notificar) quando nada muda. */
export function definirSyncMapa(parcial: Partial<EstadoSyncMapa>): void {
  const proximo = { ...estadoSync, ...parcial };
  if (proximo.sincronizar === estadoSync.sincronizar && proximo.postado === estadoSync.postado) {
    return;
  }
  estadoSync = proximo;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Zera sync+postado — ex.: trocou o mapa ativo ou o canal (a mensagem viva era do anterior). */
export function resetarSyncMapa(): void {
  definirSyncMapa({ sincronizar: false, postado: false });
}

/** Hook reativo pro estado do sync (referência estável entre renders sem mudança). */
export function useSyncMapa(): EstadoSyncMapa {
  return useSyncExternalStore(assinar, ler);
}

/**
 * Assinatura das PEÇAS no mapa — exatamente o que o `render_discord` do backend
 * desenha: para cada combatente posicionado, o glifo (índice na ordem de
 * iniciativa) e a célula. Ordenada e juntada numa string comparável com `===`,
 * barata e estável mesmo se a ordem do array `combatentes` mudar. Inclui o índice
 * da `ordem` porque transformar/reordenar troca o glifo desenhado sem mover ninguém.
 */
export function assinaturaPecas(estado: EstadoBatalha): string {
  return estado.combatentes
    .filter((c) => c.posicao)
    .map((c) => `${estado.ordem.indexOf(c.id)}@${c.posicao![0]},${c.posicao![1]}`)
    .sort()
    .join(";");
}
