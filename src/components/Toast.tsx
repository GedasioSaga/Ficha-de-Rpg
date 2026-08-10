import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconCheck, IconFechar } from "./icons";

type TipoToast = "sucesso" | "erro";

interface ToastItem {
  id: number;
  tipo: TipoToast;
  msg: string;
}

interface ToastApi {
  sucesso: (msg: string) => void;
  erro: (msg: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Hook pra disparar toasts. Precisa de `<ToastProvider>` acima na árvore. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa de <ToastProvider>");
  return ctx;
}

const DURACAO_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([]);
  const proximoId = useRef(1);

  const remover = useCallback((id: number) => {
    setItens((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const adicionar = useCallback(
    (tipo: TipoToast, msg: string) => {
      const id = proximoId.current++;
      setItens((atuais) => [...atuais, { id, tipo, msg }]);
      window.setTimeout(() => remover(id), DURACAO_MS);
    },
    [remover],
  );

  const api = useMemo<ToastApi>(
    () => ({
      sucesso: (msg) => adicionar("sucesso", msg),
      erro: (msg) => adicionar("erro", msg),
    }),
    [adicionar],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {itens.map((t) => (
          <ToastCard key={t.id} item={t} onFechar={() => remover(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onFechar }: { item: ToastItem; onFechar: () => void }) {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisivel(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const sucesso = item.tipo === "sucesso";
  const cor = sucesso
    ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-100"
    : "border-rose-500/40 bg-rose-950/80 text-rose-100";
  const corIcone = sucesso
    ? "bg-emerald-500/20 text-emerald-300"
    : "bg-rose-500/20 text-rose-300";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg backdrop-blur transition-all duration-200 ${cor} ${
        visivel ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${corIcone}`}>
        {sucesso ? <IconCheck className="size-3.5" /> : <IconFechar className="size-3.5" />}
      </span>
      <p className="flex-1 text-sm leading-snug">{item.msg}</p>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar aviso"
        className="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <IconFechar className="size-4" />
      </button>
    </div>
  );
}
