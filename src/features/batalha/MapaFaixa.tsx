import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  batalhaDefinirMapa,
  batalhaEstado,
  batalhaMoverPeca,
  batalhaPosicionarPeca,
  batalhaRemoverPeca,
  criarMapa,
  getMapa,
  listarMapas,
} from "../../lib/api";
import type { Combatente, EstadoBatalha } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { corDaCelula, inputVazio, rotuloColuna } from "../mapa/logica";
import { useCoresTerreno } from "../mapa/coresTerreno";

/** Chave do `dataTransfer` no drag do roster → drop no mapa (mesma nos dois lados). */
export const CHAVE_DRAG_PECA = "text/combatente-id";

/**
 * Id de mapa vindo de fora (estado da batalha ou `<select>`): só inteiro positivo
 * é id de verdade — a tabela `mapa` começa em 1. Qualquer outra coisa (0, negativo,
 * NaN, ausente) vira `null` e NUNCA chega no `get_mapa`.
 */
function idDeMapa(bruto: number | null | undefined): number | null {
  return typeof bruto === "number" && Number.isInteger(bruto) && bruto > 0 ? bruto : null;
}

/** Glifo da peça = posição na ordem de iniciativa: 1..9, depois A (10), B (11)… */
function glifoOrdem(indice: number): string {
  const n = indice + 1;
  return n <= 9 ? String(n) : String.fromCharCode(65 + (n - 10));
}

/** Cor do glifo por tipo do combatente (jogador = índigo, npc = vermelho). */
function corDoGlifo(tipo: Combatente["tipo"]): string {
  return tipo === "jogador" ? "text-indigo-300" : "text-rose-400";
}

/**
 * Faixa de mapa sempre visível no cockpit de Batalha: renderiza o mapa ATIVO
 * (`estado.mapa_id`, fonte única) com as peças (combatentes posicionados)
 * sobrepostas. Colocar = arrastar do roster; mover = clicar peça + clicar
 * destino; remover = tecla Delete ou botão. Edição de terreno segue na aba Mapa.
 */
export default function MapaFaixa() {
  const qc = useQueryClient();
  const toast = useToast();
  const cores = useCoresTerreno();

  const { data: estado } = useQuery({ queryKey: ["batalha"], queryFn: batalhaEstado });
  const { data: mapas } = useQuery({ queryKey: ["mapas"], queryFn: listarMapas });
  const [selId, setSelId] = useState<number | null>(null);
  // Célula sob o cursor durante o arrasto ("linha:coluna"). Cada célula tem só
  // ~16px de largura: sem destaque, mirar é adivinhação, e soltar um pixel fora
  // cai na linha (que não recebe drop) e parece que "não funcionou".
  const [celulaAlvo, setCelulaAlvo] = useState<string | null>(null);

  const mapaId = idDeMapa(estado?.mapa_id);
  const semMapas = mapas !== undefined && mapas.length === 0;
  // Só busca o mapa se ele ainda existe na lista (mapa excluído / id herdado inválido
  // não vira request). Enquanto a lista não chegou, confia no id e busca.
  const ativoExiste = mapaId !== null && (mapas === undefined || mapas.some((m) => m.id === mapaId));

  const { data: mapa, isError: mapaErro } = useQuery({
    queryKey: ["mapa", mapaId],
    queryFn: () => getMapa(mapaId as number),
    enabled: ativoExiste,
    retry: 1,
  });

  const mut = useMutation({
    mutationFn: (acao: () => Promise<EstadoBatalha>) => acao(),
    onSuccess: (novo) => qc.setQueryData(["batalha"], novo),
    onError: (e) => toast.erro(String(e)),
  });
  const roda = (acao: () => Promise<EstadoBatalha>) => mut.mutate(acao);
  // espelha `roda` pra chamar de dentro do efeito sem virar dependência dele
  const rodaRef = useRef(roda);
  rodaRef.current = roda;

  // Sem mapa ativo (app recém-aberto) ou apontando pra um que não existe mais
  // (excluído / id inválido): assume um mapa válido sozinho, em vez de deixar a
  // faixa em erro. Mesmo auto-pick que o editor (`useMapaEditor`) já fazia.
  useEffect(() => {
    if (!mapas || mapas.length === 0) return;
    if (mapaId !== null && mapas.some((m) => m.id === mapaId)) return;
    const alvo = mapas[0].id;
    rodaRef.current(() => batalhaDefinirMapa(alvo));
  }, [mapas, mapaId]);

  // Banco vazio: cria um mapa em branco e já o deixa ativo (terreno se edita na aba Mapa).
  const criar = useMutation({
    mutationFn: () => criarMapa(inputVazio()),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["mapas"] });
      rodaRef.current(() => batalhaDefinirMapa(m.id));
      toast.sucesso("Mapa criado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const combatentes = estado?.combatentes ?? [];

  // Índice de cada combatente na ordem de iniciativa (pro glifo) e mapa peça→célula.
  const indicePorId = new Map<number, number>();
  (estado?.ordem ?? []).forEach((id, i) => indicePorId.set(id, i));

  const pecaPorCelula = new Map<string, Combatente>();
  for (const c of combatentes) {
    if (c.posicao) pecaPorCelula.set(`${c.posicao[0]}:${c.posicao[1]}`, c);
  }

  const pecaSelecionada = combatentes.find((c) => c.id === selId && c.posicao) ?? null;

  // Lê o id AQUI, síncrono. `roda(...)` só roda a ação num microtask seguinte, e até
  // lá o React já restaurou o <select> pro valor controlado (o mapa anterior, ou ""
  // quando não havia nenhum) — ler `e.target.value` lá dentro dava `Number("") === 0`.
  function aoTrocarMapa(e: ChangeEvent<HTMLSelectElement>) {
    const id = idDeMapa(Number(e.target.value));
    if (id === null) return;
    roda(() => batalhaDefinirMapa(id));
  }

  function aoClicarCelula(linha: number, coluna: number) {
    const peca = pecaPorCelula.get(`${linha}:${coluna}`);
    if (peca) {
      setSelId((atual) => (atual === peca.id ? null : peca.id));
      return;
    }
    if (selId !== null) roda(() => batalhaMoverPeca(selId, linha, coluna));
  }

  function aoSoltar(e: DragEvent, linha: number, coluna: number) {
    e.preventDefault();
    setCelulaAlvo(null);
    // Tipo próprio primeiro; `text/plain` é a reserva pro caso do webview
    // entregar o drop sem os tipos customizados (ver `onDragStart` na
    // `BatalhaScreen`). Só aceita se o id for MESMO de um combatente em campo —
    // assim arrastar um texto qualquer pro mapa não vira peça.
    const bruto = e.dataTransfer.getData(CHAVE_DRAG_PECA) || e.dataTransfer.getData("text/plain");
    const id = Number(bruto);
    // Um `return` mudo aqui era o que fazia o arrastar "não fazer nada" sem
    // pista nenhuma. Falhar calado num handler de drop é pior que falhar alto.
    if (!bruto || !Number.isInteger(id)) {
      const tipos = Array.from(e.dataTransfer.types).join(", ") || "nenhum";
      toast.erro(`Soltou sem identificar a peça (tipos: ${tipos}).`);
      return;
    }
    if (!combatentes.some((c) => c.id === id)) {
      toast.erro(`Soltou algo que não é um combatente em batalha (id ${id}).`);
      return;
    }
    roda(() => batalhaPosicionarPeca(id, linha, coluna));
  }

  function removerSelecionada() {
    if (!pecaSelecionada) return;
    const id = pecaSelecionada.id;
    setSelId(null);
    roda(() => batalhaRemoverPeca(id));
  }

  function aoTeclar(e: KeyboardEvent) {
    if ((e.key === "Delete" || e.key === "Backspace") && pecaSelecionada) {
      e.preventDefault();
      removerSelecionada();
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mapa ativo</h2>
        <div className="flex items-center gap-2">
          {pecaSelecionada && (
            <button
              type="button"
              onClick={removerSelecionada}
              className="h-8 rounded-lg border border-rose-900/60 bg-rose-950/40 px-2 text-[11px] font-medium text-rose-300 hover:bg-rose-900/40"
            >
              tirar do mapa
            </button>
          )}
          {semMapas ? (
            <button
              type="button"
              onClick={() => criar.mutate()}
              disabled={criar.isPending}
              className="h-8 rounded-lg border border-indigo-900/60 bg-indigo-500/10 px-2 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:pointer-events-none disabled:opacity-40"
            >
              {criar.isPending ? "criando…" : "+ novo mapa"}
            </button>
          ) : (
            <select
              value={mapaId === null ? "" : String(mapaId)}
              onChange={aoTrocarMapa}
              className="h-8 max-w-[220px] appearance-none rounded-lg border border-slate-800 bg-slate-950/50 px-2 text-xs text-slate-100 outline-none focus:border-indigo-500/50"
            >
              {mapaId === null && <option value="">escolha um mapa…</option>}
              {(mapas ?? []).map((m) => (
                <option key={m.id} value={String(m.id)} className="bg-slate-900 text-slate-100">
                  {m.titulo || "(sem título)"}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {semMapas || mapaId === null ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {semMapas
            ? 'Nenhum mapa criado ainda — clique em "+ novo mapa".'
            : "Nenhum mapa ativo — escolha um."}
        </p>
      ) : mapa ? (
        <>
          <div tabIndex={0} onKeyDown={aoTeclar} className="overflow-x-auto outline-none">
            <div className="inline-block rounded-lg bg-slate-950/60 p-3 font-mono text-xs leading-tight">
              <div className="flex">
                <span className="w-5" />
                {Array.from({ length: mapa.colunas }, (_, c) => (
                  <span key={c} className="w-4 text-center text-slate-500">
                    {rotuloColuna(c)}
                  </span>
                ))}
              </div>
              {mapa.grade.map((linha, r) => (
                <div key={r} className="flex">
                  <span className="w-5 pr-1 text-right text-slate-500">{r + 1}</span>
                  {Array.from({ length: mapa.colunas }, (_, c) => {
                    const ch = [...linha][c] ?? "-";
                    const peca = pecaPorCelula.get(`${r}:${c}`);
                    const selecionada = peca != null && peca.id === selId;
                    const idx = peca ? indicePorId.get(peca.id) : undefined;
                    return (
                      <span
                        key={c}
                        onClick={() => aoClicarCelula(r, c)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setCelulaAlvo(`${r}:${c}`);
                        }}
                        onDragLeave={() => setCelulaAlvo((a) => (a === `${r}:${c}` ? null : a))}
                        onDrop={(e) => aoSoltar(e, r, c)}
                        title={peca ? peca.nome : undefined}
                        className={`w-4 cursor-pointer text-center ${
                          peca ? `font-bold ${corDoGlifo(peca.tipo)}` : corDaCelula(ch, cores)
                        } ${
                          celulaAlvo === `${r}:${c}`
                            ? "rounded-sm bg-emerald-500/40 ring-1 ring-inset ring-emerald-300"
                            : selecionada
                              ? "rounded-sm bg-slate-700 ring-1 ring-inset ring-indigo-400"
                              : ""
                        }`}
                      >
                        {peca ? (idx !== undefined ? glifoOrdem(idx) : "?") : ch}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Arraste do roster pra colocar · clique numa peça e depois numa célula pra mover · Delete
            tira do mapa.
          </p>
        </>
      ) : mapaErro ? (
        <p className="py-6 text-center text-sm text-slate-500">
          Não consegui carregar o mapa ativo (id {mapaId}). Escolha outro no seletor acima.
        </p>
      ) : (
        <p className="py-6 text-center text-sm text-slate-500">Carregando mapa…</p>
      )}
    </section>
  );
}
