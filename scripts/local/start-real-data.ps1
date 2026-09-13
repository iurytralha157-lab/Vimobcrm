[CmdletBinding()]
param(
  [int]$FrontendPort = 3000,
  [int]$ApiPort = 8081,
  [int]$DatabaseTunnelPort = 55432,
  [string]$EnvironmentFile = 'D:\Vimob\crm\.env.local',
  [string]$ApiExecutableOverride = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $env:TEMP 'vimob-api-real-runtime'

function Import-EnvironmentFile {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Arquivo de ambiente não encontrado: $Path"
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      continue
    }

    $separator = $line.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }

    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      throw "Nome de variável inválido em $Path."
    }

    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Stop-WorkspaceListener {
  param(
    [Parameter(Mandatory)]
    [int]$Port
  )

  $connections = @(
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  )

  foreach ($processId in @($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if (-not $process) {
      continue
    }

    $commandLine = [string]$process.CommandLine
    $executablePath = [string]$process.ExecutablePath
    $belongsToWorkspace =
      $commandLine.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $executablePath.IndexOf($runtimeRoot, [StringComparison]::OrdinalIgnoreCase) -eq 0

    if (-not $belongsToWorkspace) {
      throw "A porta $Port pertence a um processo fora deste workspace (PID $processId)."
    }

    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.ParentProcessId)"
    Stop-Process -Id $processId -Force
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
}

function Wait-LocalHttp {
  param(
    [Parameter(Mandatory)]
    [string]$Url,

    [Parameter(Mandatory)]
    [string]$ServiceName,

    [int]$TimeoutSeconds = 90
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

Import-EnvironmentFile -Path $EnvironmentFile

if (-not $env:DATABASE_URL) {
  throw 'DATABASE_URL não foi carregada.'
}

$databaseSource = [Uri]$env:DATABASE_URL
$databaseTunnel = [UriBuilder]$databaseSource
$databaseTunnel.Host = '127.0.0.1'
$databaseTunnel.Port = $DatabaseTunnelPort

# Este runner aponta para dados reais apenas para inspeção. A proteção no
# próprio PostgreSQL impede que uma navegação local, um endpoint GET com efeito
# colateral ou um clique acidental altere a base remota.
$existingDatabaseQuery = $databaseTunnel.Query.TrimStart('?')
$readOnlyDatabaseQuery = @(
  'default_transaction_read_only=on'
  'application_name=vimob_local_readonly'
) -join '&'
$databaseTunnel.Query = if ($existingDatabaseQuery) {
  "$existingDatabaseQuery&$readOnlyDatabaseQuery"
} else {
  $readOnlyDatabaseQuery
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort $DatabaseTunnelPort -ErrorAction SilentlyContinue)) {
  throw "O túnel do banco real não está ativo em 127.0.0.1:$DatabaseTunnelPort."
}

Stop-WorkspaceListener -Port $ApiPort
Stop-WorkspaceListener -Port $FrontendPort

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$apiExecutable = Join-Path $runtimeRoot 'vimob-api-real.exe'
$apiStdout = Join-Path $runtimeRoot 'api.stdout.log'
$apiStderr = Join-Path $runtimeRoot 'api.stderr.log'
$frontendStdout = Join-Path $runtimeRoot 'frontend.stdout.log'
$frontendStderr = Join-Path $runtimeRoot 'frontend.stderr.log'

if ($ApiExecutableOverride) {
  $resolvedApiExecutable = (Resolve-Path -LiteralPath $ApiExecutableOverride).Path
  Copy-Item -LiteralPath $resolvedApiExecutable -Destination $apiExecutable -Force
} else {
  Push-Location $repoRoot
  try {
    & go build -o $apiExecutable ./apps/api/cmd/api
    if ($LASTEXITCODE -ne 0) {
      throw 'O build da API Go falhou.'
    }
  } finally {
    Pop-Location
  }
}

$frontendOrigin = "http://127.0.0.1:$FrontendPort"
$apiPublicUrl = "http://127.0.0.1:$ApiPort"

$env:DATABASE_URL = $databaseTunnel.Uri.AbsoluteUri
# Reuse one read-only connection locally instead of competing with production's
# session-pool quota during parallel page loads.
$env:DATABASE_MAX_CONNS = '1'
$env:DATABASE_MIN_CONNS = '0'
$env:DATABASE_FORCE_READ_ONLY = 'true'
$env:API_ENV = 'development'
$env:API_HOST = '127.0.0.1'
$env:API_PORT = [string]$ApiPort
$env:API_CORS_ALLOWED_ORIGINS = "http://localhost:$FrontendPort,$frontendOrigin"
$env:APP_PUBLIC_URL = $frontendOrigin
$env:NEXT_PUBLIC_SITE_URL = $frontendOrigin
$env:NEXT_PUBLIC_VIMOB_API_URL = $apiPublicUrl
$env:VIMOB_API_URL = $apiPublicUrl
$env:NEXT_PUBLIC_BILLING_ACCESS_BYPASS = 'true'
$env:NEXT_PUBLIC_DISABLE_ERROR_TELEMETRY = 'true'
$env:NEXT_PUBLIC_LOCAL_READ_ONLY = 'true'
$env:NEXT_DIST_DIR = '.next'

# A leitura usa dados reais, mas nenhum worker local pode processar filas de produção.
$env:API_BACKGROUND_WORKERS_ENABLED = 'false'
$env:AUTOMATION_RUNTIME_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED = 'false'
$env:WHATSAPP_OUTBOX_WORKER_ENABLED = 'false'
$env:WHATSAPP_WEBHOOK_WORKER_ENABLED = 'false'
$env:WHATSAPP_SESSION_SUPERVISOR_ENABLED = 'false'
$env:ASAAS_RECONCILIATION_ENABLED = 'false'

Push-Location $repoRoot
try {
  & go run ./scripts/local/verify-real-data-readonly.go
  if ($LASTEXITCODE -ne 0) {
    throw 'A verificação de segurança do banco real falhou.'
  }
} finally {
  Pop-Location
}

$apiProcess = Start-Process `
  -FilePath $apiExecutable `
  -WorkingDirectory $runtimeRoot `
  -RedirectStandardOutput $apiStdout `
  -RedirectStandardError $apiStderr `
  -WindowStyle Hidden `
  -PassThru

Wait-LocalHttp `
  -Url "$apiPublicUrl/readyz" `
  -ServiceName 'API local com banco real'

$frontendProcess = Start-Process `
  -FilePath 'npm.cmd' `
  -ArgumentList @(
    'run',
    'dev',
    '--',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    [string]$FrontendPort
  ) `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $frontendStdout `
  -RedirectStandardError $frontendStderr `
  -WindowStyle Hidden `
  -PassThru

Wait-LocalHttp `
  -Url "$frontendOrigin/login" `
  -ServiceName 'Frontend local' `
  -TimeoutSeconds 120

Write-Host ''
Write-Host 'Vimob local iniciado com a base real por túnel.'
Write-Host "Frontend: $frontendOrigin (PID $($frontendProcess.Id))"
Write-Host "API:      $apiPublicUrl (PID $($apiProcess.Id))"
Write-Host "Banco:    127.0.0.1:$DatabaseTunnelPort (credenciais omitidas)"
Write-Host "Logs:     $runtimeRoot"
