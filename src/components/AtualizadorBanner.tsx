import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useToast } from "./Toast";

/**
 * Vigia de atualização: no boot consulta o `latest.json` do release mais
 * recente no GitHub (endpoint no `tauri.conf.json`) e, havendo versão nova,
 * mostra um banner fixo no canto. "Atualizar agora" baixa o installer
 * assinado, aplica e reinicia o app — o banco local é substituído pela
 * semente nova no próximo boot (com backup, ver `semente.rs`).
 *
 * Silencioso em qualquer falha do check (sem rede, repo sem release ainda,
 * rodando em `tauri dev`): update é conveniência, não pode virar toast de
 * erro toda vez que abrir o app offline.
 */
export default function AtualizadorBanner() {
  const toast = useToast();
  const [update, setUpdate] = useState<Update | null>(null);
  const [instalando, setInstalando] = useState(false);

  useEffect(() => {
    let ativo = true;
    check()
      .then((u) => {
        if (ativo && u) setUpdate(u);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  if (!update) return null;

  async function instalar() {
    if (!update) return;
    setInstalando(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setInstalando(false);
      toast.erro(`Atualização falhou: ${e}`);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-xl border border-indigo-500/40 bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur">
      <span className="text-sm text-slate-200">
        Atualização <span className="font-semibold text-indigo-300">v{update.version}</span>{" "}
        disponível
      </span>
      <button
        type="button"
        onClick={instalar}
        disabled={instalando}
        className="h-8 rounded-lg bg-indigo-500 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {instalando ? "Baixando…" : "Atualizar agora"}
      </button>
      {!instalando && (
        <button
          type="button"
          onClick={() => setUpdate(null)}
          aria-label="Dispensar aviso de atualização"
          className="grid size-7 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          ✕
        </button>
      )}
    </div>
  );
}
