import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { alternarModoMusica, useModoMusica } from "../features/batalha/modoMusica";
import DiscordConexaoDriver from "../features/batalha/DiscordConexaoDriver";
import AtualizadorBanner from "./AtualizadorBanner";
import CofreSenhaDialog from "./CofreSenhaDialog";
import SyncBootDriver from "../features/sync/SyncBootDriver";

export default function AppShell() {
  const [colapsado, setColapsado] = useState(false);
  const modoMusica = useModoMusica();

  // Ctrl+M liga/desliga o modo música (encolhe a UI só pro player — ver
  // `modoMusica.ts`) de qualquer tela, não só da Batalha. Mesmo padrão de
  // atalho global do `useMapaEditor` (ignora quando o foco está num campo de
  // texto, pra não capar Ctrl+M de um input em qualquer outra tela).
  useEffect(() => {
    function aoTeclar(ev: KeyboardEvent) {
      const alvo = ev.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA")) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "m") {
        ev.preventDefault();
        alternarModoMusica();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {!modoMusica && <Sidebar colapsado={colapsado} onToggle={() => setColapsado((c) => !c)} />}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Vigia da queda de conexão do Discord: fica AQUI, fora do `Outlet`, e não
          na `BatalhaScreen` — sair pra Fichas/Mapa/Notas desmonta a rota inteira,
          e um listener montado lá dentro perderia a queda enquanto o mestre está
          em outra tela (a UI voltaria dizendo "conectado" com o bot offline). */}
      <DiscordConexaoDriver />

      {/* Fora do Outlet pelos mesmos motivos do driver acima: senha-mestra e
          aviso de update valem pro app inteiro, não pra uma rota. */}
      <CofreSenhaDialog />
      <AtualizadorBanner />

      {/* Aviso de "a nuvem tem versão mais nova" (uma checagem por abertura do
          app). Só avisa — quem sincroniza é o botão da tela Sincronização.
          Vale pro app inteiro, não pra uma rota, igual aos drivers acima. O
          auto-enviar com debounce que existia aqui foi removido em
          2026-08-11: travava o app a cada edição (upload do pacote inteiro). */}
      <SyncBootDriver />
    </div>
  );
}
