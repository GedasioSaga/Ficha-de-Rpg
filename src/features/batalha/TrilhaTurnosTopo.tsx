import { useEffect, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  batalhaAlternarModo,
  batalhaDefinirOrdem,
  batalhaEditarTurnos,
  batalhaRemover,
  getPersonagem,
  retratoDataUrl,
} from "../../lib/api";
import type { Combatente, EstadoBatalha } from "../../lib/types";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import { atributoEfetivo, ordemExpandida } from "./logica";
import { CHAVE_DRAG_PECA } from "./MapaFaixa";

interface Props {
  estado: EstadoBatalha;
  donoId: number | null;
  onSelecionar: (id: number) => void;
  onEscalar: () => void;
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

/**
 * Trilha de turnos horizontal no topo do cockpit — e, desde o pedido do usuário
 * de 2026-08-09, o ÚNICO lugar que lista quem está em batalha: absorveu o
 * painel "Em batalha" (retrato, HP/SP/Esc/Agi, arrastar pro mapa, remover) e o
 * botão "+ Escalar". Um combatente = um card; duas listas com o mesmo conteúdo
 * era um lugar a mais pra procurar a mesma informação. À direita, o resumo de
 * rodada/turno atual.
 */
export default function TrilhaTurnosTopo({ estado, donoId, onSelecionar, onEscalar, roda }: Props) {
  const manual = estado.ordem_manual;
  const combatentes = estado.ordem
    .map((id) => estado.combatentes.find((c) => c.id === id))
    .filter((c): c is Combatente => Boolean(c));

  const totalSlots = ordemExpandida(estado).length;
  const donoNome = estado.combatentes.find((c) => c.id === donoId)?.nome ?? null;

  function mover(indice: number, dir: -1 | 1) {
    const alvo = indice + dir;
    if (alvo < 0 || alvo >= estado.ordem.length) return;
    const nova = [...estado.ordem];
    [nova[indice], nova[alvo]] = [nova[alvo], nova[indice]];
    roda(() => batalhaDefinirOrdem(nova));
  }

  return (
    <div className="flex items-stretch gap-3">
      <div className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Ordem dos turnos
            <span className="ml-1.5 normal-case tracking-normal text-slate-600">
              ({combatentes.length})
            </span>
          </h2>
          <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onEscalar}
            className="rounded-md border border-indigo-900/60 bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-300 outline-none transition-colors duration-150 ease-out hover:bg-indigo-500/20 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            + Escalar
          </button>
          <button
            type="button"
            onClick={() => roda(() => batalhaAlternarModo(!manual))}
            className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              manual
                ? // Violeta, e não âmbar: âmbar agora significa UMA coisa só nesta
                  // tela — "é a vez deste combatente". Dois âmbares lado a lado
                  // com sentidos diferentes fazem o olho procurar o turno no
                  // lugar errado.
                  "border-violet-500/50 bg-violet-500/10 text-violet-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {manual ? "Manual" : "Auto (agilidade)"}
          </button>
          </div>
        </div>

        {combatentes.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-500">Sem combatentes.</p>
            <p className="mt-1 text-[11px] text-slate-600">
              Clique em "+ Escalar" pra montar a arena, ou carregue uma batalha salva na barra de
              cima.
            </p>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {combatentes.map((c, i) => (
                <MiniTurno
                  key={c.id}
                  combatente={c}
                  posicao={i + 1}
                  atual={c.id === donoId}
                  manual={manual}
                  podeSubir={i > 0}
                  podeDescer={i < combatentes.length - 1}
                  onSelecionar={() => onSelecionar(c.id)}
                  onSubir={() => mover(i, -1)}
                  onDescer={() => mover(i, 1)}
                  onTurnos={(total) => roda(() => batalhaEditarTurnos(c.id, Math.max(0, total - 1)))}
                  onRemover={() => roda(() => batalhaRemover(c.id))}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600">
              Arraste um card pro mapa · clique pra ver a ficha · ✕ tira da batalha.
            </p>
          </>
        )}
      </div>

      <div className="flex w-40 shrink-0 flex-col justify-center rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Rodada {estado.rodada}</span>
        <span className="text-2xl font-bold tabular-nums text-slate-100">
          Turno {totalSlots > 0 ? estado.indice_turno + 1 : 0}
          <span className="text-sm font-medium text-slate-500">/{totalSlots}</span>
        </span>
        {donoNome && <span className="mt-0.5 truncate text-xs text-amber-300">▸ {donoNome}</span>}
      </div>
    </div>
  );
}

interface MiniTurnoProps {
  combatente: Combatente;
  posicao: number;
  atual: boolean;
  manual: boolean;
  podeSubir: boolean;
  podeDescer: boolean;
  onSelecionar: () => void;
  onSubir: () => void;
  onDescer: () => void;
  onTurnos: (total: number) => void;
  onRemover: () => void;
}

function MiniTurno({
  combatente: c,
  posicao,
  atual,
  manual,
  podeSubir,
  podeDescer,
  onSelecionar,
  onSubir,
  onDescer,
  onTurnos,
  onRemover,
}: MiniTurnoProps) {
  const total = 1 + c.turnos_extras;
  const [campo, setCampo] = useState(String(total));
  useEffect(() => setCampo(String(total)), [total]);

  // Máximo de HP/SP vem da ficha (mesma fonte que o `PoolEditor` usa na Fase 3)
  // — combatente sem ficha vinculada (`personagem_ref` null) só mostra o valor cru.
  const ref = c.personagem_ref;
  const { data: ficha } = useQuery({
    queryKey: ["personagem", ref],
    queryFn: () => getPersonagem(ref!),
    enabled: ref != null,
  });
  const retratoPath = ficha?.retrato ?? null;
  const { data: retratoSrc } = useQuery({
    queryKey: ["retrato", retratoPath],
    queryFn: () => retratoDataUrl(retratoPath!),
    enabled: !!retratoPath,
    staleTime: Infinity,
  });
  const temImagem = !!retratoPath && !!retratoSrc;
  const ehJogador = c.tipo === "jogador";

  const hpMax = ficha?.hp;
  const spMax = ficha?.sp;
  const hpRatio = hpMax && hpMax > 0 ? Math.max(0, c.pools.hp) / hpMax : null;
  const spRatio = spMax && spMax > 0 ? Math.max(0, c.pools.sp) / spMax : null;
  const corHp =
    hpRatio == null ? "bg-emerald-500" : hpRatio <= 0.25 ? "bg-rose-500" : hpRatio <= 0.5 ? "bg-amber-400" : "bg-emerald-500";

  // O card é a peça do mapa: arrastar daqui posiciona o combatente na grade
  // (mesmo contrato do drop em `MapaFaixa.aoSoltar`). Arrasto que nasce num
  // INPUT (o de turnos, no modo manual) é abortado — senão selecionar o texto
  // do número viraria arrastar o card.
  function aoIniciarArrasto(e: DragEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(CHAVE_DRAG_PECA, String(c.id));
    // `text/plain` como reserva: alguns contextos do webview entregam o drop
    // sem os tipos customizados; quem lê valida se o id é de um combatente.
    e.dataTransfer.setData("text/plain", String(c.id));
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      draggable
      onDragStart={aoIniciarArrasto}
      className={`group relative flex w-36 shrink-0 cursor-grab flex-col rounded-xl border p-2.5 transition-colors duration-150 ease-out active:cursor-grabbing ${
        atual
          ? "border-amber-400/80 bg-amber-500/15 ring-1 ring-inset ring-amber-400/30"
          : "border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900"
      }`}
    >
      {/* Alvo de clique do card INTEIRO: um botão esticado por cima, em vez de
          envolver tudo — o card contém botões (◀ ▶) e um input no modo manual, e
          `<button>` dentro de `<button>` é HTML inválido. Os controles ficam
          acima deste overlay por serem posicionados e virem depois no DOM. */}
      <button
        type="button"
        onClick={onSelecionar}
        aria-label={`Ver ficha de ${c.nome}`}
        className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      />
      {/* Nº da ordem dá lugar ao ✕ no hover/foco: mesmo canto, um de cada vez —
          o número é leitura passiva, o ✕ é a ação que o mouse veio fazer. */}
      <span className="absolute right-1.5 top-1.5 text-[10px] font-semibold tabular-nums text-slate-500 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0">
        {posicao}
      </span>
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Tirar ${c.nome} da batalha`}
        title="Tirar da batalha"
        className="absolute right-1 top-1 grid size-5 place-items-center rounded-md text-[11px] text-rose-400 opacity-0 outline-none transition-opacity duration-150 ease-out hover:bg-rose-500/10 hover:text-rose-300 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-500 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        ✕
      </button>
      <div className="flex items-center gap-1.5 pr-4 text-left">
        <span className="size-6 shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-800">
          {temImagem ? (
            <img src={retratoSrc} alt="" className="size-full object-cover" />
          ) : (
            <span
              className="flex size-full items-center justify-center text-[10px] font-bold text-white/90"
              style={{ backgroundImage: gradienteDoNome(c.nome) }}
            >
              {iniciais(c.nome)}
            </span>
          )}
        </span>
        <span className={`size-1.5 shrink-0 rounded-full ${ehJogador ? "bg-indigo-400" : "bg-slate-500"}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200">
          {c.nome}
          {total > 1 && <span className="ml-1 text-[10px] text-slate-500">×{total}</span>}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        <BarraVital label="HP" valor={c.pools.hp} max={hpMax} ratio={hpRatio} cor={corHp} corLabel="text-rose-300" />
        <BarraVital label="SP" valor={c.pools.sp} max={spMax} ratio={spRatio} cor="bg-sky-400" corLabel="text-sky-300" />
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="text-amber-300">Esc</span>
          <span className="tabular-nums">{c.pools.escudo}</span>
          <span className="ml-auto">Agi</span>
          <span className="tabular-nums">{atributoEfetivo(c, "agilidade")}</span>
        </div>
      </div>

      {manual && (
        // `relative`: põe os controles acima do overlay de clique, senão reordenar
        // ou editar o número de turnos só selecionaria o combatente.
        <div className="relative mt-1.5 flex items-center justify-between gap-1 border-t border-slate-800 pt-1.5">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onSubir}
              disabled={!podeSubir}
              aria-label="Mover pra esquerda"
              className="rounded text-[10px] text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-30"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={onDescer}
              disabled={!podeDescer}
              aria-label="Mover pra direita"
              className="rounded text-[10px] text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-200 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-30"
            >
              ▶
            </button>
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={campo}
            onChange={(e) => setCampo(e.target.value)}
            onBlur={() => {
              const n = Math.min(10, Math.max(1, Number(campo) || 1));
              if (n !== total) onTurnos(n);
              setCampo(String(n));
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-5 w-9 rounded border border-slate-800 bg-slate-900 px-1 text-center text-[10px] tabular-nums text-slate-200 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </div>
      )}
    </div>
  );
}

function BarraVital({
  label,
  valor,
  max,
  ratio,
  cor,
  corLabel,
}: {
  label: string;
  valor: number;
  max?: number;
  ratio: number | null;
  cor: string;
  corLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className={`w-6 ${corLabel}`}>{label}</span>
        <span className="ml-auto tabular-nums text-slate-500">
          {valor}
          {max != null ? `/${max}` : ""}
        </span>
      </div>
      {ratio != null && (
        <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-800 ring-1 ring-inset ring-slate-700/50">
          <div className={`h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
        </div>
      )}
    </div>
  );
}
