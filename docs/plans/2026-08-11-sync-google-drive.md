# Plano — Sync via Google Drive (transporte de nuvem)

**Data:** 2026-08-11
**Status:** aprovado (grilling fechado), aguardando execução
**Depende de:** `docs/plans/2026-08-10-sync-nuvem.md` (Fase 0-3 já implementada: `.rpgpack`,
guarda leve, conflito, backup — 163 testes verdes). Este plano **reaproveita** tudo aquilo e
só troca/abstrai o **transporte** (pasta local → + Google Drive).
**Referência de código (copiar-de):** app `grimorio` em
`C:\Users\gedasio.filho\OneDrive - Vertis Capital\Área de Trabalho\Tudo\Projeto Obsidian\grimorio`.

---

## 1. Problema

O outro PC do usuário **não tem OneDrive** (nem vai ter). O sync por pasta local (já
construído) só resolve com um "carteiro" (pen drive, ou cloud instalado nos dois lados).
O `grimorio` resolve isso falando **direto com o Google Drive via API** (OAuth2, cliente
Rust) — funciona em qualquer PC com internet + login Google, sem depender de cloud de
arquivos instalado. Este plano traz esse transporte pro rpg-v2.

## 2. Decisões (grilling, 2026-08-11)

| # | Decisão | Escolha |
|---|---------|---------|
| Q1 | Credenciais Google | **Reusar as do `grimorio`** (mesmo `client_id`/`client_secret`). |
| Q2 | Modelo de dados | **Manter o `.rpgpack`** (um arquivo); Drive é só transporte. |
| Q3 | Automático | **Boot baixa sozinho + botões + auto-enviar com debounce** após editar. Sem poll de 60s. Auto-enviar **não força**: nuvem mais nova → segura, vira conflito. |
| Q4 | Deps novas | **Aprovadas 5:** `oauth2="5"`, `keyring="4"`, `tauri-plugin-oauth="2"`, `reqwest="0.12"` (rustls), `tokio="1"` (sync,time). |
| Q5 | Refresh token | **`keyring`** (Windows Credential Manager). Por-máquina, nunca viaja. |
| Q6 | `client_id`/`secret` | **No cofre `segredos.enc`** (não baked no binário público). |
| Q7 | Transporte | **Manter os dois** (Drive + pasta local) atrás de uma interface. |

**Escopo OAuth:** `drive.file` — o app só enxerga arquivos que ele mesmo criou (mínimo).

## 3. Consequências da reutilização (Q1) — decididas, registradas

- Com `drive.file`, o Google identifica o "app" pelo `client_id`. Reusando o do `grimorio`,
  os dois compartilham o mesmo sandbox no Drive. **Mitigação:** o rpg-v2 usa uma pasta
  própria `Ficha de RPG/` e o arquivo `rpg-estado.rpgpack` — nome distinto, sem colisão.
- O redirect loopback (`http://127.0.0.1:<porta>`) já está autorizado no app OAuth do
  `grimorio` → **zero configuração no Google Cloud Console**.
- Consentimento na conta do usuário já foi dado ao `grimorio`; reusar o mesmo `client_id`
  na mesma conta não exige re-verificação para uso pessoal.

## 4. Fatos técnicos (implementação, não decisão)

- **Upload resumable:** o `.rpgpack` (banco + imagens embutidas) pode passar de 5MB, e o
  `uploadType=multipart` do Drive (o que o `grimorio` usa, `drive.rs:52`) recusa acima
  disso. rpg-v2 implementa `uploadType=resumable` (inicia sessão → PUT em chunks).
- **Núcleo intocado:** `enviar`/`planejar_baixar`/`planejar_boot`/`ler_manifesto`/
  `aplicar_pacote` já operam sobre `Path`. O transporte materializa o pacote remoto num
  **temp local** antes de chamá-los, e publica o temp depois — o núcleo testado não muda.

## 5. Passo do usuário (fora do código, pré-requisito da Fase 5)

1. Copiar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` do `.env.local` do `grimorio`
   (**o usuário** faz isso — o assistente não lê esses valores).
2. Adicionar ao `segredos.local.json` do rpg-v2 (junto de `discord_token`/`gemini_api_keys`).
3. `node scripts/segredos-cifrar.mjs` → recifra o `segredos.enc`.
4. Publicar (o `publicar.ps1` embute o `segredos.enc` novo).

---

## Fase 0 — Deps + cofre (fundação, sem rede)

**Objetivo:** dependências no lugar e as credenciais Google fluindo do cofre. `cargo build` verde.

1. `Cargo.toml`: adicionar as 5 deps (Q4), com as MESMAS features do `grimorio`
   (`reqwest` default-features=false + rustls; `tokio` só `sync`,`time`).
2. `segredos.rs`: estender a `struct Segredos` com `google_client_id` / `google_client_secret`
   (Option/String). `carregar_no_setup` já entrega os segredos no boot; expor um getter pra
   o módulo de auth pegar as credenciais. **Não** ir pra `config` do banco (diferente das
   Gemini): credencial de app não é dado do banco, vive só em memória vinda do cofre.
3. `scripts/segredos-cifrar.mjs` + `segredos.local.json` (exemplo/doc): documentar os 2
   campos novos. **Não commitar valores.**
4. Ajustar o teste cross-impl Node↔Rust do cofre (`--auto-teste`) se a struct mudou.

**Checkpoint:** `cargo build` + `cargo test` verdes; cofre decifra com os campos novos (com
valores de teste, não reais).

## Fase 1 — Auth Google (OAuth2 + keyring)

**Objetivo:** login/logout Google funcionando, token no keyring. Copiado de `grimorio/src-tauri/src/auth.rs`.

1. Novo módulo `src-tauri/src/google/auth.rs` (adaptado de `grimorio` `auth.rs`, 466 linhas):
   - `credenciais()` lê `client_id`/`secret` do **cofre** (não `option_env!` como o grimorio —
     Q6). Este é o único desvio real do código-fonte do grimorio.
   - Escopo `drive.file` + identidade; PKCE; `tauri-plugin-oauth` pro redirect loopback.
   - Refresh token no `keyring` (`keyring::Entry`), chave por-app.
   - `access_token()` que troca refresh→access sob demanda (nunca cruza pro TS).
2. Comandos: `google_login`, `google_status() -> {conectado, email?}`, `google_logout`
   (registrar no `invoke_handler`).
3. Bindings TS em `src/lib/api.ts`.

**Checkpoint:** `google_login` abre o navegador, consente, volta; `google_status` diz
conectado; token sobrevive a restart (keyring). Testado no `tauri dev` (login é interativo —
**usuário** confirma).

## Fase 2 — Cliente Drive (enxuto, resumable)

**Objetivo:** subir/baixar UM arquivo no Drive. Copiado parcial de `grimorio/src-tauri/src/drive.rs`.

1. Novo módulo `src-tauri/src/google/drive.rs` — só o necessário pro modelo de 1 arquivo:
   - `garantir_pasta("Ficha de RPG") -> folder_id` (busca por nome no escopo `drive.file`, cria se não existe).
   - `achar_arquivo(folder_id, "rpg-estado.rpgpack") -> Option<{file_id, modified, size}>`.
   - `baixar(file_id, destino_local)` — GET `alt=media` streamando pro temp.
   - `enviar_resumable(folder_id, file_id: Option, origem_local)` — sessão resumable
     (POST inicia, PUT em chunks). `file_id=None` cria; `Some` substitui conteúdo. **Não**
     copiar o multipart do grimorio (limite 5MB).
   - `ler_manifesto_remoto`: baixa só o pacote (ou, se der, um range) e lê `_pacote_manifesto`.
     Simplest: baixa o pacote pro temp e reusa `ler_manifesto` local. (Otimização de range fica pra depois.)
2. Erros de rede viram `AppError` com mensagem pra UI (sem `panic`).

**Checkpoint:** teste de integração (marcado `#[ignore]`, roda manual com conta real): sobe um
`.rpgpack` de teste, baixa em outro temp, compara sha256. `cargo build` verde.

## Fase 3 — Abstração de transporte

**Objetivo:** `enviar`/`baixar`/`boot` funcionam sobre Drive OU pasta, sem duplicar o núcleo.

1. `sincronizacao_nuvem.rs`: `trait Transporte` com
   - `ler_manifesto() -> Result<Option<Manifesto>>`
   - `baixar_pacote_para(&self, destino_temp: &Path) -> Result<()>`
   - `publicar_pacote(&self, origem_temp: &Path) -> Result<()>`
   - `backup_remoto_se_existir(&self) -> Result<Option<String>>` (Q2 backup dos dois lados).
2. Impl `TransportePasta` (embrulha o comportamento de hoje — `caminho_pacote`, copiar
   atômico) e `TransporteDrive` (usa `google::drive`, materializa em temp local).
3. Refatorar `enviar`/`planejar_baixar`/`planejar_boot` pra receber `&dyn Transporte` em vez
   de `&Path`. O staging local do FIX1 (montar scrubado fora da pasta observada) continua —
   o `publicar_pacote` do Drive sobe o temp já scrubado; nenhum byte cru sai da máquina.
4. `config`: nova chave `sync_transporte` (`"pasta"` | `"drive"`); `sync_pasta` só vale pra `pasta`.

**Checkpoint:** `cargo test` verde (testes atuais passam com `TransportePasta`; novos testes de
`TransporteDrive` com um fake/mock in-memory do trait, sem rede real).

## Fase 4 — Frontend (escolha de transporte + login)

**Objetivo:** tela Sync ganha Google Drive. `npm run build` verde + teste no app.

1. `src/features/sync/` — seletor de transporte (Drive | Pasta). Se Drive: botão
   **Conectar Google** (login), status (email conectado), Desconectar. Reusa o padrão de
   `grimorio/src/components/OpcoesNuvem.tsx` (só o fluxo de login, não o motor de reconciliação).
2. Enviar/Baixar já existem; passam a operar sobre o transporte escolhido.
3. Tipos/bindings novos (`google_login`/`status`/`logout`, `sync_transporte`).

**Checkpoint:** `npm run build` + `cargo build` verdes; **usuário** testa login no `tauri dev`.

## Fase 5 — Auto-enviar + boot (fechar o laço)

**Objetivo:** o "automático" da Q3.

1. **Auto-enviar com debounce:** após uma mutação de dado (mesma superfície do
   `sync_revisao`/FIX2), agendar um envio depois de N s de quietude (debounce + coalescing).
   Frontend dispara; ou um timer no backend. **Não força** — se `status` disser nuvem mais
   nova, segura e marca conflito (não sobrescreve).
2. **Boot:** `planejar_boot` já existe; agora roda sobre o transporte configurado. Drive
   conectado + nuvem mais nova + local limpo → baixa sozinho (backup). Conflito → flag pra UI.
3. Pré-requisito operacional: credenciais Google no cofre (Fase 0 §5 do usuário) — senão o
   login falha com mensagem clara ("credenciais Google ausentes no cofre").

**Checkpoint:** ciclo real entre os dois PCs: editar no A → auto-enviar → abrir no B → baixa
sozinho no boot → editar no B → auto-enviar → voltar no A. Testar conflito (editar nos dois).

## Fase 6 — Revisão adversarial

Revisores paralelos, foco em:
- **Perda de dado:** boot/baixar/auto-enviar nunca sobrescrevem sem backup nem pulam o
  conflito; resumable interrompido não corrompe o remoto (Drive só troca o conteúdo ao fim da sessão).
- **Segredo:** `client_secret` nunca em claro no binário/repo; refresh token só no keyring;
  nenhum byte cru (Gemini) sai no `.rpgpack` (staging local do FIX1 mantido no caminho Drive);
  `access_token` não cruza pro TS.
- **Rede/atomicidade:** timeout/erro de rede vira mensagem, não panic; upload resumable
  parcial não deixa o remoto num estado inválido; download parcial vai pra temp, nunca por
  cima do `rpg.db` (o `aplicar_pacote` já faz backup+rename atômico).

---

## Verificação (tabela ao fim)

- `cargo test` + `cargo build` + `npm run build` — verdes (conferidos **no main thread**).
- Login Google real conecta e persiste (keyring) — teste manual do usuário.
- `.rpgpack` sobe e baixa via Drive; sha256 bate ponta a ponta.
- Gemini **ausente** no pacote que foi pro Drive.
- Boot: Drive com nuvem nova + local limpo baixa sozinho; local sujo abre conflito.
- Auto-enviar dispara após editar e coalesce; não força sobre nuvem mais nova.
- `client_secret` fora do binário em claro (grep no `.exe`/no repo).

## Riscos / fora de escopo

- **Reuso do `client_id` do grimorio:** sandbox `drive.file` compartilhado; mitigado por
  pasta/arquivo de nome próprio, mas o rpg-v2 tecnicamente lista arquivos do grimorio. Aceito (Q1).
- **Sem histórico de versões** do lado do sync (last-writer-wins + backup local), igual grimorio.
- **Edição simultânea** continua não suportada (Q do plano anterior).
- **Otimização de "ler só o manifesto" sem baixar o pacote inteiro** (range request) fica pra
  depois — Fase 2 baixa o pacote pra ler o manifesto. Ok pra um arquivo pequeno-médio.
- **Quota/rate limit do Drive** não é tratado com backoff sofisticado — erro vira mensagem;
  backoff exponencial fica pra depois se incomodar.

## Reuso / referência (arquivo:linha)

- `grimorio/src-tauri/src/auth.rs` — OAuth2+PKCE+keyring (copiar, trocar `credenciais()` pro cofre).
- `grimorio/src-tauri/src/drive.rs:24-25,129-243` — endpoints, criar/substituir arquivo (adaptar pra resumable).
- `grimorio/src/components/OpcoesNuvem.tsx` — fluxo de login no frontend (só o login).
- `src-tauri/src/db/sincronizacao_nuvem.rs` — núcleo já pronto: `enviar`/`planejar_baixar`/
  `planejar_boot`/`ler_manifesto`/`aplicar_pacote`/`montar_pacote` (staging FIX1).
- `src-tauri/src/lib.rs:922-1030+` — comandos de sync + `SyncBootState` (rotear pelo transporte).
- `src-tauri/src/segredos.rs` — `carregar_no_setup`/`struct Segredos` (estender com Google creds).
