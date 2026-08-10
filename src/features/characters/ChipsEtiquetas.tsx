import type { Etiqueta } from "../../lib/types";
import { SEM_ETIQUETA, estiloEtiqueta, rotuloEtiqueta } from "./etiquetas";

interface Props {
  etiquetas: Etiqueta[];
  /** Nomes marcados. Marcar mais de um filtra por **E** (ver filtrarPorEtiquetas). */
  selecionadas: string[];
  onChange: (selecionadas: string[]) => void;
  /** Inclui a chip "Sem etiqueta" (NPC nenhum grupo). */
  comSemEtiqueta?: boolean;
  /** Mostra a contagem de uso dentro da chip. */
  comTotal?: boolean;
}

/**
 * Linha de chips de filtro por etiqueta, compartilhada entre a galeria de
 * Fichas e o painel "Disponíveis" da Batalha.
 */
export default function ChipsEtiquetas({
  etiquetas,
  selecionadas,
  onChange,
  comSemEtiqueta = true,
  comTotal = false,
}: Props) {
  if (etiquetas.length === 0) return null;

  const alternar = (nome: string) =>
    onChange(
      selecionadas.includes(nome)
        ? selecionadas.filter((n) => n !== nome)
        : [...selecionadas, nome],
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {etiquetas.map((e) => (
        <Chip
          key={e.id}
          rotulo={e.nome}
          total={comTotal ? e.total : undefined}
          cor={e.cor}
          ativo={selecionadas.includes(e.nome)}
          onClick={() => alternar(e.nome)}
        />
      ))}
      {comSemEtiqueta && (
        <Chip
          rotulo={rotuloEtiqueta(SEM_ETIQUETA)}
          cor="slate"
          ativo={selecionadas.includes(SEM_ETIQUETA)}
          onClick={() => alternar(SEM_ETIQUETA)}
        />
      )}
      {selecionadas.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="ml-1 text-[11px] font-medium text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline"
        >
          limpar
        </button>
      )}
    </div>
  );
}

function Chip({
  rotulo,
  cor,
  ativo,
  total,
  onClick,
}: {
  rotulo: string;
  cor: Etiqueta["cor"];
  ativo: boolean;
  total?: number;
  onClick: () => void;
}) {
  const estilo = estiloEtiqueta(cor);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors active:scale-[0.98] ${
        ativo ? estilo.ativo : `${estilo.chip} bg-slate-900 hover:bg-slate-800`
      }`}
    >
      <span className={`size-1.5 rounded-full ${ativo ? "bg-white/80" : estilo.ponto}`} />
      {rotulo}
      {total != null && <span className="tabular-nums opacity-60">{total}</span>}
    </button>
  );
}
