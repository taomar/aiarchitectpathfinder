import assert from "node:assert/strict";
import { decide } from "../lib/decision-engine";
import { classifyAdaptiveQuestions, normalizeDecisionInput } from "../lib/adaptive-wizard";
import { QUESTIONS, nextQuestion } from "../lib/questions";
import { buildArchitectureSummary } from "../lib/architecture-summary";
import { categoryForDecision } from "../lib/pathfinder-category";
import { azureOpenAIEnabled, azureOpenAIStatus, tieBreak } from "../lib/azure-openai";
import { RECOMMENDATION_TIMEOUT_MS } from "../lib/recommendation-policy";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse, WizardQuestion } from "../lib/types";

type ScenarioInput = DecisionInput & Record<string, unknown>;

type GoldExpectation = {
  basePatternId: string;
  category: string;
  overlays: string[];
  recommendation: string;
  decisionMustInclude: string[];
  decisionMustNotInclude: string[];
  llmMustInclude: string[];
  llmMustNotInclude: string[];
  wizardMustAsk?: string[];
};

type Scenario = {
  name: string;
  input: ScenarioInput;
  gold: GoldExpectation;
};

type WizardRun = {
  input: DecisionInput;
  decision: ArchitectureDecision;
  askedQuestionIds: string[];
  readinessReason: string;
};

const emptyInput = (): DecisionInput => ({
  summary: "",
  users: [],
  channels: [],
  capabilities: [],
  dataSources: [],
  behaviors: [],
  lifecycleControls: [],
  securityControls: [],
  networkControls: [],
  runtimePreferences: [],
  advancedRagRequirements: [],
  modelStrategy: []
});

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return undefined;
};

function answerFor(question: WizardQuestion, scenarioInput: ScenarioInput) {
  if (question.id === "summary") return scenarioInput.summary ?? "";
  if (question.id === "externalAccessConfirmed") {
    if (scenarioInput.externalAccessUnknown === true) return "unknown";
    return stringValue(scenarioInput.externalAccessConfirmed);
  }
  if (question.id === "m365ExtensibilityRequired") {
    if (scenarioInput.m365ExtensibilityUnknown === true) return "unknown";
    return stringValue(scenarioInput.m365ExtensibilityRequired);
  }
  return scenarioInput[question.id];
}

function simulateAdaptiveWizard(scenario: Scenario): WizardRun {
  let input = normalizeDecisionInput({ ...emptyInput(), summary: scenario.input.summary ?? "" });
  const askedQuestionIds: string[] = [];
  const maxSteps = QUESTIONS.length + 8;

  for (let step = 0; step < maxSteps; step += 1) {
    const state = classifyAdaptiveQuestions(input, QUESTIONS);
    if (state.canGenerateRecommendation && state.unresolvedCriticalQuestions.length === 0) break;
    const question = nextQuestion(input);
    if (!question) break;
    const answer = answerFor(question, scenario.input);
    if (answer === undefined) {
      throw new Error(`${scenario.name}: no scripted answer for wizard question ${question.id}`);
    }
    askedQuestionIds.push(question.id);
    input = question.apply ? question.apply(input, answer) : input;
    input = normalizeDecisionInput(input);
  }

  const finalState = classifyAdaptiveQuestions(input, QUESTIONS);
  assert.equal(finalState.canGenerateRecommendation, true, `${scenario.name}: wizard should be ready. ${finalState.recommendationReadinessReason}`);
  assert.equal(finalState.unresolvedCriticalQuestions.length, 0, `${scenario.name}: wizard should have no critical questions left: ${finalState.unresolvedCriticalQuestions.join(", ")}`);
  return {
    input: finalState.normalizedInput,
    decision: decide(finalState.normalizedInput),
    askedQuestionIds,
    readinessReason: finalState.recommendationReadinessReason
  };
}

function collectDecisionRecommendationText(decision: ArchitectureDecision, input: DecisionInput) {
  const category = categoryForDecision(decision).category;
  return [
    decision.basePatternName,
    decision.finalRecommendation,
    decision.recommendedStack.join("\n"),
    decision.rationale.join("\n"),
    decision.endToEndFlow.join("\n"),
    decision.architectureLayers.map((layer) => `${layer.layer}: ${layer.selections.join(" | ")}`).join("\n"),
    buildArchitectureSummary(input, decision, category)
  ].join("\n");
}

function collectTieBreakRecommendationText(tieBreakResult: TieBreakResponse) {
  return [
    tieBreakResult.proposedArchitectureSummary,
    tieBreakResult.mermaidDiagram
  ].join("\n");
}

const normalizeText = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

function includesText(haystack: string, needle: string) {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function includesAsRecommended(haystack: string, needle: string) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  let index = normalizedHaystack.indexOf(normalizedNeedle);
  while (index >= 0) {
    const prefix = normalizedHaystack.slice(Math.max(0, index - 48), index);
    if (!/(no|not|without|avoid|never|do not|does not|is not|must not|should not|instead of)\s+[^.]{0,40}$/.test(prefix)) {
      return true;
    }
    index = normalizedHaystack.indexOf(normalizedNeedle, index + normalizedNeedle.length);
  }
  return false;
}

function compareText(label: string, haystack: string, mustInclude: string[], mustNotInclude: string[]) {
  const mismatches: string[] = [];
  for (const expected of mustInclude) {
    if (!includesText(haystack, expected)) mismatches.push(`${label} missing: ${expected}`);
  }
  for (const forbidden of mustNotInclude) {
    if (includesAsRecommended(haystack, forbidden)) mismatches.push(`${label} should not include: ${forbidden}`);
  }
  return mismatches;
}

function sameSet(actual: string[], expected: string[]) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== expectedSet.size) return false;
  return [...expectedSet].every((item) => actualSet.has(item));
}

function compareWizard(scenario: Scenario, wizardRun: WizardRun) {
  const mismatches: string[] = [];
  const category = categoryForDecision(wizardRun.decision).category;
  if (wizardRun.decision.basePatternId !== scenario.gold.basePatternId) {
    mismatches.push(`wizard base ${wizardRun.decision.basePatternId} !== gold ${scenario.gold.basePatternId}`);
  }
  if (category !== scenario.gold.category) {
    mismatches.push(`wizard category ${category} !== gold ${scenario.gold.category}`);
  }
  const overlayIds = wizardRun.decision.overlays.map((overlay) => overlay.id);
  if (!sameSet(overlayIds, scenario.gold.overlays)) {
    mismatches.push(`wizard overlays [${overlayIds.join(", ")}] !== gold [${scenario.gold.overlays.join(", ")}]`);
  }
  for (const questionId of scenario.gold.wizardMustAsk ?? []) {
    if (!wizardRun.askedQuestionIds.includes(questionId)) {
      mismatches.push(`wizard did not ask required adaptive question: ${questionId}`);
    }
  }
  mismatches.push(
    ...compareText(
      "wizard recommendation",
      collectDecisionRecommendationText(wizardRun.decision, wizardRun.input),
      scenario.gold.decisionMustInclude,
      scenario.gold.decisionMustNotInclude
    )
  );
  return mismatches;
}

async function callTieBreakWithTimeout(input: DecisionInput, decision: ArchitectureDecision, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await tieBreak(input, decision, undefined, {
      signal: controller.signal,
      maxCompletionTokens: 32768
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function compareLlm(scenario: Scenario, wizardRun: WizardRun) {
  const mismatches: string[] = [];
  let tieBreakResult: TieBreakResponse;
  try {
    tieBreakResult = await callTieBreakWithTimeout(wizardRun.input, wizardRun.decision, RECOMMENDATION_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { mismatches: [`LLM call failed: ${message}`], tieBreakResult: null as TieBreakResponse | null };
  }

  if (tieBreakResult.recommendedBasePatternId !== scenario.gold.basePatternId) {
    mismatches.push(`LLM base ${tieBreakResult.recommendedBasePatternId} !== gold ${scenario.gold.basePatternId}`);
  }
  if (!sameSet(tieBreakResult.recommendedOverlays, scenario.gold.overlays)) {
    mismatches.push(`LLM overlays [${tieBreakResult.recommendedOverlays.join(", ")}] !== gold [${scenario.gold.overlays.join(", ")}]`);
  }
  mismatches.push(
    ...compareText(
      "LLM recommendation",
      collectTieBreakRecommendationText(tieBreakResult),
      scenario.gold.llmMustInclude,
      scenario.gold.llmMustNotInclude
    )
  );
  return { mismatches, tieBreakResult };
}

const scenarios: Scenario[] = [
  {
    name: "Bank branch policy copilot",
    input: {
      summary: "Internal branch employees need a Teams assistant to answer policy questions from SharePoint and uploaded policy PDFs. It is read-only and simple native knowledge is enough.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["employee_assistant"],
      dataSources: ["sharepoint", "documents"],
      behaviors: ["qa", "retrieval"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id"],
      networkControls: ["public"],
      advancedRagRequirements: ["none"]
    },
    gold: {
      basePatternId: "copilot_studio_internal_assistant",
      category: "Copilot Studio",
      overlays: [],
      recommendation: "Copilot Studio with native SharePoint/document knowledge and no Azure AI Search.",
      decisionMustInclude: ["Copilot Studio", "Copilot Studio native knowledge", "SharePoint", "Uploaded documents / PDFs"],
      decisionMustNotInclude: ["Azure AI Search", "Microsoft Fabric Data Agent", "Azure AI Foundry / Foundry Models", "Entra External ID"],
      llmMustInclude: ["Copilot Studio", "SharePoint"],
      llmMustNotInclude: ["Azure AI Search", "Microsoft Fabric Data Agent", "Entra External ID"],
      wizardMustAsk: ["advancedRagRequirements"]
    }
  },
  {
    name: "Retail executive Fabric sales Q&A",
    input: {
      summary: "Retail executives ask natural-language sales questions in Teams over Fabric Lakehouse and a Power BI semantic model. They have Fabric permissions and need read-only analytics Q&A.",
      users: ["internal_employees"],
      channels: ["teams", "m365"],
      capabilities: ["fabric_analytics"],
      dataSources: ["fabric_lakehouse", "powerbi_semantic_model"],
      behaviors: ["analytics", "qa", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rls_ols"],
      networkControls: ["public"],
      fabricAnalyticsIntent: "read_only_analytics_qa",
      fabricUserAccess: "internal_fabric_permissions",
      semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"]
    },
    gold: {
      basePatternId: "copilot_studio_fabric_data_agent",
      category: "Copilot Studio",
      overlays: ["semantic_model_security"],
      recommendation: "Copilot Studio plus Microsoft Fabric Data Agent with semantic model security readiness.",
      decisionMustInclude: ["Microsoft Fabric Data Agent", "Fabric Lakehouse", "Power BI Semantic Model", "RLS / OLS", "Prep for AI"],
      decisionMustNotInclude: ["Azure AI Search", "Deterministic Orchestration Overlay", "Azure AI Foundry Agent Service"],
      llmMustInclude: ["Copilot Studio", "Fabric Data Agent", "Power BI Semantic Model"],
      llmMustNotInclude: ["Azure AI Search", "transaction"],
      wizardMustAsk: ["fabricAnalyticsIntent", "fabricUserAccess", "semanticModelConfirmations"]
    }
  },
  {
    name: "Insurance agent portal with docs and Fabric",
    input: {
      summary: "B2B insurance agents use a portal to ask questions across policy PDFs in Blob Storage and governed Fabric Warehouse metrics. The app should use Foundry Agent Service as the tool runtime.",
      users: ["partners"],
      channels: ["portal"],
      capabilities: ["custom_app", "document_rag", "fabric_analytics"],
      dataSources: ["documents", "blob_storage", "fabric_warehouse"],
      behaviors: ["qa", "retrieval", "analytics"],
      lifecycleControls: ["none"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_external_id", "apim", "waf"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
      fabricAnalyticsIntent: "read_only_analytics_qa",
      fabricUserAccess: "b2b_governed_fabric_access",
      externalAccessConfirmed: true
    },
    gold: {
      basePatternId: "azure_ai_foundry_app",
      category: "AI Foundry",
      overlays: ["api_management_edge", "document_rag_overlay", "fabric_data_agent"],
      recommendation: "Azure AI Foundry Agent Service with separate Azure AI Search document RAG and Fabric Data Agent analytics tool paths.",
      decisionMustInclude: ["Azure AI Foundry Agent Service", "Azure AI Search", "Microsoft Fabric Data Agent", "Fabric Warehouse", "Entra External ID", "API Management"],
      decisionMustNotInclude: ["Copilot Studio native knowledge", "Microsoft 365 Agents SDK", "Direct LLM-to-database"],
      llmMustInclude: ["Azure AI Foundry", "Azure AI Search", "Fabric Data Agent"],
      llmMustNotInclude: ["Microsoft 365 Agents SDK", "Copilot Studio native knowledge"],
      wizardMustAsk: ["advancedRagRequirements", "fabricAnalyticsIntent", "fabricUserAccess", "externalAccessConfirmed"]
    }
  },
  {
    name: "City resident permit summarizer",
    input: {
      summary: "Citizens use a web and mobile app to summarize permit PDFs stored in Blob Storage. It is external-facing and needs hybrid search over document metadata.",
      users: ["citizens"],
      channels: ["web", "mobile"],
      capabilities: ["document_rag", "custom_app"],
      dataSources: ["documents", "blob_storage"],
      behaviors: ["qa", "retrieval", "summarization"],
      lifecycleControls: ["none"],
      runtimePreferences: ["custom_backend"],
      securityControls: ["entra_external_id", "apim", "waf"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
      externalAccessConfirmed: true
    },
    gold: {
      basePatternId: "external_ai_app",
      category: "AI Foundry",
      overlays: ["api_management_edge", "document_rag_overlay"],
      recommendation: "External AI app with custom backend, APIM/WAF, Azure AI Search, and Azure AI Foundry model deployment.",
      decisionMustInclude: ["Custom Backend", "Azure AI Search", "Azure OpenAI model deployment in Azure AI Foundry", "Entra External ID", "Front Door + WAF"],
      decisionMustNotInclude: ["Microsoft Fabric Data Agent", "Microsoft 365 Agents SDK", "Deterministic Orchestration Overlay"],
      llmMustInclude: ["Azure AI Search", "Azure AI Foundry"],
      llmMustNotInclude: ["Fabric Data Agent", "Microsoft 365 Agents SDK", "SQL write"],
      wizardMustAsk: ["advancedRagRequirements", "externalAccessConfirmed"]
    }
  },
  {
    name: "Airline service SQL read-only lookup",
    input: {
      summary: "Internal airline service agents in Teams ask read-only operational questions about flight service records in Azure SQL. No updates or approvals are allowed.",
      users: ["internal_employees"],
      channels: ["teams", "m365"],
      capabilities: ["employee_assistant", "operational_query"],
      dataSources: ["azure_sql"],
      behaviors: ["qa", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit"],
      networkControls: ["public"]
    },
    gold: {
      basePatternId: "copilot_studio_internal_assistant",
      category: "Copilot Studio",
      overlays: [],
      recommendation: "Copilot Studio with a governed read-only SQL connector/action/API, never direct LLM-to-SQL.",
      decisionMustInclude: ["Copilot Studio", "Governed read-only SQL connector", "Azure SQL", "Least-privilege SQL permissions"],
      decisionMustNotInclude: ["Fabric Data Agent", "Azure AI Search", "Power Automate SQL Server connector for Azure SQL / SQL Server", "Parameterized stored procedure"],
      llmMustInclude: ["Copilot Studio", "read-only", "Azure SQL", "governed"],
      llmMustNotInclude: ["Fabric Data Agent", "Azure AI Search", "write"],
      wizardMustAsk: []
    }
  },
  {
    name: "Procurement approval SQL update",
    input: {
      summary: "Internal procurement staff in Teams approve purchase orders and update status in Azure SQL through Copilot Studio tools. Writes need audit and confirmation.",
      users: ["internal_employees"],
      channels: ["teams", "m365"],
      capabilities: ["employee_assistant", "approval", "record_update"],
      dataSources: ["azure_sql"],
      behaviors: ["qa", "approval", "record_update"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit", "managed_identity", "key_vault"],
      networkControls: ["public"],
      writeBackConfirmed: true
    },
    gold: {
      basePatternId: "business_action_agent",
      category: "Copilot Studio",
      overlays: [],
      recommendation: "Copilot Studio action/tool with Power Automate SQL Server connector or stored procedure for audited SQL writes.",
      decisionMustInclude: ["Copilot Studio action / tool", "Power Automate SQL Server connector", "Parameterized stored procedure", "Audit logging", "Confirmation step"],
      decisionMustNotInclude: ["Azure AI Search", "Fabric Data Agent", "LLM writes directly"],
      llmMustInclude: ["Copilot Studio", "Power Automate", "Azure SQL", "audit"],
      llmMustNotInclude: ["directly to Azure SQL", "Azure AI Search", "Fabric Data Agent"],
      wizardMustAsk: []
    }
  },
  {
    name: "Healthcare triage multi-model RAG",
    input: {
      summary: "Internal clinicians use a portal for document RAG over care guidelines, with a standard model, a fine-tuned Azure OpenAI model, a Foundry catalog model, and an Azure ML endpoint for risk scoring.",
      users: ["internal_employees"],
      channels: ["portal"],
      capabilities: ["custom_app", "document_rag"],
      dataSources: ["documents", "blob_storage"],
      behaviors: ["qa", "retrieval", "summarization", "recommendation"],
      lifecycleControls: ["none"],
      modelStrategy: ["fine_tuned_azure_openai", "foundry_model_catalog", "azure_ml_endpoint"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_id", "rbac", "audit"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "custom_chunking"]
    },
    gold: {
      basePatternId: "azure_ai_foundry_app",
      category: "AI Foundry",
      overlays: ["document_rag_overlay", "model_customization_azure_ml"],
      recommendation: "Azure AI Foundry app with Azure AI Search and a multi-model portfolio, including fine-tuned Azure OpenAI and Azure ML endpoint.",
      decisionMustInclude: ["Azure AI Foundry Agent Service", "Azure AI Search", "Multi-model portfolio", "Fine-tuned Azure OpenAI model in Azure AI Foundry", "Azure Machine Learning managed online endpoint"],
      decisionMustNotInclude: ["Microsoft Fabric Data Agent", "Copilot Studio native knowledge", "Azure OpenAI for reasoning/generation"],
      llmMustInclude: ["Azure AI Foundry", "Azure AI Search", "fine-tuned", "Azure Machine Learning"],
      llmMustNotInclude: ["Fabric Data Agent", "Azure OpenAI as a standalone", "Copilot Studio native knowledge"],
      wizardMustAsk: ["modelStrategy", "advancedRagRequirements"]
    }
  },
  {
    name: "Public Fabric stats website",
    input: {
      summary: "Citizens view public statistics on a website from curated Fabric Warehouse data. The site uses predefined reports and APIs, not live natural-language Fabric Q&A.",
      users: ["citizens"],
      channels: ["web"],
      capabilities: ["custom_app", "fabric_analytics"],
      dataSources: ["fabric_warehouse"],
      behaviors: ["analytics", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["custom_backend"],
      securityControls: ["apim", "waf"],
      networkControls: ["public"],
      fabricAnalyticsIntent: "predefined_reports_apis",
      fabricUserAccess: "anonymous_users",
      externalAccessConfirmed: true
    },
    gold: {
      basePatternId: "external_ai_app",
      category: "AI Foundry",
      overlays: ["api_management_edge"],
      recommendation: "External web app using governed Fabric reports/APIs, with APIM/WAF; predefined reporting does not require a conversational Fabric Data Agent.",
      decisionMustInclude: ["Custom Backend", "Governed Fabric API / predefined report access", "Fabric Warehouse", "API Management", "Front Door + WAF"],
      decisionMustNotInclude: ["Azure AI Search", "Copilot Studio", "Microsoft Fabric Data Agent"],
      llmMustInclude: ["Fabric Warehouse", "API"],
      llmMustNotInclude: ["Azure AI Search", "Copilot Studio", "Fabric Data Agent"],
      wizardMustAsk: ["fabricAnalyticsIntent", "fabricUserAccess", "externalAccessConfirmed"]
    }
  },
  {
    name: "Factory on-prem renewal workflow",
    input: {
      summary: "Internal factory planners use a portal to renew supplier contracts against on-premises systems and APIs. The agent executes a long-running workflow through Foundry Agent Service with private connectivity.",
      users: ["internal_employees"],
      channels: ["portal"],
      capabilities: ["custom_app", "business_workflow"],
      dataSources: ["on_prem", "apis"],
      behaviors: ["workflow", "transaction", "long_running_process"],
      lifecycleControls: ["none"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_id", "apim", "audit", "managed_identity", "key_vault"],
      networkControls: ["private_link", "vpn", "on_prem_connectivity"],
      writeBackConfirmed: true
    },
    gold: {
      basePatternId: "azure_ai_foundry_app",
      category: "AI Foundry",
      overlays: ["business_action_overlay", "deterministic_orchestration", "hybrid_private_deployment"],
      recommendation: "Azure AI Foundry Agent Service with deterministic orchestration, private API facade, and VPN/Private Link to on-prem systems.",
      decisionMustInclude: ["Azure AI Foundry Agent Service", "Durable Functions / Logic Apps (deterministic)", "Private API facade", "VPN / ExpressRoute", "Private Link", "Audit logging"],
      decisionMustNotInclude: ["Fabric Data Agent", "Azure AI Search", "Copilot Studio native knowledge"],
      llmMustInclude: ["Azure AI Foundry", "deterministic", "on-prem", "Private"],
      llmMustNotInclude: ["Fabric Data Agent", "Azure AI Search", "Copilot Studio native knowledge"],
      wizardMustAsk: []
    }
  },
  {
    name: "Microsoft 365 personal productivity",
    input: {
      summary: "Employees need help drafting email, summarizing meetings, and finding content already in Microsoft 365. No custom app, workflow, or external access is needed.",
      users: ["internal_employees"],
      channels: ["m365_copilot", "m365"],
      capabilities: ["personal_productivity"],
      dataSources: ["m365_graph", "sharepoint"],
      behaviors: ["qa", "summarization"],
      lifecycleControls: ["none"],
      runtimePreferences: ["none"],
      securityControls: ["entra_id"],
      networkControls: ["public"]
      ,advancedRagRequirements: ["none"]
    },
    gold: {
      basePatternId: "m365_copilot_productivity",
      category: "Copilot Studio",
      overlays: [],
      recommendation: "Use Microsoft 365 Copilot directly with Graph and tenant permissions; no custom AI app.",
      decisionMustInclude: ["Microsoft 365 Copilot", "Microsoft Graph", "M365 permissions"],
      decisionMustNotInclude: ["Copilot Studio", "Azure AI Foundry", "Azure AI Search", "Fabric Data Agent", "Custom backend"],
      llmMustInclude: ["Microsoft 365 Copilot", "Microsoft Graph"],
      llmMustNotInclude: ["Azure AI Foundry", "Azure AI Search", "Fabric Data Agent", "Custom backend"],
      wizardMustAsk: []
    }
  },
  {
    name: "B2B partner Fabric analytics",
    input: {
      summary: "B2B partners use a portal to ask governed analytics questions over a Fabric Lakehouse. Partners have B2B Fabric access and the runtime should use Foundry Agent Service tools.",
      users: ["partners"],
      channels: ["portal", "api"],
      capabilities: ["custom_app", "fabric_analytics"],
      dataSources: ["fabric_lakehouse"],
      behaviors: ["analytics", "qa", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_external_id", "apim", "waf"],
      networkControls: ["public"],
      fabricAnalyticsIntent: "read_only_analytics_qa",
      fabricUserAccess: "b2b_governed_fabric_access",
      externalAccessConfirmed: true
    },
    gold: {
      basePatternId: "azure_ai_foundry_app",
      category: "AI Foundry",
      overlays: ["api_management_edge", "fabric_data_agent"],
      recommendation: "Azure AI Foundry Agent Service with Fabric Data Agent as a governed analytics tool for B2B users.",
      decisionMustInclude: ["Azure AI Foundry Agent Service", "Microsoft Fabric Data Agent", "Fabric Lakehouse", "Entra External ID", "API Management"],
      decisionMustNotInclude: ["Azure AI Search", "Copilot Studio native knowledge", "Deterministic Orchestration Overlay"],
      llmMustInclude: ["Azure AI Foundry", "Fabric Data Agent"],
      llmMustNotInclude: ["Azure AI Search", "Copilot Studio native knowledge", "transaction"],
      wizardMustAsk: ["fabricAnalyticsIntent", "fabricUserAccess", "externalAccessConfirmed"]
    }
  },
  {
    name: "Legal advanced RAG private search",
    input: {
      summary: "Legal users search confidential contracts in Blob Storage with OCR enrichment, metadata filters, hybrid retrieval, and a private search service. No public endpoints are allowed.",
      users: ["internal_employees"],
      channels: ["portal"],
      capabilities: ["document_rag", "custom_app"],
      dataSources: ["documents", "blob_storage"],
      behaviors: ["qa", "retrieval", "summarization"],
      lifecycleControls: ["none"],
      runtimePreferences: ["custom_backend"],
      securityControls: ["entra_id", "rbac", "managed_identity", "key_vault"],
      networkControls: ["private_link", "no_public_endpoint"],
      advancedRagRequirements: ["hybrid_search", "ocr_enrichment", "metadata_filtering", "private_search_service"]
    },
    gold: {
      basePatternId: "document_rag_agent",
      category: "AI Foundry",
      overlays: ["hybrid_private_deployment"],
      recommendation: "Document RAG with Azure AI Search and a hybrid/private deployment overlay for private search.",
      decisionMustInclude: ["Azure AI Search", "Private Link", "Private Endpoint", "No public endpoint", "Managed Identity", "Key Vault"],
      decisionMustNotInclude: ["Microsoft Fabric Data Agent", "Copilot Studio native knowledge", "Power Automate SQL Server connector"],
      llmMustInclude: ["Azure AI Search", "Private", "Azure AI Foundry"],
      llmMustNotInclude: ["Fabric Data Agent", "Copilot Studio native knowledge", "SQL Server connector"],
      wizardMustAsk: ["advancedRagRequirements"]
    }
  },
  {
    name: "Operations Dataverse read-only assistant",
    input: {
      summary: "Operations employees in Teams ask read-only questions over Dataverse cases. The assistant must not update records.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["employee_assistant", "operational_query"],
      dataSources: ["dataverse"],
      behaviors: ["qa", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit"],
      networkControls: ["public"]
    },
    gold: {
      basePatternId: "copilot_studio_internal_assistant",
      category: "Copilot Studio",
      overlays: [],
      recommendation: "Copilot Studio with governed read-only Dataverse connector/action/API.",
      decisionMustInclude: ["Copilot Studio", "Dataverse", "Governed read-only connector", "Read-only connector/action/API permissions"],
      decisionMustNotInclude: ["Azure AI Search", "Fabric Data Agent", "Deterministic Orchestration Overlay", "record updates"],
      llmMustInclude: ["Copilot Studio", "Dataverse", "read-only"],
      llmMustNotInclude: ["Azure AI Search", "Fabric Data Agent", "update records"],
      wizardMustAsk: []
    }
  },
  {
    name: "B2C order cancellation transaction",
    input: {
      summary: "External customers use a mobile and web app to cancel orders. The app writes to Azure SQL and order APIs through controlled backend operations after confirmation.",
      users: ["external_customers"],
      channels: ["mobile", "web"],
      capabilities: ["custom_app", "transaction", "record_update"],
      dataSources: ["azure_sql", "apis"],
      behaviors: ["transaction", "record_update"],
      lifecycleControls: ["none"],
      runtimePreferences: ["custom_backend"],
      securityControls: ["entra_external_id", "apim", "waf", "audit", "managed_identity", "key_vault"],
      networkControls: ["public"],
      externalAccessConfirmed: true,
      writeBackConfirmed: true
    },
    gold: {
      basePatternId: "business_action_agent",
      category: "AI Foundry",
      overlays: ["api_management_edge"],
      recommendation: "External custom AI app with APIM/WAF and deterministic backend actions for SQL/API writes.",
      decisionMustInclude: ["Custom Backend", "API Management", "Front Door + WAF", "Azure SQL", "Controlled backend API operation", "Audit logging"],
      decisionMustNotInclude: ["Azure AI Search", "Fabric Data Agent", "Copilot Studio native knowledge", "LLM writes directly"],
      llmMustInclude: ["external", "APIM", "Azure SQL", "deterministic"],
      llmMustNotInclude: ["Azure AI Search", "Fabric Data Agent", "directly to Azure SQL"],
      wizardMustAsk: ["externalAccessConfirmed"]
    }
  },
  {
    name: "Field service guidance-only workflow",
    input: {
      summary: "External field technicians use a portal to get guidance and summarize manuals during a repair workflow. The agent does not execute updates, approvals, or transactions.",
      users: ["partners"],
      channels: ["portal"],
      capabilities: ["document_rag", "business_workflow", "custom_app"],
      dataSources: ["documents", "blob_storage"],
      behaviors: ["workflow", "qa", "summarization", "retrieval"],
      lifecycleControls: ["none"],
      runtimePreferences: ["custom_backend"],
      securityControls: ["entra_external_id", "apim", "waf"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search"],
      workflowExecution: ["guidance"],
      externalAccessConfirmed: true
    },
    gold: {
      basePatternId: "external_ai_app",
      category: "AI Foundry",
      overlays: ["api_management_edge", "document_rag_overlay"],
      recommendation: "External AI app with document RAG for workflow guidance only; no deterministic action execution because writes are not confirmed.",
      decisionMustInclude: ["Custom Backend", "Azure AI Search", "Azure OpenAI model deployment in Azure AI Foundry", "API Management"],
      decisionMustNotInclude: ["Deterministic Orchestration Overlay", "Power Automate Approvals", "Controlled SQL write", "Fabric Data Agent"],
      llmMustInclude: ["Azure AI Search", "external"],
      llmMustNotInclude: ["approval", "transaction", "Fabric Data Agent", "write to"],
      wizardMustAsk: ["advancedRagRequirements", "workflowExecution", "externalAccessConfirmed"]
    }
  }
];

async function main() {
  const offline = process.argv.includes("--offline");
  if (!offline && !azureOpenAIEnabled()) {
    throw new Error(`Azure OpenAI is required for this proof: ${JSON.stringify(azureOpenAIStatus())}`);
  }

  const reports: Array<{
    name: string;
    gold: string;
    base: string;
    category: string;
    overlays: string[];
    asked: string[];
    wizardMismatches: string[];
    llmMismatches: string[];
    llmStatus: "skipped" | "executed";
  }> = [];

  for (const scenario of scenarios) {
    const wizardRun = simulateAdaptiveWizard(scenario);
    const wizardMismatches = compareWizard(scenario, wizardRun);
    const llmMismatches = offline ? [] : (await compareLlm(scenario, wizardRun)).mismatches;
    reports.push({
      name: scenario.name,
      gold: scenario.gold.recommendation,
      base: wizardRun.decision.basePatternId,
      category: categoryForDecision(wizardRun.decision).category,
      overlays: wizardRun.decision.overlays.map((overlay) => overlay.id),
      asked: wizardRun.askedQuestionIds,
      wizardMismatches,
      llmMismatches,
      llmStatus: offline ? "skipped" : "executed"
    });
    const mismatchCount = wizardMismatches.length + llmMismatches.length;
    console.log(`${mismatchCount === 0 ? "PASS" : "FAIL"} ${scenario.name}`);
    if (mismatchCount > 0) {
      for (const mismatch of [...wizardMismatches, ...llmMismatches]) console.log(`  - ${mismatch}`);
    }
  }

  const failing = reports.filter((report) => report.wizardMismatches.length || report.llmMismatches.length);
  console.log(JSON.stringify(reports, null, 2));
  assert.equal(failing.length, 0, `${failing.length} golden scenario proof checks failed`);
  console.log(offline
    ? `All ${scenarios.length} deterministic golden scenarios matched. Live AI validation was explicitly skipped (--offline).`
    : `All ${scenarios.length} golden wizard + LLM recommendation scenarios matched the gold-standard recommendations.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
