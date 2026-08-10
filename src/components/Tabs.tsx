import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface Aba {
  id: string;
  label: string;
  conteudo: ReactNode;
}

/**
 * Abas simples e acessíveis (padrão ARIA tablist), sem dependências.
 * Setas ←/→ navegam entre as abas (roving tabindex).
 */
export default function Tabs({
  abas,
  rotulo = "Seções",
}: {
  abas: Aba[];
  rotulo?: string;
}) {
  const [ativa, setAtiva] = useState(0);
  const baseId = useId();
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>) {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (passo === 0) return;
    e.preventDefault();
    const prox = (ativa + passo + abas.length) % abas.length;
    setAtiva(prox);
    botoes.current[prox]?.focus();
  }

  return (
    // h-full só "pega" quando o pai já dá altura definida (telas cockpit como
    // Batalha); sem isso vira auto e o bloco só cresce com o conteúdo — mesmo
    // componente serve pros dois casos, igual o padrão já usado em Mapa/Notas.
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={rotulo}
        // overflow-y-hidden é necessário: com só overflow-x-auto, o navegador
        // "promove" o eixo Y (visible) pra auto também — vira uma 2ª scrollbar
        // vertical falsa colada na borda direita, ao lado da da tela inteira.
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-800"
      >
        {abas.map((aba, i) => {
          const selecionada = i === ativa;
          return (
            <button
              key={aba.id}
              ref={(el) => {
                botoes.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${aba.id}`}
              aria-selected={selecionada}
              aria-controls={`${baseId}-panel-${aba.id}`}
              tabIndex={selecionada ? 0 : -1}
              onClick={() => setAtiva(i)}
              onKeyDown={aoTeclar}
              className={`relative -mb-px whitespace-nowrap rounded-t-md px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
                selecionada
                  ? "text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {aba.label}
              {selecionada && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-400" />
              )}
            </button>
          );
        })}
      </div>

      {abas.map((aba, i) => (
        <div
          key={aba.id}
          role="tabpanel"
          id={`${baseId}-panel-${aba.id}`}
          aria-labelledby={`${baseId}-tab-${aba.id}`}
          hidden={i !== ativa}
          className="min-h-0 flex-1 overflow-auto pt-5 focus:outline-none"
          tabIndex={0}
        >
          {i === ativa && aba.conteudo}
        </div>
      ))}
    </div>
  );
}
