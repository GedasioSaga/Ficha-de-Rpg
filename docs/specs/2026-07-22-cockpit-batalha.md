# Fase 5 — Cockpit de Batalha (layout + música avançada + peças no mapa)

> Spec. Projeto **sem git** — arquivo solto, sem commit (regra dura do CLAUDE.md).
> Data: 2026-07-22.

## Contexto

O usuário passa a maior parte do tempo na aba **Batalha → Combate**. Hoje Mapa e Discord
são sub-abas irmãs de Combate (troca de aba pra usar). A música e o mapa deveriam estar
à mão durante o combate, sem trocar de aba. Grande parte da infra já existe (ver abaixo);
esta fase reorganiza o layout e fecha os buracos reais.

## O que JÁ existe (não refazer)

- **Mapa:** CRUD completo, biblioteca de mapas, auto-save (`src/features/mapa/*`, tabela `mapa`
  em `migrations/0003_mapa.sql`, CRUD em `db/repositorios.rs:648-745`).
- **Mapa → Discord:** sync ao vivo (edita mensagem no canal, poll 1.5s) — `DiscordPainel.tsx`,
  `discord/mod.rs`, render em `domain/mapa/render.rs:11-65`.
- **Música:** play/skip/stop/loop-faixa + 39 favoritos (só leitura) via sidecar Python
  (`sidecar/bot_sidecar.py`) reusando o cog `MusicBot` do v1 (`C:\dev\Projeto Rpg\Discord\bot.py`).
- **Engine de música do v1 tem `seek_to()`** (`bot.py:788`) — só não está religado até a UI.
- **Auto-join do "gedasiosaga" existe no v1** (`bot.py:842-863`) mas está **morto** no v2: o sidecar
  importa só o cog, não copia o listener, e sobe com `Intents.default()` sem `voice_states`
  (`bot_sidecar.py:163`).

## Decisões (fechadas com o usuário)

1. **Layout:** cockpit híbrido. Combate mostra tudo; Mapa/Discord seguem como abas de edição pesada/config.
2. **Música à direita** da Ordem dos Turnos; **mapa em faixa embaixo**, sempre visível.
3. **Peças = combatentes** ligados à Batalha. Glifo = número da ordem de turno (1..9);
   cor por `tipo` (Jogador=azul, Npc=vermelho). Sem campo `lado` novo.
4. **Colocar peça:** arrastar do roster pro mapa (HTML5 drag).
5. **Mover peça:** clicar peça + clicar destino.
6. **1 peça por célula** (sem empilhar).
7. **Favoritos:** tabela SQLite v2 própria, seed único dos 39 do v1. v2 dono dos dados
   (não escreve no json do v1).
8. **Auto-join:** bot segue o gedasiosaga automático, com **toggle** liga/desliga.
9. **Mapa ativo da batalha** (`estado.mapa_id`) é fonte única: cockpit renderiza ele,
   Discord sincroniza ele + peças. Remove o seletor de mapa duplicado do painel Discord.

## Arquitetura por fase

Ordem: **Fase 1 (frame)** primeiro; depois **Fase 2 (música)** e **Fase 3 (peças)** em paralelo (independentes).

---

### Fase 1 — Layout cockpit (só frontend)

**Objetivo:** aba Combate vira cockpit; música na direita, mapa embaixo, sempre visíveis.

- `src/features/batalha/BatalhaScreen.tsx`
  - Mantém sub-abas `[Combate][Mapa][Discord]` (array `abas`, ~linha 67-93; `<Tabs>` ~132).
  - Reforma o conteúdo de **Combate** (hoje grid `lg:grid-cols-[290px_1fr_300px]`, ~linha 72):
    vira `flex flex-col gap-4` = **linha superior** (grid 3-col `Roster | Perfil | ColunaDireita`)
    + **faixa inferior** (`MapaFaixa`, full-width).
  - `ColunaDireita`: `TrilhaTurnos` (existe) em cima + novo `PlayerMusica` embaixo.
- **Novo** `src/features/batalha/PlayerMusica.tsx`: extraído da seção Música do `DiscordPainel.tsx`
  (~383-506). Reutilizável — usado no cockpit **e** na aba Discord. Reflete estado via React Query
  + evento `musica`. Trocar de aba não para a música (áudio toca no Discord, não no browser).
- **Novo** `src/features/batalha/MapaFaixa.tsx`: render compacto do mapa ativo (`estado.mapa_id`)
  com peças; seletor "mapa ativo" no header; read-mostly (mover peça sim; editar terreno = aba Mapa).
- `DiscordPainel.tsx` enxuga: fica com conexão, canal, favoritos (CRUD, Fase 2), toggle auto-join,
  toggle "sincronizar mapa ativo". Seção Música vira `<PlayerMusica/>`. Sai o seletor de mapa daqui.

**Verificação:** `npm run build`; abrir Batalha no browser, ver música à direita + faixa de mapa
embaixo, tocar/pausar sem trocar de aba.

---

### Fase 2 — Música avançada (sidecar Python → Rust → TS → UI)

Cadeia de dependência: **posição/tempo** habilita seek, A-B e barra de progresso.

- **Posição / now-playing:** sidecar emite `posicao` e `duracao` (seg) no evento `musica`
  (base `_track_started_at`, `bot.py:301`). Rust repassa; UI mostra barra de progresso.
- **Seek:** religar `MusicBot.seek_to(seg)` (`bot.py:788`) → novo cmd sidecar `musica_seek`
  (`COMANDOS`, `bot_sidecar.py:644-660`) → `discord_musica_seek` (`discord/mod.rs`) →
  `api.ts` → clicar/arrastar na barra.
- **2x velocidade (novo):** filtro ffmpeg `atempo` em `_build_ffmpeg_options` (`bot.py:306`).
  Troca em tempo real = re-stream no offset atual com novo `atempo` (gap curto inevitável).
  Cmd `musica_velocidade(fator)`. UI: 0.5x / 1x / 1.5x / 2x.
- **Loop A-B (novo):** botões "Marcar A" / "Marcar B" (usam posição atual), toggle A-B, limpar.
  Sidecar guarda `a`,`b`; ao passar de `b`, `seek_to(a)`. Reusa seek + posição.
- **Loop faixa:** já existe (`musica_loop`) — mantém.
- **Auto-join gedasiosaga:** liga `Intents.voice_states=True` (`bot_sidecar.py:163`) + listener
  `on_voice_state_update` no client do sidecar (portar de `bot.py:842-863`): match substring
  "gedasiosaga" em name/display/global_name → connect/move pro canal dele; auto-leave quando sozinho.
  Toggle liga/desliga (não brigar com escolha manual). `voice_states` **não** é privilegiado.
- **Favoritos CRUD (novo):** migration `0005_favorito.sql` (`id`, `nome`, `url`, `categoria`,
  timestamps). Seed único importando os 39 do v1 (`C:\dev\Projeto Rpg\discord_config.json`).
  CRUD em `db/repositorios.rs`; cmds Tauri `listar/criar/editar/excluir_favorito`; UI de gerenciar
  + "salvar tocando agora".

**Verificação:** `cargo test` + `cargo build` + `npm run build`; em `tauri dev` com `DISCORD_BOT_TOKEN`:
conectar, entrar em call → bot segue; tocar, seek, 2x, marcar A-B e ver o loop; criar/excluir favorito.

---

### Fase 3 — Peças ligadas à Batalha (Rust domain → render → UI)

- **Modelo** (`domain/batalha/modelos.rs`): `Combatente` ganha
  `posicao: Option<(u16, u16)>` (linha, coluna). Cor da peça = `tipo` (já existe). **Sem `lado`.**
  TS espelha em `types.ts` (`Combatente`, ~198-209).
- **Estado** (`domain/batalha/modelos.rs` / `types.ts` `EstadoBatalha` ~215-222):
  novo `mapa_id: Option<i64>` = mapa ativo da batalha.
- **Comandos** (`lib.rs`): `batalha_definir_mapa(mapa_id)`, `batalha_posicionar_peca(id, linha, coluna)`
  (drag inicial), `batalha_mover_peca(id, linha, coluna)`, `batalha_remover_peca(id)`.
  Regra **1 peça/célula**: rejeita/ignora destino ocupado; clampa ao grid.
- **Glifo:** número = índice em `estado.ordem` + 1 (derivado, não armazenado). >9 combatentes →
  letra (A=10, B=11…). Token sobrepõe o char de terreno da célula.
- **Render Discord** (`domain/mapa/render.rs:11-65`): `render_discord` passa a receber as peças e
  pintar o dígito nas células ocupadas. Guard `excede_discord` (2000 chars) inalterado (grade não cresce).
  Sync ao vivo já existente inclui peças de graça.
- **Render app** (React, `MapaFaixa` + `PreviewMapa`/`GradeEditor`): sobrepõe dígitos coloridos
  por `tipo`; drag do roster define posição; clicar peça + clicar célula move.

**Verificação:** `cargo test` (regras de posição/colisão/clamp) + build; no browser: arrastar
combatente pro mapa, ver número/cor certos, mover, conferir espelho no Discord.

---

## Fora de escopo (YAGNI)

- Empacotar o sidecar pra release (Discord segue só em `tauri dev`) — limitação pré-existente.
- Movimento com custo/alcance, fog of war, linha de visão.
- Pause/resume, volume, fila/queue, shuffle, nowplaying textual (extras do v1 não pedidos).
- Times/facções finas além de Jogador/Npc (campo `faccao` fica pra depois).
- Import dos mapas do v1.
- Mexer em segredos/tokens.

## Riscos / pontos de atenção

- **2x em tempo real:** trocar velocidade re-stream no offset → gap curto de áudio. Aceitável.
- **Auto-join:** depende do nick conter "gedasiosaga"; se o Discord esconder o nome, o match falha.
- **Precisão de posição/seek:** `_track_started_at` é base de relógio; drift possível em faixas longas.
- **>9 peças:** glifo vira letra; pode colidir visualmente com letras de terreno (raro, aceitável).
- **Convenções:** sem deps novas sem avisar; migrations `NNNN_*.sql`; snake_case pt-BR; lógica pura em `domain/`.

## Verificação global

`cargo test` + `cargo build` + `npm run build`; conferência no **main thread** (não só claim de subagente);
UI testada no browser antes de "pronto" (regra do projeto).
