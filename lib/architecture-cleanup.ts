import type { ArchitectureDecision, ArchitectureLayer, DecisionInput } from "./types";
import {
  hasConfirmedExternalSurface,
  needsPublicEdgeControls,
  hasPrivateConnectivityRequirement,
  hasFabricSource,
  hasExternalUser,
  hasInternalUser,
  hasOperationalStructuredSource,
  isActionable,
  requiresOrchestration,
  selectedSecurityNames,
  hasImpactfulModelStrategy,
  wantsAzureMachineLearning,
  wantsFoundryLifecycle,
  wantsFoundryModelOps,
  wantsHybridOverlay
} from "./rules";

const NOT_REQUIRED = "Not required for this use case";

function sentenceParts(reason: string) {
  return reason
    .split(/(?<=[.!?])\s+|\s+(?=[A-Z][a-z]+:)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function uniqueClean(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

export function includesText(values: string[], match: RegExp): boolean {
  return values.some((value) => match.test(value));
}

export function normalizeReason(reason: string, layerName: string): string {
  const generic = /not part|not required|only if needed|selected by the user|explicit/i;
  const parts = uniqueClean(sentenceParts(reason)).filter(Boolean);
  const specific = parts.filter((part) => !generic.test(part));
  const chosen = (specific.length ? specific : parts).slice(0, 2);
  if (chosen.length) return chosen.join(" ");
  return `${layerName} selections are normalized for this architecture.`;
}

export function normalizeArchitectureDecision(
  decision: ArchitectureDecision,
  input?: DecisionInput
): ArchitectureDecision {
  const layers = normalizeArchitectureLayers(decision.architectureLayers, input, decision);
  const security = layers.find((layer) => layer.layer === "Security")?.selections ?? [];
  const safeguards = recommendedSafeguards(decision, input);
  const selectedNotRequired = selectedSecurityNotRequired(security, input);
  const optionalAddOns = uniqueClean([
    ...decision.optionalAddOns,
    ...(safeguards.length ? [`Recommended safeguards: ${safeguards.join("; ")}`] : []),
    ...(selectedNotRequired.length ? [`Selected but not required for the current architecture: ${selectedNotRequired.join("; ")}`] : [])
  ]);
  return {
    ...decision,
    recommendedStack: normalizeStack(decision.recommendedStack, input, decision),
    optionalAddOns,
    blockedComponents: normalizeBlockedComponents(decision.blockedComponents, input, decision),
    zeroTrust: {
      ...decision.zeroTrust,
      rationale: decision.zeroTrust.applicable
        ? "Recommended safeguards for external, private, sensitive, or action-taking workloads. Required controls are listed separately."
        : decision.zeroTrust.rationale,
      controls: safeguards
    },
    architectureLayers: layers,
    securityControls: security,
    rationale: uniqueClean(decision.rationale).slice(0, 10)
  };
}

function normalizeBlockedComponents(
  blocked: string[],
  input?: DecisionInput,
  decision?: ArchitectureDecision
): string[] {
  const architectureText = [
    ...(decision?.recommendedStack ?? []),
    ...(decision?.architectureLayers.flatMap((layer) => layer.selections) ?? [])
  ].join("\n");
  const alternativeTechnology = /Azure AI Search|Azure OpenAI|Azure AI Foundry|Custom backend|M365 Agents SDK|Agent Framework|Fabric Data Agent/i;
  return uniqueClean(blocked).filter((item) => {
    if (isInternalCopilotNativeKnowledge(input, decision)) return false;
    if (alternativeTechnology.test(item) && !new RegExp(item.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(architectureText)) {
      return false;
    }
    if (/Azure AI Search/i.test(item) && !/Azure AI Search/i.test(architectureText)) return false;
    if (/Azure OpenAI/i.test(item) && !/Azure OpenAI/i.test(architectureText)) return false;
    if (/Azure AI Foundry/i.test(item) && !/Azure AI Foundry/i.test(architectureText)) return false;
    return true;
  });
}

export function normalizeArchitectureLayers(
  layers: ArchitectureLayer[],
  input?: DecisionInput,
  decision?: ArchitectureDecision
): ArchitectureLayer[] {
  return layers.map((layer) => normalizeLayerSelections(layer, input, decision));
}

export function normalizeLayerSelections(
  layer: ArchitectureLayer,
  input?: DecisionInput,
  decision?: ArchitectureDecision
): ArchitectureLayer {
  const selections = uniqueClean(layer.selections).filter((value) => value !== NOT_REQUIRED);
  let next: string[];
  switch (layer.layer) {
    case "Knowledge/Data":
      next = normalizeKnowledge(selections, input);
      break;
    case "Identity":
      next = normalizeIdentity(selections, input);
      break;
    case "AI Platform":
      next = normalizeAiPlatform(selections, input, decision);
      break;
    case "Analytics/Grounding":
      next = normalizeAnalyticsGrounding(selections, input, decision);
      break;
    case "Integration":
      next = normalizeIntegration(selections, input);
      break;
    case "Security":
      next = normalizeSecurity(selections, input, decision);
      break;
    case "Observability":
      next = normalizeObservability(selections, input, decision);
      break;
    case "Network/Deployment":
      next = normalizeNetwork(selections, input, decision);
      break;
    default:
      next = removeGenericPlaceholders(selections);
      break;
  }
  return {
    ...layer,
    selections: next.length ? next : [NOT_REQUIRED],
    required: (layer.required || (layer.layer === "Observability" && !!input?.securityControls.includes("audit"))) && next.length > 0,
    reason: normalizeReason(layer.reason, layer.layer)
  };
}

function removeGenericPlaceholders(values: string[]) {
  const hasSpecific = values.length > 1;
  return values.filter((value) => {
    if (!hasSpecific) return true;
    return !/selected channel|selected identity provider|selected data source|business APIs \/ data stores|documents \/ blob \/ sharepoint|—/i.test(value);
  });
}

function normalizeKnowledge(values: string[], input?: DecisionInput) {
  const hasDocuments = includesText(values, /documents|pdf|uploaded/i) || input?.dataSources.includes("documents");
  const hasBlob = includesText(values, /blob/i) || input?.dataSources.includes("blob_storage");
  const hasSharePoint = input?.dataSources.includes("sharepoint") || false;
  const out: string[] = [];
  if (hasDocuments && hasBlob) out.push("Documents / PDFs in Blob Storage");
  else if (hasDocuments) out.push("Documents / PDFs");
  else if (hasBlob) out.push("Blob Storage");
  if (hasSharePoint) out.push("SharePoint");
  for (const value of values) {
    if (/documents \/ blob \/ sharepoint|business APIs \/ ERP \/ CRM \/ SQL \/ Dataverse/i.test(value)) continue;
    if (/documents|pdf|uploaded|blob|sharepoint/i.test(value)) continue;
    if (/microsoft graph|m365 content|microsoft 365 content/i.test(value)) {
      out.push("Microsoft Graph / Microsoft 365 content");
      continue;
    }
    if (/ERP \/ CRM$/i.test(value)) out.push("ERP / CRM systems");
    else if (/business APIs \/ data stores/i.test(value)) continue;
    else out.push(value);
  }
  return uniqueClean(out);
}

function isExternalOrCustomBackendPath(input?: DecisionInput, decision?: ArchitectureDecision) {
  return !!(
    input &&
    (hasConfirmedExternalSurface(input) ||
      input.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
      input.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
      decision?.basePatternId === "external_ai_app" ||
      decision?.basePatternId === "custom_ai_app")
  );
}

function normalizeAnalyticsGrounding(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  const out: string[] = [];
  if (includesText(values, /azure ai search/i) && (decision?.basePatternId === "document_rag_agent" || decision?.overlays.some((overlay) => /document_rag/i.test(overlay.id)))) {
    out.push("Azure AI Search (vector / hybrid)");
  }
  if (includesText(values, /fabric data agent/i)) {
    out.push("Microsoft Fabric Data Agent");
    if (includesText(values, /tool connected to azure ai foundry agent service/i)) {
      out.push("Fabric Data Agent tool connected to Azure AI Foundry Agent Service");
    }
  }
  for (const value of values) {
    if (/not required|no fabric analytics|governed fabric analytical access|fabric lakehouse|fabric warehouse|azure ai search|fabric data agent/i.test(value)) continue;
    out.push(value);
  }
  return uniqueClean(out);
}

function normalizeIdentity(values: string[], input?: DecisionInput) {
  const out: string[] = [];
  const teamsNeedsInternalIdentity = input
    ? input.channels.some((c) => ["teams", "m365", "m365_copilot"].includes(c)) &&
      (!hasExternalUser(input) || hasInternalUser(input))
    : false;
  if (includesText(values, /entra id/i) || input?.users.some((u) => ["internal_employees", "admins", "developers"].includes(u)) || teamsNeedsInternalIdentity) {
    out.push("Entra ID");
  }
  if (input && hasConfirmedExternalSurface(input)) out.push("Entra External ID");
  return uniqueClean(out.length ? out : values.filter((value) => !/entra external/i.test(value)));
}

function isInternalCopilotNativeKnowledge(input?: DecisionInput, decision?: ArchitectureDecision) {
  if (!input || !decision) return false;
  return (
    decision.basePatternId === "copilot_studio_internal_assistant" &&
    !hasConfirmedExternalSurface(input) &&
    !isActionable(input) &&
    !input.runtimePreferences.includes("custom_backend") &&
    !input.runtimePreferences.includes("foundry_agent_service") &&
    !hasOperationalStructuredSource(input) &&
    !input.dataSources.includes("on_prem")
  );
}

function isCopilotStudioManagedExperience(decision?: ArchitectureDecision) {
  return !!decision?.architectureLayers.some(
    (layer) => layer.layer === "Experience" && includesText(layer.selections, /copilot studio/i)
  );
}

function hasDocumentRagOverlay(decision?: ArchitectureDecision) {
  return !!decision?.overlays.some((overlay) => /document_rag/i.test(overlay.id) || /document rag/i.test(overlay.name));
}

/**
 * A managed Copilot Studio experience with NO genuine Azure AI Foundry / custom compute
 * behind it. For these, "monitoring / governance" lifecycle controls map to Copilot Studio
 * analytics + Application Insights (+ Purview) — NOT Azure AI Foundry evaluation/tracing or
 * customer-run model operations. Residency-only needs use tenant governance; explicit
 * private connectivity is evaluated separately. This keeps the displayed solution family
 * "Copilot Studio" instead of upgrading it
 * to "Hybrid" purely because monitoring was requested.
 */
function isManagedCopilotStudioOnly(input?: DecisionInput, decision?: ArchitectureDecision) {
  if (!input || !decision) return false;
  if (!isCopilotStudioManagedExperience(decision)) return false;
  if (["azure_ai_foundry_app", "document_rag_agent", "external_ai_app", "custom_ai_app"].includes(decision.basePatternId)) return false;
  if (hasDocumentRagOverlay(decision)) return false;
  if (decision.overlays.some((overlay) => /model_customization|azure_ml/i.test(overlay.id))) return false;
  if (hasImpactfulModelStrategy(input) || wantsFoundryModelOps(input)) return false;
  if (input.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r))) return false;
  return true;
}

function suppressBaselineModels(input?: DecisionInput, decision?: ArchitectureDecision) {
  return !!(
    input &&
    decision &&
    isCopilotStudioManagedExperience(decision) &&
    !hasImpactfulModelStrategy(input) &&
    !hasDocumentRagOverlay(decision) &&
    !decision.overlays.some((overlay) => /model_customization|azure_ml/i.test(overlay.id))
  );
}

function hasFoundry(decision?: ArchitectureDecision, input?: DecisionInput) {
  return !!(
    decision?.overlays.some((overlay) => /foundry/i.test(overlay.id) || /foundry/i.test(overlay.name)) ||
    decision?.overlays.some((overlay) => /model_customization/i.test(overlay.id)) ||
    decision?.recommendedStack.some((item) => /foundry agent service|foundry model|model catalog/i.test(item)) ||
    input && (wantsFoundryLifecycle(input) || wantsFoundryModelOps(input))
  );
}

function normalizeAiPlatform(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  const out: string[] = [];
  const suppressBaseline = suppressBaselineModels(input, decision);
  const managedCopilotOnly = isManagedCopilotStudioOnly(input, decision);
  const hasCopilotStudio = includesText(values, /copilot studio/i) ||
    !!decision?.architectureLayers.some((layer) => layer.layer === "Experience" && includesText(layer.selections, /copilot studio/i));
  const hasOpenAi = !suppressBaseline &&
    (includesText(values, /azure openai/i) || !!decision?.recommendedStack.some((item) => /azure openai/i.test(item)));
  if (hasCopilotStudio) out.push("Copilot Studio managed AI experience");
  if (hasOpenAi) {
    out.push("Azure AI Foundry / Foundry Models");
    out.push("Azure OpenAI model deployment in Azure AI Foundry");
  }
  if (includesText(values, /multi-model|multiple model/i) || !!decision?.recommendedStack.some((item) => /multi-model|multiple model/i.test(item))) {
    out.push("Multi-model routing / task-to-model selection");
  }
  if (!suppressBaseline && (includesText(values, /azure openai model deployment/i) || input?.modelStrategy?.includes("azure_openai"))) {
    out.push("Azure OpenAI model deployment in Azure AI Foundry");
  }
  if (includesText(values, /foundry model catalog|catalog \/ open model|azure-sold foundry|provider\/open model|meta|mistral|cohere|nvidia|hugging face/i) || input?.modelStrategy?.includes("foundry_model_catalog")) {
    out.push("Azure OpenAI, Azure-sold Foundry, or provider/open model");
  }
  if (includesText(values, /claude|anthropic|opus/i) || input?.modelStrategy?.includes("anthropic_claude")) {
    out.push("Claude / Anthropic model selected through Azure AI Foundry");
  }
  if (includesText(values, /grok|xai|xai/i) || input?.modelStrategy?.includes("xai_grok")) {
    out.push("Grok / xAI model selected through Azure AI Foundry or governed endpoint");
  }
  if (includesText(values, /fine-tuned azure openai/i) || input?.modelStrategy?.includes("fine_tuned_azure_openai")) {
    out.push("Fine-tuned Azure OpenAI model in Azure AI Foundry");
  }
  if (includesText(values, /fine-tuned model in azure ai foundry|fine-tuned model in foundry/i) || input?.modelStrategy?.includes("fine_tuned_foundry_model")) {
    out.push("Fine-tuned model in Azure AI Foundry managed compute");
  }
  if (includesText(values, /bring-your-own|bring your own|byo/i) || input?.modelStrategy?.includes("bring_your_own_model")) {
    out.push("Bring-your-own model hosted via Foundry managed compute or Azure Machine Learning");
  }
  if (includesText(values, /azure machine learning workspace|model registry/i) || input?.modelStrategy?.includes("azure_ml_custom_model")) {
    out.push("Azure Machine Learning workspace / model registry");
  }
  if (includesText(values, /azure machine learning managed online endpoint|managed online endpoint/i) || input?.modelStrategy?.includes("azure_ml_endpoint")) {
    out.push("Azure Machine Learning managed online endpoint");
  }
  if (
    includesText(values, /model catalog|claude|anthropic|opus|grok|xai|fine-tuned|custom model|model deployment/i) ||
    !!decision?.recommendedStack.some((item) => /model catalog|claude|anthropic|opus|grok|xai|fine-tuned|custom model|model deployment/i.test(item)) ||
    (input && wantsFoundryModelOps(input))
  ) {
    out.push("Azure AI Foundry model operations");
  }
  if (
    includesText(values, /azure machine learning|managed online endpoint|model registry/i) ||
    !!decision?.recommendedStack.some((item) => /azure machine learning|managed online endpoint|model registry/i.test(item)) ||
    (input && wantsAzureMachineLearning(input))
  ) {
    out.push("Azure Machine Learning model registry / managed endpoint");
  }
  if (!managedCopilotOnly && hasFoundry(decision, input) && (input ? wantsFoundryLifecycle(input) : includesText(values, /evaluation|tracing|monitoring|governance/i))) {
    out.push("Azure AI Foundry / Foundry Models");
  }
  for (const value of values) {
    if (/copilot studio|azure openai|azure ai foundry|foundry models|foundry evaluation|foundry lifecycle|multi-model|multiple model|standard foundation|model catalog|claude|anthropic|opus|grok|xai|fine-tuned|custom model|model deployment|azure machine learning|managed online endpoint|model registry|bring-your-own|bring your own/i.test(value)) continue;
    out.push(value);
  }
  // Managed Copilot Studio uses the built-in managed model; do not present customer-run
  // Azure AI Foundry model operations / Foundry Models / Azure OpenAI deployments as
  // required components — the managed experience already covers them.
  if (managedCopilotOnly) {
    return uniqueClean(
      out.filter((s) => !/azure ai foundry model operations|azure ai foundry \/ foundry models|azure openai model deployment in azure ai foundry|azure machine learning model registry/i.test(s))
    );
  }
  return uniqueClean(out);
}

function normalizeIntegration(values: string[], input?: DecisionInput) {
  const out: string[] = [];
  const apimRelevant = !!(
    includesText(values, /apim|api management/i) ||
    (input?.securityControls.includes("apim") &&
      (hasConfirmedExternalSurface(input) ||
        input.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
        input.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
        hasOperationalStructuredSource(input) ||
        isActionable(input)))
  );
  if (apimRelevant) {
    out.push("API Management (APIM)");
  }
  if (includesText(values, /copilot studio action|validated action|action \/ tool/i)) {
    out.push("Copilot Studio action / tool");
  }
  if (includesText(values, /power automate cloud flow/i)) {
    out.push("Power Automate cloud flow");
  }
  if (includesText(values, /approvals connector|power automate approvals/i)) {
    out.push("Power Automate Approvals connector");
  }
  if (includesText(values, /sql server connector|azure sql connector/i)) {
    out.push("Power Automate SQL Server connector for Azure SQL / SQL Server");
  }
  if (includesText(values, /sql server connector|azure sql connector/i) && includesText(values, /parameterized stored procedure|approved sql connector operation/i) && input && isActionable(input)) {
    out.push("Parameterized stored procedure or approved SQL connector operation");
  }
  if (includesText(values, /power platform connector/i) && !includesText(out, /SQL Server connector/i)) {
    out.push("Power Platform connector / approved connector operation");
  }
  if (includesText(values, /parameterized stored procedures|controlled backend APIs|approved connector operations/i) && input && isActionable(input)) {
    out.push("Controlled Azure SQL write path: parameterized stored procedures, approved connector operations, or backend APIs");
  }
  if (includesText(values, /document ingestion|indexing pipeline/i)) out.push("Document ingestion/indexing pipeline");
  if (includesText(values, /azure ai search index/i)) out.push("Azure AI Search index");
  if (includesText(values, /model deployment endpoint/i)) out.push("Model deployment endpoint");
  if (includesText(values, /azure machine learning managed online endpoint/i)) out.push("Azure Machine Learning managed online endpoint");
  for (const value of values) {
    if (/apim|api management|backend api abstraction for fabric|copilot studio action|action \/ tool|power automate cloud flow|approvals connector|power automate approvals|sql server connector|azure sql connector|parameterized stored procedure|approved sql connector operation|power platform connector|approved connector operation|parameterized stored procedures|controlled backend APIs|approved connector operations|document ingestion|indexing pipeline|azure ai search index|model deployment endpoint|azure machine learning managed online endpoint|documents \/ blob \/ sharepoint|business APIs \/ data stores/i.test(value)) continue;
    out.push(value);
  }
  return uniqueClean(out);
}

function normalizeSecurity(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  const out: string[] = [];
  const has = (pattern: RegExp) => includesText(values, pattern);
  const confirmedExternal = !!(input && hasConfirmedExternalSurface(input));
  const customBackendRuntime = !!decision?.architectureLayers.some(
    (layer) => layer.layer === "Runtime/Backend" && includesText(layer.selections, /custom backend|azure functions|app service|container apps|aks|foundry agent service/i)
  );
  const customOrApi = !!(
    decision?.basePatternId === "external_ai_app" ||
    decision?.basePatternId === "custom_ai_app" ||
    input?.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
    input?.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
    (input && hasOperationalStructuredSource(input)) ||
    input?.dataSources.includes("on_prem") ||
    (input && isActionable(input))
  );
  const backendOrExternal = confirmedExternal || customBackendRuntime || !!(input && wantsHybridOverlay(input));
  if (input && isActionable(input)) out.push("Audit logging for every write/action");
  else if (input?.securityControls.includes("audit")) out.push("Audit logging");
  if (input?.securityControls.includes("dlp")) out.push("DLP policies");
  if (input?.securityControls.includes("purview")) out.push("Microsoft Purview");
  if (isInternalCopilotNativeKnowledge(input, decision)) {
    out.push("Entra ID");
    if (input?.dataSources.includes("m365_graph")) out.push("M365 permissions");
    if (input?.dataSources.some((d) => ["sharepoint", "documents"].includes(d)) || has(/repository\/source/i)) out.push("Repository/source permissions");
    if (input?.securityControls.includes("rbac")) out.push("RBAC / authorization checks");
    return uniqueClean(out);
  }
  if ((has(/entra external/i) || input?.securityControls.includes("entra_external_id")) && confirmedExternal) out.push("Entra External ID");
  if (has(/entra id|conditional access/i) || input?.securityControls.includes("entra_id")) out.push("Entra ID");
  if (has(/rbac|authorization/i) || input?.securityControls.includes("rbac")) out.push("RBAC / authorization checks");
  if ((has(/apim|api management/i) || input?.securityControls.includes("apim")) && (confirmedExternal || customOrApi)) out.push("API Management (APIM)");
  if (has(/power platform connection|connector permissions/i)) out.push("Power Platform connection references / connector permissions");
  if (input?.securityControls.includes("managed_identity") || (has(/managed identity/i) && backendOrExternal)) out.push("Managed Identity");
  if (input?.securityControls.includes("key_vault") || (has(/key vault/i) && backendOrExternal)) out.push("Key Vault");
  if (has(/least-privilege sql/i)) out.push("Least-privilege SQL permissions");
  if (has(/least-privilege system-of-record/i)) out.push("Least-privilege system-of-record permissions");
  if (has(/read-only connector\/action\/api permissions/i)) out.push("Read-only connector/action/API permissions");
  if (has(/repository\/source/i)) out.push("Repository/source permissions");
  if (has(/m365 permissions/i)) out.push("M365 permissions");
  if (has(/fabric \/ power bi permissions/i)) out.push("Fabric / Power BI permissions");
  if (input && hasFabricSource(input) && isExternalOrCustomBackendPath(input, decision)) out.push("Fabric / Power BI permissions");
  if (has(/Power BI Semantic Model: Read permission required/i)) out.push("Power BI Semantic Model: Read permission required");
  if (has(/workspace \/ item|workspace\/item/i)) out.push("Workspace / item permissions");
  if (has(/RLS \/ OLS|row-level|object-level/i)) out.push("RLS / OLS if applicable");
  if (has(/semantic model readiness|prep for ai/i)) out.push("Semantic model readiness / Prep for AI");
  if ((has(/waf|front door/i) || input?.securityControls.includes("waf")) && input && needsPublicEdgeControls(input) && customOrApi) out.push("Front Door / WAF");
  if (has(/defender/i) && input?.securityControls.includes("defender")) out.push("Microsoft Defender for Cloud");
  return uniqueClean(out);
}

function recommendedSafeguards(decision: ArchitectureDecision, input?: DecisionInput) {
  const values = decision.zeroTrust.controls;
  const out: string[] = [];
  if (includesText(values, /conditional access/i)) out.push("Conditional Access");
  if (includesText(values, /defender/i) && !input?.securityControls.includes("defender")) out.push("Defender for Cloud");
  if (includesText(values, /siem|immutable audit/i)) out.push("SIEM integration and immutable audit trail for high-impact actions");
  if (includesText(values, /human-in-the-loop/i) && input && isActionable(input)) out.push("Human-in-the-loop approval for high-impact actions");
  if (includesText(values, /content safety|prompt-shield/i)) out.push("Azure AI Content Safety / Prompt Shield");
  if (includesText(values, /output grounding/i)) out.push("Output grounding policy");
  return uniqueClean(out);
}

function selectedSecurityNotRequired(requiredSecurity: string[], input?: DecisionInput) {
  if (!input) return [];
  const required = requiredSecurity.join("\n");
  return selectedSecurityNames(input).filter((selected) => {
    if (!selected) return false;
    if (/Azure RBAC/i.test(selected) && /RBAC \/ authorization checks/i.test(required)) return false;
    if (/Audit logging/i.test(selected) && /Audit logging for every write\/action/i.test(required)) return false;
    return !new RegExp(selected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(required);
  });
}

function normalizeObservability(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  const out: string[] = [];
  const managedCopilotOnly = isManagedCopilotStudioOnly(input, decision);
  if (input && isActionable(input)) out.push("Application Insights + audit logging");
  else if (includesText(values, /app insights|application insights|log analytics/i)) out.push("Application Insights");
  if (input?.securityControls.includes("audit") && !isActionable(input)) out.push("Audit logging");
  if (!managedCopilotOnly && ((input && wantsFoundryLifecycle(input)) || includesText(values, /foundry evaluation|foundry tracing|foundry monitoring|azure ai foundry/i))) {
    out.push("Azure AI Foundry evaluation / tracing / monitoring");
  }
  if (includesText(values, /azure machine learning endpoint monitoring/i) || (input && wantsAzureMachineLearning(input))) {
    out.push("Azure Machine Learning endpoint monitoring");
  }
  // Managed Copilot Studio uses its own analytics + Application Insights for monitoring
  // (it does not use Azure AI Foundry evaluation/tracing).
  if (managedCopilotOnly && input && (input.lifecycleControls.includes("monitoring") || input.lifecycleControls.includes("tracing")) && !out.some((s) => /application insights/i.test(s))) {
    out.push("Application Insights");
  }
  if (includesText(values, /copilot studio analytics/i) || managedCopilotOnly) out.push("Copilot Studio analytics");
  return uniqueClean(out);
}

function normalizeNetwork(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  // SaaS residency controls cannot replace explicitly required private data access.
  const managedCopilotOnly = isManagedCopilotStudioOnly(input, decision);
  if (managedCopilotOnly && input && !hasPrivateConnectivityRequirement(input)) {
    const residency = !!input?.networkControls.some((n) => ["data_residency", "regulated"].includes(n));
    return residency ? ["SaaS — Microsoft-managed", "Tenant region / data residency"] : ["SaaS — Microsoft-managed"];
  }
  const hybrid = !!(input && wantsHybridOverlay(input)) || !!decision?.overlays.some((overlay) => /hybrid|private/i.test(overlay.id));
  if (!hybrid) {
    if (isInternalCopilotNativeKnowledge(input, decision)) {
      return ["SaaS — Microsoft-managed"];
    }
    if (input?.networkControls.includes("public") || includesText(values, /public|saas/i)) {
      const publicEdge =
        !!(input && hasConfirmedExternalSurface(input)) ||
        !!input?.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
        !!input?.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
        !!decision?.architectureLayers.some((layer) => layer.layer === "Security" && includesText(layer.selections, /apim|waf|front door/i));
      return publicEdge
        ? ["Public endpoint protected by identity, authorization, and APIM/WAF where applicable"]
        : ["SaaS — Microsoft-managed"];
    }
    return removeGenericPlaceholders(values);
  }
  const out: string[] = [];
  if (managedCopilotOnly) {
    out.push("SaaS - Microsoft-managed", "Power Platform VNet support for supported outbound connectors");
  }
  if (input?.networkControls.includes("vnet") || includesText(values, /vnet/i)) out.push("VNet integration");
  if (input?.networkControls.includes("private_link") || input?.networkControls.includes("private_endpoint") || includesText(values, /private link|private endpoint/i)) out.push("Private Link / Private Endpoint");
  if (includesText(values, /private dns/i)) out.push("Private DNS");
  if (input?.networkControls.includes("vpn") || input?.networkControls.includes("expressroute") || input?.networkControls.includes("on_prem_connectivity") || includesText(values, /vpn|expressroute/i)) out.push("VPN / ExpressRoute");
  if (input?.networkControls.includes("no_public_endpoint")) out.push("No public endpoint");
  if (input?.networkControls.includes("data_residency") || input?.networkControls.includes("regulated") || includesText(values, /residency|regulated|sovereign/i)) out.push("Data residency / regulated controls");
  return uniqueClean(out);
}

function normalizeStack(values: string[], input?: DecisionInput, decision?: ArchitectureDecision) {
  const out = uniqueClean(values).map((value) => {
    if (/Azure OpenAI deployments|Azure OpenAI \(reasoning support only\)|^Azure OpenAI$/i.test(value)) return "Azure OpenAI model deployment in Azure AI Foundry";
    if (/Azure AI Foundry \(evaluation, tracing, monitoring, governance\)|Azure AI Foundry$/i.test(value)) return "Azure AI Foundry / Foundry Models";
    if (/Azure AI Foundry model catalog \/ model deployment|Azure OpenAI, Azure-sold Foundry, or provider\/open model|Claude|Anthropic|Grok|xAI|fine-tuned|custom model/i.test(value)) return value;
    if (/APIM$/i.test(value)) return "API Management (APIM)";
    return value;
  });
  const withoutActionArtifacts = input && !isActionable(input)
    ? out.filter((item) =>
      !/controlled azure sql write path|parameterized stored procedures|approved connector|audit logging for every write\/action/i.test(item) &&
      (requiresOrchestration(input) || !/deterministic execution layer|durable functions|logic apps/i.test(item)) &&
      (input.securityControls.includes("audit") || !/^audit logging$/i.test(item)))
    : out;
  const withoutBaselineModels = suppressBaselineModels(input, decision)
    ? withoutActionArtifacts.filter((item) => !/Azure OpenAI|Standard foundation model|Azure OpenAI model deployment/i.test(item))
    : withoutActionArtifacts;
  return normalizeAiPlatform(withoutBaselineModels, input, decision).some((item) => item.includes("Azure AI Foundry"))
    ? uniqueClean(withoutBaselineModels)
    : uniqueClean(withoutBaselineModels.filter((item) => !/^Azure AI Foundry(?! Agent Service)/i.test(item)));
}
