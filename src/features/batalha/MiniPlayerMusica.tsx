// Mini-player compacto do cockpit: agora tocando + seek + transporte (pular/
// parar/loop) + acesso rápido a favoritos. Reusa o núcleo do `usePlayerMusica`
// (mesmo estado do painel completo, `PlayerMusica.tsx` — nada aqui duplica
// lógica de domínio, só a apresentação compacta). O botão "destacar" transforma
// este painel numa janela flutuante arrastável (`JanelaMusicaFlutuante`), que
// renderiza o mesmo `ConteudoPlayerCompacto` exportado abaixo.

import { destacarPlayer, docarPlayer, useJanelaMusica } from "./janelaMusica";
import { alternarModoMusica, useModoMusica } from "./modoMusica";
import { formatarTempo } from "./musica";
import { usePlayerMusica } from "./usePlayerMusica";

const BTN_MINI =
  "inline-flex h-7 items-center justify-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none";
const BTN_TRANSPORTE =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950/50 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none";
const BTN_TRANSPORTE_ON = `${BTN_TRANSPORTE} border-indigo-500/60 bg-indigo-500/10 text-indigo-300`;

interface ConteudoPlayerCompactoProps {
  player: ReturnType<typeof usePlayerMusica>;
  /** false na janela flutuante: só título + seek + transporte (mais enxuto). */
  mostrarExtras: boolean;
}

/**
 * Conteúdo compacto compartilhado pelo mini-player docado e pela janela
 * flutuante — mesma marcação, o "esqueleto" (card docado vs. janela `fixed`
 * arrastável) é decidido por quem chama.
 */
export function ConteudoPlayerCompacto({ player, mostrarExtras }: ConteudoPlayerCompactoProps) {
  const {
    emVoz,
    estadoMusica,
    titulo,
    duracao,
    velocidade,
    loopFaixa,
    temDuracao,
    barraMax,
    valorBarra,
    aoArrastarSeek,
    finalizarSeek,
    skipMut,
    stopMut,
    loopMut,
    tocarAgoraMut,
    favoritos,
  } = player;

  const tocando = estadoMusica === "tocando";
  const tocarAgoraDesabilitado = !emVoz || tocarAgoraMut.isPending;
  const favoritosRapidos = (favoritos ?? []).slice(0, 6);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        {tocando && (
          <div className="flex h-[18px] w-[18px] shrink-0 items-end gap-[2px]" aria-hidden="true">
            {[40, 90, 60, 100].map((altura, i) => (
              <span
                key={i}
                className="w-[3px] rounded-sm bg-indigo-400"
                style={{
                  height: `${altura}%`,
                  animation: "eq-anim 900ms ease-in-out infinite",
                  animationDelay: `${i * 150}ms`,
                }}
              />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-200">
            {titulo ?? <span className="text-slate-600">nada tocando</span>}
          </p>
          <p className="text-xs text-slate-500">
            {!emVoz ? "sem voz" : tocando ? "tocando" : estadoMusica === "pausado" ? "pausado" : "conectado"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] tabular-nums text-slate-500">
        <span>{formatarTempo(valorBarra)}</span>
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
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-800 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span>{temDuracao && duracao != null ? formatarTempo(duracao) : "--:--"}</span>
      </div>

      <div className="flex items-center gap-1.5">
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
          title="Loop"
          aria-label="Alternar loop da faixa"
          disabled={!emVoz || loopMut.isPending}
          onClick={() => loopMut.mutate()}
          className={loopFaixa ? BTN_TRANSPORTE_ON : BTN_TRANSPORTE}
        >
          🔁
        </button>
        <span className="ml-auto rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1 text-[11px] tabular-nums text-slate-500">
          {velocidade}×
        </span>
      </div>

      {mostrarExtras && favoritosRapidos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {favoritosRapidos.map((fav) => (
            <button
              key={fav.id}
              type="button"
              disabled={tocarAgoraDesabilitado}
              onClick={() => tocarAgoraMut.mutate(fav.url)}
              title={`Tocar ${fav.nome} agora`}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2.5 text-[11px] text-slate-400 transition-colors hover:border-indigo-500/50 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span className="text-amber-400">★</span> {fav.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Mini-player docado no cockpit (dentro do `DiscordPainel`, e sozinho no modo
 * música). Controles avançados (canal de voz, auto-seguir, velocidade, loop
 * A-B, CRUD de favoritos) continuam só no painel completo (`PlayerMusica`),
 * acessível pelo "Controles avançados" logo abaixo no `DiscordPainel`.
 */
export default function MiniPlayerMusica() {
  const player = usePlayerMusica();
  const { destacada } = useJanelaMusica();
  const modoMusica = useModoMusica();

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bot Música</h2>
        {!destacada && (
          <button
            type="button"
            className={BTN_MINI}
            onClick={destacarPlayer}
            title="Destacar numa janela flutuante"
          >
            ⤢ destacar
          </button>
        )}
      </div>

      {destacada ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/40 px-3 py-2">
          <p className="text-xs text-slate-500">Música na janela flutuante.</p>
          <button type="button" className={BTN_MINI} onClick={docarPlayer}>
            Encaixar
          </button>
        </div>
      ) : (
        <ConteudoPlayerCompacto player={player} mostrarExtras />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className={BTN_MINI}
          onClick={alternarModoMusica}
          title="Encolher a UI só pro player (Ctrl+M)"
        >
          {modoMusica ? "⛶ Sair do modo música" : "⛶ Modo música"}
        </button>
      </div>
    </section>
  );
}
