import type { PersonagemCompleto } from "../../lib/types";
import { IconFechar } from "../../components/icons";
import Tabs from "../../components/Tabs";
import StatBlock from "../characters/StatBlock";
import { montarAbas } from "../characters/CharacterSheet";

interface Props {
  ficha: PersonagemCompleto;
  onFechar: () => void;
}

/**
 * Ficha completa em modal — pra dar uma olhada no personagem inteiro (stats,
 * habilidades, perícias, vantagens, transformações) sem sair da Batalha. Reusa o
 * `StatBlock` e as abas do `CharacterSheet` (via `montarAbas`).
 */
export default function FichaCompletaDialog({ ficha, onFechar }: Props) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" onMouseDown={onFechar} />
      <div className="relative z-10 mx-auto my-8 w-full max-w-4xl px-4">
        <div
          role="dialog"
          aria-modal="true"
          className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-100">
              Ficha completa <span className="text-slate-500">— {ficha.nome}</span>
            </h2>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="rounded-md p-1 text-slate-500 hover:text-slate-200"
            >
              <IconFechar className="size-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,340px)_1fr]">
            <StatBlock p={ficha} />
            <div className="min-w-0">
              <Tabs
                abas={montarAbas(
                  ficha.habilidades,
                  ficha.pericias,
                  ficha.vantagens,
                  ficha.desvantagens,
                  ficha.transformacoes,
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
