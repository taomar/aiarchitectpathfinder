import type {
  ArchitectureLayer,
  Capability,
  DataSource,
  DecisionInput,
  RuntimePreference
} from "./types";
import {
  hasAzureSqlSource,
  hasExternalChannel,
  hasExternalUser,
  hasConfirmedExternalSurface,
  needsPublicEdgeControls,
  hasFabricSource,
  hasInternalUser,
  hasM365KnowledgeSource,
  hasOperationalStructuredSource,
  hasSharePointSource,
  hasTeamsChannel,
  isActionable,
  requiresOrchestration,
  wantsAzureMachineLearning,
  wantsAdvancedDocumentRag,
  wantsAdvancedRag,
  wantsFabricDataAgent,
  wantsFoundryModelOps,
  wantsModelCustomization,
  wantsSimpleCopilotStudioKnowledge
} from "./rules";
import { normalizeDecisionInput } from "./input-normalization";

export const NOT_REQUIRED = "Not required for this use case";

export type BasePattern = {
  id: string;
  name: string;
  build: (input: DecisionInput) => {
    recommendedStack: string[];
    optionalAddOns: string[];
    forbiddenUnlessConfirmed: string[];
    blockedComponents: string[];
    rationale: string[];
    architectureLayers: ArchitectureLayer[];
    endToEndFlow: string[];
    finalRecommendation: string;
  };
};

const layer = (
  l: ArchitectureLayer["layer"],
  selections: string[],
  required: boolean,
  reason: string
): ArchitectureLayer => ({ layer: l, selections, required, reason });

const NR = (l: ArchitectureLayer["layer"], reason: string): ArchitectureLayer =>
  layer(l, [NOT_REQUIRED], false, reason);

/* ---------------- shared helpers ---------------- */

function channelLabels(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    m365_copilot: "Microsoft 365 Copilot",
    teams: "Teams",
    m365: "Microsoft 365",
    web: "Web app",
    mobile: "Mobile app",
    portal: "Portal",
    api: "API",
    embedded: "Embedded experience",
    multiple: "Multiple channels"
  };
  return input.channels.filter((c) => c !== "unknown").map((c) => map[c] || c);
}

function primaryExternalChannelLabels(input: DecisionInput): string[] {
  const externalChannels = input.channels.filter((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c));
  return channelLabels({ ...input, channels: externalChannels as any });
}

function identityFor(input: DecisionInput): string[] {
  const out: string[] = [];
  if (hasInternalUser(input) || (hasTeamsChannel(input) && !hasExternalUser(input))) out.push("Entra ID");
  if (hasConfirmedExternalSurface(input)) out.push("Entra External ID");
  if (out.length === 0) out.push("Entra ID");
  return out;
}

function fabricSourceList(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    fabric_onelake: "Fabric OneLake",
    fabric_lakehouse: "Fabric Lakehouse",
    fabric_warehouse: "Fabric Warehouse",
    powerbi_semantic_model: "Power BI Semantic Model",
    kql_eventhouse: "KQL / Eventhouse"
  };
  return input.dataSources.filter((d) => map[d]).map((d) => map[d]);
}

function documentSourceList(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    documents: "Documents / PDFs",
    blob_storage: "Blob Storage",
    sharepoint: "SharePoint documents"
  };
  return input.dataSources.filter((d) => map[d]).map((d) => map[d]);
}

function nativeKnowledgeSourceList(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    documents: "Uploaded documents / PDFs",
    sharepoint: "SharePoint",
    m365_graph: "Microsoft Graph / M365 content"
  };
  return input.dataSources.filter((d) => map[d]).map((d) => map[d]);
}

function advancedRagReason(input: DecisionInput): string {
  const map: Record<string, string> = {
    custom_vector_search: "custom vector search",
    hybrid_search: "hybrid search",
    large_scale_indexing: "large-scale indexing",
    custom_ingestion: "custom ingestion",
    custom_chunking: "custom chunking",
    ocr_enrichment: "OCR / document enrichment",
    metadata_filtering: "metadata filtering / facets / scoring",
    reusable_enterprise_index: "reusable enterprise search index",
    private_search_service: "private search service",
    multi_app_search_reuse: "multi-app search reuse",
    explicit_azure_ai_search: "explicit Azure AI Search requirement"
  };
  const selected = (input.advancedRagRequirements ?? [])
    .filter((r) => r !== "none" && r !== "unknown")
    .map((r) => map[r] || r);
  if (selected.length) return selected.join(", ");
  if (input.capabilities.includes("document_rag")) return "document RAG capability";
  if (input.runtimePreferences.includes("custom_backend")) return "custom backend RAG";
  if (input.runtimePreferences.includes("foundry_agent_service")) return "Foundry Agent Service runtime";
  if (input.dataSources.includes("blob_storage") && !input.runtimePreferences.includes("copilot_studio")) return "Blob Storage document corpus outside Copilot Studio native knowledge";
  if (hasExternalUser(input) && hasExternalChannel(input)) return "external/custom app channel";
  return "advanced/custom RAG requirement";
}

function knowledgeDataSelections(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    m365_graph: "Microsoft Graph",
    sharepoint: "SharePoint",
    fabric_onelake: "Fabric OneLake",
    fabric_lakehouse: "Fabric Lakehouse",
    fabric_warehouse: "Fabric Warehouse",
    powerbi_semantic_model: "Power BI Semantic Model",
    kql_eventhouse: "KQL / Eventhouse",
    documents: "Documents / PDFs",
    blob_storage: "Blob Storage",
    azure_sql: "Azure SQL",
    dataverse: "Dataverse",
    apis: "Business APIs",
    erp_crm: "ERP / CRM",
    on_prem: "On-premises systems",
    internet: "Internet"
  };
  return input.dataSources.filter((d) => map[d]).map((d) => map[d]);
}

function operationalStructuredSourceList(input: DecisionInput): string[] {
  const map: Record<string, string> = {
    azure_sql: "Azure SQL",
    dataverse: "Dataverse",
    apis: "Business APIs",
    erp_crm: "ERP / CRM",
    on_prem: "On-premises systems"
  };
  return input.dataSources.filter((d) => map[d]).map((d) => map[d]);
}

function runtimeSelections(input: DecisionInput, defaultRuntime: string): string[] {
  const map: Record<string, string> = {
    copilot_studio: "Copilot Studio",
    custom_backend: "Custom Backend",
    foundry_agent_service: "Azure AI Foundry Agent Service",
    m365_agents_sdk: "Microsoft 365 Agents SDK",
    functions: "Azure Functions",
    app_service: "Azure App Service",
    container_apps: "Azure Container Apps",
    aks: "AKS"
  };
  const picks = input.runtimePreferences
    .filter((r) => map[r])
    .map((r) => map[r]);
  if (picks.length > 0) return picks;
  return [defaultRuntime];
}

function modelStrategySelections(input: DecisionInput): string[] {
  const baseline = ["Azure OpenAI model deployment in Azure AI Foundry"];
  const map: Record<string, string> = {
    foundry_model_catalog: "Azure OpenAI, Azure-sold Foundry, or provider/open model",
    anthropic_claude: "Claude / Anthropic model selected through Azure AI Foundry",
    xai_grok: "Grok / xAI model selected through Azure AI Foundry or governed endpoint",
    fine_tuned_azure_openai: "Fine-tuned Azure OpenAI model in Azure AI Foundry",
    fine_tuned_foundry_model: "Fine-tuned model in Azure AI Foundry managed compute",
    azure_ml_custom_model: "Azure Machine Learning workspace / model registry",
    azure_ml_endpoint: "Azure Machine Learning managed online endpoint",
    bring_your_own_model: "Bring-your-own model hosted via Foundry managed compute or Azure Machine Learning"
  };
  const selections = (input.modelStrategy ?? []).filter((m) => map[m]).map((m) => map[m]);
  return Array.from(new Set([...baseline, ...selections]));
}

function hasMultipleModelStrategies(input: DecisionInput): boolean {
  return (input.modelStrategy ?? []).some((m) =>
    ["foundry_model_catalog", "anthropic_claude", "xai_grok", "fine_tuned_azure_openai", "fine_tuned_foundry_model", "azure_ml_custom_model", "azure_ml_endpoint", "bring_your_own_model"].includes(m)
  );
}

function wantsFoundryApplication(input: DecisionInput) {
  return (
    input.runtimePreferences.includes("foundry_agent_service") ||
    wantsFoundryModelOps(input) ||
    wantsAzureMachineLearning(input)
  );
}

function hasExplicitNonCopilotRuntime(input: DecisionInput) {
  return input.runtimePreferences.some((runtime) =>
    ["custom_backend", "foundry_agent_service", "m365_agents_sdk", "functions", "app_service", "container_apps", "aks"].includes(runtime)
  );
}

function shouldUseCopilotStudioForFabric(input: DecisionInput) {
  return (
    hasTeamsChannel(input) &&
    wantsFabricDataAgent(input) &&
    // A custom channel (portal/web/mobile/api/embedded) needs a custom app — Copilot Studio
    // Fabric Data Agent is Teams/M365-native — so any external channel excludes this route.
    !hasExternalChannel(input) &&
    !isActionable(input) &&
    !hasExplicitNonCopilotRuntime(input)
  );
}

const M365_PRODUCTIVITY_EXCLUDED_CAPABILITIES: Capability[] = [
  "employee_assistant",
  "operational_query",
  "fabric_analytics",
  "document_rag",
  "business_workflow",
  "approval",
  "transaction",
  "record_update",
  "multi_agent",
  "custom_app"
];

const M365_PRODUCTIVITY_EXCLUDED_DATA_SOURCES: DataSource[] = [
  "azure_sql",
  "dataverse",
  "apis",
  "erp_crm",
  "fabric_onelake",
  "fabric_lakehouse",
  "fabric_warehouse",
  "powerbi_semantic_model",
  "kql_eventhouse",
  "documents",
  "blob_storage",
  "on_prem"
];

const M365_PRODUCTIVITY_EXCLUDED_RUNTIMES: RuntimePreference[] = [
  "copilot_studio",
  "custom_backend",
  "foundry_agent_service",
  "m365_agents_sdk",
  "functions",
  "app_service",
  "container_apps",
  "aks"
];

function isM365PersonalProductivityOnly(input: DecisionInput): boolean {
  return (
    input.capabilities.includes("personal_productivity") &&
    !input.capabilities.some((c) => M365_PRODUCTIVITY_EXCLUDED_CAPABILITIES.includes(c)) &&
    !input.dataSources.some((d) => M365_PRODUCTIVITY_EXCLUDED_DATA_SOURCES.includes(d)) &&
    !input.runtimePreferences.some((r) => M365_PRODUCTIVITY_EXCLUDED_RUNTIMES.includes(r))
  );
}

function hasConcrete(values: readonly string[] | undefined) {
  return (values ?? []).some((value) => value !== "unknown" && value !== "none");
}

function hasExplicitRoutingSignal(input: DecisionInput) {
  return (
    hasTeamsChannel(input) ||
    hasExternalChannel(input) ||
    hasFabricSource(input) ||
    wantsAdvancedDocumentRag(input) ||
    isActionable(input) ||
    hasOperationalStructuredSource(input) ||
    wantsFoundryApplication(input) ||
    input.runtimePreferences.some((runtime) => !["none", "unknown"].includes(runtime)) ||
    input.networkControls.some((network) => !["none", "unknown", "public"].includes(network)) ||
    // Baseline identity (entra_id) and audit logging are weak inferred signals that
    // should not, on their own, suppress the clarification safety net.
    input.securityControls.some((security) => !["unknown", "entra_id", "audit"].includes(security))
  );
}

function needsClarificationBeforeArchitecture(input: DecisionInput) {
  const hasSomeIntent = hasConcrete(input.capabilities) || hasConcrete(input.dataSources) || hasConcrete(input.behaviors) || !!(input.summary ?? "").trim();
  const missingAudienceOrChannel = !hasConcrete(input.users) || !hasConcrete(input.channels);
  const externalAudienceWithoutConfirmedChannel = hasExternalUser(input) && !hasExternalChannel(input);
  // Build-from-text path: do not infer a confident architecture from sparse scenario text.
  if (input.directTextRecommendation === true && hasSomeIntent && (
    externalAudienceWithoutConfirmedChannel ||
    (missingAudienceOrChannel && !hasExplicitRoutingSignal(input))
  )) {
    return true;
  }
  // Wizard path: if the user skipped so much that there is NO concrete audience AND NO
  // concrete channel AND no explicit routing signal at all, ask for clarification rather
  // than defaulting to a confident-looking custom AI Foundry app. (Only reachable when no
  // other base pattern matched, so answering audience OR channel exits this state.)
  if (!hasConcrete(input.users) && !hasConcrete(input.channels) && !hasExplicitRoutingSignal(input)) {
    return true;
  }
  return false;
}

/* ================================================================
 * BASE PATTERNS
 * ================================================================ */

export const PATTERNS: Record<string, BasePattern> = {
  clarification_required: {
    id: "clarification_required",
    name: "Needs Clarification Before Architecture Selection",
    build: (input) => ({
      recommendedStack: [
        "Clarify user audience",
        "Clarify access channel",
        "Confirm data source and grounding requirements"
      ],
      optionalAddOns: [],
      forbiddenUnlessConfirmed: [
        "Azure AI Foundry unless custom runtime, model operations, or advanced AI lifecycle is confirmed",
        "Azure AI Search unless advanced/custom RAG is confirmed",
        "Custom backend unless custom channel, API integration, or runtime control is confirmed"
      ],
      blockedComponents: [
        "Do not infer Azure AI Foundry from sparse document-chat wording",
        "Do not infer external app architecture without a confirmed external audience or channel"
      ],
      rationale: [
        "The scenario text does not provide enough concrete routing inputs to choose a safe architecture family.",
        "Audience, channel, data source, and simple-versus-advanced grounding should be clarified before selecting Copilot Studio, AI Foundry, or a hybrid route."
      ],
      endToEndFlow: [
        "Confirm who will use the assistant",
        "Confirm where users will access it",
        "Confirm whether the content can use native knowledge or requires advanced/custom RAG",
        "Run Pathfinder again with the confirmed inputs"
      ],
      finalRecommendation:
        "Clarify audience, channel, and grounding requirements before selecting the architecture. Pathfinder should not default sparse document-chat wording to AI Foundry.",
      architectureLayers: [
        layer("User/Channel", ["Clarify user audience and access channel"], true, "Required before architecture selection."),
        layer("Identity", ["Clarify internal, guest, external, citizen, or partner identity model"], true, "Identity depends on audience."),
        layer("Experience", ["Clarify Teams, Microsoft 365, web, mobile, portal, API, or embedded experience"], true, "Experience determines the solution family."),
        NR("Runtime/Backend", "Runtime depends on channel and action/integration needs."),
        layer("Analytics/Grounding", ["Clarify native knowledge versus advanced/custom RAG"], true, "Grounding path determines whether Copilot Studio native knowledge or Azure AI Search is needed."),
        NR("Orchestration", "Only needed for workflows, actions, approvals, transactions, or multi-agent behavior."),
        NR("AI Platform", "Do not select AI Foundry until runtime/model/lifecycle need is confirmed."),
        layer("Knowledge/Data", knowledgeDataSelections(input).length ? knowledgeDataSelections(input) : ["Clarify source documents, Microsoft 365 content, APIs, Fabric, or databases"], true, "Source selection is required."),
        NR("Integration", "Integration depends on source systems and action requirements."),
        NR("Security", "Security model depends on audience, data, and channel."),
        NR("Observability", "Add monitoring once the solution family is selected."),
        NR("Network/Deployment", "Deployment posture depends on external/private/regulatory needs.")
      ]
    })
  },

  /* ---------- M365 Copilot Personal Productivity ---------- */
  m365_copilot_productivity: {
    id: "m365_copilot_productivity",
    name: "Microsoft 365 Copilot — Personal Productivity",
    build: (input) => ({
      recommendedStack: [
        "Microsoft 365 Copilot",
        "Microsoft Graph / M365 content",
        "Entra ID",
        "M365 permissions & compliance"
      ],
      optionalAddOns: ["Purview (if governance explicitly required)"],
      forbiddenUnlessConfirmed: [
        "Custom backend",
        "Azure AI Foundry",
        "Fabric Data Agent",
        "Agent Framework",
        "M365 Agents SDK"
      ],
      blockedComponents: ["Azure AI Search (not needed for personal productivity)"],
      rationale: [
        "Capability is personal productivity over M365 content — Microsoft 365 Copilot covers it natively."
      ],
      endToEndFlow: [
        "User invokes Microsoft 365 Copilot in Word/Outlook/Teams",
        "Copilot grounds in Microsoft Graph and tenant content",
        "Response returned within the M365 experience"
      ],
      finalRecommendation:
        "Use Microsoft 365 Copilot directly — no custom platform components are required.",
      architectureLayers: [
        layer("User/Channel", ["Microsoft 365 apps"], true, "Personal productivity surfaces."),
        layer("Identity", ["Entra ID"], true, "Internal user authentication."),
        layer("Experience", ["Microsoft 365 Copilot"], true, "Native M365 experience."),
        NR("Runtime/Backend", "No custom backend required."),
        layer("Analytics/Grounding", ["Microsoft Graph"], true, "Native grounding."),
        NR("Orchestration", "M365 Copilot handles orchestration."),
        layer("AI Platform", ["Microsoft 365 Copilot (managed)"], true, "Foundry not added."),
        layer("Knowledge/Data", ["M365 content (Mail, Files, Teams, SharePoint)"], true, "Native grounding."),
        NR("Integration", "No custom integration required."),
        layer("Security", ["Entra ID", "M365 permissions"], true, "Built-in M365 security."),
        layer("Observability", ["M365 admin & Purview"], false, "Optional."),
        layer("Network/Deployment", ["SaaS — Microsoft-managed"], true, "No custom network.")
      ]
    })
  },

  /* ---------- Copilot Studio Internal Assistant ---------- */
  copilot_studio_internal_assistant: {
    id: "copilot_studio_internal_assistant",
    name: "Copilot Studio Internal Assistant",
    build: (input) => {
      const channels = channelLabels(input);
      const hasSql = hasAzureSqlSource(input);
      const hasOperational =
        hasOperationalStructuredSource(input) || input.dataSources.includes("on_prem");
      const operationalSources = operationalStructuredSourceList(input);
      const hasSp = hasSharePointSource(input);
      const hasM365 = hasM365KnowledgeSource(input);
      const nativeKnowledgeSources = nativeKnowledgeSourceList(input);
      const hasNativeKnowledge = nativeKnowledgeSources.length > 0;
      const advancedRag = wantsAdvancedRag(input);

      // ---- Knowledge/Data layer selections (data-source-aware) ----
      const knowledgeSelections: string[] = [];
      knowledgeSelections.push(...nativeKnowledgeSources);
      for (const op of operationalSources) {
        if (!knowledgeSelections.includes(op)) knowledgeSelections.push(op);
      }
      // include any other selected knowledge sources
      for (const extra of knowledgeDataSelections(input)) {
        if (!knowledgeSelections.includes(extra)) knowledgeSelections.push(extra);
      }
      if (knowledgeSelections.length === 0) knowledgeSelections.push("Copilot Studio native knowledge sources");

      // ---- Integration layer (governed access for operational structured data) ----
      const integrationSelections: string[] = [];
      let integrationRequired = false;
      if (hasOperational) {
        integrationSelections.push(
          hasSql
            ? "Governed read-only SQL connector / Power Automate action / custom connector / backend API"
            : "Governed read-only connector / Power Automate action / custom connector / backend API"
        );
        integrationRequired = true;
      }
      if (hasNativeKnowledge) {
        integrationSelections.push("Copilot Studio native knowledge source");
      }
      if (integrationSelections.length === 0) {
        integrationSelections.push("Power Platform connectors (optional)");
      }

      // ---- Recommended stack ----
      const stack: string[] = [
        ...(channels.length ? channels : ["Teams"]),
        "Copilot Studio"
      ];
      if (hasNativeKnowledge) {
        stack.push("Copilot Studio native knowledge sources");
        stack.push(...nativeKnowledgeSources);
      }
      if (hasOperational) {
        stack.push("Governed read-only connector / action / API");
        stack.push(...(operationalSources.length ? operationalSources : ["Operational structured data source"]));
      }
      stack.push(...identityFor(input));
      if (hasOperational) {
        stack.push(hasSql ? "Least-privilege SQL permissions" : "Least-privilege data-source permissions");
      }
      if (input.securityControls.includes("rbac")) stack.push("Azure RBAC");
      if (input.securityControls.includes("audit")) stack.push("Audit logging");

      // ---- Security selections ----
      const security: string[] = ["Entra ID"];
      if (hasNativeKnowledge) security.push("Repository/source permissions");
      if (hasOperational) {
        security.push(
          hasSql ? "Least-privilege SQL permissions" : "Least-privilege data-source permissions",
          "Read-only connector/action/API permissions"
        );
      }
      if (input.securityControls.includes("rbac")) security.push("Azure RBAC");
      if (input.securityControls.includes("audit")) security.push("Audit logging");
      if (input.securityControls.includes("key_vault")) security.push("Key Vault");
      if (input.securityControls.includes("managed_identity")) security.push("Managed Identity");

      // ---- End-to-end flow ----
      const opLabel = operationalSources.join(" / ") || "the operational data source";
      let flow: string[];
      if (hasOperational && !hasNativeKnowledge) {
        // Branch B — operational structured read-only only
        flow = [
          `User opens the agent from ${channels.join(" / ") || "Teams / Microsoft 365"}`,
          "The selected surface launches the Copilot Studio Agent",
          `Copilot Studio Agent calls a governed read-only connector / Power Automate action / custom connector / backend API for ${opLabel}`,
          `The connector/action/API queries ${opLabel} using least-privilege read-only access`,
          "The data source returns only authorized data",
          "Copilot Studio Agent formats and returns the response to the user"
        ];
      } else if (hasOperational && hasNativeKnowledge) {
        // Branch C — Mixed
        flow = [
          `User opens the assistant from ${channels.join(" / ") || "Teams / Microsoft 365 / Microsoft 365 Copilot"}`,
          "The selected surface launches the Copilot Studio Agent",
          `For native knowledge, Copilot Studio Agent searches ${nativeKnowledgeSources.join(" / ") || "configured native knowledge sources"}`,
          `For operational data, Copilot Studio Agent calls a governed read-only connector / action / API for ${opLabel} using least-privilege read-only access`,
          "The operational data source returns only authorized data",
          "Copilot Studio Agent combines authorized knowledge and data results and returns the response to the user"
        ];
      } else {
        // Branch A — native knowledge only
        flow = [
          `User opens the agent in ${channels.join(" / ") || "Teams / Microsoft 365"}`,
          "Copilot Studio receives the question",
          `Copilot Studio searches configured native knowledge sources such as ${nativeKnowledgeSources.join(" / ") || "uploaded files, SharePoint, or M365 content"}`,
          "Copilot Studio generates a grounded answer",
          "Response returned to the user"
        ];
      }

      // ---- Final recommendation ----
      let finalRecommendation: string;
      if (hasOperational && !hasNativeKnowledge) {
        finalRecommendation =
          `Build the agent in Copilot Studio and connect it to ${opLabel} through a governed read-only connector, Power Automate action, custom connector, or backend API — never directly from the LLM. Use Entra ID and least-privilege permissions.`;
      } else if (hasOperational && hasNativeKnowledge) {
        finalRecommendation =
          `Build the agent in Copilot Studio. Use native knowledge sources for uploaded documents, SharePoint, or Microsoft 365 content, and a governed read-only connector / action / API for ${opLabel}. Use Entra ID and least-privilege permissions.`;
      } else {
        finalRecommendation =
          "Build the agent in Copilot Studio with native knowledge sources and surface it through Teams / Microsoft 365.";
      }

      // ---- Rationale ----
      const rationale: string[] = [
        "Internal employees on Teams / Microsoft 365 with low-code preference and read-only Q&A — Copilot Studio is the right base pattern."
      ];
      if (hasOperational) {
        rationale.push(
          "Operational structured data must be reached through a governed read-only connector / action / API, never directly from the LLM."
        );
      }
      if (hasNativeKnowledge && !advancedRag) {
        rationale.push(
          "Simple internal document or M365 knowledge Q&A can use Copilot Studio native knowledge sources; a dedicated custom search/RAG layer is not added unless advanced/custom RAG is selected."
        );
      }

      // ---- Blocked / forbidden ----
      const blocked: string[] = ["Direct LLM-to-database access", "Direct LLM-to-database write", "Direct LLM-to-system-of-record access"];
      if (hasNativeKnowledge && !advancedRag) {
        blocked.push(
          "Azure AI Search unless advanced/custom RAG is selected",
          "Azure OpenAI model deployment in Azure AI Foundry as explicit app model unless custom/advanced RAG is selected",
          "Azure AI Foundry unless lifecycle controls are explicit",
          "Custom backend unless explicitly selected",
          ...(!requiresOrchestration(input) ? ["Agent Framework unless orchestration is selected"] : []),
          "M365 Agents SDK unless explicitly selected",
          "Fabric Data Agent unless Fabric source is selected"
        );
      }
      if (hasOperational) {
        blocked.push(
          "Fabric Data Agent for non-Fabric operational data grounding",
          "Azure AI Search for operational structured read-only query unless advanced/custom RAG is selected",
          "Microsoft 365 Agents SDK unless explicit M365 extensibility is required"
        );
      }
      const forbidden: string[] = [
        "Azure AI Foundry as mandatory",
        ...(!requiresOrchestration(input) ? ["Agent Framework"] : []),
        "Custom backend",
        "M365 Agents SDK"
      ];
      if (hasOperational) {
        forbidden.push(
          "Fabric Data Agent unless Fabric source is selected",
          "Azure AI Search unless advanced/custom RAG is selected"
        );
      }

      // ---- Architecture layers ----
      const layers: ArchitectureLayer[] = [
        layer(
          "User/Channel",
          channels.length ? channels : ["Teams"],
          true,
          "Internal channel."
        ),
        layer("Identity", identityFor(input), true, "Internal users."),
        layer("Experience", ["Copilot Studio agent"], true, "Low-code conversational."),
        layer(
          "Runtime/Backend",
          ["Copilot Studio managed runtime"],
          true,
          hasOperational
            ? "Copilot Studio runtime is sufficient; add custom backend only if governed data-access mediation is explicitly required."
            : "No custom backend required."
        ),
        hasNativeKnowledge && !hasOperational
          ? layer(
              "Analytics/Grounding",
              ["Copilot Studio native knowledge / generative answers"],
              true,
              "Simple internal read-only Q&A uses Copilot Studio native knowledge sources."
            )
          : hasOperational
          ? layer(
              "Analytics/Grounding",
              ["Operational read-only data grounding via governed connector/action/API"],
              true,
              "Grounded in operational structured data through a governed read-only connector/action/API."
            )
          : NR("Analytics/Grounding", "No Fabric analytics required."),
        NR(
          "Orchestration",
          "Read-only Q&A — no orchestration / workflow / action execution required."
        ),
        layer(
          "AI Platform",
          ["Copilot Studio managed AI experience"],
          true,
          "Foundry only on explicit lifecycle controls."
        ),
        layer("Knowledge/Data", knowledgeSelections, true, "Tenant knowledge."),
        layer(
          "Integration",
          hasNativeKnowledge && !hasOperational
            ? ["Not required for uploaded/native knowledge"]
            : integrationSelections,
          hasNativeKnowledge && !hasOperational ? false : integrationRequired,
          hasOperational
            ? "Operational structured data requires a governed read-only data-access layer (connector / Power Automate action / custom connector / backend API)."
            : hasNativeKnowledge
            ? "Copilot Studio native knowledge does not require a custom integration layer."
            : "Only if needed."
        ),
        layer("Security", security, true, "Identity, RBAC and least-privilege controls."),
        layer(
          "Observability",
          input.securityControls.includes("audit")
            ? ["Copilot Studio analytics", "Audit logging"]
            : ["Copilot Studio analytics"],
          false,
          "Optional."
        ),
        layer(
          "Network/Deployment",
          ["SaaS — Microsoft-managed"],
          true,
          "No custom network unless private overlay is explicitly selected."
        )
      ];

      return {
        recommendedStack: stack,
        optionalAddOns: hasNativeKnowledge && !hasOperational && !advancedRag
          ? ["Power Platform connectors"]
          : [
              "Power Platform connectors",
              "Azure OpenAI model deployment in Azure AI Foundry via configured actions (if needed)"
            ],
        forbiddenUnlessConfirmed: forbidden,
        blockedComponents: blocked,
        rationale,
        endToEndFlow: flow,
        finalRecommendation,
        architectureLayers: layers
      };
    }
  },

  /* ---------- Copilot Studio + Fabric Data Agent ---------- */
  copilot_studio_fabric_data_agent: {
    id: "copilot_studio_fabric_data_agent",
    name: "Copilot Studio + Fabric Data Agent",
    build: (input) => {
      const sources = fabricSourceList(input);
      return {
        recommendedStack: [
          ...(channelLabels(input).length ? channelLabels(input) : ["Teams / M365"]),
          "Copilot Studio",
          "Microsoft Fabric Data Agent",
          ...(sources.length ? sources : ["Fabric source"]),
          "Entra ID",
          "Fabric / Power BI permissions"
        ],
        optionalAddOns: [
          "Fabric / Power BI monitoring",
          "Purview (if governance explicitly required)"
        ],
        forbiddenUnlessConfirmed: [
          "Azure AI Foundry as core layer",
          "Agent Framework",
          "M365 Agents SDK",
          "Custom backend"
        ],
        blockedComponents: [
          "Direct LLM-to-database write",
          "Azure AI Search (Fabric is the grounding layer here)"
        ],
        rationale: [
          "Internal users + Teams/M365 + Fabric source + read-only analytics → Copilot Studio + Microsoft Fabric Data Agent.",
          "Fabric Data Agent is the governed analytics/data-Q&A tool for Fabric data; this is separate from document/PDF RAG.",
          "Lifecycle/model-operations overlays are added only when explicit controls or model requirements are selected.",
          "Agent Framework is not added because there is no write-back, action, approval, transaction, or multi-agent orchestration."
        ],
        endToEndFlow: [
          "User asks a question in Teams / M365",
          "Copilot Studio agent receives the prompt",
          "Copilot Studio invokes the connected Microsoft Fabric Data Agent",
          "Fabric Data Agent queries the governed Fabric source using user/data permissions",
          "Result is returned to Copilot Studio",
          "Copilot Studio replies in Teams / M365"
        ],
        finalRecommendation:
          "Build a Copilot Studio agent with a connected Microsoft Fabric Data Agent grounded on the selected Fabric source, and surface it in Teams / M365.",
        architectureLayers: [
          layer("User/Channel", channelLabels(input).length ? channelLabels(input) : ["Teams / M365"], true, "Internal collaboration surface."),
          layer("Identity", identityFor(input), true, "Internal authentication."),
          layer("Experience", ["Copilot Studio agent"], true, "Low-code conversational experience."),
          NR("Runtime/Backend", "Copilot Studio + Fabric Data Agent cover runtime."),
          layer("Analytics/Grounding", ["Microsoft Fabric Data Agent", "Fabric Data Agent → Fabric source"], true, "Natural-language analytics over Fabric."),
          NR("Orchestration", "Read-only analytics — no orchestration layer."),
          layer("AI Platform", ["Copilot Studio managed AI experience"], true, "Azure AI Foundry added only when explicit lifecycle/model controls are selected."),
          layer("Knowledge/Data", sources.length ? sources : ["Fabric (OneLake/Lakehouse/Warehouse/Semantic Model)"], true, "Grounded in Fabric."),
          NR("Integration", "No external integration required."),
          layer("Security", ["Entra ID", "Fabric user identity and permissions", "Fabric / Power BI permissions"], true, "Use Fabric-native security and user/data permissions."),
          layer("Observability", ["Fabric / Power BI monitoring"], false, "Optional."),
          layer("Network/Deployment", ["SaaS — Microsoft-managed"], true, "No custom network unless hybrid overlay applies.")
        ]
      };
    }
  },

  /* ---------- Document RAG Agent ---------- */
  document_rag_agent: {
    id: "document_rag_agent",
    name: "Document RAG Agent with Azure AI Search",
    build: (input) => {
      const channels = channelLabels(input);
      const teams = hasTeamsChannel(input);
      const explicitRuntime = input.runtimePreferences.some((runtime) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(runtime));
      const experience = explicitRuntime
        ? runtimeSelections(input, "Custom Backend (App Service / Container Apps)")[0]
        : teams
        ? "Copilot Studio"
        : "Custom Backend (App Service / Container Apps)";
      const ragReason = advancedRagReason(input);
      return {
        recommendedStack: [
          ...(channels.length ? channels : ["Selected channel"]),
          experience,
          "Azure AI Search (vector / hybrid)",
          ...(documentSourceList(input).length ? documentSourceList(input) : ["Document source"]),
          "Azure OpenAI model deployment in Azure AI Foundry",
          ...identityFor(input)
        ],
        optionalAddOns: [
          "APIM (if exposed as an API)",
          "Front Door + WAF (if internet-facing)"
        ],
        forbiddenUnlessConfirmed: [
          "Fabric Data Agent (no Fabric analytics source)",
          ...(!requiresOrchestration(input) ? ["Agent Framework (no orchestration requirement)"] : [])
        ],
        blockedComponents: ["Direct LLM-to-database write"],
        rationale: [
          "Azure AI Search is included because an advanced/custom RAG requirement was selected.",
          `Advanced/custom document RAG was selected (${ragReason}), so Azure AI Search is used for vector/hybrid retrieval, custom indexing, metadata filtering, reusable search, or private search requirements.`,
          "Foundry is added only when evaluation/tracing/governance are explicitly selected."
        ],
        endToEndFlow: [
          "User submits a question",
          `${experience} receives the prompt`,
          "Azure AI Search performs vector / hybrid retrieval over indexed documents",
          "Azure OpenAI model deployment in Azure AI Foundry generates a grounded answer with citations",
          "Response returned to the user"
        ],
        finalRecommendation:
          "Build a Document RAG agent with Azure AI Search and an Azure OpenAI model deployment in Azure AI Foundry, surfaced via the selected channel.",
        architectureLayers: [
          layer("User/Channel", channels.length ? channels : ["Selected channel"], true, "Channel for the RAG agent."),
          layer("Identity", identityFor(input), true, "Identity per user population."),
          layer("Experience", [experience], true, "Experience layer."),
          explicitRuntime
            ? layer("Runtime/Backend", runtimeSelections(input, "Custom Backend (App Service / Container Apps)"), true, "Explicit runtime preference selected for advanced/custom RAG.")
            : teams
            ? NR("Runtime/Backend", "Copilot Studio covers runtime.")
            : layer("Runtime/Backend", runtimeSelections(input, "Custom Backend (App Service / Container Apps)"), true, "Custom runtime required."),
          layer("Analytics/Grounding", ["Azure AI Search (vector / hybrid)"], true, "Advanced/custom document retrieval layer."),
          NR("Orchestration", "Read-only retrieval — no orchestration."),
          layer("AI Platform", ["Azure AI Foundry / Foundry Models", "Azure OpenAI model deployment in Azure AI Foundry"], true, "Azure AI Foundry lifecycle capabilities only when lifecycle controls are explicit."),
          layer("Knowledge/Data", documentSourceList(input).length ? documentSourceList(input) : ["Documents / Blob / SharePoint"], true, "Source documents."),
          layer(
            "Integration",
            [
              "Document ingestion/indexing pipeline",
              "Azure AI Search index",
              ...(input.advancedRagRequirements?.some((r) => ["ocr_enrichment", "custom_chunking"].includes(r))
                ? ["Optional custom enrichment / OCR / chunking"]
                : []),
              "Source connector to Blob / SharePoint / documents"
            ],
            true,
            "Advanced/custom RAG requires ingestion and indexing integration."
          ),
          layer("Security", ["Entra ID (or Entra External ID)", "Repository permissions"], true, "Per-source ACLs."),
          layer("Observability", ["App Insights"], false, "Optional."),
          layer("Network/Deployment", ["Public unless private overlay explicitly selected"], true, "No hybrid unless explicitly required.")
        ]
      };
    }
  },

  /* ---------- Azure AI Foundry Application ---------- */
  azure_ai_foundry_app: {
    id: "azure_ai_foundry_app",
    name: "Azure AI Foundry",
    build: (input) => {
      const channels = channelLabels(input);
      const modelSelections = modelStrategySelections(input);
      const useAzureMl = wantsAzureMachineLearning(input);
      const multiModel = hasMultipleModelStrategies(input);
      const external = hasExternalUser(input) || hasExternalChannel(input);
      const internetFacing = needsPublicEdgeControls(input);
      const copilotStudioSelected = input.runtimePreferences.includes("copilot_studio");
      const runtime = runtimeSelections(
        input,
        input.runtimePreferences.includes("custom_backend")
          ? "Custom Backend + Azure AI SDK"
          : "Azure AI Foundry Agent Service"
      );
      const aiPlatform = [
        "Azure AI Foundry project",
        ...modelSelections,
        ...(useAzureMl ? ["Azure Machine Learning for custom model lifecycle / serving"] : []),
        ...(multiModel ? ["Multi-model routing / task-to-model selection"] : [])
      ];
      return {
        recommendedStack: [
          ...(channels.length ? channels : ["Selected channel"]),
          ...runtime,
          "Azure AI Foundry project",
          ...modelSelections,
          ...(useAzureMl
            ? ["Azure Machine Learning workspace / registry", "Azure Machine Learning managed online endpoint"]
            : []),
          "Azure AI Foundry evaluation / tracing / monitoring",
          ...(external ? ["API Management (APIM)", ...(internetFacing ? ["Front Door + WAF"] : [])] : []),
          ...identityFor(input)
        ],
        optionalAddOns: [
          ...(input.dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source))
            ? ["Azure AI Search (if advanced/custom RAG is explicitly required)"]
            : []),
          "Azure Machine Learning prompt/model evaluation pipelines",
          "Private Link (if no-public-endpoints is selected)"
        ],
        forbiddenUnlessConfirmed: [
          "Copilot Studio as the user experience unless explicitly selected",
          "M365 Agents SDK unless M365 extensibility is explicitly required",
          "Fabric Data Agent unless Fabric analytics source is selected"
        ],
        blockedComponents: ["Direct LLM-to-database write", "Unversioned production model deployment"],
        rationale: [
          "Azure AI Foundry is the right platform family when the scenario requires Foundry Agent Service, model catalog selection, fine-tuned models, model routing/versioning, or Azure Machine Learning integration.",
          useAzureMl
            ? "Azure Machine Learning is included alongside selected Azure OpenAI model deployments in Azure AI Foundry / Foundry model deployments so different model types can serve different tasks."
            : "Model operations stay in Azure AI Foundry with the selected Azure OpenAI model deployment, Foundry catalog/open, fine-tuned, or BYO model deployments."
        ],
        endToEndFlow: [
          `User enters through ${channels[0] || "the selected channel"}`,
          `${runtime[0]} receives and validates the request`,
          "Azure AI Foundry selects the approved model deployment and applies evaluation / tracing policies",
          multiModel
            ? "The app routes each task to the selected Azure OpenAI model deployment in Azure AI Foundry, Foundry catalog/open model, partner model such as Claude/Opus or Grok, fine-tuned model, BYO model, or Azure Machine Learning endpoint"
            : useAzureMl
            ? "The app calls the Azure Machine Learning managed online endpoint for custom model inference"
            : "The app calls the Azure AI Foundry / Foundry Models endpoint",
          "Governed connectors or APIs retrieve approved business/data context as needed",
          "The response is returned through the selected channel"
        ],
        finalRecommendation:
          multiModel
            ? "Use Azure AI Foundry model operations to coordinate the selected model portfolio. Run Azure OpenAI model deployments in Azure AI Foundry, Foundry catalog/open models, partner models such as Claude/Opus or Grok, fine-tuned models, BYO models, and Azure Machine Learning endpoints together when they serve different task types."
            : "Use Azure AI Foundry as the primary AI platform for model selection, fine-tuning/custom model operations, evaluation, tracing and governed deployment. Add Azure Machine Learning when the workload needs custom ML training, registry, managed endpoint serving, or bring-your-own-model hosting.",
        architectureLayers: [
          layer("User/Channel", channels.length ? channels : ["Selected channel"], true, "Selected experience surface."),
          layer("Identity", identityFor(input), true, "Identity for the target users."),
          layer(
            "Experience",
            copilotStudioSelected ? ["Copilot Studio agent"] : channels.length ? channels : ["Custom UI / API"],
            true,
            copilotStudioSelected
              ? "Copilot Studio is explicitly selected as the user-facing experience while Foundry supplies the agent/model runtime."
              : "Selected experience layer."
          ),
          layer("Runtime/Backend", runtime, true, "Foundry/SDK runtime hosts the AI orchestration."),
          wantsAdvancedDocumentRag(input)
            ? layer("Analytics/Grounding", ["Azure AI Search (vector / hybrid)"], true, "Advanced/custom RAG was selected.")
            : NR("Analytics/Grounding", "Add retrieval only when data grounding is selected."),
          NR("Orchestration", "Add deterministic orchestration only for actions/transactions."),
          layer("AI Platform", aiPlatform, true, "Model catalog, fine-tuning, Azure OpenAI model deployments in Azure AI Foundry, or Azure ML model operations are explicit."),
          layer("Knowledge/Data", knowledgeDataSelections(input).length ? knowledgeDataSelections(input) : ["Training / evaluation / grounding datasets as needed"], true, "Data used for grounding, model customization, or evaluation."),
          layer(
            "Integration",
            [
              ...(external ? ["API Management (APIM)"] : []),
              "Model deployment endpoint",
              ...(useAzureMl ? ["Azure Machine Learning managed online endpoint"] : []),
              ...(knowledgeDataSelections(input).length ? ["Governed connectors / APIs"] : [])
            ],
            true,
            "Applications call model and data endpoints through governed interfaces."
          ),
          layer(
            "Security",
            [...(internetFacing ? ["Front Door / WAF"] : []), ...identityFor(input), "RBAC / authorization checks", "Managed Identity", "Key Vault"],
            true,
            "Secure model and endpoint access."
          ),
          layer(
            "Observability",
            ["Azure AI Foundry evaluation / tracing / monitoring", ...(useAzureMl ? ["Azure Machine Learning endpoint monitoring"] : [])],
            true,
            "Model operations require evaluation, tracing and monitoring."
          ),
          layer(
            "Network/Deployment",
            [internetFacing ? "Public endpoint via Front Door/WAF" : "Public unless private overlay explicitly selected"],
            true,
            "Hybrid/private overlay only when explicitly selected."
          )
        ]
      };
    }
  },

  /* ---------- External AI App / Portal ---------- */
  external_ai_app: {
    id: "external_ai_app",
    name: "External AI App / Portal",
    build: (input) => {
      const allChannels = channelLabels(input);
      const externalChannels = primaryExternalChannelLabels(input);
      const channels = hasExternalUser(input) && externalChannels.length ? externalChannels : allChannels;
      const internetFacing = needsPublicEdgeControls(input);
      const advancedRag = wantsAdvancedDocumentRag(input);
      const hasFabric = wantsFabricDataAgent(input);
      const fabricSources = fabricSourceList(input);
      const selectedRuntime = input.runtimePreferences.some((r) => !["none", "unknown"].includes(r));
      const runtime = runtimeSelections(
        input,
        input.runtimePreferences.includes("foundry_agent_service")
          ? "Azure AI Foundry Agent Service"
          : "Custom Backend (App Service / Container Apps / Functions)"
      );
      const documentSources = documentSourceList(input);
      const operationalSources = operationalStructuredSourceList(input);
      const backendDataSelections = [
        ...(hasFabric ? ["Governed Fabric access layer", ...fabricSources] : []),
        ...operationalSources
      ];
      const analyticsGrounding = [
        ...(hasFabric ? ["Microsoft Fabric Data Agent", "Fabric Data Agent → Fabric source"] : []),
        ...(advancedRag ? ["Azure AI Search (vector / hybrid)"] : [])
      ];
      const integration = [
        "API Management (APIM)",
        ...(hasFabric ? ["Fabric Data Agent connection"] : []),
        ...(advancedRag ? ["Document ingestion/indexing pipeline", "Azure AI Search index"] : []),
        ...(input.dataSources.includes("apis") ? ["Backend API access to selected Business APIs"] : []),
        ...(input.dataSources.includes("erp_crm") ? ["Backend API access to ERP / CRM systems"] : []),
        ...(input.dataSources.includes("azure_sql") ? ["Governed Azure SQL access through backend API"] : []),
        ...(input.dataSources.includes("dataverse") ? ["Governed Dataverse access through backend API"] : []),
        ...(input.dataSources.includes("on_prem") ? ["Private API facade / governed connector for on-premises systems"] : [])
      ];
      return {
        recommendedStack: [
          ...(channels.length ? channels : ["Web / Mobile / Portal / API"]),
          ...runtime,
          ...(advancedRag ? ["Azure AI Search (vector / hybrid)"] : []),
          "Azure AI Foundry / Foundry Models",
          "Azure OpenAI model deployment in Azure AI Foundry",
          "API Management (APIM)",
          ...(internetFacing ? ["Front Door + WAF"] : []),
          ...identityFor(input),
          ...(advancedRag ? documentSources : []),
          ...(backendDataSelections.length ? backendDataSelections : []),
          "Application Insights"
        ],
        optionalAddOns: [
          ...(selectedRuntime ? [] : ["Azure AI Foundry Agent Service (if a managed agent runtime is preferred)"]),
          ...(documentSources.length ? ["Azure AI Search (if advanced/custom RAG is explicitly required)"] : []),
          "Private Link (if no-public-endpoints is selected)"
        ],
        forbiddenUnlessConfirmed: [
          "M365 Agents SDK (not implied by mobile/web/API)",
          hasFabric
            ? "Direct client-to-Fabric access"
            : "Fabric Data Agent (no Fabric analytics source)"
        ],
        blockedComponents: ["Direct LLM-to-database write"],
        rationale: [
          "External channel + external users → web/mobile/portal/API experience with a custom backend or Foundry Agent Service.",
          "M365 Agents SDK is never implied by mobile/web/API.",
          ...(hasFabric
            ? ["Fabric sources are handled through Microsoft Fabric Data Agent; external users require a governed identity and Fabric permission model."]
            : []),
          ...(advancedRag
            ? ["Azure AI Search is included because advanced/custom document RAG was selected for the external app."]
            : [])
        ],
        endToEndFlow: advancedRag && hasFabric
          ? [
              `External user opens the ${channels[0] || "app"}`,
              internetFacing ? "Front Door / WAF and APIM front the backend" : "APIM fronts the backend",
              `${runtime[0]} authenticates and authorizes the request`,
              "Backend calls Azure AI Foundry / Foundry Models for reasoning",
              "Microsoft Fabric Data Agent queries the governed Fabric Lakehouse / Warehouse path",
              "Backend performs document retrieval through Azure AI Search for the confirmed document corpus",
              `Response returns to the ${channels[0] || "app"}`
            ]
          : advancedRag
          ? [
              `External customer opens the ${channels[0] || "app"}`,
              `${channels[0] || "The app"} authenticates through Entra External ID`,
              `${channels[0] || "The app"} calls APIM / backend`,
              `${runtime[0]} performs retrieval through Azure AI Search`,
              "Azure OpenAI model deployment in Azure AI Foundry generates the grounded answer or summary",
              `Response returns to the ${channels[0] || "app"}`
            ]
          : hasFabric
          ? [
              `External user opens the ${channels[0] || "app"}`,
              internetFacing ? "Front Door / WAF and APIM front the backend" : "APIM fronts the backend",
              `${runtime[0]} authenticates and authorizes the request`,
              "Backend calls Azure AI Foundry / Foundry Models for reasoning",
              "Microsoft Fabric Data Agent queries the governed Fabric Lakehouse / Warehouse path",
              `Response returns to the ${channels[0] || "app"}`
            ]
          : [
              internetFacing ? "User opens the app from the internet" : "User opens the app through the approved access path",
              internetFacing ? "Front Door / WAF + APIM front the backend" : "APIM fronts the backend",
              `${runtime[0]} authenticates the user and orchestrates the request`,
              input.dataSources.includes("apis")
                ? "Backend calls Azure AI Foundry / Foundry Models and selected business APIs"
                : "Backend calls Azure AI Foundry / Foundry Models and selected governed data access layers",
              "Response returned to the app"
            ],
        finalRecommendation: hasFabric
          ? `Deliver the ${channels[0] || "external experience"} fronted by APIM${internetFacing ? "/WAF" : ""}, backed by ${runtime[0]}, Azure AI Foundry / Foundry Models, and Microsoft Fabric Data Agent for Fabric grounding.`
          : `Deliver the ${channels[0] || "external experience"} fronted by APIM${internetFacing ? "/WAF" : ""}, backed by ${runtime[0]} and an Azure OpenAI model deployment in Azure AI Foundry.`,
        architectureLayers: [
          layer("User/Channel", channels.length ? channels : ["Web / Mobile / Portal / API"], true, "External-facing channel(s)."),
          layer("Identity", identityFor(input), true, "Identity for target users."),
          layer("Experience", channels.length ? channels : ["Custom UI"], true, "Custom UI."),
          layer("Runtime/Backend", runtime, true, "Custom runtime required for external apps."),
          analyticsGrounding.length
            ? layer("Analytics/Grounding", analyticsGrounding, true, hasFabric ? "Fabric sources are grounded through Microsoft Fabric Data Agent." : "Advanced/custom document retrieval layer.")
            : NR("Analytics/Grounding", "No grounding source selected."),
          NR("Orchestration", "Not required unless behavior is actionable."),
          layer("AI Platform", ["Azure AI Foundry / Foundry Models", "Azure OpenAI model deployment in Azure AI Foundry"], true, "Azure AI Foundry lifecycle capabilities only when lifecycle controls are explicit."),
          layer("Knowledge/Data", knowledgeDataSelections(input).length ? knowledgeDataSelections(input) : ["Configured backend data source"], true, "Connected via backend."),
          layer(
            "Integration",
            integration,
            true,
            hasFabric ? "APIM fronts the app and Microsoft Fabric Data Agent handles the Fabric connection." : advancedRag ? "APIM fronts the app and advanced RAG uses an indexing pipeline." : "APIM fronts integrations."
          ),
          layer("Security", [...(internetFacing ? ["Front Door / WAF"] : []), "APIM", ...identityFor(input), "RBAC / authorization checks", ...(hasFabric ? ["Fabric / Power BI permissions"] : [])], true, "Edge + identity controls."),
          layer("Observability", ["App Insights / Log Analytics"], false, "Recommended baseline."),
          layer("Network/Deployment", [internetFacing ? "Public endpoint via Front Door/WAF" : "APIM-fronted backend"], true, "Hybrid overlay only if explicitly required.")
        ]
      };
    }
  },

  /* ---------- Business Action / Transaction Agent ---------- */
  business_action_agent: {
    id: "business_action_agent",
    name: "Deterministic Action Architecture",
    build: (input) => {
      const channels = channelLabels(input);
      const teams = hasTeamsChannel(input);
      const internal = hasInternalUser(input);
      const hasSql = hasAzureSqlSource(input);
      const hasOperational =
        hasOperationalStructuredSource(input) || input.dataSources.includes("on_prem");
      const operationalSources = operationalStructuredSourceList(input);
      const copilotStudioPreferred =
        input.runtimePreferences.includes("copilot_studio");
      const longRunning = input.behaviors.includes("long_running_process");
      const approval = input.behaviors.includes("approval") || input.capabilities.includes("approval");
      const customExecution = input.runtimePreferences.some((r) =>
        ["custom_backend", "functions", "app_service", "container_apps", "aks"].includes(r)
      );
      const apimRequired = input.securityControls.includes("apim") || customExecution || input.channels.includes("api");

      // Copilot Studio is the experience for internal Teams/M365 scenarios
      // (especially Copilot Studio + operational write/action). The deterministic
      // execution layer remains a separate, non-LLM component.
      const useCopilotStudioExperience = teams && internal &&
        (copilotStudioPreferred || hasOperational);

      const experience = useCopilotStudioExperience
        ? ["Copilot Studio agent"]
        : channels.length
          ? channels
          : ["Custom UI"];

      // Deterministic execution layer — never the LLM.
      const runtime = useCopilotStudioExperience
        ? [
            "Copilot Studio managed runtime",
            "Power Automate cloud flow invoked as a Copilot Studio action"
          ]
        : runtimeSelections(input, "Custom Backend (App Service / Container Apps / Functions)");

      const multiAgent = input.behaviors.includes("multi_agent");
      const orchestration: string[] = useCopilotStudioExperience
        ? [
            "Power Automate cloud flow (deterministic)",
            ...(approval ? ["Power Automate Approvals"] : []),
            ...(longRunning || customExecution ? ["Logic Apps / Durable Functions for long-running custom workflow"] : []),
            ...(multiAgent ? ["Agent Framework / Semantic Kernel (multi-agent)"] : [])
          ]
        : [
            "Durable Functions / Logic Apps (deterministic)",
            ...(multiAgent ? ["Agent Framework / Semantic Kernel (multi-agent)"] : [])
          ];

      // Integration / governed write layer (writes must go through this).
      const integration: string[] = useCopilotStudioExperience
        ? [
            "Copilot Studio action / tool",
            "Power Automate cloud flow",
            ...(approval ? ["Power Automate Approvals connector"] : []),
            ...(hasSql
              ? [
                  "Power Automate SQL Server connector for Azure SQL / SQL Server",
                  "Parameterized stored procedure or approved SQL connector operation"
                ]
              : ["Power Platform connector / approved connector operation"]),
            ...(apimRequired ? ["API Management (APIM) for custom backend/API"] : [])
          ]
        : ["APIM in front of business APIs"];
      if (hasOperational && !useCopilotStudioExperience) {
        integration.push(
          hasSql
            ? "Parameterized stored procedures / controlled backend APIs / approved connector operations for Azure SQL"
            : "Controlled backend APIs / approved connector operations / predefined business actions for operational data"
        );
      }

      // Knowledge / Data
      const knowledge = knowledgeDataSelections(input).length
        ? knowledgeDataSelections(input)
        : ["Business APIs / ERP / CRM / SQL / Dataverse"];

      // Flow
      const opLabel = operationalSources.join(" / ") || "the operational data source";
      let flow: string[];
      if (useCopilotStudioExperience && hasOperational) {
        flow = [
          `Employee opens the agent in ${channels[0] || "Teams / Microsoft 365"}`,
          "Copilot Studio receives the request and identifies the requested action",
          "User confirms the action (confirmation step for sensitive writes)",
          "Copilot Studio invokes a validated action / tool backed by a Power Automate cloud flow",
          hasSql
            ? `Power Automate uses the SQL Server connector for Azure SQL / SQL Server and executes only an approved connector operation or parameterized stored procedure against ${opLabel}`
            : `Power Automate uses an approved connector operation or predefined business action against ${opLabel}`,
          "The system of record performs only the approved write/operation under least-privilege permissions",
          "Audit log captures every action",
          "Copilot Studio returns the confirmation/result to the user"
        ];
      } else {
        flow = [
          `User submits a request via ${channels[0] || "the selected channel"}`,
          "Backend authenticates and validates the request",
          "Deterministic orchestration plans the steps",
          "Backend invokes business APIs through APIM",
          "Azure OpenAI model deployment in Azure AI Foundry assists with reasoning where needed",
          "Audit log captures every action",
          "Result returned to the user"
        ];
      }

      // Final recommendation
      const finalRecommendation = useCopilotStudioExperience && hasOperational
        ? "Use Copilot Studio as the experience layer in Teams / Microsoft 365. Expose the operation as a Copilot Studio action/tool backed by a Power Automate cloud flow. For Azure SQL / SQL Server, use the Power Automate SQL Server connector or an approved custom connector to run only parameterized stored procedures or approved connector operations. The LLM never writes to systems of record directly."
        : "Use a custom backend with deterministic orchestration (Durable Functions / Logic Apps) — and Agent Framework only where true agent orchestration is needed — with all writes flowing through controlled backend API operations or approved business APIs.";

      // Rationale
      const rationale: string[] = [
        "Behavior includes write-back, approval, transaction, or multi-agent — deterministic orchestration and audit are required.",
        "LLM must never write directly to systems of record; APIs are the boundary."
      ];
      if (useCopilotStudioExperience && hasOperational) {
        rationale.push(
          "Copilot Studio uses actions/tools for execution. For SQL Server/Azure SQL, the recommended implementation is a Power Automate cloud flow with the SQL Server connector, approved custom connector, or parameterized stored procedure — never direct LLM-to-database access."
        );
      }

      // Security
      const security: string[] = [
        "Entra ID",
        "Azure RBAC / authorization checks",
        "Audit logging",
        ...(useCopilotStudioExperience ? ["Power Platform connection references / connector permissions"] : ["APIM", "Managed Identity", "Key Vault"])
      ];
      if (useCopilotStudioExperience && apimRequired) security.push("APIM");
      if (useCopilotStudioExperience && input.securityControls.includes("managed_identity")) security.push("Managed Identity");
      if (useCopilotStudioExperience && input.securityControls.includes("key_vault")) security.push("Key Vault");
      if (hasSql) security.push("Least-privilege SQL permissions");
      else if (hasOperational) security.push("Least-privilege system-of-record permissions");

      // Stack
      const stack: string[] = [
        ...(channels.length ? channels : ["Selected channel"]),
        ...(useCopilotStudioExperience ? ["Copilot Studio"] : []),
        ...runtime,
        ...orchestration,
        ...(apimRequired ? ["API Management (APIM)"] : []),
        ...(hasOperational
          ? [
              ...(operationalSources.length ? operationalSources : ["Operational structured data source"]),
              ...(hasSql
                ? ["Power Automate SQL Server connector", "Parameterized stored procedures / approved SQL connector operations"]
                : ["Power Platform connector / approved connector actions"]),
              hasSql ? "Least-privilege SQL permissions" : "Least-privilege system-of-record permissions"
            ]
          : ["Business APIs (ERP / CRM / SQL / Dataverse)"]),
        "Audit logging",
        ...(input.securityControls.includes("managed_identity") || !useCopilotStudioExperience ? ["Managed Identity"] : []),
        ...(input.securityControls.includes("key_vault") || !useCopilotStudioExperience ? ["Key Vault"] : []),
        "Azure OpenAI model deployment in Azure AI Foundry",
        ...identityFor(input)
      ];

      return {
        recommendedStack: stack,
        optionalAddOns: [
          "Event Grid / Service Bus for async events",
          ...(useCopilotStudioExperience && hasOperational
            ? ["Confirmation step for sensitive write operations"]
            : [])
        ],
        forbiddenUnlessConfirmed: [],
        blockedComponents: [
          "Direct LLM-to-database write",
          "Direct LLM-to-SQL writes",
          "Direct LLM-to-system-of-record writes",
          "Generated SQL executed directly by the model",
          "Copilot Studio Agent → Azure SQL direct write",
          "Copilot Studio Agent → system-of-record direct write",
          "Microsoft 365 Copilot LLM → Azure SQL",
          "Read-only analytics architecture as the final answer"
        ],
        rationale,
        endToEndFlow: flow,
        finalRecommendation,
        architectureLayers: [
          layer(
            "User/Channel",
            channels.length ? channels : ["Selected channel"],
            true,
            "Selected channel."
          ),
          layer("Identity", identityFor(input), true, "Per user population."),
          layer("Experience", experience, true, "Experience layer."),
          layer(
            "Runtime/Backend",
            runtime,
            true,
            useCopilotStudioExperience && hasOperational
              ? "Copilot Studio is the experience; Power Automate actions/tools carry out writes through approved connectors."
              : "Required for actions."
          ),
          NR("Analytics/Grounding", "Not required."),
          layer(
            "Orchestration",
            orchestration,
            true,
            useCopilotStudioExperience
              ? "Copilot Studio actions invoke deterministic Power Automate flows for actions/transactions."
              : "Deterministic orchestration for actions/transactions."
          ),
          layer(
            "AI Platform",
            useCopilotStudioExperience
              ? ["Copilot Studio (managed)", "Azure OpenAI model deployment in Azure AI Foundry (reasoning support only)"]
              : ["Azure AI Foundry / Foundry Models", "Azure OpenAI model deployment in Azure AI Foundry"],
            true,
            "LLM assists with reasoning only — never executes writes."
          ),
          layer(
            "Knowledge/Data",
            knowledge,
            true,
            "Systems of record reached via APIs / governed operations."
          ),
          layer(
            "Integration",
            integration,
            true,
            hasOperational
              ? useCopilotStudioExperience
                ? "All operational writes go through Copilot Studio actions/tools backed by Power Automate connector operations, approved custom connectors, or parameterized stored procedures."
                : "All operational writes go through parameterized stored procedures / controlled backend APIs / approved connector operations / predefined business actions."
              : "Single managed entry."
          ),
          layer("Security", security, true, "Required for transactional flows."),
          layer(
            "Observability",
            ["App Insights + audit logging"],
            true,
            "Required for transactional flows."
          ),
          layer(
            "Network/Deployment",
            ["Public unless private overlay explicitly selected"],
            true,
            "Hybrid overlay only if explicit."
          )
        ]
      };
    }
  },

  /* ---------- Custom AI App with Azure AI Foundry model deployment ---------- */
  custom_ai_app: {
    id: "custom_ai_app",
    name: "Custom AI App with Azure AI Foundry Model Deployment",
    build: (input) => {
      const channels = channelLabels(input);
      const runtime = runtimeSelections(input, "Custom Backend (App Service / Container Apps)");
      return {
        recommendedStack: [
          ...(channels.length ? channels : ["Custom channel"]),
          ...runtime,
          "Azure OpenAI model deployment in Azure AI Foundry",
          ...identityFor(input)
        ],
        optionalAddOns: [
          "APIM",
          ...(input.dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source))
            ? ["Azure AI Search (if advanced/custom RAG is explicitly required)"]
            : [])
        ],
        forbiddenUnlessConfirmed: [
          "M365 Agents SDK unless extensibility explicitly required"
        ],
        blockedComponents: ["Direct LLM-to-database write"],
        rationale: [
          "Custom application with Azure AI Foundry / Foundry Models — no Microsoft 365 or Fabric grounding requirement was indicated."
        ],
        endToEndFlow: [
          `User interacts via ${channels[0] || "the custom channel"}`,
          `${runtime[0]} receives the request`,
          "Backend calls Azure AI Foundry / Foundry Models",
          "Response returned to the user"
        ],
        finalRecommendation:
          "Build a custom AI application on an Azure OpenAI model deployment in Azure AI Foundry with a backend of your choice.",
        architectureLayers: [
          layer("User/Channel", channels.length ? channels : ["Custom channel"], true, "Selected channel."),
          layer("Identity", identityFor(input), true, "Selected identity provider."),
          layer("Experience", channels.length ? channels : ["Custom UI"], true, "Custom UI."),
          layer("Runtime/Backend", runtime, true, "Custom runtime."),
          NR("Analytics/Grounding", "No grounding requirement specified."),
          NR("Orchestration", "Not required."),
          layer("AI Platform", ["Azure AI Foundry / Foundry Models", "Azure OpenAI model deployment in Azure AI Foundry"], true, "Azure AI Foundry lifecycle capabilities only when lifecycle controls are explicit."),
          layer("Knowledge/Data", knowledgeDataSelections(input).length ? knowledgeDataSelections(input) : ["—"], false, "Optional."),
          NR("Integration", "Not required."),
          layer("Security", ["Entra ID"], true, "Baseline."),
          layer("Observability", ["App Insights"], false, "Optional."),
          layer("Network/Deployment", ["Public unless overlay applied"], true, "Public by default.")
        ]
      };
    }
  }
};

/* ================================================================
 * Pattern resolution (priority order)
 * ================================================================ */

export function candidateBasePatterns(rawInput: DecisionInput): string[] {
  const input = normalizeDecisionInput(rawInput);
  const out: string[] = [];

  /* 1. Fabric Analytics Route */
  if (shouldUseCopilotStudioForFabric(input)) {
    out.push("copilot_studio_fabric_data_agent");
  }

  const copilotStudioExperiencePreferred =
    hasInternalUser(input) &&
    hasTeamsChannel(input) &&
    input.runtimePreferences.includes("copilot_studio") &&
    !input.runtimePreferences.includes("foundry_agent_service");

  /* 2. Azure AI Foundry / custom model route */
  if (wantsFoundryApplication(input) && !copilotStudioExperiencePreferred) {
    if (!out.includes("azure_ai_foundry_app")) out.push("azure_ai_foundry_app");
  }

  /* 3. Deterministic action route */
  if (isActionable(input)) {
    if (!out.includes("business_action_agent")) out.push("business_action_agent");
  }

  /* 4. External Web/Mobile/Portal/API Route */
  if (hasExternalUser(input) && hasExternalChannel(input)) {
    if (!out.includes("external_ai_app")) out.push("external_ai_app");
  }

  /* 5. M365 Copilot Personal Productivity */
  if (isM365PersonalProductivityOnly(input)) {
    if (!out.includes("m365_copilot_productivity")) out.push("m365_copilot_productivity");
  }

  /* 6. Simple Copilot Studio Native Knowledge Route */
  if (wantsSimpleCopilotStudioKnowledge(input)) {
    if (!out.includes("copilot_studio_internal_assistant"))
      out.push("copilot_studio_internal_assistant");
  }

  /* 7. Advanced/custom Document RAG Route */
  if (wantsAdvancedDocumentRag(input) && !wantsFabricDataAgent(input)) {
    if (!out.includes("document_rag_agent")) out.push("document_rag_agent");
  }

  /* 8. Copilot Studio Internal Assistant */
  if (
    hasInternalUser(input) &&
    hasTeamsChannel(input) &&
    !isActionable(input) &&
    !out.includes("copilot_studio_fabric_data_agent")
  ) {
    if (
      input.capabilities.includes("employee_assistant") ||
      input.capabilities.includes("multi_agent") ||
      input.capabilities.includes("operational_query") ||
      hasOperationalStructuredSource(input) ||
      input.dataSources.includes("on_prem") ||
      input.behaviors.some((b) => ["qa", "retrieval", "summarization", "read_only_query"].includes(b))
    ) {
      if (!out.includes("copilot_studio_internal_assistant"))
        out.push("copilot_studio_internal_assistant");
    }
  }

  /* 9. Custom AI App fallback */
  if (out.length === 0 && needsClarificationBeforeArchitecture(input)) {
    out.push("clarification_required");
  }

  /* 10. Custom AI App fallback */
  if (out.length === 0) {
    out.push("custom_ai_app");
  }

  return out;
}

/* Choose primary base pattern (first by priority) */
export function selectPrimaryPattern(input: DecisionInput): {
  primaryId: string;
  candidates: string[];
} {
  const candidates = candidateBasePatterns(input);
  return { primaryId: candidates[0], candidates };
}
