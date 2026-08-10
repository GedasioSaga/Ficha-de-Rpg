import { useState } from "react";
import { batalhaReabilitar, batalhaUsarHabilidade } from "../../lib/api";
import type { Combatente, EstadoBatalha, HabilidadeDto } from "../../lib/types";
import { IconFechar } from "../../components/icons";
import CamposTecnica, { resumoTecnica } from "../characters/CamposTecnica";
import { cooldownDe } from "./logica";

interface Props {
  combatente: Combatente;
  habilidades: HabilidadeDto[];
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

export default function HabilidadesLista({ combatente: c, habilidades, roda }: Props) {
  const [detalhe, setDetalhe] = useState<HabilidadeDto | null>(null);

  if (habilidades.length === 0) {
    return (
      <div className="py-2">
        <p className="text-sm text-slate-500">Nenhuma habilidade.</p>
        <p className="mt-0.5 text-[11px] text-slate-600">
          Cadastre habilidades na ficha do personagem.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Habilidades
      </h3>
      <ul className="space-y-1">
        {habilidades.map((h, i) => {
          const cd = cooldownDe(c, h.nome);
          const travada = cd !== null;
          // Uma linha só: no meio da partida o que se lê de relance é Ação/Custo/Dano.
          const resumo = resumoTecnica(h);
          return (
            <li
              key={`${h.nome}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => setDetalhe(h)}
                className={`group min-w-0 flex-1 rounded text-left outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  travada ? "text-rose-300" : "text-slate-200"
                }`}
              >
                <span className="block truncate text-sm group-hover:underline">{h.nome}</span>
                {resumo.length > 0 && (
                  <span className="block truncate text-[10px] text-slate-500">
                    {resumo.join(" · ")}
                  </span>
                )}
              </button>
              {travada && (
                <span className="shrink-0 text-[10px] text-rose-400/80">
                  {cd?.turnos_restantes != null ? `${cd.turnos_restantes}t` : "perm."}
                </span>
              )}
              {travada ? (
                <button
                  type="button"
                  onClick={() => roda(() => batalhaReabilitar(c.id, h.nome))}
                  className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-300 outline-none transition-colors duration-150 ease-out hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  Reabilitar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => roda(() => batalhaUsarHabilidade(c.id, h.nome, h.tempo))}
                  className="shrink-0 rounded-md bg-indigo-500/90 px-2 py-1 text-[11px] font-medium text-white outline-none transition-colors duration-150 ease-out hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  Usar
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {detalhe && (
        <DetalheHabilidade
          h={detalhe}
          travada={cooldownDe(c, detalhe.nome) !== null}
          onFechar={() => setDetalhe(null)}
          onUsar={() => {
            roda(() => batalhaUsarHabilidade(c.id, detalhe.nome, detalhe.tempo));
            setDetalhe(null);
          }}
          onReabilitar={() => {
            roda(() => batalhaReabilitar(c.id, detalhe.nome));
            setDetalhe(null);
          }}
        />
      )}
    </div>
  );
}

function DetalheHabilidade({
  h,
  travada,
  onFechar,
  onUsar,
  onReabilitar,
}: {
  h: HabilidadeDto;
  travada: boolean;
  onFechar: () => void;
  onUsar: () => void;
  onReabilitar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">{h.nome}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <IconFechar className="size-4" />
          </button>
        </div>
        {h.descricao && (
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{h.descricao}</p>
        )}
        <CamposTecnica h={h} />
        <div className="mt-5 flex justify-end gap-2">
          {travada ? (
            <button
              type="button"
              onClick={onReabilitar}
              className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 outline-none transition-colors duration-150 ease-out hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              Reabilitar
            </button>
          ) : (
            <button
              type="button"
              onClick={onUsar}
              className="h-9 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white outline-none transition-colors duration-150 ease-out hover:bg-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Usar habilidade
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
