import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPersonagem, retratoDataUrl, batalhaConcentracao } from "../../lib/api";
import type { Combatente, EstadoBatalha, PoolNome } from "../../lib/types";
import { IconBatalha } from "../../components/icons";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import { transformacaoAtiva } from "./logica";
import FormasTransformacao from "./FormasTransformacao";
import PoolEditor from "./PoolEditor";
import AtributosEditor from "./AtributosEditor";
import HabilidadesLista from "./HabilidadesLista";
import CalculadoraDano from "./CalculadoraDano";
import FichaCompletaDialog from "./FichaCompletaDialog";

const POOLS: { pool: PoolNome; label: string; cor: string }[] = [
  { pool: "hp", label: "HP", cor: "text-rose-300" },
  { pool: "sp", label: "SP", cor: "text-sky-300" },
  { pool: "escudo", label: "Escudo", cor: "text-amber-300" },
];

interface Props {
  combatente: Combatente | null;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

export default function PerfilCombatente({ combatente: c, roda }: Props) {
  const ref = c?.personagem_ref ?? null;
  const { data: ficha } = useQuery({
    queryKey: ["personagem", ref],
    queryFn: () => getPersonagem(ref!),
    enabled: ref != null,
  });

  const ativa = c ? transformacaoAtiva(c) : null;
  const transfAtiva = ficha?.transformacoes.find((t) => t.nome === ativa) ?? null;
  const retratoPath = transfAtiva?.retrato ?? ficha?.retrato ?? null;
  const { data: retratoSrc } = useQuery({
    queryKey: ["retrato", retratoPath],
    queryFn: () => retratoDataUrl(retratoPath!),
    enabled: !!retratoPath,
    staleTime: Infinity,
  });
  const [calcAberta, setCalcAberta] = useState(false);
  const [fichaAberta, setFichaAberta] = useState(false);

  if (!c) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 py-24 text-center">
        <div className="mb-3 grid size-12 place-items-center rounded-full bg-slate-800 text-slate-500">
          <IconBatalha className="size-6" />
        </div>
        <p className="font-medium text-slate-300">Nenhum combatente selecionado</p>
        <p className="mt-1 text-sm text-slate-500">Escolha um combatente na coluna da esquerda.</p>
      </div>
    );
  }

  const temImagem = !!retratoPath && !!retratoSrc;
  const ehJogador = c.tipo === "jogador";
  const habilidades = [...(ficha?.habilidades ?? []), ...(transfAtiva?.habilidades ?? [])];

  return (
    <div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      {/* Cabeçalho: retrato + nome + ficha completa */}
      <div className="flex items-start gap-4">
        <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-800">
          {temImagem ? (
            <img src={retratoSrc} alt={c.nome} className="size-full object-cover" />
          ) : (
            <div
              className="flex size-full items-center justify-center"
              style={{ backgroundImage: gradienteDoNome(c.nome) }}
            >
              <span className="text-2xl font-bold text-white/90">{iniciais(c.nome)}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">{c.nome}</h2>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                ehJogador ? "bg-indigo-500/90 text-white" : "bg-slate-700 text-slate-100"
              }`}
            >
              {ehJogador ? "Jogador" : "NPC"}
            </span>
          </div>
          {ativa && (
            <p className="mt-0.5 text-sm text-emerald-300">Transformado: {ativa}</p>
          )}
        </div>
        {ficha && (
          <button
            type="button"
            onClick={() => setFichaAberta(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 outline-none transition-colors duration-150 ease-out hover:bg-slate-800 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            ⤢ Ficha completa
          </button>
        )}
      </div>

      {/* Pools + calculadora de dano */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vitais</h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => roda(() => batalhaConcentracao(c.id, (c.concentracao + 1) % 4))}
              title="Marcador de concentração (só visual). Clique pra ciclar X1 → X2 → X3 → neutro."
              className={
                c.concentracao > 0
                  ? "rounded-md border border-violet-500/60 bg-violet-600/30 px-2 py-1 text-[11px] font-semibold text-violet-200 outline-none transition-colors duration-150 ease-out hover:bg-violet-600/40 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  : "rounded-md border border-violet-900/60 bg-violet-950/40 px-2 py-1 text-[11px] font-medium text-violet-300 outline-none transition-colors duration-150 ease-out hover:bg-violet-900/40 focus-visible:ring-2 focus-visible:ring-indigo-500"
              }
            >
              🧠 Concentração{c.concentracao > 0 ? ` X${c.concentracao}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setCalcAberta(true)}
              className="rounded-md border border-rose-900/60 bg-rose-950/40 px-2 py-1 text-[11px] font-medium text-rose-300 outline-none transition-colors duration-150 ease-out hover:bg-rose-900/40 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              🧮 Calculadora de dano
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {POOLS.map((p) => (
            <PoolEditor
              key={p.pool}
              combatente={c}
              pool={p.pool}
              label={p.label}
              corValor={p.cor}
              max={ficha ? ficha[p.pool] : undefined}
              roda={roda}
            />
          ))}
        </div>
      </div>

      {/* Formas / transformações (abaixo dos pools) */}
      {ficha && ficha.transformacoes.length > 0 && (
        <FormasTransformacao
          combatente={c}
          retratoBase={ficha.retrato}
          transformacoes={ficha.transformacoes}
          roda={roda}
        />
      )}

      {/* Atributos (base + mod = total + rank) */}
      <AtributosEditor combatente={c} roda={roda} />

      {/* Habilidades */}
      {ref != null && <HabilidadesLista combatente={c} habilidades={habilidades} roda={roda} />}

      {calcAberta && (
        <CalculadoraDano combatente={c} roda={roda} onFechar={() => setCalcAberta(false)} />
      )}
      {fichaAberta && ficha && (
        <FichaCompletaDialog ficha={ficha} onFechar={() => setFichaAberta(false)} />
      )}
    </div>
  );
}
