import assert from "node:assert/strict";
import { decide } from "../lib/decision-engine";
import { emptyInput, type DecisionInput } from "../lib/types";
import { buildAdaptiveWizardState, canGenerateRecommendation, normalizeDecisionInput } from "../lib/adaptive-wizard";
import { applicableQuestions, nextQuestion } from "../lib/questions";
import { categoryForDecision, buildMermaidDiagram } from "../lib/pathfinder-category";
import { buildArchitectureSummary, shouldUseGeneratedArchitectureSummary } from "../lib/architecture-summary";
import { jsonResponseFailureMessage } from "../lib/api-response";
import { EXAMPLES } from "../lib/examples";
import { isActionable } from "../lib/rules";
import { inferDecisionInputFromSummary, mergeInferredProfileFromSummary, prepareDecisionInputForRecommendation } from "../lib/summary-intake";

function text(decision: ReturnType<typeof decide>) {
  return [
    decision.recommendedStack.join("\n"),
    decision.optionalAddOns.join("\n"),
    decision.rationale.join("\n"),
    decision.endToEndFlow.join("\n"),
    decision.architectureLayers
      .map((layer) => `${layer.layer}: ${layer.selections.join(" | ")}`)
      .join("\n")
  ].join("\n");
}

function expectBase(name: string, input: DecisionInput, basePatternId: string) {
  const decision = decide(input);
  assert.equal(decision.basePatternId, basePatternId, `${name}: base pattern`);
  return decision;
}

function assertIncludes(name: string, haystack: string, needle: string) {
  assert.match(haystack, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${name}: expected ${needle}`);
}

function assertExcludes(name: string, haystack: string, needle: string) {
  assert.doesNotMatch(haystack, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${name}: did not expect ${needle}`);
}

function layer(decision: ReturnType<typeof decide>, name: string) {
  return decision.architectureLayers.find((item) => item.layer === name)?.selections ?? [];
}

function countMatches(values: string[], pattern: RegExp) {
  return values.filter((value) => pattern.test(value)).length;
}

function assertLayerIncludes(name: string, decision: ReturnType<typeof decide>, layerName: string, needle: string) {
  assertIncludes(name, layer(decision, layerName).join("\n"), needle);
}

function assertLayerExcludes(name: string, decision: ReturnType<typeof decide>, layerName: string, needle: string) {
  assertExcludes(name, layer(decision, layerName).join("\n"), needle);
}

function inferPrepared(summary: string) {
  return prepareDecisionInputForRecommendation(
    inferDecisionInputFromSummary({ ...emptyInput(), summary, directTextRecommendation: true })
  );
}

assert.match(
  jsonResponseFailureMessage(
    { status: 401, redirected: false },
    "AI review",
    "text/html; charset=utf-8",
    "<html><head><title>Sign in</title></head><body>login</body></html>"
  ),
  /current browser session/,
  "HTML auth responses should not surface JSON parser errors"
);

assert.match(
  jsonResponseFailureMessage(
    { status: 0, redirected: false, type: "opaqueredirect" },
    "AI review",
    "",
    ""
  ),
  /current browser session/,
  "manual auth redirects should not surface as non-JSON parser errors"
);

assert.equal(EXAMPLES.length, 15, "landing page should expose exactly 15 example scenarios");
assert.equal(EXAMPLES.filter((example) => example.name.startsWith("Copilot Studio")).length, 5, "examples should include 5 Copilot Studio scenarios");
assert.equal(EXAMPLES.filter((example) => example.name.startsWith("AI Foundry")).length, 5, "examples should include 5 AI Foundry scenarios");
assert.equal(EXAMPLES.filter((example) => example.name.startsWith("Hybrid")).length, 5, "examples should include 5 Hybrid scenarios");
for (const example of EXAMPLES) {
  const normalized = normalizeDecisionInput(example.input);
  assert.equal(canGenerateRecommendation(normalized).ready, true, `${example.id}: example should be complete enough to generate a recommendation`);
  assert.match(example.input.summary ?? "", /\b\d[\d,.]*\b/, `${example.id}: scenario should include quantified business context`);
  assert.equal(decide(normalized).missingQuestions.length, 0, `${example.id}: example should not leave critical wizard questions unresolved`);
}

const simpleDocs = expectBase("simple internal document Q&A", {
  summary: "Internal employees need to ask questions over uploaded policy PDFs from Teams.",
  users: ["internal_employees"],
  channels: ["teams", "m365_copilot"],
  capabilities: ["employee_assistant"],
  dataSources: ["documents"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assertIncludes("simple internal document Q&A", text(simpleDocs), "Copilot Studio native knowledge sources");
assertIncludes("simple internal document Q&A", text(simpleDocs), "Uploaded documents / PDFs");
assertExcludes("simple internal document Q&A", text(simpleDocs), "Azure AI Search");
assertExcludes("simple internal document Q&A", text(simpleDocs), "Azure OpenAI");
assertExcludes("simple internal document Q&A", text(simpleDocs), "Azure AI Foundry");

const simpleOffice365Text = "i want to chat with my documents over simplest way, i have office365 license";
const simpleOffice365Input = prepareDecisionInputForRecommendation(
  inferDecisionInputFromSummary({ ...emptyInput(), summary: simpleOffice365Text, directTextRecommendation: true })
);
assert.deepEqual(simpleOffice365Input.users, ["internal_employees"], "Office 365 license wording should infer internal Microsoft 365 users");
assert.deepEqual(simpleOffice365Input.runtimePreferences, ["copilot_studio"], "simplest Office 365 document chat should prefer Copilot Studio");
assert.equal(simpleOffice365Input.lowCodePreferred, true, "simplest Office 365 document chat should set low-code preference");
const simpleOffice365Decision = expectBase("simple Office 365 document chat", simpleOffice365Input, "copilot_studio_internal_assistant");
assertIncludes("simple Office 365 document chat", text(simpleOffice365Decision), "Copilot Studio native knowledge sources");
assertExcludes("simple Office 365 document chat", text(simpleOffice365Decision), "Azure AI Search");
assertExcludes("simple Office 365 document chat", text(simpleOffice365Decision), "Azure AI Foundry");
assertExcludes("simple Office 365 document chat", text(simpleOffice365Decision), "Custom Backend");

const advancedOffice365Text = "I have Office 365 but need hybrid search, custom chunking, metadata filters, and Azure AI Search over millions of documents.";
const advancedOffice365Input = prepareDecisionInputForRecommendation(
  inferDecisionInputFromSummary({ ...emptyInput(), summary: advancedOffice365Text, directTextRecommendation: true })
);
const advancedOffice365Decision = expectBase("advanced Office 365 document RAG", advancedOffice365Input, "document_rag_agent");
assertIncludes("advanced Office 365 document RAG", text(advancedOffice365Decision), "Azure AI Search");

const sparseDocumentChatInput = inferPrepared("need simplest way to chat with documents");
const sparseDocumentChatDecision = expectBase("sparse document chat clarification", sparseDocumentChatInput, "clarification_required");
assertIncludes("sparse document chat clarification", text(sparseDocumentChatDecision), "Clarify user audience");
assertExcludes("sparse document chat clarification", text(sparseDocumentChatDecision), "Azure AI Foundry / Foundry Models");

const externalM365LicenseContext = inferPrepared("external customers need a web portal to chat with claim documents, the company has Microsoft 365 licenses");
assert.deepEqual(externalM365LicenseContext.users, ["external_customers"], "external end users should stay external even when company has M365 licenses");
assert.equal(externalM365LicenseContext.channels.includes("m365"), false, "M365 license context should not become an external user channel");
expectBase("external M365 license context", externalM365LicenseContext, "external_ai_app");

const publicAgencyM365 = inferPrepared("citizens need to ask questions over public policy documents, the agency has Office 365");
assert.deepEqual(publicAgencyM365.users, ["citizens"], "citizen/public wording should infer citizen audience");
assert.equal(publicAgencyM365.channels.includes("m365"), false, "agency Office 365 context should not become the citizen channel");
assert.ok(publicAgencyM365.channels.includes("web"), "citizen/public scenario should infer web access when no channel is specified");
expectBase("public agency M365 context", publicAgencyM365, "external_ai_app");

const largeM365Docs = inferPrepared("we have M365 and 2 million documents but want simplest way to chat with documents");
assert.ok(largeM365Docs.advancedRagRequirements?.includes("large_scale_indexing"), "numeric document scale should trigger large-scale indexing validation");
expectBase("large M365 document corpus", largeM365Docs, "document_rag_agent");

const docsSynonymInput = inferPrepared("employees need to chat with KB articles and docs in Teams");
assert.ok(docsSynonymInput.dataSources.includes("documents"), "docs / KB articles should be treated as documents");
expectBase("docs synonym in Teams", docsSynonymInput, "copilot_studio_internal_assistant");

const customerCustomersInput = inferPrepared("my customer wants their customers to chat with documents");
assert.deepEqual(customerCustomersInput.users, ["external_customers"], "their customers should be treated as external end users");
expectBase("external customers missing channel", customerCustomersInput, "clarification_required");

const reportingWithoutAiIntent = inferPrepared("dashboard pages and reports exist but no Fabric or Power BI source is in scope");
expectBase("reporting without AI intent", reportingWithoutAiIntent, "clarification_required");

const m365DocsEvalInput = inferPrepared("we have Office 365 docs and need simplest chat but also evaluation and tracing before launch");
const m365DocsEvalDecision = expectBase("M365 docs with lifecycle overlay", m365DocsEvalInput, "copilot_studio_internal_assistant");
assertIncludes("M365 docs with lifecycle overlay", text(m365DocsEvalDecision), "Copilot Studio");

const m365CustomBackendInput = inferPrepared("we have Office 365 but need a custom backend and Azure AI Search for document Q&A");
const m365CustomBackendDecision = expectBase("M365 explicit custom backend RAG", m365CustomBackendInput, "document_rag_agent");
assertLayerIncludes("M365 explicit custom backend RAG", m365CustomBackendDecision, "Runtime/Backend", "Custom Backend");

const sharePointNative = expectBase("SharePoint native knowledge", {
  summary: "Internal HR users need a Teams assistant to answer FAQ questions from SharePoint content.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant"],
  dataSources: ["sharepoint"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assertIncludes("SharePoint native knowledge", text(sharePointNative), "SharePoint");
assertExcludes("SharePoint native knowledge", text(sharePointNative), "Azure AI Search");
assertExcludes("SharePoint native knowledge", text(sharePointNative), "Azure AI Foundry");

const customerTeamsSharePointText = "I have a customer who is interested to chat with his documents which is on SharePoint, and will use Teams for that.";
const wizardPrefillFromText = mergeInferredProfileFromSummary({ ...emptyInput(), summary: customerTeamsSharePointText });
assert.ok(wizardPrefillFromText.channels.includes("teams"), "summary intake should prefill Teams channel in the wizard");
assert.ok(wizardPrefillFromText.dataSources.includes("sharepoint"), "summary intake should prefill SharePoint data source in the wizard");
assert.ok(wizardPrefillFromText.dataSources.includes("documents"), "summary intake should prefill document source in the wizard");
assert.ok(wizardPrefillFromText.capabilities.includes("document_rag"), "summary intake should prefill document Q&A capability in the wizard");
assert.ok(wizardPrefillFromText.behaviors.includes("qa"), "summary intake should prefill Q&A behavior in the wizard");
assert.ok(wizardPrefillFromText.users.includes("internal_employees"), "Teams/SharePoint customer-organization wording should infer internal employees");
assert.equal(wizardPrefillFromText.users.includes("external_customers"), false, "customer-organization wording should not imply external end users");

// In "build from text" mode the scenario text is the single source of truth: the
// structured profile is re-derived from the summary, so stale/leftover wizard chips
// (here a "portal" channel that the edited text no longer supports) are dropped in
// favor of what the text actually says ("will use Teams").
const directTextManualProfile = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: customerTeamsSharePointText,
  directTextRecommendation: true,
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["document_rag"],
  dataSources: ["sharepoint"],
  behaviors: ["qa"]
});
assert.deepEqual(directTextManualProfile.channels, ["teams"], "build-from-text mode must re-infer channels from the summary text, not keep stale wizard chips");

const genericReportingText = mergeInferredProfileFromSummary({
  ...emptyInput(),
  summary: "The product has dashboard pages and reporting screens, but no Fabric or Power BI source is in scope."
});
assert.equal(genericReportingText.capabilities.includes("fabric_analytics"), false, "generic dashboard/reporting wording without Fabric/Power BI should not force Fabric analytics");

const advancedRag = expectBase("advanced custom RAG", {
  summary: "A portal needs advanced search over a large contract corpus with custom chunking, hybrid search, metadata filters, and reusable index.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["document_rag", "custom_app"],
  dataSources: ["documents", "blob_storage"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["custom_backend"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search", "custom_chunking", "metadata_filtering", "reusable_enterprise_index"]
}, "document_rag_agent");
assertIncludes("advanced custom RAG", text(advancedRag), "Azure AI Search");
assertIncludes("advanced custom RAG", text(advancedRag), "Azure OpenAI");
assertIncludes("advanced custom RAG", text(advancedRag), "advanced/custom RAG requirement");
assertIncludes("advanced custom RAG", text(advancedRag), "Document ingestion/indexing pipeline");

const lifecycle = expectBase("simple docs with Foundry lifecycle", {
  summary: "Internal employees need a Teams assistant over policy PDFs, and the AI team requires evaluation and tracing.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant"],
  dataSources: ["documents"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["evaluation", "tracing"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assert.deepEqual(lifecycle.overlays.some((overlay) => overlay.id === "azure_ai_foundry_lifecycle"), false);
// Finding 1 fix: a pure managed Copilot Studio agent must NOT acquire Azure AI Foundry
// model operations / evaluation just because monitoring/tracing was requested. It uses
// Copilot Studio analytics + Application Insights and stays in the Copilot Studio family.
assert.equal(categoryForDecision(lifecycle).category, "Copilot Studio");
assertLayerIncludes("simple docs with Foundry lifecycle", lifecycle, "AI Platform", "Copilot Studio managed AI experience");
assertLayerExcludes("simple docs with Foundry lifecycle", lifecycle, "AI Platform", "Azure AI Foundry / Foundry Models");
assertLayerIncludes("simple docs with Foundry lifecycle", lifecycle, "Observability", "Copilot Studio analytics");
assertLayerExcludes("simple docs with Foundry lifecycle", lifecycle, "Observability", "Azure AI Foundry evaluation / tracing / monitoring");
assertExcludes("simple docs with Foundry lifecycle", text(lifecycle), "Azure AI Search");

const fabric = expectBase("internal Fabric analytics", {
  summary: "Internal Fabric analytics Q&A.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["fabric_analytics"],
  dataSources: ["fabric_lakehouse"],
  behaviors: ["analytics", "qa", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"]
}, "copilot_studio_fabric_data_agent");
assertIncludes("internal Fabric analytics", text(fabric), "Fabric Data Agent");
assertLayerExcludes("internal Fabric analytics", fabric, "Analytics/Grounding", "Azure AI Search");

// README rule #1: a confirmed write-back action over Fabric data must NOT route to the
// read-only Fabric Data Agent — once the agent has to take an action it needs an action
// agent with a governed write path, even though the grounding data lives in Fabric.
const fabricWriteBackInput: DecisionInput = {
  ...emptyInput(),
  summary: "Internal employees query Fabric analytics in Teams and then write status updates back to the source after a confirmation step.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["fabric_analytics", "record_update"],
  dataSources: ["fabric_lakehouse"],
  behaviors: ["analytics", "qa", "record_update"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "audit", "managed_identity", "key_vault"],
  networkControls: ["public"]
};
assert.equal(isActionable(fabricWriteBackInput), true, "Fabric + write-back: the scenario should be treated as actionable");
const fabricWriteBack = decide(fabricWriteBackInput);
assert.notEqual(
  fabricWriteBack.basePatternId,
  "copilot_studio_fabric_data_agent",
  "Fabric + write-back: a confirmed action must not route to the read-only Fabric Data Agent"
);

const semantic = expectBase("Power BI semantic model", {
  summary: "Power BI semantic model Q&A.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["fabric_analytics"],
  dataSources: ["powerbi_semantic_model"],
  behaviors: ["analytics", "qa"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"]
}, "copilot_studio_fabric_data_agent");
assertIncludes("Power BI semantic model", text(semantic), "Read permission required");
assertIncludes("Power BI semantic model", text(semantic), "Workspace / item permissions");
assertIncludes("Power BI semantic model", text(semantic), "RLS / OLS");
assertIncludes("Power BI semantic model", text(semantic), "Prep for AI");

const sqlReadOnly = expectBase("Azure SQL read-only", {
  summary: "Internal employees need to ask questions over operational data stored in Azure SQL from Teams/Microsoft 365.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["employee_assistant", "operational_query"],
  dataSources: ["azure_sql"],
  behaviors: ["qa", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "audit"],
  networkControls: ["public"]
}, "copilot_studio_internal_assistant");
assertIncludes("Azure SQL read-only", text(sqlReadOnly), "Governed read-only SQL connector");
assertExcludes("Azure SQL read-only", text(sqlReadOnly), "Fabric Data Agent");
assertExcludes("Azure SQL read-only", text(sqlReadOnly), "Azure AI Search");

const sqlWrite = expectBase("Azure SQL read/write", {
  summary: "Internal employees need a Teams assistant to update customer status in Azure SQL after confirmation.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["employee_assistant", "record_update"],
  dataSources: ["azure_sql"],
  behaviors: ["qa", "record_update"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "audit", "managed_identity", "key_vault"],
  networkControls: ["public"]
}, "business_action_agent");
assertIncludes("Azure SQL read/write", text(sqlWrite), "Copilot Studio action / tool");
assertIncludes("Azure SQL read/write", text(sqlWrite), "Power Automate SQL Server connector");
assertIncludes("Azure SQL read/write", text(sqlWrite), "Audit logging");
assertIncludes("Azure SQL read/write", text(sqlWrite), "Parameterized stored procedure");

const sqlApprovalCopilotStudio = expectBase("Copilot Studio SQL approval action", {
  summary: "Internal employees use Microsoft 365 Copilot and Microsoft 365 to ask questions over SharePoint and submit approvals that update Azure SQL through Copilot Studio.",
  users: ["internal_employees"],
  channels: ["m365_copilot", "m365"],
  capabilities: ["employee_assistant", "approval"],
  dataSources: ["sharepoint", "azure_sql"],
  behaviors: ["qa", "approval"],
  runtimePreferences: ["copilot_studio"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id", "rbac", "audit"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"],
  writeBackConfirmed: true
}, "business_action_agent");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Runtime/Backend", "Copilot Studio managed runtime");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Runtime/Backend", "Power Automate cloud flow invoked as a Copilot Studio action");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Orchestration", "Power Automate cloud flow");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Orchestration", "Power Automate Approvals");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Integration", "Copilot Studio action / tool");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Integration", "Power Automate SQL Server connector for Azure SQL / SQL Server");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Integration", "Parameterized stored procedure or approved SQL connector operation");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Security", "Power Platform connection references / connector permissions");
assertLayerExcludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Security", "API Management");
assertLayerExcludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Security", "Managed Identity");
assertLayerExcludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Security", "Key Vault");
assertLayerIncludes("Copilot Studio SQL approval action", sqlApprovalCopilotStudio, "Network/Deployment", "SaaS");

const externalAdvanced = expectBase("external portal advanced documents", {
  summary: "External partners need a portal to search a large technical document corpus with hybrid search and metadata filters.",
  users: ["partners"],
  channels: ["portal"],
  capabilities: ["document_rag", "custom_app"],
  dataSources: ["documents", "blob_storage"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["custom_backend"],
  securityControls: ["entra_external_id", "apim", "waf", "audit"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search", "metadata_filtering"]
}, "external_ai_app");
assertIncludes("external portal advanced documents", text(externalAdvanced), "Azure AI Search");
assertIncludes("external portal advanced documents", text(externalAdvanced), "Azure OpenAI");
assertIncludes("external portal advanced documents", text(externalAdvanced), "Front Door");
assertExcludes("external portal advanced documents", text(externalAdvanced), "Microsoft 365 Agents SDK");

const m365Productivity = expectBase("M365 Copilot personal productivity", {
  summary: "Employees want help summarizing meetings, emails, and documents in Microsoft 365.",
  users: ["internal_employees"],
  channels: ["m365_copilot"],
  capabilities: ["personal_productivity"],
  dataSources: ["m365_graph"],
  behaviors: ["summarization", "qa"],
  lifecycleControls: ["none"],
  runtimePreferences: ["none"],
  securityControls: ["entra_id"],
  networkControls: ["public"]
}, "m365_copilot_productivity");
assertExcludes("M365 Copilot personal productivity", text(m365Productivity), "Copilot Studio");
assertExcludes("M365 Copilot personal productivity", text(m365Productivity), "Azure AI Search");
assertExcludes("M365 Copilot personal productivity", text(m365Productivity), "Azure OpenAI");

const m365SurfaceAssistant = expectBase("M365 Copilot channel but custom assistant", {
  summary: "Internal employees need a custom assistant available from Microsoft 365 Copilot and Teams that answers from SharePoint and Azure SQL.",
  users: ["internal_employees"],
  channels: ["m365_copilot", "teams"],
  capabilities: ["employee_assistant", "operational_query"],
  dataSources: ["sharepoint", "azure_sql"],
  behaviors: ["qa", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assertIncludes("M365 Copilot channel but custom assistant", text(m365SurfaceAssistant), "Copilot Studio native knowledge sources");
assertIncludes("M365 Copilot channel but custom assistant", text(m365SurfaceAssistant), "Governed read-only SQL connector");
assertExcludes("M365 Copilot channel but custom assistant", text(m365SurfaceAssistant), "Azure AI Search");

const documentRagIntentOnly = expectBase("document RAG capability alone", {
  summary: "Internal employees need a Teams assistant for document Q&A over policy files.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "document_rag"],
  dataSources: ["documents"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assertIncludes("document RAG capability alone", text(documentRagIntentOnly), "Copilot Studio native knowledge");
assertExcludes("document RAG capability alone", text(documentRagIntentOnly), "Azure AI Search");

const normalized = normalizeDecisionInput({
  summary: "conflicting options",
  users: ["mixed", "internal_employees"],
  channels: ["multiple", "teams"],
  capabilities: [],
  dataSources: [],
  behaviors: [],
  lifecycleControls: ["none", "evaluation"],
  runtimePreferences: ["none", "copilot_studio"],
  networkControls: ["public", "private_link"],
  securityControls: ["unknown", "entra_id"]
});
assert.deepEqual(normalized.users, ["internal_employees"]);
assert.deepEqual(normalized.channels, ["teams"]);
assert.deepEqual(normalized.lifecycleControls, ["evaluation"]);
assert.deepEqual(normalized.runtimePreferences, ["copilot_studio"]);
assert.deepEqual(normalized.networkControls, ["private_link"]);
assert.deepEqual(normalized.securityControls, ["entra_id"]);

const earlyInput: DecisionInput = {
  summary: "Internal employees need to ask questions over uploaded policy PDFs from Teams.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant"],
  dataSources: ["documents"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: [],
  runtimePreferences: [],
  securityControls: [],
  networkControls: [],
  advancedRagRequirements: ["none"]
};
assert.equal(applicableQuestions(emptyInput())[0]?.id, "summary", "fresh wizard should start with optional use-case summary textbox");
assert.ok(
  applicableQuestions(emptyInput()).some((question) => question.id === "modelStrategy"),
  "fresh wizard should expose the optional special-model path for Claude/Opus/Grok/BYO needs"
);
assert.equal(
  canGenerateRecommendation({
    summary: "Document Q&A over an unspecified repository.",
    users: ["internal_employees"],
    channels: ["teams"],
    capabilities: ["document_rag"],
    dataSources: ["azure_sql"],
    behaviors: ["qa"],
    lifecycleControls: ["none"],
    runtimePreferences: ["copilot_studio"],
    securityControls: ["entra_id"],
    networkControls: ["public"],
    advancedRagRequirements: ["none"]
  }).missingQuestionIds.includes("dataSources"),
  true,
  "document RAG must ask for a document repository before recommendation"
);
const readiness = canGenerateRecommendation(earlyInput);
assert.equal(readiness.ready, true, "adaptive early completion should be ready");
assert.equal(nextQuestion(earlyInput), null, "adaptive nextQuestion should finish early");
const adaptive = buildAdaptiveWizardState(earlyInput);
assert.equal(adaptive.canGenerateRecommendation, true);
assert.equal(adaptive.likelyBasePattern, "copilot_studio_internal_assistant");

const directTextFabricInput = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "Internal employees use Teams to ask read-only sales performance questions over a governed Power BI semantic model in Fabric.",
  directTextRecommendation: true
});
assert.deepEqual(directTextFabricInput.users, ["internal_employees"]);
assert.ok(directTextFabricInput.channels.includes("teams"));
assert.ok(directTextFabricInput.dataSources.includes("powerbi_semantic_model"));
assert.equal(directTextFabricInput.fabricAnalyticsIntent, "read_only_analytics_qa");
const directTextFabricDecision = decide(directTextFabricInput);
assert.equal(
  directTextFabricDecision.basePatternId,
  "copilot_studio_fabric_data_agent",
  "summary-only Fabric text should infer Copilot Studio + Fabric Data Agent"
);
assert.equal(categoryForDecision(directTextFabricDecision).category, "Copilot Studio");
assert.equal(directTextFabricDecision.confidence, "medium", "summary-only intake should not produce high confidence");
assert.match(text(directTextFabricDecision), /Microsoft Fabric Data Agent/);
assert.doesNotMatch(text(directTextFabricDecision), /Azure AI Foundry/);
assert.ok(
  directTextFabricDecision.assumptions.some((assumption) => /wizard was skipped/i.test(assumption)),
  "summary-only recommendation should disclose inferred profile assumption"
);

const directTextFoundryFabricInput = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "B2B partners use a portal with Foundry Agent Service tools to ask governed analytics questions over a Fabric Lakehouse.",
  directTextRecommendation: true
});
const directTextFoundryFabric = decide(directTextFoundryFabricInput);
assert.equal(directTextFoundryFabric.basePatternId, "azure_ai_foundry_app");
assert.equal(categoryForDecision(directTextFoundryFabric).category, "AI Foundry");
assert.match(text(directTextFoundryFabric), /Azure AI Foundry Agent Service/);
assert.match(text(directTextFoundryFabric), /Microsoft Fabric Data Agent/);

const directTextHybridFabricInput = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "Internal employees use Teams with Copilot Studio as the experience, Foundry Agent Service tools, and evaluation tracing over Fabric Lakehouse analytics.",
  directTextRecommendation: true
});
const directTextHybridFabric = decide(directTextHybridFabricInput);
assert.equal(directTextHybridFabric.basePatternId, "azure_ai_foundry_app");
assert.equal(categoryForDecision(directTextHybridFabric).category, "Hybrid Copilot Studio + AI Foundry");
assertLayerIncludes("direct text hybrid Fabric", directTextHybridFabric, "Experience", "Copilot Studio agent");
assert.match(text(directTextHybridFabric), /Microsoft Fabric Data Agent/);

const directTextExternalInput = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "External customers use a web portal to ask questions over PDF manuals in Blob Storage with hybrid search and citations.",
  directTextRecommendation: true
});
assert.ok(directTextExternalInput.users.includes("external_customers"));
assert.ok(directTextExternalInput.channels.includes("web"));
assert.ok(directTextExternalInput.advancedRagRequirements?.includes("hybrid_search"));
assert.equal(decide(directTextExternalInput).basePatternId, "external_ai_app");

const semanticUnknownInput: DecisionInput = {
  summary: "Internal Fabric analytics Q&A over a Power BI semantic model.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["fabric_analytics"],
  dataSources: ["powerbi_semantic_model"],
  behaviors: ["analytics", "qa"],
  lifecycleControls: [],
  runtimePreferences: [],
  securityControls: [],
  networkControls: [],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "internal_fabric_permissions",
  semanticModelConfirmations: ["not_confirmed"],
  semanticModelSecurityKnown: false
};
assert.equal(
  canGenerateRecommendation(semanticUnknownInput).ready,
  true,
  "semantic model not-confirmed response should allow a recommendation with assumptions"
);
assert.notEqual(nextQuestion(semanticUnknownInput)?.id, "semanticModelConfirmations");
assert.equal(decide(semanticUnknownInput).confidence, "medium");

const externalUnknownInput: DecisionInput = {
  summary: "Partners need a portal to ask questions over business APIs.",
  users: ["partners"],
  channels: ["portal"],
  capabilities: ["custom_app", "operational_query"],
  dataSources: ["apis"],
  behaviors: ["qa", "read_only_query"],
  lifecycleControls: [],
  runtimePreferences: [],
  securityControls: [],
  networkControls: [],
  modelStrategy: [],
  externalAccessUnknown: true
};
assert.equal(
  canGenerateRecommendation(externalUnknownInput).ready,
  true,
  "external access unknown response should allow the safer edge assumption"
);
assert.notEqual(nextQuestion(externalUnknownInput)?.id, "externalAccessConfirmed");
assert.equal(decide(externalUnknownInput).confidence, "medium");

const noisyInput: DecisionInput = {
  summary: "Admins use a Teams assistant to search contract documents, update customer records in Azure SQL, and trigger ERP/CRM workflows with evaluation and tracing enabled.",
  users: ["admins"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "document_rag", "record_update", "transaction"],
  dataSources: ["documents", "blob_storage", "azure_sql", "apis", "erp_crm"],
  behaviors: ["qa", "workflow", "record_update", "transaction", "long_running_process"],
  lifecycleControls: ["evaluation", "tracing", "monitoring"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "apim", "audit", "managed_identity", "key_vault"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search", "metadata_filtering"]
};
const noisy = expectBase("noisy multi-overlay", noisyInput, "business_action_agent");
assert.deepEqual(noisy.overlays.some((overlay) => overlay.id === "document_rag_overlay"), true);
assert.deepEqual(noisy.overlays.some((overlay) => overlay.id === "azure_ai_foundry_lifecycle"), false);
assertIncludes("noisy multi-overlay", layer(noisy, "Experience").join("\n"), "Copilot Studio agent");
assertIncludes("noisy multi-overlay", layer(noisy, "AI Platform").join("\n"), "Azure AI Foundry / Foundry Models");
assertIncludes("noisy multi-overlay", layer(noisy, "AI Platform").join("\n"), "Azure OpenAI model deployment in Azure AI Foundry");
assertLayerExcludes("noisy multi-overlay", noisy, "AI Platform", "Azure OpenAI for reasoning/generation");
assert.equal(countMatches(layer(noisy, "Knowledge/Data"), /Documents/i), 1, "document source is normalized");
assertExcludes("noisy multi-overlay", layer(noisy, "Knowledge/Data").join("\n"), "SharePoint");
assertIncludes("noisy multi-overlay", layer(noisy, "Knowledge/Data").join("\n"), "Documents / PDFs in Blob Storage");
assertIncludes("noisy multi-overlay", layer(noisy, "Integration").join("\n"), "Copilot Studio action / tool");
assertIncludes("noisy multi-overlay", layer(noisy, "Integration").join("\n"), "Power Automate SQL Server connector");
assertIncludes("noisy multi-overlay", layer(noisy, "Integration").join("\n"), "Document ingestion/indexing pipeline");
assertIncludes("noisy multi-overlay", layer(noisy, "Integration").join("\n"), "Azure AI Search index");
assert.equal(countMatches(layer(noisy, "Security"), /Entra ID/i), 1, "Entra ID appears once in Security");
assert.equal(countMatches(layer(noisy, "Security"), /Managed Identity/i), 1, "Managed Identity appears once in Security");
assert.equal(countMatches(layer(noisy, "Security"), /Key Vault/i), 1, "Key Vault appears once in Security");
assertIncludes("noisy multi-overlay", noisy.optionalAddOns.join("\n"), "Recommended safeguards");
assert.equal(categoryForDecision(noisy).category, "Hybrid Copilot Studio + AI Foundry");
const noisySummary = buildArchitectureSummary(noisyInput, noisy, categoryForDecision(noisy).category);
assert.ok(noisySummary.split(/\n\n/).length >= 4 && noisySummary.split(/\n\n/).length <= 6, "summary should be detailed but structured");
assertIncludes("noisy multi-overlay", noisySummary, "recommended solution");
assertIncludes("noisy multi-overlay", noisySummary, "Hybrid Copilot Studio + AI Foundry architecture");
assertIncludes("noisy multi-overlay", noisySummary, "Copilot Studio handles the conversational interface");
assertIncludes("noisy multi-overlay", noisySummary, "Security and operations");
assertExcludes("noisy multi-overlay", noisySummary, "Business Action / Transaction Agent");
const mermaid = buildMermaidDiagram(noisy);
assertExcludes("noisy multi-overlay mermaid", mermaid, "Copilot Studio --> Azure SQL");
assertExcludes("noisy multi-overlay mermaid", mermaid, "Azure OpenAI --> Azure SQL");

assert.equal(isActionable({
  summary: "workflow context only",
  users: ["external_customers"],
  channels: ["mobile"],
  capabilities: ["business_workflow"],
  dataSources: ["documents"],
  behaviors: ["workflow"],
  lifecycleControls: ["none"],
  runtimePreferences: ["none"],
  securityControls: [],
  networkControls: ["public"]
}), false, "workflow alone should not be actionable");

const contradictedWriteBack = normalizeDecisionInput({
  summary: "User selected update first but later confirmed read-only.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "record_update", "approval"],
  dataSources: ["azure_sql"],
  behaviors: ["qa", "record_update", "approval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  writeBackConfirmed: false
});
assert.deepEqual(contradictedWriteBack.capabilities, ["employee_assistant"], "read-only confirmation removes contradictory action capabilities");
assert.deepEqual(contradictedWriteBack.behaviors, ["qa"], "read-only confirmation removes contradictory action behaviors");
assert.equal(isActionable(contradictedWriteBack), false, "read-only confirmation wins over previous action selections");

const externalMobileDocsInput: DecisionInput = {
  summary: "External customers use a mobile app to summarize documents stored in Azure Blob Storage. The AI is informational only and does not update business systems.",
  users: ["external_customers"],
  channels: ["mobile"],
  capabilities: ["document_rag"],
  dataSources: ["documents", "blob_storage"],
  behaviors: ["qa", "retrieval", "summarization"],
  advancedRagRequirements: ["hybrid_search"],
  runtimePreferences: ["none"],
  lifecycleControls: ["none"],
  securityControls: ["entra_external_id", "apim", "waf"],
  networkControls: ["public"]
};
const externalMobileDocs = expectBase("external mobile document summary", externalMobileDocsInput, "external_ai_app");
assertIncludes("external mobile document summary", text(externalMobileDocs), "Azure AI Search");
assertIncludes("external mobile document summary", text(externalMobileDocs), "Azure OpenAI");
assertIncludes("external mobile document summary", text(externalMobileDocs), "Entra External ID");
assertIncludes("external mobile document summary", text(externalMobileDocs), "API Management");
assertIncludes("external mobile document summary", text(externalMobileDocs), "Front Door / WAF");
assertIncludes("external mobile document summary", layer(externalMobileDocs, "Runtime/Backend").join("\n"), "Custom Backend");
assertIncludes("external mobile document summary", externalMobileDocs.optionalAddOns.join("\n"), "Azure AI Foundry Agent Service");
assertExcludes("external mobile document summary", text(externalMobileDocs), "Logic Apps");
assertExcludes("external mobile document summary", text(externalMobileDocs), "Durable Functions");
assertExcludes("external mobile document summary", text(externalMobileDocs), "Deterministic execution layer");
assertExcludes("external mobile document summary", text(externalMobileDocs), "Audit logging for every write/action");
assertExcludes("external mobile document summary", text(externalMobileDocs), "Parameterized stored procedures");
assert.deepEqual(externalMobileDocs.overlays.some((overlay) => overlay.id === "azure_ai_foundry_lifecycle"), false);
const externalSummary = buildArchitectureSummary(externalMobileDocsInput, externalMobileDocs, categoryForDecision(externalMobileDocs).category);
assertIncludes("external mobile document summary", externalSummary, "AI Foundry architecture");
assertIncludes("external mobile document summary", externalSummary, "governed action path");
assertExcludes("external mobile document summary", externalSummary, "do not add");
assertExcludes("external mobile document summary", externalSummary, "not selected");
assert.equal(
  shouldUseGeneratedArchitectureSummary(
    "This is an AI Foundry architecture.\n\nThe backend handles retrieval.\n\nBecause advanced/custom RAG was not selected, do not add Azure AI Search by default.",
    "use case summary",
    "final recommendation",
    "AI Foundry"
  ),
  true,
  "customer-facing summary should reject internal guardrail wording"
);

const workflowGuidance = expectBase("workflow guidance only", {
  ...externalMobileDocsInput,
  summary: "External customers use a mobile app to summarize claim documents as part of a broader claims workflow, but the AI only provides guidance and does not submit or update anything.",
  capabilities: ["document_rag", "business_workflow"],
  behaviors: ["qa", "retrieval", "summarization", "workflow"],
  workflowExecution: ["guidance"],
  writeBackConfirmed: false
}, "external_ai_app");
assertExcludes("workflow guidance only", text(workflowGuidance), "Deterministic execution layer");
assertExcludes("workflow guidance only", text(workflowGuidance), "Logic Apps");
assertExcludes("workflow guidance only", text(workflowGuidance), "Durable Functions");

const workflowTransaction = expectBase("workflow transaction", {
  ...externalMobileDocsInput,
  capabilities: ["document_rag", "business_workflow"],
  behaviors: ["qa", "retrieval", "summarization", "workflow", "transaction"],
  workflowExecution: ["transaction"],
  writeBackConfirmed: true,
  securityControls: ["entra_external_id", "apim", "waf", "audit"]
}, "business_action_agent");
assertIncludes("workflow transaction", text(workflowTransaction), "Durable Functions");
assertIncludes("workflow transaction", text(workflowTransaction), "Audit logging for every write/action");

const internalNative = expectBase("internal Copilot native security scope", {
  summary: "Internal employees need a read-only assistant in Teams and Microsoft 365 Copilot to answer questions from SharePoint and Microsoft Graph content.",
  users: ["internal_employees"],
  channels: ["teams", "m365_copilot"],
  capabilities: ["employee_assistant"],
  dataSources: ["sharepoint", "m365_graph"],
  behaviors: ["qa", "retrieval"],
  runtimePreferences: ["copilot_studio"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"]
}, "copilot_studio_internal_assistant");
assert.equal(categoryForDecision(internalNative).category, "Copilot Studio");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Identity", "Entra ID");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Identity", "Entra External ID");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Knowledge/Data", "SharePoint");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Knowledge/Data", "Microsoft Graph / Microsoft 365 content");
assert.equal(countMatches(layer(internalNative, "Knowledge/Data"), /Microsoft Graph/i), 1, "Microsoft Graph appears once");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Security", "Entra ID");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Security", "M365 permissions");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Security", "Repository/source permissions");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Security", "RBAC / authorization checks");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "Entra External ID");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "API Management");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "Front Door");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "Managed Identity");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "Key Vault");
assertLayerExcludes("internal Copilot native security scope", internalNative, "Security", "Audit logging for every write/action");
assertLayerIncludes("internal Copilot native security scope", internalNative, "Network/Deployment", "SaaS");
assertExcludes("internal Copilot native security scope", text(internalNative), "Azure AI Search");
assertExcludes("internal Copilot native security scope", text(internalNative), "Azure OpenAI");
assertExcludes("internal Copilot native security scope", text(internalNative), "Azure AI Foundry");

const externalInterest = expectBase("external interest without channel", {
  summary: "Internal employees need a Teams assistant for SharePoint knowledge. We may later expose a separate external customer experience, but it is not confirmed.",
  users: ["internal_employees", "external_customers"],
  channels: ["teams", "m365_copilot"],
  capabilities: ["employee_assistant"],
  dataSources: ["sharepoint", "m365_graph"],
  behaviors: ["qa", "retrieval"],
  runtimePreferences: ["copilot_studio"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"],
  externalAccessConfirmed: false
}, "copilot_studio_internal_assistant");
assertLayerExcludes("external interest without channel", externalInterest, "Identity", "Entra External ID");
assertLayerExcludes("external interest without channel", externalInterest, "Security", "API Management");
assertIncludes("external interest without channel", externalInterest.optionalAddOns.join("\n"), "Potential add-ons if external access is confirmed");

const confirmedExternal = expectBase("confirmed external channel", {
  summary: "Internal employees use Teams, and external customers use a mobile app for a separate experience.",
  users: ["internal_employees", "external_customers"],
  channels: ["teams", "mobile"],
  capabilities: ["employee_assistant", "document_rag"],
  dataSources: ["sharepoint", "documents", "blob_storage"],
  behaviors: ["qa", "retrieval"],
  runtimePreferences: ["copilot_studio", "custom_backend"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id", "entra_external_id", "apim", "waf"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search"],
  externalAccessConfirmed: true
}, "external_ai_app");
assertLayerIncludes("confirmed external channel", confirmedExternal, "Identity", "Entra External ID");
assertLayerIncludes("confirmed external channel", confirmedExternal, "Integration", "API Management");
assertLayerExcludes("confirmed external channel", confirmedExternal, "Security", "API Management");
assertLayerIncludes("confirmed external channel", confirmedExternal, "Security", "Front Door / WAF");

const foundryFineTuneInput: DecisionInput = {
  summary: "External partners need a portal that uses a fine-tuned model for warranty triage.",
  users: ["partners"],
  channels: ["portal"],
  capabilities: ["custom_app", "operational_query"],
  dataSources: ["apis"],
  behaviors: ["qa", "read_only_query"],
  lifecycleControls: ["evaluation", "model_versioning"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_external_id", "apim"],
  networkControls: ["public"],
  modelStrategy: ["fine_tuned_azure_openai"],
  externalAccessConfirmed: true
};
const foundryFineTune = expectBase("Foundry fine-tuned model", foundryFineTuneInput, "azure_ai_foundry_app");
assert.equal(categoryForDecision(foundryFineTune).category, "AI Foundry");
assertIncludes("Foundry fine-tuned model", text(foundryFineTune), "Fine-tuned Azure OpenAI");
assertIncludes("Foundry fine-tuned model", text(foundryFineTune), "Azure AI Foundry");

const copilotAzureMlInput: DecisionInput = {
  summary: "Internal support users need a Teams assistant that calls an Azure ML churn model before suggesting retention actions.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "operational_query"],
  dataSources: ["dataverse"],
  behaviors: ["qa", "read_only_query"],
  lifecycleControls: ["model_versioning", "monitoring"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  modelStrategy: ["azure_ml_endpoint"]
};
const copilotAzureMl = expectBase("Copilot Studio plus Azure ML model", copilotAzureMlInput, "copilot_studio_internal_assistant");
assert.equal(categoryForDecision(copilotAzureMl).category, "Hybrid Copilot Studio + AI Foundry");
assertIncludes("Copilot Studio plus Azure ML model", text(copilotAzureMl), "Azure Machine Learning managed online endpoint");
assertIncludes("Copilot Studio plus Azure ML model", buildArchitectureSummary(copilotAzureMlInput, copilotAzureMl, categoryForDecision(copilotAzureMl).category), "Hybrid Copilot Studio + AI Foundry architecture");

const multiModelInput: DecisionInput = {
  summary: "Support teams use a portal that uses the default Foundry model deployment for drafting, a fine-tuned Azure OpenAI model for policy answers, a Foundry catalog model for classification, and an Azure ML endpoint for churn scoring.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "operational_query"],
  dataSources: ["apis", "dataverse"],
  behaviors: ["qa", "recommendation", "read_only_query"],
  lifecycleControls: ["evaluation", "tracing", "model_versioning"],
  modelStrategy: ["fine_tuned_azure_openai", "foundry_model_catalog", "azure_ml_endpoint"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "rbac", "apim"],
  networkControls: ["public"]
};
const normalizedMultiModel = normalizeDecisionInput(multiModelInput);
assert.deepEqual(
  normalizedMultiModel.modelStrategy,
  ["fine_tuned_azure_openai", "foundry_model_catalog", "azure_ml_endpoint"],
  "model strategy should preserve multiple specialized selected model types"
);
const multiModel = expectBase("multi-model portfolio", multiModelInput, "azure_ai_foundry_app");
const aiPlatform = layer(multiModel, "AI Platform").join("\n");
assertIncludes("multi-model portfolio", aiPlatform, "Multi-model routing / task-to-model selection");
assertIncludes("multi-model portfolio", aiPlatform, "Azure OpenAI model deployment in Azure AI Foundry");
assertIncludes("multi-model portfolio", aiPlatform, "Fine-tuned Azure OpenAI model in Azure AI Foundry");
assertIncludes("multi-model portfolio", aiPlatform, "Azure OpenAI, Azure-sold Foundry, or provider/open model");
assertIncludes("multi-model portfolio", aiPlatform, "Azure Machine Learning managed online endpoint");
assertIncludes("multi-model portfolio", text(multiModel), "Multi-model routing / task-to-model selection");
assertIncludes("multi-model portfolio", buildArchitectureSummary(multiModelInput, multiModel, categoryForDecision(multiModel).category), "model portfolio");

const claudeOpusInput: DecisionInput = {
  summary: "Customer service analysts use a portal and specifically want Claude Opus for complex reasoning over support policies.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "operational_query"],
  dataSources: ["apis"],
  behaviors: ["qa", "recommendation", "read_only_query"],
  lifecycleControls: ["evaluation"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  modelStrategy: ["anthropic_claude"]
};
const claudeOpus = expectBase("Claude Opus partner model", claudeOpusInput, "azure_ai_foundry_app");
assert.equal(categoryForDecision(claudeOpus).category, "AI Foundry");
assertIncludes("Claude Opus partner model", text(claudeOpus), "Claude / Anthropic model");
assertIncludes("Claude Opus partner model", text(claudeOpus), "Azure AI Foundry");

const grokHybridInput: DecisionInput = {
  summary: "Internal employees use Teams with Copilot Studio as the experience, but the customer wants Grok as a specialized model for analysis.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "operational_query"],
  dataSources: ["apis"],
  behaviors: ["qa", "recommendation", "read_only_query"],
  lifecycleControls: ["evaluation"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  modelStrategy: ["xai_grok"]
};
const grokHybrid = expectBase("Grok model with Copilot experience", grokHybridInput, "copilot_studio_internal_assistant");
assert.equal(categoryForDecision(grokHybrid).category, "Hybrid Copilot Studio + AI Foundry");
assertLayerIncludes("Grok model with Copilot experience", grokHybrid, "Experience", "Copilot Studio agent");
assertIncludes("Grok model with Copilot experience", text(grokHybrid), "Grok / xAI model");

const directTextPartnerModel = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "A customer portal needs a specific non-Azure OpenAI model: Claude Opus for reasoning, Grok for classification, and Mistral from the Foundry catalog over business APIs.",
  directTextRecommendation: true
});
assert.ok(directTextPartnerModel.modelStrategy?.includes("anthropic_claude"));
assert.ok(directTextPartnerModel.modelStrategy?.includes("xai_grok"));
assert.ok(directTextPartnerModel.modelStrategy?.includes("foundry_model_catalog"));
const directTextPartnerDecision = decide(directTextPartnerModel);
assert.equal(directTextPartnerDecision.basePatternId, "azure_ai_foundry_app");
assert.equal(categoryForDecision(directTextPartnerDecision).category, "AI Foundry");
assertIncludes("direct text partner model", text(directTextPartnerDecision), "Claude / Anthropic model");
assertIncludes("direct text partner model", text(directTextPartnerDecision), "Grok / xAI model");

const proofCopilotStudioInput: DecisionInput = {
  summary: "HR employees use a Teams and Microsoft 365 Copilot assistant to answer policy questions from SharePoint and Microsoft Graph content.",
  users: ["internal_employees"],
  channels: ["teams", "m365_copilot"],
  capabilities: ["employee_assistant"],
  dataSources: ["sharepoint", "m365_graph"],
  behaviors: ["qa", "retrieval"],
  runtimePreferences: ["copilot_studio"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  advancedRagRequirements: ["none"],
  modelStrategy: []
};
const proofCopilotStudio = expectBase("proof scenario - Copilot Studio HR knowledge", proofCopilotStudioInput, "copilot_studio_internal_assistant");
assert.equal(categoryForDecision(proofCopilotStudio).category, "Copilot Studio");
assertLayerIncludes("proof scenario - Copilot Studio HR knowledge", proofCopilotStudio, "AI Platform", "Copilot Studio managed AI experience");
assertLayerExcludes("proof scenario - Copilot Studio HR knowledge", proofCopilotStudio, "AI Platform", "Azure OpenAI");
assertLayerExcludes("proof scenario - Copilot Studio HR knowledge", proofCopilotStudio, "AI Platform", "Standard foundation model");
assertLayerExcludes("proof scenario - Copilot Studio HR knowledge", proofCopilotStudio, "Security", "Entra External ID");
assertExcludes("proof scenario - Copilot Studio HR knowledge", text(proofCopilotStudio), "Azure AI Search");
assertExcludes("proof scenario - Copilot Studio HR knowledge", text(proofCopilotStudio), "Azure OpenAI");
assertExcludes("proof scenario - Copilot Studio HR knowledge", text(proofCopilotStudio), "Azure AI Foundry");
assertExcludes("proof scenario - Copilot Studio HR knowledge", buildArchitectureSummary(proofCopilotStudioInput, proofCopilotStudio, categoryForDecision(proofCopilotStudio).category), "Model strategy");

const proofCopilotFoundryHybrid = expectBase("proof scenario - Copilot Studio Foundry AML hybrid", {
  summary: "Support agents use a Teams assistant to answer Dataverse account questions and call an Azure ML churn endpoint before suggesting retention guidance.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "operational_query"],
  dataSources: ["dataverse"],
  behaviors: ["qa", "read_only_query", "recommendation"],
  lifecycleControls: ["model_versioning", "monitoring"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  modelStrategy: ["azure_ml_endpoint"]
}, "copilot_studio_internal_assistant");
assert.equal(categoryForDecision(proofCopilotFoundryHybrid).category, "Hybrid Copilot Studio + AI Foundry");
assertLayerIncludes("proof scenario - Copilot Studio Foundry AML hybrid", proofCopilotFoundryHybrid, "Experience", "Copilot Studio agent");
assertLayerIncludes("proof scenario - Copilot Studio Foundry AML hybrid", proofCopilotFoundryHybrid, "AI Platform", "Azure Machine Learning managed online endpoint");
assertExcludes("proof scenario - Copilot Studio Foundry AML hybrid", text(proofCopilotFoundryHybrid), "Deterministic execution layer");

const proofFoundryClaims = expectBase("proof scenario - Foundry claims portal", {
  summary: "Claims adjusters use a portal that retrieves claim documents from Blob Storage, classifies claim type with a Foundry catalog model, and calls an Azure ML fraud endpoint for scoring.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "document_rag", "operational_query"],
  dataSources: ["documents", "blob_storage", "apis"],
  behaviors: ["qa", "retrieval", "summarization", "recommendation"],
  lifecycleControls: ["evaluation", "tracing", "monitoring"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "rbac", "apim"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
  modelStrategy: ["foundry_model_catalog", "azure_ml_endpoint"]
}, "azure_ai_foundry_app");
assert.equal(categoryForDecision(proofFoundryClaims).category, "AI Foundry");
assertLayerIncludes("proof scenario - Foundry claims portal", proofFoundryClaims, "Runtime/Backend", "Azure AI Foundry Agent Service");
assertLayerIncludes("proof scenario - Foundry claims portal", proofFoundryClaims, "Analytics/Grounding", "Azure AI Search");
assertLayerIncludes("proof scenario - Foundry claims portal", proofFoundryClaims, "AI Platform", "Multi-model routing / task-to-model selection");
assertLayerIncludes("proof scenario - Foundry claims portal", proofFoundryClaims, "AI Platform", "Azure Machine Learning managed online endpoint");
assertExcludes("proof scenario - Foundry claims portal", text(proofFoundryClaims), "Business Action / Transaction Agent");

const proofFabricAnalytics = expectBase("proof scenario - Fabric executive analytics", {
  summary: "Executives use Teams to ask sales performance questions over a governed Power BI semantic model in Fabric.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["fabric_analytics"],
  dataSources: ["powerbi_semantic_model"],
  behaviors: ["analytics", "qa", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "rls_ols"],
  networkControls: ["public"],
  semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"],
  semanticModelSecurityKnown: true,
  modelStrategy: []
}, "copilot_studio_fabric_data_agent");
assert.equal(categoryForDecision(proofFabricAnalytics).category, "Copilot Studio");
assertLayerIncludes("proof scenario - Fabric executive analytics", proofFabricAnalytics, "Analytics/Grounding", "Fabric Data Agent");
assertLayerIncludes("proof scenario - Fabric executive analytics", proofFabricAnalytics, "Security", "Power BI Semantic Model: Read permission required");
assertLayerExcludes("proof scenario - Fabric executive analytics", proofFabricAnalytics, "Analytics/Grounding", "Azure AI Search");

const externalCustomerTeamsFabric = expectBase("external customer Teams Fabric semantic model", {
  summary: "External customers use Teams and Microsoft 365 to ask read-only analytical questions over a Power BI semantic model. Document Q&A is in scope but the document repository is not confirmed.",
  users: ["external_customers"],
  channels: ["teams", "m365"],
  capabilities: ["fabric_analytics", "document_rag"],
  dataSources: ["powerbi_semantic_model"],
  behaviors: ["qa", "read_only_query", "analytics"],
  lifecycleControls: ["none"],
  runtimePreferences: ["none"],
  securityControls: ["entra_id", "rbac", "rls_ols"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "external_customers_citizens",
  advancedRagRequirements: ["none"],
  semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"],
  semanticModelSecurityKnown: true
}, "copilot_studio_fabric_data_agent");
assert.equal(categoryForDecision(externalCustomerTeamsFabric).category, "Copilot Studio");
assertLayerIncludes("external customer Teams Fabric semantic model", externalCustomerTeamsFabric, "Experience", "Copilot Studio agent");
assertLayerIncludes("external customer Teams Fabric semantic model", externalCustomerTeamsFabric, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerExcludes("external customer Teams Fabric semantic model", externalCustomerTeamsFabric, "Runtime/Backend", "Custom Backend");
assertLayerExcludes("external customer Teams Fabric semantic model", externalCustomerTeamsFabric, "AI Platform", "Azure AI Foundry / Foundry Models");
assertIncludes("external customer Teams Fabric semantic model", externalCustomerTeamsFabric.riskFlags.join("\n"), "identity passthrough");

const proofExternalReadOnlyRag = expectBase("proof scenario - external citizen document summary", {
  summary: "Citizens use a mobile app to summarize permit documents stored in Azure Blob Storage. The assistant is informational only and does not submit forms or update records.",
  users: ["citizens"],
  channels: ["mobile"],
  capabilities: ["document_rag"],
  dataSources: ["documents", "blob_storage"],
  behaviors: ["qa", "retrieval", "summarization"],
  lifecycleControls: ["none"],
  runtimePreferences: ["none"],
  securityControls: ["entra_external_id", "apim", "waf"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search"],
  modelStrategy: []
}, "external_ai_app");
assertLayerIncludes("proof scenario - external citizen document summary", proofExternalReadOnlyRag, "Analytics/Grounding", "Azure AI Search");
assertLayerIncludes("proof scenario - external citizen document summary", proofExternalReadOnlyRag, "Security", "Entra External ID");
assertLayerIncludes("proof scenario - external citizen document summary", proofExternalReadOnlyRag, "Security", "Front Door / WAF");
assertExcludes("proof scenario - external citizen document summary", text(proofExternalReadOnlyRag), "Durable Functions");
assertExcludes("proof scenario - external citizen document summary", text(proofExternalReadOnlyRag), "Audit logging for every write/action");

const mixedGroundingAction = expectBase("Fabric mixed grounding action", {
  summary: "External field users use a web and mobile app to search PDF manuals, ask read-only questions over Fabric Lakehouse and Warehouse metrics, look up Azure SQL records, reach an on-prem maintenance system, and submit a renewal workflow.",
  users: ["partners"],
  channels: ["web", "mobile"],
  capabilities: ["custom_app", "document_rag", "fabric_analytics", "operational_query", "business_workflow", "transaction"],
  dataSources: ["documents", "blob_storage", "azure_sql", "fabric_lakehouse", "fabric_warehouse", "on_prem"],
  behaviors: ["qa", "retrieval", "analytics", "read_only_query", "workflow", "transaction", "long_running_process"],
  lifecycleControls: ["evaluation", "tracing", "monitoring"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_external_id", "apim", "waf", "rbac", "audit", "managed_identity", "key_vault"],
  networkControls: ["private_link", "on_prem_connectivity"],
  advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "b2b_governed_fabric_access",
  externalAccessConfirmed: true,
  writeBackConfirmed: true
}, "azure_ai_foundry_app");
assert.deepEqual(mixedGroundingAction.overlays.some((overlay) => overlay.id === "business_action_overlay"), true);
assert.deepEqual(mixedGroundingAction.overlays.some((overlay) => overlay.id === "deterministic_orchestration"), true);
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Analytics/Grounding", "Azure AI Search");
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Integration", "Document ingestion/indexing pipeline");
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Integration", "Fabric Data Agent tool / Foundry tool connection");
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Integration", "Controlled Azure SQL write path");
assertLayerIncludes("Fabric mixed grounding action", mixedGroundingAction, "Network/Deployment", "Private Link");
assertIncludes("Fabric mixed grounding action", mixedGroundingAction.riskFlags.join("\n"), "Fabric Data Agent for B2B users requires validation");
assertIncludes("Fabric mixed grounding action", mixedGroundingAction.blockedComponents.join("\n"), "Direct LLM-to-database write");

const documentOnlyRag = expectBase("Document-only RAG", {
  summary: "Employees need a portal to ask questions over PDF manuals in Blob Storage with hybrid search and citations.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["document_rag"],
  dataSources: ["documents", "blob_storage"],
  behaviors: ["qa", "retrieval"],
  lifecycleControls: ["none"],
  runtimePreferences: ["custom_backend"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search"]
}, "document_rag_agent");
assertLayerIncludes("Document-only RAG", documentOnlyRag, "Analytics/Grounding", "Azure AI Search");
assertExcludes("Document-only RAG", text(documentOnlyRag), "Fabric Data Agent");

const fabricWarehouseQa = expectBase("Fabric Warehouse analytical QA", {
  summary: "Internal analysts ask natural-language questions over a Fabric Warehouse for revenue metrics and explanations.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["fabric_analytics"],
  dataSources: ["fabric_warehouse"],
  behaviors: ["analytics", "qa", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "internal_fabric_permissions"
}, "copilot_studio_fabric_data_agent");
assertLayerIncludes("Fabric Warehouse analytical QA", fabricWarehouseQa, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("Fabric Warehouse analytical QA", fabricWarehouseQa, "Knowledge/Data", "Fabric Warehouse");
assertLayerIncludes("Fabric Warehouse analytical QA", fabricWarehouseQa, "Security", "Fabric / Power BI permissions");
assertLayerExcludes("Fabric Warehouse analytical QA", fabricWarehouseQa, "Analytics/Grounding", "Azure AI Search");

const sqlStatusUpdate = expectBase("SQL status lookup and update", {
  summary: "Internal service agents look up customer status in Azure SQL and submit an approved update from Teams.",
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant", "operational_query", "record_update"],
  dataSources: ["azure_sql"],
  behaviors: ["qa", "read_only_query", "record_update"],
  lifecycleControls: ["none"],
  runtimePreferences: ["copilot_studio"],
  securityControls: ["entra_id", "rbac", "audit"],
  networkControls: ["public"],
  writeBackConfirmed: true
}, "business_action_agent");
assertLayerIncludes("SQL status lookup and update", sqlStatusUpdate, "Integration", "Power Automate SQL Server connector");
assertLayerIncludes("SQL status lookup and update", sqlStatusUpdate, "Integration", "Parameterized stored procedure");
assertExcludes("SQL status lookup and update", text(sqlStatusUpdate), "arbitrary SQL");

const anonymousFabric = expectBase("Anonymous Fabric analytics", {
  summary: "Anonymous users want a public web page to ask natural-language questions over Fabric Warehouse statistics.",
  users: ["citizens"],
  channels: ["web"],
  capabilities: ["fabric_analytics", "custom_app"],
  dataSources: ["fabric_warehouse"],
  behaviors: ["analytics", "qa"],
  lifecycleControls: ["none"],
  runtimePreferences: ["custom_backend"],
  securityControls: ["apim", "waf"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "anonymous_users",
  externalAccessConfirmed: true
}, "external_ai_app");
assertLayerIncludes("Anonymous Fabric analytics", anonymousFabric, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("Anonymous Fabric analytics", anonymousFabric, "Integration", "Fabric Data Agent connection");
assertIncludes("Anonymous Fabric analytics", anonymousFabric.riskFlags.join("\n"), "identity passthrough");

const fabricStorageOnly = expectBase("Fabric storage only", {
  summary: "The app stores curated data in a Fabric Lakehouse but users only consume predefined API responses.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app"],
  dataSources: ["fabric_lakehouse"],
  behaviors: ["qa"],
  lifecycleControls: ["none"],
  runtimePreferences: ["custom_backend"],
  securityControls: ["entra_id", "apim"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "predefined_reports_apis",
  fabricUserAccess: "internal_fabric_permissions"
}, "custom_ai_app");
assertLayerExcludes("Fabric storage only", fabricStorageOnly, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("Fabric storage only", fabricStorageOnly, "Integration", "Governed Fabric API / predefined report access");

const foundryFabricOnly = expectBase("Foundry Fabric analytics tool", {
  summary: "A Foundry Agent Service portal answers natural-language analytics questions over Fabric Lakehouse data for internal analysts.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "fabric_analytics"],
  dataSources: ["fabric_lakehouse"],
  behaviors: ["analytics", "qa", "read_only_query"],
  lifecycleControls: ["evaluation"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "rbac", "apim"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "internal_fabric_permissions"
}, "azure_ai_foundry_app");
assertLayerIncludes("Foundry Fabric analytics tool", foundryFabricOnly, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("Foundry Fabric analytics tool", foundryFabricOnly, "Analytics/Grounding", "Fabric Data Agent tool connected to Azure AI Foundry Agent Service");
assertLayerExcludes("Foundry Fabric analytics tool", foundryFabricOnly, "Analytics/Grounding", "Azure AI Search");

const onPremFoundry = expectBase("Foundry on-prem private access", {
  summary: "A Foundry Agent Service portal retrieves context from an on-prem maintenance system and executes an approved renewal workflow.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "business_workflow"],
  dataSources: ["on_prem"],
  behaviors: ["qa", "workflow", "transaction"],
  lifecycleControls: ["evaluation", "monitoring"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "apim", "audit", "managed_identity", "key_vault"],
  networkControls: ["private_link", "vpn", "on_prem_connectivity"],
  writeBackConfirmed: true
}, "azure_ai_foundry_app");
assert.deepEqual(onPremFoundry.overlays.some((overlay) => overlay.id === "business_action_overlay"), true);
assert.deepEqual(onPremFoundry.overlays.some((overlay) => overlay.id === "deterministic_orchestration"), true);
assertLayerIncludes("Foundry on-prem private access", onPremFoundry, "Network/Deployment", "VPN / ExpressRoute");
assertLayerIncludes("Foundry on-prem private access", onPremFoundry, "Network/Deployment", "Private Link");
assertIncludes("Foundry on-prem private access", onPremFoundry.blockedComponents.join("\n"), "Direct LLM-to-system-of-record writes");
assertLayerIncludes("Foundry on-prem private access", onPremFoundry, "Integration", "Private API facade / governed connector for on-premises systems");

const fabricAndDocsNoAction = expectBase("Fabric and docs read-only", {
  summary: "Internal experts ask questions over product PDFs and compare answers with Fabric Lakehouse warranty metrics.",
  users: ["internal_employees"],
  channels: ["portal"],
  capabilities: ["custom_app", "document_rag", "fabric_analytics"],
  dataSources: ["documents", "blob_storage", "fabric_lakehouse"],
  behaviors: ["qa", "retrieval", "analytics", "read_only_query"],
  lifecycleControls: ["none"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_id", "apim"],
  networkControls: ["public"],
  advancedRagRequirements: ["hybrid_search"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "internal_fabric_permissions"
}, "azure_ai_foundry_app");
assertLayerIncludes("Fabric and docs read-only", fabricAndDocsNoAction, "Analytics/Grounding", "Azure AI Search");
assertLayerIncludes("Fabric and docs read-only", fabricAndDocsNoAction, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertExcludes("Fabric and docs read-only", text(fabricAndDocsNoAction), "Durable Functions");

const b2bFabricCaution = expectBase("B2B Fabric analytics caution", {
  summary: "B2B partners use a portal to ask analytics questions over a shared Fabric Warehouse with governed access.",
  users: ["partners"],
  channels: ["portal"],
  capabilities: ["fabric_analytics", "custom_app"],
  dataSources: ["fabric_warehouse"],
  behaviors: ["analytics", "qa"],
  lifecycleControls: ["none"],
  runtimePreferences: ["foundry_agent_service"],
  securityControls: ["entra_external_id", "apim", "rbac"],
  networkControls: ["public"],
  fabricAnalyticsIntent: "read_only_analytics_qa",
  fabricUserAccess: "b2b_governed_fabric_access",
  externalAccessConfirmed: true
}, "azure_ai_foundry_app");
assertLayerIncludes("B2B Fabric analytics caution", b2bFabricCaution, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertIncludes("B2B Fabric analytics caution", b2bFabricCaution.riskFlags.join("\n"), "B2B users requires validation");

const externalCitizenFabricInput: DecisionInput = {
  summary: "Citizens need a mobile-first assistant to ask read-only questions and receive summaries from governed Fabric business information. Teams may be used by internal staff.",
  users: ["citizens"],
  channels: ["mobile", "teams"],
  capabilities: ["document_rag", "operational_query"],
  dataSources: ["fabric_lakehouse", "fabric_warehouse"],
  behaviors: ["qa", "summarization", "read_only_query"],
  runtimePreferences: ["none"],
  lifecycleControls: ["none"],
  securityControls: ["entra_external_id", "apim", "waf", "managed_identity", "key_vault"],
  networkControls: ["public"],
  advancedRagRequirements: ["unknown"]
};
assert.equal(canGenerateRecommendation(externalCitizenFabricInput).ready, false, "external citizen Fabric should ask Fabric clarifiers before final recommendation");
assert.equal(nextQuestion(externalCitizenFabricInput)?.id, "fabricAnalyticsIntent");
const externalCitizenFabric = expectBase("external citizen mobile Fabric Q&A", externalCitizenFabricInput, "external_ai_app");
assert.equal(categoryForDecision(externalCitizenFabric).category, "AI Foundry");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "User/Channel", "Mobile app");
assertLayerExcludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "User/Channel", "Teams");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Runtime/Backend", "Custom Backend");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "AI Platform", "Azure AI Foundry / Foundry Models");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "AI Platform", "Azure OpenAI model deployment in Azure AI Foundry");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Knowledge/Data", "Fabric Lakehouse");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Knowledge/Data", "Fabric Warehouse");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Integration", "API Management (APIM)");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Integration", "Fabric Data Agent connection");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "Entra External ID");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "RBAC / authorization checks");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Integration", "API Management (APIM)");
assertLayerExcludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "API Management (APIM)");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "Managed Identity");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "Key Vault");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "Front Door / WAF");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Security", "Fabric / Power BI permissions");
assertLayerIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric, "Observability", "Application Insights");
assertExcludes("external citizen mobile Fabric Q&A stack", externalCitizenFabric.recommendedStack.join("\n"), "Azure AI Foundry lifecycle overlay");
assertIncludes("external citizen mobile Fabric Q&A stack", externalCitizenFabric.recommendedStack.join("\n"), "Microsoft Fabric Data Agent");
assertExcludes("external citizen mobile Fabric Q&A", layer(externalCitizenFabric, "Analytics/Grounding").join("\n"), "Azure AI Search");
assertExcludes("external citizen mobile Fabric Q&A", text(externalCitizenFabric), "Business APIs / data stores");
assertExcludes("external citizen mobile Fabric Q&A", text(externalCitizenFabric), "Logic Apps");
assertExcludes("external citizen mobile Fabric Q&A", text(externalCitizenFabric), "Durable Functions");
assertIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric.assumptions.join("\n"), "Document Q&A is in scope");
assertIncludes("external citizen mobile Fabric Q&A", externalCitizenFabric.riskFlags.join("\n"), "Teams access for citizens");

const externalCitizenFabricLifecycle = expectBase("external citizen mobile Fabric Q&A with lifecycle", {
  ...externalCitizenFabricInput,
  lifecycleControls: ["evaluation", "tracing", "monitoring"]
}, "external_ai_app");
assert.deepEqual(externalCitizenFabricLifecycle.overlays.some((overlay) => overlay.id === "azure_ai_foundry_lifecycle"), false);
assertLayerIncludes("external citizen mobile Fabric Q&A with lifecycle", externalCitizenFabricLifecycle, "AI Platform", "Azure AI Foundry / Foundry Models");
assertLayerIncludes("external citizen mobile Fabric Q&A with lifecycle", externalCitizenFabricLifecycle, "Observability", "Azure AI Foundry evaluation / tracing / monitoring");
assertLayerExcludes("external citizen mobile Fabric Q&A with lifecycle", externalCitizenFabricLifecycle, "Analytics/Grounding", "Azure AI Search");
assertIncludes("external citizen mobile Fabric Q&A with lifecycle", externalCitizenFabricLifecycle.recommendedStack.join("\n"), "Microsoft Fabric Data Agent");

const externalCitizenFabricDocs = expectBase("external citizen Fabric plus confirmed document RAG", {
  ...externalCitizenFabricInput,
  dataSources: ["fabric_lakehouse", "fabric_warehouse", "documents", "blob_storage"],
  advancedRagRequirements: ["hybrid_search"]
}, "external_ai_app");
assert.deepEqual(externalCitizenFabricDocs.overlays.some((overlay) => overlay.id === "document_rag_overlay"), true);
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Analytics/Grounding", "Azure AI Search");
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Knowledge/Data", "Fabric Lakehouse");
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Knowledge/Data", "Fabric Warehouse");
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Knowledge/Data", "Documents / PDFs in Blob Storage");
assertLayerIncludes("external citizen Fabric plus confirmed document RAG", externalCitizenFabricDocs, "Integration", "Document ingestion/indexing pipeline");

const internalFabricTeams = expectBase("internal Fabric Teams Q&A remains Fabric Data Agent", {
  summary: "Internal employees ask read-only analytics questions over Fabric Lakehouse and Warehouse in Teams.",
  users: ["internal_employees"],
  channels: ["teams", "m365"],
  capabilities: ["fabric_analytics"],
  dataSources: ["fabric_lakehouse", "fabric_warehouse"],
  behaviors: ["qa", "analytics", "read_only_query"],
  runtimePreferences: ["copilot_studio"],
  lifecycleControls: ["none"],
  securityControls: ["entra_id"],
  networkControls: ["public"]
}, "copilot_studio_fabric_data_agent");
assertLayerIncludes("internal Fabric Teams Q&A remains Fabric Data Agent", internalFabricTeams, "Analytics/Grounding", "Microsoft Fabric Data Agent");
assertLayerExcludes("internal Fabric Teams Q&A remains Fabric Data Agent", internalFabricTeams, "Runtime/Backend", "Custom Backend");
assertLayerExcludes("internal Fabric Teams Q&A remains Fabric Data Agent", internalFabricTeams, "Security", "Front Door / WAF");

const externalBusinessApis = expectBase("external API with real business APIs", {
  summary: "External partners use an API-backed portal to ask read-only questions over existing business APIs and ERP/CRM data.",
  users: ["partners"],
  channels: ["portal", "api"],
  capabilities: ["custom_app", "operational_query"],
  dataSources: ["apis", "erp_crm"],
  behaviors: ["qa", "read_only_query"],
  runtimePreferences: ["custom_backend"],
  lifecycleControls: ["none"],
  securityControls: ["entra_external_id", "apim", "waf"],
  networkControls: ["public"],
  externalAccessConfirmed: true
}, "external_ai_app");
assertIncludes("external API with real business APIs", text(externalBusinessApis), "Business APIs");
assertIncludes("external API with real business APIs", text(externalBusinessApis), "ERP / CRM");
assertLayerExcludes("external API with real business APIs", externalBusinessApis, "Analytics/Grounding", "Governed Fabric");

/* ============================================================
 * Parser generalization guards (over-broad regex regressions)
 * ============================================================ */

// "staff members" / "team members" must stay internal, not external customers.
const staffMembersInput = inferPrepared("staff members in Teams need to ask questions over SharePoint HR documents");
assert.equal(staffMembersInput.users.includes("external_customers"), false, "'staff members' must not infer external customers");
assert.ok(staffMembersInput.users.includes("internal_employees"), "'staff members' should infer internal employees");

// "our client" (org reference) must not flip the audience to external customers.
const ourClientInput = inferPrepared("our client wants employees in Teams to chat with their SharePoint policy documents");
assert.equal(ourClientInput.users.includes("external_customers"), false, "'our client' org reference must not infer external customers");

// "members of the public" remains an external/citizen-style audience.
const publicMembersInput = inferPrepared("members of the public can ask questions on a website over published documents");
assert.ok(publicMembersInput.users.includes("external_customers"), "'members of the public' should infer an external audience");

// "search the web" describes internet grounding, not a web delivery channel.
const webSearchInput = inferPrepared("internal employees in Teams want an assistant that can search the web for answers");
assert.equal(webSearchInput.channels.includes("web"), false, "'search the web' must not infer a web delivery channel");

// A genuine web app/portal still infers the web channel.
const webAppInput = inferPrepared("external customers use a web app to chat with claim documents");
assert.ok(webAppInput.channels.includes("web"), "an explicit web app should still infer the web channel");

// Bare "query"/"records" in a document-chat context must not infer operational structured querying.
const docQueryInput = inferPrepared("employees in Teams want to query HR records by chatting with SharePoint policy documents");
assert.equal(docQueryInput.dataSources.includes("apis"), false, "document-chat wording must not infer an API data source");

// "expose it as an API" is a delivery channel, not an operational data backend.
const apiChannelInput = inferPrepared("expose the internal assistant as an API for other teams to call");
assert.equal(apiChannelInput.dataSources.includes("apis"), false, "API-as-delivery must not infer an API data source");

// Incidental words must not force a model-customization (Foundry) route.
const incidentalModelInput = inferPrepared("the team wants to grok the meta picture of bi-weekly reports from SharePoint docs in Teams");
assert.equal(incidentalModelInput.modelStrategy?.includes("xai_grok") ?? false, false, "'grok' as a verb must not infer the Grok model");
assert.equal(incidentalModelInput.modelStrategy?.includes("foundry_model_catalog") ?? false, false, "'meta' as a common word must not infer the Foundry model catalog");

// "users logging in" / "brand identity" must not infer security routing signals strong enough to skip clarification.
const incidentalSecurityInput = inferPrepared("we care about our brand identity while users are logging in to chat with documents");
assert.equal(incidentalSecurityInput.securityControls.includes("entra_id"), false, "'brand identity' must not infer Entra ID");
assert.equal(incidentalSecurityInput.securityControls.includes("audit"), false, "'logging in' must not infer audit logging");

// Negation-aware action inference: negated/forbidden actions must NOT infer action capabilities.
const negatedActionsInput = inferPrepared(
  "relationship managers in Teams ask policy questions over SharePoint documents; the solution must not provide transaction advice or update client records"
);
assert.equal(negatedActionsInput.capabilities.includes("record_update"), false, "'must not ... update client records' must not infer record_update");
assert.equal(negatedActionsInput.capabilities.includes("transaction"), false, "'not provide transaction advice' must not infer a transaction action");
assert.equal((negatedActionsInput.behaviors ?? []).includes("record_update"), false, "negated record update must not surface as a record_update behavior");

const avoidUpdatesInput = inferPrepared("internal employees chat with SharePoint policy documents in Teams and avoid updating any records");
assert.equal(avoidUpdatesInput.capabilities.includes("record_update"), false, "'avoid updating any records' must not infer record_update");

const readOnlyBankInput = inferPrepared(
  "a regulated bank has relationship managers asking policy questions in Teams over SharePoint compliance policies; it must stay in Copilot Studio, apply DLP and audit logging, and not provide transaction advice or update client records"
);
assert.notStrictEqual(decide(readOnlyBankInput).basePatternId, "business_action_agent", "read-only bank policy Q&A must not route to the business action agent");

// Positive control: a genuine, un-negated action must still infer the action capability.
const realActionInput = inferPrepared("employees in Teams submit and update purchase orders in Dataverse with approval");
assert.ok(realActionInput.capabilities.includes("record_update"), "a genuine 'update ... orders' must still infer record_update");

// Editing a loaded example's summary down to a short scenario must re-derive a clean
// profile from the new text (the Wizard seeds auto-inferred tracking so example fields
// do not leak). The fresh inference of the shortened retailer summary must NOT carry
// the original example's action/workflow profile.
const shortenedRetailerInput = inferPrepared("A retailer has 2,300 stores and 41,000 associates using Teams.");
assert.equal(shortenedRetailerInput.capabilities.includes("business_workflow"), false, "shortened summary must not infer business_workflow");
assert.equal((shortenedRetailerInput.behaviors ?? []).includes("workflow"), false, "shortened summary must not infer a workflow behavior");
assert.equal(shortenedRetailerInput.dataSources.includes("dataverse"), false, "shortened summary must not infer Dataverse");
assert.equal(shortenedRetailerInput.writeBackConfirmed === true, false, "shortened summary must not confirm write-back");
assert.equal((shortenedRetailerInput.workflowExecution ?? []).some((v) => v && v !== "unknown"), false, "shortened summary must not infer workflow execution");
assert.notStrictEqual(decide(shortenedRetailerInput).basePatternId, "business_action_agent", "shortened retailer summary must not route to the business action agent");

// Build-from-text mode must ignore stale wizard/example arrays and re-infer purely from
// the (edited) summary. Simulates: load an example into the wizard (full profile), then
// edit the text down to a short scenario and skip the wizard.
const staleExampleProfile: DecisionInput = {
  ...emptyInput(),
  summary: "An enterprise IT desk supports 18,000 employees and receives 9,500 monthly tickets.",
  directTextRecommendation: true,
  users: ["internal_employees"],
  channels: ["m365"],
  capabilities: ["employee_assistant", "operational_query", "business_workflow"],
  dataSources: ["m365_graph", "sharepoint", "apis"],
  behaviors: ["read_only_query", "workflow", "qa"],
  workflowExecution: ["controlled_action"],
  writeBackConfirmed: true
};
const rederivedFromEditedText = prepareDecisionInputForRecommendation(staleExampleProfile);
assert.equal(rederivedFromEditedText.capabilities.includes("business_workflow"), false, "build-from-text must drop the stale example's business_workflow");
assert.equal(rederivedFromEditedText.dataSources.includes("apis"), false, "build-from-text must drop the stale example's Business APIs");
assert.equal(rederivedFromEditedText.dataSources.includes("sharepoint"), false, "build-from-text must drop the stale example's SharePoint");
assert.equal((rederivedFromEditedText.workflowExecution ?? []).some((v) => v && v !== "unknown"), false, "build-from-text must drop the stale example's workflow execution");
assert.equal(rederivedFromEditedText.writeBackConfirmed === true, false, "build-from-text must drop the stale example's write-back confirmation");
assert.notStrictEqual(decide(rederivedFromEditedText).basePatternId, "business_action_agent", "edited short IT-desk text must not route to the business action agent");

console.log("Decision regression checks passed.");
