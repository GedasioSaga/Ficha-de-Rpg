// Abertura da JANELA NATIVA do player (segunda `WebviewWindow` do Tauri).
//
// Por que nativa e não mais um painel `position: fixed`: a versão em HTML só
// flutuava DENTRO do app — não dava pra deixar por cima do navegador/OBS, que é
// o uso real durante a sessão de mesa. Uma janela do sistema resolve de graça o
// que o painel fazia mal: arrastar (barra do Windows), fechar (X do sistema) e
// ficar sempre no topo.
//
// O estado NÃO precisa de ponte pesada: o backend emite `discord:evento` com
// `app.emit`, que é broadcast pra todas as janelas, e favoritos/transporte vão
// por `invoke` — ou seja, as duas janelas veem a mesma reprodução sozinhas. Só a
// URL da faixa atual (capa) é sincronizada à parte, em `usePlayerMusica`.
//
// A janela precisa estar declarada em `src-tauri/capabilities/default.json`
// (`windows: ["main", "player"]`), senão nasce sem permissão nem pra `invoke`.

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Label da janela — também usado na capability e pra reencontrá-la já aberta. */
export const LABEL_JANELA_PLAYER = "player";

const LARGURA = 380;
const ALTURA = 720;

/**
 * Abre a janela do player, ou traz pra frente a que já está aberta.
 *
 * Repare que erro aqui não pode virar exceção solta: se a permissão faltar ou o
 * label colidir, o `tauri://error` chega de forma assíncrona — daí o callback de
 * erro em vez de `try/catch`.
 */
export async function abrirJanelaPlayer(aoFalhar?: (motivo: string) => void): Promise<void> {
  const existente = await WebviewWindow.getByLabel(LABEL_JANELA_PLAYER);
  if (existente) {
    await existente.show();
    await existente.setFocus();
    return;
  }

  const janela = new WebviewWindow(LABEL_JANELA_PLAYER, {
    // `index.html?...` e NÃO uma rota tipo `/player`: abrir a janela é um load de
    // verdade, e no app empacotado `tauri://localhost/player` procuraria um
    // arquivo que não existe (o dev server disfarça isso com fallback de SPA).
    // Apontar pro index e decidir por query string funciona nos dois.
    url: "index.html?janela=player",
    title: "Player · One Piece RPG",
    width: LARGURA,
    height: ALTURA,
    minWidth: 320,
    minHeight: 360,
    resizable: true,
    // O ponto do pedido: ficar por cima dos outros programas.
    alwaysOnTop: true,
  });

  janela.once("tauri://error", (evento) => {
    aoFalhar?.(String(evento.payload));
  });
}

/** Liga/desliga o "sempre no topo" da janela do player (chamado de dentro dela). */
export async function definirSempreNoTopo(ativo: boolean): Promise<void> {
  const janela = await WebviewWindow.getByLabel(LABEL_JANELA_PLAYER);
  await janela?.setAlwaysOnTop(ativo);
}
