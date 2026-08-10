import type { CatalogoPericia, PericiaDto } from "../../../lib/types";
import { CampoNumero, CampoTexto, SelectAtributo, Textarea } from "./Campos";
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
      criarVazio={() => ({ nome: "", descricao: "", atributo: "forca", nivel: 0, uid: novaChave() })}
      textoAdicionar="Adicionar perícia"
      textoVazio="Nenhuma perícia ainda."
      acaoExtra={
        <CatalogoPicker
          titulo="Perícias do catálogo"
          itens={catalogo}
          onEscolher={(p) =>
            onChange([
              ...itens,
              { nome: p.nome, descricao: p.descricao, atributo: p.atributo, nivel: 0, uid: novaChave() },
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
          <div className="grid grid-cols-2 gap-2">
            <SelectAtributo
              label="Atributo"
              valor={item.atributo}
              onChange={(atributo) => atualizar({ atributo })}
            />
            <CampoNumero label="Nível" valor={item.nivel} onChange={(nivel) => atualizar({ nivel })} />
          </div>
        </>
      )}
    />
  );
}
