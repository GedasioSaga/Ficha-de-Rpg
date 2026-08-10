import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { atualizarNota, criarNota, getNota, listarNotas } from "../../lib/api";
import type { NotaInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { inputVazio, notaParaInput } from "./logica";
import ListaNotas from "./ListaNotas";
import EditorNota from "./EditorNota";

type EstadoEdicao = {
  presente: NotaInput;
  sujo: boolean;
  /** Id da nota dona de `presente` — fonte da verdade do auto-save (nunca `selecionada`, que já pode ter mudado). */
  notaId: number | null;
};

export default function NotasScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState<EstadoEdicao>({
    presente: inputVazio(),
    sujo: false,
    notaId: null,
  });
  const input = estado.presente;
  // espelha `estado` pra ler o valor mais recente de dentro de callbacks sem virar dependência de efeito
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const { data: notas } = useQuery({ queryKey: ["notas"], queryFn: listarNotas });

  const {
    data: notaCarregada,
    isError: falhouCarregarNota,
    error: erroCarregarNota,
  } = useQuery({
    queryKey: ["nota", selecionada],
    queryFn: () => getNota(selecionada as number),
    enabled: selecionada !== null,
  });
  useEffect(() => {
    if (notaCarregada) {
      setEstado({ presente: notaParaInput(notaCarregada), sujo: false, notaId: notaCarregada.id });
    }
  }, [notaCarregada]);
  // useQuery (v5) não tem onError — reage à falha via isError/error
  useEffect(() => {
    if (falhouCarregarNota) toast.erro(String(erroCarregarNota));
  }, [falhouCarregarNota, erroCarregarNota, toast]);

  // seleciona a primeira nota quando a lista chega e nada está selecionado
  useEffect(() => {
    if (selecionada === null && notas && notas.length > 0) setSelecionada(notas[0].id);
  }, [notas, selecionada]);

  // auto-save debounced (só quando há edição real — sujo). Mira sempre `estado.notaId`,
  // o dono real de `input`, nunca `selecionada` (que pode já ter mudado pra próxima nota).
  const salvar = useMutation({
    mutationFn: (p: { id: number; input: NotaInput }) => atualizarNota(p.id, p.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notas"] }),
    onError: (e) => toast.erro(String(e)),
  });
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    const notaId = estado.notaId;
    if (notaId === null || !estado.sujo) return;
    const t = setTimeout(() => salvarRef.current.mutate({ id: notaId, input }), 500);
    return () => clearTimeout(t);
  }, [input, estado.notaId, estado.sujo]);

  // troca de nota selecionada com flush síncrono do save pendente — evita perder a última
  // edição (auto-save ainda no debounce) ou gravar no id da nota que acabou de sair de cena.
  const trocarSelecao = useCallback((novoId: number | null) => {
    const { sujo, notaId, presente } = estadoRef.current;
    if (sujo && notaId !== null) {
      salvarRef.current.mutate({ id: notaId, input: presente });
    }
    setSelecionada(novoId);
  }, []);

  const editar = useCallback((patch: Partial<NotaInput>) => {
    setEstado((e) => ({ ...e, presente: { ...e.presente, ...patch }, sujo: true }));
  }, []);

  const criar = useMutation({
    mutationFn: () => criarNota(inputVazio()),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["notas"] });
      trocarSelecao(n.id);
      toast.sucesso("Nota criada.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const notasFiltradas = (notas ?? []).filter((n) =>
    n.titulo.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <div className="grid h-full grid-cols-[260px_1fr] gap-4 p-4">
      <ListaNotas
        notas={notasFiltradas}
        selecionada={selecionada}
        busca={busca}
        onBuscar={setBusca}
        onSelecionar={trocarSelecao}
        onNovo={() => criar.mutate()}
        onMudou={() => qc.invalidateQueries({ queryKey: ["notas"] })}
        onExcluida={(prox) => {
          if (prox === null) {
            // não há pra onde "trocar" — a nota selecionada sumiu, então não faz flush nela
            setSelecionada(null);
            setEstado({ presente: inputVazio(), sujo: false, notaId: null });
          } else {
            trocarSelecao(prox);
          }
        }}
      />
      <EditorNota input={input} temSelecao={selecionada !== null} onEditar={editar} />
    </div>
  );
}
