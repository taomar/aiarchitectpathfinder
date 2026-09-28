import assert from "node:assert/strict";
import { aiRoleSettings, aiRuntimeStatus, requestAiJson } from "../lib/ai-runtime";
import { architectureIssues, tieBreak, buildRecommendationArchitecture, reviewRecommendation, RecommendationFormatError } from "../lib/azure-openai";
import { eliminateOptions } from "../lib/wizard-filter";
import { decide } from "../lib/decision-engine";
import { emptyInput, type WizardQuestion } from "../lib/types";
import { recommendationFixture, architectureFixture } from "./qa/recommendation-fixture";
import { AiRecommendationSchema, AiArchitectureSchema, AcceptedRecommendationSchema, recommendationDecision, recommendationContent } from "../lib/recommendation-contract";
import { buildArchitectureView } from "../lib/architecture-view";
import { buildMermaidDiagram } from "../lib/pathfinder-category";
import { modelOutputSchema } from "../lib/model-output-schema";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
type Completion = { model: string; messages: Array<{ content: string }>; reasoning_effort: string; response_format: { type: string } };
const requests: Completion[] = [];
let reply: (body: Completion) => unknown;
let finishReason = "stop";
let status = 200;
const isJudge = (body: Completion) => body.messages[0].content.includes("independent solution-architecture reviewer");
const isDiagram = (body: Completion) => body.messages[0].content.includes("already-written AI recommendation");
const input = { ...emptyInput(), summary: "Employees need a read-only document assistant in a web application." };

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test", AZURE_OPENAI_ENABLED: "true", PATHFINDER_LOCAL_AI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENDPOINT: "https://test-resource.openai.azure.com",
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
    return Response.json({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(reply(body)) } }] }, { status });
  };
  assert.equal(aiRoleSettings("wizard").reasoningEffort, "low");
  assert.equal(aiRoleSettings("architecture").reasoningEffort, "xhigh");
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(aiRoleSettings("architecture").transport, "apim");
  Object.assign(process.env, { NODE_ENV: "test" });
  const question: WizardQuestion = {
    id: "capabilities", layer: "Intent", type: "multi", title: "What should it do?", required: true,
    options: [{ id: "qa", label: "Answer" }, { id: "multi_agent", label: "Coordinate" }, { id: "unknown", label: "Not sure" }],
    read: () => ["qa"]
  };
  reply = () => ({ eliminate: [{ id: "qa", reason: "Selected" }, { id: "unknown", reason: "Unknown" }], note: "Keep choices available." });
  assert.deepEqual((await eliminateOptions(input, question)).eliminate, []);
  console.log("PASS maximum reasoning and existing wizard/provider boundaries");

  for (const schema of [AiRecommendationSchema, AiArchitectureSchema]) {
    const provider = modelOutputSchema("test_schema", schema);
    let properties = 0, depth = 0;
    const inspect = (value: typeof provider.schema, level = 1) => {
      if (value.type === "object") {
        properties += Object.keys(value.properties).length;
        depth = Math.max(depth, level);
        assert.equal(value.additionalProperties, false);
        assert.deepEqual(value.required, Object.keys(value.properties));
        Object.values(value.properties).forEach(item => inspect(item, level + 1));
      } else if (value.type === "array") { depth = Math.max(depth, level); inspect(value.items, level + 1); }
    };
    inspect(provider.schema);
    assert.ok(properties <= 100 && depth <= 5);
  }
  const content = recommendationFixture(input.summary);
  const diagram = architectureFixture();
  const draft = { ...decide(input), basePatternId: "wrong-deterministic-route", recommendedStack: ["WRONG_BASELINE_SERVICE"], blockedComponents: ["Azure AI Search"] };
  assert.deepEqual(architectureIssues(content, draft), []);
  const before = requests.length;
  reply = body => {
    assert.equal(isJudge(body) || isDiagram(body), false);
    assert.equal(body.reasoning_effort, "xhigh");
    assert.equal(body.response_format.type, "json_schema");
    assert.deepEqual(JSON.parse(body.messages[1].content).useCase, input);
    return content;
  };
  const generated = await tieBreak(input, draft);
  assert.equal(requests.length - before, 1);
  assert.equal(generated.architecture, null, "Text must be available before diagram generation.");
  assert.equal(generated.review.status, "not-requested");
  assert.equal(generated.aiValidated, false);
  assert.deepEqual(recommendationContent(generated), content);
  assert.equal((await tieBreak(input, draft)).cacheHit, true);
  assert.equal(requests.length - before, 1);
  console.log("PASS recommendation arrives independently, without waiting for graph or review");

  reply = body => {
    assert.equal(isDiagram(body), true);
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(payload.recommendation, content);
    assert.equal(payload.deterministicDraft, undefined);
    return diagram;
  };
  const visual = await buildRecommendationArchitecture(generated);
  assert.ok(visual.architecture);
  assert.equal(visual.architecture.reportId, generated.reportId);
  assert.deepEqual(recommendationContent(visual), content);
  assert.deepEqual(visual.architecture.graph, diagram.graph);
  assert.deepEqual(visual.architecture.flow, diagram.flow);
  assert.match(visual.architecture.svg, /data-stack-band="layer"/);
  assert.match(visual.architecture.mermaid, /\{"Supporting evidence available\?"\}/);
  assert.match(visual.architecture.mermaid, /\|"Yes"\|/);
  assert.match(visual.architecture.mermaid, /\|"No"\|/);
  const decision = recommendationDecision(visual);
  assert.deepEqual(buildArchitectureView(decision).edges, diagram.graph.edges);
  assert.equal(buildMermaidDiagram(decision), visual.architecture.mermaid);
  const afterVisual = requests.length;
  await buildRecommendationArchitecture(generated);
  assert.equal(requests.length, afterVisual, "A visual retry may reuse the immutable artifact.");
  await assert.rejects(buildRecommendationArchitecture({ ...generated, reportId: "0".repeat(64) }), /report\/diagram format/);
  console.log("PASS background visuals preserve the exact recommendation and explicitly branch the flow");

  reply = body => {
    assert.equal(isJudge(body), true);
    return { passed: true, issues: [], summary: "The recommendation fits." };
  };
  const textReview = await reviewRecommendation(input, generated);
  assert.equal(textReview.review.status, "passed");
  assert.equal(textReview.review.scope, "recommendation");
  const fullReview = await reviewRecommendation(input, visual);
  if (fullReview.review.status !== "not-requested") {
    assert.equal(fullReview.review.scope, "recommendation-and-architecture");
    assert.equal(fullReview.review.architectureId, visual.architecture.id);
  }
  assert.deepEqual(fullReview.architecture, visual.architecture);
  reply = () => ({ passed: false, issues: ["Clarify authorization."], summary: "A clarification is needed." });
  const findings = await reviewRecommendation(input, visual, "Review the changed intent.");
  assert.equal(findings.review.status, "issues-found");
  assert.deepEqual(findings.architecture, visual.architecture);
  assert.throws(() => AcceptedRecommendationSchema.parse({ ...generated, aiValidated: true }));
  console.log("PASS optional review records its scope and never rewrites recommendation or visuals");

  let repairs = 0;
  const invalidDiagram = structuredClone(diagram);
  invalidDiagram.graph.nodes.find(node => node.provider === "azure")!.serviceIds = ["invented-service"];
  reply = body => {
    repairs++;
    if (repairs === 1) return invalidDiagram;
    assert.deepEqual(JSON.parse(body.messages[1].content).previousCandidate, invalidDiagram);
    return diagram;
  };
  // Supply matching text for this independent repair/cache key.
  const changed = { ...generated, generation: { ...generated.generation, model: "test-repair-model" } };
  process.env.PATHFINDER_ARCHITECTURE_DEPLOYMENT = "test-repair-model";
  await buildRecommendationArchitecture(changed);
  assert.equal(repairs, 2);
  assert.equal(generated.architecture, null);
  console.log("PASS visual contract repairs cannot introduce services outside the recommendation");

  Object.assign(process.env, { NODE_ENV: "production", PATHFINDER_AI_MODE: "external-foundry", PATHFINDER_FOUNDRY_AUTH: "apiKey", PATHFINDER_FOUNDRY_ENDPOINT: "https://test-resource.openai.azure.com" });
  delete process.env.PATHFINDER_JUDGE_DEPLOYMENT;
  assert.equal(aiRuntimeStatus().reviewAvailable, false);
  reply = () => content;
  assert.equal((await tieBreak(input, draft, "No reviewer configured")).architecture, null);
  await assert.rejects(reviewRecommendation(input, generated), /judge deployment/);
  finishReason = "length";
  await assert.rejects(requestAiJson("architecture", "Return JSON.", {}), /incomplete/);
  finishReason = "stop"; status = 429;
  await assert.rejects(requestAiJson("architecture", "Return JSON.", {}), /HTTP 429/);
  console.log("PASS missing optional reviewer and provider errors remain explicit");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
