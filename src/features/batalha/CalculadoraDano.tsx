import { useState } from "react";
import { batalhaCalculadoraDano } from "../../lib/api";
import type { Combatente, EstadoBatalha } from "../../lib/types";
import { IconFechar } from "../../components/icons";

interface Props {
  combatente: Combatente;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
  onFechar: () => void;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n) || 0));

/**
 * Calculadora de dano: um total distribuído por % entre Escudo/HP/SP, com overflow
 * do escudo pro HP e opção de repetir por N turnos (dano recorrente). Aplica tudo
 * num comando só (`batalha_calculadora_dano`) — atômico, um undo.
 */
export default function CalculadoraDano({ combatente: c, roda, onFechar }: Props) {
  const [total, setTotal] = useState(10);
  const [pctEscudo, setPctEscudo] = useState(100);
  const [pctHp, setPctHp] = useState(0);
  const [pctSp, setPctSp] = useState(0);
  const [overflow, setOverflow] = useState(true);
  const [repetir, setRepetir] = useState(false);
  const [turnos, setTurnos] = useState(3);

  const t = Math.max(0, Math.round(total) || 0);
  const E = Math.trunc((t * pctEscudo) / 100);
  const H = Math.trunc((t * pctHp) / 100);
  const S = Math.trunc((t * pctSp) / 100);

  // Preview instantâneo (mesma lógica do backend: escudo absorve, sobra transborda).
  const escudoAbsorve = Math.min(E, Math.max(0, c.pools.escudo));
  const sobra = overflow ? E - escudoAbsorve : 0;
  const novoEscudo = Math.max(0, c.pools.escudo - escudoAbsorve);
  const novoHp = Math.max(0, c.pools.hp - sobra - H);
  const novoSp = Math.max(0, c.pools.sp - S);
  const temDano = E > 0 || H > 0 || S > 0;

  function aplicar() {
    roda(() =>
      batalhaCalculadoraDano(
        c.id,
        { hp: H, sp: S, escudo: E, escudoTransborda: overflow },
        repetir ? Math.max(1, turnos) : null,
      ),
    );
    onFechar();
  }

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
          <div>
            <h2 className="text-base font-semibold text-slate-100">🧮 Calculadora de dano</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Alvo: <span className="text-slate-300">{c.nome}</span> · HP {c.pools.hp} · Escudo{" "}
              {c.pools.escudo}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 hover:text-slate-200"
          >
            <IconFechar className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={total}
            onChange={(e) => setTotal(Number(e.target.value) || 0)}
            className="h-11 w-24 rounded-lg border border-slate-800 bg-slate-950 text-center text-2xl font-bold tabular-nums text-slate-100 outline-none focus:border-indigo-500"
          />
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Dano total
            </div>
            <div className="text-[11px] text-slate-600">distribua por % abaixo</div>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <LinhaSplit label="Escudo" cor="text-amber-300" barra="bg-amber-400" pct={pctEscudo} setPct={setPctEscudo} delta={E} />
          <LinhaSplit label="HP" cor="text-rose-300" barra="bg-rose-500" pct={pctHp} setPct={setPctHp} delta={H} />
          <LinhaSplit label="SP" cor="text-sky-300" barra="bg-sky-400" pct={pctSp} setPct={setPctSp} delta={S} />
        </div>

        <label className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-300">
          Sobra do escudo vai pro HP
          <input
            type="checkbox"
            checked={overflow}
            onChange={(e) => setOverflow(e.target.checked)}
            className="size-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
          />
        </label>

        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={repetir}
              onChange={(e) => setRepetir(e.target.checked)}
              className="size-4 rounded border-slate-700 bg-slate-950 accent-rose-500"
            />
            Repetir dano <span className="text-slate-500">· recorrente</span>
          </label>
          <div className={`flex items-center gap-2 ${repetir ? "" : "pointer-events-none opacity-40"}`}>
            <button
              type="button"
              onClick={() => setTurnos((n) => Math.max(1, n - 1))}
              className="grid size-6 place-items-center rounded-md border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
            >
              −
            </button>
            <span className="min-w-6 text-center text-sm font-bold tabular-nums">{turnos}</span>
            <button
              type="button"
              onClick={() => setTurnos((n) => Math.min(20, n + 1))}
              className="grid size-6 place-items-center rounded-md border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
            >
              +
            </button>
            <span className="text-[11px] text-slate-500">turnos</span>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <PrevLinha k="HP" de={c.pools.hp} para={novoHp} />
          <PrevLinha k="Escudo" de={c.pools.escudo} para={novoEscudo} />
          {S > 0 && <PrevLinha k="SP" de={c.pools.sp} para={novoSp} />}
          {repetir && temDano && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Efeito</span>
              <span className="text-rose-300">
                repete por {Math.max(1, turnos)} turno{turnos > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            disabled={!temDano}
            className="h-9 rounded-lg bg-rose-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-rose-400 disabled:pointer-events-none disabled:opacity-40"
          >
            Aplicar dano
          </button>
        </div>
      </div>
    </div>
  );
}

function LinhaSplit({
  label,
  cor,
  barra,
  pct,
  setPct,
  delta,
}: {
  label: string;
  cor: string;
  barra: string;
  pct: number;
  setPct: (n: number) => void;
  delta: number;
}) {
  return (
    <div className="grid grid-cols-[56px_1fr_54px_46px] items-center gap-2.5">
      <span className={`text-xs font-bold uppercase tracking-wide ${cor}`}>{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${barra}`} style={{ width: `${clampPct(pct)}%` }} />
      </div>
      <div className="flex items-center rounded-md border border-slate-800 bg-slate-950">
        <input
          type="number"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => setPct(clampPct(Number(e.target.value)))}
          className="w-9 bg-transparent py-1 text-center text-xs tabular-nums text-slate-100 outline-none"
        />
        <span className="pr-1 text-[10px] text-slate-500">%</span>
      </div>
      <span className={`text-right text-sm font-bold tabular-nums ${delta > 0 ? cor : "text-slate-600"}`}>
        {delta > 0 ? `−${delta}` : "0"}
      </span>
    </div>
  );
}

function PrevLinha({ k, de, para }: { k: string; de: number; para: number }) {
  return (
    <div className="flex items-center justify-between text-sm tabular-nums">
      <span className="text-xs text-slate-500">{k}</span>
      <span>
        <span className="text-slate-400">{de}</span>
        <span className="mx-1.5 text-slate-600">→</span>
        <span className={`font-bold ${para < de ? "text-rose-300" : "text-slate-200"}`}>{para}</span>
      </span>
    </div>
  );
}
