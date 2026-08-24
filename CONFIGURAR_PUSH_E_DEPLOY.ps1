$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Central de Midia - Web Push" -ForegroundColor Cyan
Write-Host "Configura as chaves VAPID e publica o Worker." -ForegroundColor DarkGray
Write-Host ""

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Worker = Join-Path $Root "worker"
Push-Location $Worker

try {
  Write-Host "[1/4] Instalando dependencias do Worker..." -ForegroundColor Yellow
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }

  Write-Host "[2/4] Conferindo secrets de Web Push..." -ForegroundColor Yellow
  $secretList = (& npx.cmd wrangler secret list --name ad-central-midia-api 2>&1 | Out-String)
  $hasPublic = $secretList -match "VAPID_PUBLIC_KEY"
  $hasPrivate = $secretList -match "VAPID_PRIVATE_KEY"

  if (-not ($hasPublic -and $hasPrivate)) {
    Write-Host "Gerando novas chaves VAPID no seu computador..." -ForegroundColor Yellow
    $json = & node.exe .\generate-vapid.mjs
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel gerar as chaves VAPID." }
    $keys = $json | ConvertFrom-Json

    Write-Host "Salvando VAPID_PUBLIC_KEY como secret do Worker..." -ForegroundColor Yellow
    $keys.publicKey | & npx.cmd wrangler secret put VAPID_PUBLIC_KEY --name ad-central-midia-api
    if ($LASTEXITCODE -ne 0) { throw "Falha ao salvar VAPID_PUBLIC_KEY." }

    Write-Host "Salvando VAPID_PRIVATE_KEY como secret do Worker..." -ForegroundColor Yellow
    $keys.privateKey | & npx.cmd wrangler secret put VAPID_PRIVATE_KEY --name ad-central-midia-api
    if ($LASTEXITCODE -ne 0) { throw "Falha ao salvar VAPID_PRIVATE_KEY." }
  } else {
    Write-Host "As chaves VAPID ja existem. Nao vou gira-las novamente." -ForegroundColor Green
  }

  Write-Host "[3/4] Publicando o Worker..." -ForegroundColor Yellow
  & npx.cmd wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw "Deploy do Worker falhou." }

  Write-Host "[4/4] PRONTO." -ForegroundColor Green
  Write-Host "Abra para conferir:" -ForegroundColor White
  Write-Host "https://ad-central-midia-api.adpdc.workers.dev/health" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Depois substitua no site: index.html, styles.css, icons.js, app.js e sw.js." -ForegroundColor White
}
finally {
  Pop-Location
}

Read-Host "Pressione Enter para fechar"
