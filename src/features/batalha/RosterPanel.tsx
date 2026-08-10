import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { batalhaAdicionar, listarEtiquetas } from "../../lib/api";
import type { Combatente, EstadoBatalha, PersonagemResumo } from "../../lib/types";
import { IconBusca, IconMais } from "../../components/icons";
import ChipsEtiquetas from "../characters/ChipsEtiquetas";
import {
  agruparPorEtiqueta,
  coresPorNome,
  estiloEtiqueta,
  filtrarPorEtiquetas,
  rotuloEtiqueta,
} from "../characters/etiquetas";

interface Props {
  personagens: PersonagemResumo[];
  /** Combatentes já escalados — vira o "×N" ao lado de quem já está na luta. */
  combatentes: Combatente[];
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

/**
 * Painel "Disponíveis": só a parte de pôr personagens na luta. Desde o pedido
 * do usuário de 2026-08-09 ele vive DENTRO do `RosterDialog` (botão
 * "+ Escalar" no painel "Em batalha") — escalar é rajada de começo de cena, e
 * como painel fixo ele gastava uma coluna do rodapé o resto da sessão.
 *
 * Jogadores ficam numa lista plana no topo (poucos e sempre os mesmos). Os
 * NPCs, que são muitos, saem agrupados por etiqueta, com chips pra filtrar.
 */
export default function RosterPanel({ personagens, combatentes, roda }: Props) {
  const [turnos, setTurnos] = useState(1);
  const [busca, setBusca] = useState("");
  const [etiquetasFiltro, setEtiquetasFiltro] = useState<string[]>([]);
  const [fechados, setFechados] = useState<string[]>([]);

  const { data: etiquetas } = useQuery({
    queryKey: ["etiquetas"],
    queryFn: listarEtiquetas,
    staleTime: 30_000,
  });
  const cores = useMemo(() => coresPorNome(etiquetas ?? []), [etiquetas]);

  /* Quantos bonecos de cada personagem já estão na luta. Combatente sem
     `personagem_ref` (avulso/preset antigo) não conta pra ninguém. */
  const escalados = useMemo(() => {
    const contagem = new Map<number, number>();
    for (const c of combatentes) {
      if (c.personagem_ref == null) continue;
      contagem.set(c.personagem_ref, (contagem.get(c.personagem_ref) ?? 0) + 1);
    }
    return contagem;
  }, [combatentes]);

  const termo = busca.trim().toLowerCase();
  const casaBusca = (p: PersonagemResumo) =>
    !termo || p.nome.toLowerCase().includes(termo);

  const jogadores = personagens.filter((p) => p.tipo === "jogador" && casaBusca(p));
  const grupos = useMemo(() => {
    const npcs = personagens.filter((p) => p.tipo === "npc" && casaBusca(p));
    return agruparPorEtiqueta(filtrarPorEtiquetas(npcs, etiquetasFiltro));
    // `casaBusca` depende de `termo`; listar `termo` basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personagens, etiquetasFiltro, termo]);

  function adicionar(pid: number) {
    roda(() => batalhaAdicionar(pid, Math.max(0, turnos - 1)));
  }

  const alternarGrupo = (nome: string) =>
    setFechados((f) => (f.includes(nome) ? f.filter((n) => n !== nome) : [...f, nome]));

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Disponíveis
        </h2>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          turnos
          <input
            type="number"
            min={1}
            max={10}
            value={turnos}
            onChange={(e) => setTurnos(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            className="h-7 w-12 rounded-md border border-slate-800 bg-slate-950 px-1.5 text-center text-sm text-slate-100 outline-none transition-colors duration-150 ease-out focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
        </label>
      </div>

      <div className="relative mb-2">
        <IconBusca className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar…"
          className="h-8 w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-2 text-sm text-slate-100 outline-none transition-colors duration-150 ease-out placeholder:text-slate-500 focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
      </div>

      {(etiquetas?.length ?? 0) > 0 && (
        <div className="mb-2">
          <ChipsEtiquetas
            etiquetas={etiquetas ?? []}
            selecionadas={etiquetasFiltro}
            onChange={setEtiquetasFiltro}
          />
        </div>
      )}

      <ListaDisponivel titulo="Jogadores" itens={jogadores} escalados={escalados} onAdd={adicionar} />

      {grupos.map(({ etiqueta, itens }) => (
        <ListaDisponivel
          key={etiqueta}
          titulo={rotuloEtiqueta(etiqueta)}
          itens={itens}
          escalados={escalados}
          onAdd={adicionar}
          cor={estiloEtiqueta(cores.get(etiqueta)).ponto}
          fechado={fechados.includes(etiqueta)}
          onAlternar={() => alternarGrupo(etiqueta)}
        />
      ))}

      {jogadores.length === 0 && grupos.length === 0 && (
        <div className="px-1 py-3">
          <p className="text-xs text-slate-500">Nada aqui com esse filtro.</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Ajuste a busca ou limpe as etiquetas selecionadas.
          </p>
        </div>
      )}
    </div>
  );
}

function ListaDisponivel({
  titulo,
  itens,
  escalados,
  onAdd,
  cor,
  fechado = false,
  onAlternar,
}: {
  titulo: string;
  itens: PersonagemResumo[];
  /** personagem id → quantos bonecos dele já estão na luta. */
  escalados: ReadonlyMap<number, number>;
  onAdd: (id: number) => void;
  /** Classe de cor do pontinho do grupo (etiqueta). Ausente = sem ponto. */
  cor?: string;
  fechado?: boolean;
  /** Ausente = grupo fixo, sem dobrar (é o caso de "Jogadores"). */
  onAlternar?: () => void;
}) {
  if (itens.length === 0) return null;

  const cabecalho = (
    <>
      {cor && <span className={`size-1.5 shrink-0 rounded-full ${cor}`} />}
      <span className="truncate">{titulo}</span>
      <span className="tabular-nums text-slate-700">{itens.length}</span>
    </>
  );

  return (
    <div className="mb-2 last:mb-0">
      {onAlternar ? (
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={!fechado}
          className="mb-1 flex w-full items-center gap-1.5 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 outline-none transition-colors duration-150 ease-out hover:text-slate-300 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span
            className={`text-slate-600 transition-transform ${fechado ? "" : "rotate-90"}`}
            aria-hidden="true"
          >
            ▸
          </span>
          {cabecalho}
        </button>
      ) : (
        <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
          {cabecalho}
        </h3>
      )}

      {/* Sem teto de altura: o painel vive dentro do diálogo "Escalar", cujo
          corpo já rola — um teto aqui criava uma 2ª scrollbar em miniatura
          dentro da lista de jogadores. */}
      {!fechado && (
        <ul className="space-y-0.5">
          {itens.map((p) => {
            const na_luta = escalados.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onAdd(p.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-300 outline-none transition-colors duration-150 ease-out hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <IconMais className="size-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{p.nome}</span>
                  {na_luta > 0 && (
                    <span
                      title={`${na_luta} já em batalha`}
                      className="ml-auto shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-px text-[11px] font-medium tabular-nums text-indigo-300"
                    >
                      ×{na_luta}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
