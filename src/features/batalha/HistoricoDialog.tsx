import type { EstadoBatalha } from "../../lib/types";
import { IconFechar } from "../../components/icons";
import { rotuloColuna } from "../mapa/logica";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  estado: EstadoBatalha;
}

interface Linha {
  rodada: number;
  turno: number;
  quem: string;
  acao: string;
  detalhe: string;
}

/** Extrai (tag, payload) de um `Evento` serde externally-tagged (`{"Tag":{...}}` ou `"Resetado"`). */
function parseEvento(ev: unknown): { tag: string; p: Record<string, unknown> } {
  if (typeof ev === "string") return { tag: ev, p: {} };
  if (ev && typeof ev === "object") {
    const tag = Object.keys(ev)[0] ?? "?";
    const raw = (ev as Record<string, unknown>)[tag];
    return { tag, p: raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {} };
  }
  return { tag: "?", p: {} };
}

/**
 * Rótulo de uma posição `(linha, coluna)` 0-indexada no mesmo formato que o
 * mestre vê na grade: coluna como letra, linha como número 1-indexado
 * (ex.: `(3, 5)` → `"F4"`). Espelha `rotulo_coluna` de `domain/mapa/render.rs`.
 */
function rotuloPosicao(pos: unknown): string {
  if (!Array.isArray(pos) || pos.length !== 2) return "?";
  const [linha, coluna] = pos as [number, number];
  return `${rotuloColuna(coluna)}${linha + 1}`;
}

function origemLabel(o: unknown): string {
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    if (typeof r.transformacao === "string") return r.transformacao;
    if (typeof r.status === "string") return r.status;
  }
  return "";
}

/** Converte o histórico de eventos em linhas legíveis (rodada/turno acumulados no percurso). */
function montarLinhas(historico: unknown[], nomes: Map<number, string>): Linha[] {
  const linhas: Linha[] = [];
  let rodada = 1;
  let turno = 0;
  const quemDe = (p: Record<string, unknown>) =>
    typeof p.id === "number" ? nomes.get(p.id) ?? `#${p.id}` : "";

  for (const ev of historico) {
    const { tag, p } = parseEvento(ev);
    let acao = tag;
    let detalhe = "";
    switch (tag) {
      case "CombatenteAdicionado":
        acao = "Entrou";
        break;
      case "CombatenteRemovido":
        acao = "Saiu";
        break;
      case "OrdemDefinida":
        acao = "Ordem definida";
        break;
      case "ModoOrdemAlternado":
        acao = "Modo de ordem";
        detalhe = p.manual ? "manual" : "automático";
        break;
      case "TurnosExtrasEditados":
        acao = "Turnos extras";
        detalhe = `${p.valor}`;
        break;
      case "TransformacaoAplicada":
        acao = "Transformou";
        detalhe = String(p.nome ?? "");
        break;
      case "TransformacaoRevertida":
        acao = "Reverteu forma";
        detalhe = String(p.nome ?? "");
        break;
      case "ModificadorAplicado":
        acao = "Modificador";
        detalhe = origemLabel(p.origem);
        break;
      case "ModificadorExpirado":
        acao = "Modificador expirou";
        detalhe = origemLabel(p.origem);
        break;
      case "HabilidadeUsada":
        acao = "Usou habilidade";
        detalhe = `${p.habilidade}${p.cooldown != null ? ` (cd ${p.cooldown})` : " (permanente)"}`;
        break;
      case "HabilidadeReabilitada":
        acao = p.automatica ? "Reabilitou (auto)" : "Reabilitou";
        detalhe = String(p.habilidade ?? "");
        break;
      case "D20Rolado":
        acao = "Rolou d20";
        detalhe = `${p.valor}`;
        break;
      case "DanoAplicado":
        acao = "Dano";
        detalhe = `${p.valor} em ${p.pool}`;
        break;
      case "Recuperado":
        acao = "Recuperou";
        detalhe = `${p.valor} em ${p.pool}`;
        break;
      case "ProximoTurno":
        rodada = Number(p.rodada ?? rodada);
        turno = Number(p.indice ?? turno);
        acao = "Próximo turno";
        break;
      case "NovaRodada":
        rodada = Number(p.rodada ?? rodada);
        turno = 0;
        acao = "Nova rodada";
        break;
      case "Resetado":
        acao = "Resetou";
        rodada = 1;
        turno = 0;
        break;
      case "PecaMovida":
        if (p.de == null) {
          acao = "Entrou no mapa";
          detalhe = `em ${rotuloPosicao(p.para)}`;
        } else {
          acao = "Moveu";
          detalhe = `${rotuloPosicao(p.de)} → ${rotuloPosicao(p.para)}`;
        }
        break;
      case "PecaRemovida":
        acao = "Saiu do mapa";
        detalhe = rotuloPosicao(p.de);
        break;
    }
    linhas.push({ rodada, turno: turno + 1, quem: quemDe(p), acao, detalhe });
  }
  return linhas.reverse();
}

export default function HistoricoDialog({ aberto, onFechar, estado }: Props) {
  if (!aberto) return null;

  const nomes = new Map<number, string>(estado.combatentes.map((c) => [c.id, c.nome]));
  // completa nomes de quem já saiu, a partir dos eventos de entrada
  for (const ev of estado.historico) {
    const { tag, p } = parseEvento(ev);
    if (tag === "CombatenteAdicionado" && typeof p.id === "number" && typeof p.nome === "string") {
      if (!nomes.has(p.id)) nomes.set(p.id, p.nome);
    }
  }
  const linhas = montarLinhas(estado.historico, nomes);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-100">Histórico de ações</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-slate-500 hover:text-slate-200"
          >
            <IconFechar className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-2 py-2">
          {linhas.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nada aconteceu ainda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="px-2 py-1.5 text-left font-semibold">Rod.</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Turno</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Quem</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Ação</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b border-slate-800/50">
                    <td className="px-2 py-1 tabular-nums text-slate-500">{l.rodada}</td>
                    <td className="px-2 py-1 tabular-nums text-slate-500">{l.turno}</td>
                    <td className="px-2 py-1 text-slate-300">{l.quem}</td>
                    <td className="px-2 py-1 text-slate-200">{l.acao}</td>
                    <td className="px-2 py-1 text-slate-400">{l.detalhe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
