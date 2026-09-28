import type {
  AgentBehavior,
  Capability,
  Channel,
  DataSource,
  DecisionInput,
  LifecycleControl,
  ModelStrategy,
  NetworkControl,
  SecurityControl
} from "./types";

export const FABRIC_SOURCES: DataSource[] = [
  "fabric_onelake",
  "fabric_lakehouse",
  "fabric_warehouse",
  "powerbi_semantic_model",
  "kql_eventhouse"
];

export const DOCUMENT_SOURCES: DataSource[] = [
  "documents",
  "blob_storage",
  "sharepoint"
];

export const NATIVE_COPILOT_KNOWLEDGE_SOURCES: DataSource[] = [
  "documents",
  "sharepoint",
  "m365_graph"
];

export const ADVANCED_RAG_DOCUMENT_SOURCES: DataSource[] = [
  "documents",
  "blob_storage",
  "sharepoint"
];

export const TEAMS_CHANNELS: Channel[] = ["teams", "m365", "m365_copilot"];
export const EXTERNAL_CHANNELS: Channel[] = [
  "web",
  "mobile",
  "portal",
  "api",
  "embedded"
];
export const EXTERNAL_USERS = ["external_customers", "citizens", "partners", "mixed"];

export const DIRECT_ACTIONABLE_BEHAVIORS: AgentBehavior[] = [
  "record_update",
  "approval",
  "transaction"
];

export const DIRECT_ACTIONABLE_CAPABILITIES: Capability[] = [
  "approval",
  "transaction",
  "record_update"
];

export const AMBIGUOUS_WORKFLOW_BEHAVIORS: AgentBehavior[] = ["workflow"];
export const AMBIGUOUS_WORKFLOW_CAPABILITIES: Capability[] = ["business_workflow"];

// Backward-compatible names now mean confirmed direct actions only.
export const ACTIONABLE_BEHAVIORS = DIRECT_ACTIONABLE_BEHAVIORS;
export const ACTIONABLE_CAPABILITIES = DIRECT_ACTIONABLE_CAPABILITIES;

export const FOUNDRY_LIFECYCLE_TRIGGERS: LifecycleControl[] = [
  "evaluation",
  "tracing",
  "monitoring",
  "safety_testing",
  "prompt_versioning",
  "model_versioning",
  "model_routing",
  "governance"
];

export const PRIVATE_CONNECTIVITY_TRIGGERS: NetworkControl[] = [
  "vnet",
  "private_link",
  "private_endpoint",
  "vpn",
  "expressroute",
  "no_public_endpoint",
  "on_prem_connectivity"
];

export const HYBRID_TRIGGERS: NetworkControl[] = [
  ...PRIVATE_CONNECTIVITY_TRIGGERS,
  "data_residency",
  "regulated"
];

export const MODEL_CUSTOMIZATION_TRIGGERS: ModelStrategy[] = [
  "foundry_model_catalog",
  "anthropic_claude",
  "xai_grok",
  "fine_tuned_azure_openai",
  "fine_tuned_foundry_model",
  "azure_ml_custom_model",
  "azure_ml_endpoint",
  "bring_your_own_model"
];

export const AZURE_ML_MODEL_TRIGGERS: ModelStrategy[] = [
  "azure_ml_custom_model",
  "azure_ml_endpoint",
  "bring_your_own_model"
];

export const FOUNDRY_MODEL_TRIGGERS: ModelStrategy[] = [
  "foundry_model_catalog",
  "anthropic_claude",
  "xai_grok",
  "fine_tuned_azure_openai",
  "fine_tuned_foundry_model",
  "bring_your_own_model"
];

export const BASELINE_MODEL_STRATEGIES: ModelStrategy[] = [
  "standard_foundation_model",
  "azure_openai"
];

export const ANALYTICS_BEHAVIORS: AgentBehavior[] = [
  "analytics",
  "qa",
  "read_only_query",
  "retrieval",
  "summarization",
  "recommendation"
];

/* ---------- predicates ---------- */
const anyOf = <T,>(arr: T[] | undefined, vals: readonly T[]): boolean =>
  !!arr && arr.some((a) => vals.includes(a));

export const hasFabricSource = (i: DecisionInput) =>
  anyOf(i.dataSources, FABRIC_SOURCES);
export const hasDocumentSource = (i: DecisionInput) =>
  anyOf(i.dataSources, DOCUMENT_SOURCES);
export const hasNativeCopilotKnowledgeSource = (i: DecisionInput) =>
  anyOf(i.dataSources, NATIVE_COPILOT_KNOWLEDGE_SOURCES);
export const hasAdvancedRagDocumentSource = (i: DecisionInput) =>
  anyOf(i.dataSources, ADVANCED_RAG_DOCUMENT_SOURCES);
export const hasTeamsChannel = (i: DecisionInput) =>
  anyOf(i.channels, TEAMS_CHANNELS);
export const hasExternalChannel = (i: DecisionInput) =>
  anyOf(i.channels, EXTERNAL_CHANNELS);
export const hasExternalUser = (i: DecisionInput) =>
  anyOf(i.users, EXTERNAL_USERS as any);
export const hasInternalUser = (i: DecisionInput) =>
  anyOf(i.users, ["internal_employees", "admins"] as any);

export const hasAmbiguousWorkflowIntent = (i: DecisionInput) =>
  anyOf(i.behaviors, AMBIGUOUS_WORKFLOW_BEHAVIORS) ||
  anyOf(i.capabilities, AMBIGUOUS_WORKFLOW_CAPABILITIES);

export const hasConfirmedWriteAction = (i: DecisionInput) => {
  if (i.writeBackConfirmed === false) return false;
  return (
    anyOf(i.behaviors, DIRECT_ACTIONABLE_BEHAVIORS) ||
    anyOf(i.capabilities, DIRECT_ACTIONABLE_CAPABILITIES) ||
    i.writeBackConfirmed === true
  );
};

export const isActionable = (i: DecisionInput) =>
  hasConfirmedWriteAction(i);

export const requiresOrchestration = (i: DecisionInput) =>
  isActionable(i) ||
  anyOf(i.behaviors, ["long_running_process", "multi_agent"]) ||
  i.capabilities.includes("multi_agent");

export const hasConfirmedExternalSurface = (i: DecisionInput) =>
  (hasExternalUser(i) && hasExternalChannel(i)) || i.externalAccessConfirmed === true;

export const needsPublicEdgeControls = (i: DecisionInput) =>
  i.securityControls.includes("waf") ||
  (hasConfirmedExternalSurface(i) && i.externalAccessConfirmed !== false);

export const wantsFoundryLifecycle = (i: DecisionInput) =>
  anyOf(i.lifecycleControls, FOUNDRY_LIFECYCLE_TRIGGERS);

export const wantsModelCustomization = (i: DecisionInput) =>
  anyOf(i.modelStrategy, MODEL_CUSTOMIZATION_TRIGGERS);

export const hasImpactfulModelStrategy = (i: DecisionInput) =>
  wantsModelCustomization(i);

export const wantsAzureMachineLearning = (i: DecisionInput) =>
  anyOf(i.modelStrategy, AZURE_ML_MODEL_TRIGGERS);

export const wantsFoundryModelOps = (i: DecisionInput) =>
  anyOf(i.modelStrategy, FOUNDRY_MODEL_TRIGGERS) ||
  anyOf(i.runtimePreferences, ["foundry_agent_service"]);

export const wantsHybridOverlay = (i: DecisionInput) =>
  i.dataSources.includes("on_prem") ||
  i.advancedRagRequirements?.includes("private_search_service") ||
  anyOf(i.networkControls, HYBRID_TRIGGERS);

export const hasPrivateConnectivityRequirement = (i: DecisionInput) =>
  i.dataSources.includes("on_prem") ||
  !!i.advancedRagRequirements?.includes("private_search_service") ||
  anyOf(i.networkControls, PRIVATE_CONNECTIVITY_TRIGGERS);

export const wantsM365AgentsSdk = (i: DecisionInput) =>
  anyOf(i.runtimePreferences, ["m365_agents_sdk"]) ||
  i.m365ExtensibilityRequired === true;

export const isReadOnlyAnalytics = (i: DecisionInput) =>
  anyOf(i.behaviors, ANALYTICS_BEHAVIORS) && !isActionable(i);

export const wantsDocumentRAG = (i: DecisionInput) =>
  wantsAdvancedDocumentRag(i);

export const wantsAdvancedRag = (i: DecisionInput) =>
  i.advancedRagRequirements?.some((r) => r !== "none" && r !== "unknown") ||
  i.advancedRagRequirements?.includes("explicit_azure_ai_search");

export const hasDocumentIntent = (i: DecisionInput) =>
  i.capabilities?.includes("document_rag") ||
  hasAdvancedRagDocumentSource(i);

export const wantsSimpleCopilotStudioKnowledge = (i: DecisionInput) =>
  hasInternalUser(i) &&
  hasTeamsChannel(i) &&
  hasNativeCopilotKnowledgeSource(i) &&
  (i.runtimePreferences?.includes("copilot_studio") ||
    i.lowCodePreferred === true ||
    i.capabilities?.includes("employee_assistant") ||
    i.capabilities?.includes("operational_query") ||
    i.dataSources?.includes("documents") ||
    i.dataSources?.includes("sharepoint")) &&
  !isActionable(i) &&
  !wantsAdvancedRag(i) &&
  !i.runtimePreferences?.includes("custom_backend") &&
  !i.runtimePreferences?.includes("foundry_agent_service");

export const wantsAdvancedDocumentRag = (i: DecisionInput) =>
  hasAdvancedRagDocumentSource(i) && wantsAdvancedRag(i);

export const wantsFabricAnalytics = (i: DecisionInput) =>
  i.capabilities.includes("fabric_analytics") ||
  (hasFabricSource(i) &&
    (anyOf(i.behaviors, ["analytics", "qa", "read_only_query"]) ||
      i.capabilities.includes("operational_query")));

export const fabricAnalyticsIntentAnswered = (i: DecisionInput) =>
  !!i.fabricAnalyticsIntent;

export const fabricUserAccessAnswered = (i: DecisionInput) =>
  !!i.fabricUserAccess;

export const wantsFabricAnalyticsQa = (i: DecisionInput) =>
  hasFabricSource(i) &&
  i.fabricAnalyticsIntent !== "storage_only" &&
  i.fabricAnalyticsIntent !== "predefined_reports_apis";

export const fabricDataAgentUserAccessAllowed = (i: DecisionInput) => {
  if (i.fabricUserAccess === "anonymous_users") return false;
  if (i.fabricUserAccess === "external_customers_citizens") return false;
  if (hasExternalUser(i) && !hasInternalUser(i) && i.fabricUserAccess !== "b2b_governed_fabric_access") return false;
  return true;
};

export const wantsFabricDataAgent = (i: DecisionInput) =>
  wantsFabricAnalyticsQa(i);

export const needsFabricPermissionWarning = (i: DecisionInput) =>
  wantsFabricDataAgent(i) &&
  (i.fabricUserAccess === "b2b_governed_fabric_access" ||
    i.fabricUserAccess === "external_customers_citizens" ||
    i.fabricUserAccess === "anonymous_users" ||
    (hasExternalUser(i) && !hasInternalUser(i)));

export const needsSemanticModelGuidance = (i: DecisionInput) =>
  i.dataSources.includes("powerbi_semantic_model");

export const hasConfirmedSemanticModelReadiness = (confirmations: readonly string[] | undefined) =>
  !!confirmations &&
  !confirmations.includes("not_confirmed") &&
  ["read", "workspace", "prep_ai"].every((required) => confirmations.includes(required));

/* ---------- confidence (single source of truth) ---------- */

const CORE_GATE_FIELDS: Array<keyof DecisionInput> = [
  "users",
  "channels",
  "capabilities",
  "dataSources",
  "behaviors"
];

const isOnlyUnknown = (values: unknown): boolean => {
  const arr = Array.isArray(values) ? (values as string[]) : [];
  return arr.length > 0 && arr.every((v) => v === "unknown" || v === "none");
};

/**
 * Broad solution family each base pattern belongs to. Used for confidence: when several
 * candidate base patterns are in play but they ALL belong to one family, the recommended
 * direction is certain even though the exact sub-pattern is not — so confidence should be
 * "medium" (family confirmed, sub-pattern pending) rather than "low".
 */
const BASE_PATTERN_FAMILY: Record<string, "clarify" | "copilot" | "foundry"> = {
  clarification_required: "clarify",
  m365_copilot_productivity: "copilot",
  copilot_studio_internal_assistant: "copilot",
  copilot_studio_fabric_data_agent: "copilot",
  document_rag_agent: "foundry",
  azure_ai_foundry_app: "foundry",
  external_ai_app: "foundry",
  business_action_agent: "foundry",
  custom_ai_app: "foundry"
};

/** True when every candidate base pattern maps to the same broad solution family. */
export function candidatesShareDisplayedFamily(candidates: string[]): boolean {
  if (candidates.length <= 1) return true;
  const families = new Set(candidates.map((c) => BASE_PATTERN_FAMILY[c] ?? "foundry"));
  return families.size === 1;
}

/**
 * Single source of truth for the recommendation confidence level, shared by the
 * deterministic engine (decide) and the adaptive wizard's live badge so the two can
 * never disagree. `input` must already be normalized. `candidates` is the list of
 * candidate base patterns; `missingCount` is the number of unresolved critical questions.
 *
 * A core routing gate that was skipped resolves to only "unknown"/"none". It passes the
 * non-empty length check but carries no real signal, so a skipped core gate lowers
 * confidence (two or more = low, exactly one = at most medium).
 *
 * Multiple candidates that all share ONE displayed family keep the recommendation at
 * "medium" (family certain, sub-pattern pending the AI tie-break) rather than dropping to
 * "low" — only a genuinely cross-family split is low confidence.
 */
export function computeConfidenceLevel(
  i: DecisionInput,
  candidates: string[] | number,
  missingCount: number
): "high" | "medium" | "low" {
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const candidateCount = Array.isArray(candidates) ? candidates.length : candidates;
  const sameFamily = Array.isArray(candidates) ? candidatesShareDisplayedFamily(candidateList) : false;
  const multiCandidateSameFamily = candidateCount > 1 && sameFamily;
  if (candidateCount > 1 && !sameFamily) return "low";
  const baseRequired =
    i.users.length > 0 &&
    i.channels.length > 0 &&
    i.capabilities.length > 0 &&
    i.dataSources.length > 0 &&
    i.behaviors.length > 0;
  if (!baseRequired) return "low";
  const coreUnknownCount = CORE_GATE_FIELDS.filter((field) => isOnlyUnknown(i[field])).length;
  if (coreUnknownCount >= 2) return "low";
  if (i.advancedRagRequirements?.includes("unknown")) return "medium";
  if (i.modelStrategy?.includes("unknown")) return "medium";
  if (needsSemanticModelGuidance(i) && i.semanticModelSecurityKnown !== true) return "medium";
  if (hasExternalChannel(i) && hasExternalUser(i) && i.externalAccessConfirmed === undefined) return "medium";
  // Family is certain but the exact sub-pattern is still being tie-broken: cap at medium.
  if (multiCandidateSameFamily) return "medium";
  if (coreUnknownCount === 1) return "medium";
  if (missingCount > 0) return "medium";
  return "high";
}

/** Plain-language labels for the five core routing gates. */
const CORE_GATE_LABELS: Partial<Record<keyof DecisionInput, string>> = {
  users: "who uses it",
  channels: "where they open it",
  capabilities: "what it should do",
  dataSources: "what information it uses",
  behaviors: "answer vs. take action"
};

/** Human-readable labels for any core routing gate that was skipped (only unknown/none). */
export function skippedCoreGateLabels(i: DecisionInput): string[] {
  return CORE_GATE_FIELDS.filter((field) => isOnlyUnknown(i[field])).map((field) => CORE_GATE_LABELS[field] ?? String(field));
}

/** Human-readable labels for any core routing gate left completely empty. */
export function emptyCoreGateLabels(i: DecisionInput): string[] {
  return CORE_GATE_FIELDS.filter((field) => ((i[field] as unknown[]) ?? []).length === 0).map((field) => CORE_GATE_LABELS[field] ?? String(field));
}

const FAMILY_DISPLAY: Record<"copilot" | "foundry" | "clarify", string> = {
  copilot: "Copilot Studio",
  foundry: "AI Foundry",
  clarify: "clarification"
};

export type LowConfidenceReason =
  | { code: "cross_family"; families: string[] }
  | { code: "missing_gate"; gates: string[] }
  | { code: "skipped_gates"; gates: string[] };

/**
 * Why a recommendation scored "low" — mirrors the low branches of computeConfidenceLevel
 * exactly, in the same order. Returns null when the score is not low. Shared by the
 * user-facing explanation and the usage telemetry so the two can never disagree.
 *   - cross_family : more than one candidate base pattern across different families (the
 *                    AI tie-break / a Hybrid result decides between them).
 *   - missing_gate : a core routing gate was left completely empty.
 *   - skipped_gates: two or more core gates were skipped (only "unknown"/"none").
 */
export function lowConfidenceReason(i: DecisionInput, candidates: string[]): LowConfidenceReason | null {
  if (candidates.length > 1 && !candidatesShareDisplayedFamily(candidates)) {
    const families = Array.from(
      new Set(candidates.map((c) => FAMILY_DISPLAY[BASE_PATTERN_FAMILY[c] ?? "foundry"]))
    );
    return { code: "cross_family", families };
  }
  const empty = emptyCoreGateLabels(i);
  if (empty.length > 0) return { code: "missing_gate", gates: empty };
  const skipped = skippedCoreGateLabels(i);
  if (skipped.length >= 2) return { code: "skipped_gates", gates: skipped };
  return null;
}

/* Operational structured data sources (need a governed data-access layer, not direct LLM access) */
export const OPERATIONAL_STRUCTURED_SOURCES: DataSource[] = [
  "azure_sql",
  "dataverse",
  "apis",
  "erp_crm"
];

export const hasAzureSqlSource = (i: DecisionInput) =>
  i.dataSources.includes("azure_sql");

export const hasOperationalStructuredSource = (i: DecisionInput) =>
  anyOf(i.dataSources, OPERATIONAL_STRUCTURED_SOURCES);

export const hasOnPremSource = (i: DecisionInput) =>
  i.dataSources.includes("on_prem");

export const hasM365KnowledgeSource = (i: DecisionInput) =>
  i.dataSources.includes("m365_graph");

export const hasSharePointSource = (i: DecisionInput) =>
  i.dataSources.includes("sharepoint");

export function selectedSecurityNames(i: DecisionInput): string[] {
  const map: Record<SecurityControl, string> = {
    entra_id: "Entra ID",
    entra_external_id: "Entra External ID",
    rbac: "RBAC / authorization checks",
    rls_ols: "RLS / OLS",
    dlp: "DLP policies",
    audit: "Audit logging",
    key_vault: "Key Vault",
    managed_identity: "Managed Identity",
    waf: "Front Door / WAF",
    apim: "API Management (APIM)",
    purview: "Microsoft Purview",
    defender: "Microsoft Defender",
    unknown: ""
  };
  return i.securityControls.map((c) => map[c]).filter(Boolean);
}

export function selectedNetworkNames(i: DecisionInput): string[] {
  const map: Record<NetworkControl, string> = {
    public: "Public endpoint",
    vnet: "VNet integration",
    private_link: "Private Link",
    private_endpoint: "Private Endpoint",
    vpn: "VPN",
    expressroute: "ExpressRoute",
    no_public_endpoint: "No public endpoint",
    data_residency: "Region pinning for data residency",
    regulated: "Regulated/sovereign deployment",
    on_prem_connectivity: "On-prem connectivity (VPN/ExpressRoute)",
    unknown: ""
  };
  return i.networkControls.map((c) => map[c]).filter(Boolean);
}
