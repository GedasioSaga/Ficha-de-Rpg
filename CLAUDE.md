# projeto-rpg-v2 — Regras e contexto

RPG de mesa homebrew (One Piece/anime). Tauri 2: Rust + React 19/TS + Vite + Tailwind v4, SQLite via **rusqlite** (sem ORM). Migração da versão Python/PyQt6 em `C:\dev\Projeto Rpg`.

## Regras duras

- **Git ATIVO desde 2026-08-10** (decisão do usuário; revoga o "sem git" de 2026-07-20). Repo público: `github.com/GedasioSaga/Ficha-de-Rpg`. Publicação de versão = `scripts/publicar.ps1 -Versao X.Y.Z` (exporta semente → bump → commit → tag `vX.Y.Z` → push; o Actions builda e publica o release; apps instalados se atualizam sozinhos via tauri-plugin-updater).
- **Repo é PÚBLICO — nenhum segredo em claro, nunca.** Token Discord + chaves Gemini só viajam em `src-tauri/resources/segredos.enc` (AES-256-GCM + scrypt; par Node/Rust em `scripts/segredos-cifrar.mjs` ↔ `src-tauri/src/segredos.rs`). `segredos.local.json` é gitignored. A semente (`resources/rpg_semente.db`) sai do export com scrub (`secure_delete`+`VACUUM` — sem isso o dado apagado continua nas páginas livres). Gate anti-segredo no `publicar.ps1` antes do push.
- **Não mexer em segredos** (`.env`, tokens, `segredos.*`) sem pedido explícito.

## Convenções (seguir o que já existe)

- **Sem deps novas** sem avisar. Cargo.toml enxuto (rusqlite bundled, serde/serde_json, base64, sha2, thiserror, aes-gcm, scrypt, plugins tauri opener/shell/dialog/updater/process); frontend só com o que já está no package.json.
- **Backend:** migrations em `src-tauri/migrations/NNNN_*.sql`; snake_case pt-BR; `id INTEGER PRIMARY KEY`; timestamps `criado_em`/`atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))`. Comandos `#[tauri::command]` em `src-tauri/src/lib.rs`; persistência em `db/`; lógica pura e testável em `domain/`.
- **Frontend:** telas em `src/features/<area>/`; bindings em `src/lib/api.ts`; tipos em `src/lib/types.ts`; rota em `src/App.tsx`; nav em `src/components/Sidebar.tsx`.
- **Verificação:** `cargo test` + `cargo build` + `npm run build`; conferir **no main thread** (não só claim de subagente). Testar UI no browser antes de dizer "pronto".
- **Docs:** specs em `docs/specs/YYYY-MM-DD-*.md`; planos em `docs/plans/YYYY-MM-DD-*.md` (padrão Fase 0–3).

## Distribuição (2026-08-10)

- **Semântica do banco: "o que um computador vê todos veem".** Update do app SUBSTITUI o banco local pela semente do master (backup automático `rpg.db.bak-<versao>-<epoch>` antes; marcador `semente_importada.txt` evita rodar 2x; sha256 igual pula backup). Ver `src-tauri/src/semente.rs`.
- **Cofre:** máquina nova digita a senha-mestra 1x (`CofreSenhaDialog`); cache local em `%APPDATA%/com.gedasio.rpgv2/segredos.json` guarda a CHAVE DERIVADA — blob rotacionado em update entra sozinho. Token do Discord é injetado no spawn do sidecar via env (`discord/mod.rs`); chaves Gemini vão pra `config` do banco.
- **Sidecar:** `sidecar/bot_sidecar.py` tem `__TOKEN_PLACEHOLDER__` — NUNCA colocar token real ali. Rebuild: `sidecar/.venv/Scripts/pyinstaller.exe bot_sidecar.spec` e copiar `dist/bot_sidecar.exe` → `src-tauri/binaries/bot_sidecar-x86_64-pc-windows-msvc.exe`.
- **Updater:** chave minisign em `~/.tauri/ficha-rpg.key` (sem senha; TAMBÉM está em secret do GitHub Actions — perder a chave = apps não atualizam mais). Endpoint: `releases/latest/download/latest.json`.

## Estado (2026-08-10)

Fichas (jogadores/NPCs), engine de Batalha (Rust, ~25 testes + cockpit completo), Mapa (Fase 3) e Discord (sidecar Python: canais, mapa ao vivo, música) funcionando. Distribuição via GitHub Releases com auto-update, banco embutido e cofre de segredos implementados em 2026-08-10. Música = migrar do v1 depois.
