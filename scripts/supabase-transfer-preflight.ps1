[CmdletBinding()]
param(
    [Parameter()]
    [ValidatePattern('^[a-z]{20}$')]
    [string]$SourceProjectRef = 'iemalzlfnbouobyjwlwi',

    [Parameter()]
    [ValidatePattern('^[a-z]{20}$')]
    [string]$TargetOrganizationId,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    throw 'Supabase CLI nao encontrado no PATH.'
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

function Invoke-InventoryCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter()]
        [switch]$Optional
    )

    $stdoutPath = Join-Path $resolvedOutput "$Name.stdout.txt"
    $stderrPath = Join-Path $resolvedOutput "$Name.stderr.txt"

    $process = Start-Process `
        -FilePath 'supabase' `
        -ArgumentList $Arguments `
        -Wait `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath

    $result = [ordered]@{
        name = $Name
        exit_code = $process.ExitCode
        optional = [bool]$Optional
        stdout = [System.IO.Path]::GetFileName($stdoutPath)
        stderr = [System.IO.Path]::GetFileName($stderrPath)
    }

    if ($process.ExitCode -ne 0 -and -not $Optional) {
        $result['status'] = 'failed'
    } elseif ($process.ExitCode -ne 0) {
        $result['status'] = 'not_configured_or_unavailable'
    } else {
        $result['status'] = 'ok'
    }

    return [pscustomobject]$result
}

$commands = @(
    @{ Name = 'cli-version'; Arguments = @('--version') },
    @{ Name = 'organizations'; Arguments = @('orgs', 'list', '--output', 'json') },
    @{ Name = 'projects'; Arguments = @('projects', 'list', '--output', 'json') },
    @{ Name = 'backups'; Arguments = @('backups', 'list', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'functions'; Arguments = @('functions', 'list', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'secret-names-and-hashes'; Arguments = @('secrets', 'list', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'ssl-enforcement'; Arguments = @('ssl-enforcement', 'get', '--experimental', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'network-restrictions'; Arguments = @('network-restrictions', 'get', '--experimental', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'postgres-config'; Arguments = @('postgres-config', 'get', '--experimental', '--project-ref', $SourceProjectRef, '--output', 'json') },
    @{ Name = 'custom-domain'; Arguments = @('domains', 'get', '--project-ref', $SourceProjectRef, '--output', 'json'); Optional = $true },
    @{ Name = 'vanity-subdomain'; Arguments = @('vanity-subdomains', 'get', '--experimental', '--project-ref', $SourceProjectRef, '--output', 'json'); Optional = $true }
)

$results = foreach ($command in $commands) {
    $isOptional = $command.ContainsKey('Optional') -and [bool]$command.Optional

    Invoke-InventoryCommand `
        -Name $command.Name `
        -Arguments $command.Arguments `
        -Optional:$isOptional
}

$sourcePresent = Select-String `
    -LiteralPath (Join-Path $resolvedOutput 'projects.stdout.txt') `
    -SimpleMatch $SourceProjectRef `
    -Quiet

if (-not $sourcePresent) {
    throw "O projeto $SourceProjectRef nao apareceu na lista acessivel ao CLI."
}

if ($TargetOrganizationId) {
    $targetPresent = Select-String `
        -LiteralPath (Join-Path $resolvedOutput 'organizations.stdout.txt') `
        -SimpleMatch $TargetOrganizationId `
        -Quiet

    if (-not $targetPresent) {
        throw "A organizacao destino $TargetOrganizationId nao esta acessivel a esta conta."
    }
}

$manifest = [ordered]@{
    generated_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
    source_project_ref = $SourceProjectRef
    target_organization_id = $TargetOrganizationId
    mutates_remote_state = $false
    intentionally_omitted = @(
        'API key values',
        'JWT secrets and private signing keys',
        'database passwords and connection strings',
        'Edge secret values',
        'Vault decrypted secret values',
        'Auth provider client secrets',
        'Log Drain credentials'
    )
    commands = $results
}

$manifest | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath (Join-Path $resolvedOutput 'manifest.json') -Encoding utf8

$failedRequired = @($results | Where-Object {
    $_.status -eq 'failed' -and -not $_.optional
})

Write-Host "Preflight somente leitura salvo em: $resolvedOutput"
Write-Host 'API keys e valores de secrets nao foram coletados.'

if ($failedRequired.Count -gt 0) {
    $failedNames = ($failedRequired.name -join ', ')
    throw "Comandos obrigatorios falharam: $failedNames"
}
