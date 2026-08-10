# Projeto RPG v2 — Spec Balanceamento (comparação + IA Gemini + sync de regras)

**Data:** 2026-08-09
**Status:** Design aprovado pelo usuário; spec aguardando revisão.
**Depende de:** Fichas (Fase 1), Compêndio, Notas, Discord sidecar (Fase 4 — conexão e listagem de canais já existem).

---

## 1. Contexto e objetivo

Balancear personagens do sistema homebrew é difícil: não há visão lado a lado de atributos/pools/habilidades, e as regras do sistema (mecânicas, status, ações de combate, raças, akuma no mi) vivem em canais de texto do Discord — fora do app.

**Meta:** tela "Balanceamento" que (a) compara personagens lado a lado de forma determinística, (b) usa Gemini pra gerar análise de balanceamento e responder perguntas em chat, com as fichas **e as regras do sistema** como contexto, e (c) sincroniza os canais de regras do Discord pra dentro do app (Notas + Compêndio), tornando-as navegáveis e alimentando a IA.

## 2. Decisões travadas (via grilling)

| Tema | Decisão | Motivo |
|---|---|---|
| Interação IA | Análise estruturada (1 clique) **+** chat de acompanhamento | Cobre balanceamento e perguntas livres; chat reusa o contexto já montado |
| Contexto da IA | Fichas selecionadas + notas de regras + catálogos do Compêndio | Sem as regras homebrew a análise sai genérica |
| Fonte das regras | Sync via Discord (sidecar lê canais) | Bot já conecta; regras continuam sendo editadas no Discord |
| Destino do sync | Canais gerais → Notas (1 nota por canal); `#pericias`/`#vantagens`/`#desvantagens` → parse via Gemini → Compêndio | Regras viram conteúdo visível do app, não cache escondido |
| Merge no Compêndio | **Preview criar/atualizar/manter + confirmação** antes de gravar | IA não sobrescreve curadoria manual em silêncio (padrão `importarFichas`) |
| Local na UI | Tela nova `Balanceamento` na sidebar | Espaço próprio; segue padrão `src/features/<area>/` |
| Chamada Gemini | Fetch direto do frontend (webview → REST) | Zero dep nova (Rust e npm); CSP é `null`, nada a liberar |
| Chaves (6×) | Failover sequencial em 429; índice ativo persistido | Previsível; UI mostra qual chave está ativa |
| Armazenamento de chaves | Tabela `config` (SQLite local) via UI de colar | Padrão local do projeto (cf. `discord_config.json`); projeto sem git → sem risco de commit |
| Modelo | `gemini-2.5-flash` | Free tier generoso, bom em PT-BR. Endpoint/nome confirmados via ctx7 na implementação |

**Aviso registrado:** usar várias chaves free pra estender cota viola ToS do Google (risco: banimento das chaves). Uso pessoal esporádico; risco aceito pelo usuário. As 6 chaves foram coladas no chat da sessão — **recomendado rotacionar no AI Studio** após a feature pronta.

## 3. Arquitetura

```
React (features/balanceamento)                Rust (lib.rs)
┌──────────────────────────────┐   invoke    ┌─────────────────────────┐
│ Seletor de personagens       │────────────►│ comandos existentes:    │
│ TabelaComparacao (determin.) │             │  listar/get personagem, │
│ PainelIA (análise + chat)    │             │  notas, catálogos       │
│ ConfigChaves (colar 6 keys)  │             │ novos:                  │
└──────────┬───────────────────┘             │  config_get/config_set  │
           │ fetch (lib/gemini.ts)           │  discord_ler_canal ─────┼──► sidecar
           ▼                                 └─────────────────────────┘    ler_canal
Google Gemini REST API                                                      (channel.history)
generativelanguage.googleapis.com
```

- **SQL só no Rust** (regra do projeto). Frontend chama comandos tipados.
- **Lógica pura testável no TS:** failover de chaves, diff de catálogo, conversor markdown — funções puras em `src/lib/`, testadas com vitest.
- Nenhuma dependência nova em `Cargo.toml` nem `package.json`.

## 4. Fatia A — Comparação determinística (sem IA)

- `src/features/balanceamento/BalanceamentoPage.tsx` + rota `/balanceamento` em `App.tsx` + item na `Sidebar.tsx`.
- Seletor: lista de `listarPersonagens` (jogadores e NPCs, filtro por etiqueta e busca por nome); seleção de 2+ personagens; fichas completas via `getPersonagem` (React Query, mesmo padrão das telas atuais).
- `TabelaComparacao.tsx`: colunas = personagens; linhas = 8 atributos (valor + rank 0–13 já vindo de `PersonagemCompleto.atributos`), HP/SP/escudo, nº de habilidades, nº de transformações, nº de perícias. Destaque visual de melhor/pior por linha; barra proporcional em CSS (sem lib de gráfico).
- Soma simples de atributos como "total" por personagem (referência rápida, não é métrica oficial do sistema).

## 5. Fatia B — IA: análise + chat

### Cliente (`src/lib/gemini.ts`)
- `gerarConteudo(mensagens, systemPrompt): Promise<string>` — POST `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` (endpoint confirmado via ctx7 na implementação).
- Chaves: `config_get("gemini_api_keys")` (CSV, N chaves — hoje 6), `config_get("gemini_chave_ativa")` (índice). Em HTTP 429/`RESOURCE_EXHAUSTED`: avança índice (persiste via `config_set`), tenta a próxima. Todas esgotadas → `ErroCotaEsgotada`.
- Função pura `proximaChave(indiceAtual, total)` e o loop de failover são testáveis com mock de fetch.

### UI (`PainelIA.tsx`)
- **ConfigChaves** (colapsável): textarea pra colar chaves separadas por vírgula → `config_set`. Indicador "chave ativa: N/6". Sem chave configurada → painel IA desabilitado com aviso apontando pra config.
- **Analisar balanceamento:** monta contexto e chama Gemini com system prompt fixo (PT-BR): papel de mestre/game designer do sistema homebrew One Piece; comparar atributos+ranks, pools, habilidades (custo/dano/cooldown), transformações, perícias, vantagens/desvantagens; saída: leitura por personagem → desequilíbrios → sugestões numéricas concretas de ajuste.
- **Contexto enviado:** JSON compacto das fichas selecionadas + corpo das notas de regras (títulos registrados em `config("regras_notas")`, preenchido pelo sync da Fatia C; editável no futuro) + catálogos completos (`listarCatalogos`).
- **Antes do 1º sync** (`regras_notas` vazio — a Fatia B entrega antes da C): análise roda só com fichas + catálogos e mostra aviso "regras do Discord ainda não sincronizadas — análise sem contexto de mecânicas".
- **Chat:** input abaixo do relatório; histórico da sessão em memória (não persiste); cada envio reenvia contexto + histórico.
- Render do relatório: conversor markdown mínimo próprio (`src/lib/markdown.ts`, ~30 linhas: títulos, negrito, listas, parágrafos). Sem dep nova.

### Chat livre, simulação de combate e visão (adendo 2 — 2026-08-09, pedido do usuário)
- **Chat é o protagonista, não a análise.** O painel vira coluna fixa à direita da tela Balanceamento (`lg:grid-cols-[1fr_26rem]`, sticky, scroll interno). Campo de pergunta sempre disponível; "Analisar" vira botão secundário no cabeçalho. Com 0 personagens selecionados o chat continua ativo (conversa sobre as regras do sistema).
- **Contexto na última mensagem, não na primeira.** O bloco de regras/fichas viaja junto da pergunta mais recente — assim reflete o estado atual (ficha sendo editada, seleção trocada) sem duplicar a cada turno. Consequência: o histórico sobrevive à troca de seleção (a `key` por ids foi removida do wrapper).
- **Simulação de combate** é caso de uso de primeira classe: "quanto tempo o jogador X sobrevive contra 3 soldados?". O system prompt manda usar as regras (dado de reação, iniciativa, custos, cooldowns) e considerar habilidades ativas **e passivas**, perícias, vantagens/desvantagens, transformações e escudo; resposta rodada a rodada, com premissas assumidas explicitadas.
- **Multimodal (visão):** o retrato do personagem vai junto da pergunta (`inline_data` no REST do Gemini), pra perguntas como "baseado na foto, que habilidade você recomenda?". Fonte da imagem: no FichaForm, `RetratoInput` modo `novo` (base64 já em mãos) ou modo `manter` (via `retratoDataUrl`); na tela Balanceamento, os retratos das fichas selecionadas.
- `systemPromptPara(0|1|2+)` → geral / ficha única / comparativo.

### IA na criação/edição de ficha (adendo 2026-08-09, pedido do usuário)
- O painel de IA também aparece no `FichaForm` (criação `/fichas/novo` e edição `/fichas/:id/editar`), colapsável ("Discutir com IA"), pra discutir a ficha **como está no form** (dados não salvos incluídos).
- Pra isso o `PainelIA` é desacoplado de ids: recebe `fichas: FichaParaContexto[]` prontas. Conversores puros `dePersonagemCompleto()` (usado pela tela Balanceamento) e `dePersonagemInput()` (usado pelo FichaForm; sem ranks — a IA infere pelas regras).
- Com 1 ficha o system prompt muda pra análise individual ("esta ficha está equilibrada pro sistema?"); com 2+ segue comparativo.

## 6. Fatia C — Sync Discord → Notas/Compêndio

### Sidecar (`sidecar/bot_sidecar.py`)
- Comando novo `ler_canal {canal_id, limite}` → `channel.history(limit=limite)` em ordem cronológica → `[{autor, texto, timestamp}]`. Ignora anexos/embeds (só `content`). Limite padrão 200.

### Rust
- `discord_ler_canal(canal_id, limite)` — repassa ao sidecar (mesmo padrão dos comandos Discord existentes).
- `config_get(chave)` / `config_set(chave, valor)` — expõem a tabela `config` (migration 0006, já existe; **sem migration nova**).

### UI (seção "Regras do jogo" na tela Discord existente)
- Lista canais de texto (`discordListarCanais`) com dropdown de destino por canal: `—` / `Nota` / `Compêndio: perícias` / `Compêndio: vantagens` / `Compêndio: desvantagens`. Mapeamento persistido em `config("sync_regras_mapa")` (JSON).
- Botão **Sincronizar regras**:
  1. Canais → `Nota`: concatena mensagens e faz upsert por título (`#nome-canal`) usando `listarNotas` + `criarNota`/`atualizarNota` (sem comando novo). Registra títulos em `config("regras_notas")`.
  2. Canais → Compêndio: texto vai ao Gemini com prompt de extração → JSON (`[{nome, descricao, atributo}]` pra perícias; `[{nome, descricao, efeito}]` pra traços; JSON estruturado via response schema se disponível — confirmar via ctx7).
  3. Diff puro (`src/lib/diffCatalogo.ts`) contra o catálogo atual, por nome (case-insensitive, trim): **criar / atualizar / manter**.
  4. Dialog de preview listando as mudanças → usuário confirma → aplica via CRUD existente (`criarCatalogoPericia`, `atualizarCatalogoTraco`, etc.). Cancelar = nada gravado.
- JSON malformado do Gemini → erro exibido, opção de tentar de novo; **nunca grava parcial**.

## 7. Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `src/features/balanceamento/*` | **Novo**: página, seletor, tabela, painel IA, config de chaves |
| `src/lib/gemini.ts`, `src/lib/markdown.ts`, `src/lib/diffCatalogo.ts` | **Novos**: cliente + failover, render, diff puro |
| `src/lib/api.ts`, `src/lib/types.ts` | Bindings/tipos: `config_get/set`, `discord_ler_canal` |
| `src/App.tsx`, `src/components/Sidebar.tsx` | Rota + item "Balanceamento" |
| Tela Discord (`src/features/*discord*`) | Seção "Regras do jogo" (mapeamento + sync + preview) |
| `src/features/characters/FichaForm.tsx` | Painel colapsável "Discutir com IA" (adendo — ficha do form como contexto) |
| `src-tauri/src/lib.rs` (+ `db/`) | Comandos `config_get`, `config_set`, `discord_ler_canal` |
| `sidecar/bot_sidecar.py` | Comando `ler_canal` |

Sem migrations novas. Sem deps novas. `tauri.conf.json` intocado (CSP `null`).

## 8. Erros

| Situação | Comportamento |
|---|---|
| Sem chave configurada | Painel IA desabilitado + aviso com atalho pra ConfigChaves |
| 429 na chave ativa | Failover automático pra próxima; toast "chave N esgotada, usando N+1" |
| Todas as chaves em 429 | "Cota esgotada em todas as chaves — tente mais tarde" |
| Sidecar/bot offline no sync | "Conecte o Discord primeiro" (sem crash) |
| Timeout/erro de rede Gemini | Mensagem no painel; UI não trava; botão reabilita |
| Parse do sync malformado | Erro + retry; preview nunca abre com dado inválido |

## 9. Testes e verificação

- **Vitest (novos):** failover (`429 → próxima chave`, `todas → ErroCotaEsgotada`, persiste índice), `diffCatalogo` (criar/atualizar/manter, case-insensitive), `markdown.ts`.
- **Rust:** testes de `config_get`/`config_set` (roundtrip, chave inexistente).
- **Fim de cada fatia:** `cargo test` + `cargo build` + `npm run build`; UI testada manualmente no app antes de "pronto".
- **Fatia C manual:** sync contra o servidor real do usuário, conferindo notas criadas e preview do catálogo.

## 10. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Parse IA erra entradas do catálogo | Preview obrigatório; nada grava sem confirmação |
| Sobrescrever curadoria manual | Diff mostra "atualizar" explicitamente; usuário decide |
| Canal com histórico enorme | Limite 200 mensagens (padrão), configurável no futuro |
| Nota de regras renomeada pelo usuário | Upsert é por título: próximo sync recria com o título original (duplicata inofensiva; documentado) |
| Chaves banidas (ToS multi-key) | Avisado; failover degrada até a última chave válida |
| Contexto grande (regras + fichas) | `gemini-2.5-flash` tem janela ampla; se estourar, cortar notas menos relevantes é evolução futura |
| Modelo/endpoint desatualizado no meu conhecimento | ctx7 na implementação antes de escrever o cliente |

## 11. Fora de escopo (agora)

- Radar chart / gráficos com lib externa.
- Persistir histórico de análises/chat.
- Sync automático agendado (é botão manual).
- Estruturar canais gerais (raças, akuma no mi) no Compêndio — ficam como Notas.
- Editar regras localmente com merge bidirecional Discord↔app.

## 12. Fases de entrega (3 planos em `docs/plans/`)

1. **Fatia A** — tela + comparação determinística (usável sozinha).
2. **Fatia B** — config de chaves + cliente Gemini + análise + chat.
3. **Fatia C** — sidecar `ler_canal` + sync notas + parse/preview do Compêndio.
