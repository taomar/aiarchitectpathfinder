import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AiRecommendationSchema, AiArchitectureSchema, AcceptedRecommendationSchema, RecommendationArchitectureSchema,
  approvedArchitectureView, RECOMMENDATION_CONTRACT_VERSION, type AiRecommendation
} from "../../lib/recommendation-contract";
import { architectureFlowMermaid } from "../../lib/architecture-view";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";

export function recommendationFixture(summary = "Employees use a web app to ask read-only questions about authorized documents."): AiRecommendation {
  return AiRecommendationSchema.parse({
    outcome: "recommended", recommendedBasePatternId: "ai-selected-document-application",
    overlays: [{ id: "ai-governed-retrieval", name: "Governed retrieval", reason: "Document access follows source permissions.", required: true }],
    solutionType: "Microsoft Foundry", displayPatternName: "AI-selected document application", confidence: "medium",
    confidenceReason: "The user scenario is clear; volume and tenant configuration need confirmation.",
    useCaseTitle: "Authorized document answers", useCaseSummary: summary,
    proposedArchitectureSummary: "The AI recommends a web application with governed retrieval. The application authenticates the requester before obtaining source-authorized context.\n\nThe model drafts an answer using that context. Source references and abstention behavior must be tested before production use.",
    finalRecommendation: "Use the AI-selected application and validate its source authorization before rollout.",
    recommendedStack: ["Azure App Service", "Azure AI Search", "Azure OpenAI deployment", "Blob Storage", "Microsoft Entra ID"],
    optionalAddOns: ["Consider multi-region recovery after agreeing on recovery objectives."],
    architectureLayers: [
      { layer: "User/Channel", selections: ["Web app"], required: true, reason: "The requested user experience." },
      { layer: "Identity", selections: ["Microsoft Entra ID"], required: true, reason: "Authenticate users." },
      { layer: "Runtime/Backend", selections: ["Azure App Service"], required: true, reason: "Hosts the authorized application." },
      { layer: "AI Platform", selections: ["Azure OpenAI deployment"], required: true, reason: "Generates a response from approved context." },
      { layer: "Analytics/Grounding", selections: ["Azure AI Search"], required: true, reason: "Permission-aware retrieval." },
      { layer: "Knowledge/Data", selections: ["Blob Storage"], required: true, reason: "Authoritative source documents." },
      { layer: "Security", selections: ["Source-scoped access", "Read-only business operations"], required: true, reason: "Protect source data." }
    ],
    endToEndFlow: ["The web app authenticates the user.", "The backend retrieves only authorized content.", "The model drafts a grounded response."],
    rationale: ["The chosen components separate authentication, retrieval and generation."],
    securityControls: ["Source-scoped access", "Read-only business operations"],
    zeroTrust: { applicable: true, rationale: "Verify access at every source boundary.", controls: ["Least privilege"] },
    reasoning: ["This is a synthetic report fixture, not a deployed environment."],
    questionsToAskNext: ["What peak concurrency and corpus size should be tested?"], assumptions: ["Existing identity integration is available."],
    riskFlags: ["Capacity and citation quality must be validated."], mustNotInclude: ["Direct model writes to source systems"],
    serviceSizing: [
      { id: "app", name: "Azure App Service", provider: "azure", purpose: "Application hosting", dev: "B1; 1 instance", test: "P1v3; 1 instance", prod: "P1v3; 2 instances; load-test", assumptions: ["Initial proposal; validate workload."], references: ["https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans"] },
      { id: "search", name: "Azure AI Search", provider: "azure", purpose: "Authorized retrieval", dev: "Basic; 1 replica / 1 partition", test: "S1; 1 replica / 1 partition", prod: "S1; 3 replicas; partitions by index size", assumptions: ["Indexing and queries share the service."], references: ["https://learn.microsoft.com/en-us/azure/reliability/reliability-ai-search"] },
      { id: "model", name: "Azure OpenAI deployment", provider: "azure", purpose: "Grounded answers", dev: "Standard; low test quota", test: "Standard; representative TPM/RPM", prod: "Standard or PTU after throughput measurement", assumptions: ["Prompt/output token distribution is not measured."], references: [] },
      { id: "storage", name: "Blob Storage", provider: "azure", purpose: "Source documents", dev: "GPv2; LRS; sample corpus", test: "GPv2; LRS; representative corpus", prod: "GPv2; ZRS where supported; size by corpus", assumptions: ["Redundancy and recovery policy must be approved."], references: [] },
      { id: "entra", name: "Microsoft Entra ID", provider: "microsoft-saas", purpose: "User sign-in", dev: "Test registration; limited users", test: "Test assignments and policies", prod: "Production registration and approved licenses", assumptions: [], references: [] }
    ],
    sizingAssumptions: ["These are unmeasured starting configurations; confirm request rates, tokens, corpus size and region."],
    changesFromDraft: [{ change: "Use the AI-selected application architecture.", reason: "The preliminary route was only a suggestion." }]
  });
}

export function architectureFixture() {
  return AiArchitectureSchema.parse({
    graph: {
      title: "AI-owned document architecture", audience: ["Employees"], actionBoundary: "Read-only source access",
      nodes: [
        { id: "web", label: "Web app", layer: "channels", provider: "logical", kind: "capability", state: "selected", required: true, icon: "generic", symbol: "app", serviceIds: [], detail: "Client experience.", controls: [] },
        { id: "backend", label: "Azure App Service", layer: "runtime", provider: "azure", kind: "component", state: "selected", required: true, icon: "appService", symbol: "app", serviceIds: ["app"], detail: "Owns authorization and model orchestration.", controls: ["Source-scoped access"] },
        { id: "identity", label: "Microsoft Entra ID", layer: "identity", provider: "microsoft-saas", kind: "component", state: "managed", required: true, icon: "entra", symbol: "generic", serviceIds: ["entra"], detail: "User authentication.", controls: [] },
        { id: "llm", label: "Azure OpenAI", layer: "models", provider: "azure", kind: "component", state: "selected", required: true, icon: "azureOpenAI", symbol: "generic", serviceIds: ["model"], detail: "Grounded text generation.", controls: [] },
        { id: "retrieval", label: "Azure AI Search", layer: "grounding", provider: "azure", kind: "component", state: "selected", required: true, icon: "aiSearch", symbol: "generic", serviceIds: ["search"], detail: "Queries an authorized index.", controls: ["Permission filters"] },
        { id: "source", label: "Blob Storage", layer: "data", provider: "azure", kind: "source", state: "selected", required: true, icon: "blobStorage", symbol: "generic", serviceIds: ["storage"], detail: "Stores source content.", controls: ["Read-only application access"] },
        { id: "indexer", label: "Index preparation", layer: "preparation", provider: "logical", kind: "capability", state: "confirm", required: true, icon: "generic", symbol: "workflow", serviceIds: [], detail: "Confirm the ingestion implementation.", controls: ["Separate ingestion identity"] }
      ],
      edges: [
        { from: "web", to: "backend", label: "Authenticated request", kind: "request" },
        { from: "backend", to: "identity", label: "Validate identity", kind: "policy" },
        { from: "backend", to: "retrieval", label: "Authorized retrieval", kind: "query" },
        { from: "backend", to: "llm", label: "Generate answer", kind: "request" },
        { from: "source", to: "indexer", label: "Read source", kind: "preparation" },
        { from: "indexer", to: "retrieval", label: "Populate index", kind: "preparation" }
      ],
      controls: { identity: [{ label: "User authentication", scope: "Application entry", required: true }], security: [{ label: "Source-scoped access", scope: "Source and retrieval boundaries", required: true }], readiness: [], operations: [], network: [] },
      decisions: ["Confirm the ingestion implementation."]
    },
    flow: {
      nodes: [
        { id: "ask", kind: "step", label: "Ask a question" },
        { id: "retrieve", kind: "step", label: "Retrieve authorized evidence" },
        { id: "evidence", kind: "decision", label: "Supporting evidence available?" },
        { id: "answer", kind: "outcome", label: "Return a cited answer" },
        { id: "abstain", kind: "outcome", label: "Abstain and direct to support" }
      ],
      edges: [{ from: "ask", to: "retrieve", label: "" }, { from: "retrieve", to: "evidence", label: "" }, { from: "evidence", to: "answer", label: "Yes" }, { from: "evidence", to: "abstain", label: "No" }]
    }
  });
}

export function initialFixture(summary?: string) {
  const report = recommendationFixture(summary);
  return AcceptedRecommendationSchema.parse({
    ...report, reportId: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    architecture: null, authority: "ai", contractVersion: RECOMMENDATION_CONTRACT_VERSION,
    aiValidated: false, generation: { model: "test-sol", reasoningEffort: "xhigh" },
    review: { status: "not-requested" }, recommendationMode: "fast", cacheHit: false,
    recommendedOverlays: report.overlays.map(overlay => overlay.id),
    agentTrace: [{ agent: "Recommendation Composer", status: "passed", summary: "Synthetic AI result.", details: ["test-sol"] },
      { agent: "Architecture Critic", status: "skipped", summary: "Optional review was not requested.", details: [] }]
  });
}

export function acceptedFixture(summary?: string) {
  const report = initialFixture(summary);
  const content = architectureFixture();
  const view = approvedArchitectureView(content);
  const icons = new Map(view.layers.flatMap(layer => layer.nodes.flatMap(node => node.icon ? [[node.icon,
    `data:image/svg+xml;base64,${fs.readFileSync(path.join(process.cwd(), "public", ...node.icon.split("/").filter(Boolean))).toString("base64")}`] as const] : [])));
  const architecture = RecommendationArchitectureSchema.parse({
    ...content, reportId: report.reportId,
    id: createHash("sha256").update(JSON.stringify(content)).digest("hex"), model: "test-sol",
    svg: renderArchitectureViewSvg(view, icons), mermaid: architectureFlowMermaid(content.flow)
  });
  return { ...AcceptedRecommendationSchema.parse({ ...report, architecture }), architecture };
}
