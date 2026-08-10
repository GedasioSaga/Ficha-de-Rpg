import type { MapaInput } from "../../lib/types";

export default function CamposMapa({
  input,
  onEditar,
}: {
  input: MapaInput;
  onEditar: (patch: Partial<MapaInput>) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <input
        value={input.titulo}
        onChange={(e) => onEditar({ titulo: e.target.value })}
        placeholder="Título do mapa"
        className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-600"
      />
      <Campo rotulo="Legenda" valor={input.legenda} onChange={(v) => onEditar({ legenda: v })} />
      <Campo rotulo="Efeito do Campo" valor={input.efeito} onChange={(v) => onEditar({ efeito: v })} textarea />
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  textarea,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  const classe =
    "w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500/50";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</span>
      {textarea ? (
        <textarea value={valor} onChange={(e) => onChange(e.target.value)} rows={3} className={`${classe} resize-y`} />
      ) : (
        <input value={valor} onChange={(e) => onChange(e.target.value)} className={classe} />
      )}
    </label>
  );
}
