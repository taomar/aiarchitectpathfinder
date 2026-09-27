/* User-supplied acceptance tests for three reference architectures.
 * Run with: npx tsx scripts/test-user-cases.ts
 */
import { decide } from "../lib/decision-engine";
import type { DecisionInput, ArchitectureDecision } from "../lib/types";
import { emptyInput } from "../lib/types";

type Expected = {
  basePatternIdOneOf: string[];
  overlayIdsAnyOf?: string[]; // overlay ids that MUST appear (each as one of the listed)
  stackMustContainAnyOf?: string[][]; // for each group, at least one match must appear
  stackMustNotContainAny?: string[];
};

type Case = {
  title: string;
  input: DecisionInput;
  expect: Expected;
};

const cases: Case[] = [
  {
    title: "UC1 — Internal Fabric Analytics Assistant",
    input: {
      ...emptyInput(),
      summary:
        "Internal business users need to ask natural-language questions over enterprise sales and operations data stored in Fabric and Power BI semantic models.",
      users: ["internal_employees", "admins"],
      channels: ["teams", "m365"],
      capabilities: ["fabric_analytics", "employee_assistant"],
      dataSources: ["fabric_onelake", "fabric_warehouse", "powerbi_semantic_model"],
      behaviors: ["qa", "analytics", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "rls_ols", "audit"],
      networkControls: ["public"]
    },
    expect: {
      basePatternIdOneOf: ["copilot_studio_fabric_data_agent"],
      overlayIdsAnyOf: ["semantic_model_security"],
      stackMustContainAnyOf: [
        ["Copilot Studio"],
        ["Fabric Data Agent"],
        ["Power BI Semantic Model"],
        ["Entra ID"]
      ],
      stackMustNotContainAny: [
        "Microsoft 365 Agents SDK",
        "Azure AI Foundry",
        "Agent Framework",
        "Semantic Kernel"
      ]
    }
  },
  {
    title: "UC2 — External Customer Transactional Service Agent",
    input: {
      ...emptyInput(),
      summary:
        "External customers need a web and mobile assistant that can check order status, update delivery preferences, create support cases, and submit refund requests through existing business APIs.",
      users: ["external_customers"],
      channels: ["web", "mobile", "portal"],
      capabilities: ["business_workflow", "transaction", "record_update", "custom_app"],
      dataSources: ["apis", "azure_sql", "erp_crm"],
      behaviors: ["read_only_query", "record_update", "workflow", "approval", "transaction"],
      lifecycleControls: ["monitoring", "tracing", "safety_testing"],
      runtimePreferences: ["custom_backend", "functions"],
      securityControls: [
        "entra_external_id",
        "apim",
        "waf",
        "audit",
        "managed_identity",
        "key_vault"
      ],
      networkControls: ["public"]
    },
    expect: {
      basePatternIdOneOf: ["external_ai_app", "business_action_agent"],
      overlayIdsAnyOf: ["api_management_edge"],
      stackMustContainAnyOf: [
        ["Custom Backend", "Web app", "Web App"],
        ["Azure AI Foundry"],
        ["APIM", "API Management"],
        ["WAF", "Front Door"],
        ["Entra External ID"],
        ["Managed Identity"],
        ["Key Vault"],
        ["Functions", "Logic Apps", "Durable"]
      ],
      stackMustNotContainAny: ["Microsoft 365 Agents SDK", "Fabric Data Agent"]
    }
  },
  {
    title: "UC3 — Internal Secure Document RAG Portal",
    input: {
      ...emptyInput(),
      summary:
        "Internal legal and compliance teams need a secure portal to ask questions over confidential policies, contracts, and regulatory documents stored in SharePoint and Blob Storage. The solution must support private connectivity and evaluation of answer quality.",
      users: ["internal_employees", "admins"],
      channels: ["portal", "web"],
      capabilities: ["document_rag", "employee_assistant"],
      dataSources: ["sharepoint", "documents", "blob_storage"],
      behaviors: ["qa", "retrieval", "summarization"],
      advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
      lifecycleControls: ["evaluation", "tracing", "monitoring", "governance"],
      runtimePreferences: ["custom_backend", "app_service"],
      securityControls: [
        "entra_id",
        "rbac",
        "dlp",
        "audit",
        "key_vault",
        "managed_identity",
        "purview"
      ],
      networkControls: [
        "vnet",
        "private_link",
        "private_endpoint",
        "no_public_endpoint",
        "regulated"
      ]
    },
    expect: {
      basePatternIdOneOf: ["document_rag_agent", "internal_rag_portal"],
      overlayIdsAnyOf: ["hybrid_private_deployment"],
      stackMustContainAnyOf: [
        ["Custom Backend"],
        ["Azure AI Search"],
        ["Azure AI Foundry"],
        ["SharePoint"],
        ["Blob"],
        ["Entra ID"],
        ["Key Vault"],
        ["Managed Identity"],
        ["Private Endpoint", "Private Link"],
        ["VNet"]
      ],
      stackMustNotContainAny: ["Fabric Data Agent", "Microsoft 365 Agents SDK"]
    }
  }
];

let failures = 0;
function ok(b: boolean, msg: string) {
  console.log(`  ${b ? "PASS" : "FAIL"}  ${msg}`);
  if (!b) failures++;
}

function stackContains(stack: string[], needles: string[]) {
  return needles.some((n) => stack.some((s) => s.toLowerCase().includes(n.toLowerCase())));
}

for (const c of cases) {
  console.log(`\n=== ${c.title} ===`);
  const d: ArchitectureDecision = decide(c.input);
  const overlayIds = d.overlays.map((o) => o.id);
  console.log(`   pattern   : ${d.basePatternId} (${d.basePatternName})`);
  console.log(`   confidence: ${d.confidence}`);
  console.log(`   overlays  : ${overlayIds.join(", ") || "-"}`);
  console.log(`   stack     :`);
  for (const s of d.recommendedStack) console.log(`      - ${s}`);
  console.log(`   zeroTrust : ${d.zeroTrust.applicable ? "ENFORCED" : "baseline"}`);

  ok(
    c.expect.basePatternIdOneOf.includes(d.basePatternId),
    `basePatternId in [${c.expect.basePatternIdOneOf.join(",")}]`
  );
  if (c.expect.overlayIdsAnyOf) {
    for (const id of c.expect.overlayIdsAnyOf) {
      ok(overlayIds.includes(id), `overlays contain "${id}"`);
    }
  }
  if (c.expect.stackMustContainAnyOf) {
    for (const group of c.expect.stackMustContainAnyOf) {
      ok(
        stackContains(d.recommendedStack, group),
        `stack contains any of [${group.join(" | ")}]`
      );
    }
  }
  if (c.expect.stackMustNotContainAny) {
    for (const n of c.expect.stackMustNotContainAny) {
      ok(
        !d.recommendedStack.some((s) => s.toLowerCase().includes(n.toLowerCase())),
        `stack does NOT contain "${n}"`
      );
    }
  }
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
