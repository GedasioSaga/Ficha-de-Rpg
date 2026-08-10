import {
  CORES_DISPONIVEIS,
  CORES_PADRAO,
  definirCorTerreno,
  resetarCoresTerreno,
  useCoresTerreno,
} from "./coresTerreno";
import { PALETA, corDaCelula } from "./logica";

/**
 * Escolha de cor de cada símbolo do mapa.
 *
 * Cada botão de cor desenha o PRÓPRIO símbolo naquela cor, em vez de um
 * quadradinho colorido genérico: o que se está escolhendo é como aquele
 * caractere vai aparecer na grade, então mostrar exatamente isso dispensa
 * imaginar o resultado.
 */
export default function PainelCores({ onFechar }: { onFechar: () => void }) {
  const cores = useCoresTerreno();
  const personalizados = Object.keys(cores).length;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Cores dos símbolos
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Vale em todos os mapas. O Discord recebe texto sem cor — isto é só aqui no app.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={resetarCoresTerreno}
            disabled={personalizados === 0}
            title={
              personalizados > 0
                ? "Voltar todos os símbolos às cores de fábrica"
                : "Já está tudo na cor de fábrica"
            }
            className="inline-flex h-7 items-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none"
          >
            Resetar padrão
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="inline-flex h-7 items-center rounded-md border border-slate-800 bg-slate-900 px-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            Fechar
          </button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {PALETA.map((terreno) => {
          const atual = corDaCelula(terreno.char, cores);
          return (
            <li key={terreno.char} className="flex items-center gap-2">
              <span className="flex w-28 shrink-0 items-center gap-2">
                <span className={`font-mono text-base ${atual}`}>{terreno.char}</span>
                <span className="truncate text-xs text-slate-400">{terreno.nome}</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {CORES_DISPONIVEIS.map((cor) => {
                  const ativa = atual === cor.classe;
                  return (
                    <button
                      key={cor.classe}
                      type="button"
                      onClick={() => definirCorTerreno(terreno.char, cor.classe)}
                      aria-pressed={ativa}
                      aria-label={`${terreno.nome} em ${cor.nome}`}
                      title={cor.nome}
                      className={`flex size-6 items-center justify-center rounded font-mono text-sm transition-colors ${cor.classe} ${
                        ativa
                          ? "bg-slate-700 ring-1 ring-inset ring-indigo-400"
                          : "hover:bg-slate-800"
                      }`}
                    >
                      {terreno.char}
                    </button>
                  );
                })}
              </div>
              {cores[terreno.char] && (
                <button
                  type="button"
                  onClick={() => definirCorTerreno(terreno.char, CORES_PADRAO[terreno.char] ?? "")}
                  title="Voltar este símbolo à cor de fábrica"
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                >
                  padrão
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
