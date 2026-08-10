// Hook headless com o núcleo do player de música: estado de "tocando agora" +
// transporte (pular/parar/loop/seek/velocidade/A-B) + favoritos. Extraído do
// `PlayerMusica` (painel completo) pra ser reusado por outros "skins" do mesmo
// player — o `MiniPlayerMusica` (compacto) e a `JanelaMusicaFlutuante`
// (destacada) — sem duplicar a assinatura do evento do sidecar nem as mutations.
//
// O que NÃO está aqui (fica só no painel completo, `PlayerMusica.tsx`, por não
// ser "núcleo de reprodução"): escolha de canal de voz + entrar/sair da call,
// preferência de auto-seguir, tocar por URL digitada e o CRUD de favoritos.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { emit, listen } from "@tauri-apps/api/event";
import {
  discordMusicaAbDefinir,
  discordMusicaAbToggle,
  discordMusicaLoop,
  discordMusicaPlay,
  discordMusicaSeek,
  discordMusicaSkip,
  discordMusicaStop,
  discordMusicaTocarAgora,
  discordMusicaVelocidade,
  listarFavoritos,
} from "../../lib/api";
import type { EventoMusica } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { thumbnailUrl } from "./musica";

/** Estado neutro do loop A-B quando não há evento de música ainda. */
const AB_ZERO: EventoMusica["ab"] = { a: null, b: null, ativo: false };

/**
 * Último evento `musica` (`discord:evento`) recebido do sidecar, guardado FORA
 * do React (escopo de módulo) — sobrevive à desmontagem de qualquer "skin" do
 * player. Mesmo motivo do `prefAutoSeguir` (ver `PlayerMusica.tsx`): o `Tabs`
 * desmonta a aba inativa, e um `useState` local perderia `em_voz` (e o resto da
 * faixa) nesse instante.
 */
let ultimaMusica: EventoMusica | null = null;
const ouvintesMusica = new Set<() => void>();

function lerUltimaMusica(): EventoMusica | null {
  return ultimaMusica;
}

function assinarMusica(ouvinte: () => void): () => void {
  ouvintesMusica.add(ouvinte);
  return () => {
    ouvintesMusica.delete(ouvinte);
  };
}

/**
 * Grava o evento mais recente e notifica todos os "skins" assinados. Exportada
 * porque `sairVoz` (só no painel completo, `PlayerMusica.tsx`) zera o estado
 * compartilhado ao sair da call — o mais correto seria não existir uma faixa
 * tocando sem conexão de voz.
 */
export function definirUltimaMusica(evento: EventoMusica | null): void {
  ultimaMusica = evento;
  for (const ouvinte of ouvintesMusica) ouvinte();
}

/**
 * URL da última faixa mandada a tocar, também FORA do React. O evento do sidecar
 * traz título/posição mas NÃO a URL, e é dela que sai a capa (thumbnail do
 * YouTube) — sem isso a capa seria estado local de cada skin, e tocar um favorito
 * pelo painel da coluna deixaria a janela flutuante com a capa velha.
 */
let ultimaUrl: string | null = null;
const ouvintesUrl = new Set<() => void>();

function lerUltimaUrl(): string | null {
  return ultimaUrl;
}

function assinarUrl(ouvinte: () => void): () => void {
  ouvintesUrl.add(ouvinte);
  return () => {
    ouvintesUrl.delete(ouvinte);
  };
}

function gravarUltimaUrl(url: string | null): void {
  if (url === ultimaUrl) return;
  ultimaUrl = url;
  for (const ouvinte of ouvintesUrl) ouvinte();
}

/** Evento próprio (não vem do sidecar) só pra manter as JANELAS em sincronia. */
const EVENTO_URL = "rpgv2:musica-url";

/**
 * Grava a URL da faixa atual e espalha pras outras janelas (a nativa do player e
 * a principal são contextos JS separados — store de módulo não cruza janela).
 * O eco do próprio `emit` volta pra cá e morre na guarda de igualdade.
 */
export function definirUltimaUrl(url: string | null): void {
  gravarUltimaUrl(url);
  void emit(EVENTO_URL, url);
}

/**
 * Título → URL aprendido da FILA do evento: o `EventoMusica` diz qual faixa está
 * tocando (título) mas não a URL dela, e é da URL que sai a miniatura. Só que
 * toda faixa que entra por "+ Fila" passa antes pela fila COM url — então quando
 * ela vira a atual, já sabemos o par. Cobre o caso que faltava: faixa que começou
 * sozinha ao avançar a fila aparecia sem capa.
 */
const urlPorTitulo = new Map<string, string>();

function aprenderUrlsDaFila(evento: EventoMusica): void {
  for (const item of evento.fila) {
    if (item.titulo && item.url) urlPorTitulo.set(item.titulo, item.url);
  }
}

/**
 * Núcleo reativo do player: lê o estado compartilhado (`ultimaMusica`), assina
 * o evento do sidecar e expõe as mutations de transporte + favoritos. Cada
 * "skin" montada (painel completo, mini-player, janela flutuante) chama este
 * hook e registra seu próprio listener do evento — todos escrevem o mesmo
 * valor no store do módulo, então é seguro (e correto) ter vários montados ao
 * mesmo tempo, exatamente como já acontecia com o `PlayerMusica` original.
 */
export function usePlayerMusica() {
  const toast = useToast();

  const musica = useSyncExternalStore(assinarMusica, lerUltimaMusica);
  const ultimaUrlTocada = useSyncExternalStore(assinarUrl, lerUltimaUrl);
  // Enquanto o usuário arrasta a barra, segura o valor local pra não pular com os ticks do evento.
  const [seekLocal, setSeekLocal] = useState<number | null>(null);

  const { data: favoritos, isLoading: carregandoFavoritos } = useQuery({
    queryKey: ["favoritos"],
    queryFn: listarFavoritos,
  });

  // Derivados do evento (com defaults neutros quando ainda não chegou nada).
  const emVoz = musica?.em_voz ?? false;
  const estadoMusica = musica?.estado ?? "parado";
  const titulo = musica?.titulo ?? null;
  const posicao = musica?.posicao ?? 0;
  const duracao = musica?.duracao ?? null;
  const velocidade = musica?.velocidade ?? 1;
  const loopFaixa = musica?.loop ?? false;
  const ab = musica?.ab ?? AB_ZERO;
  const fila = musica?.fila ?? [];

  // Capa: o par aprendido da fila ganha do "última que eu mandei tocar", porque
  // o primeiro descreve a faixa que está NO AR e o segundo só a última ação
  // desta janela (que pode ter sido substituída por um avanço de fila).
  const urlDaCapa = (titulo ? urlPorTitulo.get(titulo) : null) ?? ultimaUrlTocada;
  const capaUrl = urlDaCapa ? thumbnailUrl(urlDaCapa) : null;

  const temDuracao = duracao != null && duracao > 0;
  const barraMax = temDuracao ? duracao : 1;
  const valorBarra = seekLocal ?? Math.min(posicao, barraMax);

  // Só o objeto `musica` (tipo === "musica") atualiza o estado compartilhado
  // aqui; outros eventos (ex.: "conectado"/"desconectado") são tratados por
  // quem precisa deles (autoseguir e reconexão vivem no `PlayerMusica.tsx`).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    listen<string | EventoMusica>("discord:evento", (evento) => {
      const p = evento.payload;
      if (typeof p === "object" && p !== null && p.tipo === "musica") {
        // Aprender ANTES de notificar: o render que vem do `definirUltimaMusica`
        // já precisa achar o título novo no mapa pra desenhar a capa certa.
        aprenderUrlsDaFila(p);
        definirUltimaMusica(p);
      }
    }).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, []);

  // Espelha a URL da faixa vinda de OUTRA janela (a nativa do player e a
  // principal não compartilham memória). `gravarUltimaUrl` não reemite, senão
  // as duas janelas ficariam se respondendo.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    listen<string | null>(EVENTO_URL, (evento) => gravarUltimaUrl(evento.payload)).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, []);

  const skipMut = useMutation({
    mutationFn: discordMusicaSkip,
    onError: (e) => toast.erro(String(e)),
  });
  const stopMut = useMutation({
    mutationFn: discordMusicaStop,
    onError: (e) => toast.erro(String(e)),
  });
  const loopMut = useMutation({
    mutationFn: discordMusicaLoop,
    onError: (e) => toast.erro(String(e)),
  });
  const seekMut = useMutation({
    mutationFn: (seg: number) => discordMusicaSeek(seg),
    // Segura o valor arrastado até o sidecar confirmar (mesmo motivo do
    // `PlayerMusica` original): solta só se o alvo ainda for o que está na
    // tela, senão um seek antigo terminando cancelaria o arrasto novo.
    onSettled: (_data, _erro, seg) => setSeekLocal((v) => (v === seg ? null : v)),
    onError: (e) => toast.erro(String(e)),
  });
  const velocidadeMut = useMutation({
    mutationFn: (f: number) => discordMusicaVelocidade(f),
    onError: (e) => toast.erro(String(e)),
  });
  const abDefinirMut = useMutation({
    mutationFn: (v: { a: number | null; b: number | null }) => discordMusicaAbDefinir(v.a, v.b),
    onError: (e) => toast.erro(String(e)),
  });
  const abToggleMut = useMutation({
    mutationFn: (ativo: boolean) => discordMusicaAbToggle(ativo),
    onError: (e) => toast.erro(String(e)),
  });
  const tocarAgoraMut = useMutation({
    mutationFn: (u: string) => discordMusicaTocarAgora(u),
    onSuccess: () => toast.sucesso("Tocando agora."),
    onError: (e) => toast.erro(String(e)),
  });
  const enfileirarMut = useMutation({
    mutationFn: (u: string) => discordMusicaPlay(u),
    onSuccess: () => toast.sucesso("Adicionado à fila."),
    onError: (e) => toast.erro(String(e)),
  });

  function aoArrastarSeek(valor: number): void {
    setSeekLocal(valor);
  }

  function finalizarSeek(valor: number): void {
    if (seekLocal === null) return; // não houve arrasto
    seekMut.mutate(valor); // quem solta `seekLocal` é o `onSettled` do seekMut
  }

  return {
    musica,
    ultimaUrlTocada,
    capaUrl,
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
  };
}
