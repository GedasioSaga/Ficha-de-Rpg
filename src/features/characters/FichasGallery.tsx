import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listarEtiquetas, listarPersonagens } from "../../lib/api";
import type { Tipo } from "../../lib/types";
import {
  IconBusca,
  IconDownload,
  IconFichas,
  IconMais,
  IconUpload,
} from "../../components/icons";
import { useToast } from "../../components/Toast";
import CharacterCard from "./CharacterCard";
import ChipsEtiquetas from "./ChipsEtiquetas";
import { coresPorNome, filtrarPorEtiquetas } from "./etiquetas";
import {
  exportarComDialogo,
  importarComDialogo,
  nomeArquivoLote,
} from "./portabilidade";

type FiltroTipo = Tipo | null;

const FILTROS: { valor: FiltroTipo; label: string }[] = [
  { valor: null, label: "Todos" },
  { valor: "jogador", label: "Jogadores" },
  { valor: "npc", label: "NPCs" },
];

const GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
const BOTAO_NOVO =
  "inline-flex shrink-0 items-center gap-1.5 h-10 rounded-lg bg-indigo-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 active:scale-[0.98]";
const BOTAO_ICONE =
  "inline-flex shrink-0 items-center gap-1.5 h-10 rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 active:scale-[0.98]";

export default function FichasGallery() {
  const [tipo, setTipo] = useState<FiltroTipo>(null);
  const [busca, setBusca] = useState("");
  const [etiquetasFiltro, setEtiquetasFiltro] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["personagens", tipo],
    queryFn: () => listarPersonagens(tipo),
  });
  const { data: etiquetas } = useQuery({
    queryKey: ["etiquetas"],
    queryFn: listarEtiquetas,
  });

  const filtrados = useMemo(() => {
    const porEtiqueta = filtrarPorEtiquetas(data ?? [], etiquetasFiltro);
    const termo = busca.trim().toLowerCase();
    if (!termo) return porEtiqueta;
    return porEtiqueta.filter((p) => p.nome.toLowerCase().includes(termo));
  }, [data, busca, etiquetasFiltro]);

  const cores = useMemo(() => coresPorNome(etiquetas ?? []), [etiquetas]);

  /** Exporta o que está na tela agora (respeita tipo, busca e etiquetas). */
  async function exportarVisiveis() {
    if (filtrados.length === 0) return;
    setOcupado(true);
    try {
      const n = await exportarComDialogo(
        filtrados.map((p) => p.id),
        nomeArquivoLote(),
      );
      if (n != null) toast.sucesso(`${n} ${n === 1 ? "ficha exportada" : "fichas exportadas"}.`);
    } catch (e) {
      toast.erro(String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    try {
      const r = await importarComDialogo();
      if (!r) return;
      qc.invalidateQueries({ queryKey: ["personagens"] });
      qc.invalidateQueries({ queryKey: ["etiquetas"] });
      if (r.importadas > 0) {
        toast.sucesso(
          `${r.importadas} ${r.importadas === 1 ? "ficha importada" : "fichas importadas"}.`,
        );
      }
      // Erro por ficha não invalida o lote — mostra o que ficou de fora.
      if (r.erros.length > 0) toast.erro(`Não importadas: ${r.erros.join(" · ")}`);
    } catch (e) {
      toast.erro(String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      {/* Cabeçalho */}
      <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/70 pb-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              Fichas
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">
              {isLoading
                ? "carregando…"
                : `${filtrados.length} ${
                    filtrados.length === 1 ? "personagem" : "personagens"
                  }`}
            </p>
          </div>

          {/* Busca + import/export + novo */}
          <div className="flex items-center gap-2">
            <div className="relative w-full max-w-xs">
              <IconBusca className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome…"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <button
              type="button"
              onClick={importar}
              disabled={ocupado}
              className={BOTAO_ICONE}
              title="Importar fichas de um arquivo .json"
            >
              <IconUpload className="size-4" />
              Importar
            </button>
            <button
              type="button"
              onClick={exportarVisiveis}
              disabled={ocupado || filtrados.length === 0}
              className={BOTAO_ICONE}
              title="Exportar as fichas visíveis (respeita filtro e busca)"
            >
              <IconDownload className="size-4" />
              Exportar {filtrados.length > 0 && `(${filtrados.length})`}
            </button>
            <Link to="/fichas/novo" className={BOTAO_NOVO}>
              <IconMais className="size-4" />
              Novo personagem
            </Link>
          </div>
        </div>

        {/* Filtro por tipo */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 self-start rounded-lg border border-slate-800 bg-slate-900 p-1">
            {FILTROS.map((f) => {
              const ativo = f.valor === tipo;
              return (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setTipo(f.valor)}
                  className={`h-8 rounded-md px-3 text-sm font-medium transition-colors active:scale-[0.98] ${
                    ativo
                      ? "bg-indigo-500 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Filtro por etiqueta (E: marcar duas deixa só quem tem as duas) */}
          <ChipsEtiquetas
            etiquetas={etiquetas ?? []}
            selecionadas={etiquetasFiltro}
            onChange={setEtiquetasFiltro}
            comTotal
          />
        </div>
      </header>

      {/* Conteúdo */}
      {isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
            >
              <div className="aspect-[3/4] animate-pulse bg-slate-800" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="font-medium text-rose-300">
            Erro ao carregar personagens
          </p>
          <p className="mt-1 max-w-md text-sm text-slate-500">{String(error)}</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-3 grid size-12 place-items-center rounded-full bg-slate-800 text-slate-500">
            <IconFichas className="size-6" />
          </div>
          <p className="font-medium text-slate-300">
            Nenhum personagem encontrado
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {busca || etiquetasFiltro.length > 0
              ? "Tente ajustar a busca ou as etiquetas."
              : "Crie o primeiro personagem para começar."}
          </p>
          {!busca && etiquetasFiltro.length === 0 && (
            <Link to="/fichas/novo" className={`${BOTAO_NOVO} mt-4`}>
              <IconMais className="size-4" />
              Novo personagem
            </Link>
          )}
        </div>
      ) : (
        <div className={GRID}>
          {filtrados.map((p) => (
            <CharacterCard key={p.id} p={p} cores={cores} />
          ))}
        </div>
      )}
    </div>
  );
}
