// src/features/sync/SyncTela.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  googleLogin,
  googleLogout,
  googleStatus,
  syncBaixar,
  syncDefinirPasta,
  syncDefinirTransporte,
  syncEnviar,
  syncPastaAtual,
  syncStatus,
  syncTransporteAtual,
} from "../../lib/api";
import type { AcaoSync, SyncResultado, TipoTransporte } from "../../lib/types";
import Dialog from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { IconDownload, IconSync, IconUpload } from "../../components/icons";

const QUERY_KEY = ["sync"];

/** Rótulo + cor por ação (Rust `Acao`, ver docs/plans/2026-08-10-sync-nuvem.md §4). */
const INFO_ACAO: Record<AcaoSync, { rotulo: string; cor: string }> = {
  em_dia: { rotulo: "Em dia com a nuvem", cor: "text-emerald-300" },
  nuvem_mais_nova: { rotulo: "A nuvem tem uma versão mais nova", cor: "text-amber-300" },
  local_mais_novo: { rotulo: "Você tem mudanças ainda não enviadas", cor: "text-amber-300" },
  conflito: { rotulo: "Conflito: nuvem mais nova e mudanças locais não enviadas", cor: "text-rose-300" },
  sem_nuvem: { rotulo: "Nenhum pacote nessa pasta ainda", cor: "text-slate-400" },
};

/**
 * Guarda leve que recusou por "algo mais novo do outro lado" pode ser
 * repetida com `forcar: true` — o usuário decide sobrescrever. As outras
 * recusas ("nenhuma pasta", "já está em dia") não têm o que forçar.
 */
function podeForcar(mensagem: string): boolean {
  return mensagem.includes("por cima de algo mais novo") || mensagem.includes("mudanças locais não enviadas");
}

export default function SyncTela() {
  const qc = useQueryClient();
  const toast = useToast();
  const [pendente, setPendente] = useState<{ acao: "enviar" | "baixar"; mensagem: string } | null>(null);

  const { data: transporte, isPending: carregandoTransporte } = useQuery({
    queryKey: [...QUERY_KEY, "transporte"],
    queryFn: syncTransporteAtual,
  });

  const { data: pasta, isPending: carregandoPasta } = useQuery({
    queryKey: [...QUERY_KEY, "pasta"],
    queryFn: syncPastaAtual,
    enabled: transporte === "pasta",
  });

  const { data: google, isPending: carregandoGoogle } = useQuery({
    queryKey: [...QUERY_KEY, "google"],
    queryFn: googleStatus,
    enabled: transporte === "drive",
  });

  // Um transporte "pronto" é o único caso em que faz sentido consultar/mostrar
  // o status de sync (Enviar/Baixar) — pasta ainda não escolhida ou Drive
  // ainda não conectado não têm o que comparar.
  const transportePronto =
    transporte === "pasta" ? !!pasta : transporte === "drive" ? !!google?.conectado : false;

  const { data: status, isPending: carregandoStatus } = useQuery({
    queryKey: [...QUERY_KEY, "status"],
    queryFn: syncStatus,
    enabled: transportePronto,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const definirTransporteMut = useMutation({
    mutationFn: (tipo: TipoTransporte) => syncDefinirTransporte(tipo),
    onSuccess: () => invalidar(),
    onError: (e) => toast.erro(String(e)),
  });

  const escolherPastaMut = useMutation({
    mutationFn: async () => {
      const caminho = await open({ title: "Pasta de sincronização", directory: true, multiple: false });
      if (typeof caminho !== "string") return null;
      await syncDefinirPasta(caminho);
      return caminho;
    },
    onSuccess: (caminho) => {
      if (caminho) invalidar();
    },
    onError: (e) => toast.erro(String(e)),
  });

  /**
   * `entrando` desabilita o botão de login: dois cliques rápidos abririam dois
   * servidores de retorno e duas abas do navegador (mesmo cuidado do
   * `OpcoesNuvem.tsx` do grimorio, referência deste fluxo).
   */
  const loginMut = useMutation({
    mutationFn: googleLogin,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QUERY_KEY, "google"] }),
    onError: (e) => toast.erro(String(e)),
  });

  const logoutMut = useMutation({
    mutationFn: googleLogout,
    onSuccess: () => qc.invalidateQueries({ queryKey: [...QUERY_KEY, "google"] }),
    onError: (e) => toast.erro(String(e)),
  });

  function tratarResultado(acao: "enviar" | "baixar", resultado: SyncResultado) {
    invalidar();
    if (resultado.sucesso) {
      toast.sucesso(resultado.mensagem);
      return;
    }
    if (podeForcar(resultado.mensagem)) {
      setPendente({ acao, mensagem: resultado.mensagem });
      return;
    }
    toast.erro(resultado.mensagem);
  }

  const enviarMut = useMutation({
    mutationFn: (forcar: boolean) => syncEnviar(forcar),
    onSuccess: (r) => tratarResultado("enviar", r),
    onError: (e) => toast.erro(String(e)),
  });

  const baixarMut = useMutation({
    mutationFn: (forcar: boolean) => syncBaixar(forcar),
    onSuccess: (r) => tratarResultado("baixar", r),
    onError: (e) => toast.erro(String(e)),
  });

  const operando = enviarMut.isPending || baixarMut.isPending;

  function confirmarForcado() {
    if (!pendente) return;
    const acao = pendente.acao;
    setPendente(null);
    if (acao === "enviar") enviarMut.mutate(true);
    else baixarMut.mutate(true);
  }

  const info = status ? INFO_ACAO[status.acao] : null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Sincronização</h1>
        <p className="mt-1 text-sm text-slate-500">
          Envie e baixe o estado do banco (fichas, mapas, notas) por uma pasta
          compartilhada na nuvem (OneDrive, Dropbox) ou direto pelo Google
          Drive (sem precisar instalar nada). Use um PC de cada vez.
        </p>
      </div>

      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Transporte</h2>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={carregandoTransporte || definirTransporteMut.isPending}
            onClick={() => definirTransporteMut.mutate("pasta")}
            className={`h-9 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              transporte === "pasta"
                ? "bg-indigo-500 text-white"
                : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Pasta local
          </button>
          <button
            type="button"
            disabled={carregandoTransporte || definirTransporteMut.isPending}
            onClick={() => definirTransporteMut.mutate("drive")}
            className={`h-9 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              transporte === "drive"
                ? "bg-indigo-500 text-white"
                : "border border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            Google Drive
          </button>
        </div>
      </section>

      {transporte === "pasta" && (
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Pasta da nuvem</h2>
          <p className="mt-2 break-all font-mono text-xs text-slate-300">
            {carregandoPasta ? "carregando…" : pasta ?? "nenhuma pasta escolhida"}
          </p>
          <button
            type="button"
            disabled={escolherPastaMut.isPending}
            onClick={() => escolherPastaMut.mutate()}
            className="mt-3 rounded-lg border border-slate-700 px-3.5 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {pasta ? "Trocar pasta" : "Escolher pasta"}
          </button>
        </section>
      )}

      {transporte === "drive" && (
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Conta do Google</h2>

          {carregandoGoogle && (
            <p className="mt-2 text-sm text-slate-500">Verificando se há uma conta conectada…</p>
          )}

          {!carregandoGoogle && google?.conectado && (
            <>
              <p className="mt-2 break-all font-mono text-xs text-slate-300">{google.email}</p>
              <button
                type="button"
                disabled={logoutMut.isPending}
                onClick={() => logoutMut.mutate()}
                className="mt-3 rounded-lg border border-slate-700 px-3.5 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {logoutMut.isPending ? "Desconectando…" : "Desconectar"}
              </button>
            </>
          )}

          {!carregandoGoogle && !google?.conectado && (
            <>
              <p className="mt-2 text-sm text-slate-500">
                Conecte sua conta Google para enviar e baixar o estado pelo
                Drive — o app só enxerga os arquivos que ele mesmo criar lá.
              </p>
              {/* Sem este aviso a tela parece travada: o comando bloqueia até
                  o usuário terminar no navegador, e desiste só depois de 5min. */}
              {loginMut.isPending && (
                <p className="mt-2 text-sm text-slate-500">
                  Abri a página de login do Google no seu navegador. Conclua o
                  acesso por lá e volte para o app.
                </p>
              )}
              <button
                type="button"
                disabled={loginMut.isPending}
                onClick={() => loginMut.mutate()}
                className="mt-3 rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
              >
                {loginMut.isPending ? "Aguardando o navegador…" : "Conectar Google"}
              </button>
            </>
          )}
        </section>
      )}

      {transportePronto && (
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Status</h2>
            <IconSync className={`size-4 ${carregandoStatus ? "animate-spin text-slate-600" : "text-slate-600"}`} />
          </div>

          {status && info && (
            <p className={`mt-2 text-sm font-medium ${info.cor}`}>{info.rotulo}</p>
          )}
          {status && (
            <p className="mt-1 text-xs text-slate-500">
              local v{status.contador_local}
              {status.contador_nuvem !== null && ` · nuvem v${status.contador_nuvem}`}
              {status.sujo && " · mudanças não enviadas"}
              {status.hora && ` · última sync ${status.hora}`}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={operando}
              onClick={() => enviarMut.mutate(false)}
              className="flex h-9 items-center gap-2 rounded-lg bg-indigo-500 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
            >
              <IconUpload className="size-4" />
              {enviarMut.isPending ? "Enviando…" : "Enviar"}
            </button>
            <button
              type="button"
              disabled={operando}
              onClick={() => baixarMut.mutate(false)}
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              <IconDownload className="size-4" />
              {baixarMut.isPending ? "Baixando…" : "Baixar"}
            </button>
          </div>
        </section>
      )}

      <Dialog
        aberto={!!pendente}
        titulo={pendente?.acao === "enviar" ? "Enviar por cima do que está na nuvem?" : "Baixar por cima das suas mudanças?"}
        descricao={pendente?.mensagem}
        textoConfirmar={pendente?.acao === "enviar" ? "Enviar mesmo assim" : "Baixar mesmo assim"}
        perigo
        onConfirmar={confirmarForcado}
        onCancelar={() => setPendente(null)}
      />
    </div>
  );
}
