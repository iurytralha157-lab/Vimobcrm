[CmdletBinding()]
param(
  [switch]$Executar,
  [switch]$BackupConfirmado,
  [string]$ConfirmarProjeto
)

$ErrorActionPreference = 'Stop'

$projectRef = 'iemalzlfnbouobyjwlwi'
$cliVersion = '2.109.1'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repositoryRoot 'supabase\reconciliation\ledger-remoto-2026-07-22.json'
$projectRefPath = Join-Path $repositoryRoot 'supabase\.temp\project-ref'
$baselineVersions = @(
  '20260721000000',
  '20260722000000',
  '20260722000001',
  '20260722000002'
)

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$legacyVersions = @($manifest.migrations | ForEach-Object { $_.versao })

if ($manifest.projeto_ref -ne $projectRef -or $legacyVersions.Count -ne 444) {
  throw 'O manifesto remoto não corresponde ao snapshot esperado de 444 migrations.'
}

Write-Host 'Plano de reparo do ledger do Supabase'
Write-Host "Projeto: $projectRef"
Write-Host "Versões antigas a marcar como revertidas: $($legacyVersions.Count)"
Write-Host "Versões da baseline a marcar como aplicadas: $($baselineVersions.Count)"
Write-Host 'Etapa final automática: db push --dry-run'
Write-Host 'As migrations pendentes NÃO serão aplicadas por este roteiro.'

if (-not $Executar) {
  Write-Host ''
  Write-Host 'Modo de visualização. Nenhuma alteração remota foi executada.'
  exit 0
}

if (-not $BackupConfirmado) {
  throw 'Use -BackupConfirmado somente depois de criar e verificar um backup novo.'
}

if ($ConfirmarProjeto -ne $projectRef) {
  throw "Confirme explicitamente o projeto com -ConfirmarProjeto $projectRef."
}

if (-not (Test-Path -LiteralPath $projectRefPath)) {
  throw 'O projeto local não está vinculado ao Supabase.'
}

$linkedProjectRef = (Get-Content -LiteralPath $projectRefPath -Raw).Trim()
if ($linkedProjectRef -ne $projectRef) {
  throw "Projeto vinculado inesperado: $linkedProjectRef."
}

$dirtyFiles = @(git -C $repositoryRoot status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw 'Não foi possível validar o estado do Git.'
}
if ($dirtyFiles.Count -gt 0) {
  throw 'O worktree precisa estar limpo antes do reparo do ledger.'
}

$revertArguments = @(
  '--yes', "supabase@$cliVersion", 'migration', 'repair',
  '--linked', '--status', 'reverted', '--workdir', $repositoryRoot,
  '--agent', 'no'
) + $legacyVersions

& npx @revertArguments
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao marcar o ledger antigo como revertido. Use o manifesto para recuperação.'
}

$applyArguments = @(
  '--yes', "supabase@$cliVersion", 'migration', 'repair',
  '--linked', '--status', 'applied', '--workdir', $repositoryRoot,
  '--agent', 'no'
) + $baselineVersions

& npx @applyArguments
if ($LASTEXITCODE -ne 0) {
  throw 'Falha ao registrar a baseline como aplicada.'
}

& npx --yes "supabase@$cliVersion" db push --linked --dry-run --workdir $repositoryRoot --agent no
if ($LASTEXITCODE -ne 0) {
  throw 'O dry-run após o reparo falhou. Não aplique migrations até investigar.'
}

Write-Host ''
Write-Host 'Ledger reconciliado. Revise o dry-run antes de aplicar as duas migrations pendentes.'
