[CmdletBinding()]
param(
  [int]$FrontendPort = 3000,
  [int]$ApiPort = 8081
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $env:TEMP 'vimob-api-realdb-runtime'
$envFile = Join-Path $repoRoot '.env.realdb.local'

Write-Host ''
Write-Host '=====================================================================' -ForegroundColor Red
Write-Host '  ATENCAO: este script conecta o ambiente local ao BANCO DE PRODUCAO.' -ForegroundColor Red
Write-Host '  Qualquer alteracao feita no app local vai mexer em dados reais.'    -ForegroundColor Red
Write-Host '  Workers de automacao (WhatsApp, cobranca Asaas) ficam desligados,'  -ForegroundColor Red
Write-Host '  mas leads, imoveis e clientes reais PODEM ser criados/editados.'    -ForegroundColor Red
Write-Host '=====================================================================' -ForegroundColor Red
Write-Host ''
$confirmation = Read-Host 'Digite CONFIRMO para continuar'
if ($confirmation -ne 'CONFIRMO') {
  throw 'Cancelado pelo usuario.'
}

if (-not (Test-Path $envFile)) {
  throw "Arquivo nao encontrado: $envFile. Preencha .env.realdb.local com as credenciais do Supabase de producao antes de rodar este script."
}

function Get-EnvFileValues {
  param([Parameter(Mandatory)][string]$Path)

  $values = @{}
  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
    $eqIndex = $trimmed.IndexOf('=')
    if ($eqIndex -lt 0) { continue }
    $key = $trimmed.Substring(0, $eqIndex).Trim()
    $value = $trimmed.Substring($eqIndex + 1).Trim()
    $values[$key] = $value
  }
  return $values
}

$realdb = Get-EnvFileValues -Path $envFile
foreach ($requiredKey in @('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL')) {
  if (-not $realdb.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($realdb[$requiredKey])) {
    throw "Faltando '$requiredKey' em .env.realdb.local. Preencha esse valor e rode de novo."
  }
}

$supabaseUrl = $realdb['SUPABASE_URL'].TrimEnd('/')
$frontendOrigin = "http://127.0.0.1:$FrontendPort"
$apiPublicUrl = "http://127.0.0.1:$ApiPort"

function Stop-LocalWorkspaceListener {
  param([Parameter(Mandatory)][int]$Port)

  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($listenerProcessId in $processIds) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId"
    if (-not $process) { continue }

    $commandLine = [string]$process.CommandLine
    $executablePath = [string]$process.ExecutablePath
    $belongsToWorkspace =
      $commandLine.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $executablePath.IndexOf($runtimeRoot, [StringComparison]::OrdinalIgnoreCase) -eq 0

    if (-not $belongsToWorkspace) {
      throw "A porta $Port pertence a um processo fora do Vimob (PID $listenerProcessId). Encerramento recusado."
    }

    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
    Stop-Process -Id $listenerProcessId -Force

    if ($parent -and ([string]$parent.CommandLine).IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ((Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "A porta $Port nao foi liberada."
  }
}

function Wait-LocalHttp {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$ServiceName,
    [int]$TimeoutSeconds = 60,
    [hashtable]$Headers = @{}
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -Headers $Headers
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "$ServiceName nao respondeu em $Url dentro de $TimeoutSeconds segundos."
}

Write-Host "Verificando conectividade com $supabaseUrl ..."
$healthHeaders = @{ apikey = $realdb['SUPABASE_ANON_KEY']; Authorization = "Bearer $($realdb['SUPABASE_ANON_KEY'])" }
Wait-LocalHttp -Url "$supabaseUrl/auth/v1/health" -ServiceName 'Supabase Auth (producao)' -TimeoutSeconds 30 -Headers $healthHeaders

Stop-LocalWorkspaceListener -Port $ApiPort
Stop-LocalWorkspaceListener -Port $FrontendPort

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$apiExecutable = Join-Path $runtimeRoot 'vimob-api-local.exe'
$apiStdout = Join-Path $runtimeRoot 'api.stdout.log'
$apiStderr = Join-Path $runtimeRoot 'api.stderr.log'
$frontendStdout = Join-Path $runtimeRoot 'frontend.stdout.log'
$frontendStderr = Join-Path $runtimeRoot 'frontend.stderr.log'

Push-Location $repoRoot
try {
  & go build -o $apiExecutable ./apps/api/cmd/api
  if ($LASTEXITCODE -ne 0) { throw 'O build da API Go falhou.' }
} finally {
  Pop-Location
}

# --- Credenciais do banco REAL ---
$env:SUPABASE_PROJECT_URL = $supabaseUrl
$env:SUPABASE_URL = $supabaseUrl
$env:SUPABASE_SERVICE_ROLE_KEY = $realdb['SUPABASE_SERVICE_ROLE_KEY']
$env:SUPABASE_SECRET_KEY = $realdb['SUPABASE_SERVICE_ROLE_KEY']
$env:SUPABASE_JWKS_URL = "$supabaseUrl/auth/v1/.well-known/jwks.json"
$env:SUPABASE_JWT_ISSUER = "$supabaseUrl/auth/v1"
$env:SUPABASE_JWT_AUDIENCE = 'authenticated'
$env:DATABASE_URL = $realdb['DATABASE_URL']
$env:APP_PUBLIC_URL = $frontendOrigin
$env:NEXT_PUBLIC_SITE_URL = $frontendOrigin

$env:API_ENV = 'development'
$env:API_HOST = '127.0.0.1'
$env:API_PORT = [string]$ApiPort
$env:DATABASE_FORCE_READ_ONLY = 'false'
$apiCorsOrigins = @("http://localhost:$FrontendPort", "http://127.0.0.1:$FrontendPort", $frontendOrigin) | Select-Object -Unique
$env:API_CORS_ALLOWED_ORIGINS = $apiCorsOrigins -join ','

# Workers de automacao ficam SEMPRE desligados aqui, mesmo com banco real,
# para nao mandar WhatsApp/cobranca de verdade a partir do ambiente local.
$env:API_BACKGROUND_WORKERS_ENABLED = 'false'
$env:AUTOMATION_RUNTIME_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED = 'false'
$env:WHATSAPP_OUTBOX_WORKER_ENABLED = 'false'
$env:WHATSAPP_WEBHOOK_WORKER_ENABLED = 'false'
$env:WHATSAPP_SESSION_SUPERVISOR_ENABLED = 'false'
$env:ASAAS_RECONCILIATION_ENABLED = 'false'
$env:ASAAS_ALLOW_PRODUCTION_CHARGES = 'false'

[Environment]::SetEnvironmentVariable('SUPABASE_JWT_SECRET', $null, 'Process')
foreach ($externalKey in @(
  'RESEND_API_KEY', 'OPENAI_API_KEY', 'AI_AUTOREPLY_TOKEN', 'INTERNAL_WEBHOOK_TOKEN',
  'EVOLUTION_GO_API_URL', 'EVOLUTION_GO_API_KEY', 'EVOLUTION_GO_WEBHOOK_URL',
  'EVOLUTION_GO_BACKEND_WEBHOOK_URL', 'WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS',
  'ASAAS_API_KEY', 'META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID',
  'META_OAUTH_CALLBACK_URL', 'META_OAUTH_ALLOWED_ORIGINS', 'META_WEBHOOK_VERIFY_TOKEN',
  'WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'FCM_SERVER_KEY',
  'FIREBASE_SERVER_KEY', 'FCM_PROJECT_ID', 'FIREBASE_PROJECT_ID',
  'FCM_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS'
)) {
  [Environment]::SetEnvironmentVariable($externalKey, $null, 'Process')
}

$apiProcess = Start-Process `
  -FilePath $apiExecutable `
  -WorkingDirectory $runtimeRoot `
  -RedirectStandardOutput $apiStdout `
  -RedirectStandardError $apiStderr `
  -WindowStyle Hidden `
  -PassThru

Wait-LocalHttp -Url "http://127.0.0.1:$ApiPort/readyz" -ServiceName 'API local'

$env:NEXT_PUBLIC_SUPABASE_URL = $supabaseUrl
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $realdb['SUPABASE_ANON_KEY']
$env:NEXT_PUBLIC_VIMOB_API_URL = $apiPublicUrl
$env:VIMOB_API_URL = "http://127.0.0.1:$ApiPort"
$env:NEXT_PUBLIC_BILLING_ACCESS_BYPASS = 'true'
$env:NEXT_PUBLIC_LOCAL_READ_ONLY = 'false'

foreach ($nextExternalKey in @(
  'RESEND_API_KEY', 'ASAAS_API_KEY', 'OPENAI_API_KEY', 'EVOLUTION_GO_API_KEY',
  'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'SUPABASE_JWT_SECRET'
)) {
  [Environment]::SetEnvironmentVariable($nextExternalKey, ' ', 'Process')
}

$frontendProcess = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @('run', 'dev', '--', '--hostname', '127.0.0.1', '--port', [string]$FrontendPort) `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $frontendStdout `
  -RedirectStandardError $frontendStderr `
  -WindowStyle Hidden `
  -PassThru

Wait-LocalHttp -Url "http://127.0.0.1:$FrontendPort/login" -ServiceName 'Frontend local' -TimeoutSeconds 300

Write-Host ''
Write-Host 'Vimob local (BANCO REAL) iniciado com sucesso.' -ForegroundColor Yellow
Write-Host "Frontend: $frontendOrigin (PID $($frontendProcess.Id))"
Write-Host "API:      $apiPublicUrl (PID $($apiProcess.Id))"
Write-Host "Supabase: $supabaseUrl (PRODUCAO)"
Write-Host "Logs:     $runtimeRoot"
