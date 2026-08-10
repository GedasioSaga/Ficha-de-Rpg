import type { NotaInput } from "../../lib/types";

export default function EditorNota({
  input,
  temSelecao,
  onEditar,
}: {
  input: NotaInput;
  temSelecao: boolean;
  onEditar: (patch: Partial<NotaInput>) => void;
}) {
  if (!temSelecao) {
    return (
      <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-900/40 text-sm text-slate-500">
        Nenhuma nota selecionada. Clique em "+ Nova nota" para começar.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <input
        value={input.titulo}
        onChange={(e) => onEditar({ titulo: e.target.value })}
        placeholder="Título da nota"
        className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-600"
      />
      <textarea
        value={input.corpo}
        onChange={(e) => onEditar({ corpo: e.target.value })}
        placeholder="Escreva aqui…"
        className="min-h-0 flex-1 resize-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none focus:border-indigo-500/50"
      />
    </div>
  );
}
