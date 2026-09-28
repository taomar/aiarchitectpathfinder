import { z } from "zod";
import type { ArchitectureDecision, DecisionInput } from "./types";
import { ARCHITECTURE_ICONS, type ArchitectureIcon } from "./architecture-assets";
import { ARCHITECTURE_DISCLAIMER, ARCHITECTURE_VIEW_LAYERS, VIEW_LAYER_IDS, type ArchitectureView } from "./architecture-view";
import { AI_REASONING_EFFORTS } from "./recommendation-policy";

export const RECOMMENDATION_CONTRACT_VERSION = 4;
export const HIGH_LEVEL_NODE_LIMIT = 12;
export const HIGH_LEVEL_EDGE_LIMIT = 18;
export const HIGH_LEVEL_FLOW_LIMIT = 8;
const sentence = z.string().trim().min(1).max(1600);
const shortText = z.string().trim().min(1).max(180);
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const textList = z.array(sentence).max(40);
const layerId = z.enum(VIEW_LAYER_IDS);
const provider = z.enum(["azure", "microsoft-saas", "external", "logical"]);
const icon = z.enum(["generic", ...Object.keys(ARCHITECTURE_ICONS).filter((value): value is ArchitectureIcon =>
  value !== "generic" && Object.prototype.hasOwnProperty.call(ARCHITECTURE_ICONS, value))]);
const control = z.object({ label: shortText, scope: sentence, required: z.boolean() }).strict();

export const RecommendationGraphSchema = z.object({
  title: shortText,
  audience: z.array(shortText).max(12),
  actionBoundary: sentence,
  nodes: z.array(z.object({
    id: identifier,
    label: shortText,
    layer: layerId,
    provider,
    kind: z.enum(["component", "platform", "capability", "source"]),
    state: z.enum(["selected", "managed", "confirm"]),
    required: z.boolean(),
    icon,
    detail: sentence,
    controls: z.array(shortText).max(20)
  }).strict()).max(HIGH_LEVEL_NODE_LIMIT),
  edges: z.array(z.object({
    from: identifier,
    to: identifier,
    label: shortText,
    kind: z.enum(["request", "query", "preparation", "contains", "conditional", "policy"])
  }).strict()).max(HIGH_LEVEL_EDGE_LIMIT),
  controls: z.object({
    identity: z.array(control).max(20),
    security: z.array(control).max(24),
    readiness: z.array(control).max(20),
    operations: z.array(control).max(20),
    network: z.array(control).max(20)
  }).strict(),
  decisions: textList
}).strict();

export const ServiceSizingSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(64),
  provider,
  purpose: z.string().trim().min(1).max(80),
  nodeIds: z.array(identifier).max(HIGH_LEVEL_NODE_LIMIT),
  dev: z.string().trim().min(1).max(90),
  test: z.string().trim().min(1).max(90),
  prod: z.string().trim().min(1).max(90),
  assumptions: z.array(sentence).max(8),
  references: z.array(z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      ["learn.microsoft.com", "azure.microsoft.com"].includes(url.hostname);
  }, "Reference a public Microsoft documentation URL.")).max(3)
}).strict();

const RecommendationObject = z.object({
  outcome: z.enum(["recommended", "needs-clarification"]),
  recommendedBasePatternId: identifier,
  overlays: z.array(z.object({
    id: identifier, name: shortText, reason: sentence, required: z.boolean()
  }).strict()).max(16),
  solutionType: shortText,
  displayPatternName: shortText,
  confidence: z.enum(["high", "medium", "low"]),
  confidenceReason: sentence,
  useCaseTitle: z.string().trim().min(1).max(100),
  useCaseSummary: z.string().trim().min(1).max(3000),
  proposedArchitectureSummary: z.string().trim().min(1).max(12000),
  finalRecommendation: z.string().trim().min(1).max(3000),
  recommendedStack: z.array(shortText).max(40),
  optionalAddOns: textList,
  architectureLayers: z.array(z.object({
    layer: z.enum([
      "User/Channel", "Identity", "Experience", "Runtime/Backend", "Analytics/Grounding",
      "Orchestration", "AI Platform", "Knowledge/Data", "Integration", "Security",
      "Observability", "Network/Deployment"
    ]),
    selections: z.array(shortText).max(20),
    required: z.boolean(),
    reason: sentence
  }).strict()).max(12),
  endToEndFlow: textList,
  highLevelFlow: z.array(z.string().trim().min(1).max(100)).max(HIGH_LEVEL_FLOW_LIMIT),
  rationale: textList,
  securityControls: textList,
  zeroTrust: z.object({ applicable: z.boolean(), rationale: sentence, controls: textList }).strict(),
  reasoning: textList,
  questionsToAskNext: textList,
  assumptions: textList,
  riskFlags: textList,
  mustNotInclude: textList,
  architectureGraph: RecommendationGraphSchema,
  serviceSizing: z.array(ServiceSizingSchema).max(32),
  sizingAssumptions: z.array(sentence).max(12),
  changesFromDraft: z.array(z.object({ change: sentence, reason: sentence }).strict()).max(16)
}).strict();

type RecommendationShape = z.infer<typeof RecommendationObject>;
function validateReferences(report: RecommendationShape, context: z.RefinementCtx) {
  const issue = (path: Array<string | number>, message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length) issue([path], "Identifiers must be unique.");
  };
  const nodes = report.architectureGraph.nodes;
  const nodeIds = new Set(nodes.map(node => node.id));
  unique([...nodes.map(node => node.id)], "architectureGraph");
  unique(report.architectureLayers.map(layer => layer.layer), "architectureLayers");
  unique(report.overlays.map(overlay => overlay.id), "overlays");
  unique(report.serviceSizing.map(service => service.id), "serviceSizing");
  for (const [index, edge] of report.architectureGraph.edges.entries()) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
      issue(["architectureGraph", "edges", index], "Connections must refer to two different existing node IDs.");
    }
  }
  for (const [index, service] of report.serviceSizing.entries()) {
    if (service.nodeIds.some(id => !nodeIds.has(id))) issue(["serviceSizing", index, "nodeIds"], "Service rows must reference existing graph nodes.");
  }
  for (const node of nodes.filter(node => node.provider === "azure")) {
    if (!report.serviceSizing.some(service => service.provider === "azure" && service.nodeIds.includes(node.id))) {
      issue(["serviceSizing"], `Include the Azure service sizing row for graph node ${node.id}.`);
    }
  }
  if (report.outcome === "recommended" && (!nodes.length || !report.recommendedStack.length || !report.endToEndFlow.length || !report.highLevelFlow.length)) {
    issue(["outcome"], "A recommendation requires services, an integration graph and a high-level flow.");
  }
  if (report.outcome === "needs-clarification" && !report.questionsToAskNext.length) {
    issue(["questionsToAskNext"], "Explain which missing requirements prevent a recommendation.");
  }
}

export const AiRecommendationSchema = RecommendationObject.superRefine(validateReferences);
export type AiRecommendation = z.infer<typeof AiRecommendationSchema>;

const CompletedReviewSchema = z.object({
  status: z.enum(["passed", "issues-found"]),
  summary: sentence,
  issues: z.array(z.string().trim().min(1).max(2000)).max(15),
  model: shortText,
  reasoningEffort: z.enum(AI_REASONING_EFFORTS)
}).strict();
export const RecommendationReviewSchema = z.union([
  z.object({ status: z.literal("not-requested") }).strict(),
  CompletedReviewSchema
]);
export type RecommendationReview = z.infer<typeof RecommendationReviewSchema>;

// Acceptance means the AI artifact is structurally renderable, not independently reviewed.
export const AcceptedRecommendationSchema = RecommendationObject.extend({
  authority: z.literal("ai"),
  contractVersion: z.literal(RECOMMENDATION_CONTRACT_VERSION),
  aiValidated: z.boolean(),
  generation: z.object({ model: shortText, reasoningEffort: z.enum(AI_REASONING_EFFORTS) }).strict(),
  review: RecommendationReviewSchema,
  recommendedOverlays: z.array(identifier).max(16),
  recommendationMode: z.enum(["fast", "deep"]),
  cacheHit: z.boolean(),
  mermaidDiagram: z.string().max(50000),
  architectureDiagramPrompt: z.string().max(2000),
  agentTrace: z.array(z.object({
    agent: shortText,
    status: z.enum(["passed", "warning", "failed", "skipped"]),
    summary: sentence,
    details: z.array(shortText).max(8)
  }).strict()).max(6)
}).strict().superRefine((report, context) => {
  validateReferences(report, context);
  if (report.aiValidated !== (report.review.status === "passed")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["aiValidated"], message: "Only a passed independent review may set aiValidated." });
  }
  if (report.review.status === "passed" && report.review.issues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "A passed review must not contain unresolved issues." });
  }
  if (report.review.status === "issues-found" && !report.review.issues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "A review with findings must explain the issues." });
  }
});
export type AcceptedRecommendation = z.infer<typeof AcceptedRecommendationSchema>;

export function recommendationContent(report: AcceptedRecommendation): AiRecommendation {
  return AiRecommendationSchema.parse(RecommendationObject.strip().parse(report));
}

export function recommendationReviewLabel(review: RecommendationReview) {
  return review.status === "passed" ? "AI review passed"
    : review.status === "issues-found" ? `AI review: ${review.issues.length} issue${review.issues.length === 1 ? "" : "s"} found`
    : "Not independently reviewed";
}

export function approvedArchitectureView(report: AiRecommendation): ArchitectureView {
  const graph = report.architectureGraph;
  return {
    version: 1,
    authority: "ai",
    title: graph.title,
    disclaimer: ARCHITECTURE_DISCLAIMER,
    audience: graph.audience,
    actionBoundary: graph.actionBoundary,
    layers: ARCHITECTURE_VIEW_LAYERS.map(layer => ({
      ...layer,
      nodes: graph.nodes.filter(node => node.layer === layer.id).map(node => ({
        id: node.id, label: node.label, detail: node.detail, layer: node.layer, provider: node.provider,
        kind: node.kind, state: node.state, required: node.required,
        ...(ARCHITECTURE_ICONS[node.icon] ? { icon: ARCHITECTURE_ICONS[node.icon]! } : {}),
        sourceLabels: [node.label], controls: node.controls
      }))
    })),
    edges: graph.edges,
    controls: graph.controls,
    decisions: graph.decisions
  };
}

export function recommendationDecision(report: AcceptedRecommendation): ArchitectureDecision {
  return {
    authority: "ai",
    solutionType: report.solutionType,
    basePatternId: report.recommendedBasePatternId,
    basePatternName: report.displayPatternName,
    overlays: report.overlays,
    recommendedStack: report.recommendedStack,
    optionalAddOns: report.optionalAddOns,
    blockedComponents: report.mustNotInclude,
    forbiddenUnlessConfirmed: report.mustNotInclude,
    rationale: report.rationale,
    confidence: report.confidence,
    confidenceReason: report.confidenceReason,
    needsTieBreak: false,
    missingQuestions: report.questionsToAskNext.map((title, index) => ({
      id: `ai-question-${index + 1}`, title, layer: "Validation", type: "text", required: true
    })),
    architectureLayers: report.architectureLayers,
    endToEndFlow: report.endToEndFlow,
    highLevelFlow: report.highLevelFlow,
    securityControls: report.securityControls,
    zeroTrust: report.zeroTrust,
    assumptions: report.assumptions,
    riskFlags: report.riskFlags,
    finalRecommendation: report.finalRecommendation,
    candidateBasePatternIds: [],
    approvedArchitecture: approvedArchitectureView(report),
    approvedSummary: report.proposedArchitectureSummary,
    serviceSizing: report.serviceSizing,
    sizingAssumptions: report.sizingAssumptions
  };
}

export const DecisionInputSchema: z.ZodType<DecisionInput> = z.object({
  summary: z.string().max(16000).optional(),
  directTextRecommendation: z.boolean().optional(),
  users: z.array(z.enum(["internal_employees", "external_customers", "citizens", "partners", "admins", "developers", "mixed", "unknown"])).max(8),
  channels: z.array(z.enum(["m365_copilot", "teams", "m365", "web", "mobile", "portal", "api", "embedded", "multiple", "unknown"])).max(10),
  capabilities: z.array(z.enum(["personal_productivity", "employee_assistant", "fabric_analytics", "document_rag", "operational_query", "business_workflow", "approval", "transaction", "record_update", "multi_agent", "custom_app", "unknown"])).max(12),
  dataSources: z.array(z.enum(["m365_graph", "sharepoint", "fabric_onelake", "fabric_lakehouse", "fabric_warehouse", "powerbi_semantic_model", "kql_eventhouse", "documents", "blob_storage", "azure_sql", "dataverse", "apis", "erp_crm", "on_prem", "internet", "unknown"])).max(16),
  behaviors: z.array(z.enum(["qa", "analytics", "retrieval", "read_only_query", "summarization", "recommendation", "record_update", "workflow", "approval", "transaction", "long_running_process", "multi_agent", "unknown"])).max(13),
  lifecycleControls: z.array(z.enum(["none", "evaluation", "tracing", "monitoring", "safety_testing", "prompt_versioning", "model_versioning", "model_routing", "governance", "unknown"])).max(10),
  securityControls: z.array(z.enum(["entra_id", "entra_external_id", "rbac", "rls_ols", "dlp", "audit", "key_vault", "managed_identity", "waf", "apim", "purview", "defender", "unknown"])).max(13),
  networkControls: z.array(z.enum(["public", "vnet", "private_link", "private_endpoint", "vpn", "expressroute", "no_public_endpoint", "data_residency", "regulated", "on_prem_connectivity", "unknown"])).max(11),
  runtimePreferences: z.array(z.enum(["none", "copilot_studio", "custom_backend", "foundry_agent_service", "m365_agents_sdk", "functions", "container_apps", "app_service", "aks", "unknown"])).max(10),
  modelStrategy: z.array(z.enum(["standard_foundation_model", "azure_openai", "foundry_model_catalog", "anthropic_claude", "xai_grok", "fine_tuned_azure_openai", "fine_tuned_foundry_model", "azure_ml_custom_model", "azure_ml_endpoint", "bring_your_own_model", "unknown"])).max(11).optional(),
  fabricAnalyticsIntent: z.enum(["read_only_analytics_qa", "predefined_reports_apis", "storage_only", "unknown"]).optional(),
  fabricUserAccess: z.enum(["internal_fabric_permissions", "b2b_governed_fabric_access", "external_customers_citizens", "anonymous_users", "unknown"]).optional(),
  advancedRagRequirements: z.array(z.enum(["none", "custom_vector_search", "hybrid_search", "large_scale_indexing", "custom_ingestion", "custom_chunking", "ocr_enrichment", "metadata_filtering", "reusable_enterprise_index", "private_search_service", "multi_app_search_reuse", "explicit_azure_ai_search", "unknown"])).max(13).optional(),
  lowCodePreferred: z.boolean().optional(),
  writeBackConfirmed: z.boolean().optional(),
  externalAccessConfirmed: z.boolean().optional(),
  externalAccessUnknown: z.boolean().optional(),
  m365ExtensibilityRequired: z.boolean().optional(),
  m365ExtensibilityUnknown: z.boolean().optional(),
  semanticModelUsed: z.boolean().optional(),
  semanticModelSecurityKnown: z.boolean().optional(),
  semanticModelConfirmations: z.array(z.string().max(80)).max(16).optional(),
  workflowExecution: z.array(z.string().max(80)).max(16).optional(),
  notes: z.string().max(8000).optional()
});
