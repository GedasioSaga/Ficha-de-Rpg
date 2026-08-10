# Plano — Batalha vira cockpit único (aba geral)

Data: 2026-07-27. Sem git (regra do projeto). Aprovado via mockup interativo.

## Contexto

Combate vira a **aba geral**: controla Discord + mapa + música dali, sem trocar de aba no meio da luta. Abas Mapa/Discord deixam de ser obrigatórias (viram setup/edição). Mockup aprovado (conceito) e auditoria de 50 findings alimentam as melhorias.

Layout alvo (do mockup):
- **Topo**: trilha de turnos — mini por combatente (retrato + barras HP/SP + escudo) + Rodada/Turno.
- **Esquerda**: Disponíveis (Jogadores/NPCs, filtro, expandir, pôr na luta).
- **Centro**: ficha do selecionado (pools com barra, formas abaixo, atributos, habilidades) + botão "ficha completa".
- **Direita**: controle de turno + Discord (conectar/postar/sync) + mini-player de música (destacável).
- **Baixo**: canais Discord · mapa grande · tokens pra colocar.

## Decisões travadas

- Dano recorrente tica **no início do turno do próprio alvo**.
- Calculadora: "sobra do escudo → HP" nasce **ligada**.
- Player flutuante = **overlay in-app arrastável** (reconciliar com "modo música" na Fase 5).
- Já feito antes deste plano: sync do mapa (driver sempre-montado) + persistir canal Discord.

## Fase 1 — Dano recorrente (backend)

Motor guarda um efeito de dano recorrente (distribuição HP/SP/escudo + overflow) com duração em turnos, aplicado no **início do turno do alvo**. Provável reuso do mecanismo de `duracao` já existente em `ModificadorBatalha`. Comandos pra criar/limpar o efeito.
- Verif: `cargo test` (novo teste do tick + duração) + `cargo build`.

## Fase 2 — Calculadora de dano (frontend)

Modal: total → distribuição por % (Escudo/HP/SP) → overflow toggle → "repetir por N turnos". Preview antes/depois. Aplica via comandos de dano/cura por pool + (se recorrente) o efeito da Fase 1. Substitui o `🧮` popover atual do `PoolEditor`.
- Verif: `npm run build` + browser.

## Fase 3 — Ficha central (frontend)

- Barras de HP/SP/escudo com máximo (já em cache via `PersonagemCompleto`).
- Formas/transformações **abaixo** dos pools (chips).
- Botão "⤢ Ficha completa" → modal com a ficha inteira (reusa `CharacterSheet`).
- Verif: `npm run build` + browser.

## Fase 4 — Re-arquitetura do layout (frontend, grande)

Combate = aba geral no grid do mockup (topo/esquerda/centro/direita/baixo). Absorve `MapaFaixa` (baixo, maior) + canais + tokens; `DiscordPainel` vira painel direito; `TrilhaTurnos` vira a trilha do topo com vitals; roster à esquerda com filtros/expandir. Remove abas Mapa/Discord obrigatórias (edição de terreno segue acessível).
- Maior risco; precisa **teste ao vivo** do usuário. Verif: `npm run build` + browser.

## Fase 5 — Música: mini-player + destacar + modo música (frontend)

Mini-player no painel direito (reusa `PlayerMusica` via hook headless). Botão "destacar" → overlay flutuante arrastável. "Modo música" = modo compacto dedicado (decisão anterior do dual-mode). Reconcilia os 3 estados: docado / flutuante / compacto. `minWidth:900` do `tauri.conf.json` precisa baixar pro compacto estreito.
- Verif: `npm run build` + browser.

## Verificação (todas as fases)

`cargo test` + `cargo build` (quando toca backend) · `npm run build` · testar UI no browser no main thread (não só claim de subagente).
