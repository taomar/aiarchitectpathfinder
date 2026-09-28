import { z } from "zod";
import type { ArchitectureDecision, DecisionInput } from "./types";
import { ARCHITECTURE_ICONS, type ArchitectureIcon } from "./architecture-assets";
import { ARCHITECTURE_DISCLAIMER, ARCHITECTURE_VIEW_LAYERS, VIEW_LAYER_IDS, type ArchitectureView } from "./architecture-view";
import { AI_REASONING_EFFORTS } from "./recommendation-policy";

export const RECOMMENDATION_CONTRACT_VERSION = 5;
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
    label: z.string().trim().min(1).max(64),
    layer: layerId,
    provider,
    kind: z.enum(["component", "platform", "capability", "source"]),
    state: z.enum(["selected", "managed", "confirm"]),
    required: z.boolean(),
    icon,
    symbol: z.enum(["person", "app", "api", "workflow", "generic"]),
    serviceIds: z.array(identifier).max(8),
    detail: sentence,
    controls: z.array(shortText).max(20)
  }).strict()).min(1).max(HIGH_LEVEL_NODE_LIMIT),
  edges: z.array(z.object({
    from: identifier,
    to: identifier,
    label: z.string().trim().min(1).max(64),
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
  rationale: textList,
  securityControls: textList,
  zeroTrust: z.object({ applicable: z.boolean(), rationale: sentence, controls: textList }).strict(),
  reasoning: textList,
  questionsToAskNext: textList,
  assumptions: textList,
  riskFlags: textList,
  mustNotInclude: textList,
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
  unique(report.architectureLayers.map(layer => layer.layer), "architectureLayers");
  unique(report.overlays.map(overlay => overlay.id), "overlays");
  unique(report.serviceSizing.map(service => service.id), "serviceSizing");
  if (report.outcome === "recommended" && (!report.recommendedStack.length || !report.endToEndFlow.length)) {
    issue(["outcome"], "A recommendation requires services and a described end-to-end flow.");
  }
  if (report.outcome === "needs-clarification" && !report.questionsToAskNext.length) {
    issue(["questionsToAskNext"], "Explain which missing requirements prevent a recommendation.");
  }
}

export const AiRecommendationSchema = RecommendationObject.superRefine(validateReferences);
export type AiRecommendation = z.infer<typeof AiRecommendationSchema>;

export const RecommendationFlowSchema = z.object({
  nodes: z.array(z.object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    kind: z.enum(["step", "decision", "outcome"])
  }).strict()).min(1).max(HIGH_LEVEL_FLOW_LIMIT),
  edges: z.array(z.object({
    from: identifier, to: identifier,
    label: z.string().trim().max(40)
  }).strict()).max(10)
}).strict();
export type RecommendationFlow = z.infer<typeof RecommendationFlowSchema>;

function validateDiagram(
  artifact: { graph: z.infer<typeof RecommendationGraphSchema>; flow: RecommendationFlow },
  context: z.RefinementCtx
) {
  for (const [name, graph] of [["graph", artifact.graph], ["flow", artifact.flow]] as const) {
    const ids = new Set(graph.nodes.map(node => node.id));
    if (ids.size !== graph.nodes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: [name, "nodes"], message: "Component identifiers must be unique." });
    for (const [index, edge] of graph.edges.entries()) {
      if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [name, "edges", index], message: "Connections require two different existing node IDs." });
      }
    }
  }
  for (const node of artifact.flow.nodes) {
    const outgoing = artifact.flow.edges.filter(edge => edge.from === node.id);
    if (node.kind === "outcome" && outgoing.length || node.kind === "step" && outgoing.length !== 1 ||
        node.kind === "decision" && (outgoing.length < 2 || outgoing.some(edge => !edge.label.trim()))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["flow", "nodes"], message: "Steps need one next edge; decisions need labelled alternatives; outcomes must terminate." });
    }
  }
  const starts = artifact.flow.nodes.filter(node => !artifact.flow.edges.some(edge => edge.to === node.id));
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    artifact.flow.edges.filter(edge => edge.from === id).forEach(edge => visit(edge.to));
  };
  starts.forEach(node => visit(node.id));
  if (!starts.length || visited.size !== artifact.flow.nodes.length || !artifact.flow.nodes.some(node => node.kind === "outcome")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["flow"], message: "The high-level flow needs a reachable entry and at least one terminal outcome." });
  }
}

const ArchitectureObject = z.object({ graph: RecommendationGraphSchema, flow: RecommendationFlowSchema }).strict();
export const AiArchitectureSchema = ArchitectureObject.superRefine(validateDiagram);
export type AiArchitecture = z.infer<typeof AiArchitectureSchema>;
export const RecommendationArchitectureSchema = ArchitectureObject.extend({
  reportId: z.string().regex(/^[a-f0-9]{64}$/),
  id: z.string().regex(/^[a-f0-9]{64}$/),
  svg: z.string().min(1).max(1_500_000),
  mermaid: z.string().min(1).max(50000),
  model: shortText
}).strict().superRefine(validateDiagram);
export type RecommendationArchitecture = z.infer<typeof RecommendationArchitectureSchema>;

export function validateArchitectureServices(architecture: AiArchitecture, report: AiRecommendation): string[] {
  const services = new Map(report.serviceSizing.map(service => [service.id, service]));
  return architecture.graph.nodes.flatMap(node => {
    const issues = node.serviceIds.filter(id => !services.has(id)).map(id => `Node ${node.id} references unknown service ${id}.`);
    if (node.provider === "azure" && !node.serviceIds.some(id => services.get(id)?.provider === "azure")) {
      issues.push(`Azure node ${node.id} must reference an Azure service from the recommendation.`);
    }
    return issues;
  });
}

const CompletedReviewSchema = z.object({
  status: z.enum(["passed", "issues-found"]),
  summary: sentence,
  issues: z.array(z.string().trim().min(1).max(2000)).max(15),
  model: shortText,
  reasoningEffort: z.enum(AI_REASONING_EFFORTS),
  scope: z.enum(["recommendation", "recommendation-and-architecture"]),
  architectureId: z.string().regex(/^[a-f0-9]{64}$/).nullable()
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
  reportId: z.string().regex(/^[a-f0-9]{64}$/),
  architecture: RecommendationArchitectureSchema.nullable(),
  generation: z.object({ model: shortText, reasoningEffort: z.enum(AI_REASONING_EFFORTS) }).strict(),
  review: RecommendationReviewSchema,
  recommendedOverlays: z.array(identifier).max(16),
  recommendationMode: z.enum(["fast", "deep"]),
  cacheHit: z.boolean(),
  agentTrace: z.array(z.object({
    agent: shortText,
    status: z.enum(["passed", "warning", "failed", "skipped"]),
    summary: sentence,
    details: z.array(shortText).max(8)
  }).strict()).max(6)
}).strict().superRefine((report, context) => {
  validateReferences(report, context);
  if (report.architecture) {
    if (report.architecture.reportId !== report.reportId) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["architecture", "reportId"], message: "The diagram belongs to a different recommendation."
    });
    for (const message of validateArchitectureServices(report.architecture, report)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["architecture"], message
    });
  }
  if (report.aiValidated !== (report.review.status === "passed")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["aiValidated"], message: "Only a passed independent review may set aiValidated." });
  }
  if (report.review.status === "passed" && report.review.issues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "A passed review must not contain unresolved issues." });
  }
  if (report.review.status === "issues-found" && !report.review.issues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "A review with findings must explain the issues." });
  }
  if (report.review.status !== "not-requested" &&
      (report.review.scope === "recommendation") !== (report.review.architectureId === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["review"], message: "Review scope must identify whether an architecture was reviewed." });
  }
});
export type AcceptedRecommendation = z.infer<typeof AcceptedRecommendationSchema>;

export function attachRecommendationArchitecture(report: AcceptedRecommendation, architecture: RecommendationArchitecture): AcceptedRecommendation {
  const staleReview = report.review.status !== "not-requested" &&
    report.review.scope === "recommendation-and-architecture" && report.review.architectureId !== architecture.id;
  return AcceptedRecommendationSchema.parse({
    ...report, architecture,
    ...(staleReview ? {
      review: { status: "not-requested" }, aiValidated: false,
      agentTrace: report.agentTrace.map(item => item.agent === "Architecture Critic"
        ? { ...item, status: "skipped", summary: "The diagram changed after the previous review. Request a new review if needed.", details: [] } : item)
    } : {})
  });
}

export function recommendationContent(report: AcceptedRecommendation): AiRecommendation {
  return AiRecommendationSchema.parse(RecommendationObject.strip().parse(report));
}

export function recommendationReviewLabel(review: RecommendationReview) {
  return review.status === "passed" ? review.scope === "recommendation" ? "Recommendation review passed (diagram not reviewed)" : "AI review passed"
    : review.status === "issues-found" ? `AI review: ${review.issues.length} issue${review.issues.length === 1 ? "" : "s"} found`
    : "Not independently reviewed";
}

export function approvedArchitectureView(architecture: AiArchitecture): ArchitectureView {
  const graph = architecture.graph;
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
        symbol: node.symbol,
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
    highLevelFlow: report.architecture?.flow,
    securityControls: report.securityControls,
    zeroTrust: report.zeroTrust,
    assumptions: report.assumptions,
    riskFlags: report.riskFlags,
    finalRecommendation: report.finalRecommendation,
    candidateBasePatternIds: [],
    approvedArchitecture: report.architecture ? approvedArchitectureView(report.architecture) : undefined,
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
