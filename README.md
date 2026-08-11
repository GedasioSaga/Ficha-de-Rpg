# Ficha de RPG

App de mesa para RPG homebrew (One Piece/anime): fichas de personagens, engine
de batalha, mapa tático, notas e integração com Discord (bot de voz/música).
Tauri 2 — Rust + React 19/TypeScript + SQLite (rusqlite).

App pessoal de usuário único: **o banco de dados viaja junto com o instalador**.
A máquina "master" publica; as outras atualizam sozinhas e passam a ver o mesmo
conteúdo.

## Instalar numa máquina nova

1. Baixe o instalador (`*-setup.exe`) do release mais recente em
   [Releases](https://github.com/GedasioSaga/Ficha-de-Rpg/releases).
2. O Windows SmartScreen vai avisar (app sem certificado pago) — "Mais
   informações" → "Executar assim mesmo".
3. Abra o app e digite a **senha-mestra** quando pedida (1x por máquina —
   libera o bot do Discord e as chaves de IA, que viajam cifradas no
   instalador).

Pronto: fichas, mapas e notas da máquina master já aparecem. Atualizações
futuras instalam sozinhas (aviso no canto do app) e trazem o banco novo —
o banco anterior fica de backup em `%APPDATA%\com.gedasio.rpgv2\rpg.db.bak-*`.

## Publicar uma versão (máquina master)

```powershell
.\scripts\publicar.ps1 -Versao 0.2.0
```

O script: exporta o banco vivo pra semente (removendo segredos), sobe a versão,
commita, taggeia `v0.2.0` e dá push. O GitHub Actions builda o instalador
assinado e publica o release (~15-20 min). Acompanhe com `gh run watch`.

### Rotacionar segredos (token do Discord / chaves Gemini / credenciais Google)

1. Edite `segredos.local.json` na raiz (fora do git):
   `{ "discord_token": "...", "gemini_api_keys": "chave1,chave2", "google_client_id": "...", "google_client_secret": "..." }`
   (`google_client_id`/`google_client_secret` são opcionais — só o sync via
   Google Drive precisa deles.)
2. `node scripts/segredos-cifrar.mjs` (pede a senha-mestra) — gera
   `src-tauri/resources/segredos.enc`, que É commitável (cifrado).
3. Publique uma versão nova. As outras máquinas re-importam sozinhas, sem
   digitar nada.

## Desenvolvimento

```powershell
npm install
npm run tauri dev
```

Verificação: `cargo test` + `cargo build` (em `src-tauri/`) e `npm run build`
(raiz). O sidecar do Discord (`sidecar/bot_sidecar.py`) é Python; o exe
empacotado em `src-tauri/binaries/` é rebuildado com PyInstaller só quando o
sidecar muda.

## Segurança

- Repositório público: **nenhum segredo em claro**. Token do Discord e chaves
  Gemini viajam só em `resources/segredos.enc` (AES-256-GCM, chave derivada da
  senha-mestra via scrypt).
- A semente do banco (`resources/rpg_semente.db`) é exportada com scrub das
  chaves (`secure_delete` + `VACUUM`).
- `segredos.local.json` é gitignored; o `publicar.ps1` tem gate que aborta o
  push se detectar padrão de segredo no diff.
