import { Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import FichasGallery from "./features/characters/FichasGallery";
import CharacterSheet from "./features/characters/CharacterSheet";
import FichaForm from "./features/characters/FichaForm";
import BatalhaScreen from "./features/batalha/BatalhaScreen";
import MapaScreen from "./features/mapa/MapaScreen";
import NotasScreen from "./features/notas/NotasScreen";
import CompendioScreen from "./features/compendio/CompendioScreen";
import BalanceamentoScreen from "./features/balanceamento/BalanceamentoScreen";
import ConfiguracoesScreen from "./features/configuracoes/ConfiguracoesScreen";
import SyncTela from "./features/sync/SyncTela";
import JanelaPlayer from "./features/batalha/JanelaPlayer";

/**
 * A janela nativa do player abre `index.html?janela=player` — decidir por query
 * string (e não por rota) é o que faz ela funcionar também no app empacotado,
 * onde uma URL de rota não corresponde a arquivo nenhum.
 */
function ehJanelaDoPlayer(): boolean {
  return new URLSearchParams(window.location.search).get("janela") === "player";
}

export default function App() {
  // Curto-circuito antes do roteador: esta janela não tem sidebar nem cockpit,
  // ela É o player.
  if (ehJanelaDoPlayer()) return <JanelaPlayer />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<FichasGallery />} />
        {/* "novo" antes de ":id" pra não casar como id */}
        <Route path="/fichas/novo" element={<FichaForm />} />
        <Route path="/fichas/:id" element={<CharacterSheet />} />
        <Route path="/fichas/:id/editar" element={<FichaForm />} />
        <Route path="/batalha" element={<BatalhaScreen />} />
        <Route path="/mapa" element={<MapaScreen />} />
        <Route path="/notas" element={<NotasScreen />} />
        <Route path="/compendio" element={<CompendioScreen />} />
        <Route path="/balanceamento" element={<BalanceamentoScreen />} />
        <Route path="/configuracoes" element={<ConfiguracoesScreen />} />
        <Route path="/sync" element={<SyncTela />} />
      </Route>
    </Routes>
  );
}
