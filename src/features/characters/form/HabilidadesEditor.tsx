import { useState } from "react";
import type { CampoExtraDto, HabilidadeDto } from "../../../lib/types";
import { IconLixeira, IconMais } from "../../../components/icons";
import { CampoTexto, INPUT, Textarea } from "./Campos";
import { habilidadeVazia, novaChave } from "./chave";
import { resumoTecnica } from "../CamposTecnica";

/* A lixeira compartilhada (`BOTAO_LIXEIRA`) tem 36px e o `BOTAO_SECUNDARIO`, 36px;
   aqui os dois alvos são 44px, o mínimo de toque do projeto. Não mexo nas constantes
   compartilhadas pra não alterar as outras listas neste mesmo passo. Também não dá
   pra concatenar `${BOTAO_SECUNDARIO} h-11`: h-9 e h-11 disputam a mesma propriedade
   e a ordem no atributo não decide o vencedor. */
const BOTAO_LIXEIRA_44 =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-slate-800 text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40";
const BOTAO_ADICIONAR_44 =
  "inline-flex items-center gap-1.5 h-11 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40";

const CHIP =
  "max-w-[5.5rem] truncate rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-400";

/* O conjunto de técnicas abertas vive fora do componente porque o `Tabs` desmonta a
   aba inativa: com state local, ir em Perícias e voltar fechava tudo — inclusive a
   técnica recém-adicionada, que nasce aberta e reapareceria como "(sem nome)",
   parecendo que o clique não pegou. O `uid` é único no processo inteiro
   (`chave.ts`), então nenhuma outra ficha reaproveita essas chaves. */
const ABERTOS = new Set<string>();

/**
 * Editor de técnicas em accordion: fechada, cada uma ocupa uma linha (nome + chips
 * de Ação/Custo/Dano); aberta, mostra a edição completa. Serve à forma base e às
 * transformações — com 10 técnicas, a pilha de campos soltos virava um paredão.
 *
 * O aberto/fechado é indexado pelo `uid` da técnica, não pela posição: remover a
 * 2ª de 5 reindexaria a lista e abriria a técnica errada.
 */
export default function HabilidadesEditor({
  itens,
  onChange,
}: {
  itens: HabilidadeDto[];
  onChange: (itens: HabilidadeDto[]) => void;
}) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(() => new Set(ABERTOS));

  /* O `ABERTOS` é mutado fora do updater de propósito: em StrictMode o React chama o
     updater duas vezes, e um toggle aplicado duas vezes se anularia. */
  const alternar = (chave: string) => {
    if (!ABERTOS.delete(chave)) ABERTOS.add(chave);
    setAbertos(new Set(ABERTOS));
  };

  const atualizar = (indice: number, patch: Partial<HabilidadeDto>) =>
    onChange(itens.map((h, i) => (i === indice ? { ...h, ...patch } : h)));

  const remover = (indice: number) => {
    const uid = itens[indice]?.uid;
    onChange(itens.filter((_, i) => i !== indice));
    if (uid == null) return;
    ABERTOS.delete(uid);
    setAbertos(new Set(ABERTOS));
  };

  // Técnica nova nasce aberta: quem clicou em "adicionar" quer digitar agora.
  const adicionar = () => {
    const uid = novaChave();
    onChange([...itens, habilidadeVazia(uid)]);
    ABERTOS.add(uid);
    setAbertos(new Set(ABERTOS));
  };

  return (
    <div className="@container space-y-2">
      {itens.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-800 py-6 text-center text-sm text-slate-500">
          Nenhuma habilidade ainda.
        </p>
      )}

      {itens.map((h, i) => {
        const chave = h.uid ?? `sem-uid-${i}`;
        const aberto = abertos.has(chave);
        return (
          <div key={chave} className="rounded-xl border border-slate-800 bg-slate-900/60">
            <button
              type="button"
              aria-expanded={aberto}
              onClick={() => alternar(chave)}
              className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
              <Chevron aberto={aberto} />
              <span className="min-w-[7rem] flex-1 truncate text-sm font-medium text-slate-100">
                {(h.nome ?? "").trim() || "(sem nome)"}
              </span>
              {!aberto && <Resumo habilidade={h} />}
            </button>

            {aberto && (
              <div className="space-y-3 border-t border-slate-800 p-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <CampoTexto
                      label="Nome"
                      valor={h.nome}
                      onChange={(nome) => atualizar(i, { nome })}
                      placeholder="Grande Chifre"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remover(i)}
                    aria-label="Remover habilidade"
                    className={BOTAO_LIXEIRA_44}
                  >
                    <IconLixeira className="size-4" />
                  </button>
                </div>

                <Textarea
                  label="Descrição"
                  valor={h.descricao}
                  onChange={(descricao) => atualizar(i, { descricao })}
                  linhas={2}
                />

                {/* Ordem canônica do sistema: Ação, Efeito, Custo, Tempo, Dano. A leitura
                    é por linha, então a ordem se mantém em 2, 3 ou 5 colunas. */}
                <div className="grid grid-cols-2 gap-2 @min-[420px]:grid-cols-3 @min-[680px]:grid-cols-5">
                  <CampoTexto
                    label="Ação"
                    valor={h.acao}
                    onChange={(acao) => atualizar(i, { acao })}
                    placeholder="Completa"
                  />
                  <CampoTexto
                    label="Efeito"
                    valor={h.efeito}
                    onChange={(efeito) => atualizar(i, { efeito })}
                    placeholder="Nenhum"
                  />
                  <CampoTexto
                    label="Custo"
                    valor={h.custo}
                    onChange={(custo) => atualizar(i, { custo })}
                    placeholder="-30 de SP"
                  />
                  <CampoTexto
                    label="Tempo"
                    valor={h.tempo}
                    onChange={(tempo) => atualizar(i, { tempo })}
                    placeholder="1 rodada"
                  />
                  <CampoTexto
                    label="Dano"
                    valor={h.dano}
                    onChange={(dano) => atualizar(i, { dano })}
                    placeholder="Força + Agilidade"
                  />
                </div>

                <CamposExtras
                  lista={h.campos_extras ?? []}
                  onChange={(campos_extras) => atualizar(i, { campos_extras })}
                />
              </div>
            )}
          </div>
        );
      })}

      <button type="button" onClick={adicionar} className={BOTAO_ADICIONAR_44}>
        <IconMais className="size-4" />
        Adicionar habilidade
      </button>
    </div>
  );
}

/**
 * Resumo da técnica fechada. A regra de quais campos entram é a mesma do cockpit
 * (`resumoTecnica`) de propósito: são duas telas mostrando a mesma técnica, e
 * divergir aqui faria uma parecer duas.
 *
 * Some abaixo de 480px de coluna em vez de empurrar quebra de linha: com os valores
 * reais do sistema, 24 (seta) + 112 (nome) + 3 chips de 5.5rem + gaps ≈ 424px, então
 * na coluna estreita (~330px, com o chat lateral aberto) a linha fechada viraria
 * duas — o oposto da densidade que o accordion existe pra dar. O `@container` está
 * no root do editor, então a medida é a da coluna real, não a da janela.
 */
function Resumo({ habilidade }: { habilidade: HabilidadeDto }) {
  const chips = resumoTecnica(habilidade);
  if (chips.length === 0) return null;

  return (
    <span className="hidden shrink-0 items-center gap-1 @min-[480px]:flex">
      {chips.map((texto, i) => (
        <span key={`${i}-${texto}`} className={CHIP}>
          {texto}
        </span>
      ))}
    </span>
  );
}

/** Pares nome/valor livres (ex.: "Alcance: 15m"), exibidos depois dos fixos. */
function CamposExtras({
  lista,
  onChange,
}: {
  lista: CampoExtraDto[];
  onChange: (lista: CampoExtraDto[]) => void;
}) {
  const atualizar = (indice: number, patch: Partial<CampoExtraDto>) =>
    onChange(lista.map((c, i) => (i === indice ? { ...c, ...patch } : c)));
  const remover = (indice: number) => onChange(lista.filter((_, i) => i !== indice));
  const adicionar = () => onChange([...lista, { nome: "", valor: "", uid: novaChave() }]);

  return (
    <div className="space-y-2">
      {lista.length > 0 && (
        <span className="block text-xs font-medium text-slate-400">Campos personalizados</span>
      )}

      {lista.map((campo, i) => (
        <div key={campo.uid ?? i} className="flex items-center gap-2">
          {/* Rótulo viraria ruído repetido linha a linha: o próprio nome do campo é o
              rótulo, então os inputs usam placeholder + aria-label. */}
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 @min-[300px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <input
              type="text"
              value={campo.nome}
              placeholder="Alcance"
              aria-label="Nome do campo personalizado"
              onChange={(e) => atualizar(i, { nome: e.target.value })}
              className={INPUT}
            />
            <input
              type="text"
              value={campo.valor}
              placeholder="15m"
              aria-label="Valor do campo personalizado"
              onChange={(e) => atualizar(i, { valor: e.target.value })}
              className={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => remover(i)}
            aria-label="Remover campo personalizado"
            className={BOTAO_LIXEIRA_44}
          >
            <IconLixeira className="size-4" />
          </button>
        </div>
      ))}

      <button type="button" onClick={adicionar} className={BOTAO_ADICIONAR_44}>
        <IconMais className="size-4" />
        Campo personalizado
      </button>
    </div>
  );
}

/* Único movimento da lista: a seta gira. Sem animar altura — abrir/fechar técnica é
   ação de alta frequência e a espera acumularia a cada clique. */
function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`size-4 shrink-0 text-slate-500 transition-transform duration-150 ease-out ${
        aberto ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
