# AI Architecture Pathfinder

Profile an agentic AI use case and generate a platform recommendation, architectural
layers, and exportable diagrams. The application uses Next.js, a deterministic
decision engine, and optional AI review through models you already operate.

## Azure deployment

Two authentication profiles use the same Linux App Service deployment:

| Guide | Intended use |
| --- | --- |
| [Password-protected deployment](docs/deployment/simple.md) | Controlled sharing with a generated shared password. |
| [Microsoft Entra deployment](docs/deployment/entra.md) | Named users and business guests assigned to your existing enterprise application. |
| [Configuration reference](docs/deployment/configuration.md) | Exact inputs, resource boundary, AI access, and operational limitations. |

The Bicep deployment creates one Web App and, by default, one single-instance
Linux B1 App Service plan. You can instead reference an existing compatible plan.
The resource group must already exist.

**It does not create Foundry resources, model deployments, identities, role
assignments, Entra registrations, databases, storage, Key Vault, APIM, networking,
registries, or monitoring services.** Configure existing model access before
running `azd up`; missing prerequisites stop deployment.

## Prerequisites

- Node.js 24 LTS, npm, PowerShell 7, Azure CLI with Bicep, and azd 1.32 or newer.
- An existing Azure resource group and permission to deploy App Service resources.
- `Microsoft.Web` already registered in the target subscription.
- An existing HTTPS Foundry/Azure OpenAI model-resource endpoint implementing
  `/openai/v1/chat/completions`.
- Existing chat deployments compatible with the selected AI roles and response
  format. Deployment names, not model catalog names, are required.
- A supported API key, or a pre-authorized user-assigned managed identity.
- Network connectivity from your workstation for preflight and from App Service
  for the deployed application. Private-only endpoints require existing suitable
  network integration; this minimal deployment does not create that integration.

## Local development

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Local unauthenticated mode is permitted only outside production and only on
loopback hosts. For deployed environments, `AUTH_MODE` must be `password` or
`entra`; missing or invalid settings fail closed.

## Deployment flow

1. Create a named azd environment and set all hosting, login, and model inputs.
2. Configure the selected login profile using its guide.
3. Run `scripts\deploy-external.ps1 -Environment <name> -ValidateOnly` to verify
   the prerequisites and the resource change set.
4. Run `scripts\deploy-external.ps1 -Environment <name>` to execute `azd up`.
5. Check login, rejection of unauthenticated API requests, and a model-backed
   recommendation before sharing the site.

`infra\main.bicepparam` reads the named environment values. Both profiles use
that same parameter file, avoiding independent infrastructure copies.

App Service builds the allowlisted source package on Linux using Oryx. The
package excludes local environment files, Git history, logs, and deployment
documentation. Local secrets and azd state are never deployment source.

## Costs and removal

A newly created B1 plan is billed while it exists, including when its Web App is
stopped. Existing model calls are billed separately. Reusing a plan avoids a new
plan charge but shares that plan's compute resources.

Do not use resource-group deletion or blanket `azd down` on a shared resource
group. Remove only the Web App created for this deployment and, if created
exclusively for it and no other apps use it, its dedicated App Service plan.
Never remove the referenced Foundry resources or other shared prerequisites.

## Validation status

Deployment scripts and profiles must be verified in your target subscription.
Documentation and successful source compilation are not proof of a deployed
environment or a completed Entra sign-in. No tenant-specific deployment data is
part of this distribution.
