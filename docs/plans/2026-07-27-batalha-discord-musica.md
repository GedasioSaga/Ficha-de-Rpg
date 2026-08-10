# Plano — Batalha: Discord grudado + Música na direita

Data: 2026-07-27. Refactor de front (zero backend, zero deps novas, sem git).

## Objetivo (pedido do usuário)
1. Discord não pode desconectar ao navegar; depois de conectado, esconder o card "Conectar" e liberar espaço.
2. Canal (Discord) fica **ao lado do Mapa**; só a **Música** na coluna direita.
3. Música muito melhor: painel expandido mostra as músicas salvas/favoritos (hoje mostra vazio) e traz de volta os controles que sumiram.

## Diagnóstico (verificado no código + banco)
- **Desconexão:** `conectado = conectarMut.isSuccess` é estado local de `DiscordPainel` (`DiscordPainel.tsx:79-83`). Navegar desmonta o componente (`Tabs.tsx:93` desmonta aba inativa; `BatalhaScreen.tsx:169` desmonta o `<Tabs>` no modo música) → estado perde. O **sidecar Python no Rust mantém a conexão viva** (`discord/mod.rs:47-56`) — bug 100% de front.
- **Layout:** Mapa (`BatalhaScreen.tsx:122`) e Discord (`:85`, coluna 320px) estão em grids **diferentes**. Discord empilha Conectar+Canal+Música na mesma coluna estreita.
- **Música "não mostra nada":** favoritos EXISTEM (39 no SQLite: Ambiente 14, Tema 12, Batalha 9, Abertura 4). É bug de UI: `JanelaMusicaFlutuante.tsx:93` força `mostrarExtras={false}`; player completo (`PlayerMusica`, que já tem seek/loop A-B/velocidade/favoritos+álbum) está enterrado num `<details>`.
- **Engine (sidecar `musica_v1.py`) já suporta:** play/fila, tocar-agora, skip, stop, loop, seek, velocidade, loop A-B, auto-seguir voz. Nada disso precisa mudar.

## Decisões (grilling)
- **Layout:** Música = 3ª coluna do grid do meio; Canal desce e fica ao lado do `MapaFaixa`; Conectar vira chip de status.
- **Conexão:** grudada via store de módulo (padrão `syncMapaDiscord.ts`); chip verde conectado / vermelho + Reconectar em queda real; **Desconectar** só nos controles avançados/debug.
- **Música:** painel completo com o que o engine já faz (sem tocar no sidecar).
- **DRY:** um `<PainelMusica/>` reusado em 3 lugares — coluna direita, janela flutuante ("destacar") e modo Ctrl+M; todos passam a mostrar favoritos.
- **Execução:** main thread costura layout + store; `programador` faz o `PainelMusica`; 2 `revisor` em paralelo; usuário valida no GUI.

## Layout alvo (aba combate)
```
[ TrilhaTurnos ------------------------------------ ]
[ Roster 280 | Ficha 1fr | PainelMusica (direita) ]
[ MapaFaixa 1fr | Canal Discord (chip+seletor+postar+sync) ]
```
Discord (conexão+canal) vive junto do Mapa. Música isolada na direita. Chip de conexão dentro do painel do Canal.

## Arquivos
**Novos**
- `src/features/batalha/discordConexao.ts` — store de módulo (`useSyncExternalStore`): `estado` (`ocioso|conectando|conectado|caiu`), `canalId`. Set no connect-success; limpa só no evento real `discord:evento`="desconectado".
- `src/features/batalha/PainelMusica.tsx` — painel único: tocando-agora (capa+seek+tempo) → transporte → biblioteca de favoritos por categoria (busca + capas YouTube, tocar-agora/enfileirar) → adicionar/editar favorito → avançados (velocidade/loop A-B/auto-seguir) num expansível. Prop `variante: "coluna" | "flutuante" | "cheia"` só ajusta densidade. Reusa `usePlayerMusica.ts` + `musica.ts` + absorve `AlbumFavoritos`.
- `src/features/batalha/PainelCanalDiscord.tsx` — extrai chip de conexão + seletor de canal + postar + sync (hoje em `DiscordPainel.tsx:187-282`), pra montar ao lado do Mapa.

**Editados**
- `DiscordPainel.tsx` — vira casca fina/aposentado: lógica de conexão lê/escreve o store; seção Canal sai pro `PainelCanalDiscord`; `<details>` de música removido; `Desconectar` movido pro debug.
- `BatalhaScreen.tsx` — reflow (grid do meio: 3ª col = `PainelMusica`; grid de baixo: `[MapaFaixa | PainelCanalDiscord]`); Ctrl+M e `JanelaMusicaFlutuante` renderizam `PainelMusica`.
- `JanelaMusicaFlutuante.tsx` — renderiza `<PainelMusica variante="flutuante"/>` (mata o `mostrarExtras={false}`).
- `MiniPlayerMusica.tsx` — absorvido pelo `PainelMusica` (variante compacta) ou removido se ninguém mais usar.
- `usePlayerMusica.ts` / `musica.ts` — reuso; pequenas adições se preciso (favoritos agrupados, tocar-agora vs enfileirar já existem).

Sem mudança de assinatura em `src/lib/api.ts` (bindings de canal/música/favoritos já existem) nem no Rust/sidecar.

## Slices
- **A (main) — Conexão grudada.** `discordConexao.ts`; ligar `DiscordPainel` ao store; chip. Verificação: navegar Música↔combate↔mapa mantém "conectado". `npm run build` verde.
- **B (main) — Reflow layout.** Extrair `PainelCanalDiscord`; `BatalhaScreen` novo grid; Música em placeholder. `npm run build`.
- **C (programador sonnet) — `PainelMusica` completo.** Construir + reusar nos 3 lugares. `npm run build`.
- **D (revisor x2 paralelo) — review** (correção/estado + UI/acessibilidade). Aplico fixes no main.
- **GUI (usuário) — `npm run tauri dev`**: conectar → ir pra música e voltar (segue conectado) → ver 39 favoritos por categoria → tocar/enfileirar → destacar (flutuante mostra favoritos) → Ctrl+M.

## Verificação
- Headless após cada slice de código: `npm run build` (tsc) na raiz. Sem `cargo` (nada de Rust muda).
- Ao vivo (Discord/voz/áudio) só no GUI pelo usuário — eu garanto build verde + coerência visual, não afirmo "áudio funciona" sem você testar.

## Resultado (2026-07-27) — implementado, `npm run build` 160 verde no main thread

Entregue conforme o plano, mais o que a revisão pegou. Criados: `discordConexao.ts`, `DiscordConexaoDriver.tsx`, `PainelCanalDiscord.tsx`, `DiscordDebug.tsx`, `PainelMusica.tsx`, `autoSeguirMusica.ts`. Editados: `BatalhaScreen.tsx`, `AppShell.tsx`, `JanelaMusicaFlutuante.tsx`, `usePlayerMusica.ts`, `musica.ts`.

**Desvios do plano (com motivo):**
- Driver de conexão foi pro **`AppShell`**, não pra `BatalhaScreen`: sair da rota `/batalha` desmontaria o listener e a UI voltaria mentindo "conectado".
- "Desconectar" virou **"Zerar conexão"**: não existe `discord_desconectar` no backend, só `discord_sair_voz`. O botão limpa só o estado do front — rotulado assim pra não fingir logout.
- Player **sem play/pause**: o sidecar não expõe comando de pausar (`COMANDOS` em `bot_sidecar.py:1385` tem play/tocar_agora/skip/stop/loop/seek/velocidade/ab_*). Só indicador de estado.
- Música **some enquanto não conectado** (decisão do usuário), com uma linha explicativa só no modo Ctrl+M, onde a ausência ocuparia a tela inteira.

**Corrigido pela revisão (3 revisores em paralelo):**
- CRÍTICO: botão "destacar" ficou preso no órfão `MiniPlayerMusica` → a janela flutuante era **inalcançável**. Cabeçalho do `PainelMusica` devolveu ⤢ e ⛶.
- CRÍTICO: variante `coluna` usava `flex-1 min-h-0` sob um grid `items-start` (pai de altura automática) → a lista nunca rolava e esticava a coluna. Virou teto de `420px`, igual ao da lista "Em batalha".
- ALTO: janela flutuante sem `maxHeight` → base fora da viewport. Ganhou teto + scroll interno.
- MÉDIO: `ultimaUrl` era `useState` por instância → capa divergia entre painéis abertos. Virou store em `usePlayerMusica.ts`.
- MÉDIO: "Salvar atual" (favoritar a faixa tocando) tinha sumido do player antigo. Restaurado.
- MÉDIO: `onError` da conexão apagava o estado `caiu`. Agora preserva a origem via contexto do `onMutate`.

**Não testado (precisa do usuário):** conectar de fato, tocar áudio, postar mapa, aparência real. Nada de Discord/GUI rodou aqui.

**Órfãos deixados no disco** (decisão do usuário, sem git = sem desfazer): `DiscordPainel.tsx`, `PlayerMusica.tsx`, `MiniPlayerMusica.tsx`. Armadilha registrada: `PlayerMusica.tsx` tem um store de auto-seguir próprio que competiria com `autoSeguirMusica.ts` se alguém religar esses arquivos.

## Riscos / limites
- Não dá pra testar Discord/áudio ao vivo em background — depende de bot + canal de voz reais. Validação final é sua.
- `MiniPlayerMusica`: confirmar que nada externo importa antes de remover.
- Regras duras respeitadas: sem git, sem deps novas, sem mexer em `.env`/segredos/sidecar.
