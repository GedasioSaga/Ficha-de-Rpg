import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarEtiquetas } from "../../../lib/api";
import { IconFechar, IconMais } from "../../../components/icons";
import { coresPorNome, estiloEtiqueta } from "../etiquetas";
import { CARTAO_FORM } from "./Campos";

interface Props {
  valor: string[];
  onChange: (etiquetas: string[]) => void;
}

/**
 * Editor de etiquetas do NPC. Digitar um nome que ainda não existe cria a
 * etiqueta no save (o backend faz upsert por nome), então não precisa de uma
 * tela separada de "gerenciar etiquetas" pra começar a usar.
 *
 * Quem decide se aparece é o `FichaForm` — jogador não recebe etiqueta.
 */
export default function EtiquetasEditor({ valor, onChange }: Props) {
  const [rascunho, setRascunho] = useState("");
  const { data: existentes } = useQuery({
    queryKey: ["etiquetas"],
    queryFn: listarEtiquetas,
    staleTime: 30_000,
  });

  const cores = useMemo(() => coresPorNome(existentes ?? []), [existentes]);
  const sugestoes = useMemo(
    () => (existentes ?? []).filter((e) => !valor.includes(e.nome)),
    [existentes, valor],
  );

  function adicionar(nome: string) {
    const n = nome.trim();
    // Comparação sem caixa: o banco tem UNIQUE COLLATE NOCASE, então "marinha"
    // e "Marinha" viram a mesma etiqueta — evitar o duplicado já aqui.
    if (!n || valor.some((v) => v.toLowerCase() === n.toLowerCase())) {
      setRascunho("");
      return;
    }
    onChange([...valor, n]);
    setRascunho("");
  }

  return (
    <div className={CARTAO_FORM}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Etiquetas
      </h2>

      {valor.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {valor.map((nome) => {
            const estilo = estiloEtiqueta(cores.get(nome));
            return (
              <span
                key={nome}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border bg-slate-900 px-2.5 text-xs font-medium ${estilo.chip}`}
              >
                <span className={`size-1.5 rounded-full ${estilo.ponto}`} />
                {nome}
                <button
                  type="button"
                  onClick={() => onChange(valor.filter((v) => v !== nome))}
                  aria-label={`Remover etiqueta ${nome}`}
                  className="text-slate-500 transition-colors hover:text-rose-300"
                >
                  <IconFechar className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          Sem etiqueta. Agrupa a lista de Disponíveis na Batalha.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          list="etiquetas-existentes"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // Enter aqui não pode salvar a ficha inteira
              adicionar(rascunho);
            }
          }}
          placeholder="Marinha, Arco Alabasta…"
          className="h-9 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
        <datalist id="etiquetas-existentes">
          {sugestoes.map((e) => (
            <option key={e.id} value={e.nome} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => adicionar(rascunho)}
          disabled={rascunho.trim() === ""}
          aria-label="Adicionar etiqueta"
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconMais className="size-4" />
        </button>
      </div>

      {sugestoes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sugestoes.map((e) => {
            const estilo = estiloEtiqueta(e.cor);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => adicionar(e.nome)}
                className={`inline-flex h-6 items-center gap-1 rounded-full border bg-slate-900 px-2 text-[11px] font-medium transition-colors hover:bg-slate-800 ${estilo.chip}`}
              >
                <IconMais className="size-3 opacity-60" />
                {e.nome}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
