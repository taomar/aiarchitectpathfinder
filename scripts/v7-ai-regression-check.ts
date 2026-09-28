import assert from "node:assert/strict";
import { z } from "zod";
import { aiRoleSettings, aiRuntimeStatus, requestAiJson } from "../lib/ai-runtime";
import { architectureIssues, tieBreak, reviewRecommendation, RecommendationFormatError } from "../lib/azure-openai";
import { eliminateOptions } from "../lib/wizard-filter";
import { decide } from "../lib/decision-engine";
import { emptyInput, type WizardQuestion } from "../lib/types";
import { recommendationFixture } from "./qa/recommendation-fixture";
import { AiRecommendationSchema, AcceptedRecommendationSchema, recommendationDecision, recommendationContent } from "../lib/recommendation-contract";
import { buildArchitectureView } from "../lib/architecture-view";
import { buildArchitectureLayout } from "../lib/architecture-layout";
import { buildMermaidDiagram, displayPatternName } from "../lib/pathfinder-category";
import { modelOutputSchema } from "../lib/model-output-schema";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
type Completion = {
  model: string; messages: Array<{ role: string; content: string }>;
  reasoning_effort: string; response_format: { type: string; json_schema?: { strict: boolean } };
};
const requests: Completion[] = [];
let reply: (body: Completion) => unknown;
let finishReason = "stop";
let status = 200;
const isJudge = (body: Completion) => body.messages[0].content.includes("independent solution-architecture reviewer");
const input = {
  ...emptyInput(), summary: "Employees need a read-only document assistant in a web application.",
  users: ["internal_employees" as const], channels: ["web" as const],
  capabilities: ["document_rag" as const], dataSources: ["documents" as const],
  behaviors: ["qa" as const], writeBackConfirmed: false
};

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test", AZURE_OPENAI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENABLED: "true", PATHFINDER_LOCAL_AI_ENDPOINT: "https://test-resource.openai.azure.com/",
    PATHFINDER_WIZARD_DEPLOYMENT: "gpt-5.6-terra", PATHFINDER_ARCHITECTURE_DEPLOYMENT: "gpt-5.6-sol",
    PATHFINDER_JUDGE_DEPLOYMENT: "gpt-5.6-sol", PATHFINDER_JUDGE_REASONING_EFFORT: "medium",
    AZURE_OPENAI_API_KEY: "unit-test-only", PATHFINDER_APIM_BASE_URL: "https://test-gateway.azure-api.net"
  });
  delete process.env.PATHFINDER_AI_MODE;
  delete process.env.WEBSITE_SITE_NAME;
  delete process.env.CONTAINER_APP_NAME;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://test-resource.openai.azure.com/openai/v1/chat/completions");
    const body: Completion = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /json/i);
    requests.push(body);
    return Response.json({
      model: body.model,
      choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(reply(body)) } }]
    }, { status });
  };
  assert.equal(aiRoleSettings("wizard").reasoningEffort, "low");
  assert.equal(aiRoleSettings("architecture").reasoningEffort, "xhigh");
  assert.equal(aiRoleSettings("judge").reasoningEffort, "medium");
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(aiRoleSettings("architecture").transport, "apim");
  Object.assign(process.env, { NODE_ENV: "test", WEBSITE_SITE_NAME: "hosted-app" });
  assert.equal(aiRoleSettings("architecture").transport, "apim");
  delete process.env.WEBSITE_SITE_NAME;
  console.log("PASS Sol maximum generation, Terra low wizard, independent review settings and hosted APIM boundary");

  const question: WizardQuestion = {
    id: "capabilities", layer: "Intent", type: "multi", title: "What should it do?", required: true,
    options: [{ id: "qa", label: "Answer" }, { id: "multi_agent", label: "Coordinate" }, { id: "unknown", label: "Not sure" }],
    read: () => ["qa"]
  };
  reply = body => body.model === "gpt-5.6-terra"
    ? { eliminate: [{ id: "multi_agent", reason: "Needs review" }], note: "", needsReview: true }
    : { eliminate: [{ id: "qa", reason: "Selected" }, { id: "unknown", reason: "Unknown" }], note: "Keep choices available." };
  assert.deepEqual((await eliminateOptions(input, question)).eliminate, []);
  console.log("PASS wizard assistance still protects selected and unknown choices");

  const content = recommendationFixture(input.summary);
  const schema = modelOutputSchema("architecture_test", AiRecommendationSchema);
  assert.throws(() => modelOutputSchema("unsupported", z.object({ date: z.date() })), /Unsupported/);
  let properties = 0, depth = 0;
  const inspect = (value: typeof schema.schema, level = 1) => {
    if (value.type === "object") {
      properties += Object.keys(value.properties).length;
      depth = Math.max(depth, level);
      assert.equal(value.additionalProperties, false);
      assert.deepEqual(value.required, Object.keys(value.properties));
      Object.values(value.properties).forEach(item => inspect(item, level + 1));
    } else if (value.type === "array") {
      depth = Math.max(depth, level);
      inspect(value.items, level + 1);
    }
    assert.ok(!("maxLength" in value) && !("format" in value));
  };
  inspect(schema.schema);
  assert.ok(properties <= 100 && depth <= 5);
  const draft = {
    ...decide(input), basePatternId: "wrong-deterministic-route",
    recommendedStack: ["WRONG_BASELINE_SERVICE"], blockedComponents: ["Azure AI Search"],
    forbiddenUnlessConfirmed: ["Azure App Service"]
  };
  assert.deepEqual(architectureIssues(content, draft), []);
  const before = requests.length;
  reply = body => {
    assert.equal(isJudge(body), false, "Generation must not invoke the optional critic.");
    assert.equal(body.reasoning_effort, "xhigh");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema?.strict, true);
    const context = JSON.parse(body.messages[1].content);
    assert.deepEqual(context.useCase, input);
    assert.equal(context.deterministicDraft.basePatternId, draft.basePatternId);
    return content;
  };
  const generated = await tieBreak(input, draft);
  assert.equal(requests.length - before, 1);
  assert.equal(generated.review.status, "not-requested");
  assert.equal(generated.aiValidated, false);
  assert.equal(generated.generation.reasoningEffort, "xhigh");
  assert.deepEqual(generated.architectureGraph, content.architectureGraph);
  assert.equal((await tieBreak(input, draft)).cacheHit, true);
  assert.equal(requests.length - before, 1);
  await tieBreak(input, draft, undefined, { recommendationMode: "deep" });
  assert.equal(requests.length - before, 2);
  console.log("PASS generation is one maximum-reasoning AI call, with no mandatory review or baseline veto");

  const projected = recommendationDecision(generated);
  const hostile = { ...emptyInput(), users: ["citizens" as const], channels: ["teams" as const], writeBackConfirmed: true };
  assert.deepEqual(buildArchitectureView(projected, hostile), projected.approvedArchitecture);
  assert.equal(displayPatternName(projected), generated.displayPatternName);
  assert.equal(buildMermaidDiagram(projected, hostile), generated.mermaidDiagram);
  const security = structuredClone(generated);
  security.architectureGraph.nodes.push({
    id: "source-policy", label: "Source access policy", layer: "security", provider: "logical", kind: "capability",
    state: "selected", required: true, icon: "generic", detail: "AI-authored source policy.", controls: []
  });
  security.architectureGraph.edges.push({ from: "backend", to: "source-policy", label: "Source authorization policy", kind: "policy" });
  assert.deepEqual(AcceptedRecommendationSchema.parse(security).architectureGraph, security.architectureGraph);
  assert.ok(buildArchitectureLayout(buildArchitectureView(recommendationDecision(security))).nodes.some(node => node.node.id === "source-policy"));

  const beforeReview = requests.length;
  reply = body => {
    assert.equal(isJudge(body), true, "An optional review must not regenerate the architecture.");
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.deterministicDraft, undefined);
    assert.deepEqual(context.proposedRecommendation, content);
    assert.equal(context.proposedRecommendation.aiValidated, undefined);
    return { passed: false, issues: ["Clarify source authorization."], summary: "The proposal needs an authorization clarification." };
  };
  const findings = await reviewRecommendation(input, generated);
  assert.equal(requests.length - beforeReview, 1);
  assert.equal(findings.review.status, "issues-found");
  assert.equal(findings.aiValidated, false);
  assert.deepEqual(recommendationContent(findings), content);
  assert.deepEqual(findings.generation, generated.generation);
  assert.equal(findings.mermaidDiagram, generated.mermaidDiagram);
  assert.equal((await reviewRecommendation(input, generated)).cacheHit, true);
  assert.equal(requests.length - beforeReview, 1);
  assert.equal((await tieBreak(input, draft)).review.status, "not-requested", "Review metadata must not contaminate generation cache.");
  reply = () => ({ passed: true, issues: [], summary: "The proposal meets the stated requirements." });
  const passed = await reviewRecommendation(input, generated, "Review this confirmed intent.");
  assert.equal(passed.review.status, "passed");
  assert.equal(passed.aiValidated, true);
  assert.deepEqual(recommendationContent(passed), content);
  assert.throws(() => AcceptedRecommendationSchema.parse({ ...generated, aiValidated: true }));
  console.log("PASS optional review exposes findings or approval without discarding, rewriting or falsely approving the generated result");

  let repairs = 0;
  const invalid = structuredClone(content);
  invalid.serviceSizing[0].dev = "x".repeat(91);
  reply = body => {
    assert.equal(isJudge(body), false);
    repairs++;
    if (repairs === 1) return invalid;
    assert.deepEqual(JSON.parse(body.messages[1].content).previousCandidate, invalid);
    return content;
  };
  assert.equal((await tieBreak(input, draft, "Repair the output format")).review.status, "not-requested");
  assert.equal(repairs, 2);
  reply = () => invalid;
  await assert.rejects(tieBreak(input, draft, "Still invalid"), RecommendationFormatError);

  Object.assign(process.env, {
    NODE_ENV: "production", PATHFINDER_AI_MODE: "external-foundry",
    PATHFINDER_FOUNDRY_AUTH: "apiKey", PATHFINDER_FOUNDRY_ENDPOINT: "https://test-resource.openai.azure.com"
  });
  delete process.env.PATHFINDER_JUDGE_DEPLOYMENT;
  assert.equal(aiRuntimeStatus().reviewAvailable, false);
  reply = () => content;
  assert.equal((await tieBreak(input, draft, "No reviewer is configured")).review.status, "not-requested");
  await assert.rejects(reviewRecommendation(input, generated), /judge deployment/);
  console.log("PASS structural repair stays bounded and a missing optional reviewer does not block generation");

  finishReason = "length";
  reply = () => ({});
  await assert.rejects(requestAiJson("architecture", "Return JSON.", {}), /incomplete/);
  finishReason = "stop";
  status = 429;
  await assert.rejects(requestAiJson("architecture", "Return JSON.", {}), /HTTP 429/);
  console.log("PASS explicit provider failures remain visible without a deterministic replacement");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
