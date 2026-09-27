# Password-protected App Service deployment

Use this profile for controlled sharing with a shared access password. It is not
a substitute for individual identity, MFA, user-specific revocation, or a
per-person audit trail. All application APIs require a valid session, except the
minimal health endpoint and the login endpoint.

## 1. Configure the target

Run from the repository root after installing the prerequisites:

```powershell
npm ci
az login
azd auth login
azd env new external-simple --no-prompt
azd env set AZURE_SUBSCRIPTION_ID "<subscription-id>" --environment external-simple
azd env set AZURE_LOCATION "westeurope" --environment external-simple
azd env set AZURE_RESOURCE_GROUP "<existing-resource-group>" --environment external-simple
azd env set AZURE_WEB_APP_NAME "<globally-unique-app-name>" --environment external-simple
azd env set CREATE_APP_SERVICE_PLAN "true" --environment external-simple
```

This creates a new B1 hosting plan when you deploy. To reuse a plan instead, set
`CREATE_APP_SERVICE_PLAN=false` and `EXISTING_APP_SERVICE_PLAN_ID` to an existing
compatible Linux plan resource ID.

## 2. Generate login configuration

```powershell
node scripts\deploy-external-password.mjs external-simple
```

The command generates a strong random password, a scrypt password hash, and a
separate session-signing secret. It sets the selected environment's login
configuration and saves the password locally to
`.azure\external-simple\access-password.txt`. It does not print the password.
Share it with intended users through an appropriate private channel.

## 3. Configure existing models

Follow [the configuration reference](configuration.md#existing-model-access) to
set `APP_AI_SETTINGS` for `external-simple`. The model resource and deployments
must exist, and credentials/identity permissions and network access must already
be ready. The deployment does not create or repair these prerequisites.

## 4. Validate, then deploy

```powershell
pwsh -NoProfile -File scripts\deploy-external.ps1 -Environment external-simple -ValidateOnly
pwsh -NoProfile -File scripts\deploy-external.ps1 -Environment external-simple
```

The deployment command runs `azd up`. You may also run
`azd up --environment external-simple` directly once configured; its
`preprovision` hook repeats prerequisite checks.

Preflight rejects changes outside the named Web App, its authentication
configuration, and the optional new hosting plan. It does not register providers,
create a resource group, provision Foundry, or grant access.

## 5. Verify before sharing

Open the Web App URL returned by azd. Confirm that:

- The app redirects to its login page before displaying application content.
- A wrong password is rejected and the generated password signs in.
- A request to `/api/tiebreak` without a session is rejected.
- A signed-in scenario reaches the configured existing models.
- Signing out removes the session; the shared password does not grant `/admin`.

The application is served over HTTPS. Sessions use Secure, HttpOnly, SameSite
cookies. Login, logout, and authenticated API mutations enforce the configured
origin.

## Updates and troubleshooting

Use the same named environment for subsequent `azd up` operations. Re-run the
password setup command and redeploy to rotate access.

If `/api/health` returns `503`, check authentication configuration. A `401` or
`403` on the model request usually requires checking the selected resource's
credentials and permissions; do not create replacement Foundry resources.
Timeouts against a private-only model endpoint require existing network
connectivity or a different pre-authorized accessible endpoint.

See [costs and removal](README.md#costs-and-removal) before deleting resources.
