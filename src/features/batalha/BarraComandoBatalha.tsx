// Barra de comando do cockpit de Batalha: rodada/turno, vitais de quem está
// jogando, as ações de turno e o transporte da música.
//
// Mora FORA do `Tabs` (ver `BatalhaScreen`), e é isso que a define: o `Tabs` é
// o contêiner que rola (`Tabs.tsx:90`), então qualquer controle colocado dentro
// dele sai da tela quando o mestre desce até o mapa — era exatamente a queixa
// ("fico subindo e descendo pra passar o turno"). Do lado de fora ela não
// precisa de `sticky` (que quebraria calado se algum ancestral ganhasse
// `overflow`) e ainda vale pra aba Mapa, que antes não tinha controle de turno
// nenhum.
//
// Substitui o card "Controle de turno" que vivia na 3ª coluna da faixa do meio.
// Não duplicar: dois "Próximo turno" na mesma tela é convite pra clicar no
// errado depois de rolar.

import type { EstadoBatalha } from "../../lib/types";
import { ordemExpandida } from "./logica";
import { usePlayerMusica } from "./usePlayerMusica";
import { abrirJanelaPlayer } from "./janelaPlayerNativa";
import { useToast } from "../../components/Toast";
import {
  batalhaDesfazer,
  batalhaNovaRodada,
  batalhaProximoTurno,
  batalhaResetar,
} from "../../lib/api";

const BTN =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_PRIMARIO = `${BTN} bg-indigo-500 text-white hover:bg-indigo-400`;
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800`;
const BTN_PERIGO = `${BTN} border border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/40`;
const BTN_ICONE =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-slate-800 bg-slate-950/60 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:opacity-40 disabled:pointer-events-none";
// Verde preenchido pro loop ligado, seguindo o mesmo critério do `PainelMusica`:
// indigo é a cor de ação do app, então "ativo" em indigo se confunde com botão comum.
const BTN_ICONE_ON =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-emerald-400 bg-emerald-500 text-sm text-white transition-colors hover:border-emerald-300";

interface Props {
  estado: EstadoBatalha;
  donoId: number | null;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
  onHistorico: () => void;
  onPresets: () => void;
}

export default function BarraComandoBatalha({
  estado,
  donoId,
  roda,
  onHistorico,
  onPresets,
}: Props) {
  const toast = useToast();
  const { emVoz, titulo, estadoMusica, loopFaixa, skipMut, stopMut, loopMut } = usePlayerMusica();

  const totalSlots = ordemExpandida(estado).length;
  const dono = estado.combatentes.find((c) => c.id === donoId) ?? null;
  const arenaVazia = estado.combatentes.length === 0;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">Rodada</span>
        <span className="text-base font-bold tabular-nums text-slate-100">{estado.rodada}</span>
        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">Turno</span>
        <span className="text-base font-bold tabular-nums text-slate-100">
          {totalSlots > 0 ? estado.indice_turno + 1 : 0}
          <span className="text-xs font-medium text-slate-500">/{totalSlots}</span>
        </span>
      </div>

      {/* Vitais de quem está jogando: o número que o mestre mais consulta na hora
          de aplicar dano, aqui pra não depender de a ficha estar na tela. */}
      {dono && (
        <div className="flex min-w-0 shrink items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1">
          <span className="truncate text-xs font-semibold text-amber-200">▸ {dono.nome}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-rose-300">HP {dono.pools.hp}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-sky-300">SP {dono.pools.sp}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-amber-300">Esc {dono.pools.escudo}</span>
        </div>
      )}

      <button
        type="button"
        className={BTN_PRIMARIO}
        disabled={arenaVazia}
        onClick={() => roda(batalhaProximoTurno)}
      >
        Próximo turno
      </button>
      <button type="button" className={BTN_NEUTRO} onClick={() => roda(batalhaNovaRodada)}>
        Nova rodada
      </button>
      <button
        type="button"
        className={BTN_NEUTRO}
        onClick={() => roda(batalhaDesfazer)}
        title="Desfazer a última ação"
      >
        ↺ Desfazer
      </button>
      <button type="button" className={BTN_NEUTRO} onClick={onHistorico}>
        Histórico
      </button>
      <button
        type="button"
        className={BTN_NEUTRO}
        onClick={onPresets}
        title="Salvar a batalha atual ou carregar uma pronta"
      >
        🗂 Batalhas
      </button>
      <button
        type="button"
        className={BTN_PERIGO}
        onClick={() => roda(batalhaResetar)}
        title="Esvazia a arena e volta pra rodada 1"
      >
        Resetar
      </button>

      {/* Transporte da música só existe com o bot numa call: fora dela os comandos
          não têm o que controlar, e um botão morto é pior que botão ausente. A
          biblioteca de favoritos continua no painel completo (rodapé, janela
          destacada pelo ⤢, ou Ctrl+M). */}
      {emVoz && (
        <div className="ml-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 py-1 pl-2 pr-1">
          <span className="text-xs" aria-hidden>
            {estadoMusica === "tocando" ? "🎵" : "⏸"}
          </span>
          <span className="max-w-[220px] truncate text-xs text-slate-300" title={titulo ?? undefined}>
            {titulo ?? "nada tocando"}
          </span>
          <button
            type="button"
            className={BTN_ICONE}
            onClick={() => skipMut.mutate()}
            title="Pular faixa"
          >
            ⏭
          </button>
          <button
            type="button"
            className={BTN_ICONE}
            onClick={() => stopMut.mutate()}
            title="Parar e limpar a fila"
          >
            ⏹
          </button>
          <button
            type="button"
            className={loopFaixa ? BTN_ICONE_ON : BTN_ICONE}
            onClick={() => loopMut.mutate()}
            title={loopFaixa ? "Loop ligado" : "Repetir a faixa atual"}
          >
            🔁
          </button>
          <button
            type="button"
            className={BTN_ICONE}
            onClick={() =>
              abrirJanelaPlayer((motivo) => toast.erro(`Não abriu a janela do player: ${motivo}`))
            }
            title="Abrir o player numa janela própria (fica por cima de outros programas)"
          >
            ⤢
          </button>
        </div>
      )}
    </div>
  );
}
