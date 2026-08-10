import type { EstadoBatalha } from "../../lib/types";
import { IconFechar } from "../../components/icons";
import BatalhasSalvas from "./BatalhasSalvas";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
  combatentesAtuais: number;
}

/**
 * "Batalhas salvas" como diálogo, aberto pelo "🗂 Batalhas" da barra de
 * comando. Salvar/carregar preset é evento raro (começo e fim de cena) — como
 * painel fixo do rodapé, gastava a coluna mais nobre o resto da sessão. Mesmo
 * esqueleto do `RosterDialog`/`HistoricoDialog`.
 */
export default function PresetsDialog({ aberto, onFechar, roda, combatentesAtuais }: Props) {
  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Batalhas salvas"
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">Batalhas salvas</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <IconFechar className="size-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-3">
          <BatalhasSalvas roda={roda} combatentesAtuais={combatentesAtuais} />
        </div>
      </div>
    </div>
  );
}
