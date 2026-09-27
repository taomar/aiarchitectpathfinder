import assert from "node:assert/strict";
import { decide } from "../lib/decision-engine";
import { categoryForDecision } from "../lib/pathfinder-category";
import { prepareDecisionInputForRecommendation } from "../lib/summary-intake";
import { emptyInput, type ArchitectureDecision, type DecisionInput } from "../lib/types";

function decisionText(decision: ArchitectureDecision) {
  return [
    decision.recommendedStack.join("\n"),
    decision.optionalAddOns.join("\n"),
    decision.rationale.join("\n"),
    decision.endToEndFlow.join("\n"),
    decision.architectureLayers.map((layer) => `${layer.layer}: ${layer.selections.join(" | ")}`).join("\n")
  ].join("\n");
}

function layer(decision: ArchitectureDecision, name: string) {
  return decision.architectureLayers.find((item) => item.layer === name)?.selections.join("\n") ?? "";
}

function assertIncludes(name: string, haystack: string, needle: string) {
  assert.match(haystack, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${name}: expected ${needle}`);
}

function assertExcludes(name: string, haystack: string, needle: string) {
  assert.doesNotMatch(haystack, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${name}: should not include ${needle}`);
}

function check(name: string, input: DecisionInput, expectedBase: string, expectedCategory: string, includes: string[], excludes: string[] = []) {
  const decision = decide(input);
  const category = categoryForDecision(decision).category;
  const text = decisionText(decision);
  assert.equal(decision.basePatternId, expectedBase, `${name}: base pattern`);
  assert.equal(category, expectedCategory, `${name}: solution family`);
  for (const item of includes) assertIncludes(name, text, item);
  for (const item of excludes) assertExcludes(name, text, item);
  return decision;
}

const textCopilotFabric = prepareDecisionInputForRecommendation({
  ...emptyInput(),
  summary: "Internal employees use Teams to ask read-only sales performance questions over a governed Power BI semantic model in Fabric.",
  directTextRecommendation: true
});
const textCopilotFabricDecision = check(
  "text shortcut - Copilot Fabric",
  textCopilotFabric,
  "copilot_studio_fabric_data_agent",
  "Copilot Studio",
  ["Copilot Studio", "Microsoft Fabric Data Agent", "Power BI Semantic Model"],
  ["Azure AI Foundry Agent Service", "Microsoft 365 Agents SDK"]
);
assert.equal(textCopilotFabricDecision.confidence, "medium", "text shortcut should cap confidence at medium");

check(
  "text shortcut - Foundry Fabric",
  prepareDecisionInputForRecommendation({
    ...emptyInput(),
    summary: "B2B partners use a portal with Foundry Agent Service tools to ask governed analytics questions over a Fabric Lakehouse.",
    directTextRecommendation: true
  }),
  "azure_ai_foundry_app",
  "AI Foundry",
  ["Azure AI Foundry Agent Service", "Microsoft Fabric Data Agent", "Fabric Lakehouse"],
  ["Microsoft 365 Agents SDK"]
);

const textHybridFabricDecision = check(
  "text shortcut - Hybrid Fabric",
  prepareDecisionInputForRecommendation({
    ...emptyInput(),
    summary: "Internal employees use Teams with Copilot Studio as the experience, Foundry Agent Service tools, and evaluation tracing over Fabric Lakehouse analytics.",
    directTextRecommendation: true
  }),
  "azure_ai_foundry_app",
  "Hybrid Copilot Studio + AI Foundry",
  ["Copilot Studio", "Azure AI Foundry Agent Service", "Microsoft Fabric Data Agent", "Fabric Lakehouse"],
  ["Microsoft 365 Agents SDK"]
);
assertIncludes("text shortcut - Hybrid Fabric", layer(textHybridFabricDecision, "Experience"), "Copilot Studio agent");

check(
  "text shortcut - Claude Grok and provider models",
  prepareDecisionInputForRecommendation({
    ...emptyInput(),
    summary: "A customer portal needs Claude Opus for reasoning, Grok for classification, and Mistral from the Foundry catalog over business APIs.",
    directTextRecommendation: true
  }),
  "azure_ai_foundry_app",
  "AI Foundry",
  ["Claude / Anthropic model", "Grok / xAI model", "Azure OpenAI, Azure-sold Foundry, or provider/open model", "Azure AI Foundry"],
  ["Microsoft 365 Agents SDK"]
);

check(
  "full wizard - Copilot Fabric",
  {
    summary: "Executives use Teams to ask sales performance questions over a governed Power BI semantic model in Fabric.",
    users: ["internal_employees"],
    channels: ["teams", "m365"],
    capabilities: ["fabric_analytics"],
    dataSources: ["powerbi_semantic_model"],
    behaviors: ["analytics", "qa", "read_only_query"],
    lifecycleControls: [],
    runtimePreferences: ["copilot_studio"],
    securityControls: ["entra_id", "rbac", "rls_ols"],
    networkControls: ["public"],
    modelStrategy: [],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "internal_fabric_permissions",
    semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"],
    semanticModelSecurityKnown: true
  },
  "copilot_studio_fabric_data_agent",
  "Copilot Studio",
  ["Copilot Studio", "Microsoft Fabric Data Agent", "Power BI Semantic Model"],
  ["Azure AI Foundry Agent Service", "Microsoft 365 Agents SDK"]
);

check(
  "full wizard - Foundry Fabric",
  {
    summary: "B2B partners use a portal to ask governed analytics questions over a Fabric Lakehouse. Partners have B2B Fabric access and the runtime should use Foundry Agent Service tools.",
    users: ["partners"],
    channels: ["portal"],
    capabilities: ["custom_app", "fabric_analytics"],
    dataSources: ["fabric_lakehouse"],
    behaviors: ["qa", "analytics", "read_only_query"],
    lifecycleControls: [],
    runtimePreferences: ["foundry_agent_service"],
    securityControls: ["entra_external_id", "apim", "rbac"],
    networkControls: ["public"],
    modelStrategy: [],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "b2b_governed_fabric_access",
    externalAccessConfirmed: true
  },
  "azure_ai_foundry_app",
  "AI Foundry",
  ["Azure AI Foundry Agent Service", "Microsoft Fabric Data Agent", "Fabric Lakehouse", "Entra External ID", "API Management"],
  ["Microsoft 365 Agents SDK"]
);

const fullHybridFabric = check(
  "full wizard - Hybrid Fabric",
  {
    summary: "Internal employees use Teams with Copilot Studio as the experience and Foundry Agent Service tools over Fabric Lakehouse analytics.",
    users: ["internal_employees"],
    channels: ["teams"],
    capabilities: ["fabric_analytics"],
    dataSources: ["fabric_lakehouse"],
    behaviors: ["qa", "analytics", "read_only_query"],
    lifecycleControls: ["evaluation", "tracing"],
    runtimePreferences: ["copilot_studio", "foundry_agent_service"],
    securityControls: ["entra_id", "rbac"],
    networkControls: ["public"],
    modelStrategy: [],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "internal_fabric_permissions"
  },
  "azure_ai_foundry_app",
  "Hybrid Copilot Studio + AI Foundry",
  ["Copilot Studio", "Azure AI Foundry Agent Service", "Microsoft Fabric Data Agent", "Fabric Lakehouse"],
  ["Microsoft 365 Agents SDK"]
);
assertIncludes("full wizard - Hybrid Fabric", layer(fullHybridFabric, "Experience"), "Copilot Studio agent");

const fullHybridGrok = check(
  "full wizard - Grok with Copilot experience",
  {
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
  },
  "copilot_studio_internal_assistant",
  "Hybrid Copilot Studio + AI Foundry",
  ["Copilot Studio", "Grok / xAI model", "Azure AI Foundry"],
  ["Microsoft 365 Agents SDK"]
);
assertIncludes("full wizard - Grok with Copilot experience", layer(fullHybridGrok, "Experience"), "Copilot Studio agent");

console.log("V4.5 text shortcut and full wizard scenario checks passed.");
