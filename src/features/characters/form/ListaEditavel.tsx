import type { ReactNode } from "react";
import { IconLixeira, IconMais } from "../../../components/icons";
import { BOTAO_LIXEIRA, BOTAO_SECUNDARIO } from "./Campos";

/**
 * Editor genérico de lista: cada item vira um card com botão de remover, e o
 * rodapé tem "＋ Adicionar" (+ um slot opcional `acaoExtra`, ex.: catálogo).
 * O `render` recebe o item e um `atualizar(patch)` imutável.
 */
export default function ListaEditavel<T extends { uid?: string }>({
  itens,
  onChange,
  criarVazio,
  render,
  textoAdicionar = "Adicionar",
  textoVazio = "Nenhum item ainda.",
  acaoExtra,
}: {
  itens: T[];
  onChange: (itens: T[]) => void;
  criarVazio: () => T;
  render: (item: T, atualizar: (patch: Partial<T>) => void) => ReactNode;
  textoAdicionar?: string;
  textoVazio?: string;
  acaoExtra?: ReactNode;
}) {
  const atualizarItem = (indice: number, patch: Partial<T>) =>
    onChange(itens.map((it, i) => (i === indice ? ({ ...it, ...patch } as T) : it)));
  const remover = (indice: number) => onChange(itens.filter((_, i) => i !== indice));
  const adicionar = () => onChange([...itens, criarVazio()]);

  return (
    <div className="space-y-3">
      {itens.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-800 py-6 text-center text-sm text-slate-500">
          {textoVazio}
        </p>
      )}

      {itens.map((item, i) => (
        <div
          key={item.uid ?? i}
          className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            {render(item, (patch) => atualizarItem(i, patch))}
          </div>
          <button
            type="button"
            onClick={() => remover(i)}
            aria-label="Remover item"
            className={BOTAO_LIXEIRA}
          >
            <IconLixeira className="size-4" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={adicionar} className={BOTAO_SECUNDARIO}>
          <IconMais className="size-4" />
          {textoAdicionar}
        </button>
        {acaoExtra}
      </div>
    </div>
  );
}
