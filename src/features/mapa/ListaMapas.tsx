import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { duplicarMapa, excluirMapa } from "../../lib/api";
import type { MapaResumo } from "../../lib/types";
import Dialog from "../../components/Dialog";
import { useToast } from "../../components/Toast";

export default function ListaMapas({
  mapas,
  selecionado,
  onSelecionar,
  onNovo,
  onMudou,
  onExcluido,
}: {
  mapas: MapaResumo[];
  selecionado: number | null;
  onSelecionar: (id: number) => void;
  onNovo: () => void;
  onMudou: () => void;
  /** Chamado só quando o mapa excluído era o selecionado. `prox` = id do próximo sobrevivente, ou `null` se a lista ficou vazia. */
  onExcluido: (prox: number | null) => void;
}) {
  const toast = useToast();
  const [confirmar, setConfirmar] = useState<MapaResumo | null>(null);

  const duplicar = useMutation({
    mutationFn: (id: number) => duplicarMapa(id),
    onSuccess: (m) => {
      onMudou();
      onSelecionar(m.id);
      toast.sucesso("Mapa duplicado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const excluir = useMutation({
    mutationFn: (id: number) => excluirMapa(id),
    onSuccess: (_res, id) => {
      onMudou();
      if (id === selecionado) {
        // calcula o sobrevivente a partir da lista atual (pode estar stale, mas nunca inclui `id`
        // de propósito) em vez de deixar o auto-pick genérico reselecionar o id recém-apagado
        const prox = mapas.find((mm) => mm.id !== id)?.id ?? null;
        onExcluido(prox);
      }
      setConfirmar(null);
      toast.sucesso("Mapa excluído.");
    },
    onError: (e) => {
      setConfirmar(null);
      toast.erro(String(e));
    },
  });

  return (
    <aside className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-2 lg:min-h-0">
      <button
        type="button"
        onClick={onNovo}
        className="mb-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/20"
      >
        + Novo mapa
      </button>
      {/* min-h-0/overflow só de lg pra cima: empilhado, a lista cresce livre
          e quem rola é o cockpit inteiro (mesmo princípio do RosterPanel). */}
      <ul className="flex-1 space-y-1 lg:min-h-0 lg:overflow-auto">
        {mapas.map((m) => (
          <li key={m.id}>
            <div
              className={`group flex items-center rounded-lg px-2 py-1.5 text-sm ${
                m.id === selecionado ? "bg-indigo-500/10 text-indigo-200" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelecionar(m.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {m.titulo || "(sem título)"}
              </button>
              <button
                type="button"
                title="Duplicar"
                disabled={duplicar.isPending}
                onClick={() => duplicar.mutate(m.id)}
                className="ml-1 hidden rounded px-1 text-xs text-slate-400 hover:text-slate-100 group-hover:block disabled:pointer-events-none disabled:opacity-40"
              >
                dup
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => setConfirmar(m)}
                className="ml-1 hidden rounded px-1 text-xs text-rose-400 hover:text-rose-300 group-hover:block"
              >
                del
              </button>
            </div>
          </li>
        ))}
        {mapas.length === 0 && (
          <li className="px-2 py-4 text-center text-xs text-slate-500">Nenhum mapa ainda.</li>
        )}
      </ul>
      <Dialog
        aberto={confirmar !== null}
        titulo="Excluir mapa?"
        descricao={confirmar ? `"${confirmar.titulo || "(sem título)"}" será removido. Não dá pra desfazer.` : ""}
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
