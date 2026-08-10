import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarEtiquetas, listarPersonagens } from "../../lib/api";

interface Props {
  selecionados: number[];
  onAlternar: (id: number) => void;
}

export default function SeletorPersonagens({ selecionados, onAlternar }: Props) {
  const [busca, setBusca] = useState("");
  const [etiqueta, setEtiqueta] = useState("");

  const { data: personagens = [] } = useQuery({
    queryKey: ["personagens", null],
    queryFn: () => listarPersonagens(null),
  });
  const { data: etiquetas = [] } = useQuery({
    queryKey: ["etiquetas"],
    queryFn: listarEtiquetas,
  });

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return personagens.filter((p) => {
      if (q && !p.nome.toLowerCase().includes(q)) return false;
      if (etiqueta && !p.etiquetas.includes(etiqueta)) return false;
      return true;
    });
  }, [personagens, busca, etiqueta]);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Personagens
      </h2>
      <div className="flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome…"
          className="h-9 flex-1 min-w-40 rounded-lg border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
        />
        <select
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          className="h-9 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-sm text-slate-300 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Todas as etiquetas</option>
          {etiquetas.map((et) => (
            <option key={et.id} value={et.nome}>
              {et.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
        {filtrados.map((p) => {
          const ativo = selecionados.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onAlternar(p.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                ativo
                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                  : "border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              {p.nome}
              <span className="ml-1.5 text-[10px] uppercase text-slate-500">
                {p.tipo === "npc" ? "NPC" : "PJ"}
              </span>
            </button>
          );
        })}
        {filtrados.length === 0 && (
          <p className="text-sm text-slate-600">Nenhum personagem encontrado.</p>
        )}
      </div>
    </section>
  );
}
