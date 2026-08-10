import type { CatalogoPericiaInput } from "../../lib/types";
import { ATRIBUTOS, ROTULO_ATRIBUTO } from "../characters/atributos";

export default function EditorPericia({
  input,
  temSelecao,
  sujo,
  salvando,
  onEditar,
  onSalvar,
  onCancelar,
}: {
  input: CatalogoPericiaInput;
  temSelecao: boolean;
  sujo: boolean;
  salvando: boolean;
  onEditar: (patch: Partial<CatalogoPericiaInput>) => void;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  if (!temSelecao) {
    return (
      <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-900/40 text-sm text-slate-500">
        Nenhuma perícia selecionada. Clique em "+ Nova perícia" ou escolha uma na lista.
      </div>
    );
  }

  const nomeValido = input.nome.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <input
        value={input.nome}
        onChange={(e) => onEditar({ nome: e.target.value })}
        placeholder="Nome da perícia"
        className="w-full bg-transparent text-lg font-semibold text-slate-100 outline-none placeholder:text-slate-600"
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-400">Atributo</span>
        <select
          value={input.atributo}
          onChange={(e) => onEditar({ atributo: e.target.value })}
          className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
        >
          {ATRIBUTOS.map((a) => (
            <option key={a} value={a} className="bg-slate-900 text-slate-100">
              {ROTULO_ATRIBUTO[a]}
            </option>
          ))}
        </select>
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
