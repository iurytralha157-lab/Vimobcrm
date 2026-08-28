[CmdletBinding()]
param(
  [int]$FrontendPort = 3000,
  [int]$ApiPort = 8081,
  [switch]$ExposeLan,
  [string]$LanAddress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $env:TEMP 'vimob-api-local-runtime'
$expectedSupabaseUrl = 'http://127.0.0.1:55321'
$expectedDatabasePort = 55322

function Test-PrivateIPv4 {
  param(
    [Parameter(Mandatory)]
    [string]$Address
  )

  $parsedAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress)) {
    return $false
  }

  $bytes = $parsedAddress.GetAddressBytes()
  return (
    $bytes.Length -eq 4 -and (
      $bytes[0] -eq 10 -or
      ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
      ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
    )
  )
}

function Resolve-LanAddress {
  if ($LanAddress) {
    if (-not (Test-PrivateIPv4 -Address $LanAddress)) {
      throw "Endereço LAN recusado: $LanAddress. Use um IPv4 privado da rede local."
    }

    return $LanAddress
  }

  $candidate = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -ne $null } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { Test-PrivateIPv4 -Address $_ } |
    Select-Object -First 1

  if (-not $candidate) {
    throw 'Não foi possível detectar um IPv4 privado para acesso pelo celular.'
  }

  return [string]$candidate
}

$publicHost = if ($ExposeLan) { Resolve-LanAddress } else { '127.0.0.1' }
$listenHost = if ($ExposeLan) { '0.0.0.0' } else { '127.0.0.1' }
$frontendOrigin = "http://${publicHost}:$FrontendPort"
$apiPublicUrl = "http://${publicHost}:$ApiPort"
$supabasePublicUrl = "http://${publicHost}:55321"

function Get-LocalSupabaseStatus {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $statusJson = & npx.cmd --yes supabase@2.110.0 status -o json 2>$null
    $statusExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($statusExitCode -ne 0) {
    Write-Host 'Supabase local não está ativo. Iniciando containers locais...'
    $ErrorActionPreference = 'Continue'
    try {
      & npx.cmd --yes supabase@2.110.0 start
      $startExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($startExitCode -ne 0) {
      throw 'Não foi possível iniciar o Supabase local.'
    }

    $ErrorActionPreference = 'Continue'
    try {
      $statusJson = & npx.cmd --yes supabase@2.110.0 status -o json 2>$null
      $statusExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
  }

  if ($statusExitCode -ne 0) {
    throw 'Não foi possível ler o status do Supabase local.'
  }

  $status = $statusJson | ConvertFrom-Json
  if ([string]$status.API_URL -ne $expectedSupabaseUrl) {
    throw "Alvo Supabase recusado: $($status.API_URL). Este script aceita somente $expectedSupabaseUrl."
  }

  $databaseUri = [Uri]([string]$status.DB_URL)
  if ($databaseUri.Host -ne '127.0.0.1' -or $databaseUri.Port -ne $expectedDatabasePort) {
    throw "Banco recusado: $($status.DB_URL). Este script aceita somente 127.0.0.1:$expectedDatabasePort."
  }

  return $status
}

function Stop-LocalWorkspaceListener {
  param(
    [Parameter(Mandatory)]
    [int]$Port
  )

  $connections = @(
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  )
  $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($listenerProcessId in $processIds) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId"
    if (-not $process) {
      continue
    }

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

    if (
      $parent -and
      ([string]$parent.CommandLine).IndexOf(
        $repoRoot,
        [StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    ) {
      Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (
    (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) -and
    [DateTime]::UtcNow -lt $deadline
  ) {
    Start-Sleep -Milliseconds 250
  }

  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "A porta $Port não foi liberada."
  }
}

function Set-CommonLocalEnvironment {
  param(
    [Parameter(Mandatory)]
    [object]$SupabaseStatus
  )

  $env:SUPABASE_PROJECT_URL = [string]$SupabaseStatus.API_URL
  $env:SUPABASE_URL = [string]$SupabaseStatus.API_URL
  $env:SUPABASE_SERVICE_ROLE_KEY = [string]$SupabaseStatus.SERVICE_ROLE_KEY
  $env:SUPABASE_SECRET_KEY = [string]$SupabaseStatus.SERVICE_ROLE_KEY
  $env:SUPABASE_JWKS_URL =
    ([string]$SupabaseStatus.API_URL).TrimEnd('/') + '/auth/v1/.well-known/jwks.json'
  $env:SUPABASE_JWT_ISSUER =
    ([string]$SupabaseStatus.API_URL).TrimEnd('/') + '/auth/v1'
  $env:SUPABASE_JWT_AUDIENCE = 'authenticated'
  $env:DATABASE_URL = [string]$SupabaseStatus.DB_URL
  $env:APP_PUBLIC_URL = $frontendOrigin
  $env:NEXT_PUBLIC_SITE_URL = $frontendOrigin
}

function Wait-LocalHttp {
  param(
    [Parameter(Mandatory)]
    [string]$Url,

    [Parameter(Mandatory)]
    [string]$ServiceName,

    [int]$TimeoutSeconds = 60
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "$ServiceName não respondeu em $Url dentro de $TimeoutSeconds segundos."
}

$supabaseStatus = Get-LocalSupabaseStatus
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
  if ($LASTEXITCODE -ne 0) {
    throw 'O build da API Go falhou.'
  }
} finally {
  Pop-Location
}

Set-CommonLocalEnvironment -SupabaseStatus $supabaseStatus
$env:API_ENV = 'development'
$env:API_HOST = $listenHost
$env:API_PORT = [string]$ApiPort
$apiCorsOrigins = @(
  "http://localhost:$FrontendPort",
  "http://127.0.0.1:$FrontendPort",
  $frontendOrigin
) | Select-Object -Unique
$env:API_CORS_ALLOWED_ORIGINS = $apiCorsOrigins -join ','
$env:AUTOMATION_RUNTIME_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED = 'false'
$env:WHATSAPP_OUTBOX_WORKER_ENABLED = 'false'
$env:WHATSAPP_WEBHOOK_WORKER_ENABLED = 'false'
$env:WHATSAPP_SESSION_SUPERVISOR_ENABLED = 'false'
$env:ASAAS_RECONCILIATION_ENABLED = 'false'

[Environment]::SetEnvironmentVariable('SUPABASE_JWT_SECRET', $null, 'Process')
foreach ($externalKey in @(
  'RESEND_API_KEY',
  'OPENAI_API_KEY',
  'AI_AUTOREPLY_TOKEN',
  'INTERNAL_WEBHOOK_TOKEN',
  'EVOLUTION_GO_API_URL',
  'EVOLUTION_GO_API_KEY',
  'EVOLUTION_GO_WEBHOOK_URL',
  'EVOLUTION_GO_BACKEND_WEBHOOK_URL',
  'WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS',
  'ASAAS_API_KEY',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'FCM_SERVER_KEY',
  'FIREBASE_SERVER_KEY',
  'FCM_PROJECT_ID',
  'FIREBASE_PROJECT_ID',
  'FCM_SERVICE_ACCOUNT_JSON',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FCM_SERVICE_ACCOUNT_FILE',
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

Wait-LocalHttp `
  -Url "http://127.0.0.1:$ApiPort/readyz" `
  -ServiceName 'API local'

$env:NEXT_PUBLIC_SUPABASE_URL =
  if ($ExposeLan) { $supabasePublicUrl } else { [string]$supabaseStatus.API_URL }
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = [string]$supabaseStatus.ANON_KEY
$env:NEXT_PUBLIC_VIMOB_API_URL = $apiPublicUrl
$env:VIMOB_API_URL = "http://127.0.0.1:$ApiPort"
$env:NEXT_PUBLIC_BILLING_ACCESS_BYPASS = 'true'

foreach ($nextExternalKey in @(
  'RESEND_API_KEY',
  'ASAAS_API_KEY',
  'OPENAI_API_KEY',
  'EVOLUTION_GO_API_KEY',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'SUPABASE_JWT_SECRET'
)) {
  [Environment]::SetEnvironmentVariable($nextExternalKey, ' ', 'Process')
}

$frontendProcess = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @(
    'run',
    'dev',
    '--',
    '--hostname',
    $listenHost,
    '--port',
    [string]$FrontendPort
  ) `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $frontendStdout `
  -RedirectStandardError $frontendStderr `
  -WindowStyle Hidden `
  -PassThru

Wait-LocalHttp `
  -Url "http://127.0.0.1:$FrontendPort/login" `
  -ServiceName 'Frontend local' `
  -TimeoutSeconds 90

Write-Host ''
Write-Host 'Vimob local iniciado com sucesso.'
Write-Host "Frontend: $frontendOrigin (PID $($frontendProcess.Id))"
Write-Host "API:      $apiPublicUrl (PID $($apiProcess.Id))"
Write-Host "Supabase: $($supabaseStatus.API_URL)"
Write-Host "Logs:     $runtimeRoot"

if ($ExposeLan) {
  Write-Host ''
  Write-Host "Celular:  $frontendOrigin"
  Write-Host 'Acesso restrito à rede local; nenhuma URL pública foi criada.'
}
