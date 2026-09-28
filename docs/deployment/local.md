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
network. With AI disabled the wizard still collects a profile, but the
Recommendation page requires AI and does not show a deterministic substitute.

## Use existing models

Before enabling AI, prepare an existing Foundry/Azure OpenAI resource endpoint
and compatible chat deployments. These are **deployment names**; a catalog model
name is not sufficient unless the deployment has the same name.
The existing Sol architect deployment must support `xhigh` reasoning and strict
`json_schema` structured outputs on Chat Completions v1. A reviewer is optional;
if configured it must support strict structured outputs and its configured
effort (default `medium`). The wizard uses low reasoning and JSON-object mode.
Unsupported settings produce an explicit provider error, not a silent fallback.

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

Existing deployments of Terra for the wizard and Sol for report composition
serve these roles. The optional reviewer may share the Sol deployment. Configure actual deployment names;
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

Generation makes one Sol call at maximum supported reasoning (`xhigh`). One
format-repair attempt is permitted if bounds or graph references are invalid.
Each generation call has a five-minute limit; the complete generation budget
is ten minutes including that possible repair, plus ten seconds for delivery.
These are ceilings, not predicted durations. Optional review is a separate
single-call operation with a 90-second limit and ten seconds of delivery grace.
Navigating away cancels the active request.

The original Recommendation layout stays in place. During initial generation a
dimmed, non-interactive rules-based preview is explicitly marked preliminary.
Generation and optional-review stages come from real server events; the elapsed
timer is not a completion percentage. Review is never shown as running unless
the user requested it. Motion can be
paused and respects reduced-motion preferences. The page replaces the preview
entirely with the accepted AI artifact; it never exports the preview.

The AI owns the final recommendation and explicit diagram graph. A failed
generation displays a reason and a retry action; no rules-based recommendation
is presented as a successful result. An initial failure removes the preview.
A failed refinement preserves the previous AI report. JSON-mode model
requests include an explicit JSON instruction, including independent review.
Optional review attaches approval or specific issues to the current report.
It never rewrites or discards that report. **Apply review feedback** is a separate
user action that generates a new, unreviewed revision. Provider failures during
review preserve the existing architecture. Unreviewed results remain exportable
and are never labelled review-approved.
The native output schema and renderer share the supported layer names;
security/governance components are valid diagram nodes.

Password mode never calls the Entra refresh endpoint. If an existing Entra host
is separately configured with a refresh-capable token store and permissions,
`AUTH_TOKEN_REFRESH_ENABLED=true` explicitly enables that optional behavior.
The minimal deployment profiles do not enable it.
