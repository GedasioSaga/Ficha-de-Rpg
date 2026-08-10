// src/features/characters/useImagemDaFicha.ts
import { useQuery } from "@tanstack/react-query";
import { retratoDataUrl } from "../../lib/api";
import { imagemDeDataUrl, type ImagemIA } from "../../lib/gemini";
import type { RetratoInput } from "../../lib/types";

/**
 * Converte o retrato do form (ainda não salvo) em imagem pra IA.
 * "novo" vem direto do estado (nem chegou ao disco); "manter" precisa
 * buscar o arquivo já salvo; "nenhum" não manda imagem.
 */
export function useImagemDaFicha(retrato: RetratoInput): ImagemIA[] {
  const caminhoManter = retrato.modo === "manter" ? retrato.caminho : null;
  const { data: dataUrlManter } = useQuery({
    queryKey: ["retrato", caminhoManter],
    queryFn: () => retratoDataUrl(caminhoManter as string),
    enabled: caminhoManter !== null,
    staleTime: Infinity,
  });

  if (retrato.modo === "novo") {
    return [{ mimeType: `image/${retrato.formato}`, base64: retrato.base64 }];
  }
  if (retrato.modo === "manter") {
    const imagem = imagemDeDataUrl(dataUrlManter);
    return imagem ? [imagem] : [];
  }
  return [];
}
