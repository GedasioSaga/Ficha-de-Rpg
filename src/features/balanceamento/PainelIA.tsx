// src/features/balanceamento/PainelIA.tsx
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configGet,
  getNota,
  getPersonagem,
  listarCatalogos,
  listarNotas,
  listarPersonagens,
  retratoDataUrl,
} from "../../lib/api";
import {
  CONFIG_CHAVES,
  ErroSemChave,
  gerarConteudo,
  imagemDeDataUrl,
  type ImagemIA,
  type MensagemIA,
  parseChaves,
} from "../../lib/gemini";
import type { Nota, PersonagemCompleto } from "../../lib/types";
import Markdown from "../../components/Markdown";
import { useToast } from "../../components/Toast";
import {
  CONFIG_REGRAS_NOTAS,
  dePersonagemCompleto,
  detectarMencoes,
  type FichaParaContexto,
  idsSemFicha,
  limitarMencoes,
  montarContextoTexto,
  montarIndiceElenco,
  selecionarNotasRegras,
  systemPromptPara,
} from "./prompts";
import { definirConversa, limparConversa, useConversa } from "./conversaIA";

/** Palavras que indicam pergunta sobre o visual do personagem. */
const REGEX_VISUAL = /\b(foto|imagem|retrato|visual|apar[êe]ncia|desenho|arte|estilo)\b/i;

export default function PainelIA({
  fichas,
  prontas,
  imagens,
  escopo,
  titulo = "Conversar com IA",
}: {
  fichas: FichaParaContexto[];
  prontas: boolean;
  /** Retratos enviados junto da pergunta, com o nome do dono de cada um. */
  imagens?: { nome: string; imagem: ImagemIA }[];
  /**
   * Identidade da conversa (ex.: "balanceamento", "ficha:12"). O histórico vive
   * num store de módulo e sobrevive a trocar de tela; o escopo é o que impede a
   * conversa de uma ficha de aparecer na de outra.
   */
  escopo: string;
  titulo?: string;
}) {
  /** Só a conversa visível — o bloco de contexto nunca entra aqui. */
  const historico = useConversa(escopo);
  const setHistorico = (mensagens: MensagemIA[]) => definirConversa(escopo, mensagens);
  const [pergunta, setPergunta] = useState("");
  const toast = useToast();
  const qc = useQueryClient();

  const { data: catalogos } = useQuery({ queryKey: ["catalogos"], queryFn: listarCatalogos });
  // Mesma queryKey do SeletorPersonagens: aproveita o cache em vez de nova ida ao banco.
  const { data: elenco = [] } = useQuery({
    queryKey: ["personagens", null],
    queryFn: () => listarPersonagens(null),
  });
  const indiceElenco = useMemo(() => montarIndiceElenco(elenco), [elenco]);
  // Só a contagem: o CSV das chaves não precisa ficar no cache desta tela.
  const { data: totalChaves = 0, isPending: carregandoChaves } = useQuery({
    queryKey: ["config", CONFIG_CHAVES, "contagem"],
    queryFn: async () => parseChaves(await configGet(CONFIG_CHAVES)).length,
  });
  const temChave = totalChaves > 0;
  const { data: titulosRegras } = useQuery({
    queryKey: ["config", CONFIG_REGRAS_NOTAS],
    queryFn: async () => {
      const bruto = await configGet(CONFIG_REGRAS_NOTAS);
      try {
        return bruto ? (JSON.parse(bruto) as string[]) : [];
      } catch {
        return [];
      }
    },
  });
  const { data: notasRegras = [], isFetching: buscandoRegras } = useQuery({
    queryKey: ["notas", "regras", titulosRegras],
    enabled: titulosRegras !== undefined,
    queryFn: async (): Promise<Nota[]> => {
      if (!titulosRegras?.length) return [];
      const resumos = await listarNotas();
      const alvo = resumos.filter((r) => titulosRegras.includes(r.titulo));
      return Promise.all(alvo.map((r) => getNota(r.id)));
    },
  });

  const prontasTudo = Boolean(
    prontas && catalogos && titulosRegras !== undefined && !buscandoRegras && temChave,
  );

  const chamarMut = useMutation({
    // `quantidade` vem do envio, não da prop: fichas citadas na pergunta também contam.
    mutationFn: ({
      mensagens,
      quantidade,
      temIndice,
    }: {
      mensagens: MensagemIA[];
      quantidade: number;
      temIndice: boolean;
    }) =>
      gerarConteudo(mensagens, {
        systemPrompt: systemPromptPara(quantidade, temIndice),
        aoTrocarChave: (i) => {
          toast.sucesso(`Chave anterior esgotou — usando a chave ${i + 1}.`);
          qc.invalidateQueries({ queryKey: ["config"] });
        },
      }),
    onError: (e) => {
      if (e instanceof ErroSemChave) toast.erro("Configure a chave da IA em Configurações.");
      else toast.erro(String(e));
    },
  });

  // O `ref` resolve a corrida (é síncrono); o state existe só pra UI refletir a
  // espera — carregar as fichas citadas acontece antes de a mutation começar.
  const enviando = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  function marcarOcupado(valor: boolean) {
    enviando.current = valor;
    setOcupado(valor);
  }

  /**
   * Carrega a ficha completa de cada personagem citado na pergunta e que ainda
   * não está no contexto, até o teto de fichas. Falha de uma ficha não derruba a
   * pergunta — mas o nome vai em `falhas` pra `montarContextoTexto` declarar a
   * lacuna no contexto, em vez de a IA simular o personagem só com o índice
   * como se fosse a ficha completa.
   */
  async function fichasCitadas(
    texto: string,
  ): Promise<{ carregadas: FichaParaContexto[]; falhas: string[] }> {
    const ids = limitarMencoes(
      idsSemFicha(detectarMencoes(texto, elenco), elenco, fichas),
      fichas.length,
    );
    const carregadas: FichaParaContexto[] = [];
    const falhas: string[] = [];
    for (const id of ids) {
      try {
        const p = await qc.fetchQuery({
          queryKey: ["personagem", id],
          queryFn: () => getPersonagem(id),
        });
        carregadas.push(dePersonagemCompleto(p));
      } catch {
        const nome = elenco.find((p) => p.id === id)?.nome;
        if (nome) falhas.push(nome);
      }
    }
    return { carregadas, falhas };
  }

  /**
   * O contexto (índice do elenco + fichas + regras + catálogos) e os retratos
   * viajam só na ÚLTIMA mensagem: refletem sempre o estado atual (ficha em
   * edição, seleção nova) sem repetir o bloco inteiro a cada turno.
   * `tudo` (botão "Analisar") manda TODAS as notas de regra, sem o filtro por
   * pergunta — o mestre pediu relatório completo.
   */
  async function enviar(texto: string, tudo = false) {
    if (!catalogos || enviando.current) return;
    marcarOcupado(true);
    const anterior = historico;
    const conversa: MensagemIA[] = [...historico, { role: "user", texto }];
    // O `catch` cobre só a montagem do contexto (buscar ficha citada, serializar):
    // sem ele um erro aqui deixaria o `enviando` travado e o chat mudo pra sempre.
    // Erro da chamada à IA continua caindo no `onError` da mutation.
    try {
      setHistorico(conversa);
      setPergunta("");
      const { carregadas, falhas } = await fichasCitadas(texto);
      const fichasContexto = [...fichas, ...carregadas];
      const { incluidas, omitidas } = selecionarNotasRegras(texto, fichasContexto, notasRegras, tudo);
      const contexto = montarContextoTexto(
        fichasContexto,
        incluidas,
        catalogos,
        indiceElenco,
        omitidas,
        falhas,
      );
      // A imagem é pesada: vai na primeira mensagem (pra ancorar o conceito) e
      // depois só quando a pergunta for sobre o visual.
      const imagensAnexar =
        historico.length === 0 || REGEX_VISUAL.test(texto) ? (imagens ?? []) : [];
      const legenda =
        imagensAnexar.length > 0
          ? `\n\n(Imagens anexadas, nesta ordem: ${imagensAnexar.map((i) => i.nome).join(", ")}.)`
          : "";
      // Fronteira explícita: modelo pequeno obedece a última instrução que leu,
      // então marcar onde o contexto termina e a pergunta do mestre começa
      // ajuda a não misturar "regra do sistema" com "o que foi perguntado".
      const comContexto = conversa.map((m, i) =>
        i === conversa.length - 1
          ? {
              ...m,
              texto: `${contexto}\n\n---\nPERGUNTA DO MESTRE:\n${texto}${legenda}`,
              imagens: imagensAnexar.map((i) => i.imagem),
            }
          : m,
      );
      chamarMut.mutate(
        {
          mensagens: comContexto,
          quantidade: fichasContexto.length,
          temIndice: indiceElenco !== "",
        },
        {
          onSuccess: (resposta) => {
            setHistorico([...conversa, { role: "model", texto: resposta }]);
            marcarOcupado(false);
          },
          onError: () => {
            setHistorico(anterior);
            // Só devolve o texto se o usuário não começou outra pergunta enquanto esperava.
            setPergunta((atual) => (atual.trim() === "" ? texto : atual));
            marcarOcupado(false);
          },
        },
      );
    } catch (e) {
      marcarOcupado(false);
      setHistorico(anterior);
      setPergunta((atual) => (atual.trim() === "" ? texto : atual));
      toast.erro(String(e));
    }
  }

  const podeEnviar = prontasTudo && !chamarMut.isPending && !ocupado;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
      <header className="flex items-center gap-2 border-b border-slate-800/80 px-4 py-3">
        <h2 className="flex-1 truncate text-sm font-semibold uppercase tracking-wide text-slate-400">
          {titulo}
        </h2>
        {historico.length > 0 && (
          <button
            type="button"
            onClick={() => limparConversa(escopo)}
            title="Apaga esta conversa e começa do zero"
            className="rounded-lg px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            Nova conversa
          </button>
        )}
        <button
          type="button"
          disabled={!podeEnviar || fichas.length === 0}
          onClick={() =>
            void enviar(
              fichas.length === 1 ? "Analise esta ficha." : "Analise o balanceamento.",
              true,
            )
          }
          title={fichas.length === 0 ? "Selecione ao menos um personagem" : undefined}
          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
        >
          Analisar
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {(titulosRegras?.length ?? 0) === 0 && (
          <p className="text-[11px] text-amber-400/80">
            Regras do Discord ainda não sincronizadas — a IA usa só fichas e catálogos.
          </p>
        )}
        {historico.length === 0 && !ocupado && !chamarMut.isPending && (
          <p className="text-sm text-slate-600">
            {fichas.length === 0
              ? "Pergunte sobre as regras do sistema — ou selecione personagens pra falar sobre eles."
              : "Pergunte o que quiser sobre a ficha (inclusive simulações de combate), ou clique em Analisar pra um relatório completo."}
            {(imagens?.length ?? 0) > 0 && " A IA também está vendo o retrato."}
          </p>
        )}
        {historico.map((m, i) =>
          m.role === "model" ? (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <Markdown texto={m.texto} />
            </div>
          ) : (
            <p
              key={i}
              className="ml-6 whitespace-pre-wrap rounded-xl bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100"
            >
              {m.texto}
            </p>
          ),
        )}
        {(ocupado || chamarMut.isPending) && (
          <p className="text-sm text-slate-500">Pensando…</p>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-800/80 p-3">
        {!carregandoChaves && !temChave && (
          <p className="text-[11px] text-amber-400/80">
            Configure a chave da IA em{" "}
            <Link
              to="/configuracoes"
              className="underline underline-offset-2 hover:text-amber-300"
            >
              Configurações
            </Link>
            .
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && podeEnviar && pergunta.trim()) void enviar(pergunta.trim());
            }}
            disabled={!prontasTudo}
            placeholder="Pergunte alguma coisa…"
            className="h-9 min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!podeEnviar || !pergunta.trim()}
            onClick={() => void enviar(pergunta.trim())}
            className="rounded-lg border border-slate-700 px-3 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
      </div>
    </section>
  );
}

/** Variante por ids (tela Balanceamento): busca as fichas, os retratos e converte. */
export function PainelIAPersonagens({ ids }: { ids: number[] }) {
  const consultas = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["personagem", id],
      queryFn: () => getPersonagem(id),
    })),
  });
  const prontas = consultas.every((c) => c.data);
  const fichas = prontas
    ? consultas.map((c) => dePersonagemCompleto(c.data as PersonagemCompleto))
    : [];

  const personagensComRetrato = prontas
    ? consultas
        .map((c) => c.data as PersonagemCompleto)
        .filter((p): p is PersonagemCompleto & { retrato: string } => Boolean(p.retrato))
    : [];
  const retratos = useQueries({
    queries: personagensComRetrato.map((p) => ({
      queryKey: ["retrato", p.retrato],
      queryFn: () => retratoDataUrl(p.retrato),
      staleTime: Infinity,
    })),
  });
  const imagens = personagensComRetrato
    .map((p, i) => {
      const imagem = imagemDeDataUrl(retratos[i].data);
      return imagem ? { nome: p.nome, imagem } : null;
    })
    .filter((i): i is { nome: string; imagem: ImagemIA } => i !== null);

  // Sem `key`: a conversa sobrevive à troca de seleção — o contexto atual vai
  // junto de cada pergunta, então as respostas seguem os personagens de agora.
  // Escopo fixo: a conversa é sobre "os personagens selecionados agora", e o
  // contexto atual vai junto de cada pergunta — trocar a seleção continua a
  // mesma conversa em vez de jogar fora o que já foi discutido.
  return <PainelIA escopo="balanceamento" fichas={fichas} prontas={prontas} imagens={imagens} />;
}
