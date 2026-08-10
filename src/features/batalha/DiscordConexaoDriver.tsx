import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useToast } from "../../components/Toast";
import { marcarQueda } from "./discordConexao";

/**
 * Vigia headless da conexão com o Discord. Montado UMA vez na `BatalhaScreen`,
 * FORA do `<Tabs>` — mesmo motivo do `DiscordMapaSyncDriver`: o painel que antes
 * escutava esse evento desmonta ao trocar de aba, então uma queda real durante o
 * modo música passava despercebida (e, pior, o remonte do painel fingia
 * "desconectado" mesmo sem queda nenhuma).
 *
 * O sidecar emite `discord:evento` com payload `"desconectado"` quando o bot cai
 * de verdade (token revogado, processo morto). Só isso derruba o estado — navegar
 * pela UI não.
 */
export default function DiscordConexaoDriver() {
  const toast = useToast();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;

    // O payload é string nos eventos de conexão e objeto nos de música
    // (`EventoMusica`) — daí o `unknown` + guarda, em vez de `listen<string>`.
    listen<unknown>("discord:evento", (evento) => {
      if (evento.payload !== "desconectado") return;
      marcarQueda();
      toast.erro("A conexão com o Discord caiu. Clique em Reconectar.");
    }).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });

    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, [toast]);

  return null;
}
