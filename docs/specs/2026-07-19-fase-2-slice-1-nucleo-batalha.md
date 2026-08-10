# Projeto RPG v2 — Spec Fase 2 Slice 1 (B1): Núcleo da Batalha

**Data:** 2026-07-19
**Status:** Rascunho (aguardando review do usuário)
**Base directory:** `C:\dev\projeto-rpg-v2`
**Fase/slice:** Fase 2 (Batalha), Slice 1 — o motor. Slices posteriores (UI, persistência, status nomeados, economia de ações, times/AoE, grid) têm escopo próprio.

---

## 1. Contexto e objetivo

Descoberta que molda tudo (extração do v1): **o "sistema de batalha" do v1 NÃO é um motor de combate — é um rastreador manual.** São 4192 linhas num arquivo (`sistema_batalha.py`) que só guardam números; o mestre calcula tudo de cabeça e digita HP/SP numa calculadora. No código do v1 não existe: fórmula de dano, dado, acerto/erro, condição de vitória, targeting nem status (só cooldown de habilidade). **As regras de verdade só existem como texto HTML** em `jogo_descricao.py` (motor e livro divorciados).

**Portanto não há motor a portar — há regras a implementar pela primeira vez.**

**Meta do B1:** um **motor assistido, headless, em Rust puro** — máquina de estado limpa + funções de regra puras. O mestre dirige; o motor faz a conta e sempre aceita override. Testável 100% por `cargo test`, **sem UI, sem DB, efêmero em memória**. Estruturado para receber os sistemas pesados depois (status temporais, economia de ações, grid, times/AoE) sem remexer o núcleo.

### Decisões travadas (via grilling)

| # | Tema | Decisão | Motivo |
|---|---|---|---|
| 1 | Estado | **Log de eventos**: estado = aplicar eventos em ordem; undo = descarta o último; histórico = a lista | Undo+histórico já eram features do v1; salvar-depois = gravar a lista; os 4 sistemas futuros viram eventos novos |
| 2 | Contrato | **Só helpers** independentes (`rolar_d20`, `resolver_reacao`, `calcular_dano`, `aplicar_dano`) — cada um emite evento | Entrega o "assistido" sem impor fluxo rígido; troca guiada encostaria no "motor autônomo" descartado |
| 3 | rank→mod | **`rank/2`** uniforme (R0=0, R11=+5, R12=+6, R13=+6) | Bate exato com a prosa em R1–R10 e cobre R0 e R11–13 (que a prosa nunca definiu) sem caso especial |
| 4 | RNG | **PRNG próprio semeável** (xorshift) via trait `Dado` (impl real + roteirizada) | Testes deterministas; mantém "zero deps novos" (Cargo.toml enxuto, sem `rand`) |
| 5 | Dano | Motor faz só o **universal** (crítico ×1.5, redução %, dano verdadeiro, roteamento de pool, piso 0). `base` é input do mestre (já com arma/força/raça embutidos) | As regras de base/força/raça do v1 são situacionais (por arma/raça), não constantes globais — assumir o mínimo |
| 6 | Aplicação | **Escudo antes do HP** (sugestão), piso 0, **override sempre** (helper sugere, aplicar aceita valor final) | Assiste a parte fiddly sem tirar a autoridade do mestre |
| 7 | Combatente | **Snapshot** dos stats no início da batalha (não referência viva ao personagem) | Mata o bug do v1 de gravar no personagem em disco no meio do combate; permite duplicados (2 goblins) |
| 8 | Modificador | `{origem, deltas, duracao?}` unifica **transformação** (deltas, sem duração) e **status futuro** (deltas + duração). Cooldown é flag paralela (mesma cadência de decremento) | Um substrato de efeito, extensível a status nomeados sem reestruturar |
| 9 | Turno | Ordem por agilidade efetiva desc + modo manual + `turnos_extras` (1+N slots/rodada); turno = janela **multi-evento**; durações/cooldowns decrementam no início do turno do dono | Paridade v1 + abre economia de ações sem virar "1 ação/turno" rígido |
| 10 | Escopo | Efêmero; **sem DB/migration, sem UI, sem `#[tauri::command]`** (glue Tauri = B2) | B1 é o núcleo headless; a cola só faz sentido junto da tela |

---

## 2. Arquitetura e princípios

- **Log de eventos como fonte única de verdade.** `Batalha` guarda o estado corrente **e** `Vec<Evento>`. Cada operação do motor muta o estado e registra o evento correspondente. `desfazer` = descartar o último evento e reconstruir o estado aplicando o log restante do zero (o estado é pequeno; refold é trivial — não otimizar antes de medir). **Valores rolados ficam gravados no evento** (`D20Rolado{valor}`), então o refold é determinístico e não re-rola.
- **Camadas claras** (regra do usuário): regras puras (`regras.rs`) separadas do estado (`modelos.rs`) e do log (`eventos.rs`). Nenhuma regra depende de I/O, DB ou UI.
- **RNG injetável:** trait `Dado`, para os testes serem deterministas.
- **Combatente é snapshot:** ao entrar na batalha, copia os atributos e pools do personagem. Nada em combate escreve de volta no personagem persistido.
- **Efêmero:** a `Batalha` vive em memória (não é gravada; sem migration nova). Persistência é um slice posterior (serializar `eventos`).

---

## 3. Escopo

### DENTRO (B1)
- Modelo de combate em memória: combatentes, pools (HP/SP/Escudo), modificadores, cooldowns, ordem de iniciativa, rodada/turno.
- Iniciativa por agilidade efetiva (desc) + modo manual (reordenar) + `turnos_extras`.
- Avanço de turno/rodada; decremento de durações e cooldowns no turno do dono.
- Transformações: aplicar/reverter (aditivas, **1 ativa por vez** — paridade v1).
- Cooldown de habilidade (trava N turnos ou permanente até o fim do combate).
- Quatro funções de regra puras: `rolar_d20`, `rank_para_modificador`, `resolver_reacao`, `calcular_dano`.
- Aplicação de dano/cura (escudo→HP, piso 0, override).
- Log de eventos + `desfazer`.
- RNG semeável (`Dado` + xorshift + roteirizado).
- Testes `cargo test`.

### FORA (slices/fases posteriores — portas deixadas abertas)
- **UI / tela de batalha** e wrappers `#[tauri::command]` → **B2**.
- **Persistência** (save/load, migrar `batalhas_salvas.json`) → B2+ (log já é serializável).
- **Status temporais nomeados** (sangramento, buff/debuff) → substrato `duracao` pronto.
- **Economia de ações** (completa/simples/reação/movimento/bônus) → turno já é multi-evento.
- **Grid/movimento em blocos** → **Fase 3 (Mapa)**; combatente é id-indexado.
- **Times/facções + AoE** → campo `faccao: Option` e alvo `Vec<id>` já no modelo.
- **Multi-batalha simultânea.**

---

## 4. Modelo de domínio (Rust)

```rust
enum Atributo { Forca, Agilidade, Percepcao, Resistencia, Intuicao, Espirito, Carisma, Determinacao }
enum Pool { Hp, Sp, Escudo }
enum Tipo { Jogador, Npc }                 // só cosmético, como no v1

struct Pools { hp: i64, sp: i64, escudo: i64 }   // piso 0, sem teto (paridade v1)

enum OrigemModificador { Transformacao(String), Status(String) }
struct Modificador {
    origem: OrigemModificador,
    deltas: Vec<(Atributo, i64)>,   // somados aos atributos base
    duracao: Option<u8>,            // None = até reverter; Some(n) = n turnos do dono
}

struct Cooldown {
    habilidade: String,
    turnos_restantes: Option<u8>,   // None = permanente até o fim do combate
}

type CombatenteId = u32;            // sintético, próprio da batalha

struct Combatente {
    id: CombatenteId,
    personagem_ref: Option<i64>,    // id no DB; None = combatente ad-hoc
    nome: String,
    tipo: Tipo,
    faccao: Option<String>,         // None no B1 (abre times/AoE)
    base: [i64; 8],                 // snapshot dos 8 atributos, na ordem do enum Atributo
    pools: Pools,                   // snapshot inicial, mutável no combate
    modificadores: Vec<Modificador>,
    cooldowns: Vec<Cooldown>,
    turnos_extras: u8,              // 0..N
}
// atributo_efetivo(a) = base[a] + Σ deltas de a em modificadores
// agilidade_efetiva alimenta a ordem de iniciativa

struct Batalha {
    combatentes: Vec<Combatente>,
    ordem_manual: bool,             // false = auto por agilidade
    ordem: Vec<CombatenteId>,       // ordem de iniciativa (1 entrada por combatente)
    rodada: u32,                    // começa em 1
    indice_turno: usize,            // caminha na ordem expandida por turnos_extras
    eventos: Vec<Evento>,
    dado: Box<dyn Dado>,
}
```

**Ordem expandida:** por rodada, cada combatente ocupa `1 + turnos_extras` slots. `indice_turno` percorre esses slots; ao dar wrap, `rodada += 1` e recomeça. `ordem` é recalculada por `agilidade_efetiva` desc quando `ordem_manual == false` (com desempate estável por `id`); no modo manual, o mestre define/reordena.

---

## 5. Log de eventos

Vocabulário do log (o motor emite; o estado é o fold destes):

```rust
enum Evento {
    CombatenteAdicionado { id: CombatenteId },
    CombatenteRemovido   { id: CombatenteId },
    OrdemDefinida        { ordem: Vec<CombatenteId> },
    ModoOrdemAlternado   { manual: bool },
    TurnosExtrasEditados { id: CombatenteId, valor: u8 },
    TransformacaoAplicada{ id: CombatenteId, nome: String },
    TransformacaoRevertida{ id: CombatenteId, nome: String },
    HabilidadeUsada      { id: CombatenteId, habilidade: String, cooldown: Option<u8> },
    HabilidadeReabilitada{ id: CombatenteId, habilidade: String, automatica: bool },
    ModificadorExpirado  { id: CombatenteId, origem: OrigemModificador },
    D20Rolado            { valor: u8 },
    ReacaoResolvida      { tipo: TipoReacao, d20: u8, multiplicador: f64, contra_ataque: bool },
    DanoAplicado         { id: CombatenteId, pool: Pool, valor: i64 },
    Recuperado           { id: CombatenteId, pool: Pool, valor: i64 },
    ProximoTurno         { rodada: u32, indice: usize },
    NovaRodada           { rodada: u32 },
    Resetado,
}
```

`desfazer()` remove o último evento e refold. O histórico para a UI (paralelo ao "HistoricoWindow" do v1) é a própria `Vec<Evento>`.

---

## 6. Funções de regra (puras, testáveis)

```rust
// 1. Dado
fn rolar_d20(dado: &mut dyn Dado) -> u8   // 1..=20

// 2. Rank → modificador de teste (Testes de atributo: 1d20 + mod)
fn rank_para_modificador(rank: u8) -> i8  // rank / 2  → R0=0 .. R10=+5, R11=+5, R12=+6, R13=+6
// (rank vem de domain::rank::calcular_rank(atributo, valor_efetivo))

// 3. Reação (o defensor rola 1d20 SEM modificador)
enum TipoReacao { Defender, Esquiva, ContraAtaque }
struct ResultadoReacao { multiplicador: f64, contra_ataque: bool }
fn resolver_reacao(tipo: TipoReacao, d20: u8) -> ResultadoReacao
//   Defender:     d20 >= 10 → multiplicador 0.5, senão 1.0
//   Esquiva:      d20 >= 15 → multiplicador 0.0, senão 1.0
//   ContraAtaque: d20 >= 20 → multiplicador 0.0 + contra_ataque=true, senão 1.0

// 4. Dano (só o universal; base já vem composto pelo mestre)
struct EntradaDano { base: i64, critico: bool, reducao_percent: Option<u8>, dano_verdadeiro: bool }
struct ResultadoDano { valor: i64, memoria: String }   // memoria = passo-a-passo p/ log/UI
fn calcular_dano(e: &EntradaDano) -> ResultadoDano
```

**Pipeline de `calcular_dano` (ordem exata, sem ambiguidade):**
1. `dano = base`
2. se `critico`: `dano = round(dano * 1.5)`
3. se **não** `dano_verdadeiro` e há `reducao_percent = r`: `dano = round(dano * (1 - r/100))`
4. `dano = max(0, dano)`

**Composição (receita helpers-only, documentada para a UI/mestre):** o dano final que chega numa pool é
`aplicar_dano(alvo, round(calcular_dano(...).valor * resolver_reacao(...).multiplicador), pool?)`.
Os helpers são independentes; o mestre (ou a UI no B2) os combina e pode sobrepor qualquer número.

---

## 7. Regras de aplicação e cadência

- **`aplicar_dano(id, valor, pool: Option<Pool>)`:** sem `pool` → **escudo absorve primeiro**, transbordo vai pro HP; com `pool` → debita direto naquela. Piso 0. Emite `DanoAplicado` (uma ou duas, se transbordar). SP nunca é debitado por dano automaticamente (é recurso de habilidade).
- **`recuperar(id, valor, pool)`:** soma na pool, sem teto (paridade v1). Emite `Recuperado`.
- **Override sempre:** os helpers só devolvem sugestão; `aplicar_dano`/`recuperar` recebem o valor final que o mestre confirmar.
- **Decremento (início do turno do dono):** ao começar o turno de um combatente, decrementa `duracao` dos seus `Modificador`es (remove ao chegar a 0 → `ModificadorExpirado`; se a agilidade mudou, recalcula a ordem) e `turnos_restantes` dos seus `Cooldown`s (reabilita ao chegar a 0 → `HabilidadeReabilitada{automatica:true}`, paridade com a "Reabilitação Automática" do v1).
- **Transformação:** aplicar remove a ativa antes (1 por vez); soma os deltas (aditivo, não substitui — paridade v1); reverter subtrai os mesmos deltas. HP/SP alterados por transformação (se houver) somam/subtraem direto na pool.

---

## 8. RNG determinístico

```rust
trait Dado { fn d20(&mut self) -> u8; }         // devolve 1..=20
struct DadoXorshift { estado: u64 }             // new(seed); seed real via SystemTime no runtime
struct DadoRoteirizado { sequencia: Vec<u8>, i: usize }   // devolve valores fixos → testes deterministas
```

`Batalha::nova()` recebe um `Box<dyn Dado>` (produção = xorshift semeado; testes = roteirizado).

---

## 9. Estrutura de arquivos (novo módulo)

```
src-tauri/src/domain/
├── rank.rs          # calcular_rank (existente) + rank_para_modificador (novo)
└── batalha/
    ├── mod.rs       # struct Batalha + operações do motor (a "API"); pub re-exports
    ├── modelos.rs   # Combatente, Pools, Modificador, Cooldown, enums
    ├── eventos.rs   # Evento + aplicação (fold) + desfazer
    ├── regras.rs    # resolver_reacao, calcular_dano
    └── dado.rs      # trait Dado + DadoXorshift + DadoRoteirizado
```
`domain/mod.rs` ganha `pub mod batalha;`. Testes: módulos `#[cfg(test)]` inline em cada arquivo, seguindo o estilo já usado no projeto (confirmar no plano).

**Operações do motor** (métodos de `Batalha`, sem `#[command]` no B1): `adicionar_combatente`, `remover_combatente`, `definir_ordem`, `mover_na_ordem`, `alternar_modo_ordem`, `editar_turnos_extras`, `aplicar_transformacao`, `reverter_transformacao`, `usar_habilidade`, `reabilitar_habilidade`, `aplicar_modificador`, `rolar_d20`, `resolver_reacao`, `calcular_dano`, `aplicar_dano`, `recuperar`, `proximo_turno`, `nova_rodada`, `desfazer`, `resetar`. Erros via `AppError` (padrão do projeto).

---

## 10. Testes e verificação (o "green" do B1)

`cargo test` cobrindo:
- **Iniciativa:** ordena por agilidade efetiva desc; desempate estável; modo manual preserva a ordem definida.
- **Turnos:** `turnos_extras` gera 1+N slots; `proximo_turno` caminha e faz wrap → `nova_rodada`; `rodada` incrementa certo.
- **Transformação:** aplica (aditivo), reverte (volta ao base), só 1 ativa (aplicar outra remove a anterior); mudança de agilidade reordena.
- **Cooldown:** `usar_habilidade` trava por N turnos; decrementa só no turno do dono; reabilita automático em 0; `tempo` não numérico → permanente.
- **rank_para_modificador:** tabela inteira R0..R13 (0,0,1,1,2,2,3,3,4,4,5,5,6,6).
- **resolver_reacao:** 3 tipos nos limites — Defender 9/10, Esquiva 14/15, ContraAtaque 19/20 (abaixo = multiplicador 1.0).
- **calcular_dano:** base puro; crítico ×1.5 (arredondamento); redução %; dano verdadeiro ignora redução; crítico+redução combinados; piso 0.
- **aplicar_dano:** escudo absorve antes do HP; transbordo; pool explícita; piso 0; SP intacto.
- **desfazer:** remove o último evento e reconstrói o estado idêntico ao anterior.
- **RNG roteirizado:** sequência fixa produz rolagens previsíveis; refold com `D20Rolado` não re-rola.

---

## 11. Critérios de aceite

- `cargo test` verde (todos os casos da §10), **verificado no main thread** (não só claim de subagente — padrão do projeto).
- `cargo build` limpo.
- **Cargo.toml inalterado** (zero deps novos).
- Sem UI, sem migration, sem `#[tauri::command]`.
- Combate roda inteiro em memória; nenhum acesso a DB ou disco.

---

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Over-engineering do log de eventos | Escopo enxuto; refold trivial p/ estado pequeno; sem framework de command bus |
| Regras de dano do v1 são fuzzy (força/raça) | Motor faz só o universal (crítico/redução/pool); `base` é input do mestre — documentado na §6 |
| Ranks R0 e R11–13 sem tabela na prosa | Resolvido: `rank/2` uniforme (decisão 3) |
| Bug de sync do v1 (grava personagem em combate) | Combatente é snapshot; nada escreve de volta |
| Testes não-deterministas por RNG | Trait `Dado` + impl roteirizada |
| Escopo inchar com os 4 sistemas | Portas abertas no modelo (`duracao`, `faccao`, alvo-`Vec`, id-indexado), mas **implementação deles é fora do B1** |

---

## 13. Próximos slices

- **B2 — Tela de batalha:** UI React + wrappers `#[tauri::command]`; provável save/load (serializar o log) e migração de `batalhas_salvas.json`.
- **Depois:** status nomeados (usa `duracao`), economia de ações (turno multi-evento), times/facções + AoE (`faccao`/alvo-`Vec`).
- **Grid/movimento:** junto da **Fase 3 (Mapa)**.
