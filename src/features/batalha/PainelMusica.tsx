// Painel de música completo e reusável — três variantes (`coluna`,
// `flutuante`, `cheia`) do MESMO conteúdo: tocando agora, transporte, voz,
// biblioteca de favoritos (busca + categorias colapsáveis) e um bloco
// avançado (velocidade, loop A-B, auto-seguir, URL avulsa).
//
// Substitui a divisão antiga entre `MiniPlayerMusica` (compacto, só 6
// favoritos em pílulas) e o `<details>` "Controles avançados" dentro do
// `PlayerMusica` (só na aba Discord) — aqui a biblioteca INTEIRA sempre
// aparece, o que faltava na janela destacada (`JanelaMusicaFlutuante` passava
// `mostrarExtras={false}`, então a versão expandida nunca mostrava nada).
//
// O núcleo de "tocando agora" vem do `usePlayerMusica()` (store de módulo —
// várias instâncias deste painel montadas ao mesmo tempo continuam
// coerentes, ver `usePlayerMusica.ts`). Canal de voz, CRUD de favoritos e
// "tocar por URL" são próprios deste componente, como já era no
// `PlayerMusica.tsx` original. Auto-seguir usa o store próprio em
// `autoSeguirMusica.ts` (mesmo motivo: sobreviver à desmontagem de aba).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  atualizarFavorito,
  criarFavorito,
  discordEntrarVoz,
  discordListarCanaisVoz,
  discordMusicaPlay,
  discordSairVoz,
  excluirFavorito,
} from "../../lib/api";
import type { CanalVoz, EventoMusica, Favorito, FavoritoInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { IconEditar, IconLixeira } from "../../components/icons";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import {
  agruparPorCategoria,
  descreverEstadoReproducao,
  descreverProxima,
  filtrarPorTexto,
  formatarTempo,
  thumbnailUrl,
} from "./musica";
import { definirUltimaUrl, usePlayerMusica } from "./usePlayerMusica";
import AlbumFavoritos from "./AlbumFavoritos";
import { abrirJanelaPlayer } from "./janelaPlayerNativa";
import { alternarModoMusica } from "./modoMusica";
import {
  definirAutoSeguir,
  editarNickAutoSeguir,
  empurrarAutoSeguir,
  NICK_PADRAO_AUTO_SEGUIR,
  useAutoSeguirMusica,
} from "./autoSeguirMusica";

export type VarianteMusica = "coluna" | "flutuante" | "cheia" | "janela";

interface Props {
  /** Densidade/layout do painel; o conteúdo (biblioteca inclusa) é sempre o mesmo. Default "coluna". */
  variante?: VarianteMusica;
}

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_PRIMARIO = `${BTN} bg-indigo-500 text-white hover:bg-indigo-400`;
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800`;
const BTN_MINI =
  "inline-flex h-7 items-center justify-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none";
const BTN_MINI_PRIMARIO =
  "inline-flex h-7 items-center justify-center rounded-md bg-indigo-500 px-2 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-40 disabled:pointer-events-none";
const BTN_TRANSPORTE =
  "grid size-9 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950/50 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none";
/**
 * Estado LIGADO do transporte (hoje só o loop). Verde preenchido, e não indigo:
 * indigo é a cor de ação do app inteiro (botões primários), então um "ativo"
 * indigo se confundia com "botão comum" — a diferença tem que ser de cor, não só
 * de opacidade.
 */
const BTN_TRANSPORTE_ON = `${BTN_TRANSPORTE} border-emerald-400 bg-emerald-500 text-white shadow-[0_0_10px_-2px] shadow-emerald-500/70 hover:border-emerald-300 hover:text-white`;
const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-40";
const OPTION = "bg-slate-900 text-slate-100";
const ROTULO = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";
const INPUT =
  "h-10 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500/50 disabled:opacity-40";

/** Fatores de velocidade oferecidos na UI (engine não suporta outros valores). */
const VELOCIDADES = [0.5, 1, 1.5, 2] as const;

type PlayerMusica = ReturnType<typeof usePlayerMusica>;
type Toast = ReturnType<typeof useToast>;

/** Rascunho do formulário de favorito. `id` null = criando; número = editando. */
interface FavForm {
  id: number | null;
  nome: string;
  url: string;
  categoria: string;
}

/** Mutations de voz (entrar/sair) — extraídas do corpo principal só pra reduzir seu tamanho. */
function useMutacoesVoz(toast: Toast, onSairVoz: () => void) {
  const entrarVozMut = useMutation({
    mutationFn: (id: string) => discordEntrarVoz(id),
    onError: (e) => toast.erro(String(e)),
  });
  const sairVozMut = useMutation({
    mutationFn: discordSairVoz,
    onSuccess: onSairVoz,
    onError: (e) => toast.erro(String(e)),
  });
  return { entrarVozMut, sairVozMut };
}

/** CRUD de favoritos — extraído do corpo principal só pra reduzir seu tamanho. */
function useMutacoesFavoritos(toast: Toast, qc: QueryClient, onSalvo: () => void) {
  const invalidar = () => qc.invalidateQueries({ queryKey: ["favoritos"] });
  const criarFavMut = useMutation({
    mutationFn: (input: FavoritoInput) => criarFavorito(input),
    onSuccess: () => {
      invalidar();
      onSalvo();
      toast.sucesso("Favorito salvo.");
    },
    onError: (e) => toast.erro(String(e)),
  });
  const atualizarFavMut = useMutation({
    mutationFn: (v: { id: number; input: FavoritoInput }) => atualizarFavorito(v.id, v.input),
    onSuccess: () => {
      invalidar();
      onSalvo();
      toast.sucesso("Favorito atualizado.");
    },
    onError: (e) => toast.erro(String(e)),
  });
  const excluirFavMut = useMutation({
    mutationFn: (id: number) => excluirFavorito(id),
    onSuccess: () => {
      invalidar();
      toast.sucesso("Favorito excluído.");
    },
    onError: (e) => toast.erro(String(e)),
  });
  return { criarFavMut, atualizarFavMut, excluirFavMut };
}

/** Reafirma a preferência de auto-seguir a cada (re)conexão do bot — o sidecar pode nascer de novo (auto-seguir desligado por padrão). */
function useReconexaoAutoSeguir() {
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

  // Sincroniza logo na montagem — cobre o caso do painel montar depois do `conectar`.
  useEffect(() => {
    empurrarAutoSeguir();
  }, []);
}

export default function PainelMusica({ variante = "coluna" }: Props) {
  const toast = useToast();
  const qc = useQueryClient();
  const player = usePlayerMusica();
  const { emVoz, titulo, tocarAgoraMut, enfileirarMut, favoritos, carregandoFavoritos, capaUrl } =
    player;

  const { data: canaisVoz, isLoading: carregandoCanaisVoz } = useQuery({
    queryKey: ["discord", "canaisVoz"],
    queryFn: discordListarCanaisVoz,
  });

  const [canalVozId, setCanalVozId] = useState("");
  const [url, setUrl] = useState("");
  const [favForm, setFavForm] = useState<FavForm | null>(null);
  const [albumAberto, setAlbumAberto] = useState(false);

  const { ativo: autoSeguir, nick } = useAutoSeguirMusica();
  useReconexaoAutoSeguir();

  const { entrarVozMut, sairVozMut } = useMutacoesVoz(toast, () => definirUltimaUrl(null));
  const { criarFavMut, atualizarFavMut, excluirFavMut } = useMutacoesFavoritos(toast, qc, () => setFavForm(null));
  const tocarUrlMut = useMutation({
    mutationFn: (u: string) => discordMusicaPlay(u),
    onSuccess: (_data, u) => {
      definirUltimaUrl(u);
      setUrl("");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const salvandoFav = criarFavMut.isPending || atualizarFavMut.isPending;
  const tocarAgoraDesabilitado = !emVoz || tocarAgoraMut.isPending;
  const enfileirarDesabilitado = !emVoz || enfileirarMut.isPending;

  function tocarFavoritoAgora(fav: Favorito) {
    tocarAgoraMut.mutate(fav.url, { onSuccess: () => definirUltimaUrl(fav.url) });
  }

  /**
   * Favoritar a faixa que está no ar sem redigitar nada — o atalho de 1 clique
   * que existia no player antigo. Só faz sentido com título E url conhecidos
   * (a url vem da última faixa mandada a tocar, não do evento do sidecar).
   */
  function salvarFaixaAtual() {
    if (!titulo || !player.ultimaUrlTocada) return;
    setFavForm({ id: null, nome: titulo, url: player.ultimaUrlTocada, categoria: "" });
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

  function alternarAutoSeguir(ativo: boolean) {
    definirAutoSeguir({ ativo, nick });
  }

  function aplicarNickAutoSeguir() {
    if (autoSeguir) definirAutoSeguir({ ativo: true, nick });
  }

  const podeSalvarAtual = Boolean(titulo && player.ultimaUrlTocada);

  // Cabeçalho só onde o painel está DOCADO dentro do app: na janela própria,
  // "abrir em janela" e "modo música" não fazem sentido (ela JÁ é a janela, e o
  // modo música é do cockpit).
  const cabecalho = variante === "flutuante" || variante === "janela" ? null : (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Música</h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => abrirJanelaPlayer((motivo) => toast.erro(`Não abriu a janela do player: ${motivo}`))}
          aria-label="Abrir o player numa janela separada, sempre no topo"
          title="Abrir em janela separada"
          className="rounded-md px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          ⤢
        </button>
        <button
          type="button"
          onClick={alternarModoMusica}
          aria-label="Alternar o modo música (Ctrl+M)"
          title="Modo música · Ctrl+M"
          className="rounded-md px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          ⛶
        </button>
      </div>
    </div>
  );

  const conteudoPrincipal = (
    <>
      {cabecalho}
      <TocandoAgora player={player} capaUrl={capaUrl} />
      <Transporte player={player} />
      <SecaoVoz
        emVoz={emVoz}
        canaisVoz={canaisVoz}
        carregandoCanaisVoz={carregandoCanaisVoz}
        canalVozId={canalVozId}
        onCanalVozIdChange={setCanalVozId}
        onEntrar={() => entrarVozMut.mutate(canalVozId)}
        onSair={() => sairVozMut.mutate()}
        entrando={entrarVozMut.isPending}
        saindo={sairVozMut.isPending}
      />
      <SecaoAvancada
        player={player}
        autoSeguir={autoSeguir}
        nick={nick}
        onAlternarAutoSeguir={alternarAutoSeguir}
        onEditarNick={editarNickAutoSeguir}
        onAplicarNick={aplicarNickAutoSeguir}
        url={url}
        onUrlChange={setUrl}
        onTocarUrl={() => tocarUrlMut.mutate(url.trim())}
        tocandoUrl={tocarUrlMut.isPending}
      />
    </>
  );

  const conteudoBiblioteca = (
    <>
      {favForm && (
        <FormFavorito
          favForm={favForm}
          salvando={salvandoFav}
          onChange={setFavForm}
          onSubmeter={submeterFavorito}
          onCancelar={() => setFavForm(null)}
        />
      )}
      <BibliotecaFavoritos
        favoritos={favoritos}
        carregando={carregandoFavoritos}
        classeLista={CLASSE_LISTA_POR_VARIANTE[variante]}
        colunas={variante === "cheia"}
        tocarAgoraDesabilitado={tocarAgoraDesabilitado}
        enfileirarDesabilitado={enfileirarDesabilitado}
        excluirDesabilitado={excluirFavMut.isPending}
        onNovo={() => setFavForm({ id: null, nome: "", url: "", categoria: "" })}
        onSalvarAtual={salvarFaixaAtual}
        podeSalvarAtual={podeSalvarAtual}
        onAbrirAlbum={() => setAlbumAberto(true)}
        onTocarAgora={tocarFavoritoAgora}
        onEnfileirar={(fav) => enfileirarMut.mutate(fav.url)}
        onEditar={(fav) => setFavForm({ id: fav.id, nome: fav.nome, url: fav.url, categoria: fav.categoria ?? "" })}
        onExcluir={(fav) => excluirFavMut.mutate(fav.id)}
      />
    </>
  );

  // Álbum em tela cheia (capas grandes + pílulas de categoria): é um overlay
  // `fixed`, então sai por cima de qualquer variante — inclusive da janela
  // flutuante, que é estreita demais pra mostrar capa.
  const modalAlbum =
    albumAberto && favoritos ? (
      <AlbumFavoritos
        favoritos={favoritos}
        tocarAgoraDesabilitado={tocarAgoraDesabilitado}
        enfileirarDesabilitado={enfileirarDesabilitado}
        excluirDesabilitado={excluirFavMut.isPending}
        onTocarAgora={tocarFavoritoAgora}
        onEnfileirar={(fav) => enfileirarMut.mutate(fav.url)}
        onEditar={(fav) => {
          // O formulário vive no painel, atrás do overlay — fecha o álbum senão
          // o usuário edita às cegas.
          setAlbumAberto(false);
          setFavForm({ id: fav.id, nome: fav.nome, url: fav.url, categoria: fav.categoria ?? "" });
        }}
        onExcluir={(fav) => excluirFavMut.mutate(fav.id)}
        onFechar={() => setAlbumAberto(false)}
      />
    ) : null;

  if (variante === "flutuante") {
    return (
      <div className="flex flex-col gap-2.5">
        {conteudoPrincipal}
        <div className="flex min-h-0 flex-1 flex-col gap-2">{conteudoBiblioteca}</div>
        {modalAlbum}
      </div>
    );
  }

  if (variante === "janela") {
    // Sem card/borda: a moldura é a própria janela do sistema. `h-full` funciona
    // aqui (diferente da coluna) porque o pai é a janela, com altura definida.
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {conteudoPrincipal}
        <div className="flex min-h-0 flex-1 flex-col gap-2">{conteudoBiblioteca}</div>
        {modalAlbum}
      </div>
    );
  }

  if (variante === "cheia") {
    return (
      <section className="grid gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">{conteudoPrincipal}</div>
        <div className="flex min-h-0 flex-col gap-2">{conteudoBiblioteca}</div>
        {modalAlbum}
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      {conteudoPrincipal}
      <div className="flex min-h-0 flex-1 flex-col gap-2">{conteudoBiblioteca}</div>
      {modalAlbum}
    </section>
  );
}

/**
 * Classe da lista rolável de favoritos por variante — só a densidade muda, nunca
 * o conteúdo. Na `coluna`, `flex-1 min-h-0` (em vez de um teto em `px`) porque a
 * `BatalhaScreen` tira essa coluna do fluxo com `absolute inset-0`: ela passa a
 * ter a altura da FICHA ao lado, e a lista ocupa o que sobra rolando por dentro
 * — é o que faz o painel acompanhar o centro em vez de esticar a tela.
 */
const CLASSE_LISTA_POR_VARIANTE: Record<VarianteMusica, string> = {
  coluna: "flex-1 min-h-0 overflow-y-auto",
  flutuante: "max-h-56 overflow-y-auto",
  cheia: "max-h-[65vh] overflow-y-auto",
  // Janela própria: a lista é o corpo da janela, então acompanha a altura dela.
  janela: "flex-1 min-h-0 overflow-y-auto",
};

interface TocandoAgoraProps {
  player: PlayerMusica;
  capaUrl: string | null;
}

/** Capa/thumbnail + título + estado + barra de seek da faixa atual. */
function TocandoAgora({ player, capaUrl }: TocandoAgoraProps) {
  const { emVoz, estadoMusica, titulo, duracao, temDuracao, barraMax, valorBarra, aoArrastarSeek, finalizarSeek, fila, loopFaixa } =
    player;
  const [capaQuebrada, setCapaQuebrada] = useState(false);
  useEffect(() => setCapaQuebrada(false), [capaUrl]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="size-14 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-800">
          {capaUrl && !capaQuebrada ? (
            <img src={capaUrl} alt="" className="size-full object-cover" onError={() => setCapaQuebrada(true)} />
          ) : (
            <div
              className="flex size-full items-center justify-center"
              style={{ backgroundImage: gradienteDoNome(titulo ?? "?") }}
            >
              <span className="text-xs font-bold text-white/90">{titulo ? iniciais(titulo) : "♪"}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">
            {titulo ?? <span className="text-slate-600">nada tocando</span>}
          </p>
          <p className="text-xs text-slate-500">{descreverEstadoReproducao(emVoz, estadoMusica)}</p>
          <p className="truncate text-xs text-slate-600">Próxima: {descreverProxima(fila, loopFaixa)}</p>
        </div>
      </div>
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
  );
}

/**
 * Barras do equalizador. Duração e atraso DIFERENTES por barra de propósito: com
 * o mesmo tempo elas sobem e descem juntas e viram um bloco pulsando, que lê
 * como "carregando". Períodos que não batem entre si nunca repetem o mesmo
 * desenho, e é isso que dá a sensação de som.
 */
const BARRAS_EQUALIZADOR = [
  { altura: 55, duracaoMs: 780, atrasoMs: 0 },
  { altura: 100, duracaoMs: 1120, atrasoMs: 170 },
  { altura: 70, duracaoMs: 900, atrasoMs: 340 },
  { altura: 88, duracaoMs: 1030, atrasoMs: 80 },
];

/**
 * Indicador de que há som saindo. Anima `scaleY` (transform: GPU, sem reflow) e
 * não `height`, que recalcularia layout 60×/s. `transform-origin: bottom` é o
 * detalhe que faz parecer equalizador: sem ele a barra encolhe pelos dois lados
 * a partir do centro e fica boiando no ar em vez de crescer do chão.
 */
function EqualizadorTocando() {
  return (
    <div className="flex h-[18px] items-end gap-[2px]">
      {BARRAS_EQUALIZADOR.map(({ altura, duracaoMs, atrasoMs }, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-indigo-400"
          style={{
            height: `${altura}%`,
            transformOrigin: "bottom",
            animation: `eq-anim ${duracaoMs}ms ease-in-out infinite`,
            animationDelay: `${atrasoMs}ms`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Pular/parar/loop + indicador visual do estado (equalizer animado tocando, ícone parado/pausado).
 * Não há play/pause: a engine (sidecar) não expõe um comando de pausar — só tocar/pular/parar.
 */
function Transporte({ player }: { player: PlayerMusica }) {
  const { emVoz, estadoMusica, skipMut, stopMut, loopMut, loopFaixa } = player;
  const tocando = estadoMusica === "tocando";

  return (
    <div className="flex items-center gap-2">
      <div className="grid size-9 shrink-0 place-items-center" aria-hidden="true">
        {tocando ? <EqualizadorTocando /> : (
          <span className="text-lg text-slate-600">{estadoMusica === "pausado" ? "⏸" : "⏹"}</span>
        )}
      </div>
      <button
        type="button"
        title="Pular"
        aria-label="Pular faixa"
        disabled={!emVoz || skipMut.isPending}
        onClick={() => skipMut.mutate()}
        className={BTN_TRANSPORTE}
      >
        ⏭
      </button>
      <button
        type="button"
        title="Parar"
        aria-label="Parar"
        disabled={!emVoz || stopMut.isPending}
        onClick={() => stopMut.mutate()}
        className={BTN_TRANSPORTE}
      >
        ⏹
      </button>
      <button
        type="button"
        title={loopFaixa ? "Loop ligado — clique pra desligar" : "Loop"}
        aria-label="Alternar loop da faixa"
        aria-pressed={loopFaixa}
        disabled={!emVoz || loopMut.isPending}
        onClick={() => loopMut.mutate()}
        className={loopFaixa ? BTN_TRANSPORTE_ON : BTN_TRANSPORTE}
      >
        🔁
      </button>
    </div>
  );
}

interface SecaoVozProps {
  emVoz: boolean;
  canaisVoz: CanalVoz[] | undefined;
  carregandoCanaisVoz: boolean;
  canalVozId: string;
  onCanalVozIdChange: (id: string) => void;
  onEntrar: () => void;
  onSair: () => void;
  entrando: boolean;
  saindo: boolean;
}

/** Entrar/sair da voz — só mostra o seletor de canal quando ainda não está conectado. */
function SecaoVoz({
  emVoz,
  canaisVoz,
  carregandoCanaisVoz,
  canalVozId,
  onCanalVozIdChange,
  onEntrar,
  onSair,
  entrando,
  saindo,
}: SecaoVozProps) {
  if (emVoz) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
        <span className="text-xs text-emerald-400">● conectado à voz</span>
        <button type="button" className={BTN_MINI} disabled={saindo} onClick={onSair}>
          {saindo ? "Saindo…" : "Sair da voz"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[10rem] flex-1">
        <span className={ROTULO}>Canal de voz</span>
        <select
          value={canalVozId}
          onChange={(e) => onCanalVozIdChange(e.target.value)}
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
      <button type="button" className={BTN_PRIMARIO} disabled={!canalVozId || entrando} onClick={onEntrar}>
        {entrando ? "Entrando…" : "Entrar"}
      </button>
    </div>
  );
}

interface BibliotecaFavoritosProps {
  favoritos: Favorito[] | undefined;
  carregando: boolean;
  classeLista: string;
  colunas: boolean;
  tocarAgoraDesabilitado: boolean;
  enfileirarDesabilitado: boolean;
  excluirDesabilitado: boolean;
  onNovo: () => void;
  onSalvarAtual: () => void;
  podeSalvarAtual: boolean;
  onAbrirAlbum: () => void;
  onTocarAgora: (fav: Favorito) => void;
  onEnfileirar: (fav: Favorito) => void;
  onEditar: (fav: Favorito) => void;
  onExcluir: (fav: Favorito) => void;
}

/**
 * Biblioteca de favoritos: busca por texto + categorias colapsáveis, cada uma
 * com sua contagem. Estado inicial = tudo aberto (o problema relatado era
 * justamente "não mostra nada"; aqui as 39 faixas do usuário aparecem de cara).
 */
function BibliotecaFavoritos({
  favoritos,
  carregando,
  classeLista,
  colunas,
  tocarAgoraDesabilitado,
  enfileirarDesabilitado,
  excluirDesabilitado,
  onNovo,
  onSalvarAtual,
  podeSalvarAtual,
  onAbrirAlbum,
  onTocarAgora,
  onEnfileirar,
  onEditar,
  onExcluir,
}: BibliotecaFavoritosProps) {
  const [busca, setBusca] = useState("");
  const [categoriasFechadas, setCategoriasFechadas] = useState<Set<string>>(new Set());

  const lista = favoritos ?? [];
  const buscados = filtrarPorTexto(lista, busca);
  const grupos = agruparPorCategoria(buscados);

  function alternarCategoria(categoria: string) {
    setCategoriasFechadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(categoria)) proximo.delete(categoria);
      else proximo.add(categoria);
      return proximo;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`${ROTULO} mb-0`}>Favoritos</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">{busca ? `${buscados.length} de ${lista.length}` : lista.length}</span>
          {/* Favoritar o que está tocando sem redigitar nome/URL — durante a
              sessão é o caminho mais usado pra crescer a biblioteca. */}
          <button
            type="button"
            className={BTN_MINI}
            disabled={!podeSalvarAtual}
            title={podeSalvarAtual ? "Salvar a faixa atual nos favoritos" : "Nada tocando pra salvar"}
            onClick={onSalvarAtual}
          >
            Salvar atual
          </button>
          <button type="button" className={BTN_MINI} onClick={onNovo}>
            Novo
          </button>
          {/* Álbum de capas: mora aqui, e não no cabeçalho do painel, porque é
              uma visão DOS FAVORITOS — e o cabeçalho ficou só com os dois
              destinos do player (janela própria e modo música). */}
          {lista.length > 0 && (
            <button
              type="button"
              className={BTN_MINI}
              onClick={onAbrirAlbum}
              aria-label="Ver os favoritos em álbum, com capas grandes"
              title="Álbum de capas"
            >
              ▦
            </button>
          )}
        </div>
      </div>

      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome…"
        className={INPUT}
      />

      {carregando && <p className="text-xs text-slate-500">carregando…</p>}
      {!carregando && lista.length === 0 && <p className="text-xs text-slate-500">Nenhum favorito configurado.</p>}
      {!carregando && lista.length > 0 && grupos.length === 0 && (
        <p className="text-xs text-slate-500">Nenhuma faixa encontrada.</p>
      )}

      {grupos.length > 0 && (
        <div className={`${classeLista} space-y-3 rounded-lg border border-slate-800 bg-slate-950/30 p-2`}>
          {grupos.map(([categoria, itens]) => {
            const fechada = categoriasFechadas.has(categoria);
            return (
              <div key={categoria}>
                <button
                  type="button"
                  onClick={() => alternarCategoria(categoria)}
                  aria-expanded={!fechada}
                  className="mb-1 flex w-full items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300"
                >
                  <span>{categoria}</span>
                  <span className="normal-case tracking-normal text-slate-600">
                    {itens.length} {fechada ? "▸" : "▾"}
                  </span>
                </button>
                {!fechada && (
                  <ul className={colunas ? "grid grid-cols-2 gap-1.5" : "space-y-1"}>
                    {itens.map((fav) => (
                      <LinhaFavoritoBiblioteca
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
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface LinhaFavoritoBibliotecaProps {
  fav: Favorito;
  tocarAgoraDesabilitado: boolean;
  enfileirarDesabilitado: boolean;
  excluirDesabilitado: boolean;
  onTocarAgora: () => void;
  onEnfileirar: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}

/** Linha de um favorito na biblioteca: capa (thumbnail do YouTube ou placeholder), nome e ações. */
function LinhaFavoritoBiblioteca({
  fav,
  tocarAgoraDesabilitado,
  enfileirarDesabilitado,
  excluirDesabilitado,
  onTocarAgora,
  onEnfileirar,
  onEditar,
  onExcluir,
}: LinhaFavoritoBibliotecaProps) {
  const [capaQuebrada, setCapaQuebrada] = useState(false);
  const capa = thumbnailUrl(fav.url);

  return (
    <li className="group flex items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-slate-900">
      <div className="size-9 shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-800">
        {capa && !capaQuebrada ? (
          <img src={capa} alt="" className="size-full object-cover" onError={() => setCapaQuebrada(true)} />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={{ backgroundImage: gradienteDoNome(fav.nome) }}
          >
            <span className="text-[10px] font-bold text-white/90">{iniciais(fav.nome)}</span>
          </div>
        )}
      </div>
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

interface FormFavoritoProps {
  favForm: FavForm;
  salvando: boolean;
  onChange: (form: FavForm) => void;
  onSubmeter: () => void;
  onCancelar: () => void;
}

/** Formulário de criar/editar favorito (nome, URL, categoria opcional). */
function FormFavorito({ favForm, salvando, onChange, onSubmeter, onCancelar }: FormFavoritoProps) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {favForm.id === null ? "Novo favorito" : "Editar favorito"}
      </p>
      <input
        type="text"
        value={favForm.nome}
        onChange={(e) => onChange({ ...favForm, nome: e.target.value })}
        placeholder="Nome"
        className={INPUT}
      />
      <input
        type="text"
        value={favForm.url}
        onChange={(e) => onChange({ ...favForm, url: e.target.value })}
        placeholder="URL"
        className={INPUT}
      />
      <input
        type="text"
        value={favForm.categoria}
        onChange={(e) => onChange({ ...favForm, categoria: e.target.value })}
        placeholder="Categoria (opcional)"
        className={INPUT}
      />
      <div className="flex gap-2">
        <button type="button" className={BTN_PRIMARIO} disabled={salvando} onClick={onSubmeter}>
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className={BTN_NEUTRO} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Tocar por URL avulsa (fora da biblioteca de favoritos). */
function BlocoUrlAvulsa({
  emVoz,
  url,
  onUrlChange,
  onTocar,
  tocando,
}: {
  emVoz: boolean;
  url: string;
  onUrlChange: (v: string) => void;
  onTocar: () => void;
  tocando: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="URL (YouTube, Spotify, etc.)"
        disabled={!emVoz}
        className={INPUT}
      />
      <button type="button" className={BTN_PRIMARIO} disabled={!emVoz || !url.trim() || tocando} onClick={onTocar}>
        {tocando ? "Tocando…" : "Tocar"}
      </button>
    </div>
  );
}

/** Velocidade de reprodução (0.5×–2×). */
function BlocoVelocidade({ player }: { player: PlayerMusica }) {
  const { emVoz, velocidade, velocidadeMut } = player;
  return (
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
  );
}

/** Loop A-B: marcar pontos e alternar o loop entre eles. */
function BlocoLoopAB({ player }: { player: PlayerMusica }) {
  const { emVoz, temDuracao, posicao, ab, abDefinirMut, abToggleMut } = player;
  return (
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
  );
}

interface BlocoAutoSeguirProps {
  autoSeguir: boolean;
  nick: string;
  onAlternar: (ativo: boolean) => void;
  onEditarNick: (nick: string) => void;
  onAplicarNick: () => void;
}

/** Preferência "Bot me segue" (auto-join no canal de voz de um nick). */
function BlocoAutoSeguir({ autoSeguir, nick, onAlternar, onEditarNick, onAplicarNick }: BlocoAutoSeguirProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={autoSeguir}
          onChange={(e) => onAlternar(e.target.checked)}
          className="size-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
        />
        Bot me segue
      </label>
      <label className="flex-1">
        <span className={ROTULO}>Nick</span>
        <input
          type="text"
          value={nick}
          onChange={(e) => onEditarNick(e.target.value)}
          onBlur={onAplicarNick}
          placeholder={NICK_PADRAO_AUTO_SEGUIR}
          className={INPUT}
        />
      </label>
    </div>
  );
}

interface SecaoAvancadaProps {
  player: PlayerMusica;
  autoSeguir: boolean;
  nick: string;
  onAlternarAutoSeguir: (ativo: boolean) => void;
  onEditarNick: (nick: string) => void;
  onAplicarNick: () => void;
  url: string;
  onUrlChange: (v: string) => void;
  onTocarUrl: () => void;
  tocandoUrl: boolean;
}

/** Bloco dobrado: velocidade, loop A-B, auto-seguir e URL avulsa — controles de uso ocasional. */
function SecaoAvancada({
  player,
  autoSeguir,
  nick,
  onAlternarAutoSeguir,
  onEditarNick,
  onAplicarNick,
  url,
  onUrlChange,
  onTocarUrl,
  tocandoUrl,
}: SecaoAvancadaProps) {
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300">
        Avançado
      </summary>
      <div className="mt-3 space-y-3">
        <BlocoUrlAvulsa emVoz={player.emVoz} url={url} onUrlChange={onUrlChange} onTocar={onTocarUrl} tocando={tocandoUrl} />
        <BlocoVelocidade player={player} />
        <BlocoLoopAB player={player} />
        <BlocoAutoSeguir
          autoSeguir={autoSeguir}
          nick={nick}
          onAlternar={onAlternarAutoSeguir}
          onEditarNick={onEditarNick}
          onAplicarNick={onAplicarNick}
        />
      </div>
    </details>
  );
}
