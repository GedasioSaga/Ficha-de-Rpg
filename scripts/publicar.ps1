# Publica uma versao nova: exporta a semente da maquina master, sobe a versao
# nos 3 manifestos, commita, taggeia e da push - o GitHub Actions faz o resto
# (build NSIS assinado + release com latest.json; os apps instalados atualizam
# sozinhos ao ver o release).
#
# Uso (na raiz do projeto):
#   .\scripts\publicar.ps1 -Versao 0.2.0
#
# Pre-requisitos: git limpo (ou so mudancas que voce quer publicar juntas),
# gh autenticado, segredos.enc ja gerado (scripts/segredos-cifrar.mjs).
#
# OBS: arquivo mantido sem acentos de proposito - PowerShell 5.1 le .ps1 sem
# BOM como ANSI e caracteres fora do ASCII quebram o parse.

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Versao
)

# "Continue" de proposito: cargo e git escrevem coisa normal no stderr
# (warning de linker, progresso de push) e com "Stop" o PS 5.1 mata o script
# nisso. O controle de erro real e por $LASTEXITCODE apos cada comando nativo.
$ErrorActionPreference = "Continue"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Checar($etapa) {
    if ($LASTEXITCODE -ne 0) { throw "$etapa falhou (exit $LASTEXITCODE)" }
}

# 0. Gate do binario principal. O crate tem DOIS bins (src/main.rs -> o app, e
# src/bin/exportar_semente.rs -> utilitario de dev). Sem `default-run` o
# tauri-cli escolhe sozinho, e na v0.2.0 escolheu o exportar_semente: o
# instalador saiu SEM o app dentro e o atalho abria um utilitario de console
# que morria sozinho. Nao da pra checar o installer.nsi aqui (quem builda e o
# CI), entao trava na config - que e a causa raiz.
Write-Host "== Gate do binario principal..." -ForegroundColor Cyan
$cargoToml = [System.IO.File]::ReadAllText("$raiz\src-tauri\Cargo.toml")
if ($cargoToml -notmatch '(?m)^\s*default-run\s*=\s*"projeto-rpg-v2"\s*$') {
    throw 'src-tauri/Cargo.toml sem default-run = "projeto-rpg-v2". O bundle sairia com o binario errado (v0.2.0). Publicacao ABORTADA.'
}

# 1. App aberto segura lock do target/ e pode escrever no banco no meio do export.
Get-Process "projeto-rpg-v2" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process "One Piece RPG" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Semente: banco vivo desta maquina -> resources/ (com scrub de segredos).
Write-Host "== Exportando semente do banco vivo..." -ForegroundColor Cyan
Push-Location "$raiz\src-tauri"
cargo run --quiet --bin exportar_semente 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "exportar_semente falhou" }
Pop-Location

# 3. Bump de versao nos 3 manifestos (tauri.conf.json e o que a tag/release usa).
# SEM Set-Content -Encoding utf8: no PS 5.1 ele grava BOM, e o CI nao parseia
# JSON/TOML com BOM (foi o que derrubou o primeiro build da v0.2.0).
Write-Host "== Versao -> $Versao" -ForegroundColor Cyan
$utf8SemBom = New-Object System.Text.UTF8Encoding $false
function BumpVersao($caminho, $padrao, $novo) {
    $texto = [System.IO.File]::ReadAllText($caminho)
    [System.IO.File]::WriteAllText($caminho, ($texto -replace $padrao, $novo), $utf8SemBom)
}
BumpVersao "$raiz\src-tauri\tauri.conf.json" '"version": "\d+\.\d+\.\d+"' "`"version`": `"$Versao`""
BumpVersao "$raiz\src-tauri\Cargo.toml" '(?m)^version = "\d+\.\d+\.\d+"' "version = `"$Versao`""
BumpVersao "$raiz\package.json" '"version": "\d+\.\d+\.\d+"' "`"version`": `"$Versao`""

# Cargo.lock precisa acompanhar o bump do Cargo.toml (senao o runner do CI
# regenera o lock e o build local diverge do publicado). `cargo metadata`
# re-resolve e reescreve o lock sem compilar nada.
Push-Location "$raiz\src-tauri"
cargo metadata --format-version 1 | Out-Null
Pop-Location

# 4. Gate anti-segredo: nada de token/chave em claro no que vai subir.
Write-Host "== Gate anti-segredo..." -ForegroundColor Cyan
git add -A
$staged = git diff --cached --name-only
$suspeitos = git grep --cached -I -n -E "AIza[0-9A-Za-z_-]{20,}|[MN][A-Za-z0-9]{22,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}|BEGIN (RSA |EC )?PRIVATE KEY|gho_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}"
if ($suspeitos) {
    Write-Host $suspeitos -ForegroundColor Red
    throw "Possivel segredo detectado - publicacao ABORTADA. Confira antes de tentar de novo."
}
if ($staged -contains "segredos.local.json") { throw "segredos.local.json staged - NUNCA. Abortado." }

# 5. Commit + tag + push (o push da tag dispara o workflow de release).
git commit -m "release: v$Versao" 2>&1 | ForEach-Object { "$_" }
Checar "git commit"
# Tag ANOTADA de proposito: `git push --follow-tags` ignora tag leve
# (aprendido na v0.2.0 - a tag ficou local e o workflow nunca disparou).
git tag -a "v$Versao" -m "release v$Versao" 2>&1 | ForEach-Object { "$_" }
Checar "git tag"
git push --follow-tags 2>&1 | ForEach-Object { "$_" }
Checar "git push"

Write-Host ""
Write-Host "v$Versao publicada. Acompanhe o build:" -ForegroundColor Green
Write-Host "  gh run watch" -ForegroundColor Green
Write-Host "Release sai em ~15-20 min; os apps instalados mostram o aviso de update no proximo boot." -ForegroundColor Green
