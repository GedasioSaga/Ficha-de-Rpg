import type { Combatente, EstadoBatalha, PersonagemResumo } from "../../lib/types";
import { IconFechar } from "../../components/icons";
import RosterPanel from "./RosterPanel";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  personagens: PersonagemResumo[];
  /** Quem já está na luta — o roster mostra "×N" ao lado de quem já foi escalado. */
  combatentes: Combatente[];
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

/**
 * O roster "Disponíveis" como diálogo, aberto pelo "+ Escalar" do painel
 * "Em batalha". Escalar acontece em rajada no COMEÇO da cena — depois disso o
 * painel inteiro virava peso morto ocupando uma coluna do rodapé; como botão,
 * o espaço só é gasto enquanto a tarefa existe.
 *
 * O diálogo NÃO fecha ao adicionar: escalar é quase sempre em lote (mestre
 * puxa 3-4 NPCs de uma vez), e fechar no primeiro clique forçaria reabrir a
 * cada um. Fecha no X, no backdrop ou quando o mestre terminou.
 * Mesmo esqueleto do `HistoricoDialog` (overlay + backdrop + card).
 */
export default function RosterDialog({ aberto, onFechar, personagens, combatentes, roda }: Props) {
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
        aria-label="Escalar combatentes"
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">Escalar combatentes</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <IconFechar className="size-4" />
          </button>
        </div>
        {/* O RosterPanel traz o próprio card; aqui só damos rolagem. A lista
            interna dele não é restringida em altura dentro do diálogo — quem
            rola é este corpo, uma barra só. */}
        <div className="min-h-0 overflow-y-auto p-3">
          <RosterPanel personagens={personagens} combatentes={combatentes} roda={roda} />
        </div>
      </div>
    </div>
  );
}
