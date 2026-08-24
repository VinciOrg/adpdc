$ErrorActionPreference = "Stop"
Write-Host "Central de Midia - Patch fotos + videos + capas" -ForegroundColor Cyan
Write-Host ""

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Worker = Join-Path $Here "worker"

if (-not (Test-Path $Worker)) {
  throw "Pasta worker nao encontrada. Extraia o ZIP inteiro antes de executar."
}

Set-Location $Worker
Write-Host "Publicando o Worker atualizado..." -ForegroundColor Yellow
npx.cmd wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "Falha no deploy do Worker." }

Write-Host ""
Write-Host "WORKER ATUALIZADO." -ForegroundColor Green
Write-Host "Agora substitua no site: index.html, styles.css, icons.js e app.js." -ForegroundColor Green
Write-Host "A pasta assets inclui brand-mark.png caso ainda nao tenha aplicado o patch visual anterior." -ForegroundColor DarkGray
Write-Host ""
Read-Host "Pressione Enter para fechar"
