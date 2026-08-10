import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { excluirNota } from "../../lib/api";
import type { NotaResumo } from "../../lib/types";
import Dialog from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { IconBusca } from "../../components/icons";

export default function ListaNotas({
  notas,
  selecionada,
  busca,
  onBuscar,
  onSelecionar,
  onNovo,
  onMudou,
  onExcluida,
}: {
  notas: NotaResumo[];
  selecionada: number | null;
  busca: string;
  onBuscar: (v: string) => void;
  onSelecionar: (id: number) => void;
  onNovo: () => void;
  onMudou: () => void;
  /** Chamado só quando a nota excluída era a selecionada. `prox` = id da próxima sobrevivente (na lista filtrada atual), ou `null` se não sobrou nenhuma. */
  onExcluida: (prox: number | null) => void;
}) {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<NotaResumo | null>(null);

  const excluir = useMutation({
    mutationFn: (id: number) => excluirNota(id),
    onSuccess: (_res, id) => {
      onMudou();
      if (id === selecionada) {
        const prox = notas.find((n) => n.id !== id)?.id ?? null;
        onExcluida(prox);
      }
      setConfirmar(null);
      toast.sucesso("Nota excluída.");
    },
    onError: (e) => {
      setConfirmar(null);
      toast.erro(String(e));
    },
  });

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-2">
      <button
        type="button"
        onClick={onNovo}
        className="mb-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20"
      >
        + Nova nota
      </button>
      <label className="relative mb-2 block">
        <IconBusca className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => onBuscar(e.target.value)}
          placeholder="Buscar por título…"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/50 py-1.5 pl-8 pr-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500/50"
        />
      </label>
      <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
        {notas.map((n) => (
          <li key={n.id}>
            <div
              className={`group flex items-center rounded-lg px-2 py-1.5 text-sm ${
                n.id === selecionada ? "bg-indigo-500/10 text-indigo-200" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelecionar(n.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {n.titulo || "(sem título)"}
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => setConfirmar(n)}
                className="ml-1 hidden rounded px-1 text-xs text-rose-400 hover:text-rose-300 group-hover:block"
              >
                del
              </button>
            </div>
          </li>
        ))}
        {notas.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-slate-500">Nenhuma nota encontrada.</li>
        )}
      </ul>
      <Dialog
        aberto={confirmar !== null}
        titulo="Excluir nota?"
        descricao={confirmar ? `"${confirmar.titulo || "(sem título)"}" será removida. Não dá pra desfazer.` : ""}
        textoConfirmar={excluir.isPending ? "Excluindo…" : "Excluir"}
        perigo
        onConfirmar={() => {
          if (!excluir.isPending && confirmar) excluir.mutate(confirmar.id);
        }}
        onCancelar={() => setConfirmar(null)}
      />
    </aside>
  );
}
