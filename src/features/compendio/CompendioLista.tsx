import { useState } from "react";
import Dialog from "../../components/Dialog";
import { IconBusca } from "../../components/icons";

interface ItemCatalogo {
  id: number;
  nome: string;
}

/** Mutation de exclusão já ligada ao endpoint certo (perícia ou traço) pelo Tab dono. */
interface MutationExcluir {
  mutate: (id: number) => void;
  isPending: boolean;
}

/**
 * Sidebar genérica do Compêndio: busca + lista + exclusão com confirmação.
 * Reusada pelas abas de Perícias e Vantagens/Desvantagens (mesmo formato de
 * lista, só o editor ao lado muda). Padrão espelha `ListaNotas`/`ListaMapas`.
 */
export default function CompendioLista<T extends ItemCatalogo>({
  itens,
  selecionadoId,
  busca,
  onBuscar,
  onSelecionar,
  onNovo,
  excluir,
  rotuloNovo,
  rotuloVazio,
  tituloExcluir,
}: {
  itens: T[];
  selecionadoId: number | null;
  busca: string;
  onBuscar: (v: string) => void;
  onSelecionar: (id: number) => void;
  onNovo: () => void;
  excluir: MutationExcluir;
  rotuloNovo: string;
  rotuloVazio: string;
  tituloExcluir: string;
}) {
  const [confirmar, setConfirmar] = useState<T | null>(null);

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-2">
      <button
        type="button"
        onClick={onNovo}
        className="mb-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20"
      >
        {rotuloNovo}
      </button>
      <label className="relative mb-2 block">
        <IconBusca className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => onBuscar(e.target.value)}
          placeholder="Buscar…"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/50 py-1.5 pl-8 pr-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500/50"
        />
      </label>
      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {itens.map((it) => (
          <li key={it.id}>
            <div
              className={`group flex items-center rounded-lg px-2 py-1.5 text-sm ${
                it.id === selecionadoId
                  ? "bg-indigo-500/10 text-indigo-200"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelecionar(it.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {it.nome || "(sem nome)"}
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => setConfirmar(it)}
                className="ml-1 hidden rounded px-1 text-xs text-rose-400 hover:text-rose-300 group-hover:block"
              >
                del
              </button>
            </div>
          </li>
        ))}
        {itens.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-slate-500">{rotuloVazio}</li>
        )}
      </ul>
      <Dialog
        aberto={confirmar !== null}
        titulo={tituloExcluir}
        descricao={
          confirmar
            ? `"${confirmar.nome || "(sem nome)"}" será removido do catálogo. Não dá pra desfazer.`
            : ""
        }
        textoConfirmar={excluir.isPending ? "Excluindo…" : "Excluir"}
        perigo
        onConfirmar={() => {
          if (!confirmar || excluir.isPending) return;
          excluir.mutate(confirmar.id);
          setConfirmar(null);
        }}
        onCancelar={() => setConfirmar(null)}
      />
    </aside>
  );
}
