import type {
  ArchitectureDecision,
  ArchitectureLayer,
  ArchitectureOverlay,
  DecisionInput,
  WizardQuestion
} from "./types";
import { PATTERNS, NOT_REQUIRED, selectPrimaryPattern } from "./patterns";
import { nextQuestion, applicableQuestions } from "./questions";
import { normalizeDecisionInput } from "./input-normalization";
import { normalizeArchitectureDecision } from "./architecture-cleanup";
import {
  hasExternalChannel,
  hasExternalUser,
  hasConfirmedExternalSurface,
  needsPublicEdgeControls,
  hasPrivateConnectivityRequirement,
  hasFabricSource,
  hasInternalUser,
  hasOperationalStructuredSource,
  hasTeamsChannel,
  isActionable,
  requiresOrchestration,
  needsSemanticModelGuidance,
  selectedNetworkNames,
  selectedSecurityNames,
  wantsDocumentRAG,
  wantsAzureMachineLearning,
  wantsFoundryLifecycle,
  wantsFabricAnalyticsQa,
  wantsFabricDataAgent,
  fabricDataAgentUserAccessAllowed,
  needsFabricPermissionWarning,
  wantsHybridOverlay,
  wantsM365AgentsSdk,
  wantsModelCustomization,
  computeConfidenceLevel,
  skippedCoreGateLabels
} from "./rules";

/* ================================================================
 * Overlay builders
 * ================================================================ */

type OverlayApplyFn = (
  base: BaseShape,
  input: DecisionInput
) => { base: BaseShape; overlay: ArchitectureOverlay | null };

type BaseShape = ReturnType<(typeof PATTERNS)[keyof typeof PATTERNS]["build"]> & {
  basePatternId: string;
  basePatternName: string;
};

function upsertLayer(layers: ArchitectureLayer[], updated: ArchitectureLayer) {
  const i = layers.findIndex((l) => l.layer === updated.layer);
  const merged: ArchitectureLayer = (() => {
    if (i < 0) return updated;
    const existing = layers[i];
    if (
      existing.selections.length === 1 &&
      existing.selections[0] === NOT_REQUIRED
    ) {
      return updated;
    }
    return {
      ...existing,
      required: existing.required || updated.required,
      selections: Array.from(new Set([...existing.selections, ...updated.selections])),
      reason: mergeReasons(existing.reason, updated.reason)
    };
  })();
  if (i < 0) layers.push(merged);
  else layers[i] = merged;
}

function mergeReasons(a: string, b: string): string {
  const generic = /not part|not required|only if needed|selected by the user/i;
  const parts = [a, b]
    .flatMap((reason) => reason.split(/(?<=[.!?])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
  const deduped = Array.from(new Map(parts.map((part) => [part.toLowerCase(), part])).values());
  const specific = deduped.filter((part) => !generic.test(part));
  return (specific.length ? specific : deduped).slice(0, 2).join(" ");
}

/**
 * A managed Copilot Studio base (internal assistant, Fabric data agent, or a Copilot
 * Studio-fronted action agent) with no custom backend / Foundry Agent Service runtime and
 * no model customization. These run on Copilot Studio's managed model + analytics, so they
 * must not acquire customer-run Foundry model operations merely for monitoring.
 * Private connectivity is evaluated separately for supported outbound integrations.
 */
function isManagedCopilotStudioBase(base: BaseShape, input: DecisionInput): boolean {
  const customRuntime = input.runtimePreferences.some((r) =>
    ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)
  );
  const isCopilotExperience = base.architectureLayers.some(
    (l) => l.layer === "Experience" && /copilot studio/i.test(l.selections.join(" "))
  );
  return (
    isCopilotExperience &&
    !customRuntime &&
    !wantsModelCustomization(input) &&
    !wantsDocumentRAG(input) &&
    ["copilot_studio_internal_assistant", "copilot_studio_fabric_data_agent", "business_action_agent"].includes(base.basePatternId)
  );
}

/* ---------- 1. Azure AI Foundry lifecycle capabilities ---------- */
const overlayFoundry: OverlayApplyFn = (base, input) => {
  if (!wantsFoundryLifecycle(input)) {
    return { base, overlay: null };
  }
  // Managed Copilot Studio uses Copilot Studio analytics + Application Insights for
  // monitoring/tracing — it does not run Azure AI Foundry. Keep it in the Copilot Studio
  // family rather than injecting Foundry model ops / Foundry Models.
  if (isManagedCopilotStudioBase(base, input)) {
    upsertLayer(base.architectureLayers, {
      layer: "Observability",
      selections: ["Copilot Studio analytics", "Application Insights"],
      required: true,
      reason: "Lifecycle/monitoring for a managed Copilot Studio agent uses Copilot Studio analytics and Application Insights, not Azure AI Foundry."
    });
    return { base, overlay: null };
  }
  const adds: string[] = [
    "Azure AI Foundry (evaluation, tracing, monitoring, governance)"
  ];
  if (input.lifecycleControls.includes("prompt_versioning"))
    adds.push("Prompt versioning in Foundry");
  if (input.lifecycleControls.includes("model_versioning"))
    adds.push("Model versioning in Foundry");
  if (input.lifecycleControls.includes("model_routing"))
    adds.push("Model routing via Foundry");
  base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...adds]));
  base.rationale.push(
    "Azure AI Foundry is included because explicit lifecycle controls were selected."
  );
  upsertLayer(base.architectureLayers, {
    layer: "AI Platform",
    selections: ["Azure AI Foundry / Foundry Models", "Azure OpenAI model deployment in Azure AI Foundry"],
    required: true,
    reason: "Explicit lifecycle controls selected."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Observability",
    selections: ["Foundry evaluation / tracing / monitoring"],
    required: true,
    reason: "Lifecycle controls require observability."
  });
  return { base, overlay: null };
};

/* ---------- 1b. Model customization / Azure Machine Learning Overlay ---------- */
const modelStrategyLabels = (input: DecisionInput): string[] => {
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
  return (input.modelStrategy ?? []).filter((m) => map[m]).map((m) => map[m]);
};

const overlayModelCustomization: OverlayApplyFn = (base, input) => {
  const selectedAll = modelStrategyLabels(input);
  if (selectedAll.length === 0 && !wantsModelCustomization(input)) {
    return { base, overlay: null };
  }
  const useAzureMl = wantsAzureMachineLearning(input);
  const adds = [
    "Multi-model portfolio via Azure AI Foundry model operations",
    ...selectedAll,
    ...(useAzureMl
      ? ["Azure Machine Learning workspace / registry", "Azure Machine Learning managed online endpoint"]
      : [])
  ];
  base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...adds]));
  base.rationale.push(
    useAzureMl
      ? "Multi-model portfolio added: Azure AI Foundry model operations coordinate selected Azure OpenAI, fine-tuned, Foundry catalog/BYO, and Azure Machine Learning models for different tasks."
      : "Azure AI Foundry model operations added: selected Azure OpenAI, Azure-sold Foundry, provider/open, fine-tuned, or custom model deployments can serve different tasks together."
  );
  upsertLayer(base.architectureLayers, {
    layer: "AI Platform",
    selections: [
      "Multi-model portfolio via Azure AI Foundry model operations",
      ...selectedAll,
      ...(useAzureMl ? ["Azure Machine Learning model lifecycle / serving"] : [])
    ],
    required: true,
    reason: "Multiple model types may run together for different purposes."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Integration",
    selections: [
      "Model deployment endpoint",
      ...(useAzureMl ? ["Azure Machine Learning managed online endpoint"] : [])
    ],
    required: true,
    reason: "Application must call the selected model endpoint through a governed interface."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Observability",
    selections: [
      "Azure AI Foundry model evaluation / tracing",
      ...(useAzureMl ? ["Azure Machine Learning endpoint monitoring"] : [])
    ],
    required: true,
    reason: "Multi-model deployments require model evaluation, tracing and endpoint monitoring."
  });
  return {
    base,
    overlay: {
      id: "model_customization_azure_ml",
      name: "Multi-model Portfolio / Azure Machine Learning",
      reason: "Multiple model types can serve different purposes across Azure OpenAI, Foundry model deployments, BYO models, and Azure Machine Learning endpoints.",
      required: true
    }
  };
};

/* ---------- 2. Hybrid / Private Deployment Overlay ---------- */
const overlayHybrid: OverlayApplyFn = (base, input) => {
  if (!wantsHybridOverlay(input)) return { base, overlay: null };
  // Residency-only SaaS governance does not replace an explicit private-connectivity requirement.
  const managedCopilotSaaS = isManagedCopilotStudioBase(base, input) && !hasPrivateConnectivityRequirement(input);
  if (managedCopilotSaaS) {
    const residency = input.networkControls.includes("data_residency") || input.networkControls.includes("regulated");
    const govStack = [
      ...(residency ? ["Microsoft-managed tenant region / data residency"] : []),
      "Microsoft Purview governance & DLP",
      "Conditional Access"
    ];
    base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...govStack]));
    upsertLayer(base.architectureLayers, {
      layer: "Network/Deployment",
      selections: ["SaaS — Microsoft-managed", ...(residency ? ["Tenant region / data residency"] : [])],
      required: true,
      reason: "Copilot Studio is Microsoft-managed SaaS; validate tenant-region availability, Purview/DLP and Conditional Access for the selected residency requirements."
    });
    base.rationale.push(
      "Residency-only requirements use Microsoft-managed SaaS governance (tenant region, Purview/DLP, Conditional Access); no private connectivity was requested."
    );
    return {
      base,
      overlay: {
        id: "managed_saas_governance",
        name: "Managed SaaS Governance",
        reason: "Validate regulated/data-residency needs against Microsoft-managed SaaS governance and tenant-region capabilities.",
        required: true
      }
    };
  }
  const overlayStack = [
    "APIM",
    isManagedCopilotStudioBase(base, input)
      ? "Power Platform VNet integration for supported outbound connectors"
      : "VNet integration",
    "Private Link / Private Endpoint",
    "Private DNS",
    "Azure Firewall (if needed)",
    "VPN / ExpressRoute (if on-prem)",
    "Managed Identity",
    "Key Vault",
    "Audit & monitoring"
  ];
  base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...overlayStack]));
  base.rationale.push(
    "Hybrid / private deployment overlay applied: explicit private/regulated/on-prem network controls selected."
  );
  upsertLayer(base.architectureLayers, {
    layer: "Network/Deployment",
    selections: [
      "Hybrid / private overlay: VNet + Private Link/Endpoint + Private DNS",
      ...(input.networkControls.includes("on_prem_connectivity") ||
      input.networkControls.includes("vpn") ||
      input.networkControls.includes("expressroute")
        ? ["VPN / ExpressRoute"]
        : []),
      ...(input.networkControls.includes("regulated") ? ["Regulated/sovereign controls"] : []),
      ...(input.networkControls.includes("data_residency") ? ["Region pinning for data residency"] : [])
    ],
    required: true,
    reason: "Explicit private/regulated/on-prem controls were selected."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: ["APIM", "Managed Identity", "Key Vault"],
    required: true,
    reason: "Required by hybrid overlay."
  });
  return {
    base,
    overlay: {
      id: "hybrid_private_deployment",
      name: "Hybrid / Private Deployment Overlay",
      reason: "Private/regulated/on-prem network controls were explicitly selected.",
      required: true
    }
  };
};

/* ---------- 3. Semantic Model Security Overlay ---------- */
const overlaySemanticModel: OverlayApplyFn = (base, input) => {
  if (!needsSemanticModelGuidance(input)) return { base, overlay: null };
  const notes = [
    "Power BI Semantic Model: Read permission required",
    "Workspace / item permissions",
    "RLS / OLS if applicable",
    "Semantic model readiness / Prep for AI"
  ];
  base.rationale.push(...notes);
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: notes,
    required: true,
    reason: "Power BI Semantic Model was selected as a data source."
  });
  return {
    base,
    overlay: {
      id: "semantic_model_security",
      name: "Power BI Semantic Model — Permissions & Readiness",
      reason: "Power BI Semantic Model selected: explicit permissions and Prep-for-AI required.",
      required: true
    }
  };
};

/* ---------- 4. APIM Edge Overlay (for external/internet-facing) ---------- */
const overlayApim: OverlayApplyFn = (base, input) => {
  const customOrApi =
    base.basePatternId === "external_ai_app" ||
    base.basePatternId === "custom_ai_app" ||
    input.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
    input.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
    hasOperationalStructuredSource(input) ||
    isActionable(input);
  const externalFacing = hasConfirmedExternalSurface(input) ||
    ((input.securityControls.includes("apim") || input.securityControls.includes("waf")) && customOrApi);
  if (!externalFacing) return { base, overlay: null };
  if (base.basePatternId === "m365_copilot_productivity") return { base, overlay: null };
  const adds: string[] = ["API Management (APIM)"];
  if (needsPublicEdgeControls(input))
    adds.push("Front Door + WAF");
  base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...adds]));
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: adds,
    required: true,
    reason: "API governance for the selected app or integration boundary."
  });
  return {
    base,
    overlay: {
      id: "api_management_edge",
      name: "API Management / Edge Overlay",
      reason: "API governance is required; WAF is added only for internet-facing or explicitly selected edge protection.",
      required: true
    }
  };
};

/* ---------- 5. Deterministic Orchestration Overlay ---------- */
const overlayOrchestration: OverlayApplyFn = (base, input) => {
  if (!requiresOrchestration(input) || base.basePatternId === "clarification_required") return { base, overlay: null };
  if (base.basePatternId === "business_action_agent") return { base, overlay: null };
  const multiAgent = input.behaviors.includes("multi_agent") || input.capabilities.includes("multi_agent");
  if (!isActionable(input)) {
    const orchestration = isManagedCopilotStudioBase(base, input)
      ? [
          ...(multiAgent ? ["Copilot Studio connected-agent orchestration (read-only tools)"] : []),
          ...(input.behaviors.includes("long_running_process") ? ["Power Automate read-only workflow"] : [])
        ]
      : [
          "Durable Functions / Logic Apps (read-only coordination)",
          ...(multiAgent ? ["Agent Framework / Semantic Kernel (read-only multi-agent)"] : [])
        ];
    base.recommendedStack = Array.from(new Set([
      ...base.recommendedStack,
      ...orchestration,
      "Governed read-only connector / action / API",
      "Application Insights"
    ]));
    base.rationale.push("Multi-agent or long-running coordination does not authorize system-of-record writes. Restrict every tool and connector to governed read-only access.");
    if (base.endToEndFlow[1]) {
      base.endToEndFlow[1] += "; coordinate the selected read-only agents or workflow without granting business-write permissions";
    }
    upsertLayer(base.architectureLayers, {
      layer: "Orchestration",
      selections: orchestration,
      required: true,
      reason: "Explicit coordination requirements remain necessary even when business writes are prohibited."
    });
    upsertLayer(base.architectureLayers, {
      layer: "Integration",
      selections: ["Governed read-only connector / action / API"],
      required: true,
      reason: "Coordination can only call authorized read-only tools."
    });
    upsertLayer(base.architectureLayers, {
      layer: "Security",
      selections: ["Read-only connector/action/API permissions"],
      required: true,
      reason: "Orchestration is not write authorization."
    });
    upsertLayer(base.architectureLayers, {
      layer: "Observability",
      selections: ["Application Insights"],
      required: true,
      reason: "Track multi-agent and long-running coordination failures and latency."
    });
    return {
      base,
      overlay: {
        id: "read_only_orchestration",
        name: "Read-only Agent / Workflow Coordination",
        reason: "Coordinate agents or long-running work without authorizing system-of-record writes.",
        required: true
      }
    };
  }
  const adds = [
    "Durable Functions / Logic Apps (deterministic)",
    ...(multiAgent ? ["Agent Framework / Semantic Kernel (multi-agent)"] : []),
    "APIM",
    "Audit logging"
  ];
  base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...adds]));
  upsertLayer(base.architectureLayers, {
    layer: "Orchestration",
    selections: adds.filter((a) => !["APIM", "Audit logging"].includes(a)),
    required: true,
    reason: "Behavior includes actions/transactions/multi-agent — deterministic orchestration required."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: ["Audit logging"],
    required: true,
    reason: "Required for write-back/actions."
  });
  return {
    base,
    overlay: {
      id: "deterministic_orchestration",
      name: "Deterministic Orchestration Overlay",
      reason: "Actionable behavior requires deterministic orchestration and audit.",
      required: true
    }
  };
};

/* ---------- 6. Observability Overlay ---------- */
const overlayObservability: OverlayApplyFn = (base, input) => {
  if (input.lifecycleControls.includes("monitoring") || input.lifecycleControls.includes("tracing")) {
    upsertLayer(base.architectureLayers, {
      layer: "Observability",
      selections: ["App Insights", "Log Analytics"],
      required: true,
      reason: "Monitoring/tracing explicitly required."
    });
    return {
      base,
      overlay: {
        id: "observability_monitoring",
        name: "Observability & Monitoring",
        reason: "Tracing or monitoring was explicitly selected.",
        required: true
      }
    };
  }
  return { base, overlay: null };
};

/* ---------- 7. M365 Agents SDK overlay (rare) ---------- */
const overlayM365AgentsSdk: OverlayApplyFn = (base, input) => {
  if (!wantsM365AgentsSdk(input)) return { base, overlay: null };
  base.recommendedStack = Array.from(
    new Set([...base.recommendedStack, "Microsoft 365 Agents SDK"])
  );
  upsertLayer(base.architectureLayers, {
    layer: "Experience",
    selections: ["Microsoft 365 Agents SDK"],
    required: true,
    reason: "Explicitly required for M365 extensibility / SDK scaffolding."
  });
  return {
    base,
    overlay: {
      id: "m365_agents_sdk",
      name: "Microsoft 365 Agents SDK",
      reason: "M365 extensibility / SDK scaffolding was explicitly confirmed.",
      required: true
    }
  };
};

/* ---------- 8. Document RAG overlay (when not the base) ---------- */
const overlayDocumentRag: OverlayApplyFn = (base, input) => {
  if (base.basePatternId === "document_rag_agent") return { base, overlay: null };
  if (!wantsDocumentRAG(input)) return { base, overlay: null };
  base.recommendedStack = Array.from(
    new Set([...base.recommendedStack, "Azure AI Search (vector / hybrid)"])
  );
  if (!base.recommendedStack.includes("Azure OpenAI model deployment in Azure AI Foundry")) {
    base.recommendedStack.push("Azure OpenAI model deployment in Azure AI Foundry");
  }
  base.rationale.push(
    "Azure AI Search is included because an advanced/custom RAG requirement was explicitly selected."
  );
  upsertLayer(base.architectureLayers, {
    layer: "Analytics/Grounding",
    selections: ["Azure AI Search (vector / hybrid)"],
    required: true,
    reason: "Advanced/custom document RAG is required as an additional capability."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Knowledge/Data",
    selections: ["Documents / Blob / SharePoint"],
    required: true,
    reason: "Document sources selected."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Integration",
    selections: ["Document ingestion/indexing pipeline", "Azure AI Search index"],
    required: true,
    reason: "Advanced/custom RAG requires ingestion and indexing integration."
  });
  return {
    base,
    overlay: {
      id: "document_rag_overlay",
      name: "Document RAG with Azure AI Search",
      reason: "Advanced/custom document RAG is required in addition to the base pattern.",
      required: true
    }
  };
};

/* ---------- 8b. Fabric Data Agent overlay (when not the base) ---------- */
const overlayFabricDataAgent: OverlayApplyFn = (base, input) => {
  if (base.basePatternId === "copilot_studio_fabric_data_agent") return { base, overlay: null };
  if (!hasFabricSource(input)) return { base, overlay: null };
  const foundryRuntime = input.runtimePreferences.includes("foundry_agent_service") ||
    base.basePatternId === "azure_ai_foundry_app";
  const fabricSourceLabels: Record<string, string> = {
    fabric_onelake: "Fabric OneLake",
    fabric_lakehouse: "Fabric Lakehouse",
    fabric_warehouse: "Fabric Warehouse",
    powerbi_semantic_model: "Power BI Semantic Model",
    kql_eventhouse: "KQL database / Eventhouse"
  };
  const fabricSources = input.dataSources
    .filter((source) => Object.prototype.hasOwnProperty.call(fabricSourceLabels, source))
    .map((source) => fabricSourceLabels[source] ?? source);
  if (!wantsFabricDataAgent(input)) {
    const access = input.fabricAnalyticsIntent === "predefined_reports_apis"
      ? "Governed Fabric API / predefined report access"
      : "Governed Fabric storage / processing access";
    base.recommendedStack = Array.from(new Set([...base.recommendedStack, ...fabricSources, access]));
    base.rationale.push("Fabric is used for predefined reports, APIs, storage, or processing rather than conversational analytics; a Fabric Data Agent is not required.");
    upsertLayer(base.architectureLayers, {
      layer: "Knowledge/Data",
      selections: fabricSources,
      required: true,
      reason: "Preserve the selected Fabric source independently of the conversational grounding mechanism."
    });
    upsertLayer(base.architectureLayers, {
      layer: "Integration",
      selections: [access],
      required: true,
      reason: "Use authorized reports, APIs, or storage interfaces for the confirmed Fabric usage."
    });
    return { base, overlay: null };
  }
  base.recommendedStack = Array.from(new Set([
    ...base.recommendedStack,
    "Microsoft Fabric Data Agent",
    ...(foundryRuntime ? ["Fabric Data Agent tool connected to Azure AI Foundry Agent Service"] : []),
    ...fabricSources
  ]));
  base.rationale.push(
    "Microsoft Fabric Data Agent is included because a Fabric source was selected; document/PDF RAG remains a separate grounding path when document sources are also selected."
  );
  upsertLayer(base.architectureLayers, {
    layer: "Analytics/Grounding",
    selections: [
      "Microsoft Fabric Data Agent",
      ...(foundryRuntime ? ["Fabric Data Agent tool connected to Azure AI Foundry Agent Service"] : [])
    ],
    required: true,
    reason: "Fabric source selected; Fabric Data Agent handles the Fabric grounding path."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Knowledge/Data",
    selections: fabricSources.length ? fabricSources : ["Fabric analytical data source"],
    required: true,
    reason: "Governed analytical data sources for Fabric Data Agent."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Integration",
    selections: [foundryRuntime ? "Fabric Data Agent tool / Foundry tool connection" : "Fabric Data Agent connection"],
    required: true,
    reason: "Fabric Data Agent is used as the analytics grounding/tool layer, not as document RAG or workflow execution."
  });
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: ["Fabric user identity and permissions", "Fabric / Power BI permissions"],
    required: true,
    reason: "Fabric Data Agent requires enforceable user identity and data permissions."
  });
  return {
    base,
    overlay: {
      id: "fabric_data_agent",
      name: "Microsoft Fabric Data Agent",
      reason: "Selected Fabric data sources require Microsoft Fabric Data Agent for the Fabric grounding path.",
      required: true
    }
  };
};

/* ---------- 9. Business Action overlay (when not the base) ---------- */
const overlayBusinessAction: OverlayApplyFn = (base, input) => {
  if (base.basePatternId === "business_action_agent") return { base, overlay: null };
  if (!isActionable(input)) return { base, overlay: null };
  base.blockedComponents = Array.from(new Set([
    ...base.blockedComponents,
    "Direct LLM-to-system-of-record writes",
    "Direct LLM-to-database write",
    "Generated SQL executed directly by the model"
  ]));
  const integration: string[] = [];
  if (input.dataSources.includes("azure_sql")) {
    integration.push("Controlled Azure SQL write path: parameterized stored procedures, approved connector operations, or backend APIs");
  }
  if (input.dataSources.some((source) => ["dataverse", "apis", "erp_crm"].includes(source))) {
    integration.push("Controlled backend APIs / approved connector operations / predefined business actions");
  }
  if (input.dataSources.includes("on_prem")) {
    integration.push("Private API facade / governed connector for on-premises systems");
  }
  if (integration.length) {
    upsertLayer(base.architectureLayers, {
      layer: "Integration",
      selections: integration,
      required: true,
      reason: "Actionable behavior requires governed system-of-record write paths."
    });
  }
  return {
    base,
    overlay: {
      id: "business_action_overlay",
      name: "Business Action / Transaction Overlay",
      reason: "Selected behaviors include actions/transactions — orchestration overlay already applied.",
      required: true
    }
  };
};

/* ================================================================
 * Decide
 * ================================================================ */

function buildBase(input: DecisionInput, patternId: string): BaseShape {
  const p = PATTERNS[patternId] ?? PATTERNS["custom_ai_app"];
  const built = p.build(input);
  return {
    ...built,
    basePatternId: p.id,
    basePatternName: p.name,
    // clone arrays to allow mutation
    recommendedStack: [...built.recommendedStack],
    optionalAddOns: [...built.optionalAddOns],
    forbiddenUnlessConfirmed: [...built.forbiddenUnlessConfirmed],
    blockedComponents: [...built.blockedComponents],
    rationale: [...built.rationale],
    architectureLayers: built.architectureLayers.map((l) => ({
      ...l,
      selections: [...l.selections]
    })),
    endToEndFlow: [...built.endToEndFlow]
  };
}

function mergeSelectedSecurityIntoLayers(base: BaseShape, input: DecisionInput) {
  const selSec = relevantSecurityControlsForDecision(input, base, selectedSecurityNames(input));
  if (selSec.length === 0) return;
  upsertLayer(base.architectureLayers, {
    layer: "Security",
    selections: selSec,
    required: true,
    reason: "Selected by the user."
  });
}

function relevantSecurityControlsForDecision(
  input: DecisionInput,
  base: BaseShape,
  selectedSecurity: string[]
): string[] {
  const confirmedExternal = hasConfirmedExternalSurface(input);
  const customOrApi =
    base.basePatternId === "external_ai_app" ||
    base.basePatternId === "custom_ai_app" ||
    input.runtimePreferences.some((r) => ["custom_backend", "foundry_agent_service", "functions", "app_service", "container_apps", "aks"].includes(r)) ||
    input.channels.some((c) => ["web", "mobile", "portal", "api", "embedded"].includes(c)) ||
    hasOperationalStructuredSource(input) ||
    input.dataSources.includes("on_prem") ||
    isActionable(input);

  return selectedSecurity.filter((control) => {
    if (/^Entra ID$/i.test(control)) return true;
    if (/RBAC|authorization/i.test(control)) return true;
    if (/Entra External ID/i.test(control)) return confirmedExternal;
    if (/Front Door|WAF/i.test(control)) return needsPublicEdgeControls(input) && customOrApi;
    if (/API Management|APIM|Managed Identity|Key Vault/i.test(control)) return confirmedExternal || customOrApi || wantsHybridOverlay(input);
    return true;
  });
}

function mergeSelectedNetworkIntoLayers(base: BaseShape, input: DecisionInput) {
  const selNet = selectedNetworkNames(input);
  if (selNet.length === 0) return;
  upsertLayer(base.architectureLayers, {
    layer: "Network/Deployment",
    selections: selNet,
    required: true,
    reason: "Selected by the user."
  });
}

function computeConfidence(
  input: DecisionInput,
  candidates: string[],
  missing: WizardQuestion[]
): "high" | "medium" | "low" {
  return computeConfidenceLevel(input, candidates, missing.length);
}

export function decide(input: DecisionInput): ArchitectureDecision {
  input = normalizeDecisionInput(input);
  const { primaryId, candidates } = selectPrimaryPattern(input);
  let base = buildBase(input, primaryId);

  const overlayFns: OverlayApplyFn[] = [
    overlayApim,
    overlayDocumentRag,
    overlayFabricDataAgent,
    overlayBusinessAction,
    overlayOrchestration,
    overlayFoundry,
    overlayModelCustomization,
    overlaySemanticModel,
    overlayObservability,
    overlayM365AgentsSdk,
    overlayHybrid
  ];

  const overlays: ArchitectureOverlay[] = [];
  for (const fn of overlayFns) {
    const r = fn(base, input);
    base = r.base;
    if (r.overlay) overlays.push(r.overlay);
  }

  // Merge user-selected security & network into layers
  mergeSelectedSecurityIntoLayers(base, input);
  mergeSelectedNetworkIntoLayers(base, input);

  // Assemble missing questions
  const next = nextQuestion(input);
  const missingQuestions = next ? [next] : [];

  const assumptions: string[] = [];
  const riskFlags: string[] = [];
  // Core routing gates that were skipped (only "unknown"/"none") carry no real signal.
  // Surface them so the user understands a skipped gate makes the recommendation generic.
  const skippedCore = skippedCoreGateLabels(input);
  if (skippedCore.length) {
    assumptions.push(
      `Some core inputs (${skippedCore.join(", ")}) were skipped and treated as unspecified. The recommendation defaults toward a flexible architecture and should be validated once those are confirmed.`
    );
  }
  if (input.directTextRecommendation) {
    assumptions.push(
      "The wizard was skipped. Users, channels, data sources, actions, security, and deployment constraints were inferred from the scenario text and should be validated."
    );
    if (
      input.users.includes("unknown") ||
      input.channels.includes("unknown") ||
      input.dataSources.includes("unknown") ||
      input.capabilities.includes("unknown")
    ) {
      riskFlags.push(
        "The scenario text did not clearly specify every routing input. Review inferred users, channels, data, and behavior before adopting the architecture."
      );
    }
  }
  if (needsSemanticModelGuidance(input) && input.semanticModelSecurityKnown !== true) {
    assumptions.push(
      "Power BI Semantic Model permissions and Prep-for-AI readiness are not yet confirmed."
    );
  }
  if (hasExternalChannel(input) && hasExternalUser(input) && input.externalAccessConfirmed === undefined) {
    assumptions.push("Internet-facing posture not explicitly confirmed.");
  }
  if (hasExternalUser(input) && !hasExternalChannel(input)) {
    assumptions.push(
      "External users were mentioned, but no external channel is confirmed. Keeping the current architecture internal; add web/mobile/portal/API if a separate external experience is required."
    );
    base.optionalAddOns = Array.from(new Set([
      ...base.optionalAddOns,
      "Potential add-ons if external access is confirmed: Entra External ID, external web/mobile/portal/API channel, API Management (APIM), Front Door + WAF"
    ]));
  }
  const fabricSourceLabels: Record<string, string> = {
    fabric_onelake: "Fabric OneLake",
    fabric_lakehouse: "Fabric Lakehouse",
    fabric_warehouse: "Fabric Warehouse",
    powerbi_semantic_model: "Power BI Semantic Model",
    kql_eventhouse: "KQL / Eventhouse"
  };
  const fabricSources = input.dataSources
    .filter((source) => ["fabric_onelake", "fabric_lakehouse", "fabric_warehouse", "powerbi_semantic_model", "kql_eventhouse"].includes(source))
    .map((source) => fabricSourceLabels[source] ?? source);
  if (wantsFabricDataAgent(input) && hasExternalUser(input) && hasExternalChannel(input)) {
    assumptions.push(
      `${fabricSources.join(" and ")} are confirmed data sources. Fabric access is handled through Microsoft Fabric Data Agent; external users require a governed identity and Fabric permission model.`
    );
    if (!isActionable(input)) {
      assumptions.push(
        "Fabric-backed Q&A remains read-only because no record update, approval, transaction, or explicit write authorization was confirmed. Coordination requirements do not grant write access."
      );
    }
  } else if (hasFabricSource(input) && input.fabricAnalyticsIntent === "unknown") {
    assumptions.push("Fabric source is selected, so Microsoft Fabric Data Agent is included; Fabric usage intent is still marked unknown and should be clarified.");
  }
  if (
    input.capabilities.includes("document_rag") &&
    !input.dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source))
  ) {
    assumptions.push(
      "Document Q&A is in scope, but the document repository and retrieval requirements are not confirmed yet. Azure AI Search should be added only after document source and advanced/custom RAG need are confirmed."
    );
  }
  if (hasExternalUser(input) && hasTeamsChannel(input) && !hasInternalUser(input)) {
    riskFlags.push(
      "Teams access for citizens or external customers requires an explicit external/B2B identity and licensing model; mobile/web/portal should remain the primary external channel unless confirmed otherwise."
    );
  }
  if (needsFabricPermissionWarning(input)) {
    riskFlags.push(
      fabricDataAgentUserAccessAllowed(input)
        ? "Fabric Data Agent for B2B users requires validation of identity passthrough and Fabric/Power BI permissions."
        : "Fabric Data Agent for external, citizen, or anonymous users requires validation of supported identity passthrough and Fabric/Power BI permissions; add a governed API facade if direct user permission mapping is not feasible."
    );
  }
  if (
    wantsFabricDataAgent(input) &&
    input.channels.includes("m365_copilot") &&
    base.architectureLayers.some((layer) => layer.layer === "Experience" && layer.selections.some((item) => /copilot studio/i.test(item)))
  ) {
    riskFlags.push(
      "Validate the Microsoft 365 Copilot channel before implementation: Copilot Studio-connected Fabric Data Agents are not currently supported when the main agent is deployed to Microsoft 365 Copilot. Validate a supported Teams integration or a separate native Fabric publishing route."
    );
  }
  if (isManagedCopilotStudioBase(base, input) && hasPrivateConnectivityRequirement(input)) {
    riskFlags.push(
      "Validate private connectivity for each Copilot Studio connector and target service. Outbound Power Platform VNet support requires a Managed Environment and supported connectors; it does not make the Teams or Microsoft 365 ingress private."
    );
  }
  if (input.networkControls.includes("no_public_endpoint")) {
    riskFlags.push(
      "Confirm the scope of the no-public-endpoints requirement: user-channel ingress, application endpoints, and downstream data access must be validated separately before deployment."
    );
  }
  if (
    !wantsFoundryLifecycle(input) &&
    isActionable(input) &&
    !input.lifecycleControls.includes("monitoring")
  ) {
    riskFlags.push(
      "Actionable behavior without monitoring — consider adding monitoring & audit observability."
    );
  }

  // Security controls (final list)
  const securityFromLayers =
    base.architectureLayers.find((l) => l.layer === "Security")?.selections ?? [];
  const securityControls = Array.from(
    new Set([...securityFromLayers, ...selectedSecurityNames(input)])
  ).filter((s) => s !== NOT_REQUIRED);

  // Promote explicitly-selected security controls into the recommended stack so
  // they are visible at the top-level summary (Managed Identity, Key Vault,
  // Purview, Defender, DLP, RBAC, RLS/OLS, Audit, etc.).
  const promotedSecurity = relevantSecurityControlsForDecision(input, base, selectedSecurityNames(input)).filter(
    (s) => s !== NOT_REQUIRED
  );
  if (promotedSecurity.length) {
    base.recommendedStack = Array.from(
      new Set([...base.recommendedStack, ...promotedSecurity])
    );
  }

  // Zero Trust enforcement
  const zeroTrust = computeZeroTrust(input, base, securityControls);
  if (zeroTrust.applicable) {
    for (const c of zeroTrust.controls) {
      if (!securityControls.includes(c)) securityControls.push(c);
    }
    upsertLayer(base.architectureLayers, {
      layer: "Security",
      selections: zeroTrust.controls,
      required: true,
      reason: `Zero Trust zone enforced: ${zeroTrust.rationale}`
    });
    if (!base.rationale.some((r) => r.toLowerCase().includes("zero trust"))) {
      base.rationale.push(
        `Zero Trust zone enforced — ${zeroTrust.rationale}. Controls: ${zeroTrust.controls.join(", ")}.`
      );
    }
  }

  // Ensure all 12 layers are present
  const requiredLayers: ArchitectureLayer["layer"][] = [
    "User/Channel",
    "Identity",
    "Experience",
    "Runtime/Backend",
    "Analytics/Grounding",
    "Orchestration",
    "AI Platform",
    "Knowledge/Data",
    "Integration",
    "Security",
    "Observability",
    "Network/Deployment"
  ];
  for (const lname of requiredLayers) {
    if (!base.architectureLayers.find((l) => l.layer === lname)) {
      base.architectureLayers.push({
        layer: lname,
        selections: [NOT_REQUIRED],
        required: false,
        reason: "Not part of this architecture."
      });
    }
  }
  // Sort layers in canonical order
  base.architectureLayers.sort(
    (a, b) => requiredLayers.indexOf(a.layer) - requiredLayers.indexOf(b.layer)
  );

  const computedConfidence = computeConfidence(input, candidates, missingQuestions);
  const confidence = input.directTextRecommendation && computedConfidence === "high" ? "medium" : computedConfidence;
  const needsTieBreak = candidates.length > 1;

  const decision: ArchitectureDecision = {
    basePatternId: base.basePatternId,
    basePatternName: base.basePatternName,
    overlays,
    recommendedStack: base.recommendedStack,
    optionalAddOns: base.optionalAddOns,
    blockedComponents: base.blockedComponents,
    forbiddenUnlessConfirmed: base.forbiddenUnlessConfirmed,
    rationale: base.rationale,
    confidence,
    needsTieBreak,
    missingQuestions,
    architectureLayers: base.architectureLayers,
    endToEndFlow: base.endToEndFlow.slice(0, 7),
    securityControls,
    zeroTrust,
    assumptions,
    riskFlags,
    finalRecommendation: base.finalRecommendation,
    candidateBasePatternIds: candidates
  };

  return normalizeArchitectureDecision(decision, input);
}

export { applicableQuestions, nextQuestion };

/* ---------- Zero Trust enforcement ---------- */
function computeZeroTrust(
  input: DecisionInput,
  base: BaseShape,
  selectedSecurity: string[]
): { applicable: boolean; rationale: string; controls: string[] } {
  const externalFacing = hasConfirmedExternalSurface(input);
  const privateOrHybrid = wantsHybridOverlay(input);
  const actionable = isActionable(input);
  const sensitive =
    hasFabricSource(input) ||
    input.networkControls.includes("regulated") ||
    input.networkControls.includes("data_residency") ||
    input.securityControls.includes("dlp") ||
    input.securityControls.includes("purview") ||
    input.securityControls.includes("defender") ||
    input.securityControls.includes("rls_ols");

  const reasons: string[] = [];
  if (externalFacing) reasons.push("external-facing surface (channel or user audience)");
  if (privateOrHybrid) reasons.push("private/regulated/hybrid network selected");
  if (sensitive) reasons.push("sensitive or regulated data exposure");
  if (actionable) reasons.push("actionable behavior (write-back / approvals / transactions)");

  // Internal-only, read-only, non-sensitive M365 productivity: not enforced (still recommended)
  const applicable = reasons.length > 0;
  if (!applicable) {
    return {
      applicable: false,
      rationale:
        "Internal, read-only Microsoft-managed Copilot Studio scenario — baseline Entra ID and source permissions apply; no separate external edge/Zero Trust overlay is required.",
      controls: []
    };
  }

  const controls = new Set<string>();
  // Identity-first
  if (externalFacing) controls.add("Entra External ID (verify every external identity)");
  controls.add("Entra ID with Conditional Access (verify every internal identity)");
  controls.add("Least-privilege RBAC (deny by default)");
  controls.add("Managed Identity for all Azure-to-Azure auth (no secrets)");
  // Data & app
  controls.add("Key Vault for secrets, keys and certificates");
  if (sensitive) {
    controls.add("Microsoft Purview data classification & DLP");
    controls.add("Row-Level / Object-Level Security on grounding data");
  }
  // Network
  const managedSaaSZeroTrust = isManagedCopilotStudioBase(base, input) && !input.dataSources.includes("on_prem");
  if (managedSaaSZeroTrust) {
    // Microsoft-managed SaaS (Copilot Studio): no customer VNet/Private Link. Enforce the
    // data boundary through tenant-level governance instead of customer networking.
    controls.add("Microsoft-managed tenant isolation with data residency / region pinning");
    controls.add("Microsoft Purview DLP and Conditional Access for tenant data boundaries");
  } else if (privateOrHybrid) {
    controls.add("Private Endpoints for AI, data and storage services");
    controls.add("VNet integration + Private DNS (no public ingress)");
    controls.add("Network segmentation between web, runtime and data tiers");
  } else if (externalFacing) {
    controls.add("Front Door + WAF in front of every internet-facing endpoint");
    controls.add("API Management with throttling, JWT validation and IP allow-list");
  }
  // Monitoring & assume-breach
  controls.add("Microsoft Defender for Cloud on all subscriptions");
  controls.add("Continuous logging (audit, sign-in, prompt I/O) to a SIEM");
  if (actionable) {
    controls.add("Human-in-the-loop approval for high-impact actions");
    controls.add("Immutable audit trail for every action taken by the agent");
  }
  // AI-specific
  controls.add("Azure AI Content Safety + prompt-shield on all model calls");
  controls.add("Output grounding to approved data sources only");

  return {
    applicable: true,
    rationale: `Zero Trust enforced due to: ${reasons.join(", ")}.`,
    controls: Array.from(controls)
  };
}
