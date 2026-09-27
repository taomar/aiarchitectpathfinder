[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]{1,60}$')]
  [string]$Environment,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$values = & azd env get-values --environment $Environment --output json
if ($LASTEXITCODE -ne 0) { throw "Could not read the selected azd environment." }
$configuration = $values | ConvertFrom-Json -AsHashtable
foreach ($entry in $configuration.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, 'Process')
}
& (Join-Path $PSScriptRoot "deploy-external-preflight.ps1")
if ($ValidateOnly) {
  Write-Host "Preflight completed. No resources were created."
  return
}
Write-Host "Deploying only the configured App Service hosting resources."
& azd up --environment $Environment --no-prompt
if ($LASTEXITCODE -ne 0) { throw "azd up failed. Do not treat this deployment as successful." }
Write-Host "Deployment finished. Verify authenticated login and model access before sharing the site."
