[CmdletBinding()]
param(
  [ValidateSet('preflight', 'verify', 'dry-run', 'apply')]
  [string]$Mode = 'preflight',

  [int]$DatabaseTunnelPort = 55432,

  [string]$EnvironmentFile = 'D:\Vimob\crm\.env.local',

  [switch]$ConfirmProductionMigration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

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

if ($Mode -eq 'apply' -and -not $ConfirmProductionMigration) {
  throw 'O modo apply exige -ConfirmProductionMigration.'
}

Import-EnvironmentFile -Path $EnvironmentFile

if (-not $env:DATABASE_URL) {
  throw 'DATABASE_URL não foi carregada.'
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort $DatabaseTunnelPort -ErrorAction SilentlyContinue)) {
  throw "O túnel do banco real não está ativo em 127.0.0.1:$DatabaseTunnelPort."
}

$databaseSource = [Uri]$env:DATABASE_URL
$databaseTunnel = [UriBuilder]$databaseSource
$databaseTunnel.Host = '127.0.0.1'
$databaseTunnel.Port = $DatabaseTunnelPort

$safeQueryParts = @(
  $databaseTunnel.Query.TrimStart('?').Split('&', [StringSplitOptions]::RemoveEmptyEntries) |
    Where-Object {
      $_ -notmatch '^(?i:default_transaction_read_only)=' -and
      $_ -notmatch '^(?i:application_name)='
    }
)
$databaseTunnel.Query = (@(
  $safeQueryParts
  'application_name=vimob_integration_migration_runner'
) -join '&')

$env:DATABASE_URL = $databaseTunnel.Uri.AbsoluteUri
if ($Mode -eq 'apply') {
  $env:VIMOB_INTEGRATION_MIGRATIONS_CONFIRM = 'APPLY'
} else {
  Remove-Item Env:VIMOB_INTEGRATION_MIGRATIONS_CONFIRM -ErrorAction SilentlyContinue
}

Push-Location $repoRoot
try {
  & go run ./scripts/local/integration-migrations-real.go --mode $Mode --repo-root $repoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "O runner de migrações encerrou com código $LASTEXITCODE."
  }
} finally {
  Pop-Location
  Remove-Item Env:VIMOB_INTEGRATION_MIGRATIONS_CONFIRM -ErrorAction SilentlyContinue
}
