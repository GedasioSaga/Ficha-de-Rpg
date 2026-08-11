import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncBaixar, syncVerificarBoot } from "../../lib/api";
import { useToast } from "../../components/Toast";

/**
 * Fica fora do `Outlet` (montado no `AppShell`), igual `CofreSenhaDialog` —
 * o evento do boot vale pro app inteiro, não pra uma rota. Dispara
 * `sync_verificar_boot` uma vez no mount: a sincronização de boot não roda
 * mais dentro do `.setup()` do Tauri (rede bloqueava a abertura da janela —
 * ver docs/plans/2026-08-11-sync-google-drive.md), então é este `useEffect`
 * que a dispara, em background, sem travar o render. Se a nuvem já aplicou
 * sozinha (nuvem mais nova + local limpo), só avisa com um toast e invalida
 * as queries pra UI recarregar com os dados sincronizados; se achou conflito
 * (nuvem mais nova + mudanças locais não enviadas), abre este diálogo — o
 * comando não tem UI pra decidir isso sozinho (Fase 3, ver
 * docs/plans/2026-08-10-sync-nuvem.md).
 */
export default function SyncBootDriver() {
  const qc = useQueryClient();
  const toast = useToast();
  const [conflito, setConflito] = useState<{ contadorNuvem: number } | null>(null);
  const [baixando, setBaixando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    syncVerificarBoot()
      .then((evento) => {
        if (cancelado) return;
        if (evento.tipo === "aplicado_automaticamente") {
          toast.sucesso(`Sincronizado com a nuvem ao abrir (v${evento.contador}).`);
          qc.invalidateQueries();
        } else if (evento.tipo === "conflito_pendente") {
          setConflito({ contadorNuvem: evento.contador_nuvem });
        }
      })
      .catch((e) => toast.erro(String(e)));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda só uma vez, no mount
  }, []);

  async function baixarPerdendoLocais() {
    setBaixando(true);
    try {
      const r = await syncBaixar(true);
      qc.invalidateQueries();
      if (r.sucesso) toast.sucesso(r.mensagem);
      else toast.erro(r.mensagem);
    } catch (e) {
      toast.erro(String(e));
    } finally {
      setBaixando(false);
      setConflito(null);
    }
  }

  function manterLocais() {
    setConflito(null);
    toast.sucesso("Mantendo suas mudanças locais — lembre de Enviar na tela Sincronização.");
  }

  if (!conflito) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold tracking-tight text-slate-100">
          Conflito de sincronização
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          A nuvem tem uma versão mais nova (v{conflito.contadorNuvem}), mas este computador
          tem mudanças que ainda não foram enviadas. O que você quer fazer?
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={baixando}
            onClick={baixarPerdendoLocais}
            className="h-9 rounded-lg bg-rose-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-50"
          >
            {baixando ? "Baixando…" : "Baixar da nuvem (perde as mudanças locais, com backup)"}
          </button>
          <button
            type="button"
            disabled={baixando}
            onClick={manterLocais}
            className="h-9 rounded-lg border border-slate-700 px-3.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Manter minhas mudanças locais
          </button>
          <button
            type="button"
            disabled={baixando}
            onClick={() => setConflito(null)}
            className="h-9 rounded-lg px-3.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            Cancelar (decidir depois)
          </button>
        </div>
      </div>
    </div>
  );
}
