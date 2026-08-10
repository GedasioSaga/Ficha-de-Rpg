import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  atualizarPersonagem,
  criarPersonagem,
  getPersonagem,
  listarCatalogos,
} from "../../lib/api";
import type {
  HabilidadeDto,
  PersonagemCompleto,
  PersonagemInput,
  TracoDto,
} from "../../lib/types";
import Tabs, { type Aba } from "../../components/Tabs";
import { IconCheck, IconVoltar } from "../../components/icons";
import { useToast } from "../../components/Toast";
import {
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CampoTexto,
  Textarea,
} from "./form/Campos";
import { novaChave } from "./form/chave";
import CatalogoPicker from "./form/CatalogoPicker";
import EtiquetasEditor from "./form/EtiquetasEditor";
import HabilidadesEditor from "./form/HabilidadesEditor";
import ListaEditavel from "./form/ListaEditavel";
import PericiasEditor from "./form/PericiasEditor";
import RetratoUpload from "./form/RetratoUpload";
import SecaoBase from "./form/SecaoBase";
import TransformacoesEditor from "./form/TransformacoesEditor";
import PainelIA from "../balanceamento/PainelIA";
import { dePersonagemInput } from "../balanceamento/prompts";
import { useImagemDaFicha } from "./useImagemDaFicha";

/* Mais largo que as demais telas de ficha (1400px em CharacterSheet/FichasGallery):
   aqui entra a 3ª coluna de chat. Vale para os três estados da tela (form, erro,
   esqueleto) — se divergirem, a largura salta ao trocar de estado. */
const PAGINA_FICHA = "@container mx-auto max-w-[1700px] px-6 py-6";

/* A 3ª coluna liga por CONTAINER query, não por viewport: o form vive dentro do
   `main` do AppShell, ao lado da Sidebar (224px expandida, 64px colapsada) e da
   scrollbar — media query mediria a tela e ligaria a coluna sem o espaço existir.
   Assim, colapsar a sidebar já habilita o chat lateral sem trocar de monitor.
   Corte em 1040px: 300 (base) + 336 (chat) + 48 (gaps) deixa ~356px pras abas.

   O `@container` PRECISA ficar num elemento acima do grid: container query só
   afeta descendentes, então marcar o próprio grid faria as variantes `@min-`
   dele nunca casarem — o grid ficava com 1 coluna enquanto os filhos já se
   posicionavam em 3, embaralhando a tela. */
const GRID_FICHA =
  "grid grid-cols-1 gap-6 @min-[720px]:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] @min-[1040px]:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_21rem]";

export default function FichaForm() {
  // Remonta o editor ao trocar de ficha (novo ↔ :id ↔ outro :id). Sem a `key`,
  // React/Router reusa a mesma instância na navegação e o ref `prefilled` de uma
  // ficha vaza pra próxima — o form abre com os dados da anterior.
  const { id } = useParams();
  return <FichaFormEditor key={id ?? "novo"} />;
}

function FichaFormEditor() {
  const { id } = useParams();
  const editando = id != null;
  const personagemId = Number(id);
  const idInvalido = editando && !Number.isInteger(personagemId);

  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const catalogosQuery = useQuery({
    queryKey: ["catalogos"],
    queryFn: listarCatalogos,
    staleTime: Infinity,
  });
  const personagemQuery = useQuery({
    queryKey: ["personagem", personagemId],
    queryFn: () => getPersonagem(personagemId),
    enabled: editando && !idInvalido,
  });

  const [form, setForm] = useState<PersonagemInput>(inputVazio);
  const prefilled = useRef(false);
  useEffect(() => {
    if (editando && personagemQuery.data && !prefilled.current) {
      setForm(paraInput(personagemQuery.data));
      prefilled.current = true;
    }
  }, [editando, personagemQuery.data]);

  const salvar = useMutation({
    mutationFn: async (payload: PersonagemInput): Promise<number | null> => {
      if (editando) {
        await atualizarPersonagem(personagemId, payload);
        return null;
      }
      return criarPersonagem(payload);
    },
    onSuccess: (novoId) => {
      qc.invalidateQueries({ queryKey: ["personagens"] });
      qc.invalidateQueries({ queryKey: ["etiquetas"] }); // o save pode ter criado etiqueta nova
      if (editando) {
        qc.invalidateQueries({ queryKey: ["personagem", personagemId] });
        toast.sucesso("Ficha atualizada.");
        navigate(`/fichas/${personagemId}`);
      } else if (novoId != null) {
        toast.sucesso("Personagem criado.");
        navigate(`/fichas/${novoId}`);
      }
    },
    onError: (e) => toast.erro(String(e)),
  });

  const imagensIA = useImagemDaFicha(form.retrato);

  if (idInvalido) return <ErroForm mensagem="Ficha inválida." />;
  if (catalogosQuery.isError) return <ErroForm mensagem={String(catalogosQuery.error)} />;
  if (editando && personagemQuery.isError)
    return <ErroForm mensagem={String(personagemQuery.error)} />;
  if (!catalogosQuery.data || (editando && !prefilled.current)) return <EsqueletoForm />;

  const catalogos = catalogosQuery.data;
  const podeSalvar = form.nome.trim() !== "" && !salvar.isPending;
  const cancelar = () => navigate(editando ? `/fichas/${personagemId}` : "/");

  const abas: Aba[] = [
    {
      id: "habilidades",
      label: "Habilidades",
      conteudo: (
        <HabilidadesEditor
          itens={form.habilidades}
          onChange={(habilidades) => setForm((f) => ({ ...f, habilidades }))}
        />
      ),
    },
    {
      id: "pericias",
      label: "Perícias",
      conteudo: (
        <PericiasEditor
          itens={form.pericias}
          onChange={(pericias) => setForm((f) => ({ ...f, pericias }))}
          catalogo={catalogos.pericias}
        />
      ),
    },
    {
      id: "vantagens",
      label: "Vantagens",
      conteudo: (
        <ListaEditavel<TracoDto>
          itens={form.vantagens}
          onChange={(vantagens) => setForm((f) => ({ ...f, vantagens }))}
          criarVazio={() => ({ nome: "", descricao: "", efeito: "", uid: novaChave() })}
          textoAdicionar="Adicionar vantagem"
          textoVazio="Nenhuma vantagem ainda."
          render={renderTraco}
          acaoExtra={
            <CatalogoPicker
              titulo="Vantagens do catálogo"
              itens={catalogos.vantagens}
              onEscolher={(t) =>
                setForm((f) => ({
                  ...f,
                  vantagens: [
                    ...f.vantagens,
                    { nome: t.nome, descricao: t.descricao, efeito: t.efeito, uid: novaChave() },
                  ],
                }))
              }
            />
          }
        />
      ),
    },
    {
      id: "desvantagens",
      label: "Desvantagens",
      conteudo: (
        <ListaEditavel<TracoDto>
          itens={form.desvantagens}
          onChange={(desvantagens) => setForm((f) => ({ ...f, desvantagens }))}
          criarVazio={() => ({ nome: "", descricao: "", efeito: "", uid: novaChave() })}
          textoAdicionar="Adicionar desvantagem"
          textoVazio="Nenhuma desvantagem ainda."
          render={renderTraco}
          acaoExtra={
            <CatalogoPicker
              titulo="Desvantagens do catálogo"
              itens={catalogos.desvantagens}
              onEscolher={(t) =>
                setForm((f) => ({
                  ...f,
                  desvantagens: [
                    ...f.desvantagens,
                    { nome: t.nome, descricao: t.descricao, efeito: t.efeito, uid: novaChave() },
                  ],
                }))
              }
            />
          }
        />
      ),
    },
    {
      id: "transformacoes",
      label: "Transformações",
      conteudo: (
        <TransformacoesEditor
          itens={form.transformacoes}
          habilidadesBase={form.habilidades}
          onChange={(transformacoes) => setForm((f) => ({ ...f, transformacoes }))}
        />
      ),
    },
  ];

  return (
    <div className={PAGINA_FICHA}>
      {/* Barra de ação fixa */}
      <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-100">
            {editando ? `Editar ${form.nome || "personagem"}` : "Novo personagem"}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={cancelar} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => salvar.mutate(form)}
              disabled={!podeSalvar}
              className={BOTAO_PRIMARIO}
            >
              <IconCheck className="size-4" />
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>

      {/* 3 colunas a partir de 1800px: base · abas · chat. Abaixo disso o chat empilha
          ocupando a linha inteira (col-span) com altura fixa. */}
      <div className={GRID_FICHA}>
        <div className="space-y-5">
          <SecaoBase valor={form} onChange={(parcial) => setForm((f) => ({ ...f, ...parcial }))} />
          <RetratoUpload
            retrato={form.retrato}
            nome={form.nome}
            onChange={(retrato) => setForm((f) => ({ ...f, retrato }))}
          />
          {/* Só NPC: a lista de jogadores é curta e fica plana de propósito. */}
          {form.tipo === "npc" && (
            <EtiquetasEditor
              valor={form.etiquetas}
              onChange={(etiquetas) => setForm((f) => ({ ...f, etiquetas }))}
            />
          )}
        </div>
        {/* `self-start` é o que impede a coluna do meio de esticar até os ~100vh que o
            chat impõe à linha do grid: sem ele o `h-full` do Tabs vira altura fixa e a
            lista passa a rolar numa caixa aninhada em vez de crescer a página. */}
        <div className="min-w-0 @min-[1040px]:self-start">
          <Tabs abas={abas} />
        </div>
        {/* Chat sempre visível. Empilhado ocupando a linha inteira enquanto não cabe
            a 3ª coluna; vira coluna sticky quando cabe. Barra sticky = py-3 (1,5rem) +
            botão h-9 (2,25rem) + borda ≈ 3,8rem; `top` é isso + respiro e a altura
            desconta topo + folga inferior. */}
        <aside className="h-[32rem] @min-[720px]:col-span-2 @min-[1040px]:col-span-1 @min-[1040px]:col-start-3 @min-[1040px]:row-start-1 @min-[1040px]:sticky @min-[1040px]:top-[4.25rem] @min-[1040px]:h-[calc(100vh-5.75rem)]">
          <PainelIA
            // Uma conversa por ficha: sair pra consultar outra e voltar não mistura
            // (nem perde) o papo. Ficha nova ainda sem id usa um escopo próprio.
            escopo={editando ? `ficha:${personagemId}` : "ficha:nova"}
            // O id vai junto pra dedupe: renomear a ficha no form não pode fazer
            // a mesma pessoa entrar duas vezes no contexto da IA.
            fichas={[dePersonagemInput(form, editando && !idInvalido ? personagemId : undefined)]}
            prontas
            imagens={imagensIA.map((imagem) => ({ nome: form.nome || "(sem nome)", imagem }))}
            titulo="Discutir esta ficha"
          />
        </aside>
      </div>
    </div>
  );
}

/* --------------------------- Render de itens (abas) ------------------------ */

function renderTraco(item: TracoDto, atualizar: (p: Partial<TracoDto>) => void) {
  return (
    <>
      <CampoTexto label="Nome" valor={item.nome} onChange={(nome) => atualizar({ nome })} />
      <Textarea
        label="Descrição"
        valor={item.descricao}
        onChange={(descricao) => atualizar({ descricao })}
        linhas={2}
      />
      <CampoTexto label="Efeito" valor={item.efeito} onChange={(efeito) => atualizar({ efeito })} />
    </>
  );
}

/* ------------------------------ Estados de tela --------------------------- */

function ErroForm({ mensagem }: { mensagem: string }) {
  return (
    <div className={PAGINA_FICHA}>
      <Link
        to="/"
        className="group mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
      >
        <IconVoltar className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        Fichas
      </Link>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-medium text-rose-300">Não foi possível abrir o formulário</p>
        <p className="mt-1 max-w-md text-sm text-slate-500">{mensagem}</p>
      </div>
    </div>
  );
}

function EsqueletoForm() {
  return (
    <div className={PAGINA_FICHA}>
      <div className="mb-6 h-12 w-full animate-pulse rounded-xl bg-slate-900/60" />
      <div className={GRID_FICHA}>
        <div className="h-[520px] animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
        <div className="space-y-3 @min-[1040px]:self-start">
          <div className="h-10 w-full animate-pulse rounded-lg bg-slate-900/60" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 w-full animate-pulse rounded-xl bg-slate-900/60" />
          ))}
        </div>
        {/* Mesma altura do <aside> real, senão a coluna da direita pula ~470px quando
            o esqueleto sai. */}
        <div className="h-[32rem] animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60 @min-[720px]:col-span-2 @min-[1040px]:col-span-1 @min-[1040px]:col-start-3 @min-[1040px]:row-start-1 @min-[1040px]:h-[calc(100vh-5.75rem)]" />
      </div>
    </div>
  );
}

/* --------------------------------- Helpers -------------------------------- */

function inputVazio(): PersonagemInput {
  return {
    tipo: "jogador",
    nome: "",
    descricao: "",
    hp: 0,
    sp: 0,
    escudo: 0,
    forca: 0,
    agilidade: 0,
    percepcao: 0,
    resistencia: 0,
    intuicao: 0,
    espirito: 0,
    carisma: 0,
    determinacao: 0,
    retrato: { modo: "nenhum" },
    habilidades: [],
    pericias: [],
    vantagens: [],
    desvantagens: [],
    transformacoes: [],
    etiquetas: [],
  };
}

/** Converte a ficha (leitura) no estado do form; clona coleções pra não mexer no cache. */
function paraInput(p: PersonagemCompleto): PersonagemInput {
  const attr: Record<string, number> = {};
  for (const a of p.atributos) attr[a.nome] = a.valor;
  const valor = (nome: string) => attr[nome] ?? 0;

  return {
    tipo: p.tipo,
    nome: p.nome,
    descricao: p.descricao,
    hp: p.hp,
    sp: p.sp,
    escudo: p.escudo,
    forca: valor("forca"),
    agilidade: valor("agilidade"),
    percepcao: valor("percepcao"),
    resistencia: valor("resistencia"),
    intuicao: valor("intuicao"),
    espirito: valor("espirito"),
    carisma: valor("carisma"),
    determinacao: valor("determinacao"),
    retrato: p.retrato ? { modo: "manter", caminho: p.retrato } : { modo: "nenhum" },
    habilidades: p.habilidades.map(habilidadeParaInput),
    pericias: p.pericias.map((pe) => ({ ...pe, uid: novaChave() })),
    vantagens: p.vantagens.map((v) => ({ ...v, uid: novaChave() })),
    desvantagens: p.desvantagens.map((d) => ({ ...d, uid: novaChave() })),
    transformacoes: p.transformacoes.map((t) => ({
      nome: t.nome,
      descricao: t.descricao,
      retrato: t.retrato ? { modo: "manter", caminho: t.retrato } : { modo: "nenhum" },
      modificadores: t.modificadores.map((m) => ({ ...m, uid: novaChave() })),
      habilidades: t.habilidades.map(habilidadeParaInput),
      uid: novaChave(),
    })),
    etiquetas: [...p.etiquetas],
  };
}

/**
 * Técnica vinda do banco no formato do form. Duas garantias que só existem aqui,
 * na fronteira de entrada:
 * - `uid` também nos campos personalizados: sem ele a linha caía na chave por
 *   índice e remover um campo do meio deixava o cursor na linha errada;
 * - `campos_extras` sempre array: o save é replace-all e o `HabilidadeInput` do
 *   Rust exige a chave (sem `serde(default)`), então ela nunca pode faltar.
 */
function habilidadeParaInput(h: HabilidadeDto): HabilidadeDto {
  return {
    ...h,
    campos_extras: (h.campos_extras ?? []).map((c) => ({ ...c, uid: novaChave() })),
    uid: novaChave(),
  };
}
