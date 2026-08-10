import { useEffect, useState } from "react";
import { batalhaCurar, batalhaDano } from "../../lib/api";
import type { Combatente, EstadoBatalha, PoolNome } from "../../lib/types";

interface Props {
  combatente: Combatente;
  pool: PoolNome;
  label: string;
  corValor: string;
  /** Máximo da pool (vem da ficha); habilita a barra. Ausente = combatente sem ficha. */
  max?: number;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

/** Editor compacto de uma pool: valor direto + calculadora (soma/subtrai/%). */
export default function PoolEditor({ combatente: c, pool, label, corValor, max, roda }: Props) {
  const atual = c.pools[pool];
  const [aberto, setAberto] = useState(false);
  const [campoValor, setCampoValor] = useState(String(atual));
  const [quantia, setQuantia] = useState(10);
  const [base, setBase] = useState(atual);
  const [pct, setPct] = useState(10);

  // re-sincroniza os campos ao trocar de combatente ou quando o valor muda por fora
  useEffect(() => {
    setCampoValor(String(atual));
    setBase(atual);
  }, [atual, c.id]);

  const id = c.id;

  /** Leva a pool ao valor absoluto `novo` (via dano/cura pelo delta). */
  function definir(novo: number) {
    const delta = novo - atual;
    if (delta > 0) roda(() => batalhaCurar(id, delta, pool));
    else if (delta < 0) roda(() => batalhaDano(id, -delta, pool));
  }
  const somar = (n: number) => n > 0 && roda(() => batalhaCurar(id, n, pool));
  const subtrair = (n: number) => n > 0 && roda(() => batalhaDano(id, n, pool));
  const pctDe = (b: number, p: number) => Math.trunc((b * p) / 100);

  // Barra (só quando há máximo, i.e. combatente com ficha). Cor do HP por faixa.
  const ratio = max && max > 0 ? Math.max(0, atual) / max : 0;
  const barraPct = Math.min(100, Math.round(ratio * 100));
  const corBarra =
    pool === "hp"
      ? ratio <= 0.25
        ? "bg-rose-500"
        : ratio <= 0.5
          ? "bg-amber-400"
          : "bg-emerald-500"
      : pool === "sp"
        ? "bg-sky-400"
        : "bg-amber-300";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-label={`Calculadora de ${label}`}
          className={`rounded px-1 text-xs outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-indigo-500 ${aberto ? "text-indigo-300" : "text-slate-600 hover:text-slate-300"}`}
        >
          🧮
        </button>
      </div>

      <input
        type="number"
        value={campoValor}
        onChange={(e) => setCampoValor(e.target.value)}
        onBlur={() => {
          const n = Number(campoValor);
          if (Number.isFinite(n) && n !== atual) definir(Math.max(0, n));
          else setCampoValor(String(atual));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`mt-0.5 w-full rounded bg-transparent text-lg font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${corValor}`}
      />

      {max != null && max > 0 && (
        <div className="mt-1 flex items-center gap-1.5">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800 ring-1 ring-inset ring-slate-700/50">
            <div
              className={`h-full rounded-full transition-all ${corBarra}`}
              style={{ width: `${barraPct}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-slate-600">/{max}</span>
        </div>
      )}

      {aberto && (
        <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={quantia}
              onChange={(e) => setQuantia(Math.max(0, Number(e.target.value) || 0))}
              className="h-7 w-14 rounded-md border border-slate-800 bg-slate-900 px-1.5 text-center text-sm text-slate-100 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <button type="button" onClick={() => subtrair(quantia)} className={BTN_MENOS}>
              −
            </button>
            <button type="button" onClick={() => somar(quantia)} className={BTN_MAIS}>
              +
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="number"
              value={base}
              onChange={(e) => setBase(Number(e.target.value) || 0)}
              title="Valor base"
              className="h-7 w-16 rounded-md border border-slate-800 bg-slate-900 px-1.5 text-center text-sm text-slate-100 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <input
              type="number"
              value={pct}
              onChange={(e) => setPct(Number(e.target.value) || 0)}
              title="Porcentagem"
              className="h-7 w-12 rounded-md border border-slate-800 bg-slate-900 px-1.5 text-center text-sm text-slate-100 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <span className="text-[11px] text-slate-500">%</span>
            <button type="button" onClick={() => definir(Math.max(0, pctDe(base, pct)))} className={BTN_NEUTRO}>
              Definir
            </button>
            <button type="button" onClick={() => somar(pctDe(base, pct))} className={BTN_MAIS}>
              Recuperar
            </button>
            <button type="button" onClick={() => subtrair(pctDe(base, pct))} className={BTN_MENOS}>
              Perder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const BTN =
  "h-7 rounded-md px-2 text-[11px] font-medium outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-indigo-500";
const BTN_MAIS = `${BTN} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`;
const BTN_MENOS = `${BTN} bg-rose-500/15 text-rose-300 hover:bg-rose-500/25`;
const BTN_NEUTRO = `${BTN} border border-slate-700 text-slate-300 hover:bg-slate-800`;
