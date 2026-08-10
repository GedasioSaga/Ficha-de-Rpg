// src/features/configuracoes/ChavesIA.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configGet, configSet } from "../../lib/api";
import { CONFIG_ATIVA, CONFIG_CHAVES, parseChaves } from "../../lib/gemini";
import { useToast } from "../../components/Toast";

/**
 * Vírgula, espaço ou quebra de linha — tudo vira o CSV que o gemini.ts lê.
 * Repetida não entra duas vezes: o failover gastaria uma tentativa recolando a
 * chave que acabou de estourar a cota.
 */
function normalizar(bruto: string): string {
  return Array.from(
    new Set(
      bruto
        .split(/[\s,]+/)
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ).join(",");
}

export default function ChavesIA() {
  // Começa vazio e nunca recebe o que está salvo: o campo só serve pra gravar,
  // as chaves não voltam pra tela.
  const [texto, setTexto] = useState("");
  const toast = useToast();
  const qc = useQueryClient();

  /**
   * A chave inteira nunca volta pra tela — só um resumo mascarado
   * (`AIzaSyBd…LFkyg`). Sem nenhum eco, quem reabre o app vê o campo vazio e
   * conclui que não salvou; a máscara é a prova visual de que salvou.
   */
  const { data: salvas, isPending: carregandoChaves } = useQuery({
    queryKey: ["config", CONFIG_CHAVES, "mascaras"],
    queryFn: async () =>
      parseChaves(await configGet(CONFIG_CHAVES)).map((c) =>
        c.length <= 14 ? `${c.slice(0, 4)}…` : `${c.slice(0, 8)}…${c.slice(-5)}`,
      ),
  });
  const total = salvas?.length ?? 0;
  const { data: ativa } = useQuery({
    queryKey: ["config", CONFIG_ATIVA],
    queryFn: () => configGet(CONFIG_ATIVA),
  });

  // Sem argumento: o texto vem do estado, então a mutation não guarda as chaves
  // coladas em `variables` depois de gravar.
  const salvarMut = useMutation({
    mutationFn: async () => {
      const limpo = normalizar(texto);
      if (!limpo) throw new Error("Cole ao menos uma chave.");
      await configSet(CONFIG_CHAVES, limpo);
      // Lista nova: volta pra primeira chave em vez de manter um índice que
      // agora aponta pra outra chave.
      await configSet(CONFIG_ATIVA, "0");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      setTexto("");
      toast.sucesso("Chaves salvas.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Chaves da IA
        </h2>
        {carregandoChaves ? (
          <span className="text-xs text-slate-600">carregando…</span>
        ) : total > 0 ? (
          <span className="text-xs text-slate-300">
            {total} configurada{total > 1 ? "s" : ""} · ativa #{Number(ativa ?? "0") + 1}
          </span>
        ) : (
          <span className="text-xs text-amber-400">nenhuma configurada</span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Chaves do Google AI Studio. Se colar mais de uma, o app troca sozinho quando
        a cota de uma estourar.
      </p>

      {total > 0 && (
        <ul className="mt-3 space-y-1">
          {salvas?.map((mascara, i) => (
            <li
              key={mascara}
              className={`flex items-center gap-2 font-mono text-xs ${
                i === Number(ativa ?? "0") ? "text-emerald-300" : "text-slate-500"
              }`}
            >
              <span className="w-4 shrink-0 text-right text-slate-600">{i + 1}.</span>
              {mascara}
              {i === Number(ativa ?? "0") && (
                <span className="font-sans text-[10px] uppercase tracking-wide">em uso</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder="Cole as chaves separadas por vírgula, espaço ou quebra de linha…"
        className="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
      />
      <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
        Ficam salvas no banco local e sobrevivem a reiniciar o app — o campo acima
        começa vazio de propósito e salvar substitui a lista inteira. Cota do Gemini
        é por projeto Google, então o failover pressupõe chaves de projetos distintos;
        rotacionar várias chaves free pra estender cota vai contra os ToS do Google
        (risco: banimento).
      </p>
      <button
        type="button"
        disabled={salvarMut.isPending || !texto.trim()}
        onClick={() => salvarMut.mutate()}
        className="mt-3 rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
      >
        {salvarMut.isPending
          ? "Salvando…"
          : total > 0
            ? "Substituir chaves"
            : "Salvar chaves"}
      </button>
    </section>
  );
}
