import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { atualizarCatalogoPericia, criarCatalogoPericia, excluirCatalogoPericia } from "../../lib/api";
import type { CatalogoPericia, CatalogoPericiaInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { filtrarPorBusca, periciaInputVazio, periciaParaInput } from "./logica";
import CompendioLista from "./CompendioLista";
import EditorPericia from "./EditorPericia";

export default function PericiasTab({ pericias }: { pericias: CatalogoPericia[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [emEdicao, setEmEdicao] = useState(false);
  const [busca, setBusca] = useState("");
  const [input, setInput] = useState<CatalogoPericiaInput>(periciaInputVazio());
  const [sujo, setSujo] = useState(false);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["catalogos"] });

  // some edição não salva vira confirmação nativa — troca de item/aba não perde dado calado.
  function confirmarDescarte(): boolean {
    if (!sujo) return true;
    return window.confirm("Descartar alterações não salvas?");
  }

  function selecionar(id: number) {
    if (id === selecionadoId) return;
    if (!confirmarDescarte()) return;
    const item = pericias.find((p) => p.id === id);
    if (!item) return;
    setSelecionadoId(id);
    setInput(periciaParaInput(item));
    setSujo(false);
    setEmEdicao(true);
  }

  function novaPericia() {
    if (!confirmarDescarte()) return;
    setSelecionadoId(null);
    setInput(periciaInputVazio());
    setSujo(false);
    setEmEdicao(true);
  }

  function editar(patch: Partial<CatalogoPericiaInput>) {
    setInput((i) => ({ ...i, ...patch }));
    setSujo(true);
  }

  function cancelar() {
    if (selecionadoId === null) {
      setEmEdicao(false);
      setInput(periciaInputVazio());
    } else {
      const item = pericias.find((p) => p.id === selecionadoId);
      setInput(item ? periciaParaInput(item) : periciaInputVazio());
    }
    setSujo(false);
  }

  const criar = useMutation({
    mutationFn: (i: CatalogoPericiaInput) => criarCatalogoPericia(i),
    onSuccess: (nova) => {
      invalidar();
      setSelecionadoId(nova.id);
      setSujo(false);
      toast.sucesso("Perícia criada.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const atualizar = useMutation({
    mutationFn: (p: { id: number; input: CatalogoPericiaInput }) =>
      atualizarCatalogoPericia(p.id, p.input),
    onSuccess: () => {
      invalidar();
      setSujo(false);
      toast.sucesso("Perícia salva.");
    },
    onError: (e) => toast.erro(String(e)),
  });

  const excluir = useMutation({
    mutationFn: (id: number) => excluirCatalogoPericia(id),
    onSuccess: (_res, id) => {
      invalidar();
      if (id === selecionadoId) {
        setSelecionadoId(null);
        setEmEdicao(false);
        setInput(periciaInputVazio());
        setSujo(false);
      }
      toast.sucesso("Perícia excluída.");
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
        itens={filtrarPorBusca(pericias, busca)}
        selecionadoId={selecionadoId}
        busca={busca}
        onBuscar={setBusca}
        onSelecionar={selecionar}
        onNovo={novaPericia}
        excluir={excluir}
        rotuloNovo="+ Nova perícia"
        rotuloVazio="Nenhuma perícia encontrada."
        tituloExcluir="Excluir perícia?"
      />
      <EditorPericia
        input={input}
        temSelecao={emEdicao}
        sujo={sujo}
        salvando={criar.isPending || atualizar.isPending}
        onEditar={editar}
        onSalvar={salvar}
        onCancelar={cancelar}
      />
    </div>
  );
}
