import { useQuery } from "@tanstack/react-query";
import { batalhaReverter, batalhaTransformar, retratoDataUrl } from "../../lib/api";
import type { Combatente, EstadoBatalha, TransformacaoDto } from "../../lib/types";
import { gradienteDoNome, iniciais } from "../characters/retrato";
import { transformacaoAtiva } from "./logica";

interface Props {
  combatente: Combatente;
  retratoBase: string | null;
  transformacoes: TransformacaoDto[];
  roda: (acao: () => Promise<EstadoBatalha>) => void;
}

/** Área "Formas": forma base (reverte) + tira de transformações (aplica). */
export default function FormasTransformacao({
  combatente: c,
  retratoBase,
  transformacoes,
  roda,
}: Props) {
  const ativa = transformacaoAtiva(c);

  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Formas
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Thumb
          nome="Forma Base"
          retrato={retratoBase}
          ativo={ativa === null}
          onClick={() => roda(() => batalhaReverter(c.id))}
        />
        {transformacoes.map((t) => (
          <Thumb
            key={t.nome}
            nome={t.nome}
            retrato={t.retrato}
            ativo={ativa === t.nome}
            onClick={() => roda(() => batalhaTransformar(c.id, t.nome))}
          />
        ))}
      </div>
    </div>
  );
}

function Thumb({
  nome,
  retrato,
  ativo,
  onClick,
}: {
  nome: string;
  retrato: string | null;
  ativo: boolean;
  onClick: () => void;
}) {
  const { data: src } = useQuery({
    queryKey: ["retrato", retrato],
    queryFn: () => retratoDataUrl(retrato!),
    enabled: !!retrato,
    staleTime: Infinity,
  });
  const temImagem = !!retrato && !!src;

  return (
    <button
      type="button"
      onClick={onClick}
      title={nome}
      className={`shrink-0 rounded-lg border-2 p-0.5 transition-colors ${
        ativo ? "border-emerald-500/70" : "border-transparent hover:border-slate-700"
      }`}
    >
      <div className="size-16 overflow-hidden rounded-md border border-slate-800 bg-slate-800">
        {temImagem ? (
          <img src={src} alt={nome} className="size-full object-cover" />
        ) : (
          <div
            className="flex size-full items-center justify-center"
            style={{ backgroundImage: gradienteDoNome(nome) }}
          >
            <span className="text-base font-bold text-white/90">{iniciais(nome)}</span>
          </div>
        )}
      </div>
      <span className="mt-1 block max-w-16 truncate text-center text-[10px] text-slate-400">
        {nome}
      </span>
    </button>
  );
}
