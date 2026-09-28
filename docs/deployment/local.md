# Run and test locally

Local development creates no Azure resources. Model-backed features call your
existing deployed models and can incur normal model-usage charges.

## Everyday development

Install Node.js 24 LTS and npm, then run from the repository root:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000`. `AUTH_MODE=none` is permitted only outside production
and only for loopback requests. Do not use this mode to share the app on a
network. The initial rules-based result works with AI disabled.

## Use existing models

Before enabling AI, prepare an existing Foundry/Azure OpenAI resource endpoint
and compatible chat deployments. These are **deployment names**; a catalog model
name is not sufficient unless the deployment has the same name.

Keep this configuration in ignored `.env.local`, never in `.env.example`:

```dotenv
AUTH_MODE=none
APP_ORIGIN=http://127.0.0.1:3000
AZURE_OPENAI_ENABLED=true
PATHFINDER_LOCAL_AI_ENABLED=true
PATHFINDER_LOCAL_AI_ENDPOINT=https://your-resource.openai.azure.com/
PATHFINDER_WIZARD_DEPLOYMENT=your-wizard-deployment
PATHFINDER_ARCHITECTURE_DEPLOYMENT=your-architecture-deployment
PATHFINDER_JUDGE_DEPLOYMENT=your-review-deployment
PATHFINDER_JUDGE_REASONING_EFFORT=medium
```

For example, existing deployments of Terra for the wizard and Sol for report
composition/review can serve these roles. Configure actual deployment names;
this project does not provision them. The endpoint must be the HTTPS model
resource root, not a Foundry project URL.

For keyless local access, sign in with `az login` using an identity that already
has the resource's model data-plane role. The local model client uses
`DefaultAzureCredential`. No role assignments are created by the app.

If your existing resource permits API keys, set the key only in the launching
process instead of placing it in shell history:

```powershell
$key = Read-Host "Existing model API key" -AsSecureString
$env:AZURE_OPENAI_API_KEY = ConvertFrom-SecureString $key -AsPlainText
npm run dev -- --hostname 127.0.0.1
```

Restart the development server after changing environment configuration. Direct
local mode is intentionally ignored on a hosted production app. Hosted direct
Foundry deployments use the explicit external profile described in
[configuration.md](configuration.md).

## Reproduce the browser QA

The browser harness uses the production standalone application, HTTPS, real
password sessions, and existing model configuration from a named azd environment.
It does not provision or deploy Azure resources. It is distinct from everyday
unauthenticated development.

Configure an azd environment using the [simple profile](simple.md), without
running its deployment command. Then:

```powershell
npm run build
$env:E2E_PROJECT_ROOT = (Get-Location).Path
$env:E2E_AZD_ENV = "your-configured-environment"
$env:E2E_ARTIFACT_DIR = "<absolute-private-folder-outside-the-repository>"
node scripts\qa\serve-local.mjs
```

The helper binds only to loopback and writes an ephemeral certificate, generated
login password, model configuration, and server log to that private folder. It
does not change the system certificate store. Use `https://127.0.0.1:3217`;
manual browsers may display a self-signed certificate warning for this local
test only. Obtain the generated password from the local `local-access.json`.

In a second PowerShell window, use the same artifact directory:

```powershell
$env:E2E_ARTIFACT_DIR = "<same-private-folder-outside-the-repository>"
$env:E2E_RUN_ID = "local-review"
$env:E2E_JUDGE_DEPLOYMENT = "<existing-independent-review-deployment>"
npm run test:e2e
```

The suite uses installed Microsoft Edge, one worker, reduced-motion settings,
visible progress checkpoints, and no automatic test retries. Controlled tests
exercise timing and failures without live model calls; live scenario tests
evaluate actual model-backed recommendations, diagrams, and PowerPoint exports.
Independent judge opinions are recorded separately from observed browser facts.

Keep all QA artifacts private. Screenshots, downloaded decks, model outputs,
credentials, and traces are not publication inputs. Stop the local helper when
finished; its certificate and generated password are for local QA only.

## Timeouts and authentication refresh

The recommendation workflow has a bounded four-minute server budget, including
composition, independent review, and one repair round. The browser allows a
small response-delivery margin beyond that budget. Navigating away cancels the
request rather than starting another workflow.

Password mode never calls the Entra refresh endpoint. If an existing Entra host
is separately configured with a refresh-capable token store and permissions,
`AUTH_TOKEN_REFRESH_ENABLED=true` explicitly enables that optional behavior.
The minimal deployment profiles do not enable it.
