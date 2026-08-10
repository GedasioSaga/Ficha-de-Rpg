import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  batalhaEstado,
  discordCanalSalvo,
  discordConectar,
  discordDefinirCanal,
  discordListarCanais,
  discordPostarMapa,
  getMapa,
} from "../../lib/api";
import type { MapaInput } from "../../lib/types";
import { mapaParaInput } from "../mapa/logica";
import { useToast } from "../../components/Toast";
import { definirSyncMapa, useSyncMapa } from "./syncMapaDiscord";
import { definirConexao, useConexaoDiscord } from "./discordConexao";
import SyncRegras from "./SyncRegras";

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_PRIMARIO = `${BTN} bg-indigo-500 text-white hover:bg-indigo-400`;
const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-40";
const OPTION = "bg-slate-900 text-slate-100";
const ROTULO = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";

/** Args de postar: o mapa (input) + o id do mapa ativo (faz as peças entrarem). */
type SyncArgs = { input: MapaInput; mapaId: number };

/**
 * O sidecar reporta a falta do token citando a variável de ambiente pelo nome —
 * traduz isso pra uma instrução acionável. Qualquer outro erro passa direto
 * (já vem legível do backend).
 */
function mensagemErroConexao(erro: unknown): string {
  const texto = String(erro);
  if (/DISCORD_BOT_TOKEN/i.test(texto)) {
    return "DISCORD_BOT_TOKEN não encontrado. Defina a variável de ambiente DISCORD_BOT_TOKEN e reinicie o app.";
  }
  return texto;
}

/**
 * Discord ao lado do mapa: conectar, escolher o canal, postar e ligar o sync ao
 * vivo. Fica junto do `MapaFaixa` porque é tudo sobre o MAPA — a música mora na
 * própria coluna, à direita.
 *
 * Depois de conectado o card de conexão encolhe pra um chip de uma linha: o botão
 * grande "Conectar" só existe enquanto ele é útil. O estado da conexão vem do
 * store `discordConexao` (não de `useMutation`), então navegar até a música e
 * voltar não finge desconexão.
 *
 * O MOTOR de sync (poll + envio) não vive aqui: quem observa terreno + peças e
 * edita a mensagem é o `DiscordMapaSyncDriver`, headless e sempre montado.
 */
export default function PainelCanalDiscord() {
  const toast = useToast();
  const { estado: estadoConexao, info, canalId } = useConexaoDiscord();
  const conectado = estadoConexao === "conectado";

  const conectarMut = useMutation({
    mutationFn: discordConectar,
    // Guarda de onde a tentativa partiu: se era um "Reconectar" (estado "caiu")
    // e falhou, voltar pra "ocioso" apagaria o aviso de queda e o botão viraria
    // "Conectar" de novo, como se nada tivesse acontecido.
    onMutate: () => {
      const anterior = estadoConexao;
      definirConexao({ estado: "conectando" });
      return { anterior };
    },
    onSuccess: (dados) => definirConexao({ estado: "conectado", info: dados }),
    onError: (e, _vars, contexto) => {
      definirConexao({ estado: contexto?.anterior === "caiu" ? "caiu" : "ocioso" });
      toast.erro(mensagemErroConexao(e));
    },
  });

  const { data: canais, isLoading: carregandoCanais } = useQuery({
    queryKey: ["discord", "canais"],
    queryFn: discordListarCanais,
    enabled: conectado,
  });

  const definirCanalMut = useMutation({
    mutationFn: (id: string) => discordDefinirCanal(id),
    onError: (e) => toast.erro(String(e)),
  });

  // Canal salvo (persistido): pré-seleciona o dropdown quando o bot conecta e a
  // lista chega, se o canal ainda existe. O backend já reidratou a sessão no
  // startup, então "Postar" funciona sem re-escolher.
  const { data: canalSalvo } = useQuery({
    queryKey: ["discord", "canalSalvo"],
    queryFn: discordCanalSalvo,
  });
  useEffect(() => {
    if (canalId || !canalSalvo || !canais) return;
    if (canais.some((c) => c.id === canalSalvo)) definirConexao({ canalId: canalSalvo });
  }, [canais, canalSalvo, canalId]);

  function aoEscolherCanal(id: string) {
    definirConexao({ canalId: id });
    definirSyncMapa({ postado: false, sincronizar: false });
    if (id) definirCanalMut.mutate(id);
  }

  // O mapa postado segue o mapa ativo da batalha (`estado.mapa_id`, escolhido no
  // cockpit) — não há seletor de mapa aqui de propósito.
  const { data: estadoBatalha } = useQuery({ queryKey: ["batalha"], queryFn: batalhaEstado });
  const mapaAtivoId = estadoBatalha?.mapa_id ?? null;
  const { sincronizar, postado } = useSyncMapa();

  const { data: mapaAtual } = useQuery({
    queryKey: ["mapa", mapaAtivoId],
    queryFn: () => getMapa(mapaAtivoId as number),
    enabled: mapaAtivoId !== null,
  });

  const postarMut = useMutation({
    mutationFn: ({ input, mapaId }: SyncArgs) => discordPostarMapa(input, mapaId),
    onSuccess: () => {
      definirSyncMapa({ postado: true });
      toast.sucesso("Mapa postado no Discord.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Discord</h2>

      {conectado ? (
        // Conectado: chip de uma linha. O card grande sai de cena e devolve o
        // espaço pro canal/mapa — que é o que o usuário usa daqui em diante.
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <span className="size-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
          <span className="truncate">
            <span className="text-slate-200">{info?.usuario ?? "conectado"}</span>
            {info && (
              <span className="text-slate-500">
                {" · "}
                {info.guilds.length} {info.guilds.length === 1 ? "servidor" : "servidores"}
              </span>
            )}
          </span>
        </p>
      ) : (
        <div className="space-y-2">
          {estadoConexao === "caiu" ? (
            <p className="flex items-center gap-2 text-xs text-rose-300">
              <span className="size-2 shrink-0 rounded-full bg-rose-400" aria-hidden />A conexão caiu.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Conecta o bot pra postar (ou sincronizar ao vivo) o mapa ativo da batalha.
            </p>
          )}
          <button
            type="button"
            className={BTN_PRIMARIO}
            disabled={conectarMut.isPending}
            onClick={() => conectarMut.mutate()}
          >
            {conectarMut.isPending
              ? "Conectando…"
              : estadoConexao === "caiu"
                ? "Reconectar"
                : "Conectar"}
          </button>
        </div>
      )}

      {conectado && (
        <>
          <label className="block">
            <span className={ROTULO}>Canal</span>
            <select
              value={canalId}
              onChange={(e) => aoEscolherCanal(e.target.value)}
              disabled={carregandoCanais}
              className={SELECT}
            >
              <option value="" className={OPTION}>
                {carregandoCanais ? "carregando…" : "selecione um canal"}
              </option>
              {(canais ?? []).map((c) => (
                <option key={c.id} value={c.id} className={OPTION}>
                  {c.guild} — #{c.nome}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className={ROTULO}>Mapa ativo</span>
            {mapaAtivoId === null ? (
              <p className="text-xs text-slate-500">
                Nenhum mapa ativo — escolha o mapa ativo no cockpit.
              </p>
            ) : (
              <p className="text-xs text-slate-300">
                {mapaAtual?.titulo || "(sem título)"}
                <span className="ml-1 text-slate-500">· segue o cockpit</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className={`${BTN_PRIMARIO} w-full`}
              disabled={
                !canalId ||
                !mapaAtual ||
                mapaAtivoId === null ||
                postarMut.isPending ||
                definirCanalMut.isPending
              }
              onClick={() =>
                mapaAtual &&
                mapaAtivoId !== null &&
                postarMut.mutate({ input: mapaParaInput(mapaAtual), mapaId: mapaAtivoId })
              }
            >
              {postarMut.isPending ? "Postando…" : postado ? "Repostar mapa" : "Postar mapa"}
            </button>

            <label
              className={`flex items-center gap-2 text-xs ${postado ? "text-slate-300" : "text-slate-600"}`}
            >
              <input
                type="checkbox"
                checked={sincronizar}
                disabled={!postado}
                onChange={(e) => definirSyncMapa({ sincronizar: e.target.checked })}
                className="size-4 rounded border-slate-700 bg-slate-950 accent-indigo-500 disabled:opacity-40"
              />
              Sincronizar ao vivo
            </label>
          </div>

          {sincronizar && postado && (
            <p className="text-[11px] text-slate-500">
              Mover peças ou editar o terreno atualiza a mensagem no Discord automaticamente, mesmo
              fora desta aba.
            </p>
          )}

          {/* Importar as regras do jogo dos canais do Discord. Fica colapsado
              porque é ação rara (uma vez, e depois só quando as regras mudam),
              mas precisa morar aqui: é o único painel de Discord montado na UI. */}
          <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-2 [&[open]>summary]:mb-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-slate-400 hover:text-slate-200">
              Regras do jogo (importar do Discord)
            </summary>
            <SyncRegras canais={canais ?? []} conectado={conectado} />
          </details>
        </>
      )}
    </section>
  );
}
