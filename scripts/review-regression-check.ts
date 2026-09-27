import assert from "node:assert/strict";
import { decide } from "../lib/decision-engine";
import { normalizeDecisionInput } from "../lib/input-normalization";
import { QUESTIONS, applicableQuestions } from "../lib/questions";
import { buildAdaptiveWizardState } from "../lib/adaptive-wizard";
import { isActionable } from "../lib/rules";
import { prepareDecisionInputForRecommendation } from "../lib/summary-intake";
import { emptyInput, type ArchitectureDecision, type DecisionInput } from "../lib/types";

const failures: string[] = [];
let passed = 0;

function check(name: string, run: () => void) {
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`FAIL ${failures.at(-1)}`);
  }
}

const fromText = (summary: string) =>
  prepareDecisionInputForRecommendation({ ...emptyInput(), summary, directTextRecommendation: true });

const internal = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  ...emptyInput(),
  users: ["internal_employees"],
  channels: ["teams"],
  capabilities: ["employee_assistant"],
  dataSources: ["sharepoint"],
  behaviors: ["qa", "read_only_query"],
  runtimePreferences: ["copilot_studio"],
  ...overrides
});

const layer = (decision: ArchitectureDecision, name: string) =>
  decision.architectureLayers.find((item) => item.layer === name)?.selections.join("\n") ?? "";

const recommendation = (decision: ArchitectureDecision) =>
  [...decision.recommendedStack, ...decision.architectureLayers.flatMap((item) => item.selections)].join("\n");

check("Read-only order status does not authorize transactions", () => {
  const input = fromText("Employees use Teams to look up order status in Azure SQL. The assistant is read-only.");
  assert.equal(isActionable(input), false);
  assert.equal(decide(input).basePatternId, "copilot_studio_internal_assistant");
  assert.doesNotMatch(layer(decide(input), "Orchestration"), /Power Automate|Durable|Logic Apps/);
});

check("Read-only approval policy and payment history are not actions", () => {
  const input = fromText("Employees use Teams for read-only approval policy and payment history questions from SharePoint.");
  assert.equal(isActionable(input), false);
  const approvedContent = fromText("Employees use Teams to answer read-only questions from approved SharePoint policy documents.");
  assert.equal(isActionable(approvedContent), false, "Approved content is not a request to approve something.");
});

check("Mixed read-only retrieval and explicitly requested writes preserve actions", () => {
  const input = fromText("Employees use Teams to ask read-only questions over SharePoint documents, and after human approval update a case in Dataverse.");
  assert.equal(isActionable(input), true);
});

check("Warehouse management is an operational source, not Fabric", () => {
  const input = fromText("Employees use Teams to answer questions about the warehouse management system.");
  assert.ok(input.dataSources.includes("apis"));
  assert.equal(input.dataSources.includes("fabric_warehouse"), false);
  assert.doesNotMatch(recommendation(decide(input)), /Fabric Data Agent/);
});

check("An unqualified dataset does not imply a Power BI semantic model", () => {
  const input = fromText("Employees use a portal to query a dataset through approved business APIs.");
  assert.equal(input.dataSources.includes("powerbi_semantic_model"), false);
});

check("Document metadata does not trigger a Meta model-selection gate", () => {
  const input = internal({
    summary: "Employees need hybrid search over document metadata.",
    dataSources: ["documents"],
    advancedRagRequirements: ["hybrid_search"]
  });
  const state = buildAdaptiveWizardState(input);
  assert.equal(state.unresolvedCriticalQuestions.includes("modelStrategy"), false);
});

check("Negated optional services do not become confirmed RAG or private requirements", () => {
  const input = fromText("Employees use Teams to answer policy questions. No Azure AI Search, no VNet, no private endpoints are needed.");
  assert.equal(input.advancedRagRequirements?.includes("explicit_azure_ai_search"), false);
  assert.deepEqual(input.networkControls, []);
  assert.doesNotMatch(recommendation(decide(input)), /Azure AI Search|Private Link/);
});

check("An affirmative clause after a negation keeps its private requirement", () => {
  const input = fromText("Employees use a portal with no VPN, but Private Link is required for Azure SQL.");
  assert.ok(input.networkControls.includes("private_link"));
  assert.equal(input.networkControls.includes("vpn"), false);
});

check("Fabric predefined reports do not require a natural-language Data Agent", () => {
  const decision = decide(internal({
    channels: ["portal"],
    capabilities: ["custom_app"],
    dataSources: ["fabric_lakehouse"],
    runtimePreferences: ["custom_backend"],
    fabricAnalyticsIntent: "predefined_reports_apis",
    fabricUserAccess: "internal_fabric_permissions"
  }));
  assert.doesNotMatch(recommendation(decision), /Fabric Data Agent/);
  assert.match(layer(decision, "Integration"), /governed.*(?:API|report)/i);
});

check("Fabric storage does not displace explicitly required document RAG", () => {
  const decision = decide(internal({
    channels: ["portal"],
    capabilities: ["document_rag"],
    dataSources: ["fabric_lakehouse", "documents"],
    runtimePreferences: ["custom_backend"],
    advancedRagRequirements: ["hybrid_search"],
    fabricAnalyticsIntent: "storage_only"
  }));
  assert.equal(decision.basePatternId, "document_rag_agent");
  assert.doesNotMatch(recommendation(decision), /Fabric Data Agent/);
  assert.match(layer(decision, "Analytics/Grounding"), /Azure AI Search/);
});

check("Direct-text Fabric storage and predefined-report opt-outs are preserved", () => {
  const reports = fromText("Citizens use a website with predefined reports and APIs from Fabric Warehouse, not live natural-language Fabric Q&A.");
  assert.equal(reports.fabricAnalyticsIntent, "predefined_reports_apis");
  assert.doesNotMatch(recommendation(decide(reports)), /Fabric Data Agent/);
  const storage = fromText("Employees use a portal with Fabric Lakehouse only for storage and processing.");
  assert.equal(storage.fabricAnalyticsIntent, "storage_only");
  assert.doesNotMatch(recommendation(decide(storage)), /Fabric Data Agent/);
});

check("A reference to reports does not suppress affirmative Fabric analytics", () => {
  const input = fromText("Employees in Teams ask natural-language analytics questions over Fabric Warehouse and compare the answers to predefined reports.");
  assert.equal(input.fabricAnalyticsIntent, "read_only_analytics_qa");
  assert.match(recommendation(decide(input)), /Fabric Data Agent/);
});

check("Confirmed internal Fabric analytics retains the native Data Agent path", () => {
  const decision = decide(internal({
    capabilities: ["fabric_analytics"],
    dataSources: ["fabric_warehouse"],
    behaviors: ["analytics", "qa"],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "internal_fabric_permissions"
  }));
  assert.equal(decision.basePatternId, "copilot_studio_fabric_data_agent");
  assert.match(layer(decision, "Analytics/Grounding"), /Fabric Data Agent/);
});

check("Explicit audit and DLP requirements survive managed read-only cleanup", () => {
  const decision = decide(internal({ securityControls: ["entra_id", "audit", "dlp", "purview"] }));
  assert.match(layer(decision, "Security"), /Audit logging/);
  assert.match(layer(decision, "Security"), /DLP/);
  assert.match(layer(decision, "Security"), /Purview/);
  assert.equal(decision.architectureLayers.find((item) => item.layer === "Observability")?.required, true);
  assert.match(decision.recommendedStack.join("\n"), /Audit logging/);
  assert.doesNotMatch(decision.optionalAddOns.join("\n"), /Selected but not required.*(?:Audit|DLP|Purview)/);
});

check("Managed SaaS does not erase explicit private endpoint and ingress requirements", () => {
  const decision = decide(internal({ networkControls: ["private_endpoint", "no_public_endpoint"] }));
  assert.match(layer(decision, "Network/Deployment"), /Private (?:Link|Endpoint)/);
  assert.match(layer(decision, "Network/Deployment"), /No public endpoint/);
  assert.match(decision.riskFlags.join("\n"), /(?:validate|confirm).*(?:ingress|channel|private)/i);
  assert.equal(decision.overlays.some((item) => item.id === "managed_saas_governance"), false);
});

check("Managed Copilot on-prem connections retain their private transport", () => {
  const decision = decide(internal({
    dataSources: ["on_prem"],
    networkControls: ["expressroute", "on_prem_connectivity"]
  }));
  assert.match(layer(decision, "Network/Deployment"), /VPN|ExpressRoute/);
});

check("Residency alone retains managed SaaS governance without inventing private endpoints", () => {
  const decision = decide(internal({ networkControls: ["regulated", "data_residency"] }));
  assert.equal(decision.overlays.some((item) => item.id === "managed_saas_governance"), true);
  assert.doesNotMatch(layer(decision, "Network/Deployment"), /Private Endpoint|VNet/);
});

check("APIM for an internal API does not imply an internet WAF", () => {
  const decision = decide(internal({
    channels: ["portal"],
    capabilities: ["operational_query", "custom_app"],
    dataSources: ["azure_sql"],
    runtimePreferences: ["custom_backend"],
    securityControls: ["entra_id", "apim"]
  }));
  assert.match(recommendation(decision), /API Management/);
  assert.doesNotMatch(decision.recommendedStack.join("\n"), /WAF|Front Door/);
});

check("Selecting only RLS does not confirm semantic-model readiness", () => {
  const question = QUESTIONS.find((item) => item.id === "semanticModelConfirmations");
  assert.ok(question?.apply);
  const input = question.apply(internal({ dataSources: ["powerbi_semantic_model"] }), ["rls_ols"]);
  assert.equal(input.semanticModelSecurityKnown, false);
  assert.match(decide(input).assumptions.join("\n"), /not yet confirmed/);
});

check("Stale semantic readiness is recomputed from explicit confirmations", () => {
  const input = normalizeDecisionInput(internal({
    dataSources: ["powerbi_semantic_model"],
    semanticModelSecurityKnown: true,
    semanticModelConfirmations: ["read"]
  }));
  assert.equal(input.semanticModelSecurityKnown, false);
});

check("Read, workspace and Prep for AI confirm readiness without optional RLS", () => {
  const question = QUESTIONS.find((item) => item.id === "semanticModelConfirmations");
  assert.ok(question?.apply);
  const input = question.apply(internal({ dataSources: ["powerbi_semantic_model"] }), ["read", "workspace", "prep_ai"]);
  assert.equal(input.semanticModelSecurityKnown, true);
});

check("Resolved document requirements stay visible for multi-selection and editing", () => {
  const question = QUESTIONS.find((item) => item.id === "advancedRagRequirements");
  assert.ok(question?.apply);
  const first = question.apply(internal({ dataSources: ["documents"] }), ["hybrid_search"]);
  assert.ok(applicableQuestions(first).some((item) => item.id === question.id));
  const second = question.apply(first, ["hybrid_search", "ocr_enrichment"]);
  assert.deepEqual(second.advancedRagRequirements, ["hybrid_search", "ocr_enrichment"]);
  assert.ok(applicableQuestions(second).some((item) => item.id === question.id));
});

const workflowInput = () => internal({
  capabilities: ["business_workflow"],
  dataSources: ["apis"],
  behaviors: ["workflow"]
});

check("Resolved workflow requirements stay visible after an action is selected", () => {
  const question = QUESTIONS.find((item) => item.id === "workflowExecution");
  assert.ok(question?.apply);
  const first = question.apply(workflowInput(), ["updates"]);
  assert.ok(applicableQuestions(first).some((item) => item.id === question.id));
  const second = question.apply(first, ["updates", "approval"]);
  assert.ok(second.behaviors.includes("record_update"));
  assert.ok(second.behaviors.includes("approval"));
});

check("Removing a workflow choice removes its previously derived action", () => {
  const question = QUESTIONS.find((item) => item.id === "workflowExecution");
  assert.ok(question?.apply);
  const first = question.apply(workflowInput(), ["updates", "approval"]);
  const second = normalizeDecisionInput(question.apply(first, ["approval"]));
  assert.equal(second.behaviors.includes("record_update"), false);
  assert.ok(second.behaviors.includes("approval"));
});

check("Clearing or unconfirming workflow execution does not retain stale write authority", () => {
  const question = QUESTIONS.find((item) => item.id === "workflowExecution");
  assert.ok(question?.apply);
  const first = question.apply(workflowInput(), ["updates"]);
  for (const value of [[], ["unknown"]]) {
    const next = normalizeDecisionInput(question.apply(first, value));
    assert.equal(next.writeBackConfirmed, undefined);
    assert.equal(isActionable(next), false);
    assert.ok(applicableQuestions(next).some((item) => item.id === question.id));
  }
});

check("Read-only multi-agent coordination never implies business write authority", () => {
  for (const writeBackConfirmed of [undefined, false]) {
    const input = normalizeDecisionInput(internal({
      channels: ["portal"],
      capabilities: ["operational_query", "multi_agent"],
      dataSources: ["azure_sql"],
      behaviors: ["read_only_query", "multi_agent"],
      runtimePreferences: ["foundry_agent_service"],
      writeBackConfirmed
    }));
    assert.equal(isActionable(input), false);
    assert.ok(input.behaviors.includes("multi_agent"));
    const decision = decide(input);
    assert.match(layer(decision, "Orchestration"), /multi-agent/i);
    assert.equal(decision.architectureLayers.find((item) => item.layer === "Orchestration")?.required, true);
    assert.match(layer(decision, "Integration"), /read-only/i);
    assert.doesNotMatch(recommendation(decision), /Controlled Azure SQL write|every write\/action/);
  }
});

check("Long-running read-only coordination survives an explicit no-write constraint", () => {
  const input = normalizeDecisionInput(internal({
    channels: ["portal"],
    dataSources: ["apis"],
    behaviors: ["read_only_query", "long_running_process"],
    runtimePreferences: ["custom_backend"],
    writeBackConfirmed: false
  }));
  assert.ok(input.behaviors.includes("long_running_process"));
  assert.equal(isActionable(input), false);
  const decision = decide(input);
  assert.match(layer(decision, "Orchestration"), /read-only coordination/i);
  assert.match(decision.recommendedStack.join("\n"), /Durable Functions|Logic Apps/);
});

check("Managed Copilot can coordinate read-only agents without adding a write stack", () => {
  const input = internal({
    capabilities: ["employee_assistant", "multi_agent"],
    dataSources: ["azure_sql"],
    behaviors: ["read_only_query", "multi_agent"],
    writeBackConfirmed: false
  });
  const decision = decide(input);
  assert.equal(decision.basePatternId, "copilot_studio_internal_assistant");
  assert.match(layer(decision, "Orchestration"), /Copilot Studio.*read-only/i);
  assert.doesNotMatch(recommendation(decision), /Controlled Azure SQL write|Azure AI Foundry|Agent Framework/);
});

check("Read-only coordination inferred from prose does not confirm writes", () => {
  const input = fromText("Employees use a portal with Foundry Agent Service to coordinate multiple agents for read-only queries over Azure SQL.");
  assert.equal(input.writeBackConfirmed, false);
  assert.ok(input.behaviors.includes("multi_agent"));
  assert.equal(isActionable(input), false);
});

check("Unrouted multi-agent intent remains clarification, not an invented runtime", () => {
  const decision = decide({ ...emptyInput(), capabilities: ["multi_agent"], behaviors: ["multi_agent"] });
  assert.equal(decision.basePatternId, "clarification_required");
  assert.doesNotMatch(recommendation(decision), /Durable Functions|Agent Framework|SQL write/);
});

check("A long-running workflow answer authorizes coordination, not business writes", () => {
  const question = QUESTIONS.find((item) => item.id === "workflowExecution");
  assert.ok(question?.apply);
  const input = normalizeDecisionInput(question.apply(workflowInput(), ["long_running"]));
  assert.equal(input.writeBackConfirmed, false);
  assert.ok(input.behaviors.includes("long_running_process"));
  assert.equal(isActionable(input), false);
  assert.equal(decide(input).architectureLayers.find((item) => item.layer === "Orchestration")?.required, true);
});

check("Copilot Studio Fabric guidance surfaces the Microsoft 365 Copilot channel limitation", () => {
  const decision = decide(internal({
    channels: ["teams", "m365_copilot"],
    capabilities: ["fabric_analytics"],
    dataSources: ["fabric_warehouse"],
    behaviors: ["analytics", "qa"],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "internal_fabric_permissions"
  }));
  assert.match(decision.riskFlags.join("\n"), /not currently supported.*Microsoft 365 Copilot/);
});

console.log(`Independent review regressions: ${passed}/${passed + failures.length} passed.`);
assert.equal(failures.length, 0, failures.join("\n"));
