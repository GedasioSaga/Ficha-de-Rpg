import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { excluirPersonagem, getPersonagem, retratoDataUrl } from "../../lib/api";
import type {
  HabilidadeDto,
  ModificadorDto,
  PericiaDto,
  TracoDto,
  TransformacaoDto,
} from "../../lib/types";
import { IconDownload, IconEditar, IconLixeira, IconVoltar } from "../../components/icons";
import Dialog from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import Tabs, { type Aba } from "../../components/Tabs";
import StatBlock from "./StatBlock";
import CamposTecnica from "./CamposTecnica";
import { gradienteDoNome, iniciais } from "./retrato";
import { ATRIBUTOS, ABREV_ATRIBUTO } from "./atributos";
import { exportarComDialogo } from "./portabilidade";

const BOTAO_TOPO =
  "inline-flex items-center gap-1.5 h-9 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40";
const BOTAO_TOPO_PERIGO =
  "inline-flex items-center gap-1.5 h-9 rounded-lg border border-rose-500/40 px-3 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40";

function VoltarLink() {
  return (
    <Link
      to="/"
      className="group inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
    >
      <IconVoltar className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
      Fichas
    </Link>
  );
}

function AcoesFicha({ id, nome }: { id: number; nome: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const excluir = useMutation({
    mutationFn: () => excluirPersonagem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personagens"] });
      toast.sucesso("Personagem excluído.");
      navigate("/");
    },
    onError: (e) => {
      setConfirmando(false);
      toast.erro(String(e));
    },
  });

  async function exportar() {
    setExportando(true);
    try {
      const n = await exportarComDialogo([id], `${nome}.json`);
      if (n != null) toast.sucesso(`Ficha de ${nome} exportada.`);
    } catch (e) {
      toast.erro(String(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={exportar} disabled={exportando} className={BOTAO_TOPO}>
        <IconDownload className="size-4" />
        {exportando ? "Exportando…" : "Exportar"}
      </button>
      <Link to={`/fichas/${id}/editar`} className={BOTAO_TOPO}>
        <IconEditar className="size-4" />
        Editar
      </Link>
      <button type="button" onClick={() => setConfirmando(true)} className={BOTAO_TOPO_PERIGO}>
        <IconLixeira className="size-4" />
        Excluir
      </button>
      <Dialog
        aberto={confirmando}
        titulo="Excluir personagem?"
        descricao={`"${nome}" e toda a ficha serão removidos. Esta ação não pode ser desfeita.`}
        textoConfirmar={excluir.isPending ? "Excluindo…" : "Excluir"}
        perigo
        onConfirmar={() => excluir.mutate()}
        onCancelar={() => setConfirmando(false)}
      />
    </div>
  );
}

export default function CharacterSheet() {
  const { id } = useParams();
  const personagemId = Number(id);
  const idValido = Number.isInteger(personagemId);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["personagem", personagemId],
    queryFn: () => getPersonagem(personagemId),
    enabled: idValido,
  });

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <VoltarLink />
        {idValido && !isError && data && <AcoesFicha id={data.id} nome={data.nome} />}
      </div>

      {!idValido || isError ? (
        <EstadoErro mensagem={idValido ? String(error) : "Ficha inválida."} />
      ) : isLoading || !data ? (
        <EsqueletoFicha />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="space-y-3">
            {(data.raca || data.oficio) && (
              <div className="flex flex-wrap gap-1.5">
                {data.raca && (
                  <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                    {data.raca}
                  </span>
                )}
                {data.oficio && (
                  <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300">
                    {data.oficio}
                  </span>
                )}
              </div>
            )}
            <StatBlock p={data} />
          </div>
          <div className="min-w-0">
            <Tabs abas={montarAbas(data.habilidades, data.pericias, data.vantagens, data.desvantagens, data.transformacoes)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function montarAbas(
  habilidades: HabilidadeDto[],
  pericias: PericiaDto[],
  vantagens: TracoDto[],
  desvantagens: TracoDto[],
  transformacoes: TransformacaoDto[],
): Aba[] {
  return [
    { id: "habilidades", label: "Habilidades", conteudo: <ListaHabilidades itens={habilidades} /> },
    { id: "pericias", label: "Perícias", conteudo: <ListaPericias itens={pericias} /> },
    { id: "vantagens", label: "Vantagens", conteudo: <ListaTracos itens={vantagens} vazio="Nenhuma vantagem." /> },
    { id: "desvantagens", label: "Desvantagens", conteudo: <ListaTracos itens={desvantagens} vazio="Nenhuma desvantagem." /> },
    { id: "transformacoes", label: "Transformações", conteudo: <ListaTransformacoes itens={transformacoes} /> },
  ];
}

/* ----------------------------- Estados de tela ---------------------------- */

function EstadoErro({ mensagem }: { mensagem: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="font-medium text-rose-300">Personagem não encontrado</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{mensagem}</p>
    </div>
  );
}

function EsqueletoFicha() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <div className="h-[520px] animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
      <div className="space-y-3">
        <div className="h-10 w-full animate-pulse rounded-lg bg-slate-900/60" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 w-full animate-pulse rounded-xl bg-slate-900/60" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Listas de aba ----------------------------- */

function ListaVazia({ texto }: { texto: string }) {
  return <p className="py-10 text-center text-sm text-slate-500">{texto}</p>;
}

const CARTAO = "rounded-xl border border-slate-800 bg-slate-900/60 p-4";

function ListaHabilidades({ itens }: { itens: HabilidadeDto[] }) {
  if (itens.length === 0) return <ListaVazia texto="Nenhuma habilidade." />;
  return (
    <ul className="space-y-2.5">
      {itens.map((h, i) => (
        <li key={`${h.nome}-${i}`} className={CARTAO}>
          <h4 className="font-medium text-slate-100">{h.nome}</h4>
          {h.descricao && (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{h.descricao}</p>
          )}
          <CamposTecnica h={h} />
        </li>
      ))}
    </ul>
  );
}

/**
 * "percepcao,intuicao" -> "PER · INT". Ficha importada da versão antiga pode
 * trazer texto livre (ex.: "(Percepção/Intuição)") em vez do CSV de slugs — um
 * `slice(0,3)` nesse lixo virava "(PE" sem avisar ninguém. Em vez de truncar,
 * sinaliza como não reconhecido e mostra o texto original.
 */
function rotuloAtributosCsv(csv: string): { texto: string; legado: boolean } {
  const tokens = csv
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const todosCanonicos =
    tokens.length > 0 && tokens.every((a) => (ATRIBUTOS as readonly string[]).includes(a));

  if (!todosCanonicos) return { texto: csv, legado: true };
  return { texto: tokens.map((a) => ABREV_ATRIBUTO[a]).join(" · "), legado: false };
}

function ListaPericias({ itens }: { itens: PericiaDto[] }) {
  if (itens.length === 0) return <ListaVazia texto="Nenhuma perícia." />;
  return (
    <ul className="space-y-2.5">
      {itens.map((p, i) => {
        const rotulo = p.atributo ? rotuloAtributosCsv(p.atributo) : null;
        return (
        <li key={`${p.nome}-${i}`} className={CARTAO}>
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-medium text-slate-100">{p.nome}</h4>
            {rotulo && rotulo.legado ? (
              <span
                className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"
                title={`Atributo não reconhecido nesta ficha: "${rotulo.texto}"`}
              >
                Não reconhecido: {rotulo.texto}
              </span>
            ) : rotulo ? (
              <span className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                {rotulo.texto}
              </span>
            ) : null}
          </div>
          {p.descricao && (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p.descricao}</p>
          )}
        </li>
        );
      })}
    </ul>
  );
}

function ListaTracos({ itens, vazio }: { itens: TracoDto[]; vazio: string }) {
  if (itens.length === 0) return <ListaVazia texto={vazio} />;
  return (
    <ul className="space-y-2.5">
      {itens.map((t, i) => (
        <li key={`${t.nome}-${i}`} className={CARTAO}>
          <h4 className="font-medium text-slate-100">{t.nome}</h4>
          {t.descricao && (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{t.descricao}</p>
          )}
          {t.efeito && (
            <p className="mt-2 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
              <span className="font-medium text-slate-400">Efeito: </span>
              {t.efeito}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ModBadge({ m }: { m: ModificadorDto }) {
  const positivo = m.delta >= 0;
  const abrev = ABREV_ATRIBUTO[m.atributo] ?? m.atributo.slice(0, 3).toUpperCase();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        positivo
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
          : "border-rose-500/40 bg-rose-500/15 text-rose-200"
      }`}
    >
      {abrev} {positivo ? "+" : ""}
      {m.delta}
    </span>
  );
}

function ListaTransformacoes({ itens }: { itens: TransformacaoDto[] }) {
  if (itens.length === 0) return <ListaVazia texto="Nenhuma transformação." />;
  return (
    <ul className="space-y-3">
      {itens.map((t, i) => (
        <TransformacaoCard key={`${t.nome}-${i}`} t={t} />
      ))}
    </ul>
  );
}

function TransformacaoCard({ t }: { t: TransformacaoDto }) {
  const { data: src } = useQuery({
    queryKey: ["retrato", t.retrato],
    queryFn: () => retratoDataUrl(t.retrato!),
    enabled: !!t.retrato,
    staleTime: Infinity,
  });
  const temImagem = !!t.retrato && !!src;

  return (
    <li className={CARTAO}>
      <div className="flex gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-800">
          {temImagem ? (
            <img src={src} alt={t.nome} className="size-full object-cover" />
          ) : (
            <div
              className="flex size-full items-center justify-center"
              style={{ backgroundImage: gradienteDoNome(t.nome) }}
            >
              <span className="text-lg font-bold text-white/90">{iniciais(t.nome)}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-slate-100">{t.nome}</h4>
          {t.descricao && (
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{t.descricao}</p>
          )}
          {t.modificadores.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {t.modificadores.map((m, i) => (
                <ModBadge key={`${m.atributo}-${i}`} m={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      {t.habilidades.length > 0 && (
        <div className="mt-3 space-y-2.5 border-t border-slate-800 pt-3">
          {t.habilidades.map((h, i) => (
            <div key={`${h.nome}-${i}`} className="text-sm">
              <span className="font-medium text-slate-200">{h.nome}</span>
              {h.descricao && <span className="text-slate-400"> — {h.descricao}</span>}
              <CamposTecnica h={h} denso />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
