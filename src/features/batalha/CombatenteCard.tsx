import { useQuery } from "@tanstack/react-query";
import { retratoDataUrl } from "../../lib/api";
import type { Combatente } from "../../lib/types";
import { IconLixeira } from "../../components/icons";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import { atributoEfetivo } from "./logica";

interface Props {
  combatente: Combatente;
  retratoPath: string | null;
  selecionado: boolean;
  atual: boolean;
  onSelecionar: () => void;
  onRemover: () => void;
}

/** Card compacto de um combatente na arena (coluna esquerda). */
export default function CombatenteCard({
  combatente: c,
  retratoPath,
  selecionado,
  atual,
  onSelecionar,
  onRemover,
}: Props) {
  const { data: src } = useQuery({
    queryKey: ["retrato", retratoPath],
    queryFn: () => retratoDataUrl(retratoPath!),
    enabled: !!retratoPath,
    staleTime: Infinity,
  });
  const temImagem = !!retratoPath && !!src;
  const ehJogador = c.tipo === "jogador";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelecionar}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelecionar();
        }
      }}
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 transition-colors duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        selecionado
          ? "border-indigo-500/70 bg-indigo-500/10"
          : atual
            ? "border-amber-400/80 bg-amber-500/10 ring-1 ring-inset ring-amber-400/30"
            : "border-slate-800 bg-slate-900 hover:bg-slate-800/60"
      }`}
    >
      {/* `draggable={false}` no retrato: `<img>` é arrastável por padrão no
          HTML, e o retrato é justamente onde a mão cai pra puxar o card pro
          mapa. Sem isto o navegador inicia o drag DA IMAGEM, o `dataTransfer`
          vai sem o `CHAVE_DRAG_PECA`, e soltar no mapa não posiciona nada —
          parece que arrastar "não funciona". */}
      <div className="size-11 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-800">
        {temImagem ? (
          <img src={src} alt={c.nome} draggable={false} className="size-full object-cover" />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={{ backgroundImage: gradienteDoNome(c.nome) }}
          >
            <span className="text-sm font-bold text-white/90">{iniciais(c.nome)}</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-100">{c.nome}</span>
          <span
            className={`size-1.5 shrink-0 rounded-full ${ehJogador ? "bg-indigo-400" : "bg-slate-500"}`}
            title={ehJogador ? "Jogador" : "NPC"}
          />
          {atual && (
            <span className="rounded border border-amber-400/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              turno
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-[11px] tabular-nums text-slate-400">
          <span className="text-rose-300">HP {c.pools.hp}</span>
          <span className="text-sky-300">SP {c.pools.sp}</span>
          <span className="text-amber-300">Esc {c.pools.escudo}</span>
          <span className="text-slate-500">Agi {atributoEfetivo(c, "agilidade")}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemover();
        }}
        aria-label={`Remover ${c.nome}`}
        className="shrink-0 rounded-md p-1 text-slate-600 opacity-0 outline-none transition-opacity duration-150 ease-out hover:text-rose-300 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500 group-hover:opacity-100"
      >
        <IconLixeira className="size-4" />
      </button>
    </div>
  );
}
