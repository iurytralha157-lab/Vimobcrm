[CmdletBinding()]
param(
  [ValidateSet('smoke', 'ramp', 'full')]
  [string]$Profile = 'smoke',

  [string]$Confirm,

  [string]$CleanupRun
)

$ErrorActionPreference = 'Stop'
$requiredConfirmation = 'LOCAL_WRITE_TEST'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
$runtimeDirectory = Join-Path $repositoryRoot '.tmp\vimob-load'
$apiProcess = $null
$functionProcess = $null
$harnessExitCode = 1
$edgeRuntimeLaunchAttempted = $false
$edgeRuntimeContainerName = $null
$edgeRuntimeProjectName = $null
$edgeRuntimeBaseline = $null
$edgeRuntimeLaunchStartedAt = $null
$edgeRuntimeOwnedContainerID = $null
$edgeRuntimeEnvPath = $null

function Import-LocalDotEnv {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separator).Trim()
    if (-not $key -or [Environment]::GetEnvironmentVariable($key, 'Process') -ne $null) {
      continue
    }

    $value = $trimmed.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $first = $value[0]
      $last = $value[$value.Length - 1]
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }

    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
  }
}

function Get-ProcessEnv {
  param(
    [Parameter(Mandatory)][string]$Name,
    [string]$Fallback = ''
  )

  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Fallback
  }
  return $value.Trim()
}

function Set-ProcessEnv {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][AllowEmptyString()][string]$Value
  )

  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Assert-LoopbackUri {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value
  )

  try {
    $uri = [Uri]$Value
  } catch {
    throw "$Name precisa ser uma URL valida."
  }
  if (-not $uri.IsAbsoluteUri) {
    throw "$Name precisa ser uma URL absoluta."
  }

  $allowedHosts = @('localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]')
  if ($allowedHosts -notcontains $uri.Host.ToLowerInvariant()) {
    throw "Execucao recusada: $Name precisa apontar para loopback."
  }
  return $uri
}

function Get-HttpStatus {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [hashtable]$Headers = @{}
  )

  try {
    $response = Invoke-WebRequest `
      -Uri $Uri `
      -Method Get `
      -Headers $Headers `
      -UseBasicParsing `
      -TimeoutSec 4
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Get-AutomationAuthenticatedProbeStatus {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [Parameter(Mandatory)][hashtable]$Headers
  )

  try {
    $response = Invoke-WebRequest `
      -Uri $Uri `
      -Method Post `
      -Headers $Headers `
      -ContentType 'application/json' `
      -Body '{}' `
      -UseBasicParsing `
      -TimeoutSec 4
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Wait-ForHttpStatus {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [Parameter(Mandatory)][int]$ExpectedStatus,
    [hashtable]$Headers = @{},
    [int]$TimeoutSeconds = 60
  )

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ((Get-HttpStatus -Uri $Uri -Headers $Headers) -eq $ExpectedStatus) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "Servico local nao ficou pronto em $Uri dentro de ${TimeoutSeconds}s."
}

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Stop-TrackedProcessTree {
  param([System.Diagnostics.Process]$Process)

  if (-not $Process) {
    return
  }

  function Stop-TreeById {
    param([int]$ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
      Stop-TreeById -ProcessId ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }

  if (-not $Process.HasExited) {
    Stop-TreeById -ProcessId $Process.Id
  }
}

function Assert-ProjectEdgeRuntimeInspectionIdentity {
  param(
    [Parameter(Mandatory)]$Container,
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  if ([string]$Container.Name -cne "/$ContainerName") {
    throw "Container Edge ambiguo: esperado /$ContainerName, recebido $($Container.Name)."
  }

  $labels = $Container.Config.Labels
  $containerProject = if ($labels) {
    [string]$labels.'com.supabase.cli.project'
  } else {
    ''
  }
  $containerWorkdir = if ($labels) {
    [string]$labels.'com.supabase.cli.workdir'
  } else {
    ''
  }
  if ($containerProject -cne $ProjectName) {
    throw "Container Edge ambiguo: label de projeto nao corresponde a $ProjectName."
  }
  if ([string]::IsNullOrWhiteSpace($containerWorkdir)) {
    throw 'Container Edge ambiguo: label de diretorio do projeto ausente.'
  }

  try {
    $resolvedContainerWorkdir = (Resolve-Path -LiteralPath $containerWorkdir).Path
  } catch {
    throw "Container Edge ambiguo: diretorio do projeto nao pode ser validado ($containerWorkdir)."
  }
  $resolvedRepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
  if (-not [string]::Equals(
    $resolvedContainerWorkdir,
    $resolvedRepositoryRoot,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'Container Edge ambiguo: diretorio do projeto nao corresponde ao repositorio atual.'
  }
}

function Assert-StoppedProjectEdgeRuntimeInspection {
  param(
    [Parameter(Mandatory)]$Container,
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  Assert-ProjectEdgeRuntimeInspectionIdentity `
    -Container $Container `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot

  $state = $Container.State
  $isStopped = (
    $state -and
    [string]$state.Status -ceq 'exited' -and
    -not [bool]$state.Running -and
    -not [bool]$state.Paused -and
    -not [bool]$state.Restarting -and
    -not [bool]$state.Dead -and
    [int64]$state.Pid -eq 0
  )
  if (-not $isStopped) {
    $status = if ($state) { [string]$state.Status } else { 'desconhecido' }
    throw "Execucao recusada: container Edge $ContainerName nao esta inequivocamente parado (estado $status)."
  }
}

function Assert-StoppedProjectEdgeRuntimeContainer {
  param(
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  if ($ContainerName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') {
    throw 'Nome de container Edge invalido.'
  }
  if ($ProjectName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') {
    throw 'Nome de projeto Supabase invalido.'
  }

  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw 'Execucao recusada: Docker indisponivel para confirmar o estado do Edge local.'
  }

  $inspectionOutput = @(& $dockerCommand.Source container inspect $ContainerName 2>&1)
  $inspectionExitCode = $LASTEXITCODE
  if ($inspectionExitCode -ne 0) {
    throw "Execucao recusada: nao foi possivel inspecionar o container Edge exato $ContainerName."
  }

  try {
    $inspectionJson = [string]::Join([Environment]::NewLine, [string[]]$inspectionOutput)
    $containers = @(ConvertFrom-Json -InputObject $inspectionJson)
  } catch {
    throw "Execucao recusada: resposta invalida ao inspecionar o container Edge $ContainerName."
  }
  if ($containers.Count -ne 1) {
    throw "Execucao recusada: inspecao ambigua do container Edge $ContainerName."
  }

  Assert-StoppedProjectEdgeRuntimeInspection `
    -Container $containers[0] `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot
}

function Get-ProjectEdgeRuntimeContainerInspection {
  param(
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [switch]$AllowMissing
  )

  if ($ContainerName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') {
    throw 'Nome de container Edge invalido.'
  }
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw 'Docker indisponivel para confirmar o estado do Edge local.'
  }

  $namesOutput = @(
    & $dockerCommand.Source container ls --all --filter "name=^/$ContainerName$" --format '{{.Names}}' 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel localizar o container Edge exato $ContainerName."
  }
  $names = @($namesOutput | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if ($names.Count -eq 0) {
    if ($AllowMissing) {
      return $null
    }
    throw "Container Edge exato $ContainerName nao encontrado."
  }
  if ($names.Count -ne 1 -or [string]$names[0] -cne $ContainerName) {
    throw "Inspecao ambigua do container Edge $ContainerName."
  }

  $inspectionOutput = @(& $dockerCommand.Source container inspect $ContainerName 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel inspecionar o container Edge exato $ContainerName."
  }
  try {
    $inspectionJson = [string]::Join([Environment]::NewLine, [string[]]$inspectionOutput)
    $containers = @(ConvertFrom-Json -InputObject $inspectionJson)
  } catch {
    throw "Resposta invalida ao inspecionar o container Edge $ContainerName."
  }
  if ($containers.Count -ne 1) {
    throw "Inspecao ambigua do container Edge $ContainerName."
  }

  Assert-ProjectEdgeRuntimeInspectionIdentity `
    -Container $containers[0] `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot
  return $containers[0]
}

function ConvertFrom-DockerTimestamp {
  param(
    [Parameter(Mandatory)][string]$Value,
    [Parameter(Mandatory)][string]$Field
  )

  try {
    return [DateTimeOffset]::Parse(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal
    )
  } catch {
    throw "Timestamp Docker invalido em $Field."
  }
}

function Assert-HarnessStartedEdgeRuntimeInspection {
  param(
    [Parameter(Mandatory)]$Container,
    [AllowNull()]$Baseline,
    [Parameter(Mandatory)][DateTimeOffset]$LaunchStartedAt,
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  Assert-ProjectEdgeRuntimeInspectionIdentity `
    -Container $Container `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot

  $containerID = [string]$Container.Id
  if ([string]::IsNullOrWhiteSpace($containerID)) {
    throw 'Ownership do container Edge ambiguo: ID ausente.'
  }

  if ($Baseline -and [string]$Baseline.Id -ceq $containerID) {
    $startedAt = ConvertFrom-DockerTimestamp -Value ([string]$Container.State.StartedAt) -Field 'State.StartedAt'
    if (
      $startedAt -lt $LaunchStartedAt -or
      [string]$Container.State.StartedAt -ceq [string]$Baseline.State.StartedAt
    ) {
      throw 'Ownership do container Edge ambiguo: container preexistente nao foi reiniciado por este launch.'
    }
    return
  }

  $createdAt = ConvertFrom-DockerTimestamp -Value ([string]$Container.Created) -Field 'Created'
  if ($createdAt -lt $LaunchStartedAt) {
    throw 'Ownership do container Edge ambiguo: container nao foi criado por este launch.'
  }
}

function Stop-HarnessStartedProjectEdgeRuntimeContainer {
  param(
    [AllowNull()]$Baseline,
    [AllowEmptyString()][string]$ExpectedContainerID = '',
    [Parameter(Mandatory)][DateTimeOffset]$LaunchStartedAt,
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$ProjectName,
    [Parameter(Mandatory)][string]$RepositoryRoot
  )

  $container = Get-ProjectEdgeRuntimeContainerInspection `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot `
    -AllowMissing
  if (-not $container) {
    return
  }
  if (
    -not [string]::IsNullOrWhiteSpace($ExpectedContainerID) -and
    [string]$container.Id -cne $ExpectedContainerID
  ) {
    throw 'Ownership do container Edge ambiguo: a instancia ativa mudou depois do launch.'
  }

  $state = $container.State
  if (-not [bool]$state.Running -and -not [bool]$state.Paused -and -not [bool]$state.Restarting) {
    return
  }

  Assert-HarnessStartedEdgeRuntimeInspection `
    -Container $container `
    -Baseline $Baseline `
    -LaunchStartedAt $LaunchStartedAt `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot

  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw 'Docker indisponivel para encerrar o Edge iniciado pelo harness.'
  }
  $null = & $dockerCommand.Source container stop --time 10 $ContainerName 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao parar o container Edge iniciado pelo harness: $ContainerName."
  }

  $stoppedContainer = Get-ProjectEdgeRuntimeContainerInspection `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot
  Assert-StoppedProjectEdgeRuntimeInspection `
    -Container $stoppedContainer `
    -ContainerName $ContainerName `
    -ProjectName $ProjectName `
    -RepositoryRoot $RepositoryRoot
  Write-Host "Container Edge iniciado pelo harness foi parado: $ContainerName."
}

try {
  Set-Location -LiteralPath $repositoryRoot
  Import-LocalDotEnv -Path (Join-Path $repositoryRoot '.env.e2e.local')
  Import-LocalDotEnv -Path (Join-Path $repositoryRoot '.env.e2e')

  if ($Confirm -ne $requiredConfirmation) {
    throw "Execucao recusada: use -Confirm $requiredConfirmation para autorizar escrita local."
  }
  if (Test-Path Env:E2E_ALLOW_REMOTE) {
    throw 'Execucao recusada: remova E2E_ALLOW_REMOTE do ambiente.'
  }
  if ($CleanupRun -and $CleanupRun -notmatch '^load-\d{8}T\d{9}Z-[0-9a-f]{8}$') {
    throw 'CleanupRun invalido.'
  }

  $configuredApiURL = Get-ProcessEnv -Name 'E2E_VIMOB_API_URL' -Fallback 'http://127.0.0.1:8081'
  $supabaseURL = Get-ProcessEnv -Name 'E2E_SUPABASE_URL' -Fallback 'http://127.0.0.1:54321'
  $databaseURL = Get-ProcessEnv -Name 'E2E_DATABASE_URL' -Fallback 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  $baseURL = Get-ProcessEnv -Name 'E2E_BASE_URL' -Fallback 'http://127.0.0.1:3000'
  $anonKey = Get-ProcessEnv -Name 'E2E_SUPABASE_ANON_KEY'
  $serviceRoleKey = Get-ProcessEnv -Name 'E2E_SUPABASE_SERVICE_ROLE_KEY'
  $jwtSecret = Get-ProcessEnv -Name 'E2E_SUPABASE_JWT_SECRET'

  if (-not $anonKey -or -not $serviceRoleKey) {
    throw 'Crie .env.e2e.local com E2E_SUPABASE_ANON_KEY e E2E_SUPABASE_SERVICE_ROLE_KEY.'
  }

  $null = Assert-LoopbackUri -Name 'E2E_VIMOB_API_URL' -Value $configuredApiURL
  $supabaseUri = Assert-LoopbackUri -Name 'E2E_SUPABASE_URL' -Value $supabaseURL
  $null = Assert-LoopbackUri -Name 'E2E_DATABASE_URL' -Value $databaseURL
  $null = Assert-LoopbackUri -Name 'E2E_BASE_URL' -Value $baseURL
  $apiPort = Get-FreeLoopbackPort
  $apiURL = "http://127.0.0.1:$apiPort"
  $apiUri = [Uri]$apiURL

  Set-ProcessEnv -Name 'VIMOB_LOAD_CONFIRM' -Value $requiredConfirmation
  Set-ProcessEnv -Name 'VIMOB_LOAD_PROFILE' -Value $Profile
  Set-ProcessEnv -Name 'API_ENV' -Value 'test'
  Set-ProcessEnv -Name 'API_HOST' -Value '127.0.0.1'
  Set-ProcessEnv -Name 'API_PORT' -Value ([string]$apiUri.Port)
  Set-ProcessEnv -Name 'API_CORS_ALLOWED_ORIGINS' -Value "$baseURL,http://localhost:3000,http://127.0.0.1:3000"
  # The isolated API receives synthetic client addresses from the local load
  # driver. Trust only the loopback process that this wrapper starts.
  Set-ProcessEnv -Name 'API_TRUSTED_PROXY_CIDRS' -Value '127.0.0.0/8,::1/128'
  Set-ProcessEnv -Name 'E2E_VIMOB_API_URL' -Value $apiURL
  Set-ProcessEnv -Name 'NEXT_PUBLIC_VIMOB_API_URL' -Value $apiURL
  Set-ProcessEnv -Name 'VIMOB_API_URL' -Value $apiURL
  Set-ProcessEnv -Name 'NEXT_PUBLIC_SUPABASE_URL' -Value $supabaseURL
  Set-ProcessEnv -Name 'NEXT_PUBLIC_SUPABASE_ANON_KEY' -Value $anonKey
  # Seed helpers optionally prefer this header over the service-role key.
  # Pin it to the same validated local credential so an expired value left in
  # .env.e2e.local cannot override the current run.
  Set-ProcessEnv -Name 'E2E_SUPABASE_ADMIN_ACCESS_TOKEN' -Value $serviceRoleKey
  Set-ProcessEnv -Name 'SUPABASE_PROJECT_URL' -Value $supabaseURL
  Set-ProcessEnv -Name 'SUPABASE_URL' -Value $supabaseURL
  Set-ProcessEnv -Name 'SUPABASE_SERVICE_ROLE_KEY' -Value $serviceRoleKey
  Set-ProcessEnv -Name 'SUPABASE_SECRET_KEY' -Value $serviceRoleKey
  Set-ProcessEnv -Name 'SUPABASE_JWT_ISSUER' -Value ($supabaseURL.TrimEnd('/') + '/auth/v1')
  Set-ProcessEnv -Name 'SUPABASE_JWT_AUDIENCE' -Value 'authenticated'
  Set-ProcessEnv -Name 'DATABASE_URL' -Value $databaseURL
  Set-ProcessEnv -Name 'AUTOMATION_RUNTIME_WORKER_ENABLED' -Value 'true'
  # Manual executions must prove the coalesced wake path. Keep periodic
  # recovery enabled, but outside the 30-second lifecycle assertion window so
  # it cannot hide a lost wake or compete with the intake burst.
  Set-ProcessEnv -Name 'AUTOMATION_RUNTIME_WORKER_INTERVAL' -Value '1m'
  Set-ProcessEnv -Name 'AUTOMATION_INACTIVITY_WORKER_INTERVAL' -Value '24h'
  Set-ProcessEnv -Name 'WHATSAPP_AI_WORKER_ENABLED' -Value 'false'
  Set-ProcessEnv -Name 'WHATSAPP_AI_FOLLOW_UP_WORKER_ENABLED' -Value 'false'
  Set-ProcessEnv -Name 'WHATSAPP_OUTBOX_WORKER_ENABLED' -Value 'false'
  Set-ProcessEnv -Name 'WHATSAPP_WEBHOOK_WORKER_ENABLED' -Value 'false'
  Set-ProcessEnv -Name 'WHATSAPP_SESSION_SUPERVISOR_ENABLED' -Value 'false'
  Set-ProcessEnv -Name 'ASAAS_RECONCILIATION_ENABLED' -Value 'false'

  if ($jwtSecret) {
    Set-ProcessEnv -Name 'SUPABASE_JWT_SECRET' -Value $jwtSecret
    [Environment]::SetEnvironmentVariable('SUPABASE_JWKS_URL', $null, 'Process')
  } else {
    [Environment]::SetEnvironmentVariable('SUPABASE_JWT_SECRET', $null, 'Process')
    Set-ProcessEnv -Name 'SUPABASE_JWKS_URL' -Value ($supabaseURL.TrimEnd('/') + '/auth/v1/.well-known/jwks.json')
  }

  New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
  $preflightArguments = @(
    '--experimental-strip-types',
    'scripts/load/lead-lifecycle.ts',
    "--profile=$Profile",
    '--preflight-only'
  )
  if ($CleanupRun) {
    $preflightArguments += "--cleanup-run=$CleanupRun"
  }
  & node @preflightArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Preflight do banco E2E falhou; nenhum servico do harness foi iniciado.'
  }

  $timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
  $readyUri = $apiURL.TrimEnd('/') + '/readyz'
  Write-Host "Iniciando API local isolada para o harness na porta $apiPort..."
  $apiProcess = Start-Process `
    -FilePath 'go' `
    -ArgumentList @('run', './apps/api/cmd/api') `
    -WorkingDirectory $repositoryRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDirectory "api-$timestamp.stdout.log") `
    -RedirectStandardError (Join-Path $runtimeDirectory "api-$timestamp.stderr.log") `
    -PassThru
  Wait-ForHttpStatus -Uri $readyUri -ExpectedStatus 200

  if (-not $CleanupRun) {
    $functionUri = $supabaseURL.TrimEnd('/') + '/functions/v1/automation-executor'
    $functionHeaders = @{
      apikey = $serviceRoleKey
      Authorization = "Bearer $serviceRoleKey"
    }
    $edgeRuntimeProjectName = Split-Path -Leaf $repositoryRoot
    $edgeRuntimeContainerName = "supabase_edge_runtime_$edgeRuntimeProjectName"
    $existingFunctionStatus = Get-HttpStatus -Uri $functionUri -Headers $functionHeaders
    if ($existingFunctionStatus -eq 405) {
      throw "Execucao recusada: automation-executor ja responde em $functionUri (HTTP $existingFunctionStatus). Encerre o processo existente para garantir isolamento."
    }
    elseif ($existingFunctionStatus -eq 502) {
      $edgeRuntimeBaseline = Get-ProjectEdgeRuntimeContainerInspection `
        -ContainerName $edgeRuntimeContainerName `
        -ProjectName $edgeRuntimeProjectName `
        -RepositoryRoot $repositoryRoot
      Assert-StoppedProjectEdgeRuntimeInspection `
        -Container $edgeRuntimeBaseline `
        -ContainerName $edgeRuntimeContainerName `
        -ProjectName $edgeRuntimeProjectName `
        -RepositoryRoot $repositoryRoot
      Write-Host "Gateway retornou HTTP 502; container Edge exato $edgeRuntimeContainerName confirmado parado."
    }
    elseif ($existingFunctionStatus -in @(0, 404, 503)) {
      $edgeRuntimeBaseline = Get-ProjectEdgeRuntimeContainerInspection `
        -ContainerName $edgeRuntimeContainerName `
        -ProjectName $edgeRuntimeProjectName `
        -RepositoryRoot $repositoryRoot `
        -AllowMissing
      if ($edgeRuntimeBaseline) {
        Assert-StoppedProjectEdgeRuntimeInspection `
          -Container $edgeRuntimeBaseline `
          -ContainerName $edgeRuntimeContainerName `
          -ProjectName $edgeRuntimeProjectName `
          -RepositoryRoot $repositoryRoot
      }
    }
    else {
      throw "Execucao recusada: estado ambiguo do automation-executor em $functionUri (HTTP $existingFunctionStatus)."
    }
    Write-Host 'Iniciando automation-executor local isolado para o harness...'
    # Materialize only the credentials selected by this preflight. Reusing a
    # repository env file can silently give the Edge runtime an expired key
    # while the caller uses the freshly generated local key.
    $edgeRuntimeEnvPath = Join-Path $runtimeDirectory "edge-$timestamp.env"
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllLines(
      $edgeRuntimeEnvPath,
      @(
        "SUPABASE_URL=$supabaseURL",
        "SUPABASE_ANON_KEY=$anonKey",
        "SUPABASE_SERVICE_ROLE_KEY=$serviceRoleKey",
        "AUTOMATION_RUNTIME_SERVICE_TOKEN=$serviceRoleKey"
      ),
      $utf8WithoutBom
    )
    $edgeRuntimeLaunchStartedAt = [DateTimeOffset]::UtcNow
    $functionProcess = Start-Process `
      -FilePath 'npx.cmd' `
      -ArgumentList @(
        'supabase',
        'functions',
        'serve',
        'automation-executor',
        '--env-file',
        $edgeRuntimeEnvPath
      ) `
      -WorkingDirectory $repositoryRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $runtimeDirectory "automation-$timestamp.stdout.log") `
      -RedirectStandardError (Join-Path $runtimeDirectory "automation-$timestamp.stderr.log") `
      -PassThru
    $edgeRuntimeLaunchAttempted = $true
    Wait-ForHttpStatus -Uri $functionUri -ExpectedStatus 405 -Headers $functionHeaders
    $authenticatedProbeStatus = Get-AutomationAuthenticatedProbeStatus `
      -Uri $functionUri `
      -Headers $functionHeaders
    if ($authenticatedProbeStatus -ne 400) {
      throw "automation-executor local falhou no probe autenticado (esperado HTTP 400, recebido $authenticatedProbeStatus)."
    }
    $startedEdgeRuntime = Get-ProjectEdgeRuntimeContainerInspection `
      -ContainerName $edgeRuntimeContainerName `
      -ProjectName $edgeRuntimeProjectName `
      -RepositoryRoot $repositoryRoot
    $edgeRuntimeOwnedContainerID = [string]$startedEdgeRuntime.Id
    Assert-HarnessStartedEdgeRuntimeInspection `
      -Container $startedEdgeRuntime `
      -Baseline $edgeRuntimeBaseline `
      -LaunchStartedAt $edgeRuntimeLaunchStartedAt `
      -ContainerName $edgeRuntimeContainerName `
      -ProjectName $edgeRuntimeProjectName `
      -RepositoryRoot $repositoryRoot
  }

  $nodeArguments = @(
    '--experimental-strip-types',
    'scripts/load/lead-lifecycle.ts',
    "--profile=$Profile"
  )
  if ($CleanupRun) {
    $nodeArguments += "--cleanup-run=$CleanupRun"
  }

  & node @nodeArguments
  $harnessExitCode = $LASTEXITCODE
} catch {
  $harnessExitCode = 1
  Write-Error $_.Exception.Message -ErrorAction Continue
} finally {
  try {
    Stop-TrackedProcessTree -Process $functionProcess
  } catch {
    $harnessExitCode = 1
    Write-Error "Falha ao encerrar processo Edge do harness: $($_.Exception.Message)" -ErrorAction Continue
  }
  if (
    $edgeRuntimeLaunchAttempted -and
    $edgeRuntimeLaunchStartedAt -and
    $edgeRuntimeContainerName -and
    $edgeRuntimeProjectName
  ) {
    try {
      Stop-HarnessStartedProjectEdgeRuntimeContainer `
        -Baseline $edgeRuntimeBaseline `
        -ExpectedContainerID ([string]$edgeRuntimeOwnedContainerID) `
        -LaunchStartedAt $edgeRuntimeLaunchStartedAt `
        -ContainerName $edgeRuntimeContainerName `
        -ProjectName $edgeRuntimeProjectName `
        -RepositoryRoot $repositoryRoot
    } catch {
      $harnessExitCode = 1
      Write-Error "Falha no cleanup seguro do Edge: $($_.Exception.Message)" -ErrorAction Continue
    }
  }
  try {
    Stop-TrackedProcessTree -Process $apiProcess
  } catch {
    $harnessExitCode = 1
    Write-Error "Falha ao encerrar API do harness: $($_.Exception.Message)" -ErrorAction Continue
  }
  if ($edgeRuntimeEnvPath -and [System.IO.File]::Exists($edgeRuntimeEnvPath)) {
    try {
      [System.IO.File]::Delete($edgeRuntimeEnvPath)
    } catch {
      $harnessExitCode = 1
      Write-Error "Falha ao remover credencial temporaria do Edge: $($_.Exception.Message)" -ErrorAction Continue
    }
  }
}

exit $harnessExitCode
