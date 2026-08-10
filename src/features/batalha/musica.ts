// Helpers puros do player de música: thumbnail do YouTube (extrai o videoId de
// qualquer URL — youtu.be, watch, shorts, embed, music.youtube.com — e monta a
// URL da miniatura) e agrupamento de favoritos por categoria.
// Sem I/O; usado pelo painel compacto e pelo álbum expandido.

import type { Favorito, ItemFila } from "../../lib/types";

/** Formato canônico de um videoId do YouTube (11 caracteres alfanuméricos, "-" ou "_"). */
const PADRAO_VIDEO_ID = /^[\w-]{11}$/;

/** Extrai o videoId de uma URL do YouTube (youtu.be, watch?v=, shorts, embed). null se não for YouTube. */
export function extrairVideoIdYoutube(url: string): string | null {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return null;
  }

  const dominio = destino.hostname.toLowerCase().replace(/^www\./, "");
  const segmentos = destino.pathname.split("/").filter(Boolean);
  let id: string | null = null;

  if (dominio === "youtu.be") {
    id = segmentos[0] ?? null;
  } else if (dominio === "youtube.com" || dominio === "music.youtube.com") {
    if (segmentos[0] === "watch") {
      id = destino.searchParams.get("v");
    } else if (segmentos[0] === "shorts" || segmentos[0] === "embed") {
      id = segmentos[1] ?? null;
    }
  }

  return id && PADRAO_VIDEO_ID.test(id) ? id : null;
}

/** URL da thumbnail (hqdefault) se for YouTube; senão null (o card usa placeholder). */
export function thumbnailUrl(url: string): string | null {
  const id = extrairVideoIdYoutube(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

/** Formata segundos como `m:ss` (lógica pura). Compartilhada por todos os "skins" do player. */
export function formatarTempo(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min}:${String(seg).padStart(2, "0")}`;
}

/** Descreve a próxima faixa a tocar: loop > próximo item da fila > nada (lógica pura). */
export function descreverProxima(fila: ItemFila[], loop: boolean): string {
  if (loop) return "essa mesma (loop)";
  const [proxima, ...resto] = fila;
  if (!proxima) return "—";
  const titulo = proxima.titulo ?? "sem título";
  return resto.length > 0 ? `${titulo} (+${resto.length} na fila)` : titulo;
}

/** Estado bruto de reprodução, espelhando `EventoMusica.estado`. */
type EstadoReproducao = "tocando" | "pausado" | "parado";

/** Rótulo textual do estado de reprodução, considerando a conexão de voz (lógica pura). */
export function descreverEstadoReproducao(emVoz: boolean, estado: EstadoReproducao): string {
  if (!emVoz) return "sem voz";
  if (estado === "tocando") return "tocando";
  if (estado === "pausado") return "pausado";
  return "conectado";
}

/** Rótulo do grupo de favoritos sem categoria. */
export const SEM_CATEGORIA = "Sem categoria";

/**
 * Marcas diacríticas combinantes que o Unicode NFD isola do caractere base
 * (ex.: "á" → "a" + este marcador). Construído via `fromCharCode` (em vez do
 * literal `\uXXXX`) pra não depender de um range de escape na fonte.
 */
const REGEX_DIACRITICOS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g",
);

/**
 * Agrupa favoritos por categoria (null → "Sem categoria"), preservando a ordem
 * de chegada da API. Compartilhado pelo painel compacto e pelo álbum expandido.
 */
export function agruparPorCategoria(favoritos: Favorito[]): [string, Favorito[]][] {
  const grupos = new Map<string, Favorito[]>();
  for (const fav of favoritos) {
    const chave = fav.categoria ?? SEM_CATEGORIA;
    const grupo = grupos.get(chave) ?? [];
    grupo.push(fav);
    grupos.set(chave, grupo);
  }
  return Array.from(grupos);
}

/** Remove acentos e caixa alta pra comparação tolerante a acento (ex.: "Camelot" ~ "camelôt"). */
function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(REGEX_DIACRITICOS, "")
    .toLowerCase();
}

/**
 * Filtra favoritos pelo nome, case-insensitive e tolerante a acento. Busca
 * vazia (ou só espaços) devolve a lista inteira. Usado pela busca do álbum.
 */
export function filtrarPorTexto(favoritos: Favorito[], busca: string): Favorito[] {
  const alvo = normalizarTexto(busca.trim());
  if (!alvo) return favoritos;
  return favoritos.filter((fav) => normalizarTexto(fav.nome).includes(alvo));
}
