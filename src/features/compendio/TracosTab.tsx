import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { atualizarCatalogoTraco, criarCatalogoTraco, excluirCatalogoTraco } from "../../lib/api";
import type { CatalogoTraco, CatalogoTracoInput, TipoTraco } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { filtrarPorBusca, tracoInputVazio, tracoParaInput } from "./logica";
import CompendioLista from "./CompendioLista";
import EditorTraco from "./EditorTraco";

/**
 * Aba de vantagens/desvantagens do catálogo. Um único componente parametrizado
 * por `tipo` (mesma forma de dado nos dois — só a tabela do backend muda).
 */
export default function TracosTab({
  tipo,
  itens,
  rotulo,
}: {
  tipo: TipoTraco;
  itens: CatalogoTraco[];
  /** Rótulo singular capitalizado ("Vantagem" / "Desvantagem") pros textos de UI. */
  rotulo: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [emEdicao, setEmEdicao] = useState(false);
  const [busca, setBusca] = useState("");
  const [input, setInput] = useState<CatalogoTracoInput>(tracoInputVazio());
  const [sujo, setSujo] = useState(false);

  const rotuloMinusculo = rotulo.toLowerCase();
  const invalidar = () => qc.invalidateQueries({ queryKey: ["catalogos"] });

  function confirmarDescarte(): boolean {
    if (!sujo) return true;
    return window.confirm("Descartar alterações não salvas?");
  }

  function selecionar(id: number) {
    if (id === selecionadoId) return;
    if (!confirmarDescarte()) return;
    const item = itens.find((t) => t.id === id);
    if (!item) return;
    setSelecionadoId(id);
    setInput(tracoParaInput(item));
    setSujo(false);
    setEmEdicao(true);
  }

  function novoTraco() {
    if (!confirmarDescarte()) return;
    setSelecionadoId(null);
    setInput(tracoInputVazio());
    setSujo(false);
    setEmEdicao(true);
  }

  function editar(patch: Partial<CatalogoTracoInput>) {
    setInput((i) => ({ ...i, ...patch }));
    setSujo(true);
  }

  function cancelar() {
    if (selecionadoId === null) {
      setEmEdicao(false);
      setInput(tracoInputVazio());
    } else {
      const item = itens.find((t) => t.id === selecionadoId);
      setInput(item ? tracoParaInput(item) : tracoInputVazio());
    }
    setSujo(false);
  }

  const criar = useMutation({
    mutationFn: (i: CatalogoTracoInput) => criarCatalogoTraco(tipo, i),
    onSuccess: (novo) => {
      invalidar();
      setSelecionadoId(novo.id);
      setSujo(false);
      toast.sucesso(`${rotulo} criada.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  const atualizar = useMutation({
    mutationFn: (p: { id: number; input: CatalogoTracoInput }) =>
      atualizarCatalogoTraco(tipo, p.id, p.input),
    onSuccess: () => {
      invalidar();
      setSujo(false);
      toast.sucesso(`${rotulo} salva.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  const excluir = useMutation({
    mutationFn: (id: number) => excluirCatalogoTraco(tipo, id),
    onSuccess: (_res, id) => {
      invalidar();
      if (id === selecionadoId) {
        setSelecionadoId(null);
        setEmEdicao(false);
        setInput(tracoInputVazio());
        setSujo(false);
      }
      toast.sucesso(`${rotulo} excluída.`);
    },
    onError: (e) => toast.erro(String(e)),
  });

  function salvar() {
    if (selecionadoId === null) criar.mutate(input);
    else atualizar.mutate({ id: selecionadoId, input });
  }

  return (
    <div className="grid h-[70vh] grid-cols-[260px_1fr] gap-4">
      <CompendioLista
        itens={filtrarPorBusca(itens, busca)}
        selecionadoId={selecionadoId}
        busca={busca}
        onBuscar={setBusca}
        onSelecionar={selecionar}
        onNovo={novoTraco}
        excluir={excluir}
        rotuloNovo={`+ Nova ${rotuloMinusculo}`}
        rotuloVazio={`Nenhuma ${rotuloMinusculo} encontrada.`}
        tituloExcluir={`Excluir ${rotuloMinusculo}?`}
      />
      <EditorTraco
        input={input}
        temSelecao={emEdicao}
        sujo={sujo}
        salvando={criar.isPending || atualizar.isPending}
        rotuloVazio={`Nenhuma ${rotuloMinusculo} selecionada. Clique em "+ Nova ${rotuloMinusculo}" ou escolha uma na lista.`}
        onEditar={editar}
        onSalvar={salvar}
        onCancelar={cancelar}
      />
    </div>
  );
}
