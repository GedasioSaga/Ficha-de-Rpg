import { useMutation } from "@tanstack/react-query";
import { discordIniciar, discordPing } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { resetarConexao, useConexaoDiscord } from "./discordConexao";

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800`;

interface MutState {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

/** Deriva a linha de status a partir do estado das duas mutations (lógica pura, sem I/O). */
function textoStatusSidecar(
  iniciar: MutState,
  ping: MutState & { data: string | undefined },
): string {
  if (ping.isPending) return "aguardando pong…";
  if (ping.isSuccess) return `pong recebido: "${ping.data}"`;
  if (ping.isError) return "ping falhou (veja o aviso)";
  if (iniciar.isPending) return "iniciando sidecar…";
  if (iniciar.isSuccess) return "sidecar iniciado — pronto pra pingar";
  if (iniciar.isError) return "falha ao iniciar (veja o aviso)";
  return "sidecar não iniciado";
}

/**
 * Manutenção do sidecar, dobrada por padrão: subir o processo à mão, pingar e
 * destravar a UI da conexão. Fica escondido porque o uso normal é só "Conectar"
 * no painel do canal — isto aqui é recovery.
 */
export default function DiscordDebug() {
  const toast = useToast();
  const { estado } = useConexaoDiscord();

  const iniciarMut = useMutation({
    mutationFn: discordIniciar,
    onSuccess: () => toast.sucesso("Sidecar iniciado."),
    onError: (e) => toast.erro(String(e)),
  });
  const pingMut = useMutation({
    mutationFn: discordPing,
    onError: (e) => toast.erro(String(e)),
  });

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
        Debug do sidecar
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN_NEUTRO}
            disabled={iniciarMut.isPending}
            onClick={() => iniciarMut.mutate()}
          >
            {iniciarMut.isPending ? "Iniciando…" : "Iniciar sidecar"}
          </button>
          <button
            type="button"
            className={BTN_NEUTRO}
            disabled={pingMut.isPending}
            onClick={() => pingMut.mutate()}
          >
            {pingMut.isPending ? "Enviando…" : "Ping"}
          </button>
          <button
            type="button"
            className={BTN_NEUTRO}
            disabled={estado === "ocioso"}
            onClick={() => {
              resetarConexao();
              toast.sucesso("Estado da conexão zerado — clique em Conectar.");
            }}
          >
            Zerar conexão
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Status: <span className="text-slate-200">{textoStatusSidecar(iniciarMut, pingMut)}</span>
        </p>
        <p className="text-[11px] text-slate-600">
          "Zerar conexão" só limpa o estado aqui do app (libera o botão Conectar se a UI travar) — o
          bot no sidecar não tem comando de logout.
        </p>
      </div>
    </details>
  );
}
