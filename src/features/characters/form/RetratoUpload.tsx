import { useRef, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { retratoDataUrl } from "../../../lib/api";
import type { RetratoInput } from "../../../lib/types";
import { IconLixeira, IconUpload } from "../../../components/icons";
import { useToast } from "../../../components/Toast";
import { gradienteDoNome, iniciais } from "../retrato";
import { BOTAO_SECUNDARIO } from "./Campos";

/** Formatos aceitos e teto de tamanho (o base64 vai inteiro no payload do save). */
const TIPOS_ACEITOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TAMANHO_MAX = 5 * 1024 * 1024; // 5 MB

export default function RetratoUpload({
  retrato,
  nome,
  onChange,
  label = "Retrato",
}: {
  retrato: RetratoInput;
  nome: string;
  onChange: (r: RetratoInput) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  function aoSelecionar(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo depois
    if (!arquivo) return;
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      toast.erro("Formato não suportado. Use PNG, JPEG, WebP ou GIF.");
      return;
    }
    if (arquivo.size > TAMANHO_MAX) {
      toast.erro("Imagem grande demais (máx. 5 MB).");
      return;
    }
    const leitor = new FileReader();
    leitor.onerror = () => toast.erro("Não foi possível ler a imagem.");
    leitor.onload = () => {
      const resultado = leitor.result;
      if (typeof resultado !== "string") {
        toast.erro("Falha ao processar a imagem.");
        return;
      }
      const virgula = resultado.indexOf(",");
      if (virgula < 0) {
        toast.erro("Falha ao processar a imagem.");
        return;
      }
      // formato = subtipo do mime já validado (ex.: "image/png" -> "png")
      const base64 = resultado.slice(virgula + 1);
      const formato = arquivo.type.split("/")[1] ?? "png";
      onChange({ modo: "novo", base64, formato });
    };
    leitor.readAsDataURL(arquivo);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-xl border border-slate-800 bg-slate-800">
        <Preview retrato={retrato} nome={nome} />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <button type="button" onClick={() => inputRef.current?.click()} className={BOTAO_SECUNDARIO}>
          <IconUpload className="size-4" />
          Trocar
        </button>
        {retrato.modo !== "nenhum" && (
          <button type="button" onClick={() => onChange({ modo: "nenhum" })} className={BOTAO_SECUNDARIO}>
            <IconLixeira className="size-4" />
            Remover
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={aoSelecionar}
      />
    </div>
  );
}

function Preview({ retrato, nome }: { retrato: RetratoInput; nome: string }) {
  if (retrato.modo === "manter") return <PreviewManter caminho={retrato.caminho} nome={nome} />;
  if (retrato.modo === "novo") {
    return (
      <img
        src={`data:image/${retrato.formato};base64,${retrato.base64}`}
        alt={nome}
        className="size-full object-cover"
      />
    );
  }
  return <Placeholder nome={nome} />;
}

function PreviewManter({ caminho, nome }: { caminho: string; nome: string }) {
  const { data: src } = useQuery({
    queryKey: ["retrato", caminho],
    queryFn: () => retratoDataUrl(caminho),
    staleTime: Infinity,
  });
  if (!src) return <Placeholder nome={nome} />;
  return <img src={src} alt={nome} className="size-full object-cover" />;
}

function Placeholder({ nome }: { nome: string }) {
  return (
    <div
      className="flex size-full items-center justify-center"
      style={{ backgroundImage: gradienteDoNome(nome) }}
    >
      <span className="text-3xl font-bold tracking-wide text-white/90">
        {iniciais(nome || "?")}
      </span>
    </div>
  );
}
