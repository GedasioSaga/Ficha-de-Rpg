import { useQueries, useQueryClient } from "@tanstack/react-query";
import { getPersonagem } from "../../lib/api";
import type { PersonagemCompleto, PersonagemResumo } from "../../lib/types";
import { extremosLinha, larguraBarra, somaAtributos } from "./logica";

/** Linha genérica: rótulo + um valor por personagem, com destaque e barra opcional. */
function Linha({
  rotulo,
  valores,
  sufixos,
  comBarra,
}: {
  rotulo: string;
  valores: number[];
  /** Texto pequeno ao lado do valor (ex.: rank) — mesmo índice das colunas. */
  sufixos?: string[];
  comBarra?: boolean;
}) {
  const ext = extremosLinha(valores);
  const max = comBarra ? Math.max(...valores, 0) : 0;
  return (
    <tr className="border-t border-slate-800/60">
      <th
        scope="row"
        className="py-2 pr-4 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
      >
        {rotulo}
      </th>
      {valores.map((v, i) => (
        <td key={i} className="px-3 py-2 align-middle">
          <div
            className={`text-sm tabular-nums ${
              ext.maiores.has(i)
                ? "font-semibold text-emerald-300"
                : ext.menores.has(i)
                  ? "text-rose-400"
                  : "text-slate-200"
            }`}
          >
            {v}
            {sufixos?.[i] && (
              <span className="ml-1.5 text-[10px] text-slate-500">{sufixos[i]}</span>
            )}
          </div>
          {comBarra && (
            <div className="mt-1 h-1 w-full rounded bg-slate-800">
              <div
                className="h-1 rounded bg-indigo-500"
                style={{ width: `${larguraBarra(v, max)}%` }}
              />
            </div>
          )}
        </td>
      ))}
    </tr>
  );
}

export default function TabelaComparacao({ ids }: { ids: number[] }) {
  const consultas = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["personagem", id],
      queryFn: () => getPersonagem(id),
    })),
  });

  const qc = useQueryClient();
  const idxErro = consultas.findIndex((c) => c.error);
  if (idxErro !== -1) {
    const idFalho = ids[idxErro];
    const resumo = qc
      .getQueryData<PersonagemResumo[]>(["personagens", null])
      ?.find((p) => p.id === idFalho);
    return (
      <p className="text-sm text-rose-400">
        Erro ao carregar a ficha de {resumo?.nome ?? `#${idFalho}`}:{" "}
        {String(consultas[idxErro].error)} — desmarque o personagem pra continuar.
      </p>
    );
  }
  if (consultas.some((c) => !c.data)) {
    return <p className="text-sm text-slate-500">Carregando fichas…</p>;
  }

  const fichas = consultas.map((c) => c.data as PersonagemCompleto);
  // Ordem das linhas de atributo = ordem do primeiro personagem (backend é consistente).
  const nomesAtributos = fichas[0].atributos.map((a) => a.nome);
  const valorDe = (f: PersonagemCompleto, nome: string) =>
    f.atributos.find((a) => a.nome === nome);

  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr>
            <th scope="col" className="pb-2 pr-4" />
            {fichas.map((f) => (
              <th
                key={f.id}
                scope="col"
                className="px-3 pb-2 text-left text-sm font-semibold text-slate-100"
              >
                {f.nome}
                <span className="ml-1.5 text-[10px] font-normal uppercase text-slate-500">
                  {f.tipo === "npc" ? "NPC" : "PJ"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nomesAtributos.map((nome) => (
            <Linha
              key={nome}
              rotulo={nome}
              valores={fichas.map((f) => valorDe(f, nome)?.valor ?? 0)}
              sufixos={fichas.map((f) => {
                const a = valorDe(f, nome);
                return a ? `R${a.rank}` : "";
              })}
              comBarra
            />
          ))}
          <Linha
            rotulo="Total atributos"
            valores={fichas.map((f) => somaAtributos(f.atributos))}
          />
          <Linha rotulo="HP" valores={fichas.map((f) => f.hp)} comBarra />
          <Linha rotulo="SP" valores={fichas.map((f) => f.sp)} comBarra />
          <Linha rotulo="Escudo" valores={fichas.map((f) => f.escudo)} />
          <Linha
            rotulo="Habilidades"
            valores={fichas.map((f) => f.habilidades.length)}
          />
          <Linha
            rotulo="Transformações"
            valores={fichas.map((f) => f.transformacoes.length)}
          />
          <Linha rotulo="Perícias" valores={fichas.map((f) => f.pericias.length)} />
          <Linha rotulo="Vantagens" valores={fichas.map((f) => f.vantagens.length)} />
          <Linha
            rotulo="Desvantagens"
            valores={fichas.map((f) => f.desvantagens.length)}
          />
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-slate-600">
        Verde = melhor da linha · vermelho = pior · R = rank (0–13) · total é soma
        bruta, não métrica oficial.
      </p>
    </section>
  );
}
