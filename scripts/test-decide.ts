/* Smoke-test the deterministic decision engine across representative scenarios.
 * Run with: npx tsx scripts/test-decide.ts
 */
import { decide } from "../lib/decision-engine";
import { emptyInput, DecisionInput } from "../lib/types";

type Case = {
  name: string;
  input: DecisionInput;
  expect: {
    basePatternIdOneOf?: string[];
    mustContainStack?: string[];
    mustNotContainStack?: string[];
    zeroTrustApplicable?: boolean;
    zeroTrustMustContain?: string[];
  };
};

const base = (): DecisionInput => emptyInput();

const cases: Case[] = [
  {
    name: "1. Internal Teams + Fabric + read-only analytics (Copilot Studio + Fabric DA)",
    input: {
      ...base(),
      summary: "Internal sales analytics chatbot in Teams.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["fabric_analytics"],
      dataSources: ["fabric_onelake"],
      behaviors: ["read_only_query", "analytics"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id"],
      networkControls: ["public"],
      externalAccessConfirmed: false,
      m365ExtensibilityRequired: false
    },
    expect: {
      mustNotContainStack: ["Microsoft 365 Agents SDK"],
      zeroTrustApplicable: false
    }
  },
  {
    name: "2. External web chatbot for customers, private+regulated network -> ZT enforced",
    input: {
      ...base(),
      summary: "Customer-facing web chatbot for an insurance portal.",
      users: ["external_customers"],
      channels: ["web"],
      capabilities: ["document_rag"],
      dataSources: ["documents"],
      behaviors: ["qa", "summarization"],
      lifecycleControls: ["monitoring", "evaluation"],
      runtimePreferences: ["custom_backend"],
      securityControls: [
        "entra_external_id",
        "apim",
        "waf",
        "managed_identity",
        "key_vault",
        "dlp"
      ],
      networkControls: ["vnet", "private_link", "regulated"],
      externalAccessConfirmed: true,
      m365ExtensibilityRequired: false
    },
    expect: {
      zeroTrustApplicable: true,
      zeroTrustMustContain: ["Defender"]
    }
  },
  {
    name: "3. Internal write-back agent with approvals -> orchestration + ZT enforced",
    input: {
      ...base(),
      summary: "Agent that updates CRM records after manager approval.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["record_update", "approval"],
      dataSources: ["dataverse", "apis"],
      behaviors: ["record_update", "approval", "workflow"],
      lifecycleControls: ["monitoring", "evaluation"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_id", "managed_identity", "audit"],
      networkControls: ["public"],
      workflowExecution: ["logic_apps"],
      externalAccessConfirmed: false,
      m365ExtensibilityRequired: false
    },
    expect: {
      zeroTrustApplicable: true,
      zeroTrustMustContain: ["Human-in-the-loop", "Immutable audit trail"]
    }
  },
  {
    name: "4. Personal productivity in M365 Copilot -> no Foundry/SDK, no ZT enforcement",
    input: {
      ...base(),
      summary: "Help employees draft and summarize content in M365 Copilot.",
      users: ["internal_employees"],
      channels: ["m365_copilot"],
      capabilities: ["personal_productivity"],
      dataSources: ["m365_graph"],
      behaviors: ["summarization", "read_only_query"],
      lifecycleControls: ["none"],
      runtimePreferences: ["none"],
      securityControls: ["entra_id"],
      networkControls: ["public"],
      externalAccessConfirmed: false,
      m365ExtensibilityRequired: false
    },
    expect: {
      mustNotContainStack: ["Azure AI Foundry", "Microsoft 365 Agents SDK"],
      zeroTrustApplicable: false
    }
  },
  {
    name: "5. Power BI semantic model + RLS -> ZT enforced with RLS/OLS",
    input: {
      ...base(),
      summary: "Self-service analytics agent grounded in Power BI semantic model.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["fabric_analytics"],
      dataSources: ["powerbi_semantic_model"],
      behaviors: ["read_only_query", "analytics"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rls_ols"],
      networkControls: ["public"],
      semanticModelConfirmations: [
        "read_permission",
        "workspace_permissions",
        "prep_for_ai"
      ],
      externalAccessConfirmed: false,
      m365ExtensibilityRequired: false
    },
    expect: {
      zeroTrustApplicable: true,
      zeroTrustMustContain: ["Defender"]
    }
  }
];

let failures = 0;
function ok(b: boolean, msg: string) {
  console.log(`${b ? "  PASS" : "  FAIL"} ${msg}`);
  if (!b) failures++;
}

for (const c of cases) {
  console.log(`\n=== ${c.name} ===`);
  const d = decide(c.input);
  console.log(`   pattern   : ${d.basePatternId} (${d.basePatternName})`);
  console.log(`   confidence: ${d.confidence}`);
  console.log(`   stack     : ${d.recommendedStack.join(", ") || "-"}`);
  console.log(`   zeroTrust : ${d.zeroTrust.applicable ? "ENFORCED" : "baseline"}`);
  console.log(`   ZT reason : ${d.zeroTrust.rationale}`);
  if (d.zeroTrust.controls.length) {
    console.log(`   ZT controls (${d.zeroTrust.controls.length}):`);
    for (const cc of d.zeroTrust.controls) console.log(`      - ${cc}`);
  }
  if (d.riskFlags.length) console.log(`   risks     : ${d.riskFlags.join(" | ")}`);

  if (c.expect.basePatternIdOneOf) {
    ok(
      c.expect.basePatternIdOneOf.includes(d.basePatternId),
      `basePatternId in [${c.expect.basePatternIdOneOf.join(",")}]`
    );
  }
  if (c.expect.mustContainStack) {
    for (const s of c.expect.mustContainStack) {
      ok(
        d.recommendedStack.some((x) => x.toLowerCase().includes(s.toLowerCase())),
        `stack contains "${s}"`
      );
    }
  }
  if (c.expect.mustNotContainStack) {
    for (const s of c.expect.mustNotContainStack) {
      ok(
        !d.recommendedStack.some((x) => x.toLowerCase().includes(s.toLowerCase())),
        `stack does NOT contain "${s}"`
      );
    }
  }
  if (c.expect.zeroTrustApplicable !== undefined) {
    ok(
      d.zeroTrust.applicable === c.expect.zeroTrustApplicable,
      `zeroTrust.applicable === ${c.expect.zeroTrustApplicable}`
    );
  }
  if (c.expect.zeroTrustMustContain) {
    for (const s of c.expect.zeroTrustMustContain) {
      ok(
        d.zeroTrust.controls.some((x) => x.toLowerCase().includes(s.toLowerCase())),
        `ZT controls contain "${s}"`
      );
    }
  }
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
