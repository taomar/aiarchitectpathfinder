/* ================================================================
 * Microsoft AI Architecture Pathfinder — types
 * Multi-select architecture profiler (every layer is an array)
 * ================================================================ */

export type Channel =
  | "m365_copilot"
  | "teams"
  | "m365"
  | "web"
  | "mobile"
  | "portal"
  | "api"
  | "embedded"
  | "multiple"
  | "unknown";

export type UserType =
  | "internal_employees"
  | "external_customers"
  | "citizens"
  | "partners"
  | "admins"
  | "developers"
  | "mixed"
  | "unknown";

export type Capability =
  | "personal_productivity"
  | "employee_assistant"
  | "fabric_analytics"
  | "document_rag"
  | "operational_query"
  | "business_workflow"
  | "approval"
  | "transaction"
  | "record_update"
  | "multi_agent"
  | "custom_app"
  | "unknown";

export type DataSource =
  | "m365_graph"
  | "sharepoint"
  | "fabric_onelake"
  | "fabric_lakehouse"
  | "fabric_warehouse"
  | "powerbi_semantic_model"
  | "kql_eventhouse"
  | "documents"
  | "blob_storage"
  | "azure_sql"
  | "dataverse"
  | "apis"
  | "erp_crm"
  | "on_prem"
  | "internet"
  | "unknown";

export type AgentBehavior =
  | "qa"
  | "analytics"
  | "retrieval"
  | "read_only_query"
  | "summarization"
  | "recommendation"
  | "record_update"
  | "workflow"
  | "approval"
  | "transaction"
  | "long_running_process"
  | "multi_agent"
  | "unknown";

export type LifecycleControl =
  | "none"
  | "evaluation"
  | "tracing"
  | "monitoring"
  | "safety_testing"
  | "prompt_versioning"
  | "model_versioning"
  | "model_routing"
  | "governance"
  | "unknown";

export type SecurityControl =
  | "entra_id"
  | "entra_external_id"
  | "rbac"
  | "rls_ols"
  | "dlp"
  | "audit"
  | "key_vault"
  | "managed_identity"
  | "waf"
  | "apim"
  | "purview"
  | "defender"
  | "unknown";

export type NetworkControl =
  | "public"
  | "vnet"
  | "private_link"
  | "private_endpoint"
  | "vpn"
  | "expressroute"
  | "no_public_endpoint"
  | "data_residency"
  | "regulated"
  | "on_prem_connectivity"
  | "unknown";

export type RuntimePreference =
  | "none"
  | "copilot_studio"
  | "custom_backend"
  | "foundry_agent_service"
  | "m365_agents_sdk"
  | "functions"
  | "container_apps"
  | "app_service"
  | "aks"
  | "unknown";

export type ModelStrategy =
  | "standard_foundation_model"
  | "azure_openai"
  | "foundry_model_catalog"
  | "anthropic_claude"
  | "xai_grok"
  | "fine_tuned_azure_openai"
  | "fine_tuned_foundry_model"
  | "azure_ml_custom_model"
  | "azure_ml_endpoint"
  | "bring_your_own_model"
  | "unknown";

export type FabricAnalyticsIntent =
  | "read_only_analytics_qa"
  | "predefined_reports_apis"
  | "storage_only"
  | "unknown";

export type FabricUserAccess =
  | "internal_fabric_permissions"
  | "b2b_governed_fabric_access"
  | "external_customers_citizens"
  | "anonymous_users"
  | "unknown";

export type AdvancedRagRequirement =
  | "none"
  | "custom_vector_search"
  | "hybrid_search"
  | "large_scale_indexing"
  | "custom_ingestion"
  | "custom_chunking"
  | "ocr_enrichment"
  | "metadata_filtering"
  | "reusable_enterprise_index"
  | "private_search_service"
  | "multi_app_search_reuse"
  | "explicit_azure_ai_search"
  | "unknown";

/* ---------------- Question model ---------------- */

export type QuestionType = "single" | "multi" | "boolean" | "text" | "ranked";

export type QuestionLayer =
  | "Intent"
  | "Users"
  | "Channel"
  | "Data"
  | "Behavior"
  | "Lifecycle"
  | "Model"
  | "Runtime"
  | "Integration"
  | "Security"
  | "Network"
  | "Validation";

export type QuestionOption = {
  id: string;
  label: string;
  description?: string;
  group?: string;
  tags?: string[];
};

export type DecisionCondition = (input: DecisionInput) => boolean;

export type WizardQuestion = {
  id: string;
  layer: QuestionLayer;
  type: QuestionType;
  title: string;
  helperText?: string;
  options?: QuestionOption[];
  required: boolean;
  allowUnknown?: boolean;
  showWhen?: DecisionCondition;
  /** internal: how to write answer into DecisionInput */
  apply?: (input: DecisionInput, value: any) => DecisionInput;
  /** internal: how to read current value out of DecisionInput */
  read?: (input: DecisionInput) => any;
  /** internal: whether question is considered "answered" */
  isAnswered?: (input: DecisionInput) => boolean;
};

/* ---------------- Decision input ---------------- */

export type DecisionInput = {
  summary?: string;
  directTextRecommendation?: boolean;
  users: UserType[];
  channels: Channel[];
  capabilities: Capability[];
  dataSources: DataSource[];
  behaviors: AgentBehavior[];
  lifecycleControls: LifecycleControl[];
  modelStrategy?: ModelStrategy[];
  fabricAnalyticsIntent?: FabricAnalyticsIntent;
  fabricUserAccess?: FabricUserAccess;
  securityControls: SecurityControl[];
  networkControls: NetworkControl[];
  runtimePreferences: RuntimePreference[];
  advancedRagRequirements?: AdvancedRagRequirement[];
  lowCodePreferred?: boolean;
  writeBackConfirmed?: boolean;
  externalAccessConfirmed?: boolean;
  externalAccessUnknown?: boolean;
  m365ExtensibilityRequired?: boolean;
  m365ExtensibilityUnknown?: boolean;
  semanticModelUsed?: boolean;
  semanticModelSecurityKnown?: boolean;
  semanticModelConfirmations?: string[];
  workflowExecution?: string[];
  notes?: string;
};

/* ---------------- Decision output ---------------- */

export type ServiceSizing = {
  id: string;
  name: string;
  provider: "azure" | "microsoft-saas" | "external" | "logical";
  purpose: string;
  nodeIds: string[];
  dev: string;
  test: string;
  prod: string;
  assumptions: string[];
  references: string[];
};

export type ArchitectureOverlay = {
  id: string;
  name: string;
  reason: string;
  required: boolean;
};

export type ArchitectureLayer = {
  layer:
    | "User/Channel"
    | "Identity"
    | "Experience"
    | "Runtime/Backend"
    | "Analytics/Grounding"
    | "Orchestration"
    | "AI Platform"
    | "Knowledge/Data"
    | "Integration"
    | "Security"
    | "Observability"
    | "Network/Deployment";
  selections: string[];
  required: boolean;
  reason: string;
};

export type ZeroTrustZone = {
  applicable: boolean;
  rationale: string;
  controls: string[];
};

export type RecommendationAgentTraceItem = {
  agent: string;
  status: "passed" | "warning" | "failed" | "skipped";
  summary: string;
  details: string[];
};

export type ArchitectureDecision = {
  authority?: "ai";
  solutionType?: string;
  confidenceReason?: string;
  approvedArchitecture?: import("./architecture-view").ArchitectureView;
  approvedSummary?: string;
  serviceSizing?: ServiceSizing[];
  sizingAssumptions?: string[];
  highLevelFlow?: string[];
  basePatternId: string;
  basePatternName: string;
  overlays: ArchitectureOverlay[];
  recommendedStack: string[];
  optionalAddOns: string[];
  blockedComponents: string[];
  forbiddenUnlessConfirmed: string[];
  rationale: string[];
  confidence: "high" | "medium" | "low";
  needsTieBreak: boolean;
  missingQuestions: WizardQuestion[];
  architectureLayers: ArchitectureLayer[];
  endToEndFlow: string[];
  securityControls: string[];
  zeroTrust: ZeroTrustZone;
  assumptions: string[];
  riskFlags: string[];
  finalRecommendation: string;
  candidateBasePatternIds: string[];
};

export type QuestionRelevance =
  | "required_now"
  | "conditional_now"
  | "optional_later"
  | "resolved"
  | "hidden"
  | "blocked";

export type AdaptiveQuestionPlanItem = {
  questionId: string;
  relevance: QuestionRelevance;
  priority: number;
  reason: string;
  blockedReason?: string;
};

export type AdaptiveOptionState = {
  optionId: string;
  visible: boolean;
  disabled: boolean;
  selected?: boolean;
  reason?: string;
};

export type AdaptiveWizardState = {
  normalizedInput: DecisionInput;
  candidateBasePatterns: string[];
  likelyBasePattern?: string;
  confidence: "high" | "medium" | "low";
  unresolvedCriticalQuestions: string[];
  optionalQuestions: string[];
  hiddenQuestions: AdaptiveQuestionPlanItem[];
  optionStates: Record<string, AdaptiveOptionState[]>;
  canGenerateRecommendation: boolean;
  recommendationReadinessReason: string;
  skippedCount: number;
  nextQuestionReason?: string;
};

export type TieBreakResponse = {
  /** True only when the optional independent AI review passes. */
  aiValidated?: boolean;
  generation?: { model: string; reasoningEffort: import("./ai-runtime").ReasoningEffort };
  review?: import("./recommendation-contract").RecommendationReview;
  authority?: "ai";
  contractVersion?: number;
  confidence?: "high" | "medium" | "low";
  confidenceReason?: string;
  overlays?: ArchitectureOverlay[];
  serviceSizing?: ServiceSizing[];
  sizingAssumptions?: string[];
  recommendedBasePatternId: string;
  recommendedOverlays: string[];
  agentTrace?: RecommendationAgentTraceItem[];
  recommendationMode?: "fast" | "deep";
  cacheHit?: boolean;
  solutionType?: string;
  displayPatternName?: string;
  finalRecommendation?: string;
  recommendedStack?: string[];
  optionalAddOns?: string[];
  architectureLayers?: ArchitectureLayer[];
  endToEndFlow?: string[];
  highLevelFlow?: string[];
  rationale?: string[];
  securityControls?: string[];
  zeroTrust?: ZeroTrustZone;
  reasoning: string[];
  questionsToAskNext: string[];
  assumptions: string[];
  riskFlags: string[];
  mustNotInclude: string[];
  useCaseTitle: string;
  useCaseSummary: string;
  proposedArchitectureSummary: string;
  architectureDiagramPrompt?: string;
  mermaidDiagram?: string;
};

/* ---------------- Helpers ---------------- */

export function emptyInput(): DecisionInput {
  return {
    users: [],
    channels: [],
    capabilities: [],
    dataSources: [],
    behaviors: [],
    lifecycleControls: [],
    modelStrategy: [],
    securityControls: [],
    networkControls: [],
    runtimePreferences: []
  };
}
