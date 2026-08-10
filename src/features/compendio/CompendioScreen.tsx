import { useQuery } from "@tanstack/react-query";
import { listarCatalogos } from "../../lib/api";
import Tabs, { type Aba } from "../../components/Tabs";
import PericiasTab from "./PericiasTab";
import TracosTab from "./TracosTab";

/** Compêndio: navegador + CRUD dos catálogos (perícias/vantagens/desvantagens). */
export default function CompendioScreen() {
  const {
    data: catalogos,
    isError,
    error,
  } = useQuery({ queryKey: ["catalogos"], queryFn: listarCatalogos });

  if (isError) {
    return <div className="p-4 text-sm text-rose-300">Falha ao carregar o compêndio: {String(error)}</div>;
  }
  if (!catalogos) {
    return <div className="p-4 text-sm text-slate-500">Carregando…</div>;
  }

  const abas: Aba[] = [
    {
      id: "pericias",
      label: "Perícias",
      conteudo: <PericiasTab pericias={catalogos.pericias} />,
    },
    {
      id: "vantagens",
      label: "Vantagens",
      conteudo: <TracosTab tipo="vantagem" itens={catalogos.vantagens} rotulo="Vantagem" />,
    },
    {
      id: "desvantagens",
      label: "Desvantagens",
      conteudo: <TracosTab tipo="desvantagem" itens={catalogos.desvantagens} rotulo="Desvantagem" />,
    },
  ];

  return (
    <div className="p-4">
      <Tabs abas={abas} />
    </div>
  );
}
