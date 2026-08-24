# =============================================================
# CENTRAL DE MÍDIA — AJUDANTE DE DEPLOY DO CLOUDFLARE R2/WORKER
# =============================================================
# Pré-requisito: Node.js instalado.
# O script NÃO salva a chave secreta em arquivo.
# =============================================================

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkerDir = Join-Path $Root "worker"
Set-Location $WorkerDir

Write-Host "" 
Write-Host "Central de Midia - Cloudflare R2" -ForegroundColor Cyan
Write-Host "Este assistente vai instalar o Wrangler, criar o bucket e publicar o Worker." -ForegroundColor White
Write-Host ""

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js/npm nao encontrado. Instale o Node.js e rode este arquivo novamente." -ForegroundColor Red
  Read-Host "Enter para fechar"
  exit 1
}

Write-Host "Instalando dependencias..." -ForegroundColor Yellow
npm install

Write-Host "Abrindo login da Cloudflare..." -ForegroundColor Yellow
npx wrangler login

Write-Host "Criando bucket R2 (se ja existir, o aviso pode ser ignorado)..." -ForegroundColor Yellow
try { npx wrangler r2 bucket create ad-central-midia-originals } catch { Write-Host "Bucket provavelmente ja existe; continuando." -ForegroundColor DarkYellow }

$SupabaseUrl = (Read-Host "Supabase Project URL").TrimEnd('/')
$Publishable = Read-Host "Supabase Publishable key (sb_publishable_...)"
$Allowed = Read-Host "URL do site (ex.: https://usuario.github.io) - pode deixar * durante o primeiro teste"
if ([string]::IsNullOrWhiteSpace($Allowed)) { $Allowed = "*" }

$Toml = @"
name = "ad-central-midia-api"
main = "src/index.js"
compatibility_date = "2026-08-01"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "ad-central-midia-originals"

[vars]
SUPABASE_URL = "$SupabaseUrl"
SUPABASE_PUBLISHABLE_KEY = "$Publishable"
ALLOWED_ORIGINS = "$Allowed"
"@
Set-Content -Path (Join-Path $WorkerDir "wrangler.toml") -Value $Toml -Encoding UTF8

Write-Host "" 
Write-Host "Agora cole a SUPABASE SECRET KEY quando o Wrangler pedir." -ForegroundColor Yellow
Write-Host "Essa chave fica nos Secrets da Cloudflare e NAO vai para o site." -ForegroundColor Yellow
npx wrangler secret put SUPABASE_SECRET_KEY

Write-Host "" 
Write-Host "Agora crie um segredo aleatorio longo para os tokens temporarios." -ForegroundColor Yellow
Write-Host "Pode ser uma sequencia aleatoria de 40+ caracteres; guarde em local seguro." -ForegroundColor Gray
npx wrangler secret put MEDIA_TOKEN_SECRET

Write-Host "Publicando Worker..." -ForegroundColor Yellow
npm run deploy

Write-Host "" 
Write-Host "PRONTO." -ForegroundColor Green
Write-Host "Copie a URL workers.dev mostrada acima e cole em WORKER_URL dentro de config.js." -ForegroundColor Cyan
Write-Host ""
Read-Host "Pressione Enter para fechar"
