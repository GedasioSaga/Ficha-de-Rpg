import { useEffect, useRef, useState } from "react";

interface DialogProps {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  textoConfirmar: string;
  textoCancelar?: string;
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/**
 * Modal de confirmação acessível (sem deps): overlay, Esc fecha, clique fora
 * cancela, foco inicial no botão de ação. Enter sutil (fade + scale ~150ms).
 */
export default function Dialog({
  aberto,
  titulo,
  descricao,
  textoConfirmar,
  textoCancelar = "Cancelar",
  perigo = false,
  onConfirmar,
  onCancelar,
}: DialogProps) {
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!aberto) {
      setVisivel(false);
      return;
    }
    const frame = requestAnimationFrame(() => setVisivel(true));
    confirmarRef.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  const corConfirmar = perigo
    ? "bg-rose-600 hover:bg-rose-500 focus-visible:ring-rose-500/40"
    : "bg-indigo-500 hover:bg-indigo-400 focus-visible:ring-indigo-500/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onMouseDown={onCancelar}
        className={`absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity duration-150 ${
          visivel ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-titulo"
        aria-describedby={descricao ? "dialog-descricao" : undefined}
        className={`relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl transition duration-150 ${
          visivel ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <h2
          id="dialog-titulo"
          className="text-base font-semibold tracking-tight text-slate-100"
        >
          {titulo}
        </h2>
        {descricao && (
          <p id="dialog-descricao" className="mt-2 text-sm leading-relaxed text-slate-400">
            {descricao}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40"
          >
            {textoCancelar}
          </button>
          <button
            ref={confirmarRef}
            type="button"
            onClick={onConfirmar}
            className={`h-9 rounded-lg px-3.5 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 ${corConfirmar}`}
          >
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
