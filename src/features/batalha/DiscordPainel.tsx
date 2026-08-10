import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  batalhaEstado,
  discordCanalSalvo,
  discordConectar,
  discordDefinirCanal,
  discordIniciar,
  discordListarCanais,
  discordPing,
  discordPostarMapa,
  getMapa,
} from "../../lib/api";
import type { MapaInput } from "../../lib/types";
import { mapaParaInput } from "../mapa/logica";
import { useToast } from "../../components/Toast";
import { definirSyncMapa, useSyncMapa } from "./syncMapaDiscord";
import PlayerMusica from "./PlayerMusica";
import MiniPlayerMusica from "./MiniPlayerMusica";
import SyncRegras from "./SyncRegras";

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_PRIMARIO = `${BTN} bg-indigo-500 text-white hover:bg-indigo-400`;
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800`;
const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-slate-800 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-40";
const OPTION = "bg-slate-900 text-slate-100";
const ROTULO = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";

/** Args de postar: o mapa (input) + o id do mapa ativo (faz as peças entrarem). */
type SyncArgs = { input: MapaInput; mapaId: number };

interface MutState {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
}

/** Deriva a linha de status a partir do estado das duas mutations (lógica pura, sem I/O). */
function textoStatusSidecar(iniciar: MutState, ping: MutState & { data: string | undefined }): string {
  if (ping.isPending) return "aguardando pong…";
  if (ping.isSuccess) return `pong recebido: "${ping.data}"`;
  if (ping.isError) return "ping falhou (veja o aviso)";
  if (iniciar.isPending) return "iniciando sidecar…";
  if (iniciar.isSuccess) return "sidecar iniciado — pronto pra pingar";
  if (iniciar.isError) return "falha ao iniciar (veja o aviso)";
  return "sidecar não iniciado";
}

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
 * Painel do Discord: conectar o bot, escolher canal, postar e ligar/desligar o
 * sync ao vivo. O mapa NÃO é escolhido aqui — segue o mapa ativo da batalha
 * (`estado.mapa_id`, definido no cockpit); o sync inclui as peças.
 *
 * O MOTOR de sync (poll + envio) não vive mais aqui: como o `Tabs` desmonta a aba
 * inativa, este painel some durante o combate. Quem observa terreno + peças e
 * edita a mensagem é o `DiscordMapaSyncDriver` (headless, montado na
 * `BatalhaScreen` fora do `Tabs`). Aqui ficam só os controles (postar, checkbox),
 * com o estado no store de módulo `syncMapaDiscord` (sobrevive à desmontagem).
 */
export default function DiscordPainel() {
  const toast = useToast();

  // ---------- F4.1: conexão ----------
  const conectarMut = useMutation({
    mutationFn: discordConectar,
    onError: (e) => toast.erro(mensagemErroConexao(e)),
  });
  const conectado = conectarMut.isSuccess;

  // Reage a uma queda de conexão espontânea (bot cai, token revogado etc.) —
  // o sidecar já emite esse evento desde o F4.0 (`tratar_stdout` repassa todo
  // `Evento` como `discord:evento`); aqui só passamos a escutar. `reset()`
  // volta o botão "Conectar" a ficar disponível.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    listen<string>("discord:evento", (evento) => {
      if (evento.payload !== "desconectado") return;
      conectarMut.reset();
      toast.erro("A conexão com o Discord caiu. Clique em Conectar de novo.");
    }).then((fn) => {
      if (cancelado) fn();
      else unlisten = fn;
    });
    return () => {
      cancelado = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectarMut.reset, toast]);

  // ---------- F4.2: canal ----------
  const { data: canais, isLoading: carregandoCanais } = useQuery({
    queryKey: ["discord", "canais"],
    queryFn: discordListarCanais,
    enabled: conectado,
  });
  const [canalId, setCanalId] = useState("");
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
    if (canais.some((c) => c.id === canalSalvo)) setCanalId(canalSalvo);
  }, [canais, canalSalvo, canalId]);

  function aoEscolherCanal(id: string) {
    setCanalId(id);
    definirSyncMapa({ postado: false, sincronizar: false });
    if (id) definirCanalMut.mutate(id);
  }

  // ---------- F4.2: mapa (segue o mapa ativo da batalha — estado.mapa_id) ----------
  const { data: estadoBatalha } = useQuery({ queryKey: ["batalha"], queryFn: batalhaEstado });
  const mapaAtivoId = estadoBatalha?.mapa_id ?? null;
  // Sincronizar/postado vivem no store de módulo — sobrevivem ao desmonte desta
  // aba e são lidos pelo driver sempre-montado. O reset ao trocar de mapa ativo
  // também é do driver (ele é quem está sempre montado observando `mapa_id`).
  const { sincronizar, postado } = useSyncMapa();

  // Sem refetchInterval: o poll do sync ao vivo é do driver. Aqui só lê o mapa
  // ativo pra exibir o título e montar o payload do "Postar".
  const { data: mapaAtual } = useQuery({
    queryKey: ["mapa", mapaAtivoId],
    queryFn: () => getMapa(mapaAtivoId as number),
    enabled: mapaAtivoId !== null,
  });

  // ---------- F4.3: postar ----------
  const postarMut = useMutation({
    mutationFn: ({ input, mapaId }: SyncArgs) => discordPostarMapa(input, mapaId),
    onSuccess: () => {
      definirSyncMapa({ postado: true });
      toast.sucesso("Mapa postado no Discord.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  // Sincronizar ao vivo: motor movido pro DiscordMapaSyncDriver (sempre montado).

  // ---------- F4.0: sidecar cru (debug) ----------
  const iniciarMut = useMutation({
    mutationFn: discordIniciar,
    onSuccess: () => toast.sucesso("Sidecar iniciado."),
    onError: (e) => toast.erro(String(e)),
  });
  const pingMut = useMutation({
    mutationFn: discordPing,
    onError: (e) => toast.erro(String(e)),
  });
  const statusSidecar = textoStatusSidecar(iniciarMut, pingMut);

  return (
    <div className="max-w-xl space-y-4">
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Discord</h2>
          <p className="mt-1 text-sm text-slate-500">
            Conecta o bot, escolhe o canal e posta (ou sincroniza ao vivo) o mapa ativo da batalha.
          </p>
        </div>

        <button
          type="button"
          className={BTN_PRIMARIO}
          disabled={conectarMut.isPending || conectado}
          onClick={() => conectarMut.mutate()}
        >
          {conectarMut.isPending ? "Conectando…" : conectado ? "Conectado" : "Conectar"}
        </button>

        {conectarMut.isError && (
          <p className="text-sm text-rose-300">{mensagemErroConexao(conectarMut.error)}</p>
        )}
        {conectado && conectarMut.data && (
          <p className="text-sm text-slate-400">
            Logado como <span className="text-slate-200">{conectarMut.data.usuario}</span> ·{" "}
            {conectarMut.data.guilds.length}{" "}
            {conectarMut.data.guilds.length === 1 ? "servidor" : "servidores"}
          </p>
        )}
      </section>

      {conectado && (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
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
              <p className="text-sm text-slate-500">
                Nenhum mapa ativo — escolha o mapa ativo no cockpit (aba Combate).
              </p>
            ) : (
              <p className="text-sm text-slate-300">
                {mapaAtual?.titulo || "(sem título)"}
                <span className="ml-1 text-slate-500">· segue o cockpit</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BTN_PRIMARIO}
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

            <label className={`flex items-center gap-2 text-sm ${postado ? "text-slate-300" : "text-slate-600"}`}>
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
            <p className="text-xs text-slate-500">
              Sincronizando ao vivo: mover peças ou editar o terreno atualiza a mensagem no Discord
              automaticamente, mesmo fora desta aba.
            </p>
          )}
        </section>
      )}

      <SyncRegras canais={canais ?? []} conectado={conectado} />

      {conectado && <MiniPlayerMusica />}

      {conectado && (
        <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-400">
            Controles avançados de música
          </summary>
          <div className="mt-3">
            <PlayerMusica />
          </div>
        </details>
      )}

      <details className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-400">
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
          </div>
          <p className="text-sm text-slate-400">
            Status: <span className="text-slate-200">{statusSidecar}</span>
          </p>
        </div>
      </details>
    </div>
  );
}
