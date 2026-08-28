[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal(
  [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute este script como administrador.'
}

$ruleName = 'VimobCrmLocalMobile'
$displayName = 'Vimob CRM local para celular'
$ports = @('3000', '8081', '55321')
$existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue

if (-not $existingRule) {
  New-NetFirewallRule `
    -Name $ruleName `
    -DisplayName $displayName `
    -Description 'Permite frontend, API e gateway Supabase locais somente a dispositivos da mesma sub-rede.' `
    -Enabled True `
    -Direction Inbound `
    -Action Allow `
    -Profile Any `
    -Protocol TCP `
    -LocalPort $ports `
    -RemoteAddress LocalSubnet | Out-Null
} else {
  Set-NetFirewallRule `
    -Name $ruleName `
    -DisplayName $displayName `
    -Description 'Permite frontend, API e gateway Supabase locais somente a dispositivos da mesma sub-rede.' `
    -Enabled True `
    -Direction Inbound `
    -Action Allow `
    -Profile Any | Out-Null

  $existingRule |
    Get-NetFirewallPortFilter |
    Set-NetFirewallPortFilter -Protocol TCP -LocalPort $ports | Out-Null

  $existingRule |
    Get-NetFirewallAddressFilter |
    Set-NetFirewallAddressFilter -RemoteAddress LocalSubnet | Out-Null
}

Write-Host 'Firewall liberado somente para a sub-rede local nas portas 3000, 8081 e 55321.'
