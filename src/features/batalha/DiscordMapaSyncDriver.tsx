import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { batalhaEstado, discordAtualizarMapa, getMapa } from "../../lib/api";
import { mapaParaInput } from "../mapa/logica";
import { useToast } from "../../components/Toast";
import { assinaturaPecas, resetarSyncMapa, useSyncMapa } from "./syncMapaDiscord";

/** Poll do mapa (terreno) enquanto o sync ao vivo está ligado. */
const POLL_SYNC_MS = 1500;
/** Espera antes de editar a mensagem no Discord — junta rajadas de mudança. */
const DEBOUNCE_SYNC_MS = 600;

/**
 * Motor headless do sync do mapa com o Discord. Montado UMA vez na `BatalhaScreen`,
 * FORA do `<Tabs>` — assim vive durante todo o combate, independente da sub-aba
 * ativa (o painel do Discord, que antes fazia isso, desmonta quando a aba não
 * está aberta, e mover peça na aba Combate não sincronizava nada).
 *
 * Observa DUAS fontes de mudança:
 *  - terreno: `["mapa", id].atualizado_em` — via poll, pois o auto-save do editor
 *    não invalida esse cache;
 *  - peças: `["batalha"].combatentes[].posicao` — reativo, já que o `setQueryData`
 *    a cada posicionar/mover/remover peça re-renderiza este driver.
 * Quando a assinatura combinada muda e o sync está ligado, edita a mensagem viva
 * (o backend coalesce os envios: só um em voo por vez).
 */
export default function DiscordMapaSyncDriver() {
  const toast = useToast();

  // O laço de sync no backend roda sozinho (debounce, sem ação direta do
  // usuário), então ele não pode devolver erro pro `.catch()` daqui — avisa por
  // evento. Sem isto, uma falha (tipicamente a mensagem passar de 2000 chars
  // depois que a legenda cresceu) congelaria o mapa no Discord em silêncio.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    listen<string>("discord:sync-mapa-falhou", (evento) => {
      toast.erro(`Sync do mapa parou: ${evento.payload}`);
    }).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, [toast]);

  const { data: estado } = useQuery({ queryKey: ["batalha"], queryFn: batalhaEstado });
  const mapaId = estado?.mapa_id ?? null;

  const { sincronizar, postado } = useSyncMapa();
  const podeSincronizar = sincronizar && postado && mapaId !== null;

  const { data: mapaAtual } = useQuery({
    queryKey: ["mapa", mapaId],
    queryFn: () => getMapa(mapaId as number),
    enabled: mapaId !== null,
    refetchInterval: podeSincronizar ? POLL_SYNC_MS : false,
  });

  // Trocou o mapa ativo? A mensagem postada era do mapa anterior — zera o sync
  // (o usuário reposta o novo). Fica aqui porque o driver está sempre montado.
  const mapaAnteriorRef = useRef<number | null>(mapaId);
  useEffect(() => {
    if (mapaAnteriorRef.current !== mapaId) {
      mapaAnteriorRef.current = mapaId;
      resetarSyncMapa();
    }
  }, [mapaId]);

  // Assinatura combinada = terreno (timestamp) + peças (glifo@célula, ordenado).
  const assinatura = `${mapaAtual?.atualizado_em ?? ""}|${estado ? assinaturaPecas(estado) : ""}`;
  const ultimaAssinaturaRef = useRef<string | null>(null);

  // Ao LIGAR o sync, ancora na assinatura atual: o "Postar" já mandou este estado,
  // então não dispara um edit redundante logo de cara. Ao desligar, solta a âncora.
  useEffect(() => {
    ultimaAssinaturaRef.current = podeSincronizar ? assinatura : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeSincronizar]);

  // Mudou a assinatura com o sync ligado → debounce → edita a mensagem viva.
  useEffect(() => {
    if (!podeSincronizar || !mapaAtual || mapaId === null) return;
    if (assinatura === ultimaAssinaturaRef.current) return;

    const t = setTimeout(() => {
      ultimaAssinaturaRef.current = assinatura;
      discordAtualizarMapa(mapaParaInput(mapaAtual), mapaId).catch((e) => toast.erro(String(e)));
    }, DEBOUNCE_SYNC_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeSincronizar, assinatura, mapaAtual, mapaId]);

  return null;
}
