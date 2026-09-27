import assert from "node:assert/strict";
import { aiRoleSettings, requestAiJson } from "../lib/ai-runtime";
import { architectureIssues, tieBreak } from "../lib/azure-openai";
import { eliminateOptions } from "../lib/wizard-filter";
import { decide } from "../lib/decision-engine";
import { emptyInput, type TieBreakResponse, type WizardQuestion } from "../lib/types";
import { applicableQuestions } from "../lib/questions";
import { displayPatternName } from "../lib/pathfinder-category";
import { isActionable, requiresOrchestration, wantsFabricDataAgent } from "../lib/rules";

const env = { ...process.env };
const originalFetch = globalThis.fetch;
const requests: Array<Record<string, unknown>> = [];
let reply: (body: Record<string, unknown>) => unknown;
let finishReason = "stop";
let status = 200;

function fixture(summary: string) {
  const input = {
    ...emptyInput(), summary,
    users: ["internal_employees" as const], channels: ["teams" as const],
    capabilities: ["employee_assistant" as const], dataSources: ["sharepoint" as const],
    behaviors: ["qa" as const], runtimePreferences: ["copilot_studio" as const],
    advancedRagRequirements: ["none" as const], writeBackConfirmed: false
  };
  const decision = decide(input);
  const report: TieBreakResponse = {
    ...decision,
    recommendedBasePatternId: decision.basePatternId,
    recommendedOverlays: decision.overlays.map(item => item.id),
    solutionType: displayPatternName(decision), displayPatternName: displayPatternName(decision),
    finalRecommendation: "AI-authored recommendation for the employee handbook.",
    useCaseTitle: "Employee handbook assistant",
    useCaseSummary: summary,
    proposedArchitectureSummary: "AI-authored customer architecture study. The solution answers handbook questions through the selected managed experience. Access is limited by the selected identity and permissions.",
    rationale: ["AI explains why managed knowledge fits this workload."],
    endToEndFlow: ["Employees ask a question.", "The managed experience retrieves permitted handbook content.", "The assistant returns an answer."],
    reasoning: [], questionsToAskNext: [], mustNotInclude: []
  };
  return { input, decision, report };
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test", AZURE_OPENAI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENDPOINT: "https://test-resource.openai.azure.com/",
    PATHFINDER_WIZARD_DEPLOYMENT: "gpt-5.6-terra",
    PATHFINDER_ARCHITECTURE_DEPLOYMENT: "gpt-5.6-sol",
    PATHFINDER_JUDGE_DEPLOYMENT: "gpt-5.6-sol",
    PATHFINDER_JUDGE_REASONING_EFFORT: "medium",
    AZURE_OPENAI_API_KEY: "unit-test-only",
    PATHFINDER_APIM_BASE_URL: "https://test-gateway.azure-api.net"
  });
  delete process.env.WEBSITE_SITE_NAME;
  delete process.env.CONTAINER_APP_NAME;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/test-resource\.openai\.azure\.com\/openai\/v1\/chat\/completions$/);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return Response.json({
      model: String(body.model), choices: [{
        finish_reason: finishReason, message: { content: JSON.stringify(reply(body)) }
      }]
    }, { status });
  };
  console.log("v7: local model roles and production transport boundary");
  assert.equal(aiRoleSettings("wizard").reasoningEffort, "low");
  assert.equal(aiRoleSettings("architecture").reasoningEffort, "medium");
  assert.equal(aiRoleSettings("judge").model, "gpt-5.6-sol");
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(aiRoleSettings("architecture").transport, "apim");
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.WEBSITE_SITE_NAME = "hosted-app";
  assert.equal(aiRoleSettings("architecture").transport, "apim");
  delete process.env.WEBSITE_SITE_NAME;
  process.env.PATHFINDER_LOCAL_AI_ENDPOINT = "https://invalid.example/";
  assert.throws(() => aiRoleSettings("wizard"), /HTTPS Azure/);
  process.env.PATHFINDER_LOCAL_AI_ENDPOINT = "https://test-resource.openai.azure.com/";

  console.log("v7: inherited deterministic rules remain intact");
  const base = fixture("Employees ask handbook questions in Teams.");
  assert.equal(wantsFabricDataAgent({ ...base.input, dataSources: ["fabric_lakehouse"], fabricAnalyticsIntent: "storage_only" }), false);
  const coordination = { ...base.input, behaviors: ["multi_agent" as const], capabilities: ["multi_agent" as const] };
  assert.equal(isActionable(coordination), false);
  assert.equal(requiresOrchestration(coordination), true);
  assert.ok(applicableQuestions(base.input).some(question => question.id === "advancedRagRequirements"));

  console.log("v7: Terra wizard judgments are reviewed by Sol before hiding choices");
  const question: WizardQuestion = {
    id: "capabilities", layer: "Intent", type: "multi", title: "What should it do?",
    required: true, options: [{ id: "qa", label: "Answer" }, { id: "multi_agent", label: "Coordinate" }, { id: "unknown", label: "Not sure" }],
    read: () => ["qa"]
  };
  reply = body => body.model === "gpt-5.6-terra"
    ? { eliminate: [{ id: "multi_agent", reason: "No writes" }], note: "", needsReview: true }
    : { eliminate: [{ id: "qa", reason: "Already selected" }, { id: "unknown", reason: "Unknown" }], note: "Read-only coordination remains valid." };
  const wizard = await eliminateOptions(coordination, question);
  assert.deepEqual(wizard.eliminate, []);
  assert.equal(requests.at(-2)?.model, "gpt-5.6-terra");
  assert.equal(requests.at(-2)?.reasoning_effort, "low");
  assert.equal(requests.at(-1)?.reasoning_effort, "medium");
  status = 429;
  await assert.rejects(() => eliminateOptions(coordination, question), /HTTP 429/);
  status = 200;

  console.log("v7: structural checks reject missing controls, semantic review rejects invented claims");
  assert.deepEqual(architectureIssues(base.report, base.decision), []);
  const missing = structuredClone(base.report);
  missing.recommendedStack = [];
  assert.ok(architectureIssues(missing, base.decision).length > 0);
  let reviews = 0;
  let generations = 0;
  reply = body => {
    const system = (body.messages as Array<{ content: string }>)[0].content;
    if (system.includes("independent AI architecture reviewer")) {
      reviews++;
      return { passed: reviews > 1, issues: reviews === 1 ? ["Clarify the permissions boundary."] : [] };
    }
    generations++;
    return base.report;
  };
  const result = await tieBreak(base.input, base.decision);
  assert.equal(result.finalRecommendation, base.report.finalRecommendation);
  assert.equal(result.aiValidated, true);
  assert.equal(result.proposedArchitectureSummary, base.report.proposedArchitectureSummary);
  assert.equal(reviews, 2);
  assert.equal(generations, 2);
  assert.ok(result.agentTrace?.some(item => item.agent === "Architecture Critic" && item.status === "passed"));
  const count = requests.length;
  assert.equal((await tieBreak(base.input, base.decision)).cacheHit, true);
  assert.equal(requests.length, count);
  process.env.PATHFINDER_JUDGE_REASONING_EFFORT = "high";
  await tieBreak(base.input, base.decision);
  assert.ok(requests.length > count, "Changing the judge policy must invalidate the cached result.");
  process.env.PATHFINDER_JUDGE_REASONING_EFFORT = "medium";

  console.log("v7: failed review and incomplete output never become a success-shaped report");
  reply = body => (body.messages as Array<{ content: string }>)[0].content.includes("independent AI architecture reviewer")
    ? { passed: false, issues: ["Unsupported semantic claim."] } : base.report;
  await assert.rejects(() => tieBreak(base.input, base.decision, "Independent failing-review case"), /did not pass review/);
  console.log("v7: hostile structural edits are rejected without relying on AI prose");
  for (const mutation of [
    { recommendedBasePatternId: "different-route" },
    { recommendedOverlays: ["unauthorized-overlay"] },
    { solutionType: "different-family" },
    { architectureLayers: [] },
    { recommendedStack: ["Direct LLM to SQL"] },
    { securityControls: [] }
  ]) {
    const invalid = { ...structuredClone(base.report), ...mutation };
    assert.ok(architectureIssues(invalid, base.decision).length > 0, JSON.stringify(mutation));
  }
  console.log("v7: all AI-authored semantic fields reach the independent reviewer");
  for (const field of [
    "finalRecommendation", "useCaseTitle", "useCaseSummary", "proposedArchitectureSummary",
    "rationale", "endToEndFlow", "optionalAddOns", "riskFlags"
  ] as const) {
    const report = structuredClone(base.report);
    const marker = `UNSUPPORTED_${field}`;
    if (field === "rationale" || field === "endToEndFlow" || field === "optionalAddOns" || field === "riskFlags") {
      report[field] = [marker];
    } else {
      report[field] = marker;
    }
    let sawMarker = false;
    reply = body => {
      const messages = body.messages as Array<{ content: string }>;
      if (messages[0].content.includes("independent AI architecture reviewer")) {
        sawMarker ||= messages[1].content.includes(marker);
        return { passed: false, issues: ["Unsupported content in report."] };
      }
      return report;
    };
    await assert.rejects(() => tieBreak(base.input, base.decision, `Reject ${field}`), /did not pass review/);
    assert.equal(sawMarker, true, `${field} was not submitted for semantic review`);
  }
  finishReason = "length";
  await assert.rejects(() => requestAiJson("architecture", "Return JSON.", {}), /incomplete/);
  finishReason = "stop";
  const controller = new AbortController();
  controller.abort();
  // The real transport forwards cancellation; no provider fallback is allowed.
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    init?.signal?.throwIfAborted();
    throw new Error("Expected an aborted signal.");
  };
  await assert.rejects(() => requestAiJson("wizard", "Return JSON.", {}, { signal: controller.signal }));
  console.log("PASS: v7 AI role, judgment, safety, cache and failure contracts");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});
