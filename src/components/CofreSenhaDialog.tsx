import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { segredosDestravar, segredosStatus } from "../lib/api";
import { useToast } from "./Toast";

/**
 * Porteiro do cofre de segredos: quando o bundle traz `segredos.enc` e esta
 * máquina ainda não digitou a senha-mestra, cobre o app com um modal pedindo
 * a senha (1x por máquina — depois vira cache local e updates re-importam
 * sozinhos). "ausente"/"destravado" não renderizam nada.
 *
 * Dá pra fechar sem digitar ("Deixar pra depois"): o app inteiro funciona sem
 * o cofre — só Discord e IA ficam de fora até destravar. Bloquear o app por
 * causa disso seria punir a mesa por um recurso acessório.
 */
export default function CofreSenhaDialog() {
  const qc = useQueryClient();
  const toast = useToast();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [adiado, setAdiado] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["segredos-status"],
    queryFn: segredosStatus,
    staleTime: Infinity,
  });

  const destravar = useMutation({
    mutationFn: () => segredosDestravar(senha),
    onSuccess: () => {
      qc.setQueryData(["segredos-status"], "destravado");
      // As chaves Gemini acabaram de entrar na config — telas de IA leem de lá.
      qc.invalidateQueries({ queryKey: ["config"] });
      toast.sucesso("Cofre destravado — Discord e IA prontos.");
    },
    onError: (e) => setErro(String(e)),
  });

  if (status !== "trancado" || adiado) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (senha) destravar.mutate();
        }}
        className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold tracking-tight text-slate-100">Senha-mestra</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Primeira vez neste computador: digite a senha-mestra para liberar o bot do
          Discord e as chaves de IA. Só precisa uma vez — atualizações futuras entram
          sozinhas.
        </p>

        <input
          type="password"
          autoFocus
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setErro(null);
          }}
          placeholder="Senha-mestra"
          aria-label="Senha-mestra"
          className="mt-4 h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
        {erro && <p className="mt-2 text-xs text-rose-300">{erro}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setAdiado(true)}
            className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40"
          >
            Deixar pra depois
          </button>
          <button
            type="submit"
            disabled={!senha || destravar.isPending}
            className="h-9 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {destravar.isPending ? "Destravando…" : "Destravar"}
          </button>
        </div>
      </form>
    </div>
  );
}
