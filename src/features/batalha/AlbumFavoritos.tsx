import { useEffect, useState } from "react";
import type { Favorito } from "../../lib/types";
import { IconEditar, IconFechar, IconLixeira } from "../../components/icons";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import { agruparPorCategoria, filtrarPorTexto, SEM_CATEGORIA, thumbnailUrl } from "./musica";

const BTN_MINI =
  "inline-flex h-7 items-center justify-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none";
const BTN_MINI_PRIMARIO =
  "inline-flex h-7 items-center justify-center rounded-md bg-indigo-500 px-2 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-40 disabled:pointer-events-none";
const INPUT =
  "h-10 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500/50";
const PILULA =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 px-3 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200";
const PILULA_ATIVA =
  "inline-flex h-7 items-center gap-1.5 rounded-full bg-indigo-500 px-3 text-xs font-medium text-white transition-colors hover:bg-indigo-400";

/** Descreve quantas faixas aparecem na grade, considerando os filtros ativos. */
function descreverContagem(exibidas: number, total: number, categorias: number): string {
  if (exibidas === total) {
    return `${total} ${total === 1 ? "faixa" : "faixas"} em ${categorias} ${categorias === 1 ? "categoria" : "categorias"}`;
  }
  if (exibidas === 0) {
    return `Nenhuma faixa encontrada (de ${total})`;
  }
  return `${exibidas} de ${total} ${total === 1 ? "faixa" : "faixas"} em ${categorias} ${categorias === 1 ? "categoria" : "categorias"}`;
}

interface AlbumFavoritosProps {
  favoritos: Favorito[];
  tocarAgoraDesabilitado: boolean;
  enfileirarDesabilitado: boolean;
  excluirDesabilitado: boolean;
  onTocarAgora: (fav: Favorito) => void;
  onEnfileirar: (fav: Favorito) => void;
  onEditar: (fav: Favorito) => void;
  onExcluir: (fav: Favorito) => void;
  onFechar: () => void;
}

/**
 * Álbum de favoritos em tela cheia: todas as faixas com capa, separadas por
 * categoria. É a versão "expandida" — as miniaturas só aparecem aqui; o painel
 * da Batalha mostra só a lista compacta, pra não roubar espaço do combate.
 * Mesmo padrão de modal do detalhe de habilidade (overlay + Esc + clique fora).
 */
export default function AlbumFavoritos({
  favoritos,
  tocarAgoraDesabilitado,
  enfileirarDesabilitado,
  excluirDesabilitado,
  onTocarAgora,
  onEnfileirar,
  onEditar,
  onExcluir,
  onFechar,
}: AlbumFavoritosProps) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const [busca, setBusca] = useState("");
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string | null>(null);

  // Categorias e ordem vêm sempre da lista inteira, pra as pílulas não sumirem
  // ou reordenarem enquanto o usuário digita — só a contagem de cada uma muda.
  const grupos = agruparPorCategoria(favoritos);
  const favoritosBuscados = filtrarPorTexto(favoritos, busca);
  const contagemPorCategoria = new Map(
    agruparPorCategoria(favoritosBuscados).map(([categoria, itens]) => [categoria, itens.length]),
  );

  const favoritosFiltrados = categoriaSelecionada
    ? favoritosBuscados.filter((fav) => (fav.categoria ?? SEM_CATEGORIA) === categoriaSelecionada)
    : favoritosBuscados;
  const gruposExibidos = agruparPorCategoria(favoritosFiltrados);

  function limparFiltros() {
    setBusca("");
    setCategoriaSelecionada(null);
  }

  function alternarCategoria(categoria: string) {
    setCategoriaSelecionada((atual) => (atual === categoria ? null : categoria));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Álbum de favoritos"
        className="relative flex max-h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-100">Favoritos</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {descreverContagem(favoritosFiltrados.length, favoritos.length, gruposExibidos.length)}
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 hover:text-slate-200"
          >
            <IconFechar className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2.5 border-b border-slate-800 p-4">
          <label className="block">
            <span className="sr-only">Buscar favoritos por nome</span>
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome…"
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={categoriaSelecionada === null}
              className={categoriaSelecionada === null ? PILULA_ATIVA : PILULA}
              onClick={() => setCategoriaSelecionada(null)}
            >
              Todas
              <span className="opacity-70">{favoritosBuscados.length}</span>
            </button>
            {grupos.map(([categoria]) => (
              <button
                key={categoria}
                type="button"
                aria-pressed={categoriaSelecionada === categoria}
                className={categoriaSelecionada === categoria ? PILULA_ATIVA : PILULA}
                onClick={() => alternarCategoria(categoria)}
              >
                {categoria}
                <span className="opacity-70">{contagemPorCategoria.get(categoria) ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6 overflow-auto p-5">
          {gruposExibidos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-slate-500">Nenhuma faixa encontrada com esses filtros.</p>
              <button type="button" className={BTN_MINI} onClick={limparFiltros}>
                Limpar filtros
              </button>
            </div>
          ) : (
            gruposExibidos.map(([categoria, itens]) => (
              <section key={categoria}>
                {!categoriaSelecionada && (
                  <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {categoria}
                    <span className="ml-2 text-slate-600">{itens.length}</span>
                  </h3>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                  {itens.map((fav) => (
                    <CapaFavorito
                      key={fav.id}
                      fav={fav}
                      tocarAgoraDesabilitado={tocarAgoraDesabilitado}
                      enfileirarDesabilitado={enfileirarDesabilitado}
                      excluirDesabilitado={excluirDesabilitado}
                      onTocarAgora={() => onTocarAgora(fav)}
                      onEnfileirar={() => onEnfileirar(fav)}
                      onEditar={() => onEditar(fav)}
                      onExcluir={() => onExcluir(fav)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface CapaFavoritoProps {
  fav: Favorito;
  tocarAgoraDesabilitado: boolean;
  enfileirarDesabilitado: boolean;
  excluirDesabilitado: boolean;
  onTocarAgora: () => void;
  onEnfileirar: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}

/** Capa de um favorito no álbum: miniatura do YouTube (ou placeholder), nome e ações. */
function CapaFavorito({
  fav,
  tocarAgoraDesabilitado,
  enfileirarDesabilitado,
  excluirDesabilitado,
  onTocarAgora,
  onEnfileirar,
  onEditar,
  onExcluir,
}: CapaFavoritoProps) {
  const [thumbQuebrada, setThumbQuebrada] = useState(false);
  useEffect(() => setThumbQuebrada(false), [fav.url]);
  const thumb = thumbnailUrl(fav.url);

  return (
    <div className="group flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <button
        type="button"
        title={fav.url}
        disabled={tocarAgoraDesabilitado}
        onClick={onTocarAgora}
        aria-label={`Tocar ${fav.nome} agora`}
        className="aspect-video w-full overflow-hidden rounded-md border border-slate-800 bg-slate-800 disabled:opacity-40"
      >
        {thumb && !thumbQuebrada ? (
          <img
            src={thumb}
            alt=""
            className="size-full object-cover"
            onError={() => setThumbQuebrada(true)}
          />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={{ backgroundImage: gradienteDoNome(fav.nome) }}
          >
            <span className="text-sm font-bold text-white/90">{iniciais(fav.nome)}</span>
          </div>
        )}
      </button>

      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 truncate text-sm text-slate-200" title={fav.nome}>
          {fav.nome}
        </p>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${fav.nome}`}
            className="rounded-md p-1 text-slate-500 hover:text-slate-200"
          >
            <IconEditar className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onExcluir}
            disabled={excluirDesabilitado}
            aria-label={`Excluir ${fav.nome}`}
            className="rounded-md p-1 text-slate-500 hover:text-rose-300 disabled:opacity-40"
          >
            <IconLixeira className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          className={`${BTN_MINI_PRIMARIO} flex-1`}
          disabled={tocarAgoraDesabilitado}
          onClick={onTocarAgora}
        >
          ▶ Agora
        </button>
        <button
          type="button"
          className={`${BTN_MINI} flex-1`}
          disabled={enfileirarDesabilitado}
          onClick={onEnfileirar}
        >
          + Fila
        </button>
      </div>
    </div>
  );
}
