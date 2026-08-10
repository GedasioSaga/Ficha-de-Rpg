// Helpers puros da batalha — derivam do Estado vivo (espelham o motor Rust).
// Sem I/O; usados por todos os painéis da tela.

import type { AtributoNome, Combatente, EstadoBatalha } from "../../lib/types";
import { ATRIBUTOS } from "../characters/atributos";

/** Ordem de iniciativa expandida por `turnos_extras` (espelha `ordem_expandida` do Rust). */
export function ordemExpandida(e: EstadoBatalha): number[] {
  const exp: number[] = [];
  for (const id of e.ordem) {
    const c = e.combatentes.find((x) => x.id === id);
    const total = 1 + (c?.turnos_extras ?? 0);
    for (let i = 0; i < total; i++) exp.push(id);
  }
  return exp;
}

/** Id do dono do turno atual (`null` se a arena está vazia). */
export function donoDoTurno(e: EstadoBatalha): number | null {
  return ordemExpandida(e)[e.indice_turno] ?? null;
}

/** Índice do atributo no vetor `base` (ordem canônica da ficha). */
function indiceAtributo(attr: AtributoNome): number {
  return (ATRIBUTOS as readonly string[]).indexOf(attr);
}

/** Soma dos deltas de um atributo vindos de uma origem (transformação ou status manual). */
function somaDeltas(
  c: Combatente,
  attr: AtributoNome,
  filtro: (origem: Combatente["modificadores"][number]["origem"]) => boolean,
): number {
  return c.modificadores
    .filter((m) => filtro(m.origem))
    .flatMap((m) => m.deltas)
    .filter(([a]) => a === attr)
    .reduce((s, [, d]) => s + d, 0);
}

/** Valor efetivo = base + todos os modificadores (transformação + manual). */
export function atributoEfetivo(c: Combatente, attr: AtributoNome): number {
  const base = c.base[indiceAtributo(attr)] ?? 0;
  return base + somaDeltas(c, attr, () => true);
}

/** Só o delta vindo de transformação (exclui o modificador manual). */
export function deltaTransformacao(c: Combatente, attr: AtributoNome): number {
  return somaDeltas(c, attr, (o) => "transformacao" in o);
}

/** Modificador manual atual por atributo (o buff/debuff ad-hoc do mestre). */
export function modificadorManual(c: Combatente): Map<AtributoNome, number> {
  const map = new Map<AtributoNome, number>();
  const m = c.modificadores.find((x) => "status" in x.origem && x.origem.status === "Manual");
  if (m) for (const [a, d] of m.deltas) map.set(a, d);
  return map;
}

/** Nome da transformação ativa, se houver. */
export function transformacaoAtiva(c: Combatente): string | null {
  const m = c.modificadores.find((x) => "transformacao" in x.origem);
  return m && "transformacao" in m.origem ? m.origem.transformacao : null;
}

/** Cooldown ativo de uma habilidade (`null` se não travada). `turnos_restantes` = null → permanente. */
export function cooldownDe(
  c: Combatente,
  habilidade: string,
): { turnos_restantes: number | null } | null {
  return c.cooldowns.find((cd) => cd.habilidade === habilidade) ?? null;
}
