import { useQuery } from "@tanstack/react-query";
import { retratoDataUrl } from "../../lib/api";
import type { AtributoRank, PersonagemCompleto } from "../../lib/types";
import { gradienteDoNome, iniciais } from "./retrato";
import { ROTULO_ATRIBUTO } from "./atributos";

const POOLS = [
  { chave: "hp", label: "HP", classe: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
  { chave: "sp", label: "SP", classe: "border-sky-500/30 bg-sky-500/10 text-sky-200" },
  { chave: "escudo", label: "Escudo", classe: "border-slate-500/30 bg-slate-500/10 text-slate-200" },
] as const;

/** Cor sutil do badge de rank por faixa (quanto maior, mais "quente"). */
function corDoRank(rank: number): string {
  if (rank >= 10) return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  if (rank >= 7) return "border-violet-500/40 bg-violet-500/15 text-violet-200";
  if (rank >= 4) return "border-sky-500/40 bg-sky-500/15 text-sky-200";
  return "border-slate-600/50 bg-slate-700/40 text-slate-300";
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      title={`Rank ${rank}`}
      className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${corDoRank(rank)}`}
    >
      <span className="mr-0.5 opacity-60">R</span>
      {rank}
    </span>
  );
}

function AttributeRow({ atributo }: { atributo: AtributoRank }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-slate-800/50">
      <span className="text-sm text-slate-300">
        {ROTULO_ATRIBUTO[atributo.nome] ?? atributo.nome}
      </span>
      <div className="flex items-center gap-2.5">
        <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-100">
          {atributo.valor}
        </span>
        <RankBadge rank={atributo.rank} />
      </div>
    </div>
  );
}

export default function StatBlock({ p }: { p: PersonagemCompleto }) {
  const { data: src } = useQuery({
    queryKey: ["retrato", p.retrato],
    queryFn: () => retratoDataUrl(p.retrato!),
    enabled: !!p.retrato,
    staleTime: Infinity,
  });

  const temImagem = !!p.retrato && !!src;
  const ehJogador = p.tipo === "jogador";

  return (
    <aside className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:sticky lg:top-6">
      {/* Retrato */}
      <div className="relative mx-auto aspect-square w-full max-w-[240px] overflow-hidden rounded-xl border border-slate-800 bg-slate-800">
        {temImagem ? (
          <img src={src} alt={p.nome} className="size-full object-cover" />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={{ backgroundImage: gradienteDoNome(p.nome) }}
          >
            <span className="text-5xl font-bold tracking-wide text-white/90">
              {iniciais(p.nome)}
            </span>
          </div>
        )}
      </div>

      {/* Nome + tipo + descrição */}
      <div className="space-y-2 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-slate-100">
            {p.nome}
          </h2>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              ehJogador
                ? "bg-indigo-500/90 text-white"
                : "bg-slate-700 text-slate-100"
            }`}
          >
            {ehJogador ? "Jogador" : "NPC"}
          </span>
        </div>
        {p.descricao && (
          <p className="text-sm leading-relaxed text-slate-400">{p.descricao}</p>
        )}
      </div>

      {/* Pools: HP / SP / Escudo */}
      <div className="grid grid-cols-3 gap-2">
        {POOLS.map((pool) => (
          <div
            key={pool.chave}
            className={`rounded-lg border px-2 py-2 text-center ${pool.classe}`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
              {pool.label}
            </div>
            <div className="text-lg font-bold tabular-nums">{p[pool.chave]}</div>
          </div>
        ))}
      </div>

      {/* Atributos com rank */}
      <div>
        <h3 className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Atributos
        </h3>
        <div className="space-y-0.5">
          {p.atributos.map((a) => (
            <AttributeRow key={a.nome} atributo={a} />
          ))}
        </div>
      </div>
    </aside>
  );
}
