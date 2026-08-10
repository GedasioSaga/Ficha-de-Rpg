import type { ComponentType, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import {
  IconBalanceamento,
  IconBatalha,
  IconCompendio,
  IconConfiguracoes,
  IconFichas,
  IconNotas,
  IconPanel,
} from "./icons";

type ItemNav = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Rota destino. Ausente = seção "em breve" (desabilitada). */
  to?: string;
  /** `end` do NavLink (rota exata) — usado no índice "/". */
  end?: boolean;
};

const ITENS: ItemNav[] = [
  { id: "fichas", label: "Fichas", icon: IconFichas, to: "/", end: true },
  { id: "batalha", label: "Batalha", icon: IconBatalha, to: "/batalha" },
  { id: "notas", label: "Notas", icon: IconNotas, to: "/notas" },
  { id: "compendio", label: "Compêndio", icon: IconCompendio, to: "/compendio" },
  { id: "balanceamento", label: "Balanceamento", icon: IconBalanceamento, to: "/balanceamento" },
  { id: "configuracoes", label: "Configurações", icon: IconConfiguracoes, to: "/configuracoes" },
];

function Item({ item, colapsado }: { item: ItemNav; colapsado: boolean }) {
  const Ico = item.icon;
  const base = `relative flex h-10 items-center rounded-lg text-sm transition-colors ${
    colapsado ? "justify-center px-0" : "gap-3 px-3"
  }`;

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        title={colapsado ? item.label : undefined}
        className={({ isActive }) =>
          `${base} ${
            isActive
              ? "bg-indigo-500/10 font-medium text-indigo-300"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          }`
        }
      >
        {({ isActive }) => (
          <>
            {!colapsado && isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-indigo-400" />
            )}
            <Ico className="size-5 shrink-0" />
            {!colapsado && <span className="truncate">{item.label}</span>}
          </>
        )}
      </NavLink>
    );
  }

  return (
    <div
      aria-disabled="true"
      title={colapsado ? `${item.label} (em breve)` : undefined}
      className={`${base} cursor-not-allowed select-none text-slate-500`}
    >
      <Ico className="size-5 shrink-0" />
      {!colapsado && (
        <>
          <span className="truncate">{item.label}</span>
          <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            em breve
          </span>
        </>
      )}
    </div>
  );
}

export default function Sidebar({
  colapsado,
  onToggle,
}: {
  colapsado: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`flex h-full flex-col border-r border-slate-800/80 bg-slate-900 transition-[width] duration-200 ease-in-out ${
        colapsado ? "w-16" : "w-56"
      }`}
    >
      {/* Marca + toggle */}
      <div
        className={`flex h-14 items-center border-b border-slate-800/80 ${
          colapsado ? "justify-center px-2" : "gap-2 px-3"
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          title="Alternar menu"
          aria-label="Alternar menu"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 active:scale-95"
        >
          <IconPanel className="size-5" />
        </button>
        {!colapsado && (
          <span className="truncate text-[15px] font-semibold tracking-tight text-slate-100">
            One Piece <span className="text-indigo-400">RPG</span>
          </span>
        )}
      </div>

      {/* Navegação */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {ITENS.map((item) => (
          <Item key={item.id} item={item} colapsado={colapsado} />
        ))}
      </nav>

      {/* Rodapé */}
      {!colapsado && (
        <div className="border-t border-slate-800/80 px-3 py-3 text-[11px] text-slate-600">
          Fase 2 · Batalha
        </div>
      )}
    </aside>
  );
}
