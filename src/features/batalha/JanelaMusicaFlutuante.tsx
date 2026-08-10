// Janela flutuante do player — o mesmo player "destacado" (botão ⤢ do
// `MiniPlayerMusica`), sobreposta ao cockpit (`position: fixed`) e arrastável
// por um "grip". Montada UMA vez, sempre (mesmo padrão do
// `DiscordMapaSyncDriver`): assim sobrevive à troca de sub-aba (Combate/Mapa)
// e ao ligar/desligar o modo música. Só renderiza algo quando `destacada`
// está ligado (ver `janelaMusica.ts`).

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconFechar } from "../../components/icons";
import { docarPlayer, moverJanelaMusica, useJanelaMusica, type PosicaoJanela } from "./janelaMusica";
import PainelMusica from "./PainelMusica";

/** Largura da janela e altura estimada (px) — só pra manter o arrasto dentro da tela.
 * Aumentadas de 288/200 pra caber a biblioteca de favoritos (antes escondida via
 * `mostrarExtras={false}`, ver histórico deste arquivo). A altura é ESTIMATIVA pro
 * clamp do arrasto; o teto real vem do `maxHeight` + scroll interno no wrapper,
 * senão a base da janela (justamente a biblioteca) cairia fora da viewport. */
const LARGURA = 360;
const ALTURA_ESTIMADA = 560;
/** Folga vertical mínima entre a janela e as bordas da tela. */
const FOLGA_VERTICAL = 16;
/** Distância da borda pra posição padrão (canto inferior direito), antes do 1º arrasto. */
const MARGEM_PADRAO = 22;

function clampPos(pos: PosicaoJanela): PosicaoJanela {
  const maxX = Math.max(0, window.innerWidth - LARGURA);
  const maxY = Math.max(0, window.innerHeight - ALTURA_ESTIMADA);
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  };
}

function posPadrao(): PosicaoJanela {
  return clampPos({
    x: window.innerWidth - LARGURA - MARGEM_PADRAO,
    y: window.innerHeight - ALTURA_ESTIMADA - MARGEM_PADRAO,
  });
}

export default function JanelaMusicaFlutuante() {
  const { destacada, pos } = useJanelaMusica();

  // Posição durante o arrasto (local, só pra não gravar no store a cada pixel);
  // a posição final é gravada no `pointerup` (ver `aoSoltarArrasto`).
  const [posArrasto, setPosArrasto] = useState<PosicaoJanela | null>(null);
  const origemRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  if (!destacada) return null;

  const posAtual = posArrasto ?? pos ?? posPadrao();

  function aoIniciarArrasto(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    origemRef.current = { x: e.clientX, y: e.clientY, posX: posAtual.x, posY: posAtual.y };
    setPosArrasto(posAtual);
  }

  function aoMoverArrasto(e: ReactPointerEvent<HTMLDivElement>) {
    const origem = origemRef.current;
    if (!origem) return;
    setPosArrasto(clampPos({ x: origem.posX + (e.clientX - origem.x), y: origem.posY + (e.clientY - origem.y) }));
  }

  function aoSoltarArrasto() {
    if (!origemRef.current) return;
    origemRef.current = null;
    if (posArrasto) moverJanelaMusica(posArrasto);
    setPosArrasto(null);
  }

  return (
    <div
      role="dialog"
      aria-label="Player de música (janela flutuante)"
      style={{
        position: "fixed",
        left: posAtual.x,
        top: posAtual.y,
        width: LARGURA,
        // Nunca passar da altura da tela a partir de onde a janela está: o
        // conteúdo cresce (biblioteca de favoritos) e sem isso a base ficaria
        // inalcançável, já que uma janela `fixed` não rola com a página.
        maxHeight: `calc(100vh - ${posAtual.y + FOLGA_VERTICAL}px)`,
        overflowY: "auto",
        zIndex: 50,
      }}
      className="rounded-2xl border border-slate-800 bg-slate-900/95 p-3 shadow-2xl backdrop-blur"
    >
      <div
        onPointerDown={aoIniciarArrasto}
        onPointerMove={aoMoverArrasto}
        onPointerUp={aoSoltarArrasto}
        className="mb-2.5 flex cursor-grab items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-slate-500 active:cursor-grabbing"
      >
        <span className="text-slate-600">⠿⠿</span>
        <span>flutuando · arraste</span>
        <button
          type="button"
          onClick={docarPlayer}
          aria-label="Encaixar player de volta no cockpit"
          title="Encaixar"
          className="ml-auto rounded-md p-1 text-slate-500 hover:text-slate-200"
        >
          <IconFechar className="size-3.5" />
        </button>
      </div>
      <PainelMusica variante="flutuante" />
    </div>
  );
}
