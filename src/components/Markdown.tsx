// src/components/Markdown.tsx
import { parseMarkdown, type Segmento } from "../lib/markdown";

function Trecho({ segmentos }: { segmentos: Segmento[] }) {
  return (
    <>
      {segmentos.map((s, i) =>
        s.negrito ? (
          <strong key={i} className="font-semibold text-slate-100">
            {s.texto}
          </strong>
        ) : (
          <span key={i}>{s.texto}</span>
        ),
      )}
    </>
  );
}

/** Render seguro do markdown do relatório — sem dangerouslySetInnerHTML. */
export default function Markdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-300">
      {parseMarkdown(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          return b.nivel === 2 ? (
            <h3 key={i} className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-200">
              <Trecho segmentos={b.segmentos} />
            </h3>
          ) : (
            <h4 key={i} className="pt-1 text-sm font-semibold text-slate-200">
              <Trecho segmentos={b.segmentos} />
            </h4>
          );
        }
        if (b.tipo === "item") {
          return (
            <p key={i} className="flex gap-2 pl-2">
              <span className="text-slate-600">•</span>
              <span>
                <Trecho segmentos={b.segmentos} />
              </span>
            </p>
          );
        }
        return (
          <p key={i}>
            <Trecho segmentos={b.segmentos} />
          </p>
        );
      })}
    </div>
  );
}
