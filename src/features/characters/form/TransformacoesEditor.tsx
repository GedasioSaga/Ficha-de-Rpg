import type { HabilidadeDto, ModificadorDto, TransformacaoInput } from "../../../lib/types";
import { IconLixeira, IconMais } from "../../../components/icons";
import {
  BOTAO_LIXEIRA,
  BOTAO_SECUNDARIO,
  CampoNumero,
  CampoTexto,
  SelectAtributo,
  Textarea,
} from "./Campos";
import { novaChave } from "./chave";
import HabilidadesEditor from "./HabilidadesEditor";
import HerancaPicker, { type FonteHeranca } from "./HerancaPicker";
import RetratoUpload from "./RetratoUpload";

/** Fábrica (não constante): cada transformação nova ganha objeto e arrays próprios. */
const criarTransformacao = (): TransformacaoInput => ({
  nome: "",
  descricao: "",
  retrato: { modo: "nenhum" },
  modificadores: [],
  habilidades: [],
  uid: novaChave(),
});

/**
 * Cópia independente da técnica herdada: `uid` novo (senão a herdada e a original
 * disputam a mesma chave de render/accordion) e `campos_extras` clonados pelo
 * mesmo motivo. Depois de herdada, editar uma não toca a outra — herança é
 * cópia, decisão de 2026-08-10.
 */
const clonarHabilidade = (h: HabilidadeDto): HabilidadeDto => ({
  ...h,
  uid: novaChave(),
  campos_extras: (h.campos_extras ?? []).map((c) => ({ ...c, uid: novaChave() })),
});

const rotuloTransformacao = (t: TransformacaoInput, indice: number): string => {
  const nome = t.nome.trim();
  return nome ? `Transformação ${indice + 1} — ${nome}` : `Transformação ${indice + 1}`;
};

export default function TransformacoesEditor({
  itens,
  habilidadesBase,
  onChange,
}: {
  itens: TransformacaoInput[];
  /** Habilidades da forma base da ficha — fonte de herança junto às outras transformações. */
  habilidadesBase: HabilidadeDto[];
  onChange: (itens: TransformacaoInput[]) => void;
}) {
  const atualizar = (indice: number, patch: Partial<TransformacaoInput>) =>
    onChange(itens.map((t, i) => (i === indice ? { ...t, ...patch } : t)));
  const remover = (indice: number) => onChange(itens.filter((_, i) => i !== indice));
  const adicionar = () => onChange([...itens, criarTransformacao()]);

  const fontesPara = (indice: number): FonteHeranca[] => [
    { rotulo: "Forma base", habilidades: habilidadesBase },
    ...itens
      .map((t, i) => ({ rotulo: rotuloTransformacao(t, i), habilidades: t.habilidades, i }))
      .filter((f) => f.i !== indice),
  ];

  const herdar = (indice: number, escolhidas: HabilidadeDto[]) => {
    const alvo = itens[indice];
    if (!alvo) return;
    atualizar(indice, {
      habilidades: [...alvo.habilidades, ...escolhidas.map(clonarHabilidade)],
    });
  };

  return (
    <div className="space-y-4">
      {itens.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-800 py-6 text-center text-sm text-slate-500">
          Nenhuma transformação ainda.
        </p>
      )}

      {itens.map((t, i) => (
        <div key={t.uid ?? i} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-200">Transformação {i + 1}</h4>
            <button
              type="button"
              onClick={() => remover(i)}
              aria-label="Remover transformação"
              className={BOTAO_LIXEIRA}
            >
              <IconLixeira className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
            <RetratoUpload
              retrato={t.retrato}
              nome={t.nome}
              onChange={(retrato) => atualizar(i, { retrato })}
              label="Retrato"
            />
            <div className="space-y-3">
              <CampoTexto label="Nome" valor={t.nome} onChange={(nome) => atualizar(i, { nome })} />
              <Textarea
                label="Descrição"
                valor={t.descricao}
                onChange={(descricao) => atualizar(i, { descricao })}
                linhas={2}
              />
            </div>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Modificadores
            </span>
            <ModificadoresEditor
              modificadores={t.modificadores}
              onChange={(modificadores) => atualizar(i, { modificadores })}
            />
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Habilidades
              </span>
              <HerancaPicker
                fontes={fontesPara(i)}
                onHerdar={(escolhidas) => herdar(i, escolhidas)}
              />
            </div>
            <HabilidadesEditor
              itens={t.habilidades}
              onChange={(habilidades) => atualizar(i, { habilidades })}
            />
          </div>
        </div>
      ))}

      <button type="button" onClick={adicionar} className={BOTAO_SECUNDARIO}>
        <IconMais className="size-4" />
        Adicionar transformação
      </button>
    </div>
  );
}

function ModificadoresEditor({
  modificadores,
  onChange,
}: {
  modificadores: ModificadorDto[];
  onChange: (m: ModificadorDto[]) => void;
}) {
  const atualizar = (indice: number, patch: Partial<ModificadorDto>) =>
    onChange(modificadores.map((m, i) => (i === indice ? { ...m, ...patch } : m)));
  const remover = (indice: number) => onChange(modificadores.filter((_, i) => i !== indice));
  const adicionar = () => onChange([...modificadores, { atributo: "forca", delta: 0, uid: novaChave() }]);

  return (
    <div className="space-y-2">
      {modificadores.map((m, i) => (
        <div key={m.uid ?? i} className="flex items-end gap-2">
          <div className="flex-1">
            <SelectAtributo valor={m.atributo} onChange={(atributo) => atualizar(i, { atributo })} />
          </div>
          <div className="w-24">
            <CampoNumero
              label="Delta"
              valor={m.delta}
              min={-9999}
              onChange={(delta) => atualizar(i, { delta })}
            />
          </div>
          <button
            type="button"
            onClick={() => remover(i)}
            aria-label="Remover modificador"
            className={BOTAO_LIXEIRA}
          >
            <IconLixeira className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={adicionar} className={BOTAO_SECUNDARIO}>
        <IconMais className="size-4" />
        Adicionar modificador
      </button>
    </div>
  );
}
