import { useState } from "react";
import SeletorPersonagens from "./SeletorPersonagens";
import TabelaComparacao from "./TabelaComparacao";
import { PainelIAPersonagens } from "./PainelIA";

export default function BalanceamentoScreen() {
  const [selecionados, setSelecionados] = useState<number[]>([]);

  function alternar(id: number) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id],
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Balanceamento</h1>
        <p className="mt-1 text-sm text-slate-500">
          Compare personagens lado a lado e converse com a IA sobre o equilíbrio deles.
        </p>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          <SeletorPersonagens selecionados={selecionados} onAlternar={alternar} />
          {selecionados.length < 2 ? (
            <p className="text-sm text-slate-600">
              Selecione pelo menos 2 personagens pra ver a comparação.
            </p>
          ) : (
            <TabelaComparacao ids={selecionados} />
          )}
        </div>
        <aside className="h-[36rem] lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
          <PainelIAPersonagens ids={selecionados} />
        </aside>
      </div>
    </div>
  );
}
