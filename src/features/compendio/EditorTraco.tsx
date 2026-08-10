import type { CatalogoTracoInput } from "../../lib/types";

export default function EditorTraco({
  input,
  temSelecao,
  sujo,
  salvando,
  rotuloVazio,
  onEditar,
  onSalvar,
  onCancelar,
}: {
  input: CatalogoTracoInput;
  temSelecao: boolean;
  sujo: boolean;
  salvando: boolean;
  rotuloVazio: string;
  onEditar: (patch: Partial<CatalogoTracoInput>) => void;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  if (!temSelecao) {
    return (
      <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-900/40 text-sm text-slate-500">
        {rotuloVazio}
      </div>
    );
  }

  const nomeValido = input.nome.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <input
        value={input.nome}
        onChange={(e) => onEditar({ nome: e.target.value })}
        placeholder="Nome"
        className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-600"
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-400">Efeito</span>
        <textarea
          value={input.efeito}
          onChange={(e) => onEditar({ efeito: e.target.value })}
          placeholder="Efeito mecânico…"
          rows={2}
          className="w-full resize-y rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none focus:border-indigo-500/50"
        />
      </label>
      <textarea
        value={input.descricao}
        onChange={(e) => onEditar({ descricao: e.target.value })}
        placeholder="Descrição…"
        className="min-h-0 flex-1 resize-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm leading-relaxed text-slate-200 outline-none focus:border-indigo-500/50"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={!sujo || salvando}
          className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onSalvar}
          disabled={!sujo || !nomeValido || salvando}
          className="h-9 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
