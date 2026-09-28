import type { ArchitectureDecision, ArchitectureLayer, DecisionInput } from "./types";
import { displayPatternName } from "./pathfinder-category";
import { hasFabricSource, hasImpactfulModelStrategy, isActionable, requiresOrchestration } from "./rules";

const labelMaps = {
  users: {
    internal_employees: "internal employees",
    external_customers: "external customers",
    citizens: "citizens",
    partners: "partners",
    admins: "admins",
    developers: "developers",
    mixed: "mixed users",
    unknown: "users"
  },
  channels: {
    m365_copilot: "Microsoft 365 Copilot",
    teams: "Teams",
    m365: "Microsoft 365",
    web: "web app",
    mobile: "mobile app",
    portal: "portal",
    api: "API",
    embedded: "embedded experience",
    multiple: "multiple channels",
    unknown: "selected channel"
  },
  dataSources: {
    m365_graph: "Microsoft Graph",
    sharepoint: "SharePoint",
    fabric_onelake: "Fabric OneLake",
    fabric_lakehouse: "Fabric Lakehouse",
    fabric_warehouse: "Fabric Warehouse",
    powerbi_semantic_model: "Power BI Semantic Model",
    kql_eventhouse: "KQL / Eventhouse",
    documents: "documents / PDFs",
    blob_storage: "Blob Storage",
    azure_sql: "Azure SQL",
    dataverse: "Dataverse",
    apis: "business APIs",
    erp_crm: "ERP / CRM",
    on_prem: "on-premises systems",
    internet: "internet/public sources",
    unknown: "selected data sources"
  },
  behaviors: {
    qa: "Q&A",
    analytics: "analytics",
    retrieval: "retrieval",
    read_only_query: "read-only queries",
    summarization: "summarization",
    recommendation: "recommendations",
    record_update: "record updates",
    workflow: "workflow execution",
    approval: "approvals",
    transaction: "transactions",
    long_running_process: "long-running processes",
    multi_agent: "multi-agent orchestration",
    unknown: "selected behavior"
  },
  modelStrategy: {
    foundry_model_catalog: "Azure OpenAI, Azure-sold Foundry, or provider/open models such as Meta, Mistral, Grok/xAI, Anthropic, Cohere, NVIDIA, or Hugging Face",
    anthropic_claude: "a Claude / Anthropic model such as Opus through Azure AI Foundry",
    xai_grok: "a Grok / xAI model through Azure AI Foundry or a governed endpoint",
    fine_tuned_azure_openai: "a fine-tuned Azure OpenAI model in Azure AI Foundry",
    fine_tuned_foundry_model: "a fine-tuned model in Azure AI Foundry",
    azure_ml_custom_model: "a custom ML model trained in Azure Machine Learning",
    azure_ml_endpoint: "an Azure Machine Learning managed online endpoint",
    bring_your_own_model: "a bring-your-own-model deployment",
    unknown: "an undecided model strategy"
  }
} as const;

function labels<T extends string>(items: T[], map: Record<string, string>, fallback: string) {
  const out = items.filter((i) => i !== "unknown").map((i) => map[i] || i);
  return out.length ? out.join(", ") : fallback;
}

function layerSelections(decision: ArchitectureDecision, layer: ArchitectureLayer["layer"]) {
  return (
    decision.architectureLayers
      .find((l) => l.layer === layer)
      ?.selections.filter((s) => s && !/^(?:not required|none selected|no separate)\b/i.test(s.trim())) ?? []
  );
}

function top(items: string[], fallback: string, max = 4) {
  const clean = Array.from(new Set(items)).slice(0, max);
  return clean.length ? clean.join(", ") : fallback;
}

function hasOverlay(decision: ArchitectureDecision, pattern: RegExp) {
  return decision.overlays.some((overlay) => pattern.test(overlay.id) || pattern.test(overlay.name));
}

function hasLayerSelection(decision: ArchitectureDecision, layer: ArchitectureLayer["layer"], pattern: RegExp) {
  return layerSelections(decision, layer).some((selection) => pattern.test(selection));
}

function paragraph(parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function solutionArticle(solutionType: string) {
  return /^[aeiou]/i.test(solutionType.trim()) ? "an" : "a";
}

function recommendedSolutionLead(solutionType: string) {
  return `The recommended solution is ${solutionArticle(solutionType)} ${solutionType} architecture`;
}

function azureSubscriptionNarrative(solutionType: string) {
  if (/^Microsoft 365 Copilot$/i.test(solutionType)) {
    return "Microsoft 365 Copilot runs in the organization's Microsoft 365 tenant and uses the existing Microsoft Graph, identity, and content-permission boundaries; no separate application runtime or Azure landing zone is required for this native productivity experience.";
  }
  if (/^Copilot Studio$/i.test(solutionType)) {
    return "Copilot Studio and Microsoft 365 experiences run in the organization's tenant / Power Platform environment; any supporting Azure services are placed in the organization's Azure subscription or landing zone with standard resource-group, identity, networking, monitoring, and cost-governance controls.";
  }
  if (/Hybrid/i.test(solutionType)) {
    return "The Copilot Studio experience runs in the organization's tenant / Power Platform environment, while Foundry/model, API, data-access, monitoring, and runtime components are deployed in the organization's Azure subscription or landing zone.";
  }
  return "The Azure runtime, AI/model, grounding, integration, security, and observability resources are deployed in the organization's Azure subscription or landing zone, separated into governed resource groups or environments that follow platform standards.";
}

function componentNarrative(parts: {
  experience: string;
  runtime: string;
  aiPlatform: string;
  grounding: string;
  integration: string;
  dataSources: string;
}) {
  return `The main components are ${parts.experience} for the user experience, ${parts.runtime} for runtime/backend execution, ${parts.aiPlatform} for model reasoning, ${parts.grounding} for grounding or retrieval, ${parts.integration} for governed access, and ${parts.dataSources} as the data/knowledge layer.`;
}

const internalGuardrailSummaryPattern =
  /\b(?:do not|don't)\s+(?:add|include|recommend|use)\b|\b(?:because\s+)?(?:advanced\/custom\s+rag|private\s+network|hybrid\s+controls|lifecycle\s+controls|write[-\s]?back|action\s+execution)\s+(?:was|were)\s+not\s+selected\b|\bnot\s+selected\b/i;

function modelStrategyAffectsArchitecture(input: DecisionInput, decision: ArchitectureDecision) {
  const hasModelOverlay = decision.overlays.some((overlay) => /model_customization|azure_ml/i.test(overlay.id));
  const hasCopilotStudio = hasLayerSelection(decision, "Experience", /copilot studio/i);
  const hasDocumentRag = decision.overlays.some((overlay) => /document_rag/i.test(overlay.id));
  if (hasCopilotStudio && !hasImpactfulModelStrategy(input) && !hasModelOverlay && !hasDocumentRag) return false;
  return hasImpactfulModelStrategy(input);
}

export function buildArchitectureSummary(
  input: DecisionInput,
  decision: ArchitectureDecision,
  solutionType: string
) {
  if (decision.authority === "ai") {
    if (!decision.approvedSummary) throw new Error("The accepted AI recommendation is missing its architecture summary.");
    return decision.approvedSummary;
  }
  const users = labels(input.users, labelMaps.users, "the selected users");
  const channels = labels(input.channels, labelMaps.channels, "the selected channel");
  const dataSources = labels(input.dataSources, labelMaps.dataSources, "the selected data sources");
  const behaviors = labels(input.behaviors, labelMaps.behaviors, "the selected behavior");
  const modelStrategy = labels(input.modelStrategy ?? [], labelMaps.modelStrategy, "standard model deployment");
  const writesAuthorized = isActionable(input);
  const coordinationRequired = requiresOrchestration(input);
  const orchestration = layerSelections(decision, "Orchestration");
  const coordinationNarrative = coordinationRequired &&
    decision.architectureLayers.some((layer) => layer.layer === "Orchestration" && layer.required) &&
    orchestration.length
    ? ` Required coordination uses ${orchestration.join(", ")}.${writesAuthorized ? "" : " Tools remain read-only; no business writes are authorized."}`
    : "";

  const experience = top(layerSelections(decision, "Experience"), decision.basePatternName, 3);
  const runtime = top(layerSelections(decision, "Runtime/Backend"), "the managed runtime", 3);
  const grounding = top(layerSelections(decision, "Analytics/Grounding"), "the selected grounding path", 4);
  const integration = top(layerSelections(decision, "Integration"), "the platform's native source-permission boundary", 3);
  const security = top(layerSelections(decision, "Security"), "Entra ID and least-privilege access", 4);
  const network = top(layerSelections(decision, "Network/Deployment"), "the selected deployment posture", 3);
  const observability = top(layerSelections(decision, "Observability"), "standard platform monitoring", 3);
  const aiPlatform = top(layerSelections(decision, "AI Platform"), "the selected AI platform", 4);
  const displayPattern = displayPatternName(decision);
  const solutionLabel = decision.basePatternId === "m365_copilot_productivity" ? displayPattern : solutionType;
  const recommendationLead = recommendedSolutionLead(solutionLabel);
  const subscriptionBoundary = azureSubscriptionNarrative(solutionLabel);
  const mainComponents = componentNarrative({ experience, runtime, aiPlatform, grounding, integration, dataSources });
  const overlays = decision.overlays.length
    ? ` Active overlays: ${decision.overlays.map((o) => o.name).join(", ")}.`
    : "";
  const modelNarrative =
    modelStrategyAffectsArchitecture(input, decision)
      ? ` Model strategy: ${modelStrategy}.`
      : "";
  const readOnlyExternalDocumentSummary =
    decision.basePatternId === "external_ai_app" &&
    !writesAuthorized &&
    !coordinationRequired &&
    input.channels.some((c) => ["mobile", "web", "portal", "api", "embedded"].includes(c)) &&
    input.dataSources.includes("blob_storage") &&
    input.dataSources.includes("documents") &&
    hasOverlay(decision, /document_rag/i);

  const externalFabricSummary =
    decision.basePatternId === "external_ai_app" &&
    !coordinationRequired &&
    hasFabricSource(input) &&
    hasLayerSelection(decision, "Analytics/Grounding", /fabric data agent/i) &&
    !hasOverlay(decision, /fabric_data_agent/i);

  if (externalFabricSummary) {
    const surface = input.channels.includes("mobile") ? "mobile" : channels;
    const documentPending =
      input.capabilities.includes("document_rag") &&
      !input.dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source));
    return [
      `${recommendationLead} for an external ${surface} experience with governed read-only Q&A over ${dataSources}. It provides a clear separation between the public-facing channel, the AI/runtime layer, and governed access to Fabric analytics data. ${subscriptionBoundary} ${mainComponents} At a high level, the external channel sends requests to the controlled runtime, the runtime calls the AI/model layer and Fabric grounding path, and the answer is returned without exposing Fabric data directly to the channel.`,
      `In the recommended solution, ${runtime} provides the controlled application runtime. The experience and runtime are separated so the channel can evolve without reworking model, identity, or data-access decisions.`,
      `The solution uses ${aiPlatform} for reasoning, while Microsoft Fabric Data Agent is the Fabric analytics grounding path between the app/runtime and the selected Fabric source. This keeps Fabric data in the Knowledge/Data layer and places the agent/tooling in the grounding layer where it can be governed.`,
      `Security and operations are anchored by ${security}. Network and edge posture is ${network}, with ${observability} for runtime health, traceability, and operational review.`,
      documentPending
        ? "Recommended follow-up: confirm the document repository and retrieval requirements. Azure AI Search is a future option if advanced/custom RAG such as vector search, hybrid search, custom indexing, or metadata filtering is later confirmed."
        : ""
    ].filter(Boolean).join("\n\n");
  }

  if (readOnlyExternalDocumentSummary) {
    const surface = input.channels.includes("mobile") ? "mobile" : channels;
    return [
      `${recommendationLead} for an external ${surface} experience that summarizes documents stored in Azure Blob Storage. This path provides a governed, informational AI application boundary for document Q&A and summarization. ${subscriptionBoundary} ${mainComponents} At a high level, the mobile or web channel sends the request to the runtime, the runtime retrieves relevant document content through the grounding layer, calls the AI/model layer for summarization, and returns a read-only answer to the user.`,
      `The public-facing application is backed by ${runtime}, which provides the controlled boundary between the external channel and the AI services. This keeps user access, throttling, and policy enforcement separate from retrieval and model operations.`,
      `The solution handles document retrieval through ${grounding}, while model reasoning runs through ${aiPlatform}; the document source remains in the Knowledge/Data layer as ${dataSources}.`,
      `Security and operations are centered on ${security}. Deployment posture is ${network}, with ${observability} for runtime health, tracing, and operational review.`,
      "Recommended follow-up: if record updates, approvals, transactions, or other state-changing workflows are later required, add a governed action path with authorization, validation, and audit."
    ].join("\n\n");
  }

  const complex =
    decision.overlays.length > 1 ||
    decision.basePatternId === "business_action_agent" ||
    (hasOverlay(decision, /document_rag/i) && hasOverlay(decision, /foundry/i)) ||
    (input.dataSources.some((d) => ["azure_sql", "apis", "erp_crm", "dataverse"].includes(d)) &&
      input.dataSources.some((d) => ["documents", "blob_storage", "sharepoint"].includes(d)));

  if (complex) {
    const lead = `${recommendationLead} for ${users}`;
    const surface = hasLayerSelection(decision, "Experience", /copilot studio/i)
      ? "Copilot Studio handles the conversational interface"
      : `${experience} provides the user experience`;
    const copilotSqlAction =
      writesAuthorized &&
      (decision.basePatternId === "business_action_agent" || hasOverlay(decision, /business_action|orchestration/i)) &&
      hasLayerSelection(decision, "Experience", /copilot studio/i) &&
      input.dataSources.includes("azure_sql");
    const action = copilotSqlAction
      ? "Copilot Studio invokes actions/tools backed by Power Automate cloud flows. SQL writes use the SQL Server connector for Azure SQL / SQL Server, approved custom connectors, or parameterized stored procedures with authorization and audit; the LLM never writes directly to the database."
      : writesAuthorized && (decision.basePatternId === "business_action_agent" || hasOverlay(decision, /business_action|orchestration/i))
      ? "All writes to Azure SQL, APIs, ERP, or CRM systems are executed through deterministic workflows or backend APIs with authorization and audit; the LLM never writes directly to systems of record."
      : `Governed access to ${dataSources} is handled through ${integration}.`;
    const overlayNotes = [
      hasOverlay(decision, /document_rag/i)
        ? "Azure AI Search is included because advanced/custom RAG was selected."
        : "",
      hasOverlay(decision, /fabric_data_agent/i) || hasLayerSelection(decision, "Analytics/Grounding", /fabric data agent/i)
        ? "Microsoft Fabric Data Agent is included as the governed analytics Q&A tool for Fabric data; document/PDF RAG uses a separate grounding path only when document RAG is selected."
        : "",
      hasOverlay(decision, /foundry/i)
        ? "Azure AI Foundry is included for lifecycle, model operations, evaluation, tracing, monitoring, or governance."
        : "",
      hasOverlay(decision, /model_customization|azure_ml/i)
        ? "Selected model types can run together as a model portfolio, with Azure AI Foundry coordinating model deployments and Azure Machine Learning endpoints where selected."
        : "",
      hasOverlay(decision, /hybrid|private/i)
        ? "Hybrid/private deployment is applied as a deployment overlay, not as the base pattern."
        : ""
    ].filter(Boolean).join(" ");
    return [
      `${lead}. This solution delivers ${behaviors} over ${dataSources} from ${channels}, while keeping the visible solution aligned to ${displayPattern}.${modelNarrative} ${subscriptionBoundary} ${mainComponents} At a high level, the user channel sends the request to the experience layer, the runtime/orchestration layer invokes the correct AI, grounding, integration, or action component, and the response or governed action result is returned through the same controlled channel.`,
      `In the recommended solution, ${surface}. Runtime/backend execution is ${runtime}, providing a controlled place to handle orchestration, API calls, and model/tool invocation.${coordinationNarrative}`,
      `The solution uses ${aiPlatform} as the AI platform layer. Data and grounding are separated deliberately: data sources remain ${dataSources}, while grounding/retrieval services are ${grounding}. Integration is handled through ${integration}, so agents and model calls do not directly access databases, APIs, or systems of record unless a governed interface is present. ${action}`,
      `Security and operations are anchored by ${security}. Deployment posture is ${network}, with ${observability} for traceability, health, and operational review.`,
      overlayNotes ? `Recommended overlays and follow-ups: ${overlayNotes}` : ""
    ].filter(Boolean).join("\n\n");
  }

  return [
    `${recommendationLead} for ${users}, surfaced through ${channels}. This solution supports ${behaviors} over ${dataSources} while keeping the user-facing experience, runtime, and data-access responsibilities clear. ${subscriptionBoundary} ${mainComponents} At a high level, the user request enters through the selected channel, the experience/runtime layer coordinates AI and grounding, governed connectors access the selected data sources, and the answer is returned without giving the model direct access to systems of record.`,
    `The user experience uses ${experience}, and runtime/backend execution uses ${runtime}. This separates the user channel from the implementation layer that handles orchestration, APIs, and model calls.${coordinationNarrative}`,
    `The solution uses ${aiPlatform} as the AI platform.${modelNarrative} Grounding or analytics services are ${grounding}, while the knowledge/data sources remain ${dataSources}. Governed access is handled through ${integration}, which keeps models and agents from directly reaching systems of record.`,
    `Security and operations use ${security}. Deployment posture is ${network}, and observability is ${observability}.`,
    overlays ? `Recommended overlays and follow-ups:${overlays}` : ""
  ].filter(Boolean).join("\n\n");
}

export function shouldUseGeneratedArchitectureSummary(
  candidate: string | undefined,
  useCaseSummary: string,
  finalRecommendation: string,
  solutionType?: string
) {
  const text = candidate?.trim();
  if (!text) return true;
  const normalized = text.toLowerCase();
  const paragraphCount = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean).length;
  const solution = solutionType?.trim().toLowerCase();
  const mentionsRecommendation = /\brecommended\b|\brecommendation\b/.test(normalized);
  const mentionsSolutionType = !solution || normalized.includes(solution);
  return (
    normalized === useCaseSummary.trim().toLowerCase() ||
    normalized === finalRecommendation.trim().toLowerCase() ||
    paragraphCount < 3 ||
    text.length < 260 ||
    internalGuardrailSummaryPattern.test(text) ||
    !mentionsRecommendation ||
    !mentionsSolutionType
  );
}
