import { useState } from "react";
import PainelMusica from "./PainelMusica";
import { definirSempreNoTopo } from "./janelaPlayerNativa";

/**
 * Conteúdo da JANELA NATIVA do player (rota `/player`, montada FORA do
 * `AppShell` — sem sidebar, sem cockpit: a janela inteira é o player).
 *
 * Não há botão de fechar nem de arrastar aqui de propósito: quem faz isso é a
 * moldura do sistema operacional, que é justamente a vantagem de ser uma janela
 * de verdade em vez do painel `fixed` de antes.
 */
export default function JanelaPlayer() {
  // Abre já no topo (é pra isso que a janela existe), mas dá como desligar —
  // uma janela sempre-no-topo que não se pode baixar atrapalha na hora errada.
  const [noTopo, setNoTopo] = useState(true);

  function alternarTopo() {
    const proximo = !noTopo;
    setNoTopo(proximo);
    void definirSempreNoTopo(proximo);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 p-3 text-slate-100">
      <div className="mb-2 flex shrink-0 justify-end">
        <button
          type="button"
          onClick={alternarTopo}
          aria-pressed={noTopo}
          title={noTopo ? "Desafixar do topo" : "Manter sempre no topo"}
          className={`inline-flex h-7 items-center rounded-md border px-2 text-xs transition-colors ${
            noTopo
              ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-300"
              : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          {noTopo ? "📌 no topo" : "no topo"}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PainelMusica variante="janela" />
      </div>
    </div>
  );
}
