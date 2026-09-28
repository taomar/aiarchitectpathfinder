import { AiRecommendationSchema, AcceptedRecommendationSchema, RECOMMENDATION_CONTRACT_VERSION, type AiRecommendation } from "../../lib/recommendation-contract";
import { architectureFlowMermaid } from "../../lib/architecture-view";

export function recommendationFixture(summary = "Employees use a web app to ask read-only questions about authorized documents."): AiRecommendation {
  return AiRecommendationSchema.parse({
    outcome: "recommended",
    recommendedBasePatternId: "ai-selected-document-application",
    overlays: [{ id: "ai-governed-retrieval", name: "Governed retrieval", reason: "Document access follows source permissions.", required: true }],
    solutionType: "Microsoft Foundry",
    displayPatternName: "AI-selected document application",
    confidence: "medium",
    confidenceReason: "The user scenario is clear; volume and tenant configuration need confirmation.",
    useCaseTitle: "Authorized document answers",
    useCaseSummary: summary,
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
    highLevelFlow: ["Sign in", "Ask a question", "Retrieve authorized content", "Generate a grounded answer", "Return answer with sources"],
    rationale: ["The chosen components separate authentication, retrieval and generation."],
    securityControls: ["Source-scoped access", "Read-only business operations"],
    zeroTrust: { applicable: true, rationale: "Verify access at every source boundary.", controls: ["Least privilege"] },
    reasoning: ["This is a synthetic accepted-report fixture, not a deployed environment."],
    questionsToAskNext: ["What peak concurrency and corpus size should be tested?"],
    assumptions: ["Existing identity integration is available."],
    riskFlags: ["Capacity and citation quality must be validated."],
    mustNotInclude: ["Direct model writes to source systems"],
    architectureGraph: {
      title: "AI-owned document architecture",
      audience: ["Employees"],
      actionBoundary: "Read-only source access",
      nodes: [
        { id: "web", label: "Web app", layer: "channels", provider: "logical", kind: "capability", state: "selected", required: true, icon: "generic", detail: "Client experience.", controls: [] },
        { id: "backend", label: "Azure App Service", layer: "runtime", provider: "azure", kind: "component", state: "selected", required: true, icon: "appService", detail: "Owns authorization and model orchestration.", controls: ["Source-scoped access"] },
        { id: "identity", label: "Microsoft Entra ID", layer: "identity", provider: "microsoft-saas", kind: "component", state: "managed", required: true, icon: "entra", detail: "User authentication.", controls: [] },
        { id: "llm", label: "Azure OpenAI deployment", layer: "models", provider: "azure", kind: "component", state: "selected", required: true, icon: "azureOpenAI", detail: "Grounded text generation.", controls: [] },
        { id: "retrieval", label: "Azure AI Search", layer: "grounding", provider: "azure", kind: "component", state: "selected", required: true, icon: "aiSearch", detail: "Queries an authorized index.", controls: ["Permission filters"] },
        { id: "source", label: "Blob Storage", layer: "data", provider: "azure", kind: "source", state: "selected", required: true, icon: "blobStorage", detail: "Stores source content.", controls: ["Read-only application access"] },
        { id: "indexer", label: "Index preparation", layer: "preparation", provider: "logical", kind: "capability", state: "confirm", required: true, icon: "generic", detail: "Confirm the ingestion implementation.", controls: ["Separate ingestion identity"] }
      ],
      edges: [
        { from: "web", to: "backend", label: "Authenticated request", kind: "request" },
        { from: "backend", to: "identity", label: "Identity validation", kind: "policy" },
        { from: "backend", to: "retrieval", label: "Permission-filtered retrieval", kind: "query" },
        { from: "backend", to: "llm", label: "Generate from approved context", kind: "request" },
        { from: "source", to: "indexer", label: "Authorized background read", kind: "preparation" },
        { from: "indexer", to: "retrieval", label: "Populate index", kind: "preparation" }
      ],
      controls: {
        identity: [{ label: "User authentication", scope: "Application entry", required: true }],
        security: [{ label: "Source-scoped access", scope: "Source and retrieval boundaries", required: true }],
        readiness: [],
        operations: [{ label: "Measure latency and answer quality", scope: "Whole application", required: true }],
        network: []
      },
      decisions: ["Confirm the ingestion implementation."]
    },
    serviceSizing: [
      { id: "app", name: "Azure App Service", provider: "azure", purpose: "Application hosting", nodeIds: ["backend"], dev: "B1; 1 instance", test: "P1v3; 1 instance", prod: "P1v3; 2 instances; load-test", assumptions: ["Initial proposal; validate workload."], references: ["https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans"] },
      { id: "search", name: "Azure AI Search", provider: "azure", purpose: "Authorized retrieval", nodeIds: ["retrieval"], dev: "Basic; 1 replica / 1 partition", test: "S1; 1 replica / 1 partition", prod: "S1; 3 replicas; partitions by index size", assumptions: ["Indexing and queries share the service."], references: ["https://learn.microsoft.com/en-us/azure/reliability/reliability-ai-search"] },
      { id: "model", name: "Azure OpenAI deployment", provider: "azure", purpose: "Grounded answers", nodeIds: ["llm"], dev: "Standard; low test quota", test: "Standard; representative TPM/RPM", prod: "Standard or PTU after throughput measurement", assumptions: ["Prompt/output token distribution is not measured."], references: [] },
      { id: "storage", name: "Blob Storage", provider: "azure", purpose: "Source documents", nodeIds: ["source"], dev: "GPv2; LRS; sample corpus", test: "GPv2; LRS; representative corpus", prod: "GPv2; ZRS where supported; size by corpus", assumptions: ["Redundancy and recovery policy must be approved."], references: [] },
      { id: "entra", name: "Microsoft Entra ID", provider: "microsoft-saas", purpose: "User sign-in", nodeIds: ["identity"], dev: "Test registration; limited users", test: "Test assignments and policies", prod: "Production registration and approved licenses", assumptions: [], references: [] }
    ],
    sizingAssumptions: ["These are unmeasured starting configurations; confirm request rates, tokens, corpus size and region."],
    changesFromDraft: [{ change: "Use the AI-selected application architecture.", reason: "The preliminary route was only a suggestion." }]
  });
}

export function acceptedFixture(summary?: string) {
  const report = recommendationFixture(summary);
  return AcceptedRecommendationSchema.parse({
    ...report, authority: "ai", contractVersion: RECOMMENDATION_CONTRACT_VERSION,
    aiValidated: false, recommendationMode: "fast", cacheHit: false,
    generation: { model: "test-sol", reasoningEffort: "xhigh" },
    review: { status: "not-requested" },
    recommendedOverlays: report.overlays.map(overlay => overlay.id),
    architectureDiagramPrompt: "Render the accepted AI graph without architectural re-evaluation.",
    mermaidDiagram: architectureFlowMermaid(report.highLevelFlow),
    agentTrace: [
      { agent: "Recommendation Composer", status: "passed", summary: "Synthetic AI result for a controlled browser test.", details: ["test-composer"] },
      { agent: "Architecture Critic", status: "skipped", summary: "Optional review was not requested.", details: [] }
    ]
  });
}
