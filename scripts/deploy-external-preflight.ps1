[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
function Step([string]$Message) { Write-Host "[preflight] $Message" }
function Invoke-AzJson([string[]]$Arguments) {
  $result = & az @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) { throw "Azure prerequisite command failed. No prerequisite resources will be created automatically." }
  return ($result | ConvertFrom-Json -AsHashtable)
}
function Require-Value([string]$Name) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    throw "Set $Name in the selected azd environment before azd up."
  }
}

Step "Checking explicit deployment configuration."
foreach ($name in @("AZURE_ENV_NAME", "AZURE_SUBSCRIPTION_ID", "AZURE_LOCATION", "AZURE_RESOURCE_GROUP", "AZURE_WEB_APP_NAME", "AUTH_MODE", "APP_AI_SETTINGS")) {
  Require-Value $name
}
if ($env:AZURE_WEB_APP_NAME -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,58}[a-zA-Z0-9]$') { throw "Invalid Web App name." }
if ($env:AUTH_MODE -notin @("password", "entra")) { throw "AUTH_MODE must be password or entra." }
$createPlan = if ($env:CREATE_APP_SERVICE_PLAN) { $env:CREATE_APP_SERVICE_PLAN } else { "true" }
if ($createPlan -notin @("true", "false")) { throw "CREATE_APP_SERVICE_PLAN must be true or false." }
if ($env:AUTH_MODE -eq "password") {
  if ($env:AUTH_PASSWORD_HASH -notmatch '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$' -or
      [Text.Encoding]::UTF8.GetByteCount([string]$env:AUTH_SESSION_SECRET) -lt 32) {
    throw "Run the password setup command for this azd environment before deployment."
  }
} else {
  foreach ($name in @("AUTH_ENTRA_TENANT_ID", "AUTH_ENTRA_CLIENT_ID", "AUTH_ENTRA_CLIENT_SECRET")) { Require-Value $name }
  foreach ($value in @($env:AUTH_ENTRA_TENANT_ID, $env:AUTH_ENTRA_CLIENT_ID)) {
    if ($value -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') { throw "Entra tenant/client IDs must be GUIDs." }
  }
}
try { $ai = $env:APP_AI_SETTINGS | ConvertFrom-Json -AsHashtable } catch { throw "APP_AI_SETTINGS must contain a JSON object. Its values were not printed." }
if ($ai -isnot [System.Collections.IDictionary]) { throw "APP_AI_SETTINGS must be an object." }
$allowedSettings = @(
  "PATHFINDER_AI_MODE", "PATHFINDER_FOUNDRY_ENDPOINT", "PATHFINDER_FOUNDRY_AUTH",
  "PATHFINDER_WIZARD_DEPLOYMENT", "PATHFINDER_ARCHITECTURE_DEPLOYMENT", "PATHFINDER_JUDGE_DEPLOYMENT",
  "PATHFINDER_JUDGE_REASONING_EFFORT", "AZURE_OPENAI_ENABLED", "AZURE_OPENAI_API_KEY",
  "AZURE_CLIENT_ID", "AZURE_TENANT_ID"
)
foreach ($entry in $ai.GetEnumerator()) {
  if ($entry.Key -notin $allowedSettings -or $entry.Value -isnot [string] -or $entry.Value -match '[<>]') {
    throw "APP_AI_SETTINGS contains an unsupported setting, non-string value, or unfilled placeholder."
  }
}
if ($ai.PATHFINDER_AI_MODE -ne "external-foundry" -or $ai.AZURE_OPENAI_ENABLED -ne "true") {
  throw "The external profile requires PATHFINDER_AI_MODE=external-foundry and AZURE_OPENAI_ENABLED=true."
}
if ($ai.PATHFINDER_FOUNDRY_AUTH -notin @("apiKey", "managedIdentity")) { throw "Choose an explicit Foundry authentication mode." }
$endpoint = $null
if (-not [Uri]::TryCreate([string]$ai.PATHFINDER_FOUNDRY_ENDPOINT, [UriKind]::Absolute, [ref]$endpoint) -or
    $endpoint.Scheme -ne "https" -or $endpoint.UserInfo -or $endpoint.AbsolutePath -ne "/" -or $endpoint.Query -or $endpoint.Fragment) {
  throw "Supply the HTTPS Foundry/OpenAI model-resource root, not a project URL."
}
foreach ($name in @("PATHFINDER_WIZARD_DEPLOYMENT", "PATHFINDER_ARCHITECTURE_DEPLOYMENT")) {
  if ([string]::IsNullOrWhiteSpace($ai[$name])) { throw "APP_AI_SETTINGS must specify $name." }
}
$roleChecks = @(
  @{ Role = "wizard"; Deployment = $ai.PATHFINDER_WIZARD_DEPLOYMENT; Effort = "low"; Structured = $false },
  @{ Role = "architecture"; Deployment = $ai.PATHFINDER_ARCHITECTURE_DEPLOYMENT; Effort = "xhigh"; Structured = $true }
)
if (-not [string]::IsNullOrWhiteSpace($ai["PATHFINDER_JUDGE_DEPLOYMENT"])) {
  $reviewEffort = if ($ai["PATHFINDER_JUDGE_REASONING_EFFORT"]) { $ai["PATHFINDER_JUDGE_REASONING_EFFORT"] } else { "medium" }
  if ($reviewEffort -notin @("low", "medium", "high", "xhigh")) { throw "The optional review reasoning effort is invalid." }
  $roleChecks += @{ Role = "review"; Deployment = $ai.PATHFINDER_JUDGE_DEPLOYMENT; Effort = $reviewEffort; Structured = $true }
} else {
  Step "Optional AI review is not configured; generation and exports will remain available."
}
if ($ai.PATHFINDER_FOUNDRY_AUTH -eq "apiKey" -and [string]::IsNullOrWhiteSpace($ai.AZURE_OPENAI_API_KEY)) {
  throw "API-key mode requires AZURE_OPENAI_API_KEY in APP_AI_SETTINGS."
}
if ($ai.PATHFINDER_FOUNDRY_AUTH -eq "managedIdentity") {
  Require-Value "WORKLOAD_IDENTITY_RESOURCE_ID"
  if ([string]::IsNullOrWhiteSpace($ai.AZURE_CLIENT_ID)) { throw "Set the pre-authorized user-assigned identity client ID in APP_AI_SETTINGS." }
}

Step "Verifying the existing resource group and hosting prerequisites."
$group = Invoke-AzJson @("group", "show", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--name", $env:AZURE_RESOURCE_GROUP)
$provider = Invoke-AzJson @("provider", "show", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--namespace", "Microsoft.Web")
if ($provider.registrationState -ne "Registered") { throw "Microsoft.Web must already be registered in the deployment subscription." }
$existingApps = Invoke-AzJson @("webapp", "list", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--resource-group", $env:AZURE_RESOURCE_GROUP)
$existingApp = @($existingApps | Where-Object { $_.name -eq $env:AZURE_WEB_APP_NAME })
if ($existingApp.Count -gt 0 -and
    ($existingApp[0].tags.'azd-env-name' -ne $env:AZURE_ENV_NAME -or $existingApp[0].tags.'azd-service-name' -ne "web")) {
  throw "The selected Web App already exists and is not owned by this azd environment. Choose a new name."
}
if ($createPlan -eq "false") {
  Require-Value "EXISTING_APP_SERVICE_PLAN_ID"
  $plan = Invoke-AzJson @("appservice", "plan", "show", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--ids", $env:EXISTING_APP_SERVICE_PLAN_ID)
  if (-not $plan.reserved -or ($plan.location -replace ' ', '').ToLowerInvariant() -ne $env:AZURE_LOCATION.ToLowerInvariant()) {
    throw "The existing App Service plan must be Linux and match AZURE_LOCATION."
  }
} else {
  $newPlanName = if ($env:AZURE_APP_SERVICE_PLAN_NAME) { $env:AZURE_APP_SERVICE_PLAN_NAME } else { "$($env:AZURE_WEB_APP_NAME)-plan" }
  $existingPlans = Invoke-AzJson @("appservice", "plan", "list", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--resource-group", $env:AZURE_RESOURCE_GROUP)
  $existingPlan = @($existingPlans | Where-Object { $_.name -eq $newPlanName })
  if ($existingPlan.Count -gt 0 -and
      ($existingPlan[0].tags.'azd-env-name' -ne $env:AZURE_ENV_NAME -or $existingPlan[0].tags.application -ne "aiarchitectpathfinder")) {
    throw "The new plan name is already in use by another deployment. Choose a new name or explicitly configure existing-plan reuse."
  }
  Step "A new single-instance Linux B1 plan is configured; it is billable until the plan is deleted."
}
if ($ai.PATHFINDER_FOUNDRY_AUTH -eq "managedIdentity") {
  $identity = Invoke-AzJson @("identity", "show", "--subscription", $env:AZURE_SUBSCRIPTION_ID, "--ids", $env:WORKLOAD_IDENTITY_RESOURCE_ID)
  if ($identity.clientId -ne $ai.AZURE_CLIENT_ID) { throw "The configured workload identity and client ID do not match." }
  Step "Existing identity confirmed. Model data-plane access must already be granted; this script creates no role assignments."
}

if ($env:AUTH_MODE -eq "entra") {
  Step "Verifying the existing Entra registration and assignment requirement."
  $graph = Invoke-AzJson @("account", "get-access-token", "--tenant", $env:AUTH_ENTRA_TENANT_ID, "--resource-type", "ms-graph")
  $graphHeaders = @{ Authorization = "Bearer $($graph.accessToken)" }
  $filter = [Uri]::EscapeDataString("appId eq '$($env:AUTH_ENTRA_CLIENT_ID)'")
  $application = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/applications?`$filter=$filter&`$select=appId,web" -Headers $graphHeaders -TimeoutSec 30
  $servicePrincipal = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=$filter&`$select=appId,appRoleAssignmentRequired" -Headers $graphHeaders -TimeoutSec 30
  $hostName = if ($existingApp.Count -gt 0) { $existingApp[0].defaultHostName } else { "$($env:AZURE_WEB_APP_NAME).azurewebsites.net" }
  $callback = "https://$hostName/.auth/login/aad/callback"
  if ($application.value.Count -ne 1 -or $callback -notin $application.value[0].web.redirectUris) {
    throw "Register the exact test app callback URL on the existing Entra registration before deployment."
  }
  if ($servicePrincipal.value.Count -ne 1 -or -not $servicePrincipal.value[0].appRoleAssignmentRequired) {
    throw "The existing enterprise application must require user assignment. Assign the intended users or groups before deployment."
  }
}

Step "Checking model access, response format and reasoning support for each configured role."
$modelHeaders = @{ "Content-Type" = "application/json" }
if ($ai.PATHFINDER_FOUNDRY_AUTH -eq "apiKey") {
  $modelHeaders["api-key"] = $ai.AZURE_OPENAI_API_KEY
} else {
  $tokenArguments = @("account", "get-access-token", "--resource", "https://cognitiveservices.azure.com/")
  if ($ai.AZURE_TENANT_ID) { $tokenArguments += @("--tenant", $ai.AZURE_TENANT_ID) }
  $access = Invoke-AzJson $tokenArguments
  $modelHeaders.Authorization = "Bearer $($access.accessToken)"
  Step "This pre-deployment call uses the operator credential, not the future host identity. Hosted identity access must also be checked after deployment."
}
foreach ($check in $roleChecks) {
  Step "Checking configured $($check.Role) deployment: $($check.Deployment), reasoning $($check.Effort)"
  $body = @{
    model = $check.Deployment
    messages = @(@{ role = "user"; content = 'Return only JSON: {"ready":true}.' })
    reasoning_effort = $check.Effort
    max_completion_tokens = 2048
    response_format = if ($check.Structured) {
      @{
        type = "json_schema"
        json_schema = @{
          name = "pathfinder_prerequisite"
          strict = $true
          schema = @{
            type = "object"; properties = @{ ready = @{ type = "boolean" } }
            required = @("ready"); additionalProperties = $false
          }
        }
      }
    } else { @{ type = "json_object" } }
  } | ConvertTo-Json -Depth 10
  try {
    $response = Invoke-RestMethod -Method Post -Uri ($endpoint.AbsoluteUri.TrimEnd('/') + "/openai/v1/chat/completions") -Headers $modelHeaders -Body $body -TimeoutSec 90
  } catch {
    throw "The $($check.Role) model check failed. Verify its response-format/reasoning support, endpoint, credentials, and network access. No resources were changed."
  }
  if (-not $response.choices -or $response.choices[0].finish_reason -ne "stop" -or [string]::IsNullOrWhiteSpace($response.choices[0].message.content)) {
    throw "A configured deployment did not return a usable chat completion."
  }
  try { $ready = $response.choices[0].message.content | ConvertFrom-Json -AsHashtable } catch { throw "A model prerequisite response was not valid JSON." }
  if ($ready.ready -ne $true) { throw "A model prerequisite response did not confirm readiness." }
}

Step "Checking the exact resource change set without printing app-setting values."
$changeSet = Invoke-AzJson @(
  "deployment", "group", "what-if", "--subscription", $env:AZURE_SUBSCRIPTION_ID,
  "--resource-group", $env:AZURE_RESOURCE_GROUP, "--template-file", "infra/main.bicep",
  "--parameters", "infra/main.bicepparam", "--result-format", "ResourceIdOnly", "--no-pretty-print"
)
if ($changeSet.status -ne "Succeeded" -or -not $changeSet.ContainsKey("changes")) {
  throw "Azure did not return a successful, inspectable what-if result."
}
$appId = "$($group.id)/providers/Microsoft.Web/sites/$($env:AZURE_WEB_APP_NAME)"
$planName = if ($env:AZURE_APP_SERVICE_PLAN_NAME) { $env:AZURE_APP_SERVICE_PLAN_NAME } else { "$($env:AZURE_WEB_APP_NAME)-plan" }
$allowedIds = @($appId, "$appId/config/authsettingsV2", "$appId/config/appsettings")
if ($createPlan -eq "true") { $allowedIds += "$($group.id)/providers/Microsoft.Web/serverfarms/$planName" }
foreach ($change in $changeSet.changes) {
  if ($change.changeType -in @("NoChange", "Ignore")) { continue }
  if ($change.changeType -notin @("Create", "Modify") -or $change.resourceId -notin $allowedIds) {
    throw "The deployment would change a resource outside the approved application hosting boundary."
  }
  Step "$($change.changeType): $($change.resourceId)"
}
Step "Prerequisites passed. Foundry, models, identities, registrations, and shared services will not be provisioned."
