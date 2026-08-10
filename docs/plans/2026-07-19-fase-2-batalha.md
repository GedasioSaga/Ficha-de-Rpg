# Fase 2 — Sistema de Batalha · Plano

> SUB-SKILL: subagent-driven-development. **SEM GIT** (checkpoint = builds+testes verdes). Base: `C:\dev\projeto-rpg-v2`.
> Padrão de execução (HANDOFF §7): implementar lendo este plano → verificar **headless** (`cargo test` + `cargo build` em `src-tauri`; `npm run build` na raiz) → o **usuário** roda `npm run tauri dev` pra validar a GUI. Antes de qualquer `cargo build`: matar `projeto-rpg-v2.exe` rodando (`Get-Process projeto-rpg-v2 -ErrorAction SilentlyContinue | Stop-Process -Force`) senão trava o lock de `target/`.
> Executar **uma slice por sessão limpa** (B0 → B1 → B2 → B3). Cada slice é um checkpoint verde independente.

**Goal:** Migrar o Sistema de Batalha do v1 (`Projeto Rpg/src/managers/sistema_batalha.py`, ~4191 linhas, god-file bugado) como **máquina de estado limpa em Rust** — NÃO traduzir o código. É uma **ferramenta manual de mestre**: o mestre digita o dano; o app rastreia estado (combatentes, iniciativa, HP/SP/escudo, transformações, cooldowns).

---

## Decisões travadas (grilling — não reabrir sem motivo)

1. **Manual limpo.** Port fiel sem os bugs. **Sem** gasto de SP automático, **sem** dano-auto, **sem** morte em 0 HP, **sem** absorção de escudo. O mestre ajusta os números; o app não decide dano.
2. **Cópia efêmera.** Ao entrar na batalha, copia HP/SP/escudo/8-atributos daquele instante. A **ficha salva nunca é alterada** pela batalha (corrige o footgun do v1 que gravava HP de NPC no `npcs.json` no meio da luta). Igual pra jogador e NPC.
3. **Identidade por ID único.** Combatente é uma **instância** com id próprio; permite N cópias do mesmo personagem (5 goblins), cada uma com HP/estado independente. (v1 usava `nome` → colisão.)
4. **Multi-batalhas persistidas** (meta; entregue no **B3**). Estado vivo inteiro salvo, sobrevive a fechar o app. Várias batalhas.
5. **Só histórico/log** (sem undo). Lista read-only do que aconteceu; corrige-se redigitando.
6. **Transformação em batalha**: aplica modificadores de **atributo** + concede **habilidades** + troca **retrato**. **Uma ativa por vez** (exclusiva). HP/SP da transformação = só sugestão exibida (mestre ajusta). Reverter subtrai os deltas exatos (sem corromper HP).
7. **Backfill dos campos de combate** da habilidade (`tempo`/`custo`/`dano`) — a migração da Fase 0 largou eles. Reabre schema + form de Fichas (**B0**, prereq).

**Padrões fiéis assumidos (default; mudar só se pedido):**
- **Iniciativa**: auto por **Agilidade efetiva** (`base + mods`) desc; empate = ordem de entrada (sort estável); modo manual reordena (↑/↓); **N turnos** por combatente na rodada.
- **HP/SP/escudo**: inteiros independentes, edição manual + **calculadora** (somar/subtrair/definir e %). **Clampa em ≥0 pra todos** (uniformiza; v1 deixava NPC negativar). Sem teto (não existe `hp_max` no schema).
- **Calculadora %**: `int(valor_base * pct / 100)` (trunca); `valor_base` é campo editável (default = valor atual); recuperar/perder soma/subtrai do valor atual; definir seta ao valor da %.
- **Cooldown**: `tempo` numérico = N turnos do dono; decrementa **no início do turno do dono**; reabilita em 0; `tempo` não-numérico/vazio = só reabilitar na mão. `custo`/`dano` são **exibidos**, nunca processados.

---

## Arquitetura geral

- **Estado da batalha vive no Rust.** B1/B2 rodam **em memória** via `tauri::State<Batalhas>` = `Mutex<HashMap<i64, EstadoBatalha>>` (registry de batalhas por id) + contador de ids. B3 serializa o `EstadoBatalha` pro SQLite e carrega sob demanda.
- **Lógica pura separada de I/O** (regra 14): as regras (iniciativa, expansão de turnos, cooldown tick, aplicar/reverter transformação, calculadora) são **funções puras sobre `EstadoBatalha`/`Combatente`**, testáveis sem DB nem Tauri. Comandos Tauri são cascas finas: lock → muta → (B3) persiste.
- **Sem SQL no front.** Contrato TS↔serde snake_case, sem `any` (igual Fichas).
- **Combatente = snapshot da ficha** ao adicionar; guarda `personagem_id` só pra retrato/reload.

---

## Slice B0 — Prereq: campos de combate da habilidade
**Files:** `src-tauri/migrations/0002_habilidade_combate.sql` (novo), `src-tauri/src/db/connection.rs`, `src-tauri/src/migration/importador_v1.rs`, `src-tauri/src/domain/modelos.rs`, `src-tauri/src/db/repositorios.rs`, `src/lib/types.ts`, `src/features/characters/FichaForm.tsx`, `src/features/characters/form/TransformacoesEditor.tsx`

Motivo: a `habilidade` v2 só tem `nome, descricao, ordem`; o v1 tem `status{acao, custo, tempo, dano, efeito, efeito_colateral, embuir}`. A Batalha precisa de `tempo` (cooldown) e exibe `custo`/`dano`. Sem isso, cooldown fiel é impossível.

- [ ] **Migration 0002** — `ALTER TABLE` adicionando colunas TEXT NOT NULL DEFAULT '' em **`habilidade`** e em **`transformacao_habilidade`** (mantém `HabilidadeDto` unificado): `tempo`, `custo`, `dano`. (Opcional, baixo custo, evita re-import futuro: `acao`, `efeito`, `efeito_colateral`, `embuir` — trazer só se quiser exibir tudo na batalha; senão fica em `tempo/custo/dano`.) Registrar a migration em `connection.rs::migrations()` (segundo `M::up`).
- [ ] **Importador** (`importador_v1.rs`): no loop de habilidades, ler `status` do registro v1 e popular as novas colunas (`s(status,"tempo")`, `s(status,"custo")`, `s(status,"dano")`). Idem para `habilidades_especiais` de transformação quando forem objeto (quando é string, campos ficam ''). Ajustar os `INSERT` (habilidade e transformacao_habilidade) e o helper.
- [ ] **Backfill** — o banco v2 é essencialmente o import do v1. **Confirmar no início da sessão** que não há fichas criadas/editadas à mão que valham (perguntar ao usuário / `SELECT count(*)`); se limpo, **re-importar**: apagar dados (`DELETE FROM personagem` — cascata limpa filhos; `DELETE FROM catalogo_*`; `DELETE FROM imagem`) e rodar `importar_v1` de novo (agora populando os campos). Se houver edições preciosas, fazer `UPDATE habilidade SET tempo=?,... WHERE personagem_id=? AND nome=? AND ordem=?` casando pelo v1 JSON (idempotente).
- [ ] **Modelos** (`modelos.rs`): `HabilidadeDto` e `HabilidadeInput` ganham `pub tempo: String, pub custo: String, pub dano: String`.
- [ ] **Repositórios**: `carregar_habilidades` e `carregar_habilidades_transformacao` fazem `SELECT ...,tempo,custo,dano`; `escrever_colecoes` insere os 3 nos dois `INSERT`. **Crítico**: sem isso o replace-all do CRUD apaga os campos ao editar qualquer ficha.
- [ ] **types.ts**: `HabilidadeDto` ganha `tempo: string; custo: string; dano: string`.
- [ ] **Form**: `FichaForm.tsx::renderHabilidade` e o editor de habilidade dentro de `TransformacoesEditor.tsx` ganham `CampoTexto` pra tempo/custo/dano (compactos, ex.: linha de 3). `inputVazio`/`vazio` de habilidade incluem `tempo:"",custo:"",dano:""`. `paraInput` já espalha `{...h}` — confere que os campos vêm.
- [ ] **Verificar**: `cargo test` (os testes de fichas seguem verdes; ajustar `input_base`/asserts se algum construir `HabilidadeInput` literal — precisa dos 3 campos novos). `cargo build` limpo. `npm run build` (tsc bate o contrato). GUI: editar uma ficha, ver tempo/custo/dano preenchidos, salvar, reabrir — persistem.

**DoD B0:** habilidades carregam com tempo/custo/dano; CRUD round-tripa sem apagar; re-import populou os campos; builds verdes.

---

## Slice B1 — Núcleo da batalha (em memória)
**Files:** `src-tauri/src/domain/batalha.rs` (novo — regras puras), `src-tauri/src/domain/mod.rs`, `src-tauri/src/lib.rs` (comandos + `State`), `src/lib/types.ts`, `src/lib/api.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/features/battle/*` (novo).

### Contrato (Rust `domain/batalha.rs`; espelhar em `types.ts`)
```rust
// ordem dos 8 = crate ATRIBUTOS (forca,agilidade,percepcao,resistencia,intuicao,espirito,carisma,determinacao)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabilidadeCombate {
    pub nome: String, pub descricao: String,
    pub tempo: String, pub custo: String, pub dano: String,
    pub origem: Origem,            // Base | Transformacao
    pub desabilitada: bool,
    pub turnos_restantes: Option<i64>,   // None = permanente/manual
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Combatente {
    pub id: i64,                  // id da instância (sequencial na batalha)
    pub personagem_id: i64,       // ficha de origem
    pub nome: String,             // nome base da ficha
    pub rotulo: String,           // "Goblin" ou "Goblin #2" (desambigua duplicados)
    pub tipo: String,             // "jogador" | "npc"
    pub hp: i64, pub sp: i64, pub escudo: i64,
    pub base: [i64; 8],           // atributos base (snapshot)
    pub mods: [i64; 8],           // modificadores atuais (transformação etc.)
    pub turnos_extras: i64,       // 0..=19 (total de turnos = 1 + extras)
    pub retrato: Option<String>,  // caminho atual (forma base ou transformação ativa)
    pub transformacao_ativa: Option<String>,   // nome da transformação
    pub habilidades: Vec<HabilidadeCombate>,
}
// total(attr) = base[i] + mods[i]; agilidade_efetiva = total(agilidade)

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoBatalha {
    pub id: i64,
    pub nome: String,
    pub combatentes: Vec<Combatente>,
    pub rodada: i64,              // começa 1
    pub turno: i64,              // índice 0-based na lista expandida
    pub modo_manual: bool,       // false = auto por agilidade
    pub proximo_id: i64,         // contador de ids de combatente
    pub log: Vec<EntradaLog>,    // B3 usa; B1 já pode empurrar entradas
}
```

### Regras puras (testar cada uma)
- [ ] `ordem_iniciativa(&EstadoBatalha) -> Vec<usize>`: se `!modo_manual`, índices de `combatentes` ordenados por `agilidade_efetiva` desc, **estável** (empate = ordem no vetor = ordem de entrada). Se manual, ordem do vetor como está.
- [ ] `turnos_expandidos(&EstadoBatalha) -> Vec<usize>`: pra cada combatente na `ordem_iniciativa`, repetir o índice `1 + turnos_extras` vezes (consecutivos).
- [ ] `proximo_turno(&mut EstadoBatalha)`: `turno += 1`; se `turno >= len(expandidos)` → `turno = 0`, `rodada += 1`. Depois `tick_cooldowns(dono_do_turno_atual)` (B2 preenche; em B1 stub no-op). Empurra `EntradaLog`.
- [ ] `nova_rodada(&mut)`: `rodada += 1`, `turno = 0` (sem tick — é "pular pro início da próxima rodada"). Log.
- [ ] `mover_turno(&mut, de, para)` (modo manual): troca posição no vetor `combatentes` (reordena a base; a expansão re-deriva).
- [ ] `calcular(valor_atual, op, arg, base_pct) -> i64` (calculadora): básico somar/subtrair/definir; % conforme padrão acima; **clampa `max(0, r)`**. Função pura, com testes de truncamento.

### Comandos Tauri (`lib.rs`) — casca fina sobre `State<Batalhas>`
```rust
struct Batalhas(Mutex<HashMap<i64, EstadoBatalha>>, /*proximo_id_batalha*/ Mutex<i64>);
```
- [ ] `criar_batalha(nome) -> i64` (B1: em memória; B3: persiste).
- [ ] `get_batalha(id) -> EstadoBatalha`.
- [ ] `adicionar_combatente(batalha_id, personagem_id, tipo, turnos) -> ()`: lê a ficha (`get_personagem`), snapshota hp/sp/escudo/base[8]/retrato/habilidades (mapeia `HabilidadeDto`→`HabilidadeCombate` origem=Base), gera `id` e `rotulo` (sufixo `#n` se já houver o mesmo nome), `mods=[0;8]`.
- [ ] `remover_combatente(batalha_id, combatente_id)`: remove; ajusta `turno` se passou do fim.
- [ ] `editar_pool(batalha_id, combatente_id, campo, valor)` (hp/sp/escudo; clamp ≥0).
- [ ] `aplicar_calculo(batalha_id, combatente_id, campo, op, arg, base_pct)`.
- [ ] `proximo_turno` / `nova_rodada` / `alternar_modo_ordenacao` / `mover_turno` / `editar_turnos_extras`.
- [ ] Registrar todos no `generate_handler!`. `app.manage(Batalhas(...))` no `.setup()`.

### Frontend (`src/features/battle/`)
- [ ] `App.tsx`: rota `/batalha` (+ `/batalha/:id` se ajudar). `Sidebar.tsx`: item **Batalha** vira `<Link>` ativo (tirar "em breve").
- [ ] `types.ts` + `api.ts`: espelhar structs + wrappers `invoke`.
- [ ] Tela `Batalha.tsx`: layout 3 colunas do v1 — **esquerda** lista de fichas disponíveis (reusa `listarPersonagens`) com botão "＋ à batalha" (pede nº de turnos); **centro** perfil do combatente selecionado (retrato, pools editáveis com calculadora, atributos com total=base+mod, reusar `rank.calcular_rank` se quiser badge); **direita** trilha de turnos (lista expandida, destaca turno atual, botões Próximo turno / Nova rodada / modo auto-manual / reordenar).
- [ ] Primitivos reusados: `Tabs`, `Dialog`, `Toast`, `CampoNumero`, `atributos.ts`, `retrato.ts`, `RetratoUpload`-style preview (só leitura). Sem deps novos.
- [ ] Estado: `useQuery(["batalha", id])` + `useMutation` por ação → `invalidateQueries(["batalha", id])`. (B1 sem persistência: o backend guarda em memória; refetch lê o estado vivo.)

**DoD B1:** criar batalha, adicionar jogador+NPC, editar HP/SP/escudo (na mão e calculadora), iniciativa auto por agilidade, próximo turno/nova rodada, reordenar manual, N turnos. `cargo test` (regras puras) verde; `cargo build` + `npm run build` limpos; GUI validada.

---

## Slice B2 — Transformações + habilidades/cooldown em batalha
**Files:** `src-tauri/src/domain/batalha.rs`, `src-tauri/src/lib.rs`, `src/features/battle/*`.

### Regras (decisões 6 + cooldown)
- [ ] `aplicar_transformacao(&mut Combatente, &TransformacaoDto)`: se `transformacao_ativa.is_some()` → `reverter_transformacao` antes (exclusiva). Pra cada modificador **de atributo** (dos 8): `mods[i] += delta`. **hp/sp modificadores NÃO são aplicados** (só exibidos como sugestão na UI — decisão 6). Concede `habilidades` da transformação: push em `combatente.habilidades` com `origem=Transformacao`. `retrato = transformacao.retrato`. `transformacao_ativa = Some(nome)`. Se auto e agilidade mudou, a próxima expansão já reflete.
- [ ] `reverter_transformacao(&mut Combatente, &TransformacaoDto)`: `mods[i] -= delta` (exatos, dos mesmos modificadores de atributo). Remove habilidades com `origem=Transformacao`. `retrato` volta pra forma base (guardar `retrato_base` no `Combatente`, ou re-ler da ficha). `transformacao_ativa = None`. (Sem drift de HP porque nunca mexemos em HP.)
- [ ] `usar_habilidade(&mut Combatente, idx)`: se já `desabilitada` → erro/no-op. Parse `tempo`: `i64::from_str` ok e `>0` → `desabilitada=true, turnos_restantes=Some(n)`; senão → `desabilitada=true, turnos_restantes=None` (permanente/manual). Log. **NÃO gasta SP, NÃO aplica dano.**
- [ ] `reabilitar_habilidade(&mut Combatente, idx)`: `desabilitada=false, turnos_restantes=None`.
- [ ] `tick_cooldowns(&mut EstadoBatalha, dono_idx)` (chamado por `proximo_turno` no início do turno do dono): pra cada habilidade `desabilitada` com `Some(n)` do combatente `dono_idx`: `n-=1`; se `n<=0` → reabilita (log "Reabilitação automática"). Só do dono do turno atual.

### Comandos + Frontend
- [ ] Comandos: `aplicar_transformacao(batalha_id, combatente_id, transformacao_nome)` (lê a `TransformacaoDto` da ficha via `get_personagem`), `reverter_transformacao`, `usar_habilidade`, `reabilitar_habilidade`.
- [ ] UI no perfil (centro): seletor de transformação (forma base + transformações da ficha; destaca a ativa; clicar aplica/troca; clicar forma base reverte). Lista de habilidades com estado (ativa/em cooldown `turnos_restantes`), botão Usar/Reabilitar, e **detalhe** (descricao/custo/tempo/dano) num `Dialog`.

**DoD B2:** aplicar transformação muda atributos totais + agilidade/iniciativa + retrato + concede habilidades; reverter restaura exato; usar habilidade entra em cooldown pelo `tempo`; cooldown decrementa no turno do dono e reabilita em 0; reabilitar manual funciona. Testes de regra verdes; GUI validada.

---

## Slice B3 — Histórico + persistência + multi-batalha
**Files:** `src-tauri/migrations/0003_batalha.sql` (novo), `connection.rs`, `src-tauri/src/db/repositorios.rs` (ou `db/batalhas.rs` novo), `lib.rs`, `src/features/battle/*`.

### Persistência (serializada — decisão de storage)
Estado vivo é carregado/salvo **inteiro e atômico**; não há query cross-batalha. → **blob serializado**, não tabelas normalizadas (revisitar se um dia precisar consultar dentro).
- [ ] **Migration 0003**: `CREATE TABLE batalha (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, estado_json TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')))`.
- [ ] Repositório `batalhas`: `listar` (id+nome+atualizado_em), `criar(nome)`, `carregar(id) -> EstadoBatalha` (serde_json::from_str), `salvar(&EstadoBatalha)` (upsert `estado_json` + `atualizado_em=datetime('now')`), `excluir(id)`, `renomear(id,nome)`.
- [ ] **Autosave**: cada comando mutante do B1/B2 passa a persistir o `estado_json` após mutar (dentro do mesmo lock). O `State<Batalhas>` vira cache; no boot, `listar` popula a lista; `carregar` sob demanda. (Alternativa: salvar só em "Salvar"/trocar de aba — decidir na implementação; autosave é mais seguro, é ferramenta de mestre ao vivo.)

### Histórico (log — decisão 5)
- [ ] `EntradaLog { rodada, turno, combatente: Option<String>, acao: String, detalhe: String }`. As regras do B1/B2 já empurram entradas. Cap ~200 (corta as antigas).
- [ ] UI: painel/aba **Histórico** read-only (tabela rodada/turno/quem/ação/detalhe). Sem botão de desfazer.

### Multi-batalha
- [ ] UI: lista/abas de batalhas (`listar_batalhas`), criar/renomear/excluir/fechar, trocar entre elas. Cada uma isolada (id próprio). Confirmar exclusão com `Dialog`.

**DoD B3:** fechar e reabrir o app mantém a batalha em andamento (HP/mods/transformações/cooldowns/turno/rodada); várias batalhas coexistem; histórico mostra as ações. Testes de serialização (round-trip `EstadoBatalha` ↔ json) verdes; GUI validada.

---

## Verificação (DoD — Fase 2 completa)
**Headless (subagente roda e reporta, por slice):**
- [ ] `cargo test` verde — regras puras de batalha (iniciativa/expansão/cooldown/transformação/calculadora/serialização) + os testes antigos intactos.
- [ ] `cargo build` limpo (só o warning benigno do linker MSVC).
- [ ] `npm run build` ok (`tsc` sem erro; sem `any`; contrato TS↔serde batendo).

**GUI (usuário roda `npm run tauri dev`):** roteiro por slice nos DoD acima.

## Fora de escopo (Fase 2)
- **Automação de combate** (gasto de SP, dano-auto, alvo/seleção, morte/KO em 0 HP, absorção de escudo) — decisão 1. Fica pra uma fase futura se o uso pedir.
- **Undo real** (multi-nível/snapshots) — decisão 5. Só log.
- **Discord** (painel de música acoplado à Batalha no v1) — é feature própria, migra separado (sidebar já prevê).
- **Cooldown em habilidade concedida por transformação** — só as `Base` cooldowneiam por ora.
- **Sincronizar resultado da batalha de volta pra ficha** — decisão 2 (efêmero). Adicionar botão opt-in só se pedido.

## Notas de qualidade
- **Regras puras testáveis** separadas de I/O (regra 14) — `domain/batalha.rs` sem Tauri/DB; comandos são cascas.
- Um teste por regra de negócio (empate de iniciativa, N turnos, cooldown tiquetaqueia só no turno do dono e reabilita em 0, transformação exclusiva + revert exato, calculadora % trunca e clampa).
- Reusar `ATRIBUTOS`/`ROTULO_ATRIBUTO` (`atributos.ts`), `retrato.ts`, `rank::calcular_rank`, `Tabs`/`Dialog`/`Toast`. Zero deps novos.
- Contrato TS↔serde snake_case, sem `any`. Nada de SQL no front.
- **Antes da Fase 2 rodar**: aplicar o fix do review do Slice 3 (#1 — `key`/reset do prefill do `FichaForm`), já que a Batalha vai ler fichas via as mesmas rotas.
