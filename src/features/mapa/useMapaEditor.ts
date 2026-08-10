import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atualizarMapa, criarMapa, getMapa, listarMapas } from "../../lib/api";
import type { MapaInput, MapaResumo } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { inputVazio, mapaParaInput } from "./logica";
import { reduzir } from "./estadoMapa";

export interface MapaEditorApi {
  mapas: MapaResumo[];
  selecionado: number | null;
  input: MapaInput;
  /** Edição da grade/dimensão — entra no histórico de undo/redo. */
  editar: (patch: Partial<MapaInput>) => void;
  /** Edição de campos de texto — não entra no histórico (undo nativo do input cuida do texto). */
  editarCampo: (patch: Partial<MapaInput>) => void;
  trocarSelecao: (novoId: number | null) => void;
  /** Reação a exclusão de mapa: `prox` é o próximo sobrevivente, ou `null` se a lista ficou vazia. */
  aoExcluir: (prox: number | null) => void;
  novoMapa: () => void;
  invalidarMapas: () => void;
  /** Há edição ainda não gravada (o auto-save roda 500ms depois da última tecla). */
  sujo: boolean;
  /** Gravação em voo — pro indicador não piscar "salvo" antes da hora. */
  salvando: boolean;
  /** Grava agora, sem esperar o debounce. No-op se não há nada sujo. */
  salvarAgora: () => void;
}

/**
 * Estado + ações do editor de mapa: seleção, histórico undo/redo da grade, auto-save
 * debounced (500ms) e atalho de teclado Ctrl+Z/Ctrl+Y. Único dono desse estado por
 * instância montada — reusado tanto pela tela `/mapa` quanto pela sub-aba "Mapa" da
 * Batalha, sempre com as mesmas query keys (`["mapas"]`/`["mapa", id]`), então nunca
 * há fetch duplicado nem dois auto-savers divergentes.
 */
export function useMapaEditor(): MapaEditorApi {
  const qc = useQueryClient();
  const toast = useToast();
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [estado, dispatch] = useReducer(reduzir, {
    presente: inputVazio(),
    passado: [],
    futuro: [],
    sujo: false,
    mapaId: null,
  });
  const input = estado.presente;
  // espelha `estado` pra ler o valor mais recente de dentro de callbacks sem virar dependência de efeito
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const { data: mapas } = useQuery({ queryKey: ["mapas"], queryFn: listarMapas });

  const {
    data: mapaCarregado,
    isError: falhouCarregarMapa,
    error: erroCarregarMapa,
  } = useQuery({
    queryKey: ["mapa", selecionado],
    queryFn: () => getMapa(selecionado as number),
    enabled: selecionado !== null,
  });
  useEffect(() => {
    if (mapaCarregado) dispatch({ tipo: "set", input: mapaParaInput(mapaCarregado), id: mapaCarregado.id });
  }, [mapaCarregado]);
  // useQuery (v5) não tem onError — reage à falha via isError/error
  useEffect(() => {
    if (falhouCarregarMapa) toast.erro(String(erroCarregarMapa));
  }, [falhouCarregarMapa, erroCarregarMapa, toast]);

  // seleciona o primeiro mapa quando a lista chega e nada está selecionado
  useEffect(() => {
    if (selecionado === null && mapas && mapas.length > 0) setSelecionado(mapas[0].id);
  }, [mapas, selecionado]);

  // auto-save debounced (só quando há edição real — sujo). Mira sempre `estado.mapaId`,
  // o dono real de `input`, nunca `selecionado` (que pode já ter mudado pro próximo mapa).
  const salvar = useMutation({
    mutationFn: (p: { id: number; input: MapaInput }) => atualizarMapa(p.id, p.input),
    onSuccess: (mapaGravado, enviado) => {
      // O cache de `["mapa", id]` é o que este editor lê quando REMONTA — e ele
      // remonta toda vez que se sai da aba Mapa e volta (`Tabs` desmonta a aba
      // inativa). Sem gravar aqui o mapa que o backend acabou de devolver, o
      // cache guarda a versão ANTERIOR ao save: ao voltar pra aba o desenho
      // "some" da tela, e a próxima edição em cima dele manda esse valor velho
      // pro banco, apagando de vez o que já estava salvo.
      qc.setQueryData(["mapa", mapaGravado.id], mapaGravado);
      qc.invalidateQueries({ queryKey: ["mapas"] });
      dispatch({ tipo: "salvo", enviado: enviado.input });
    },
    onError: (e) => toast.erro(String(e)),
  });
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    const mapaId = estado.mapaId;
    if (mapaId === null || !estado.sujo) return;
    const t = setTimeout(() => salvarRef.current.mutate({ id: mapaId, input }), 500);
    return () => clearTimeout(t);
  }, [input, estado.mapaId, estado.sujo]);

  /**
   * Grava imediatamente, curto-circuitando o debounce. Serve o botão "Salvar"
   * do editor: o auto-save já cobre o caso normal, mas quem acabou de desenhar
   * algo importante quer poder garantir na hora, sem contar 500ms de fé.
   * Lê do ref pra não depender de closure velha.
   */
  const salvarAgora = useCallback(() => {
    const { sujo, mapaId, presente } = estadoRef.current;
    if (!sujo || mapaId === null) return;
    salvarRef.current.mutate({ id: mapaId, input: presente });
  }, []);

  // troca de mapa selecionado com flush síncrono do save pendente — evita perder a última
  // edição (auto-save ainda no debounce) ou gravar no id do mapa que acabou de sair de cena.
  const trocarSelecao = useCallback((novoId: number | null) => {
    const { sujo, mapaId, presente } = estadoRef.current;
    if (sujo && mapaId !== null) {
      salvarRef.current.mutate({ id: mapaId, input: presente });
    }
    setSelecionado(novoId);
  }, []);

  // mapa selecionado foi excluído: se sobrou algum, troca (com flush); se a lista ficou
  // vazia não há pra onde flushar (o dono sumiu), então só reseta pro estado em branco
  const aoExcluir = useCallback(
    (prox: number | null) => {
      if (prox === null) {
        setSelecionado(null);
        dispatch({ tipo: "set", input: inputVazio(), id: null });
      } else {
        trocarSelecao(prox);
      }
    },
    [trocarSelecao],
  );

  // atalhos undo/redo (só a grade) — ignora quando o foco está num campo de texto
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const alvo = ev.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        dispatch(ev.shiftKey ? { tipo: "redo" } : { tipo: "undo" });
      } else if (ctrl && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        dispatch({ tipo: "redo" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // grade/dimensão — entra no histórico de undo/redo
  const editar = useCallback(
    (patch: Partial<MapaInput>) => {
      dispatch({ tipo: "editar", input: { ...estado.presente, ...patch } });
    },
    [estado.presente],
  );

  // campos de texto — não entra no histórico (o undo nativo do input cuida do texto)
  const editarCampo = useCallback(
    (patch: Partial<MapaInput>) => {
      dispatch({ tipo: "campo", input: { ...estado.presente, ...patch } });
    },
    [estado.presente],
  );

  const criar = useMutation({
    mutationFn: () => criarMapa(inputVazio()),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["mapas"] });
      trocarSelecao(m.id);
      toast.sucesso("Mapa criado.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  return {
    mapas: mapas ?? [],
    selecionado,
    input,
    editar,
    editarCampo,
    trocarSelecao,
    aoExcluir,
    novoMapa: () => criar.mutate(),
    invalidarMapas: () => qc.invalidateQueries({ queryKey: ["mapas"] }),
    sujo: estado.sujo,
    salvando: salvar.isPending,
    salvarAgora,
  };
}
