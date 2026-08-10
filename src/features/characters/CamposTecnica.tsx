import type { HabilidadeDto } from "../../lib/types";

/* Leitura dos campos de uma técnica. Existe porque a ficha e o cockpit da Batalha
   mostram exatamente a mesma coisa — os campos preenchidos na ordem canônica do
   sistema e depois os personalizados —, e ordem/omissão de vazio têm que bater
   nos dois lugares: divergir aqui faria a mesma técnica parecer duas. */

/**
 * Ordem canônica do sistema (Ação, Efeito, Custo, Tempo, Dano) + personalizados.
 * Campo sem VALOR não entra; campo só com valor entra, porque o editor deixa criar
 * campo personalizado sem nome e o backend persiste — sumir na exibição seria o
 * único ponto onde o que se digita não aparece.
 */
export function camposDaTecnica(h: HabilidadeDto): [string, string][] {
  const fixos: [string, string][] = [
    ["Ação", h.acao],
    ["Efeito", h.efeito],
    ["Custo", h.custo],
    ["Tempo", h.tempo],
    ["Dano", h.dano],
  ];
  const extras: [string, string][] = (h.campos_extras ?? []).map((c) => [c.nome, c.valor]);
  return [...fixos, ...extras]
    .map(([rotulo, valor]): [string, string] => [(rotulo ?? "").trim(), (valor ?? "").trim()])
    .filter(([, valor]) => valor !== "");
}

/** Resumo de uma linha para telas densas: só o que identifica a técnica de relance. */
export function resumoTecnica(h: HabilidadeDto): string[] {
  return [h.acao, h.custo, h.dano].map((v) => (v ?? "").trim()).filter((v) => v !== "");
}

/**
 * Lista "Rótulo: valor" com o rótulo em destaque, como o dono lê no Discord.
 * `denso` aperta o espaçamento para os cartões de transformação.
 */
export default function CamposTecnica({ h, denso = false }: { h: HabilidadeDto; denso?: boolean }) {
  const campos = camposDaTecnica(h);
  if (campos.length === 0) return null;

  return (
    <dl
      className={`grid grid-cols-[auto_1fr] gap-x-2 ${
        denso ? "mt-1.5 gap-y-0.5 text-[13px]" : "mt-2.5 gap-y-1 text-sm"
      }`}
    >
      {campos.map(([rotulo, valor], i) => (
        <div key={`${rotulo}-${i}`} className="contents">
          <dt className="font-medium text-slate-400">{rotulo ? `${rotulo}:` : "—"}</dt>
          <dd className="min-w-0 break-words text-slate-300">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
