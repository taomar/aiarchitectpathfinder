# Microsoft Entra App Service deployment

This profile uses App Service built-in authentication with an existing
customer-controlled Entra registration. It does not create a tenant, app
registration, enterprise application, credential, consent grant, user assignment,
or workload identity.

The starting configuration is single-tenant access for assigned users and
invited business guests. It is not open access for every Microsoft account or
every organization. Consumer External ID and open multitenant access require a
separate design and are not silently enabled.

## 1. Prepare the existing Entra application

Before running `azd up`:

1. Choose the future Web App name.
2. On your existing registration, configure the **Web** redirect URI:
   `https://<app-name>.azurewebsites.net/.auth/login/aad/callback`.
3. Prepare an existing valid client credential and its rotation process.
4. On the existing enterprise application, enable **Assignment required** and
   assign the intended users or groups. Invite approved guests as required.
5. Ensure the operator can read the registration and enterprise application in
   the configured tenant for preflight verification.

Authentication to the website does not grant model access. Prepare that
workload permission independently.

## 2. Configure the deployment environment

```powershell
npm ci
az login
azd auth login
azd env new external-entra --no-prompt
azd env set AZURE_SUBSCRIPTION_ID "<subscription-id>" --environment external-entra
azd env set AZURE_LOCATION "westeurope" --environment external-entra
azd env set AZURE_RESOURCE_GROUP "<existing-resource-group>" --environment external-entra
azd env set AZURE_WEB_APP_NAME "<the-preconfigured-app-name>" --environment external-entra
azd env set CREATE_APP_SERVICE_PLAN "true" --environment external-entra
azd env set AUTH_MODE "entra" --environment external-entra
azd env set AUTH_ENTRA_TENANT_ID "<existing-tenant-id>" --environment external-entra
azd env set AUTH_ENTRA_CLIENT_ID "<existing-application-client-id>" --environment external-entra
$credential = Read-Host "Existing Entra client secret" -AsSecureString
azd env set AUTH_ENTRA_CLIENT_SECRET (ConvertFrom-SecureString $credential -AsPlainText) --environment external-entra
```

The default is a new single-instance B1 plan. To reuse a Linux plan in the same
region, set `CREATE_APP_SERVICE_PLAN=false` and `EXISTING_APP_SERVICE_PLAN_ID`.

Optionally set `ADMIN_EMAILS` to explicit assigned administrators. No
administrator is built in, and the address list does not itself authorize a user
to sign in. Usage persistence is not configured by this minimal profile.

## 3. Configure existing model access

Set `APP_AI_SETTINGS` using [the model configuration reference](configuration.md#existing-model-access).
Use `external-entra` as the environment name. The website's Entra client secret
is not a Foundry API key and is not used as the backend model credential.

## 4. Validate, then deploy

```powershell
pwsh -NoProfile -File scripts\deploy-external.ps1 -Environment external-entra -ValidateOnly
pwsh -NoProfile -File scripts\deploy-external.ps1 -Environment external-entra
```

The script calls `azd up` after preflight. Bicep enables App Service
authentication, configures the explicit tenant issuer and audiences, requires
sign-in, and references the client credential through an app-setting name.
Only `/api/health` is excluded from platform authentication.

Use the hostname actually returned by Azure as authoritative. If Azure assigns
a secure unique hostname rather than `<app-name>.azurewebsites.net`, the
registration owner must add that exact callback URI before the first sign-in.
The script does not modify the registration; subsequent preflight runs verify
the existing Web App's actual hostname. Treat this as an incomplete login setup
until the callback is correct, not a successful Entra deployment.

## 5. Verify the boundary

Use an assigned account to complete a real sign-in. Check an unassigned account
is rejected, a different tenant cannot sign in unintentionally, and admin access
requires the explicit administrator list. Then submit a model-backed scenario.

Successful infrastructure deployment does not prove the registration credential,
assignments, browser login, or model identity all work. Record these checks
separately before sharing the application.

## Troubleshooting

- Redirect URI mismatch: update the existing registration's Web callback URL to
  exactly match the configured app name.
- Assignment required error: have the tenant administrator assign the intended
  user/group; do not disable the restriction to get a successful test.
- Entra mode returns `503`: verify App Service Authentication is enabled and the
  configured tenant and client IDs match the registration.
- Model authorization failure: check the separately configured workload identity
  or API key, not the sign-in user's permissions.

Follow [app-only removal guidance](README.md#costs-and-removal); leave the
existing registration, identity, model resources, and shared services intact.
