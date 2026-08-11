# Plano — Sincronização de estado entre PCs via pasta na nuvem

**Data:** 2026-08-10
**Status:** aprovado (grilling fechado), aguardando execução
**Spec-mãe:** decisão do usuário nesta sessão; revoga parcialmente a semântica
"o que um computador vê todos veem" de `src-tauri/src/semente.rs:7-13` (ver Fase 0).

---

## 1. Problema

Hoje o dado do usuário só flui numa direção: a máquina *master* exporta a
semente (`exportar_semente.rs`), o release carrega, e cada **update do app**
substitui o banco local pela semente (`semente.rs::sincronizar_semente`, branch
"Update de verdade", linha 94-101). Editar no PC-B nunca volta pro PC-A; pior,
o próximo update do PC-B apaga o que foi criado nele.

O usuário quer: adicionar personagens/mapas/notas/músicas (URLs) **em qualquer
PC** e ver o mesmo estado no outro. Uso **um PC de cada vez** (nunca simultâneo).

## 2. Decisões (grilling, 2026-08-10)

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Update do app vs dados | **Update mexe só no app.** Semente vira bootstrap de máquina vazia; nunca mais sobrescreve dado. |
| Q2 | Proteção contra sobrescrita | **Guarda leve:** carimbo (contador↑ + hora + id do PC); avisa antes de sobrescrever; backup dos dois lados. |
| Q3 | Boot automático | **Baixa sozinho** quando a nuvem é mais nova **e o local está limpo**. Local também alterado = conflito → **para e pergunta**. |
| Q4 | Formato na nuvem | **Um arquivo atômico só.** Implementado como pacote SQLite (`.rpgpack`), sem dep nova (ver §3). |
| Q5 | Chaves Gemini no pacote | **Scrubadas** (mesmo tratamento da semente). Cofre entrega em cada PC. |
| Q6 | Imagens órfãs | **Aditivo, nunca apaga.** |
| Q7 | Semente no `publicar.ps1` | **Mantida** como bootstrap de PC novo. |

**Modelo mental:** a pasta na nuvem é a fonte da verdade. Cada PC **Envia** ao
sair, **Baixa** ao chegar. A nuvem (OneDrive/Drive/Dropbox) faz o transporte.

## 3. Decisão técnica — pacote SQLite, sem dependência nova

Zip exigiria crate novo (`Cargo.toml` não tem; regra "sem deps novas"). Em vez
disso, o pacote é **um único arquivo SQLite** `rpg-estado.rpgpack`:

- O banco em si vem de `VACUUM INTO` (snapshot consistente do banco vivo) — o
  mesmo mecanismo de `exportar_semente.rs:56-84`, reusado.
- Scrub das chaves Gemini roda **na cópia**, via `secure_delete` + `DELETE FROM
  config` + `VACUUM` — idem `exportar_semente.rs:70-80`.
- As imagens entram como BLOB numa tabela `_pacote_imagem(nome TEXT PRIMARY
  KEY, bytes BLOB)` dentro do próprio pacote.
- O carimbo entra numa tabela `_pacote_manifesto(contador INT, epoch INT,
  machine_id TEXT, hash_dados TEXT, versao_app TEXT, schema_pacote INT)`.
- Gravação atômica: monta em `<pasta>/rpg-estado.rpgpack.tmp` e `rename` no
  final (atômico no mesmo volume) — mesma técnica de `semente.rs::copiar_atomico`.

Um arquivo = a nuvem nunca sincroniza estado pela metade. Para o usuário é
idêntico a um zip: um arquivo na pasta.

## 4. Carimbo e ordenação (guarda leve)

**No `config` local (NÃO sincroniza — cada PC tem o seu):**

- `sync_pasta` — caminho da pasta da nuvem escolhido neste PC.
- `sync_machine_id` — id aleatório gerado uma vez neste PC.
- `sync_contador` — contador do último pacote que este PC **produziu ou aplicou**.
- `sync_hora` — timestamp da última sincronização bem-sucedida.

**"Qual lado é mais novo"** decide-se pelo `contador` monotônico do manifesto:

- `nuvem.contador > local.sync_contador` → **nuvem mais nova**.
- `nuvem.contador == local.sync_contador` → **em dia** (é o mesmo pacote).
- `nuvem.contador < local.sync_contador` → **local mais novo** (este PC enviou depois).

**"Local sujo"** (editado desde a última sync) = `max(atualizado_em)` nas
tabelas do usuário é mais recente que `sync_hora`. Leitura pura, sem tocar o
caminho de escrita, sem trigger. (Alternativa se a granularidade de 1s de
`atualizado_em` se mostrar insuficiente: contador de revisão via trigger — só
se necessário; começa sem.)

**Lógica de cada ação:**

- **Enviar:** `novo = max(local.sync_contador, nuvem.contador) + 1`. Se
  `nuvem.contador > local.sync_contador` → avisa *"enviando por cima de algo
  mais novo na nuvem (v{n})"* antes de gravar. Grava pacote, atualiza
  `sync_contador = novo`, `sync_hora = agora`.
- **Baixar (manual):** se `em dia` e não sujo → *"já está em dia"*. Se local
  sujo → avisa antes de substituir. Backup do banco, aplica, atualiza carimbo.
- **Boot (automático):** se `nuvem.contador > local.sync_contador`:
  - local **limpo** → baixa sozinho (backup + aplica + atualiza carimbo).
  - local **sujo** → **conflito**: diálogo *"a nuvem tem v{n} mais nova, mas
    você tem mudanças locais não enviadas"* → Baixar (perde locais, com backup)
    / Manter locais / Cancelar.
- **Primeira sync numa máquina** (`sync_contador` ausente): Baixar faz backup
  do que houver (a semente do bootstrap) antes de trocar, sem prompt de
  conflito — não há baseline pra comparar.

---

## Fase 0 — Fundação (Rust puro, sem UI)

**Objetivo:** schema de controle + módulo esqueleto + desarmar o overwrite da
semente. Verificável por `cargo test`.

1. **Migration** `src-tauri/migrations/NNNN_sync_config.sql`: nada de tabela
   nova obrigatória — as chaves de controle vivem no `config` KV existente. (Se
   preferir tabela dedicada, decidir aqui; padrão: reusar `config`.)
2. **Modelo A — cortar o overwrite:** em `semente.rs::sincronizar_semente`,
   remover/desarmar o branch "Update de verdade" (linha 94-101). Novo contrato:
   a semente **só** age quando `banco_esta_vazio` (bootstrap); banco com dado do
   usuário → `EmDia`/no-op, jamais `Substituido`. Atualizar o doc-comment
   (linha 7-21) e **os testes** que hoje esperam `Substituido` (`mod tests`,
   linha 215+) para o novo comportamento.
3. **Módulo novo** `src-tauri/src/db/sincronizacao_nuvem.rs` — lógica pura e
   testável (recebe `Path`s, não `AppHandle`, igual `semente.rs`):
   - `montar_pacote(banco_vivo, imagens_dir, destino_tmp, manifesto) -> Result`
     — VACUUM INTO + scrub Gemini + embute imagens BLOB + grava manifesto.
   - `ler_manifesto(pacote) -> Manifesto` — abre read-only, lê `_pacote_manifesto`.
   - `aplicar_pacote(pacote, banco_destino, imagens_dir) -> Backup` — backup,
     extrai BLOBs (aditivo), materializa rpg.db limpo (drop das `_pacote_*` +
     VACUUM), rename atômico.
   - `decidir_acao(local: Carimbo, nuvem: Option<Manifesto>, sujo: bool) -> Acao`
     — função pura que devolve `EmDia | NuvemMaisNova | LocalMaisNovo |
     Conflito | SemNuvem`. É o coração da guarda leve; testar exaustivamente.
4. **Testes Fase 0:** round-trip (montar→aplicar dá banco equivalente, Gemini
   ausente, imagens presentes); `decidir_acao` para cada combinação de
   contador × sujo; semente não sobrescreve banco com dado.

**Checkpoint:** `cargo test` verde; `cargo build` verde.

## Fase 1 — Comandos Tauri (backend exposto)

**Objetivo:** expor a Fase 0 como comandos, sem UI ainda. Verificável por chamada manual.

1. Estado local do carimbo: helpers `carimbo_ler(conn)` / `carimbo_gravar(conn)`
   sobre o `config` (reusa `db::repositorios::config_get/config_set`).
2. `machine_id`: gerar uma vez (aleatório) e persistir em `config` se ausente,
   no `setup()` de `lib.rs`.
3. Comandos `#[tauri::command]` em `lib.rs` (registrar no `invoke_handler`,
   linha 1013+):
   - `sync_definir_pasta(caminho)` / `sync_pasta_atual() -> Option<String>`.
   - `sync_status() -> SyncStatus` — lê nuvem + local + sujo, roda
     `decidir_acao`, devolve `{ acao, contador_nuvem, contador_local, sujo,
     hora }` pra UI.
   - `sync_enviar(forcar: bool) -> SyncResultado` — guarda leve; `forcar` pula o
     aviso "por cima de mais novo".
   - `sync_baixar(forcar: bool) -> SyncResultado` — idem, backup antes.
4. **Testes Fase 1:** comandos sobre um `app_data` temporário (padrão do
   `mod tests` da semente, linha 219-247).

**Checkpoint:** `cargo test` + `cargo build` verdes; comandos testados via
`tauri dev` no console.

## Fase 2 — Frontend (tela de sync)

**Objetivo:** botões e status visíveis. Verificável no browser/app.

1. `src/lib/types.ts` — `SyncStatus`, `SyncResultado`.
2. `src/lib/api.ts` — bindings dos comandos da Fase 1.
3. `src/features/sync/` — `SyncTela.tsx`: escolher pasta (dialog nativo via
   `tauri-plugin-dialog`, já é dep), botões **Enviar**/**Baixar**, painel de
   status (em dia / nuvem mais nova / local não enviado), diálogo de conflito
   (reusa `components/Dialog.tsx`) e toast de resultado (`components/Toast.tsx`).
4. Rota em `src/App.tsx` + item no `src/components/Sidebar.tsx`.

**Checkpoint:** `npm run build` verde; **usuário** testa no `tauri dev`
(escolher pasta, Enviar, conferir arquivo na pasta, Baixar no outro PC).

## Fase 3 — Boot automático + conflito

**Objetivo:** fechar o laço "chegou no PC, já vê o novo".

1. No `setup()` de `lib.rs` (após abrir o banco, ~linha 951+): se `sync_pasta`
   definida, rodar `decidir_acao`. `NuvemMaisNova` + limpo → aplica sozinho
   (backup) e loga. `Conflito` → **não** aplica no setup; marca uma flag que a
   UI lê no primeiro render pra abrir o diálogo de conflito (setup não tem UI).
2. Frontend: ao montar, `sync_status()`; se `Conflito`, abre o diálogo; se
   `NuvemMaisNova` já aplicada no boot, toast informativo.

**Checkpoint:** ciclo completo entre dois PCs (ou duas pastas `app_data`
simuladas): editar A → Enviar → Baixar em B (auto no boot) → editar B → Enviar
→ voltar em A. Testar o caminho de conflito forçando edição dos dois lados.

---

## Verificação (tabela de dupla checagem ao fim)

- `cargo test` (round-trip, `decidir_acao`, semente-não-sobrescreve) — verde.
- `cargo build` + `npm run build` — verdes.
- Gemini **ausente** no `.rpgpack` (abrir o pacote e conferir `config`).
- Imagens presentes após Baixar; órfã antiga preservada (aditivo).
- Backup criado antes de cada substituição (`rpg.db.bak-*`).
- Boot: nuvem nova + limpo baixa sozinho; nuvem nova + sujo abre conflito.
- Conferência **no main thread**, não só claim de subagente (regra do projeto).

## Riscos / fora de escopo

- **Esquecer de Enviar** continua possível; a guarda leve **avisa**, não
  impede. É o trade-off aceito de "um PC de cada vez" sem merge.
- **Edição simultânea** (dois PCs ao mesmo tempo) **não é suportada** — foi
  decisão explícita (Q, simultâneo = não). Entra merge por item só se o uso mudar.
- **Detecção de "local sujo"** por `max(atualizado_em)` tem granularidade de 1s;
  se falhar na prática, plano B é contador de revisão por trigger (Fase 0 nota).
- **Órfãs acumulam** (aditivo) — GC de imagem fica pra depois, como já está
  pendente no resto do app.
- **`batalha_ativa`** é snapshot de linha única com timestamp próprio; entra no
  `max(atualizado_em)` se tiver a coluna — conferir na Fase 0.

## Reuso (arquivo:linha)

- `exportar_semente.rs:56-84` — `VACUUM INTO` + scrub Gemini (padrão a extrair/compartilhar).
- `semente.rs:181-213` — `copiar_atomico`, `copiar_imagens_faltantes`, backup.
- `semente.rs:107-113` — nome de backup `rpg.db.bak-<versao>-<epoch>`.
- `db::repositorios::config_get/config_set` — carimbo no KV.
- `components/{Dialog,Toast}.tsx` — diálogo de conflito e feedback.
- `tauri-plugin-dialog` — seletor de pasta nativo (já é dep).
