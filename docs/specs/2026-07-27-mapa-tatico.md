# Spec — Mapa tático (exploração de design)

Data: 2026-07-27. Documento de **exploração**, não plano aprovado. Levantamento do que existe + leque de mecânicas possíveis + como cairia numa sessão.

## 1. O que existe hoje (verificado no código)

**Dados**
- `mapa`: tabela SQLite (`0003_mapa.sql`), grade = JSON `Vec<String>`, 6–26 colunas × 3–50 linhas, mais 3 campos de texto livre (`ordem_navegacao`, `legenda`, `efeito`).
- Glifos: `-` vazio, `X` árvore, `~` água, `#` pedra, `.` chão, + qualquer char como "ponto de interesse" (`logica.ts:11-17`).
- Peças: `Combatente.posicao: Option<(u16,u16)>` (`domain/batalha/modelos.rs:183`) — **só em memória**, some ao fechar o app.
- Ponte combate↔mapa: só `Estado.mapa_id`.

**Regras que existem**
- Clamp da posição à grade; 1 peça por célula (`pecas.rs:16-40`).
- Glifo da peça = índice na ordem de turno (1–9, A–Z).
- Render Discord: code block ASCII, guard de 2000 chars (`render.rs:81`); 26×50 estoura.

**Regras que NÃO existem** (confirmado por ausência)
distância · alcance · linha de visão · área de efeito · custo de movimento · cobertura · fog of war · camadas · marcadores com metadado · qualquer efeito de terreno.

**Engine relevante**
- 8 atributos → rank 0–13; modificador = `rank/2`. Só d20.
- Sem economia de ações ("turno é multi-evento", `mod.rs:8`) — o mestre dirige na mão.
- Habilidade = nome + `tempo` (cooldown) + custo/dano em **texto livre**.
- `EntradaDano` já tem `reducao_percent` e `dano_verdadeiro` (`regras.rs:59-64`).
- Reações já calculadas: Defender / Esquiva / Contra-ataque (`resolver_reacao`, `regras.rs:35-54`), hoje aplicadas manualmente.
- `EfeitoRecorrente` com `DanoDistribuido` + duração, tica no início do turno do alvo.

## 2. Restrições duras que moldam qualquer design

1. **O jogador só vê texto no Discord.** Uma mensagem, ≤2000 chars, monoespaçada. Tudo que a mecânica produzir precisa caber nisso ou ficar só no app do mestre.
2. **Fog of war real é impossível** numa mensagem pública única — todos leem a mesma coisa. Só dá pra fazer névoa *narrativa* (o mestre esconde ao desenhar) ou mensagem por DM (outro projeto).
3. **Uma célula = um caractere.** Não dá pra empilhar peça + terreno + marcador visualmente. Informação extra tem que ir para legenda/lista fora da grade.
4. **Batalha é efêmera.** Persistir posição é pré-requisito de qualquer coisa séria.
5. **Sem economia de ações.** "Movimento por turno" exige criar esse conceito do zero na engine.

## 3. Catálogo de mecânicas

### A. Fundação (destrava o resto)

| # | Mecânica | Como funciona | Custo |
|---|---|---|---|
| A1 | **Persistir posição** | `posicao` e `mapa_id` vão pra SQLite; batalha sobrevive a fechar o app | baixo |
| A2 | **Legenda automática no Discord** | Abaixo da grade: `1 Barril · 2 Ryoko · 3 Bariarte ◀ turno`. Hoje o jogador não sabe quem é cada número | baixo, valor alto |
| A3 | **Destacar turno atual no render** | Glifo do combatente da vez sai marcado (`[3]` ou invertido) | baixo |
| A4 | **Propriedades por glifo** | Tabela: cada char tem `bloqueia`, `custo_movimento`, `cobertura%`, `rotulo`. É a virada de chave — transforma desenho em regra | médio |

### B. Movimento e distância

| # | Mecânica | Como funciona | Custo |
|---|---|---|---|
| B1 | **Medir distância** | Chebyshev (diagonal = 1) ou Manhattan. Hover mostra "4 células" | baixo |
| B2 | **Passos por turno** | Orçamento = `f(rank Agilidade)`, ex. `3 + rank/2`. Zera no início do turno | médio |
| B3 | **Realce de alcançáveis** | Ao clicar a peça, pinta as células que ela alcança (BFS com custo de terreno) | médio |
| B4 | **Terreno custa/bloqueia** | `~` custa 2 (nadar), `#` bloqueia, `X` custa 2 | médio (depende de A4) |
| B5 | **Empurrar / puxar** | Habilidade desloca alvo N células numa direção; colide com `#` = dano extra | médio |

### C. Combate espacial

| # | Mecânica | Como funciona | Custo |
|---|---|---|---|
| C1 | **Alcance de habilidade** | Campo novo: corpo-a-corpo 1 / curta 3 / longa 8. UI marca alvos válidos e barra os inválidos | médio |
| C2 | **Área de efeito** | Círculo r / linha / cone a partir de célula. Retorna **lista de atingidos** e joga direto na calculadora de dano que já existe | médio-alto |
| C3 | **Linha de visão** | Bresenham; `#` bloqueia. Sem visão = não pode mirar | médio |
| C4 | **Cobertura** | Alvo atrás de `#` ganha redução — **encaixa no `reducao_percent` que a engine já tem**, sem inventar sistema novo | baixo, depois de C3 |
| C5 | **Cerco/flanqueamento** | 2+ aliados adjacentes ao alvo = bônus no ataque | baixo |
| C6 | **Zona de ameaça** | Sair de adjacência provoca reação — **reusa Defender/Esquiva/Contra-ataque que já existem** | médio |

### D. Sabor One Piece

| # | Mecânica | Como funciona | Custo |
|---|---|---|---|
| D1 | **Fraqueza da água** | Usuário de Akuma no Mi em `~` fica debilitado / não pode nadar. Regra icônica da franquia, quase de graça depois de A4 | baixo |
| D2 | **Terreno mutável por Logia** | Ace queima floresta (`X`→`.`), Aokiji congela água (`~`→`.`), Crocodile faz areia. Habilidade que edita a grade | médio |
| D3 | **Terreno dinâmico** | Maré sobe a cada N rodadas; fogo se espalha; navio afunda linha a linha | médio-alto |
| D4 | **Terreno destrutível** | `#` vira escombro ao levar dano; abre caminho | médio |
| D5 | **Elevação** | Mastro/convés: bônus a distância, penalidade corpo-a-corpo | médio |
| D6 | **Haki do Observador** | Gasta SP pra revelar/prever — ganha info espacial (ex.: ver alcance inimigo) | médio |

### E. Fluxo de mesa (QoL)

| # | Mecânica | Como funciona | Custo |
|---|---|---|---|
| E1 | **Marcadores com metadado** | Pin numa célula com texto (armadilha, objetivo, tesouro); entra na legenda do Discord | baixo |
| E2 | **Zonas de spawn** | Marca lado A/lado B; adicionar combatente já posiciona | baixo |
| E3 | **Templates de mapa** | Navio, ilha, taverna, arena prontos pra duplicar | baixo |
| E4 | **Viewport** | Mapa grande com janela de rolagem, pra respeitar os 2000 chars do Discord | médio |
| E5 | **Snapshot do mapa** | Voltar o mapa (e posições) ao estado de N rodadas atrás | médio |
| E6 | **Log espacial** | "Bariarte moveu C4→F4 (3 células)" entra no histórico da batalha | baixo |

## 4. Como cairia numa sessão

**Antes (5 min).** Escolhe/duplica um template (E3), desenha o terreno, marca zonas de spawn (E2) e pins de objetivo (E1). Escolhe o canal e posta. Sync ao vivo ligado.

**Abertura.** Adiciona os combatentes; eles nascem nas zonas (E2). Iniciativa roda automática por Agilidade. O Discord já mostra a grade com a legenda `1 Barril · 2 Ryoko · 3 Bariarte` (A2) e o turno destacado (A3).

**Turno do jogador.** Ele diz "vou pra trás da pedra e atiro". O mestre clica na peça: acendem as células alcançáveis (B3), já descontando que a água custa 2 (B4). Move — o orçamento de passos cai (B2), o Discord atualiza sozinho. Clica a habilidade: aparece o alcance (C1); o alvo está atrás de `#`, então a linha de visão avisa cobertura (C3/C4) e a calculadora já entra com `reducao_percent` preenchido. Aplica o dano com o fluxo que já existe.

**Turno do vilão.** Logia queima a floresta: 3 células `X` viram `.` (D2). Quem estava usando aquilo como cobertura perde. O mapa no Discord muda na frente dos jogadores — é aqui que o mapa vira narrativa em vez de enfeite.

**Virada.** A maré sobe (D3): a linha de baixo vira `~`. O usuário de fruta que está lá fica debilitado (D1) e precisa sair. Isso cria pressão de tempo sem o mestre precisar narrar nada.

**Fim.** Snapshot (E5). Posições persistidas (A1) — dá pra fechar o app e continuar semana que vem.

## 5. Recomendação de fatiamento

**Fatia 1 — "o mapa passa a se explicar"** (A1, A2, A3, E6)
Barato, sem regra nova, e resolve o problema mais gritante: hoje o jogador olha a grade e não sabe quem é quem. Persistir posição tira o risco de perder a batalha inteira.

**Fatia 2 — "o desenho vira regra"** (A4, B1, B3, B4)
O pulo do gato. Terreno com propriedades + alcance de movimento realçado. Depois disso o mapa influencia decisão, não só ilustra.

**Fatia 3 — "combate espacial"** (C1, C2, C4)
Alcance e área ligados à calculadora de dano que já existe; cobertura reusando `reducao_percent`. Alto valor, integra com o que está pronto.

**Fatia 4 — "sabor One Piece"** (D1, D2, D4)
O que faz parecer One Piece e não D&D genérico. Depende de A4.

Deixar pra depois: fog of war (impossível no Discord público), elevação, viewport (só quando os mapas ficarem grandes).

## 6. Decisões em aberto (para grilling)

1. Quanto o sistema deve **impedir** vs. só **informar**? (barrar movimento inválido, ou pintar e deixar o mestre decidir?)
2. Diagonal conta 1 (Chebyshev) ou 1.5/alternado? Chebyshev é mais simples e cabe melhor em ASCII.
3. Movimento vira orçamento **rastreado pela engine** (exige conceito de ação) ou só uma dica visual?
4. Habilidade ganha campos estruturados (alcance/área) — o que fazer com as fichas já preenchidas em texto livre?
5. Terreno mutável escreve na tabela `mapa` (persistente) ou numa camada de "estado de batalha" que some no fim do combate?
