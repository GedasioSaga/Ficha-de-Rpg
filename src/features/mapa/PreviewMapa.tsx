import { useEffect, useState } from "react";
import { renderMapaDiscord } from "../../lib/api";
import type { MapaInput } from "../../lib/types";
import { useToast } from "../../components/Toast";
import { LIMITE_DISCORD, contarCaracteresDiscord, corDaCelula, rotuloColuna, statusLimiteDiscord } from "./logica";
import { useCoresTerreno } from "./coresTerreno";

/** Espera esse tanto sem edição antes de rerenderizar no backend pra contar caracteres. */
const DEBOUNCE_CONTAGEM_MS = 300;

const CLASSE_POR_NIVEL: Record<string, string> = {
  normal: "text-slate-500",
  atencao: "text-amber-400",
  estourado: "text-rose-400",
};

interface Props {
  input: MapaInput;
  /** Id do mapa em edição. Faz o render incluir peças + legenda quando ele é o
   *  mapa ativo da batalha — é o mesmo texto que o `discord_postar_mapa` publica.
   *  Sem isto, contador e "Copiar" mostrariam uma versão menor que a real. */
  mapaId?: number | null;
}

export default function PreviewMapa({ input, mapaId }: Props) {
  const toast = useToast();
  const cores = useCoresTerreno();
  const [textoDiscord, setTextoDiscord] = useState<string | null>(null);
  // contagem ao vivo pro contador no topo do preview — segue o texto renderizado (grade
  // idêntica ao que sai no Discord), então precisa da mesma chamada de backend, só debounced
  // pra não invocar o Tauri a cada tecla enquanto o mestre ainda está editando.
  const [tamanhoDiscord, setTamanhoDiscord] = useState<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      try {
        const texto = await renderMapaDiscord(input, mapaId ?? undefined);
        if (!cancelado) setTamanhoDiscord(contarCaracteresDiscord(texto));
      } catch {
        // contador é best-effort — se der erro, "Ver texto"/"Copiar" mostram o erro de verdade
      }
    }, DEBOUNCE_CONTAGEM_MS);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [input, mapaId]);

  async function copiar() {
    try {
      const texto = await renderMapaDiscord(input, mapaId ?? undefined);
      await navigator.clipboard.writeText(texto);
      if (contarCaracteresDiscord(texto) > LIMITE_DISCORD) {
        toast.erro("Copiado, mas passa de 2000 caracteres — o Discord vai cortar.");
      } else {
        toast.sucesso("Mapa copiado pro Discord.");
      }
    } catch (e) {
      toast.erro(String(e));
    }
  }

  async function verTexto() {
    try {
      setTextoDiscord(await renderMapaDiscord(input, mapaId ?? undefined));
    } catch (e) {
      toast.erro(String(e));
    }
  }

  return (
    <aside className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/60 p-4 lg:min-h-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-400">Preview</h3>
        {tamanhoDiscord !== null && <ContadorDiscord tamanho={tamanhoDiscord} />}
      </div>
      {/* min-h-0/overflow só de lg pra cima — empilhado, cresce livre. */}
      <div className="flex-1 lg:min-h-0 lg:overflow-auto">
        {input.titulo && <div className="mb-2 text-base font-semibold text-slate-100">{input.titulo}</div>}
        <div className="inline-block rounded-lg bg-slate-900 p-3 font-mono text-xs leading-tight">
          <div className="flex">
            <span className="w-5" />
            {Array.from({ length: input.colunas }, (_, c) => (
              <span key={c} className="w-4 text-center text-slate-500">
                {rotuloColuna(c)}
              </span>
            ))}
          </div>
          {input.grade.map((linha, r) => (
            <div key={r} className="flex">
              <span className="w-5 pr-1 text-right text-slate-500">{r + 1}</span>
              {Array.from({ length: input.colunas }, (_, c) => {
                const ch = [...linha][c] ?? "-";
                return (
                  <span key={c} className={`w-4 text-center ${corDaCelula(ch, cores)}`}>
                    {ch}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        {/* Ordem e Turno Atual são automáticos (derivados das peças no mapa
            ativo) — não dá pra calcular aqui sem duplicar a lógica do backend,
            então só aparecem no texto de "Ver texto"/"Copiar" (renderMapaDiscord). */}
        {input.legenda && (
          <p className="mt-3 text-sm text-slate-300">
            <b>Legenda:</b> {input.legenda}
          </p>
        )}
        {input.efeito && (
          <p className="mt-1 text-sm text-slate-300">
            <b>Efeito do Campo:</b> {input.efeito}
          </p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copiar}
          className="flex-1 rounded-lg bg-indigo-500/15 px-3 py-2 text-sm font-medium text-indigo-300 hover:bg-indigo-500/25"
        >
          Copiar pro Discord
        </button>
        <button
          type="button"
          onClick={verTexto}
          className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Ver texto
        </button>
      </div>
      {textoDiscord !== null && (
        <div className="mt-2">
          <pre className="rounded-lg bg-black/60 p-2 text-[11px] text-slate-300 lg:max-h-48 lg:overflow-auto">
            {textoDiscord}
          </pre>
          {statusLimiteDiscord(contarCaracteresDiscord(textoDiscord)).nivel === "estourado" && (
            <p className="mt-1 text-xs text-rose-400">
              {contarCaracteresDiscord(textoDiscord)} caracteres — passa de 2000, o Discord recusa/corta a mensagem.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

/** Contador de caracteres do texto que vai pro Discord, com faixa visual (normal/atenção/estourado). */
function ContadorDiscord({ tamanho }: { tamanho: number }) {
  const { nivel, aviso } = statusLimiteDiscord(tamanho);
  return (
    <span className={`text-xs ${CLASSE_POR_NIVEL[nivel]}`}>
      {tamanho}/{LIMITE_DISCORD}
      {aviso && ` · ${aviso}`}
    </span>
  );
}
