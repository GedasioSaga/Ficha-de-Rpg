import type { CatalogoPericia, PericiaDto } from "../../../lib/types";
import { CampoTexto, MultiAtributo, Textarea } from "./Campos";
import { novaChave } from "./chave";
import CatalogoPicker from "./CatalogoPicker";
import ListaEditavel from "./ListaEditavel";

export default function PericiasEditor({
  itens,
  onChange,
  catalogo,
}: {
  itens: PericiaDto[];
  onChange: (itens: PericiaDto[]) => void;
  catalogo: CatalogoPericia[];
}) {
  return (
    <ListaEditavel<PericiaDto>
      itens={itens}
      onChange={onChange}
      criarVazio={() => ({ nome: "", descricao: "", atributo: "", uid: novaChave() })}
      textoAdicionar="Adicionar perícia"
      textoVazio="Nenhuma perícia ainda."
      acaoExtra={
        <CatalogoPicker
          titulo="Perícias do catálogo"
          itens={catalogo}
          onEscolher={(p) =>
            onChange([
              ...itens,
              { nome: p.nome, descricao: p.descricao, atributo: p.atributo, uid: novaChave() },
            ])
          }
        />
      }
      render={(item, atualizar) => (
        <>
          <CampoTexto label="Nome" valor={item.nome} onChange={(nome) => atualizar({ nome })} />
          <Textarea
            label="Descrição"
            valor={item.descricao}
            onChange={(descricao) => atualizar({ descricao })}
            linhas={2}
          />
          <MultiAtributo
            label="Atributos"
            valor={item.atributo}
            onChange={(atributo) => atualizar({ atributo })}
          />
        </>
      )}
    />
  );
}
