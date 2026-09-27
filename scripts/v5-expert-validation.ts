/**
 * v5 expert validation harness (temporary, not committed).
 *
 * A fresh set of 16 diverse scenarios — DISTINCT from the 15 landing examples — each with an
 * expert-judged expected solution family + base pattern + key architectural expectations.
 * The harness runs the deterministic engine and reports PASS/FAIL against that judgment so a
 * human can see, per scenario, whether the tool's output is right or wrong.
 */
import { decide } from "../lib/decision-engine";
import { categoryForDecision } from "../lib/pathfinder-category";
import { normalizeDecisionInput } from "../lib/adaptive-wizard";
import { prepareDecisionInputForRecommendation } from "../lib/summary-intake";
import { emptyInput, type DecisionInput } from "../lib/types";

type Expect = {
  id: string;
  why: string;                     // expert reasoning for the expected outcome
  family: "Copilot Studio" | "AI Foundry" | "Hybrid Copilot Studio + AI Foundry" | "Needs Clarification";
  base?: string;                   // expected base pattern id (when unambiguous)
  baseOneOf?: string[];            // acceptable base patterns (when a tie-break is reasonable)
  mustInclude?: string[];          // substrings that must appear somewhere in the decision text
  mustExclude?: string[];          // substrings that must NOT appear
  net?: RegExp;                    // expected Network/Deployment posture
  confidence?: "high" | "medium" | "low";
  input: Partial<DecisionInput>;
};

const S: Expect[] = [
  {
    id: "personal-productivity-m365",
    why: "Pure personal productivity over the user's own M365 content = Microsoft 365 Copilot, no custom build.",
    family: "Copilot Studio",
    baseOneOf: ["m365_copilot_productivity"],
    mustExclude: ["Azure AI Search", "Fabric Data Agent", "Custom Backend"],
    input: { users: ["internal_employees"], channels: ["m365_copilot"], capabilities: ["personal_productivity"], dataSources: ["m365_graph"], behaviors: ["qa", "summarization"], lifecycleControls: ["none"], runtimePreferences: [], securityControls: ["entra_id"], networkControls: ["public"] }
  },
  {
    id: "internal-sharepoint-qa",
    why: "Internal Teams Q&A over SharePoint/policy docs with native knowledge = Copilot Studio internal assistant.",
    family: "Copilot Studio",
    base: "copilot_studio_internal_assistant",
    mustExclude: ["Azure AI Search"],
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["employee_assistant"], dataSources: ["sharepoint", "documents"], behaviors: ["qa", "retrieval"], lifecycleControls: ["none"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id"], networkControls: ["public"], advancedRagRequirements: ["none"] }
  },
  {
    id: "internal-fabric-analytics-teams",
    why: "Internal Teams read-only analytics over Fabric = Copilot Studio + Fabric Data Agent.",
    family: "Copilot Studio",
    base: "copilot_studio_fabric_data_agent",
    mustInclude: ["Fabric Data Agent"],
    mustExclude: ["Azure AI Search"],
    input: { users: ["internal_employees"], channels: ["teams", "m365"], capabilities: ["fabric_analytics"], dataSources: ["fabric_lakehouse"], behaviors: ["analytics", "qa", "read_only_query"], lifecycleControls: ["monitoring"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id"], networkControls: ["public"] }
  },
  {
    id: "internal-sql-readonly",
    why: "Internal Teams read-only lookups over Azure SQL = Copilot Studio with a governed read-only connector (NOT direct LLM-to-DB).",
    family: "Copilot Studio",
    base: "copilot_studio_internal_assistant",
    mustInclude: ["Governed read-only", "Direct LLM-to-database"],
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["operational_query"], dataSources: ["azure_sql"], behaviors: ["qa", "read_only_query"], lifecycleControls: ["none"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac", "audit"], networkControls: ["public"] }
  },
  {
    id: "write-back-dataverse-teams",
    why: "Confirmed record write-back from Teams = deterministic Business Action agent (Copilot Studio experience + Power Automate, never direct LLM write).",
    family: "Copilot Studio",
    base: "business_action_agent",
    mustInclude: ["Power Automate", "Direct LLM-to-system-of-record"],
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["employee_assistant", "record_update"], dataSources: ["dataverse"], behaviors: ["qa", "record_update"], writeBackConfirmed: true, lifecycleControls: ["monitoring"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac", "audit", "managed_identity"], networkControls: ["public"] }
  },
  {
    id: "advanced-rag-internal-foundry",
    why: "Internal, custom backend, millions of docs + hybrid search = advanced Document RAG on AI Foundry with Azure AI Search.",
    family: "AI Foundry",
    baseOneOf: ["document_rag_agent", "azure_ai_foundry_app"],
    mustInclude: ["Azure AI Search"],
    input: { users: ["internal_employees"], channels: ["web"], capabilities: ["document_rag", "custom_app"], dataSources: ["documents", "blob_storage"], behaviors: ["qa", "retrieval"], lifecycleControls: ["evaluation", "tracing"], runtimePreferences: ["foundry_agent_service", "custom_backend"], securityControls: ["entra_id", "managed_identity"], networkControls: ["public"], advancedRagRequirements: ["hybrid_search", "large_scale_indexing", "custom_chunking"] }
  },
  {
    id: "external-customer-mobile-rag",
    why: "External customers on a public mobile app over documents = External AI App (Foundry) with APIM/WAF edge.",
    family: "AI Foundry",
    baseOneOf: ["external_ai_app", "azure_ai_foundry_app", "document_rag_agent"],
    mustInclude: ["Entra External ID"],
    input: { users: ["external_customers"], channels: ["mobile"], capabilities: ["document_rag", "custom_app"], dataSources: ["documents", "blob_storage", "apis"], behaviors: ["qa", "retrieval"], lifecycleControls: ["evaluation", "monitoring"], runtimePreferences: ["foundry_agent_service"], securityControls: ["entra_external_id", "apim", "waf", "managed_identity"], networkControls: ["public"], externalAccessConfirmed: true, advancedRagRequirements: ["hybrid_search", "large_scale_indexing"] }
  },
  {
    id: "citizen-private-portal",
    why: "Public citizens on a private/regulated web portal = External AI App (Foundry) with private networking + WAF.",
    family: "AI Foundry",
    baseOneOf: ["external_ai_app", "azure_ai_foundry_app", "document_rag_agent"],
    net: /private|no public endpoint|residency|regulated/i,
    input: { users: ["citizens"], channels: ["web", "portal"], capabilities: ["document_rag", "custom_app"], dataSources: ["documents", "blob_storage"], behaviors: ["qa", "retrieval"], lifecycleControls: ["evaluation", "safety_testing", "governance"], runtimePreferences: ["foundry_agent_service"], securityControls: ["entra_external_id", "apim", "waf", "managed_identity"], networkControls: ["private_endpoint", "no_public_endpoint", "data_residency", "regulated"], externalAccessConfirmed: true, advancedRagRequirements: ["hybrid_search", "large_scale_indexing"] }
  },
  {
    id: "fine-tuned-model-ops-foundry",
    why: "Internal app on a fine-tuned model + Azure ML endpoint + full lifecycle = AI Foundry with model operations.",
    family: "AI Foundry",
    base: "azure_ai_foundry_app",
    mustInclude: ["Fine-tuned Azure OpenAI", "Azure Machine Learning"],
    input: { users: ["internal_employees"], channels: ["portal"], capabilities: ["custom_app", "operational_query"], dataSources: ["azure_sql", "documents"], behaviors: ["summarization", "recommendation", "read_only_query"], lifecycleControls: ["evaluation", "tracing", "model_versioning", "governance"], modelStrategy: ["fine_tuned_azure_openai", "azure_ml_endpoint"], runtimePreferences: ["foundry_agent_service"], securityControls: ["entra_id", "rbac", "apim", "audit", "key_vault"], networkControls: ["private_endpoint"], advancedRagRequirements: ["none"] }
  },
  {
    id: "copilot-plus-azureml-hybrid",
    why: "Copilot Studio experience in Teams that calls an Azure ML endpoint = Hybrid (Copilot front, Foundry/AML behind).",
    family: "Hybrid Copilot Studio + AI Foundry",
    base: "copilot_studio_internal_assistant",
    mustInclude: ["Azure Machine Learning"],
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["employee_assistant", "operational_query"], dataSources: ["dataverse"], behaviors: ["qa", "read_only_query", "recommendation"], lifecycleControls: ["monitoring"], modelStrategy: ["azure_ml_endpoint"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac"], networkControls: ["public"] }
  },
  {
    id: "onprem-hybrid-foundry",
    why: "Internal custom backend reaching on-prem systems over ExpressRoute = AI Foundry with hybrid/private networking.",
    family: "AI Foundry",
    baseOneOf: ["azure_ai_foundry_app", "business_action_agent", "custom_ai_app"],
    net: /vnet|private link|vpn|expressroute/i,
    input: { users: ["internal_employees"], channels: ["portal"], capabilities: ["custom_app", "operational_query"], dataSources: ["on_prem", "azure_sql"], behaviors: ["summarization", "read_only_query"], lifecycleControls: ["evaluation", "monitoring"], runtimePreferences: ["foundry_agent_service", "custom_backend"], securityControls: ["entra_id", "managed_identity", "key_vault"], networkControls: ["expressroute", "private_link", "on_prem_connectivity"] }
  },
  {
    id: "multi-agent-orchestration",
    why: "Multi-agent coordination with actions = deterministic action architecture with an agent framework / orchestration.",
    family: "AI Foundry",
    baseOneOf: ["business_action_agent", "azure_ai_foundry_app"],
    mustInclude: ["multi-agent"],
    input: { users: ["internal_employees"], channels: ["portal"], capabilities: ["custom_app", "multi_agent", "transaction"], dataSources: ["apis", "erp_crm"], behaviors: ["multi_agent", "transaction", "workflow"], writeBackConfirmed: true, lifecycleControls: ["evaluation", "tracing", "monitoring"], runtimePreferences: ["foundry_agent_service"], securityControls: ["entra_id", "apim", "audit", "managed_identity"], networkControls: ["private_endpoint"] }
  },
  {
    id: "readonly-override-negation",
    why: "Record-update capability explicitly turned OFF (writeBackConfirmed=false) = read-only internal assistant, not an action agent (Fix 10).",
    family: "Copilot Studio",
    base: "copilot_studio_internal_assistant",
    mustExclude: ["Power Automate Approvals"],
    confidence: "high",
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["employee_assistant", "record_update"], dataSources: ["azure_sql"], behaviors: ["qa", "record_update"], writeBackConfirmed: false, lifecycleControls: ["none"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac"], networkControls: ["public"] }
  },
  {
    id: "regulated-copilot-saas",
    why: "Managed Copilot Studio with regulated/data-residency needs = SaaS governance (tenant region + Purview/DLP), NOT a customer VNet (Fix 7).",
    family: "Copilot Studio",
    base: "copilot_studio_internal_assistant",
    net: /saas|tenant region|data residency/i,
    mustExclude: ["VNet integration", "Private Link / Private Endpoint"],
    input: { users: ["internal_employees"], channels: ["teams", "m365"], capabilities: ["employee_assistant"], dataSources: ["sharepoint", "documents"], behaviors: ["qa", "retrieval"], lifecycleControls: ["monitoring", "governance"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac", "dlp", "purview", "audit"], networkControls: ["regulated", "data_residency"], advancedRagRequirements: ["none"] }
  },
  {
    id: "skip-all-clarification",
    why: "No audience, no channel, no routing signal = Needs Clarification, not a confident custom app (Fix 9).",
    family: "Needs Clarification",
    base: "clarification_required",
    input: {}
  },
  {
    id: "fabric-writeback-not-data-agent",
    why: "Fabric grounding BUT a confirmed write-back = action agent, NOT the read-only Fabric Data Agent (README rule #1).",
    family: "Copilot Studio",
    base: "business_action_agent",
    mustExclude: [],
    input: { users: ["internal_employees"], channels: ["teams"], capabilities: ["fabric_analytics", "record_update"], dataSources: ["fabric_lakehouse"], behaviors: ["analytics", "qa", "record_update"], writeBackConfirmed: true, lifecycleControls: ["monitoring"], runtimePreferences: ["copilot_studio"], securityControls: ["entra_id", "rbac", "audit", "managed_identity"], networkControls: ["public"] }
  }
];

function decisionText(d: ReturnType<typeof decide>): string {
  return [
    d.recommendedStack.join("\n"),
    d.optionalAddOns.join("\n"),
    d.rationale.join("\n"),
    d.blockedComponents.join("\n"),
    d.architectureLayers.map((l) => `${l.layer}: ${l.selections.join(" | ")}`).join("\n")
  ].join("\n");
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const t of S) {
  const input = prepareDecisionInputForRecommendation(normalizeDecisionInput({ ...emptyInput(), ...t.input }));
  const d = decide(input);
  const cat = categoryForDecision(d).category;
  const text = decisionText(d);
  const netLine = d.architectureLayers.find((l) => l.layer === "Network/Deployment")?.selections.join(" | ") ?? "";

  const problems: string[] = [];
  if (cat !== t.family) problems.push(`family: got "${cat}", expected "${t.family}"`);
  if (t.base && d.basePatternId !== t.base) problems.push(`base: got "${d.basePatternId}", expected "${t.base}"`);
  if (t.baseOneOf && !t.baseOneOf.includes(d.basePatternId)) problems.push(`base: got "${d.basePatternId}", expected one of [${t.baseOneOf.join(", ")}]`);
  for (const inc of t.mustInclude ?? []) if (!new RegExp(inc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) problems.push(`missing "${inc}"`);
  for (const exc of t.mustExclude ?? []) if (new RegExp(exc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) problems.push(`should NOT contain "${exc}"`);
  if (t.net && !t.net.test(netLine)) problems.push(`network: "${netLine}" did not match ${t.net}`);
  if (t.confidence && d.confidence !== t.confidence) problems.push(`confidence: got "${d.confidence}", expected "${t.confidence}"`);

  if (problems.length === 0) {
    pass++;
    console.log(`✓ ${t.id.padEnd(34)} ${d.basePatternId.padEnd(34)} ${cat} [${d.confidence}]`);
  } else {
    fail++;
    console.log(`✗ ${t.id.padEnd(34)} ${d.basePatternId.padEnd(34)} ${cat} [${d.confidence}]`);
    for (const p of problems) console.log(`     - ${p}`);
    failures.push(`${t.id}: ${problems.join("; ")}  (expert note: ${t.why})`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(`RESULT: ${pass}/${S.length} match expert judgment, ${fail} divergence(s)`);
if (failures.length) {
  console.log("\nDivergences for human review:");
  failures.forEach((f) => console.log(`  • ${f}`));
}
