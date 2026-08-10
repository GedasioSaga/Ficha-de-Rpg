import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { batalhaEstado, listarPersonagens } from "../../lib/api";
import type { EstadoBatalha } from "../../lib/types";
import { useToast } from "../../components/Toast";
import Tabs, { type Aba } from "../../components/Tabs";
import RosterDialog from "./RosterDialog";
import PresetsDialog from "./PresetsDialog";
import PerfilCombatente from "./PerfilCombatente";
import BarraComandoBatalha from "./BarraComandoBatalha";
import TrilhaTurnosTopo from "./TrilhaTurnosTopo";
import HistoricoDialog from "./HistoricoDialog";
import { donoDoTurno } from "./logica";
import MapaEditor from "../mapa/MapaEditor";
import MapaFaixa from "./MapaFaixa";
import DiscordMapaSyncDriver from "./DiscordMapaSyncDriver";
import PainelCanalDiscord from "./PainelCanalDiscord";
import DiscordDebug from "./DiscordDebug";
import PainelMusica from "./PainelMusica";
import { useConexaoDiscord } from "./discordConexao";
import { definirModoMusica, useModoMusica } from "./modoMusica";

const BTN =
  "inline-flex items-center justify-center h-9 rounded-lg px-3 text-sm font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none";
const BTN_NEUTRO = `${BTN} border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800`;

export default function BatalhaScreen() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: estado, isLoading, isError, error } = useQuery({
    queryKey: ["batalha"],
    queryFn: batalhaEstado,
  });
  const { data: personagens } = useQuery({
    queryKey: ["personagens", null],
    queryFn: () => listarPersonagens(null),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [histAberto, setHistAberto] = useState(false);
  const [rosterAberto, setRosterAberto] = useState(false);
  const [presetsAberto, setPresetsAberto] = useState(false);
  const modoMusica = useModoMusica();
  // Quem toca é o bot no canal de voz: sem conexão o player não tem o que
  // comandar, então nem ocupa a coluna (mesmo comportamento de antes do reflow).
  const conectado = useConexaoDiscord().estado === "conectado";

  const mut = useMutation({
    mutationFn: (acao: () => Promise<EstadoBatalha>) => acao(),
    onSuccess: (novo) => qc.setQueryData(["batalha"], novo),
    onError: (e) => toast.erro(String(e)),
  });
  const roda = (acao: () => Promise<EstadoBatalha>) => mut.mutate(acao);

  if (isLoading) {
    return <div className="px-6 py-6 text-sm text-slate-400">carregando…</div>;
  }
  if (isError || !estado) {
    return (
      <div className="px-6 py-6 text-sm text-rose-300">
        Erro ao carregar a batalha: {String(error)}
      </div>
    );
  }

  const donoId = donoDoTurno(estado);
  const perfilId = selectedId ?? donoId;
  const selecionado = estado.combatentes.find((c) => c.id === perfilId) ?? null;

  const abas: Aba[] = [
    {
      id: "combate",
      label: "Combate",
      conteudo: (
        <div className="flex flex-col gap-4">
          {/* TOPO: trilha de turnos = a ÚNICA lista de quem está em batalha
              (pedido do usuário de 2026-08-09). Cada card é ordem + vitais +
              peça arrastável do mapa + remover; o "+ Escalar" também mora lá.
              O painel "Em batalha" que duplicava tudo isso morreu. */}
          <TrilhaTurnosTopo
            estado={estado}
            donoId={donoId}
            onSelecionar={setSelectedId}
            onEscalar={() => setRosterAberto(true)}
            roda={roda}
          />

          {/* MIOLO: ficha | mapa+discord | música. NENHUMA coluna tem trava de
              altura ou scroll próprio — pedido do usuário de 2026-08-09: a
              música (39 favoritos) aparece INTEIRA, sem rolagem interna. As
              colunas crescem até o próprio conteúdo (`items-start`) e quem rola
              é o painel do Tabs, uma barra só. Passar turno/música durante o
              scroll continua garantido pela barra de comando, que vive FORA do
              Tabs e não sai da tela.
              O card do Discord vive DEBAIXO do mapa: é o controle de postar
              exatamente esse mapa no canal. Ficha leva a fração maior — é o
              painel mais denso. Sem bot conectado a coluna da música nem existe
              (não há o que comandar) e o grid fecha em 2. */}
          <div
            className={`grid grid-cols-1 gap-4 lg:items-start ${
              conectado
                ? "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_360px]"
                : "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
            }`}
          >
            <PerfilCombatente combatente={selecionado} roda={roda} />

            <div className="flex min-w-0 flex-col gap-4">
              <MapaFaixa />
              <PainelCanalDiscord />
              {/* Debug só enquanto NÃO está conectado: depois de conectar ele é
                  só ruído — o caminho de recovery é justamente ficar sem conexão,
                  que traz o bloco de volta. */}
              {!conectado && <DiscordDebug />}
            </div>

            {conectado && <PainelMusica variante="coluna" />}
          </div>
        </div>
      ),
    },
    { id: "mapa", label: "Mapa", conteudo: <MapaEditor /> },
  ];

  return (
    // Cockpit auto-contido (mesmo padrão h-full de Mapa/Notas): sem scroll de
    // página — o header fica fixo e o Tabs ocupa o resto, rolando por dentro.
    <div className="mx-auto flex h-full max-w-[1500px] flex-col px-4 py-4">
      {modoMusica ? (
        // Modo música: encolhe a UI só pro player (pra usar a janela do app
        // estreita ao lado de outro programa — ver `minWidth` no tauri.conf.json
        // e o atalho Ctrl+M no `AppShell`). O resto do cockpit (roster, ficha,
        // mapa) fica de fora; sync do mapa e a janela flutuante continuam
        // montados abaixo, então nada se perde ao ligar/desligar.
        <div className="flex flex-1 flex-col gap-3">
          <header className="flex items-center justify-between border-b border-slate-800/70 pb-3">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Modo música</h1>
            <button type="button" className={BTN_NEUTRO} onClick={() => definirModoMusica(false)}>
              Sair <span className="ml-1 text-slate-500">Ctrl+M</span>
            </button>
          </header>
          {conectado ? (
            <PainelMusica variante="cheia" />
          ) : (
            // Aqui o painel ocupa a tela inteira: sem conexão sobraria uma tela
            // muda, então diz o que falta em vez de não renderizar nada.
            <p className="text-sm text-slate-500">
              Conecte o bot do Discord (aba Combate, painel ao lado do mapa) pra usar o player.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* No lugar do antigo header "Batalha / N combatentes" (que só repetia
              o que a sidebar já diz) entra a barra de comando. Ela fica AQUI, e
              não dentro do `Tabs`, porque é o `Tabs` que rola: dentro dele o
              botão de passar turno some assim que o mestre desce até o mapa.
              Bônus de estar fora: vale também pra aba Mapa, que antes não tinha
              nenhum controle de turno. */}
          <BarraComandoBatalha
            estado={estado}
            donoId={donoId}
            roda={roda}
            onHistorico={() => setHistAberto(true)}
            onPresets={() => setPresetsAberto(true)}
          />

          {/* flex-1 min-h-0: o Tabs (root h-full) preenche só o espaço restante
              abaixo do header — sem isso ele pega 100% da tela e empurra o
              conteúdo pra fora, gerando scroll de página ALÉM do scroll interno
              do painel (as "duas barras"). Agora só o painel rola. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <Tabs abas={abas} />
          </div>
        </>
      )}

      {/* Motor de sync do mapa com o Discord: headless, sempre montado (fora do
          Tabs, que desmonta a aba inativa) — observa terreno + posição das peças
          e edita a mensagem viva quando o sync ao vivo está ligado. */}
      <DiscordMapaSyncDriver />

      {/* O player destacado virou JANELA NATIVA (`janelaPlayerNativa.ts`), aberta
          pelo ⤢ do painel: o painel `fixed` que ficava aqui não conseguia sair da
          janela do app, que era justamente o uso pedido (ficar por cima do
          navegador). Quem arrasta/fecha/mantém no topo agora é o sistema. */}

      <HistoricoDialog aberto={histAberto} onFechar={() => setHistAberto(false)} estado={estado} />
      <RosterDialog
        aberto={rosterAberto}
        onFechar={() => setRosterAberto(false)}
        personagens={personagens ?? []}
        combatentes={estado.combatentes}
        roda={roda}
      />
      <PresetsDialog
        aberto={presetsAberto}
        onFechar={() => setPresetsAberto(false)}
        roda={roda}
        combatentesAtuais={estado.combatentes.length}
      />
    </div>
  );
}
