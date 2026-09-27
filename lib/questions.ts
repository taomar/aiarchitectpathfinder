import type {
  DecisionInput,
  WizardQuestion,
  UserType,
  Channel,
  Capability,
  DataSource,
  AgentBehavior,
  LifecycleControl,
  FabricAnalyticsIntent,
  FabricUserAccess,
  ModelStrategy,
  SecurityControl,
  NetworkControl,
  RuntimePreference,
  AdvancedRagRequirement
} from "./types";
import {
  hasAmbiguousWorkflowIntent,
  hasConfirmedWriteAction,
  hasDocumentIntent,
  hasExternalChannel,
  hasExternalUser,
  hasFabricSource,
  hasTeamsChannel,
  hasConfirmedSemanticModelReadiness,
  DIRECT_ACTIONABLE_BEHAVIORS,
  needsSemanticModelGuidance
} from "./rules";
import { classifyAdaptiveQuestions } from "./adaptive-wizard";

/* ---------- helpers ---------- */
const opt = (id: string, label: string, description?: string, group?: string) => ({ id, label, description, group });

const WORKFLOW_BEHAVIORS: Record<string, AgentBehavior> = {
  updates: "record_update",
  approval: "approval",
  transaction: "transaction",
  long_running: "long_running_process"
};

function applyArray<T extends keyof DecisionInput>(field: T) {
  return (input: DecisionInput, value: any): DecisionInput => ({
    ...input,
    [field]: Array.isArray(value) ? (value as any) : []
  });
}
function readArray<T extends keyof DecisionInput>(field: T) {
  return (input: DecisionInput) => (input[field] as any) ?? [];
}
function answeredArray<T extends keyof DecisionInput>(field: T) {
  return (input: DecisionInput) => Array.isArray(input[field]) && (input[field] as any[]).length > 0;
}

/* ================================================================
 * QUESTIONS — in the order they should be asked.
 * Every list-style question is multi-select.
 * ================================================================ */

export const QUESTIONS: WizardQuestion[] = [
  /* 1 — Intent (free text, optional) */
  {
    id: "summary",
    layer: "Intent",
    type: "text",
    title: "Tell us the scenario",
    helperText:
      "Optional. A short use-case helps the final recommendation use your words.",
    required: false,
    apply: (input, value) => ({ ...input, summary: typeof value === "string" ? value : "" }),
    read: (input) => input.summary ?? "",
    isAnswered: () => true // always optional, never blocks
  },

  /* 2 — Users */
  {
    id: "users",
    layer: "Users",
    type: "multi",
    title: "Who uses it?",
    helperText: "Select everyone who needs access. External users change identity and edge requirements.",
    required: true,
    options: [
      opt("internal_employees", "Employees inside your organization"),
      opt("external_customers", "Customers outside your organization"),
      opt("citizens", "Residents or citizens"),
      opt("partners", "Partner organizations"),
      opt("admins", "IT or admin users"),
      opt("developers", "Developers"),
      opt("mixed", "Mixed audience"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("users"),
    read: readArray("users"),
    isAnswered: answeredArray("users")
  },

  /* 3 — Channels */
  {
    id: "channels",
    layer: "Channel",
    type: "multi",
    title: "Where will they open it?",
    helperText: "Choose the app or surface users will start from. Teams and Microsoft 365 often point to Copilot Studio; web, mobile, portal, and API usually need more app architecture.",
    required: true,
    options: [
      opt("m365_copilot", "Microsoft 365 Copilot", undefined, "Microsoft 365"),
      opt("teams", "Teams", undefined, "Microsoft 365"),
      opt("m365", "Microsoft 365", undefined, "Microsoft 365"),
      opt("web", "Web app", undefined, "Custom app"),
      opt("mobile", "Mobile app", undefined, "Custom app"),
      opt("portal", "Portal", undefined, "Custom app"),
      opt("api", "API", undefined, "Custom app"),
      opt("embedded", "Embedded in another app", undefined, "Custom app"),
      opt("multiple", "Multiple places", undefined, "Other"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("channels"),
    read: readArray("channels"),
    isAnswered: answeredArray("channels")
  },

  /* 4 — Capabilities */
  {
    id: "capabilities",
    layer: "Intent",
    type: "multi",
    title: "What should it help with?",
    helperText:
      "Pick the main jobs. The recommendation combines these into one solution family plus required components.",
    required: true,
    options: [
      opt("personal_productivity", "Personal productivity", undefined, "Assistant"),
      opt("employee_assistant", "Employee assistant", undefined, "Assistant"),
      opt("fabric_analytics", "Ask questions about Fabric or Power BI data", undefined, "Ask and analyze"),
      opt("document_rag", "Ask questions about documents", undefined, "Ask and analyze"),
      opt("operational_query", "Look up business records", undefined, "Ask and analyze"),
      opt("business_workflow", "Help with a business workflow", undefined, "Actions"),
      opt("approval", "Approval process", undefined, "Actions"),
      opt("transaction", "Transaction or submission", undefined, "Actions"),
      opt("record_update", "Update records", undefined, "Actions"),
      opt("multi_agent", "Multi-step or multi-agent process", undefined, "Advanced"),
      opt("custom_app", "Custom app experience", undefined, "Advanced"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("capabilities"),
    read: readArray("capabilities"),
    isAnswered: answeredArray("capabilities")
  },

  /* 5 — Data sources */
  {
    id: "dataSources",
    layer: "Data",
    type: "multi",
    title: "What information should it use?",
    helperText:
      "Pick the information sources. Fabric sources use Fabric Data Agent for governed analytics. Documents may use native knowledge or Azure AI Search depending on the need.",
    required: false,
    options: [
      opt("m365_graph", "Microsoft 365 / Graph", undefined, "Microsoft 365"),
      opt("sharepoint", "SharePoint", undefined, "Microsoft 365"),
      opt("fabric_onelake", "Fabric OneLake", undefined, "Fabric and Power BI"),
      opt("fabric_lakehouse", "Fabric Lakehouse", undefined, "Fabric and Power BI"),
      opt("fabric_warehouse", "Fabric Warehouse", undefined, "Fabric and Power BI"),
      opt("powerbi_semantic_model", "Power BI semantic model", undefined, "Fabric and Power BI"),
      opt("kql_eventhouse", "KQL / Eventhouse", undefined, "Fabric and Power BI"),
      opt("documents", "Documents, PDFs, or files", undefined, "Documents"),
      opt("blob_storage", "Blob Storage files", undefined, "Documents"),
      opt("azure_sql", "Azure SQL", undefined, "Business systems"),
      opt("dataverse", "Dataverse", undefined, "Business systems"),
      opt("apis", "Business APIs", undefined, "Business systems"),
      opt("erp_crm", "ERP or CRM", undefined, "Business systems"),
      opt("on_prem", "On-premises data", undefined, "Business systems"),
      opt("internet", "Internet", undefined, "Public information"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("dataSources"),
    read: readArray("dataSources"),
    isAnswered: answeredArray("dataSources")
  },

  /* 6 — Agent behavior */
  {
    id: "behaviors",
    layer: "Behavior",
    type: "multi",
    title: "Should it only answer, or also take action?",
    helperText:
      "Read-only answers stay simpler. Updates, approvals, transactions, or long-running work add orchestration and audit controls.",
    required: false,
    options: [
      opt("qa", "Answer questions", undefined, "Read-only"),
      opt("analytics", "Analyze metrics or BI data", undefined, "Read-only"),
      opt("retrieval", "Find relevant information", undefined, "Read-only"),
      opt("read_only_query", "Read-only lookup", undefined, "Read-only"),
      opt("summarization", "Summarize content", undefined, "Read-only"),
      opt("recommendation", "Recommend next steps", undefined, "Read-only"),
      opt("record_update", "Update records", undefined, "Actions"),
      opt("workflow", "Run a workflow", undefined, "Actions"),
      opt("approval", "Run an approval", undefined, "Actions"),
      opt("transaction", "Execute a transaction", undefined, "Actions"),
      opt("long_running_process", "Run a long process", undefined, "Actions"),
      opt("multi_agent", "Coordinate multiple agents", undefined, "Advanced"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("behaviors"),
    read: readArray("behaviors"),
    isAnswered: answeredArray("behaviors")
  },

  /* 7 — Lifecycle controls */
  {
    id: "lifecycleControls",
    layer: "Lifecycle",
    type: "multi",
    title: "Do you need testing, tracing, or monitoring?",
    helperText:
      "Only choose these when they are required. Selecting them can add Azure AI Foundry lifecycle capabilities.",
    required: false,
    options: [
      opt("none", "None / keep it simple", undefined, "Default"),
      opt("evaluation", "Evaluate answer quality", undefined, "Quality and operations"),
      opt("tracing", "Trace agent runs", undefined, "Quality and operations"),
      opt("monitoring", "Monitor production behavior", undefined, "Quality and operations"),
      opt("safety_testing", "Safety testing", undefined, "Quality and operations"),
      opt("prompt_versioning", "Prompt versioning", undefined, "Change control"),
      opt("model_versioning", "Model versioning", undefined, "Change control"),
      opt("model_routing", "Route between models", undefined, "Change control"),
      opt("governance", "Governance", undefined, "Change control"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("lifecycleControls"),
    read: readArray("lifecycleControls"),
    isAnswered: answeredArray("lifecycleControls")
  },

  /* 8 — Specialized model strategy */
  {
    id: "modelStrategy",
    layer: "Model",
    type: "multi",
    title: "Do you need a special model?",
    helperText:
      "Most scenarios can use a standard managed model. Choose this when the customer needs Azure OpenAI, models sold directly by Azure through Foundry, provider/open models, a fine-tuned model, BYO model, or Azure ML model.",
    required: false,
    options: [
      opt("foundry_model_catalog", "Azure OpenAI, Azure-sold Foundry, or provider/open model", "Azure OpenAI models, models sold directly by Azure through Foundry, or provider/open models from Meta, Mistral, Grok/xAI, Anthropic, Cohere, NVIDIA, Hugging Face, etc.", "Azure, provider, and open models"),
      opt("anthropic_claude", "Claude / Anthropic model, such as Opus", "Claude or Anthropic model selected through Azure AI Foundry when available for the customer/project.", "Azure, provider, and open models"),
      opt("xai_grok", "Grok / xAI model", "Grok or xAI model selected through Azure AI Foundry when available, or through an approved governed endpoint.", "Azure, provider, and open models"),
      opt("fine_tuned_azure_openai", "Fine-tuned Azure OpenAI model", "Fine-tuned Azure OpenAI deployment in Azure AI Foundry for domain-specific responses.", "Specialized model"),
      opt("fine_tuned_foundry_model", "Fine-tuned Foundry model", "Fine-tuned Foundry-hosted model or managed compute deployment.", "Specialized model"),
      opt("azure_ml_custom_model", "Custom Azure ML model", "Custom predictive/classification model trained and governed in Azure ML.", "Azure Machine Learning"),
      opt("azure_ml_endpoint", "Existing Azure ML endpoint", "Existing Azure ML endpoint used by the agent or app.", "Azure Machine Learning"),
      opt("bring_your_own_model", "Bring your own model", "A BYO model hosted through Foundry managed compute, Azure ML, or an approved governed endpoint.", "External or BYO"),
      opt("unknown", "No specific model needs / not sure", "Choose this when the customer does not need a named model, provider model, fine-tuned model, BYO model, or Azure ML model. Pathfinder will use the standard managed model path.", "Default")
    ],
    apply: (input, value) => ({
      ...input,
      modelStrategy: Array.isArray(value) ? (value as ModelStrategy[]) : []
    }),
    read: (input) => input.modelStrategy ?? [],
    isAnswered: (input) =>
      Array.isArray(input.modelStrategy) && input.modelStrategy.length > 0
  },

  /* 9 — Runtime preference */
  {
    id: "runtimePreferences",
    layer: "Runtime",
    type: "multi",
    title: "Do you already know how it must be built?",
    helperText:
      "Choose known constraints only. Use 'Let Pathfinder decide' when the architecture should pick the right implementation style.",
    required: false,
    options: [
      opt("none", "Let Pathfinder decide", undefined, "Default"),
      opt("copilot_studio", "Copilot Studio", undefined, "Low-code"),
      opt("custom_backend", "Custom backend", undefined, "Code-first"),
      opt("foundry_agent_service", "Azure AI Foundry Agent Service", undefined, "Code-first"),
      opt("m365_agents_sdk", "Microsoft 365 Agents SDK", undefined, "Code-first"),
      opt("functions", "Azure Functions", undefined, "Azure hosting"),
      opt("app_service", "Azure App Service", undefined, "Azure hosting"),
      opt("container_apps", "Azure Container Apps", undefined, "Azure hosting"),
      opt("aks", "AKS", undefined, "Azure hosting"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("runtimePreferences"),
    read: readArray("runtimePreferences"),
    isAnswered: answeredArray("runtimePreferences")
  },

  /* 10 — Security */
  {
    id: "securityControls",
    layer: "Security",
    type: "multi",
    title: "What security rules must be followed?",
    helperText: "Select controls that are required by your organization. The recommendation also adds baseline identity and least-privilege controls where needed.",
    required: true,
    options: [
      opt("entra_id", "Microsoft Entra ID", undefined, "Identity and access"),
      opt("entra_external_id", "External identity", undefined, "Identity and access"),
      opt("rbac", "Role-based access", undefined, "Identity and access"),
      opt("rls_ols", "Row/object-level security", undefined, "Identity and access"),
      opt("dlp", "Data loss prevention", undefined, "Data protection"),
      opt("audit", "Audit trail", undefined, "Operations"),
      opt("key_vault", "Key Vault", undefined, "Data protection"),
      opt("managed_identity", "Managed Identity", undefined, "Identity and access"),
      opt("waf", "Web Application Firewall", undefined, "Edge and APIs"),
      opt("apim", "API Management", undefined, "Edge and APIs"),
      opt("purview", "Microsoft Purview", undefined, "Data protection"),
      opt("defender", "Microsoft Defender", undefined, "Operations"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("securityControls"),
    read: readArray("securityControls"),
    isAnswered: answeredArray("securityControls")
  },

  /* 11 — Network/deployment */
  {
    id: "networkControls",
    layer: "Network",
    type: "multi",
    title: "How locked down is the deployment?",
    helperText:
      "Choose private, hybrid, regulated, or residency controls only when they are explicitly required.",
    required: true,
    options: [
      opt("public", "Public access is acceptable", undefined, "Standard access"),
      opt("vnet", "Virtual network", undefined, "Private network"),
      opt("private_link", "Private Link", undefined, "Private network"),
      opt("private_endpoint", "Private Endpoint", undefined, "Private network"),
      opt("vpn", "VPN", undefined, "Hybrid or on-premises"),
      opt("expressroute", "ExpressRoute", undefined, "Hybrid or on-premises"),
      opt("no_public_endpoint", "No public endpoints", undefined, "Private network"),
      opt("data_residency", "Data residency", undefined, "Compliance"),
      opt("regulated", "Regulated deployment", undefined, "Compliance"),
      opt("on_prem_connectivity", "On-premises connectivity", undefined, "Hybrid or on-premises"),
      opt("unknown", "Not sure")
    ],
    apply: applyArray("networkControls"),
    read: readArray("networkControls"),
    isAnswered: answeredArray("networkControls")
  },

  /* ====== Conditional questions ====== */

  /* Advanced/custom RAG confirmation */
  {
    id: "advancedRagRequirements",
    layer: "Validation",
    type: "multi",
    title: "For documents, is simple Q&A enough?",
    helperText:
      "Simple document Q&A can often use Copilot Studio native knowledge. Choose advanced options only when you need a dedicated search/RAG layer.",
    required: false,
    showWhen: hasDocumentIntent,
    options: [
      opt("none", "Yes, simple document Q&A is enough", undefined, "Simple"),
      opt("custom_vector_search", "Custom vector search", undefined, "Dedicated RAG"),
      opt("hybrid_search", "Hybrid keyword + vector search", undefined, "Dedicated RAG"),
      opt("large_scale_indexing", "Large-scale indexing", undefined, "Dedicated RAG"),
      opt("custom_ingestion", "Custom ingestion pipeline", undefined, "Dedicated RAG"),
      opt("custom_chunking", "Custom chunking strategy", undefined, "Dedicated RAG"),
      opt("ocr_enrichment", "OCR or document enrichment", undefined, "Dedicated RAG"),
      opt("metadata_filtering", "Metadata filters, facets, or scoring", undefined, "Dedicated RAG"),
      opt("reusable_enterprise_index", "Reusable enterprise search index", undefined, "Enterprise reuse"),
      opt("private_search_service", "Private search service", undefined, "Enterprise reuse"),
      opt("multi_app_search_reuse", "Reuse search across apps or agents", undefined, "Enterprise reuse"),
      opt("explicit_azure_ai_search", "Azure AI Search is required", undefined, "Enterprise reuse"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => ({
      ...input,
      advancedRagRequirements: Array.isArray(value)
        ? (value as AdvancedRagRequirement[])
        : []
    }),
    read: (input) => input.advancedRagRequirements ?? [],
    isAnswered: (input) =>
      Array.isArray(input.advancedRagRequirements) &&
      input.advancedRagRequirements.length > 0
  },

  /* Semantic model permissions confirmation */
  {
    id: "fabricAnalyticsIntent",
    layer: "Validation",
    type: "single",
    title: "For Fabric data, will users ask questions in natural language?",
    helperText:
      "Use Fabric Data Agent for natural-language analytics. Predefined reports, APIs, and storage-only usage do not require a conversational data agent.",
    required: false,
    showWhen: hasFabricSource,
    options: [
      opt("read_only_analytics_qa", "Yes, ask read-only analytics questions"),
      opt("predefined_reports_apis", "Only through predefined reports or APIs"),
      opt("storage_only", "No, Fabric is only storage or processing"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => ({
      ...input,
      fabricAnalyticsIntent: typeof value === "string" ? (value as FabricAnalyticsIntent) : undefined
    }),
    read: (input) => input.fabricAnalyticsIntent,
    isAnswered: (input) => !!input.fabricAnalyticsIntent
  },

  {
    id: "fabricUserAccess",
    layer: "Validation",
    type: "single",
    title: "Who has permission to the Fabric data?",
    helperText:
      "Fabric Data Agent needs a governed identity and permissions model. External or anonymous use needs extra validation.",
    required: false,
    showWhen: hasFabricSource,
    options: [
      opt("internal_fabric_permissions", "Employees already have Fabric permissions"),
      opt("b2b_governed_fabric_access", "B2B partners have governed Fabric access"),
      opt("external_customers_citizens", "External customers or citizens"),
      opt("anonymous_users", "Anonymous users"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => ({
      ...input,
      fabricUserAccess: typeof value === "string" ? (value as FabricUserAccess) : undefined
    }),
    read: (input) => input.fabricUserAccess,
    isAnswered: (input) => !!input.fabricUserAccess
  },

  /* Semantic model permissions confirmation */
  {
    id: "semanticModelConfirmations",
    layer: "Validation",
    type: "multi",
    title: "Is the Power BI semantic model ready?",
    helperText:
      "Power BI semantic models need read permission, workspace/item permission, optional RLS/OLS, and Prep for AI.",
    required: false,
    showWhen: needsSemanticModelGuidance,
    options: [
      opt("read", "Read permission is confirmed"),
      opt("workspace", "Workspace/item permission is confirmed"),
      opt("rls_ols", "RLS/OLS applies"),
      opt("prep_ai", "Prep for AI is complete"),
      opt("not_confirmed", "Not confirmed yet")
    ],
    apply: (input, value) => ({
      ...input,
      semanticModelConfirmations: Array.isArray(value) ? value : [],
      semanticModelUsed: true,
      semanticModelSecurityKnown: Array.isArray(value) && hasConfirmedSemanticModelReadiness(value)
    }),
    read: (input) => input.semanticModelConfirmations ?? [],
    isAnswered: (input) =>
      Array.isArray(input.semanticModelConfirmations) &&
      input.semanticModelConfirmations.length > 0
  },

  /* Internet-facing confirmation */
  {
    id: "externalAccessConfirmed",
    layer: "Validation",
    type: "single",
    title: "Can users reach it from the internet?",
    helperText: "This determines whether public edge controls such as WAF or Front Door are needed.",
    required: false,
    showWhen: (i) => hasExternalChannel(i) && hasExternalUser(i),
    options: [
      opt("yes", "Yes"),
      opt("no", "No"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => ({
      ...input,
      externalAccessConfirmed:
        value === "yes" ? true : value === "no" ? false : undefined,
      externalAccessUnknown: value === "unknown"
    }),
    read: (input) =>
      input.externalAccessConfirmed === true
        ? "yes"
        : input.externalAccessConfirmed === false
        ? "no"
        : input.externalAccessUnknown === true
        ? "unknown"
        : undefined,
    isAnswered: (input) =>
      input.externalAccessConfirmed !== undefined || input.externalAccessUnknown === true
  },

  /* Workflow execution detail */
  {
    id: "workflowExecution",
    layer: "Validation",
    type: "multi",
    title:
      "Should the assistant only guide the workflow, or actually perform the action?",
    helperText: "Guidance-only stays read-only. Performing actions adds deterministic workflow, audit, and integration components.",
    required: false,
    showWhen: (i) =>
      !!i.workflowExecution?.length ||
      (hasAmbiguousWorkflowIntent(i) &&
        i.writeBackConfirmed === undefined &&
        !hasConfirmedWriteAction(i)),
    options: [
      opt("guidance", "Guidance or summary only"),
      opt("updates", "Update records"),
      opt("approval", "Run approval"),
      opt("transaction", "Execute transaction"),
      opt("long_running", "Run a long business process"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => {
      const arr: string[] = Array.isArray(value) ? value : [];
      const previous = new Set((input.workflowExecution ?? []).map((choice) => WORKFLOW_BEHAVIORS[choice]).filter(Boolean));
      const next = {
        ...input,
        workflowExecution: arr,
        behaviors: input.behaviors.filter((behavior) => !previous.has(behavior))
      };
      if (arr.length === 0 || arr.includes("unknown")) {
        next.workflowExecution = arr.includes("unknown") ? ["unknown"] : [];
        next.writeBackConfirmed = undefined;
        return next;
      }
      const adds = arr.map((choice) => WORKFLOW_BEHAVIORS[choice]).filter(Boolean);
      const actionable = adds.some((behavior) => DIRECT_ACTIONABLE_BEHAVIORS.includes(behavior));
      next.writeBackConfirmed = actionable ? true : false;
      if (adds.length > 0) {
        next.behaviors = Array.from(new Set([...next.behaviors, ...adds]));
      }
      return next;
    },
    read: (input) => input.workflowExecution ?? [],
    isAnswered: (input) =>
      Array.isArray(input.workflowExecution) && input.workflowExecution.length > 0
  },

  /* M365 Agents SDK requirement */
  {
    id: "m365ExtensibilityRequired",
    layer: "Validation",
    type: "single",
    title:
      "Do you specifically need the Microsoft 365 Agents SDK?",
    helperText:
      "Mobile, web, or API access does not automatically mean M365 Agents SDK. Select Yes only when SDK extensibility is confirmed.",
    required: false,
    showWhen: (i) =>
      hasTeamsChannel(i) &&
      (i.runtimePreferences.includes("m365_agents_sdk") ||
        i.capabilities.includes("custom_app") ||
        /sdk|extensibility|extension/i.test(i.summary ?? "") ||
        /sdk|extensibility|extension/i.test((i as any).userNotes ?? "")),
    options: [
      opt("yes", "Yes"),
      opt("no", "No"),
      opt("unknown", "Not sure")
    ],
    apply: (input, value) => ({
      ...input,
      m365ExtensibilityRequired:
        value === "yes" ? true : value === "no" ? false : undefined,
      m365ExtensibilityUnknown: value === "unknown"
    }),
    read: (input) =>
      input.m365ExtensibilityRequired === true
        ? "yes"
        : input.m365ExtensibilityRequired === false
        ? "no"
        : input.m365ExtensibilityUnknown === true
        ? "unknown"
        : undefined,
    isAnswered: (input) =>
      input.m365ExtensibilityRequired !== undefined ||
      input.m365ExtensibilityUnknown === true
  }
];

/* Find the next unanswered + applicable question */
export function nextQuestion(input: DecisionInput): WizardQuestion | null {
  const state = classifyAdaptiveQuestions(input, QUESTIONS);
  const nextId = state.unresolvedCriticalQuestions[0] ?? state.optionalQuestions[0];
  if (!nextId) return null;
  return QUESTIONS.find((q) => q.id === nextId) ?? null;
}

/* All applicable questions for the progress rail */
export function applicableQuestions(input: DecisionInput): WizardQuestion[] {
  const state = classifyAdaptiveQuestions(input, QUESTIONS);
  const hidden = new Set(
    state.hiddenQuestions
      .filter((p) => p.relevance === "hidden" || p.relevance === "blocked" || p.relevance === "optional_later")
      .map((p) => p.questionId)
  );
  return QUESTIONS.filter((q) => q.id === "summary" || q.id === "modelStrategy" || !hidden.has(q.id));
}
