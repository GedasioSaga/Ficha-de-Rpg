import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { retratoDataUrl } from "../../lib/api";
import type { CorEtiqueta, PersonagemResumo } from "../../lib/types";
import { IconDownload } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { gradienteDoNome, iniciais } from "./retrato";
import { estiloEtiqueta } from "./etiquetas";
import { exportarComDialogo } from "./portabilidade";

const ATRIBUTOS_CHAVE = [
  { chave: "forca", label: "FOR" },
  { chave: "agilidade", label: "AGI" },
  { chave: "resistencia", label: "RES" },
] as const;

interface Props {
  p: PersonagemResumo;
  /** Índice nome → cor pras chips (o resumo só traz o nome da etiqueta). */
  cores?: Map<string, CorEtiqueta>;
}

export default function CharacterCard({ p, cores }: Props) {
  const toast = useToast();
  const [exportando, setExportando] = useState(false);

  const { data: src, isLoading } = useQuery({
    queryKey: ["retrato", p.retrato],
    queryFn: () => retratoDataUrl(p.retrato!),
    enabled: !!p.retrato,
    staleTime: Infinity, // arquivo de imagem não muda em runtime
  });

  const temImagem = !!p.retrato && !!src;
  const carregandoImagem = !!p.retrato && isLoading;
  const ehJogador = p.tipo === "jogador";

  async function exportar() {
    setExportando(true);
    try {
      const n = await exportarComDialogo([p.id], `${p.nome}.json`);
      if (n != null) toast.sucesso(`Ficha de ${p.nome} exportada.`);
    } catch (e) {
      toast.erro(String(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    // O botão de exportar precisa ficar FORA do <Link> — botão dentro de âncora
    // navega junto no clique. Por isso o wrapper relativo com o botão irmão.
    <div className="group relative">
      <Link
        to={`/fichas/${p.id}`}
        aria-label={`Abrir ficha de ${p.nome}`}
        className="block overflow-hidden rounded-xl border border-slate-800 bg-slate-900 transition duration-200 hover:border-indigo-500/50 hover:ring-2 hover:ring-indigo-500/30 focus-visible:border-indigo-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        {/* Retrato */}
        <div className="relative aspect-[3/4] overflow-hidden bg-slate-800">
          {temImagem ? (
            <img
              src={src}
              alt={p.nome}
              loading="lazy"
              className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div
              className={`flex size-full items-center justify-center ${
                carregandoImagem ? "animate-pulse" : ""
              }`}
              style={{ backgroundImage: gradienteDoNome(p.nome) }}
            >
              <span className="text-2xl font-bold tracking-wide text-white/90">
                {iniciais(p.nome)}
              </span>
            </div>
          )}

          {/* Badge do tipo */}
          <span
            className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm ${
              ehJogador
                ? "bg-indigo-500/90 text-white"
                : "bg-slate-700/90 text-slate-100"
            }`}
          >
            {ehJogador ? "Jogador" : "NPC"}
          </span>
        </div>

        {/* Info */}
        <div className="p-3">
          <h3
            className="truncate text-sm font-semibold text-slate-100"
            title={p.nome}
          >
            {p.nome}
          </h3>

          {p.etiquetas.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.etiquetas.map((nome) => {
                const estilo = estiloEtiqueta(cores?.get(nome));
                return (
                  <span
                    key={nome}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium ${estilo.chip}`}
                  >
                    <span className={`size-1 shrink-0 rounded-full ${estilo.ponto}`} />
                    <span className="truncate">{nome}</span>
                  </span>
                );
              })}
            </div>
          )}

          <div className="mt-2.5 grid grid-cols-3 gap-1 border-t border-slate-800 pt-2.5">
            {ATRIBUTOS_CHAVE.map((a) => (
              <div key={a.chave} className="flex flex-col items-center">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {a.label}
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-200">
                  {p[a.chave]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={exportar}
        disabled={exportando}
        title={`Exportar ficha de ${p.nome}`}
        aria-label={`Exportar ficha de ${p.nome}`}
        className="absolute left-2 top-2 grid size-7 place-items-center rounded-md bg-slate-950/70 text-slate-300 opacity-0 backdrop-blur-sm transition hover:bg-slate-900 hover:text-slate-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 group-hover:opacity-100 disabled:opacity-50"
      >
        <IconDownload className="size-4" />
      </button>
    </div>
  );
}
