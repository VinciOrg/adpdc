# =============================================================
# CENTRAL DE MÍDIA — CRIAÇÃO DOS 4 USUÁRIOS REAIS
# Funciona com sb_secret_... novo OU service_role legado.
# Rode DEPOIS do supabase-setup.sql.
# =============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Central de Midia - criacao dos 4 usuarios" -ForegroundColor Cyan
Write-Host "A chave secreta fica apenas nesta janela do PowerShell." -ForegroundColor Yellow
Write-Host ""

$SupabaseUrl = (Read-Host "Project URL (ex.: https://abc.supabase.co)").TrimEnd('/')
$SecureKey = Read-Host "Supabase Secret key (sb_secret_...) ou service_role legado" -AsSecureString
$Ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
try { $SecretKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Ptr) }

$Domain = "midia.adpc.app"
$Users = @(
  @{ username = "lider";   password = "midia2026";  name = "Lider da Midia"; role = "leader" },
  @{ username = "editor";  password = "editar2026"; name = "Editor";         role = "editor" },
  @{ username = "camera1"; password = "camera2026"; name = "Camera 1";       role = "member" },
  @{ username = "camera2"; password = "camera2026"; name = "Camera 2";       role = "member" }
)

$Headers = @{ "apikey" = $SecretKey; "Content-Type" = "application/json" }
# O service_role legado é JWT e pode ir em Authorization. O sb_secret novo NÃO pode.
if ($SecretKey.StartsWith("eyJ")) { $Headers["Authorization"] = "Bearer $SecretKey" }

function Get-AllUsers {
  $result = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/auth/v1/admin/users?page=1&per_page=1000" -Headers $Headers
  if ($result.users) { return @($result.users) }
  return @($result)
}

$Existing = Get-AllUsers

foreach ($u in $Users) {
  $email = "$($u.username)@$Domain"
  $found = $Existing | Where-Object { $_.email -eq $email } | Select-Object -First 1

  if ($found) {
    $userId = $found.id
    Write-Host "Ja existe: $($u.username)" -ForegroundColor DarkYellow
  } else {
    $body = @{
      email = $email
      password = $u.password
      email_confirm = $true
      user_metadata = @{ name = $u.name; username = $u.username }
    } | ConvertTo-Json -Depth 5

    $created = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/admin/users" -Headers $Headers -Body $body
    $userId = $created.id
    Write-Host "Criado: $($u.username)" -ForegroundColor Green
  }

  $profile = @{ id = $userId; name = $u.name; username = $u.username; role = $u.role } | ConvertTo-Json
  $ProfileHeaders = $Headers.Clone()
  $ProfileHeaders["Prefer"] = "resolution=merge-duplicates,return=minimal"

  Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/media_profiles?on_conflict=id" -Headers $ProfileHeaders -Body $profile | Out-Null
}

$SecretKey = $null
Write-Host ""
Write-Host "Pronto. Os 4 usuarios reais foram configurados." -ForegroundColor Green
Write-Host "  lider   / midia2026"
Write-Host "  editor  / editar2026"
Write-Host "  camera1 / camera2026"
Write-Host "  camera2 / camera2026"
Write-Host ""
Write-Host "Troque as senhas depois do primeiro teste." -ForegroundColor Yellow
Read-Host "Pressione Enter para fechar"
