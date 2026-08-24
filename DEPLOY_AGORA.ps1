$ErrorActionPreference = "Stop"
Write-Host "Central de Midia - deploy corrigido" -ForegroundColor Cyan
Set-ExecutionPolicy -Scope Process Bypass -Force
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "worker")
Write-Host "Publicando Worker..." -ForegroundColor Yellow
npx.cmd wrangler deploy
Write-Host ""
Write-Host "DEPLOY CONCLUIDO." -ForegroundColor Green
Write-Host "Teste agora:" -ForegroundColor Cyan
Write-Host "https://ad-central-midia-api.adpdc.workers.dev/health"
Read-Host "Pressione Enter para fechar"
