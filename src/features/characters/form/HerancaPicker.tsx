import { useEffect, useState } from "react";
import type { HabilidadeDto } from "../../../lib/types";
import { IconDownload, IconFechar } from "../../../components/icons";
import { BOTAO_SECUNDARIO } from "./Campos";
import { resumoTecnica } from "../CamposTecnica";

/** Grupo de origem no picker: "Forma base", "Transformação 2 — Nome"… */
export interface FonteHeranca {
  rotulo: string;
  habilidades: HabilidadeDto[];
}

/**
 * Botão "Herança" que abre um popover multi-seleção com as habilidades das
 * outras formas (base + demais transformações), agrupadas por origem. Confirmar
 * entrega as selecionadas ao chamador, que decide como copiá-las.
 *
 * A seleção é indexada por `uid` (chave client-only já única no processo), não
 * por nome: duas formas podem ter técnicas homônimas e marcar uma não pode
 * marcar a outra.
 */
export default function HerancaPicker({
  fontes,
  onHerdar,
}: {
  fontes: FonteHeranca[];
  onHerdar: (habilidades: HabilidadeDto[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());

  const disponiveis = fontes.filter((f) => f.habilidades.length > 0);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  const alternar = (uid: string) =>
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(uid)) proximo.add(uid);
      return proximo;
    });

  const fechar = () => {
    setAberto(false);
    setSelecionados(new Set());
  };

  const confirmar = () => {
    const escolhidas = disponiveis
      .flatMap((f) => f.habilidades)
      .filter((h) => h.uid != null && selecionados.has(h.uid));
    fechar();
    if (escolhidas.length > 0) onHerdar(escolhidas);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={disponiveis.length === 0}
        title={
          disponiveis.length === 0
            ? "Nenhuma outra forma tem habilidades para herdar"
            : undefined
        }
        className={`${BOTAO_SECUNDARIO} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <IconDownload className="size-4" />
        Herança
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <div
            onMouseDown={fechar}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Herdar habilidades"
            className="relative flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">
                Herdar habilidades
              </h2>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                <IconFechar className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {disponiveis.map((fonte) => (
                <div key={fonte.rotulo}>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {fonte.rotulo}
                  </span>
                  <ul className="space-y-1">
                    {fonte.habilidades.map((h, i) => {
                      const uid = h.uid;
                      if (uid == null) return null;
                      const marcada = selecionados.has(uid);
                      const chips = resumoTecnica(h);
                      return (
                        <li key={uid ?? i}>
                          <label
                            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                              marcada
                                ? "border-indigo-500/60 bg-indigo-500/10"
                                : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-800/60"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => alternar(uid)}
                              className="size-4 shrink-0 accent-indigo-500"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-100">
                                {(h.nome ?? "").trim() || "(sem nome)"}
                              </span>
                              {chips.length > 0 && (
                                <span className="mt-0.5 block truncate text-xs text-slate-400">
                                  {chips.join(" · ")}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 p-3">
              <button
                type="button"
                onClick={fechar}
                className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={selecionados.size === 0}
                className="h-9 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Herdar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
