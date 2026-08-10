import { useEffect, useMemo, useState } from "react";
import { IconCompendio, IconFechar } from "../../../components/icons";
import { BOTAO_SECUNDARIO } from "./Campos";

/**
 * Botão "Escolher do catálogo" que abre um popover com busca client-side.
 * Genérico sobre qualquer item com `nome`/`descricao` (perícia ou traço).
 */
export default function CatalogoPicker<T extends { nome: string; descricao: string }>({
  titulo,
  itens,
  onEscolher,
}: {
  titulo: string;
  itens: T[];
  onEscolher: (item: T) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return itens;
    return itens.filter(
      (it) =>
        it.nome.toLowerCase().includes(termo) || it.descricao.toLowerCase().includes(termo),
    );
  }, [itens, busca]);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  function escolher(item: T) {
    onEscolher(item);
    setAberto(false);
    setBusca("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={itens.length === 0}
        className={BOTAO_SECUNDARIO}
      >
        <IconCompendio className="size-4" />
        Escolher do catálogo
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <div
            onMouseDown={() => setAberto(false)}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            className="relative flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">{titulo}</h2>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
              >
                <IconFechar className="size-4" />
              </button>
            </div>

            <div className="p-3">
              <input
                type="text"
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar…"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
              {filtrados.length === 0 ? (
                <li className="py-6 text-center text-sm text-slate-500">Nada encontrado.</li>
              ) : (
                filtrados.map((it, i) => (
                  <li key={`${it.nome}-${i}`}>
                    <button
                      type="button"
                      onClick={() => escolher(it)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-left transition-colors hover:border-indigo-500/50 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                    >
                      <span className="block text-sm font-medium text-slate-100">{it.nome}</span>
                      {it.descricao && (
                        <span className="mt-0.5 block truncate text-xs text-slate-400">
                          {it.descricao}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
