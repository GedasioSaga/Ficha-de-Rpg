import { useLayoutEffect, useRef } from "react";
import { ATRIBUTOS, ROTULO_ATRIBUTO } from "../atributos";

// Estilos compartilhados pelos campos e botões do formulário (idioma do projeto).
const BORDA =
  "rounded-lg border border-slate-800 bg-slate-900 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30";
/** Exportado para inputs sem rótulo próprio (ex.: pares nome/valor em linha). */
export const INPUT = `h-10 w-full px-3 ${BORDA}`;

export const CARTAO_FORM = "rounded-2xl border border-slate-800 bg-slate-900/60 p-4";
export const BOTAO_PRIMARIO =
  "inline-flex items-center gap-1.5 h-9 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50";
export const BOTAO_SECUNDARIO =
  "inline-flex items-center gap-1.5 h-9 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 disabled:cursor-not-allowed disabled:opacity-50";
export const BOTAO_LIXEIRA =
  "grid size-9 shrink-0 place-items-center rounded-lg border border-slate-800 text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40";

export function CampoTexto({
  label,
  valor,
  onChange,
  placeholder,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type="text"
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  );
}

export function CampoNumero({
  label,
  valor,
  onChange,
  min = 0,
}: {
  label: string;
  valor: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type="number"
        value={Number.isFinite(valor) ? valor : 0}
        min={min}
        onChange={(e) => onChange(coagirNumero(e.target.value, min))}
        className={`${INPUT} tabular-nums`}
      />
    </label>
  );
}

export function Textarea({
  label,
  valor,
  onChange,
  placeholder,
  linhas = 3,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Altura mínima em linhas; o campo cresce sozinho além disso. */
  linhas?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Descrição de técnica costuma ter vários parágrafos: em vez de rolar dentro de
  // uma caixa de 3 linhas, o campo cresce com o conteúdo. `useLayoutEffect` mede
  // antes da pintura, então não pisca ao abrir uma ficha já preenchida.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto"; // zera antes de medir, senão só cresce
    el.style.height = `${el.scrollHeight}px`;
  }, [valor]);

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <textarea
        ref={ref}
        value={valor}
        placeholder={placeholder}
        rows={linhas}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full resize-none overflow-hidden px-3 py-2 leading-relaxed ${BORDA}`}
      />
    </label>
  );
}

export function Select({
  label,
  valor,
  onChange,
  opcoes,
}: {
  label?: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; label: string }[];
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>}
      <div className="relative">
        <select
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} appearance-none pr-9`}
        >
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor} className="bg-slate-900 text-slate-100">
              {o.label}
            </option>
          ))}
        </select>
        <Caret />
      </div>
    </label>
  );
}

/** `<select>` dos 8 atributos (mesma ordem/rótulos de `atributos.ts`). */
export function SelectAtributo({
  label,
  valor,
  onChange,
}: {
  label?: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      label={label}
      valor={valor}
      onChange={onChange}
      opcoes={ATRIBUTOS.map((a) => ({ valor: a, label: ROTULO_ATRIBUTO[a] }))}
    />
  );
}

function Caret() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Número seguro: NaN vira `min`, abaixo do mínimo é clampado, sempre inteiro. */
function coagirNumero(bruto: string, min: number): number {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return min;
  const inteiro = Math.trunc(n);
  return inteiro < min ? min : inteiro;
}
