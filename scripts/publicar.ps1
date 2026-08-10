# Publica uma versão nova: exporta a semente da máquina master, sobe a versão
# nos 3 manifestos, commita, taggeia e dá push — o GitHub Actions faz o resto
# (build NSIS assinado + release com latest.json; os apps instalados atualizam
# sozinhos ao ver o release).
#
# Uso (na raiz do projeto):
#   .\scripts\publicar.ps1 -Versao 0.2.0
#
# Pré-requisitos: git limpo (ou só mudanças que você quer publicar juntas),
# gh autenticado, segredos.enc já gerado (scripts/segredos-cifrar.mjs).

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Versao
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# 1. App aberto segura lock do target/ e pode escrever no banco no meio do export.
Get-Process "projeto-rpg-v2" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process "One Piece RPG" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Semente: banco vivo desta máquina -> resources/ (com scrub de segredos).
Write-Host "== Exportando semente do banco vivo..." -ForegroundColor Cyan
Push-Location "$raiz\src-tauri"
cargo run --quiet --bin exportar_semente
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "exportar_semente falhou" }
Pop-Location

# 3. Bump de versão nos 3 manifestos (tauri.conf.json é o que a tag/release usa).
Write-Host "== Versão -> $Versao" -ForegroundColor Cyan
$conf = "$raiz\src-tauri\tauri.conf.json"
(Get-Content $conf -Raw -Encoding utf8) -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$Versao`"" |
    Set-Content $conf -Encoding utf8 -NoNewline

$cargo = "$raiz\src-tauri\Cargo.toml"
$cargoTexto = Get-Content $cargo -Raw -Encoding utf8
$cargoTexto = $cargoTexto -replace '(?m)^version = "\d+\.\d+\.\d+"', "version = `"$Versao`""
Set-Content $cargo -Value $cargoTexto -Encoding utf8 -NoNewline

$pkg = "$raiz\package.json"
(Get-Content $pkg -Raw -Encoding utf8) -replace '"version": "\d+\.\d+\.\d+"', "`"version`": `"$Versao`"" |
    Set-Content $pkg -Encoding utf8 -NoNewline

# Cargo.lock precisa acompanhar o bump do Cargo.toml (senão o runner do CI
# regenera o lock e o build local diverge do publicado). `cargo metadata`
# re-resolve e reescreve o lock sem compilar nada.
Push-Location "$raiz\src-tauri"
cargo metadata --format-version 1 | Out-Null
Pop-Location

# 4. Gate anti-segredo: nada de token/chave em claro no que vai subir.
Write-Host "== Gate anti-segredo..." -ForegroundColor Cyan
git add -A
$staged = git diff --cached --name-only
$suspeitos = git diff --cached -U0 | Select-String -Pattern 'AIza[0-9A-Za-z_-]{20,}', '[MN][A-Za-z\d]{23,}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{20,}', 'BEGIN( RSA)? PRIVATE KEY'
if ($suspeitos) {
    Write-Host $suspeitos -ForegroundColor Red
    throw "Possível segredo no diff — publicação ABORTADA. Confira antes de tentar de novo."
}
if ($staged -contains "segredos.local.json") { throw "segredos.local.json staged — NUNCA. Abortado." }

# 5. Commit + tag + push (o push da tag dispara o workflow de release).
git commit -m "release: v$Versao"
git tag "v$Versao"
git push --follow-tags

Write-Host ""
Write-Host "v$Versao publicada. Acompanhe o build:" -ForegroundColor Green
Write-Host "  gh run watch" -ForegroundColor Green
Write-Host "Release sai em ~15-20 min; os apps instalados mostram o aviso de update no próximo boot." -ForegroundColor Green
