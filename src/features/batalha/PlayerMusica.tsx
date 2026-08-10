import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  atualizarFavorito,
  criarFavorito,
  discordAutoSeguir,
  discordEntrarVoz,
  discordListarCanaisVoz,
  discordMusicaPlay,
  discordSairVoz,
  excluirFavorito,
} from "../../lib/api";
import type { EventoMusica, Favorito, FavoritoInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { IconEditar, IconLixeira } from "../../components/icons";
import { agruparPorCategoria, descreverProxima, formatarTempo } from "./musica";
import { definirUltimaMusica, usePlayerMusica } from "./usePlayerMusica";
import AlbumFavoritos from "./AlbumFavoritos";

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_PRIMARIO = `${BTN} bg-indigo-500 text-white hover:bg-indigo-400`;
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800`;
const BTN_MINI =
  "inline-flex h-7 items-center justify-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none";
const BTN_MINI_PRIMARIO =
  "inline-flex h-7 items-center justify-center rounded-md bg-indigo-500 px-2 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-40 disabled:pointer-events-none";
const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-40";
const OPTION = "bg-slate-900 text-slate-100";
const ROTULO = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";
const INPUT =
  "h-10 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500/50 disabled:opacity-40";

/** Nick padrão que o auto-seguir persegue no Discord. */
const NICK_PADRAO = "gedasiosaga";
/** Fatores de velocidade oferecidos na UI. */
const VELOCIDADES = [0.5, 1, 1.5, 2] as const;

/** Preferência do auto-seguir: a caixa "Bot me segue" + o nick perseguido. */
interface PrefAutoSeguir {
  ativo: boolean;
  nick: string;
}

/**
 * Preferência do auto-seguir guardada FORA do React (escopo do módulo).
 *
 * Por que não `useState`: o `PlayerMusica` é montado em dois lugares (aba
 * Combate e aba Discord) e o `Tabs` desmonta a aba inativa — com estado local
 * a caixa voltava pro padrão a cada troca de aba enquanto o sidecar seguia com
 * o valor antigo, exatamente a divergência que fazia o bot entrar na call
 * "sozinho". Aqui o valor é único, sobrevive à desmontagem, e o
 * `useSyncExternalStore` mantém quem está montado em sincronia.
 */
let prefAutoSeguir: PrefAutoSeguir = { ativo: false, nick: NICK_PADRAO };
const ouvintesAutoSeguir = new Set<() => void>();

function lerPrefAutoSeguir(): PrefAutoSeguir {
  return prefAutoSeguir;
}

function assinarAutoSeguir(ouvinte: () => void): () => void {
  ouvintesAutoSeguir.add(ouvinte);
  return () => {
    ouvintesAutoSeguir.delete(ouvinte);
  };
}

function notificarAutoSeguir(): void {
  for (const ouvinte of ouvintesAutoSeguir) ouvinte();
}

/** Guarda o nick enquanto o usuário digita; o sidecar só ouve no blur. */
function editarNickAutoSeguir(nick: string): void {
  prefAutoSeguir = { ...prefAutoSeguir, nick };
  notificarAutoSeguir();
}

/** Grava a preferência e empurra pro sidecar — os dois lados sempre juntos. */
function definirAutoSeguir(pref: PrefAutoSeguir): void {
  prefAutoSeguir = pref;
  notificarAutoSeguir();
  empurrarAutoSeguir();
}

/**
 * Manda a preferência atual pro sidecar. O sidecar nasce com o auto-seguir
 * DESLIGADO e não guarda nada entre execuções, então esta tela é a única fonte
 * da verdade: empurra ao montar, a cada (re)conexão do bot e a cada mudança.
 *
 * Erro é engolido de propósito: a falha esperada é "sidecar não iniciado"
 * (player montado na aba Combate sem ninguém ter conectado o Discord ainda), e
 * aí não há divergência pra corrigir — um sidecar novo nasce desligado. Toast
 * aqui só faria barulho em cima de uma falha inofensiva.
 */
function empurrarAutoSeguir(): void {
  const { ativo, nick } = prefAutoSeguir;
  discordAutoSeguir(ativo, nick.trim() || NICK_PADRAO).catch(() => {});
}

/** Rascunho do formulário de favorito. `id` null = criando; número = editando. */
interface FavForm {
  id: number | null;
  nome: string;
  url: string;
  categoria: string;
}

/**
 * Player de música do Discord — reutilizável no cockpit (aba Combate) e na aba Discord.
 * Controla voz (entrar/sair), tocar por URL, faixa (pular/parar/loop) e os controles
 * avançados (Fase 2): barra de progresso + seek, velocidade, loop A-B, CRUD de favoritos
 * (SQLite v2) e auto-seguir. O áudio toca no Discord (não no browser), então trocar de
 * aba não interrompe a reprodução. O estado da faixa vem do evento `discord:evento`
 * (`tipo === "musica"`, um objeto `EventoMusica`); os demais eventos continuam string.
 */
export default function PlayerMusica() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: canaisVoz, isLoading: carregandoCanaisVoz } = useQuery({
    queryKey: ["discord", "canaisVoz"],
    queryFn: discordListarCanaisVoz,
  });
  // Núcleo do player (estado de "tocando agora", transporte, favoritos) —
  // compartilhado com o mini-player e a janela flutuante. Ver `usePlayerMusica.ts`.
  const {
    emVoz,
    estadoMusica,
    titulo,
    posicao,
    duracao,
    velocidade,
    loopFaixa,
    ab,
    fila,
    temDuracao,
    barraMax,
    valorBarra,
    aoArrastarSeek,
    finalizarSeek,
    skipMut,
    stopMut,
    loopMut,
    velocidadeMut,
    abDefinirMut,
    abToggleMut,
    tocarAgoraMut,
    enfileirarMut,
    favoritos,
    carregandoFavoritos,
  } = usePlayerMusica();

  const [canalVozId, setCanalVozId] = useState("");
  const [url, setUrl] = useState("");

  // Auto-seguir não viaja no evento do sidecar: quem manda é a preferência do
  // módulo (ver `prefAutoSeguir`), compartilhada pelas duas montagens do player.
  const { ativo: autoSeguir, nick } = useSyncExternalStore(assinarAutoSeguir, lerPrefAutoSeguir);

  // Última URL tocada (Tocar ou clique num favorito) — alimenta o "salvar tocando agora".
  const [ultimaUrl, setUltimaUrl] = useState<string | null>(null);
  const [favForm, setFavForm] = useState<FavForm | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<string | null>(null);
  const [albumAberto, setAlbumAberto] = useState(false);

  // Listener só do evento "conectado": o bot (re)conectou (o sidecar pode ser
  // um processo novo, com auto-seguir desligado), então reafirmamos a
  // preferência desta tela. O evento `musica` (faixa/voz) é escutado pelo
  // `usePlayerMusica` acima — dois listeners no mesmo `discord:evento`,
  // cada um só reage ao que lhe interessa.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    listen<string | EventoMusica>("discord:evento", (evento) => {
      if (evento.payload === "conectado") empurrarAutoSeguir();
    }).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, []);

  // Sincroniza o sidecar com a caixa "Bot me segue" logo na montagem — inclui o
  // caso mais comum: o player da aba Discord monta só depois do `conectar`, ou
  // seja, depois do evento "conectado" que o listener acima escuta.
  useEffect(() => {
    empurrarAutoSeguir();
  }, []);

  const entrarVozMut = useMutation({
    mutationFn: (id: string) => discordEntrarVoz(id),
    // Sem atualização otimista aqui: o sidecar emite o evento `musica` (com
    // `em_voz: true`) antes de responder ao comando `entrar_voz` — quando esta
    // promise resolve, o evento já chegou ou está a caminho.
    onError: (e) => toast.erro(String(e)),
  });
  const sairVozMut = useMutation({
    mutationFn: discordSairVoz,
    onSuccess: () => definirUltimaMusica(null),
    onError: (e) => toast.erro(String(e)),
  });
  const tocarMut = useMutation({
    mutationFn: (u: string) => discordMusicaPlay(u),
    onSuccess: (_data, u) => {
      setUltimaUrl(u);
      setUrl("");
    },
    onError: (e) => toast.erro(String(e)),
  });
  const invalidarFavoritos = () => qc.invalidateQueries({ queryKey: ["favoritos"] });
  const criarFavMut = useMutation({
    mutationFn: (input: FavoritoInput) => criarFavorito(input),
    onSuccess: () => {
      invalidarFavoritos();
      setFavForm(null);
      toast.sucesso("Favorito salvo.");
    },
    onError: (e) => toast.erro(String(e)),
  });
  const atualizarFavMut = useMutation({
    mutationFn: (v: { id: number; input: FavoritoInput }) => atualizarFavorito(v.id, v.input),
    onSuccess: () => {
      invalidarFavoritos();
      setFavForm(null);
      toast.sucesso("Favorito atualizado.");
    },
    onError: (e) => toast.erro(String(e)),
  });
  const excluirFavMut = useMutation({
    mutationFn: (id: number) => excluirFavorito(id),
    onSuccess: () => {
      invalidarFavoritos();
      toast.sucesso("Favorito excluído.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const salvandoFav = criarFavMut.isPending || atualizarFavMut.isPending;
  const gruposFavoritos = agruparPorCategoria(favoritos ?? []);
  const categoriasFavoritos = gruposFavoritos.map(([categoria]) => categoria);
  const gruposExibidos = filtroCategoria
    ? gruposFavoritos.filter(([categoria]) => categoria === filtroCategoria)
    : gruposFavoritos;
  const tocarAgoraDesabilitado = !emVoz || tocarAgoraMut.isPending;
  const enfileirarDesabilitado = !emVoz || enfileirarMut.isPending;

  function alternarAutoSeguir(ativo: boolean) {
    definirAutoSeguir({ ativo, nick });
  }

  function aplicarNick() {
    if (autoSeguir) definirAutoSeguir({ ativo: true, nick });
  }

  function editarFavorito(fav: Favorito) {
    setFavForm({ id: fav.id, nome: fav.nome, url: fav.url, categoria: fav.categoria ?? "" });
  }

  function salvarTocandoAgora() {
    setFavForm({ id: null, nome: titulo ?? "", url: ultimaUrl ?? "", categoria: "" });
  }

  function submeterFavorito() {
    if (!favForm) return;
    const input: FavoritoInput = {
      nome: favForm.nome.trim(),
      url: favForm.url.trim(),
      categoria: favForm.categoria.trim() || null,
    };
    if (!input.nome || !input.url) {
      toast.erro("Nome e URL são obrigatórios.");
      return;
    }
    if (favForm.id === null) criarFavMut.mutate(input);
    else atualizarFavMut.mutate({ id: favForm.id, input });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Música</h2>

      {/* ---------- Voz ---------- */}
      <label className="block">
        <span className={ROTULO}>Canal de voz</span>
        <select
          value={canalVozId}
          onChange={(e) => setCanalVozId(e.target.value)}
          disabled={carregandoCanaisVoz}
          className={SELECT}
        >
          <option value="" className={OPTION}>
            {carregandoCanaisVoz ? "carregando…" : "selecione um canal de voz"}
          </option>
          {(canaisVoz ?? []).map((c) => (
            <option key={c.id} value={c.id} className={OPTION}>
              {c.guild} — {c.nome}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN_PRIMARIO}
          disabled={!canalVozId || entrarVozMut.isPending}
          onClick={() => entrarVozMut.mutate(canalVozId)}
        >
          {entrarVozMut.isPending ? "Entrando…" : "Entrar"}
        </button>
        <button
          type="button"
          className={BTN_NEUTRO}
          disabled={!emVoz || sairVozMut.isPending}
          onClick={() => sairVozMut.mutate()}
        >
          {sairVozMut.isPending ? "Saindo…" : "Sair"}
        </button>
        {emVoz && <span className="text-xs text-emerald-400">conectado à voz</span>}
      </div>

      {/* ---------- Auto-seguir ---------- */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={autoSeguir}
            onChange={(e) => alternarAutoSeguir(e.target.checked)}
            className="size-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
          />
          Bot me segue
        </label>
        <label className="flex-1">
          <span className={ROTULO}>Nick</span>
          <input
            type="text"
            value={nick}
            onChange={(e) => editarNickAutoSeguir(e.target.value)}
            onBlur={aplicarNick}
            placeholder={NICK_PADRAO}
            className={INPUT}
          />
        </label>
      </div>

      {/* ---------- Now playing + barra/seek ---------- */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm text-slate-300">
            {titulo ?? <span className="text-slate-600">nada tocando</span>}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-slate-500">
            {estadoMusica === "pausado" ? "pausado" : estadoMusica === "tocando" ? "tocando" : "—"}
          </span>
        </div>
        <p className="text-xs text-slate-400">Próxima: {descreverProxima(fila, loopFaixa)}</p>
        <input
          type="range"
          min={0}
          max={barraMax}
          step={1}
          value={valorBarra}
          disabled={!emVoz || !temDuracao}
          aria-label="Posição da faixa"
          onChange={(e) => aoArrastarSeek(Number(e.currentTarget.value))}
          onPointerUp={(e) => finalizarSeek(Number(e.currentTarget.value))}
          onKeyUp={(e) => finalizarSeek(Number(e.currentTarget.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="flex justify-between text-xs tabular-nums text-slate-500">
          <span>{formatarTempo(valorBarra)}</span>
          <span>{temDuracao && duracao != null ? formatarTempo(duracao) : "--:--"}</span>
        </div>
      </div>

      {/* ---------- Tocar por URL ---------- */}
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL (YouTube, Spotify, etc.)"
          disabled={!emVoz}
          className={INPUT}
        />
        <button
          type="button"
          className={BTN_PRIMARIO}
          disabled={!emVoz || !url.trim() || tocarMut.isPending}
          onClick={() => tocarMut.mutate(url.trim())}
        >
          {tocarMut.isPending ? "Tocando…" : "Tocar"}
        </button>
      </div>

      {/* ---------- Faixa: pular/parar/loop ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN_NEUTRO}
          disabled={!emVoz || skipMut.isPending}
          onClick={() => skipMut.mutate()}
        >
          {skipMut.isPending ? "Pulando…" : "Pular"}
        </button>
        <button
          type="button"
          className={BTN_NEUTRO}
          disabled={!emVoz || stopMut.isPending}
          onClick={() => stopMut.mutate()}
        >
          {stopMut.isPending ? "Parando…" : "Parar"}
        </button>
        <button
          type="button"
          className={loopFaixa ? BTN_PRIMARIO : BTN_NEUTRO}
          disabled={!emVoz || loopMut.isPending}
          onClick={() => loopMut.mutate()}
        >
          {loopFaixa ? "Loop (ligado)" : "Loop"}
        </button>
      </div>

      {/* ---------- Velocidade ---------- */}
      <div>
        <span className={ROTULO}>Velocidade</span>
        <div className="flex flex-wrap gap-2">
          {VELOCIDADES.map((f) => (
            <button
              key={f}
              type="button"
              className={Math.abs(velocidade - f) < 0.01 ? BTN_PRIMARIO : BTN_NEUTRO}
              disabled={!emVoz || velocidadeMut.isPending}
              onClick={() => velocidadeMut.mutate(f)}
            >
              {f}x
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Loop A-B ---------- */}
      <div>
        <span className={ROTULO}>Loop A-B</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BTN_NEUTRO}
            disabled={!emVoz || !temDuracao || abDefinirMut.isPending}
            onClick={() => abDefinirMut.mutate({ a: Math.floor(posicao), b: ab.b })}
          >
            Marcar A
          </button>
          <button
            type="button"
            className={BTN_NEUTRO}
            disabled={!emVoz || !temDuracao || abDefinirMut.isPending}
            onClick={() => abDefinirMut.mutate({ a: ab.a, b: Math.floor(posicao) })}
          >
            Marcar B
          </button>
          <button
            type="button"
            className={ab.ativo ? BTN_PRIMARIO : BTN_NEUTRO}
            disabled={!emVoz || ab.a == null || ab.b == null || abToggleMut.isPending}
            onClick={() => abToggleMut.mutate(!ab.ativo)}
          >
            {ab.ativo ? "A-B (ligado)" : "A-B"}
          </button>
          <button
            type="button"
            className={BTN_MINI}
            disabled={!emVoz || (ab.a == null && ab.b == null) || abDefinirMut.isPending}
            onClick={() => abDefinirMut.mutate({ a: null, b: null })}
          >
            Limpar
          </button>
          <span className="text-xs tabular-nums text-slate-500">
            A {ab.a != null ? formatarTempo(ab.a) : "—"} · B {ab.b != null ? formatarTempo(ab.b) : "—"}
          </span>
        </div>
      </div>

      {/* ---------- Favoritos (v2) ---------- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`${ROTULO} mb-0`}>Favoritos</span>
          <div className="flex gap-2">
            <button type="button" className={BTN_MINI} onClick={() => setFavForm({ id: null, nome: "", url: "", categoria: "" })}>
              Novo
            </button>
            <button
              type="button"
              className={BTN_MINI}
              disabled={!ultimaUrl}
              onClick={salvarTocandoAgora}
            >
              Salvar agora
            </button>
            {favoritos && favoritos.length > 0 && (
              <button
                type="button"
                className={BTN_MINI}
                aria-label="Abrir álbum de favoritos"
                onClick={() => setAlbumAberto(true)}
              >
                Expandir
              </button>
            )}
          </div>
        </div>

        {favForm && (
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {favForm.id === null ? "Novo favorito" : "Editar favorito"}
            </p>
            <input
              type="text"
              value={favForm.nome}
              onChange={(e) => setFavForm((f) => (f ? { ...f, nome: e.target.value } : f))}
              placeholder="Nome"
              className={INPUT}
            />
            <input
              type="text"
              value={favForm.url}
              onChange={(e) => setFavForm((f) => (f ? { ...f, url: e.target.value } : f))}
              placeholder="URL"
              className={INPUT}
            />
            <input
              type="text"
              value={favForm.categoria}
              onChange={(e) => setFavForm((f) => (f ? { ...f, categoria: e.target.value } : f))}
              placeholder="Categoria (opcional)"
              className={INPUT}
            />
            <div className="flex gap-2">
              <button type="button" className={BTN_PRIMARIO} disabled={salvandoFav} onClick={submeterFavorito}>
                {salvandoFav ? "Salvando…" : "Salvar"}
              </button>
              <button type="button" className={BTN_NEUTRO} onClick={() => setFavForm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {carregandoFavoritos && <p className="text-xs text-slate-500">carregando…</p>}
        {favoritos && favoritos.length === 0 && (
          <p className="text-xs text-slate-500">Nenhum favorito configurado.</p>
        )}
        {favoritos && favoritos.length > 0 && (
          <div className="space-y-2">
            <label className="block">
              <span className="sr-only">Filtrar favoritos por categoria</span>
              <select
                value={filtroCategoria ?? ""}
                onChange={(e) => setFiltroCategoria(e.target.value || null)}
                className={SELECT}
              >
                <option value="" className={OPTION}>
                  Todas as categorias
                </option>
                {categoriasFavoritos.map((categoria) => (
                  <option key={categoria} value={categoria} className={OPTION}>
                    {categoria}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
              {gruposExibidos.map(([categoria, itens]) => (
                <div key={categoria}>
                  {!filtroCategoria && (
                    <p className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      {categoria}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {itens.map((fav) => (
                      <LinhaFavorito
                        key={fav.id}
                        fav={fav}
                        tocarAgoraDesabilitado={tocarAgoraDesabilitado}
                        enfileirarDesabilitado={enfileirarDesabilitado}
                        excluirDesabilitado={excluirFavMut.isPending}
                        onTocarAgora={() => tocarAgoraMut.mutate(fav.url, { onSuccess: () => setUltimaUrl(fav.url) })}
                        onEnfileirar={() => enfileirarMut.mutate(fav.url)}
                        onEditar={() => editarFavorito(fav)}
                        onExcluir={() => excluirFavMut.mutate(fav.id)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {albumAberto && favoritos && (
        <AlbumFavoritos
          favoritos={favoritos}
          tocarAgoraDesabilitado={tocarAgoraDesabilitado}
          enfileirarDesabilitado={enfileirarDesabilitado}
          excluirDesabilitado={excluirFavMut.isPending}
          onTocarAgora={(fav) => tocarAgoraMut.mutate(fav.url, { onSuccess: () => setUltimaUrl(fav.url) })}
          onEnfileirar={(fav) => enfileirarMut.mutate(fav.url)}
          onEditar={(fav) => {
            // Fecha o álbum: o formulário de edição vive no painel, atrás do modal.
            editarFavorito(fav);
            setAlbumAberto(false);
          }}
          onExcluir={(fav) => excluirFavMut.mutate(fav.id)}
          onFechar={() => setAlbumAberto(false)}
        />
      )}
    </section>
  );
}

interface LinhaFavoritoProps {
  fav: Favorito;
  tocarAgoraDesabilitado: boolean;
  enfileirarDesabilitado: boolean;
  excluirDesabilitado: boolean;
  onTocarAgora: () => void;
  onEnfileirar: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}

/**
 * Linha compacta de um favorito no painel da Batalha: só nome e ações, uma por
 * linha. Sem miniatura de propósito — a capa aparece só no álbum expandido, pra
 * a lista não roubar altura do cockpit de combate. A categoria também não
 * aparece aqui: a lista já vem agrupada com o cabeçalho da categoria acima.
 */
function LinhaFavorito({
  fav,
  tocarAgoraDesabilitado,
  enfileirarDesabilitado,
  excluirDesabilitado,
  onTocarAgora,
  onEnfileirar,
  onEditar,
  onExcluir,
}: LinhaFavoritoProps) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-slate-900">
      <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={fav.url}>
        {fav.nome}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={BTN_MINI_PRIMARIO}
          disabled={tocarAgoraDesabilitado}
          onClick={onTocarAgora}
          aria-label={`Tocar ${fav.nome} agora`}
        >
          ▶
        </button>
        <button
          type="button"
          className={BTN_MINI}
          disabled={enfileirarDesabilitado}
          onClick={onEnfileirar}
          aria-label={`Adicionar ${fav.nome} à fila`}
        >
          + Fila
        </button>
        <span className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
        </span>
      </div>
    </li>
  );
}
