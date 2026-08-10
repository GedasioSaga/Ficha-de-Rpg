import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { batalhaModificadorManual, calcularRank } from "../../lib/api";
import type { AtributoNome, Combatente, EstadoBatalha } from "../../lib/types";
import { ATRIBUTOS, ROTULO_ATRIBUTO } from "../characters/atributos";
import { deltaTransformacao, modificadorManual } from "./logica";

interface Props {
  combatente: Combatente;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

type Draft = Record<string, number>;

function seed(c: Combatente): Draft {
  const manual = modificadorManual(c);
  return Object.fromEntries(ATRIBUTOS.map((a) => [a, manual.get(a) ?? 0]));
}

export default function AtributosEditor({ combatente: c, roda }: Props) {
  const [draft, setDraft] = useState<Draft>(() => seed(c));

  // re-semeia os mods manuais ao trocar de combatente
  useEffect(() => {
    setDraft(seed(c));
  }, [c.id]);

  function commit(next: Draft) {
    const deltas = ATRIBUTOS.filter((a) => (next[a] ?? 0) !== 0).map(
      (a) => [a, next[a]] as [AtributoNome, number],
    );
    roda(() => batalhaModificadorManual(c.id, deltas));
  }

  function resetar() {
    const zerado = Object.fromEntries(ATRIBUTOS.map((a) => [a, 0]));
    setDraft(zerado);
    roda(() => batalhaModificadorManual(c.id, []));
  }

  const temMod = ATRIBUTOS.some((a) => (draft[a] ?? 0) !== 0);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Atributos
        </h3>
        <button
          type="button"
          onClick={resetar}
          disabled={!temMod}
          className="rounded text-[11px] text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40"
        >
          Resetar modificadores
        </button>
      </div>
      <div className="space-y-0.5">
        {ATRIBUTOS.map((a) => {
          const base = c.base[ATRIBUTOS.indexOf(a)] ?? 0;
          const total = base + deltaTransformacao(c, a) + (draft[a] ?? 0);
          return (
            <AttrRow
              key={a}
              attr={a}
              base={base}
              mod={draft[a] ?? 0}
              total={total}
              onMod={(v) => setDraft((d) => ({ ...d, [a]: v }))}
              onCommit={() => commit(draft)}
            />
          );
        })}
      </div>
    </div>
  );
}

function AttrRow({
  attr,
  base,
  mod,
  total,
  onMod,
  onCommit,
}: {
  attr: AtributoNome;
  base: number;
  mod: number;
  total: number;
  onMod: (v: number) => void;
  onCommit: () => void;
}) {
  const { data: rank } = useQuery({
    queryKey: ["rank", attr, total],
    queryFn: () => calcularRank(attr, total),
    staleTime: Infinity,
  });

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-800/40">
      <span className="flex-1 truncate text-sm text-slate-300">{ROTULO_ATRIBUTO[attr]}</span>
      <span className="w-10 text-right text-xs tabular-nums text-slate-500">{base}</span>
      <input
        type="number"
        value={mod}
        onChange={(e) => onMod(Number(e.target.value) || 0)}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        title="Modificador manual"
        className="h-7 w-16 rounded-md border border-slate-800 bg-slate-950 px-1.5 text-center text-sm tabular-nums text-slate-100 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
      />
      <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-100">
        = {total}
      </span>
      <RankBadge rank={rank ?? 0} />
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cor =
    rank >= 10
      ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
      : rank >= 7
        ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
        : rank >= 4
          ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
          : "border-slate-600/50 bg-slate-700/40 text-slate-300";
  return (
    <span
      title={`Rank ${rank}`}
      className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-md border px-1 py-0.5 text-[11px] font-semibold tabular-nums ${cor}`}
    >
      <span className="mr-0.5 opacity-60">R</span>
      {rank}
    </span>
  );
}
