// src/features/configuracoes/SeletorModelo.tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configGet, configSet } from "../../lib/api";
import { CONFIG_MODELO, MODELO_PADRAO, MODELOS_GEMINI } from "../../lib/gemini";
import { useToast } from "../../components/Toast";

/** USD por 1M de tokens, sempre com 2 casas. */
function usd(valor: number): string {
  return `$${valor.toFixed(2)}`;
}

const ID_MAIS_BARATO = MODELOS_GEMINI[0].id;

export default function SeletorModelo() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: salvo } = useQuery({
    queryKey: ["config", CONFIG_MODELO],
    queryFn: () => configGet(CONFIG_MODELO),
  });

  const escolherMut = useMutation({
    mutationFn: (id: string) => configSet(CONFIG_MODELO, id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["config"] });
      const modelo = MODELOS_GEMINI.find((m) => m.id === id);
      toast.sucesso(`Modelo: ${modelo?.rotulo ?? id}.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  // Enquanto grava, mostra já a opção clicada — senão o marcador só pula depois
  // do banco responder. Id fora do catálogo (gravado por versão antiga) cai no
  // padrão, o mesmo que o gerarConteudo usa: a tela nunca mente sobre o modelo.
  const conhecido = MODELOS_GEMINI.some((m) => m.id === salvo);
  const selecionado = escolherMut.isPending
    ? escolherMut.variables
    : conhecido
      ? (salvo as string)
      : MODELO_PADRAO;
  const rotuloAtual = MODELOS_GEMINI.find((m) => m.id === selecionado)?.rotulo;

  return (
    <section
      aria-busy={escolherMut.isPending}
      className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Modelo</h2>
        <span className="text-xs text-slate-300">em uso: {rotuloAtual}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Preço em USD por 1 milhão de tokens. Todos leem o retrato do personagem; o mais
        barato resolve o dia a dia, e raciocínio pesado (simulação longa) sai melhor num
        modelo maior. Lista ordenada pelo preço de saída, que é o que pesa aqui.
      </p>

      <div className="mt-3 space-y-2">
        {MODELOS_GEMINI.map((m) => {
          const ativo = m.id === selecionado;
          return (
            <label
              key={m.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-indigo-500/60 ${
                ativo
                  ? "border-indigo-500/60 bg-indigo-500/10"
                  : "border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              <input
                type="radio"
                name="modelo-gemini"
                className="sr-only"
                checked={ativo}
                onChange={() => escolherMut.mutate(m.id)}
              />
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                  ativo ? "border-indigo-400" : "border-slate-600"
                }`}
              >
                {ativo && <span className="size-2 rounded-full bg-indigo-400" />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-medium ${ativo ? "text-indigo-100" : "text-slate-200"}`}
                  >
                    {m.rotulo}
                  </span>
                  {m.id === ID_MAIS_BARATO && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                      mais barato
                    </span>
                  )}
                  {!m.freeTier && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                      sem free tier
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{m.nota}</span>
              </span>

              {/* Saída em destaque: é a chave de ordenação da lista. */}
              <span className="grid shrink-0 grid-cols-[auto_auto] gap-x-1 font-mono text-[11px] leading-tight text-slate-500">
                <span className="text-right">{usd(m.precoEntrada)}</span>
                <span>entrada</span>
                <span className="text-right font-medium text-slate-300">
                  {usd(m.precoSaida)}
                </span>
                <span className="font-medium text-slate-300">saída</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
