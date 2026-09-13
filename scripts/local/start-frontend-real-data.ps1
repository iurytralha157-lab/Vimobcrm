[CmdletBinding()]
param(
  [int]$FrontendPort = 3000,
  [int]$ApiPort = 8081,
  [int]$DatabaseTunnelPort = 55432,
  [string]$EnvironmentFile = 'D:\Vimob\crm\.env.local'
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
    throw "Arquivo de ambiente nao encontrado: $Path"
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
      throw "Nome de variavel invalido em $Path."
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

function Wait-LocalHttp {
  param(
    [Parameter(Mandatory)]
    [string]$Url,

    [Parameter(Mandatory)]
    [string]$ServiceName,

    [int]$TimeoutSeconds = 120
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

  throw "$ServiceName nao respondeu em $Url dentro de $TimeoutSeconds segundos."
}

if (Get-NetTCPConnection -State Listen -LocalPort $FrontendPort -ErrorAction SilentlyContinue) {
  throw "A porta $FrontendPort ja esta em uso."
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort $DatabaseTunnelPort -ErrorAction SilentlyContinue)) {
  throw "O tunel do banco real nao esta ativo em 127.0.0.1:$DatabaseTunnelPort."
}

$apiPublicUrl = "http://127.0.0.1:$ApiPort"
Wait-LocalHttp -Url "$apiPublicUrl/readyz" -ServiceName 'API local com banco real' -TimeoutSeconds 10

Import-EnvironmentFile -Path $EnvironmentFile

if (-not $env:DATABASE_URL) {
  throw 'DATABASE_URL nao foi carregada.'
}

$databaseSource = [Uri]$env:DATABASE_URL
$databaseTunnel = [UriBuilder]$databaseSource
$databaseTunnel.Host = '127.0.0.1'
$databaseTunnel.Port = $DatabaseTunnelPort
$existingDatabaseQuery = $databaseTunnel.Query.TrimStart('?')
$readOnlyDatabaseQuery = @(
  'default_transaction_read_only=on'
  'application_name=vimob_local_frontend_readonly'
) -join '&'
$databaseTunnel.Query = if ($existingDatabaseQuery) {
  "$existingDatabaseQuery&$readOnlyDatabaseQuery"
} else {
  $readOnlyDatabaseQuery
}

$frontendOrigin = "http://127.0.0.1:$FrontendPort"
$env:DATABASE_URL = $databaseTunnel.Uri.AbsoluteUri
$env:APP_PUBLIC_URL = $frontendOrigin
$env:NEXT_PUBLIC_SITE_URL = $frontendOrigin
$env:NEXT_PUBLIC_VIMOB_API_URL = $apiPublicUrl
$env:VIMOB_API_URL = $apiPublicUrl
$env:NEXT_PUBLIC_BILLING_ACCESS_BYPASS = 'true'
$env:NEXT_PUBLIC_DISABLE_ERROR_TELEMETRY = 'true'
$env:NEXT_PUBLIC_LOCAL_READ_ONLY = 'true'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NEXT_DIST_DIR = '.next'
$env:API_BACKGROUND_WORKERS_ENABLED = 'false'
$env:AUTOMATION_RUNTIME_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_WORKER_ENABLED = 'false'
$env:WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED = 'false'
$env:WHATSAPP_OUTBOX_WORKER_ENABLED = 'false'
$env:WHATSAPP_WEBHOOK_WORKER_ENABLED = 'false'
$env:WHATSAPP_SESSION_SUPERVISOR_ENABLED = 'false'
$env:ASAAS_RECONCILIATION_ENABLED = 'false'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$frontendStdout = Join-Path $runtimeRoot 'frontend-restart.stdout.log'
$frontendStderr = Join-Path $runtimeRoot 'frontend-restart.stderr.log'

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

Write-Host "Frontend: $frontendOrigin (PID $($frontendProcess.Id))"
Write-Host "API:      $apiPublicUrl"
Write-Host "Banco:    127.0.0.1:$DatabaseTunnelPort (somente leitura; credenciais omitidas)"
Write-Host "Logs:     $runtimeRoot"
