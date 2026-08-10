import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapaInput } from "../../lib/types";
import {
  COLUNAS_MAX,
  COLUNAS_MIN,
  CELULA_VAZIA,
  LINHAS_MAX,
  LINHAS_MIN,
  PALETA,
  corDaCelula,
  normalizarGrade,
  pintar,
  rotuloColuna,
} from "./logica";
import { useCoresTerreno, type CoresTerreno } from "./coresTerreno";
import { balde, limparTudo, linhaReta, retangulo, substituirTodos } from "./ferramentas";

type Ferramenta = "pincel" | "balde" | "borracha" | "linha" | "retangulo-contorno" | "retangulo-cheio";

/** Ferramenta ↔ atalho de teclado (letra única, minúscula). */
const ATALHOS_FERRAMENTA: Record<string, Ferramenta> = {
  p: "pincel",
  b: "balde",
  a: "borracha",
  l: "linha",
  r: "retangulo-contorno",
  f: "retangulo-cheio",
};

const ROTULO_FERRAMENTA: Record<Ferramenta, string> = {
  pincel: "Pincel",
  balde: "Balde",
  borracha: "Borracha",
  linha: "Linha",
  "retangulo-contorno": "Retângulo (contorno)",
  "retangulo-cheio": "Retângulo (cheio)",
};

export default function GradeEditor({
  input,
  onEditar,
}: {
  input: MapaInput;
  onEditar: (patch: Partial<MapaInput>) => void;
}) {
  const cores = useCoresTerreno();
  const [ativo, setAtivo] = useState("X");
  const [ferramenta, setFerramenta] = useState<Ferramenta>("pincel");
  // prévia local: pincel/borracha acumulam células pintadas; linha/retângulo guardam só a origem
  // e recalculam o traço a cada movimento. Nenhuma delas toca `input.grade` antes de soltar o botão.
  const [previaLivre, setPreviaLivre] = useState<string[] | null>(null);
  const [origemArraste, setOrigemArraste] = useState<{ r: number; c: number } | null>(null);
  const [destinoArraste, setDestinoArraste] = useState<{ r: number; c: number } | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  // texto livre enquanto digita — só vira número/clamp em confirmarCol/confirmarLin (blur/Enter)
  const [colStr, setColStr] = useState(String(input.colunas));
  const [linStr, setLinStr] = useState(String(input.linhas));
  const [substituirAlvo, setSubstituirAlvo] = useState(CELULA_VAZIA);
  const [substituirNovo, setSubstituirNovo] = useState("X");

  useEffect(() => setColStr(String(input.colunas)), [input.colunas]);
  useEffect(() => setLinStr(String(input.linhas)), [input.linhas]);

  // espelha o estado mais recente pra handlers estáveis (useCallback com deps []) lerem sem
  // precisar recriar a cada render — é isso que deixa as células memoizadas por linha valerem a pena.
  const estadoRef = useRef({ input, ativo, ferramenta, previaLivre, origemArraste });
  estadoRef.current = { input, ativo, ferramenta, previaLivre, origemArraste };

  // solta o arraste mesmo se o mouseup acontecer fora da grade (evita "pincel grudado")
  useEffect(() => {
    function soltar() {
      const { ferramenta: f, previaLivre: p, origemArraste: o, input: i } = estadoRef.current;
      if (f === "pincel" || f === "borracha") {
        if (p) onEditar({ grade: p });
      } else if (o && destinoArraste) {
        onEditar({ grade: aplicarTracado(i.grade, f, o, destinoArraste, estadoRef.current.ativo) });
      }
      setPreviaLivre(null);
      setOrigemArraste(null);
      setDestinoArraste(null);
    }
    window.addEventListener("mouseup", soltar);
    return () => window.removeEventListener("mouseup", soltar);
    // destinoArraste só é lido dentro do handler via closure — precisa estar atualizado no momento
    // do soltar, então entra nas deps pra reanexar o listener com o valor corrente.
  }, [destinoArraste, onEditar]);

  function aplicarTracado(
    grade: string[],
    f: Ferramenta,
    origem: { r: number; c: number },
    destino: { r: number; c: number },
    char: string,
  ): string[] {
    if (f === "linha") return linhaReta(grade, origem.r, origem.c, destino.r, destino.c, char);
    if (f === "retangulo-contorno")
      return retangulo(grade, origem.r, origem.c, destino.r, destino.c, char, false);
    return retangulo(grade, origem.r, origem.c, destino.r, destino.c, char, true);
  }

  const aoPressionarCelula = useCallback((r: number, c: number) => {
    const { input: i, ativo: at, ferramenta: f } = estadoRef.current;
    if (f === "pincel" || f === "borracha") {
      const char = f === "borracha" ? CELULA_VAZIA : at;
      setPreviaLivre(pintar(i.grade, r, c, char));
    } else if (f === "balde") {
      onEditar({ grade: balde(i.grade, r, c, at) });
    } else {
      setOrigemArraste({ r, c });
      setDestinoArraste({ r, c });
    }
  }, [onEditar]);

  const aoEntrarCelula = useCallback((r: number, c: number) => {
    setHover({ r, c });
    const { ferramenta: f, previaLivre: p, origemArraste: o, ativo: at } = estadoRef.current;
    if ((f === "pincel" || f === "borracha") && p) {
      const char = f === "borracha" ? CELULA_VAZIA : at;
      setPreviaLivre(pintar(p, r, c, char));
    } else if (o) {
      setDestinoArraste({ r, c });
    }
  }, []);

  // grade efetivamente mostrada: prévia de arraste (se houver) por cima da grade salva
  const gradeExibida = useMemo(() => {
    if (previaLivre) return previaLivre;
    if (origemArraste && destinoArraste) {
      return aplicarTracado(input.grade, ferramenta, origemArraste, destinoArraste, ativo);
    }
    return input.grade;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previaLivre, origemArraste, destinoArraste, input.grade, ferramenta, ativo]);

  function mudarDim(colunas: number, linhas: number) {
    const cols = Math.max(COLUNAS_MIN, Math.min(COLUNAS_MAX, colunas || COLUNAS_MIN));
    const lins = Math.max(LINHAS_MIN, Math.min(LINHAS_MAX, linhas || LINHAS_MIN));
    onEditar({ colunas: cols, linhas: lins, grade: normalizarGrade(input.grade, cols, lins) });
  }
  // só resolve/clampa ao terminar de digitar — digitar "20" não pode cortar a grade já no "2"
  function confirmarCol() {
    mudarDim(Number(colStr), input.linhas);
  }
  function confirmarLin() {
    mudarDim(input.colunas, Number(linStr));
  }

  function aoClicarLimparTudo() {
    if (!window.confirm("Limpar o mapa inteiro? Essa ação apaga todo o desenho (dá pra desfazer com Ctrl+Z).")) return;
    onEditar({ grade: limparTudo(input.grade) });
  }

  function aoClicarSubstituir() {
    onEditar({ grade: substituirTodos(input.grade, substituirAlvo, substituirNovo) });
  }

  // atalhos de ferramenta (letra) e de paleta (dígito) — ignora quando o foco está num campo de texto
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const alvo = ev.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

      const tecla = ev.key.toLowerCase();
      const ferramentaNova = ATALHOS_FERRAMENTA[tecla];
      if (ferramentaNova) {
        setFerramenta(ferramentaNova);
        return;
      }
      const indice = Number(tecla) - 1;
      if (Number.isInteger(indice) && indice >= 0 && indice < PALETA.length) {
        setAtivo(PALETA[indice].char);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PALETA.map((p, i) => (
          <button
            key={p.char}
            type="button"
            title={`${p.nome} (${i + 1})`}
            onClick={() => setAtivo(p.char)}
            className={`h-8 w-8 rounded font-mono text-base ${corDaCelula(p.char, cores)} ${
              ativo === p.char ? "ring-2 ring-indigo-400" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {p.char}
          </button>
        ))}
        <input
          value={ativo}
          maxLength={1}
          onChange={(e) => setAtivo((e.target.value || "-").slice(-1))}
          title="Ponto de interesse (qualquer letra)"
          className="h-8 w-10 rounded bg-slate-800 text-center font-mono text-base text-indigo-300 outline-none"
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <label>
            col
            <input
              type="number"
              min={COLUNAS_MIN}
              max={COLUNAS_MAX}
              value={colStr}
              onChange={(e) => setColStr(e.target.value)}
              onBlur={confirmarCol}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarCol();
              }}
              className="ml-1 w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
            />
          </label>
          <label>
            lin
            <input
              type="number"
              min={LINHAS_MIN}
              max={LINHAS_MAX}
              value={linStr}
              onChange={(e) => setLinStr(e.target.value)}
              onBlur={confirmarLin}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmarLin();
              }}
              className="ml-1 w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200"
            />
          </label>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(ROTULO_FERRAMENTA) as Ferramenta[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFerramenta(f)}
            title={ROTULO_FERRAMENTA[f]}
            className={`rounded px-2 py-1 text-xs font-medium ${
              ferramenta === f ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {ROTULO_FERRAMENTA[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={aoClicarLimparTudo}
          className="ml-auto rounded bg-red-900/60 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-900"
        >
          Limpar tudo
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Substituir</span>
        <input
          value={substituirAlvo}
          maxLength={1}
          onChange={(e) => setSubstituirAlvo((e.target.value || CELULA_VAZIA).slice(-1))}
          className="h-6 w-8 rounded bg-slate-800 text-center font-mono text-slate-200 outline-none"
        />
        <span>por</span>
        <input
          value={substituirNovo}
          maxLength={1}
          onChange={(e) => setSubstituirNovo((e.target.value || CELULA_VAZIA).slice(-1))}
          className="h-6 w-8 rounded bg-slate-800 text-center font-mono text-slate-200 outline-none"
        />
        <span>no mapa inteiro</span>
        <button
          type="button"
          onClick={aoClicarSubstituir}
          className="rounded bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700"
        >
          Aplicar
        </button>
      </div>

      <div className="overflow-auto">
        <table
          className="border-separate border-spacing-0 select-none font-mono text-sm leading-none"
          onMouseLeave={() => setHover(null)}
        >
          <thead>
            <tr>
              <th className="w-6" />
              {Array.from({ length: input.colunas }, (_, c) => (
                <th key={c} className="w-6 pb-1 text-center text-[10px] font-normal text-slate-500">
                  {rotuloColuna(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gradeExibida.map((linha, r) => (
              <LinhaGrade
                key={r}
                r={r}
                linha={linha}
                colunas={input.colunas}
                cores={cores}
                aoPressionar={aoPressionarCelula}
                aoEntrar={aoEntrarCelula}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex items-center gap-3 text-xs text-slate-500">
        <span>
          Ferramenta: <span className="font-mono text-slate-300">{ROTULO_FERRAMENTA[ferramenta]}</span> (atalhos
          P/B/A/L/R/F, dígitos 1-{PALETA.length} trocam a cor). Ctrl+Z desfaz.
        </span>
        {hover && (
          <span className="ml-auto font-mono text-slate-300">
            {rotuloColuna(hover.c)}
            {hover.r + 1}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Uma linha da grade, memoizada: só re-renderiza se a própria string da linha (ou `colunas`)
 * mudar. Como `pintarVarias`/`balde`/etc. só alteram as strings das linhas realmente afetadas,
 * as outras ~49 linhas do mapa mantêm o mesmo valor e pulam o re-render — o gargalo de recriar
 * até 1300 `<span>`/`<button>` a cada pintura cai pra só as linhas tocadas.
 */
const LinhaGrade = memo(function LinhaGrade({
  r,
  linha,
  colunas,
  cores,
  aoPressionar,
  aoEntrar,
}: {
  r: number;
  linha: string;
  colunas: number;
  /** Cores escolhidas pelo mestre. Vem por prop (e não do hook aqui dentro) pra
   *  não quebrar o `memo`: trocar a paleta precisa re-renderizar as linhas. */
  cores: CoresTerreno;
  aoPressionar: (r: number, c: number) => void;
  aoEntrar: (r: number, c: number) => void;
}) {
  const chars = [...linha];
  return (
    <tr>
      <td className="pr-1 text-right text-[10px] text-slate-500">{r + 1}</td>
      {Array.from({ length: colunas }, (_, c) => {
        const ch = chars[c] ?? CELULA_VAZIA;
        return (
          <td key={c} className="p-0">
            <button
              type="button"
              onMouseDown={() => aoPressionar(r, c)}
              onMouseEnter={() => aoEntrar(r, c)}
              className={`flex h-6 w-6 items-center justify-center rounded-sm hover:bg-slate-700/50 ${corDaCelula(ch, cores)}`}
            >
              {ch}
            </button>
          </td>
        );
      })}
    </tr>
  );
});
