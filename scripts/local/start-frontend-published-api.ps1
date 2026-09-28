[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$environmentFile = Join-Path $repoRoot '.env.realdb.local'
$nextExecutable = Join-Path $repoRoot 'node_modules\next\dist\bin\next'

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
  throw 'Arquivo de ambiente local ausente.'
}
if (-not (Test-Path -LiteralPath $nextExecutable -PathType Leaf)) {
  throw 'Next.js não está instalado neste checkout.'
}

# Next carrega estes arquivos automaticamente. Recuse iniciar se algum puder
# adicionar credenciais de backend ao processo criado abaixo.
foreach ($name in @('.env', '.env.local', '.env.development', '.env.development.local')) {
  if (Test-Path -LiteralPath (Join-Path $repoRoot $name) -PathType Leaf) {
    throw "Arquivo $name presente. Início recusado para não carregar variáveis privadas."
  }
}

if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
  throw 'A porta 3000 já está em uso. Nenhum processo foi encerrado.'
}

$publicSettings = @{}
foreach ($line in [System.IO.File]::ReadLines($environmentFile)) {
  if ($line -notmatch '^\s*(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*)$') {
    continue
  }

  $name = $Matches[1]
  if ($publicSettings.ContainsKey($name)) {
    throw "Chave pública $name duplicada no arquivo de ambiente."
  }

  $value = $Matches[2].Trim()
  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Chave pública $name vazia no arquivo de ambiente."
  }
  $publicSettings[$name] = $value
}

foreach ($name in @('SUPABASE_URL', 'SUPABASE_ANON_KEY')) {
  if (-not $publicSettings.ContainsKey($name)) {
    throw "Chave pública $name ausente no arquivo de ambiente."
  }
}

$supabaseUri = $null
if (
  -not [System.Uri]::TryCreate(
    $publicSettings['SUPABASE_URL'],
    [System.UriKind]::Absolute,
    [ref]$supabaseUri
  ) -or
  $supabaseUri.Scheme -ne 'https' -or
  $supabaseUri.UserInfo -or
  $supabaseUri.Query -or
  $supabaseUri.Fragment
) {
  throw 'A URL pública do Supabase deve ser HTTPS e não conter credenciais ou parâmetros.'
}

$nodeExecutable = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $nodeExecutable
$start.WorkingDirectory = $repoRoot
$start.UseShellExecute = $false
$start.Environment.Clear()

# Permita apenas as variáveis básicas do Windows necessárias para executar Node.
foreach ($name in @(
    'PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'HOMEDRIVE', 'HOMEPATH', 'COMSPEC', 'PATHEXT', 'OS', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE'
  )) {
  $value = [System.Environment]::GetEnvironmentVariable($name, 'Process')
  if ($value) {
    $start.Environment[$name] = $value
  }
}

$start.Environment['NEXT_PUBLIC_SUPABASE_URL'] = $publicSettings['SUPABASE_URL']
$start.Environment['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = $publicSettings['SUPABASE_ANON_KEY']
$start.Environment['NEXT_PUBLIC_VIMOB_API_URL'] = 'https://api.vimobcrm.com.br'
$start.Environment['VIMOB_API_URL'] = 'https://api.vimobcrm.com.br'
$start.Environment['NEXT_PUBLIC_SITE_URL'] = 'http://127.0.0.1:3000'
$start.Environment['APP_PUBLIC_URL'] = 'http://127.0.0.1:3000'
$start.Environment['NEXT_TELEMETRY_DISABLED'] = '1'

$start.Arguments = ('"{0}" dev --webpack --hostname 127.0.0.1 --port 3000' -f $nextExecutable)

$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $start
$exitCode = 1
$started = $false
try {
  if (-not $process.Start()) {
    throw 'Não foi possível iniciar o frontend.'
  }
  $started = $true
  Write-Host 'Frontend local em http://127.0.0.1:3000. Pressione Ctrl+C para encerrar.'
  $process.WaitForExit()
  $exitCode = $process.ExitCode
} finally {
  if ($started -and -not $process.HasExited) {
    $process.Kill($true)
  }
  $process.Dispose()
}

exit $exitCode
