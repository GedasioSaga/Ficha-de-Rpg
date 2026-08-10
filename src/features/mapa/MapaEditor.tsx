import { useState } from "react";
import { useMapaEditor } from "./useMapaEditor";
import ListaMapas from "./ListaMapas";
import CamposMapa from "./CamposMapa";
import GradeEditor from "./GradeEditor";
import PreviewMapa from "./PreviewMapa";
import PainelCores from "./PainelCores";

/**
 * Editor de mapa completo — biblioteca lateral, campos, grade clicável e preview
 * com export pro Discord. Todo o estado (seleção, undo/redo, auto-save) vive em
 * `useMapaEditor`; este componente é só a apresentação, reusada tanto pela tela
 * `/mapa` (`MapaScreen`) quanto pela sub-aba "Mapa" da tela de Batalha.
 */
export default function MapaEditor() {
  const {
    mapas,
    selecionado,
    input,
    editar,
    editarCampo,
    trocarSelecao,
    aoExcluir,
    novoMapa,
    invalidarMapas,
    sujo,
    salvando,
    salvarAgora,
  } = useMapaEditor();
  const [coresAbertas, setCoresAbertas] = useState(false);

  return (
    // Abaixo do breakpoint nada é restrito em altura: coluna única, tudo cresce
    // à vontade e quem rola é o contêiner de fora (tabpanel da Batalha ou
    // `main` da rota /mapa). Só a partir de lg — 3 colunas lado a lado — é que
    // h-full/overflow interno fazem sentido, porque cada coluna passa a
    // precisar da própria rolagem.
    <div className="grid grid-cols-1 gap-4 p-4 lg:h-full lg:grid-cols-[220px_1fr_minmax(280px,380px)]">
      <ListaMapas
        mapas={mapas}
        selecionado={selecionado}
        onSelecionar={trocarSelecao}
        onNovo={novoMapa}
        onMudou={invalidarMapas}
        onExcluido={aoExcluir}
      />
      <div className="min-w-0 space-y-4 lg:overflow-auto">
        {/* O mapa já grava sozinho 500ms depois da última edição. Esta barra
            existe porque salvar em silêncio não passa confiança: sem ver o
            estado, a sensação é de que nada foi salvo. O botão é pra quem quer
            garantir na hora, sem contar o debounce de fé. */}
        <EstadoSalvamento
          desabilitado={selecionado === null}
          sujo={sujo}
          salvando={salvando}
          onSalvar={salvarAgora}
          coresAbertas={coresAbertas}
          onAlternarCores={() => setCoresAbertas((v) => !v)}
        />
        {coresAbertas && <PainelCores onFechar={() => setCoresAbertas(false)} />}
        <CamposMapa input={input} onEditar={editarCampo} />
        <GradeEditor input={input} onEditar={editar} />
      </div>
      {/* `mapaId` é o que faz o preview incluir as PEÇAS e a legenda quando o
          mapa em edição é o mapa ativo da batalha. Sem ele o contador de
          caracteres mediria só a grade e diria "cabe" para uma mensagem que, na
          hora de postar, vem maior. */}
      <PreviewMapa input={input} mapaId={selecionado} />
    </div>
  );
}

interface EstadoSalvamentoProps {
  desabilitado: boolean;
  sujo: boolean;
  salvando: boolean;
  onSalvar: () => void;
  coresAbertas: boolean;
  onAlternarCores: () => void;
}

/**
 * Indicador do auto-save + botão de gravar na hora.
 *
 * Os três estados são distintos de propósito: "salvando" não pode virar "salvo"
 * antes da gravação terminar, senão o indicador mente justo no instante em que
 * o usuário mais olha pra ele.
 */
function EstadoSalvamento({
  desabilitado,
  sujo,
  salvando,
  onSalvar,
  coresAbertas,
  onAlternarCores,
}: EstadoSalvamentoProps) {
  const estado = salvando
    ? { texto: "salvando…", cor: "text-amber-400", ponto: "bg-amber-400" }
    : sujo
      ? { texto: "alterações não salvas", cor: "text-slate-400", ponto: "bg-slate-500" }
      : { texto: "salvo", cor: "text-emerald-400", ponto: "bg-emerald-400" };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
      <span className={`flex items-center gap-2 text-xs ${estado.cor}`}>
        <span className={`size-2 shrink-0 rounded-full ${estado.ponto}`} aria-hidden />
        {estado.texto}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onAlternarCores}
          aria-expanded={coresAbertas}
          title="Escolher a cor de cada símbolo do mapa"
          className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm transition-colors ${
            coresAbertas
              ? "border-indigo-500/60 bg-indigo-500/10 text-indigo-300"
              : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
          }`}
        >
          Cores
        </button>
        <button
          type="button"
          onClick={onSalvar}
          disabled={desabilitado || salvando || !sujo}
          title={sujo ? "Gravar agora, sem esperar o salvamento automático" : "Nada pendente pra salvar"}
          className="inline-flex h-8 items-center rounded-lg bg-indigo-500 px-3 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-40 disabled:pointer-events-none"
        >
          Salvar mapa
        </button>
      </div>
    </div>
  );
}
