import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { syncVerificarBoot } from "../../lib/api";

/**
 * Aviso de "a nuvem tem versão mais nova" — a ÚNICA coisa que o app faz de
 * rede sozinho, uma vez por abertura, e mesmo assim só leitura do manifesto
 * (poucos KB, ver `sync_verificar_boot` no Rust).
 *
 * Antes daqui saía sincronização de verdade: o boot baixava o `.rpgpack`
 * inteiro e trocava o banco quando o local estava limpo, e um irmão
 * (`AutoEnviarSync`) mandava o pacote pra nuvem 8s depois de qualquer edição.
 * Os dois foram removidos em 2026-08-11 a pedido do usuário — o upload
 * periódico travava o app no meio do uso. Agora nenhum byte de dado se move
 * sem alguém apertar Enviar ou Baixar na tela Sincronização; este banner só
 * aponta o caminho.
 *
 * Fica fora do `Outlet` (montado no `AppShell`), igual `CofreSenhaDialog` e
 * `AtualizadorBanner` — o evento do boot vale pro app inteiro, não pra uma
 * rota. Discreto e não-bloqueante de propósito: o usuário pode ignorar e
 * continuar jogando; a decisão de sobrescrever é dele, na tela própria.
 */
export default function SyncBootDriver() {
  const navigate = useNavigate();
  const [aviso, setAviso] = useState<{ contador: number; conflito: boolean } | null>(null);

  useEffect(() => {
    let cancelado = false;
    syncVerificarBoot()
      .then((evento) => {
        if (cancelado) return;
        if (evento.tipo === "nuvem_mais_nova") {
          setAviso({ contador: evento.contador, conflito: false });
        } else if (evento.tipo === "conflito_pendente") {
          setAviso({ contador: evento.contador_nuvem, conflito: true });
        }
      })
      // Nuvem fora do ar / cofre trancado / sem transporte configurado não é
      // erro pro usuário: sem aviso, app segue normal (mesmo silêncio do
      // `AtualizadorBanner`).
      .catch(() => {});
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda só uma vez, no mount
  }, []);

  if (!aviso) return null;

  return (
    <div
      role="status"
      className={`fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border bg-slate-900/95 px-4 py-2.5 shadow-2xl backdrop-blur ${
        aviso.conflito ? "border-rose-500/40" : "border-amber-500/40"
      }`}
    >
      <span className="text-sm text-slate-200">
        A nuvem tem a versão{" "}
        <span className={`font-semibold ${aviso.conflito ? "text-rose-300" : "text-amber-300"}`}>
          v{aviso.contador}
        </span>
        {aviso.conflito
          ? " — e este PC tem mudanças ainda não enviadas."
          : " — este PC está atrás."}
      </span>
      <button
        type="button"
        onClick={() => {
          setAviso(null);
          navigate("/sync");
        }}
        className="h-8 shrink-0 rounded-lg bg-indigo-500 px-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        Abrir Sincronização
      </button>
      <button
        type="button"
        onClick={() => setAviso(null)}
        aria-label="Dispensar aviso de sincronização"
        className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
      >
        ✕
      </button>
    </div>
  );
}
