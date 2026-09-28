require("tsx/cjs");
const assert = require("node:assert/strict");
const { POST, GET } = require("../app/api/tiebreak/route.ts");
const { recommendationFixture, architectureFixture } = require("./qa/recommendation-fixture.ts");
const { emptyInput } = require("../lib/types.ts");
const { RECOMMENDATION_CONTRACT_VERSION } = require("../lib/recommendation-contract.ts");

const saved = { ...process.env };
const originalFetch = globalThis.fetch;
let accept = true;
let providerCalls = 0;
let judgeCalls = 0;
const input = { ...emptyInput(), summary: "An employee read-only web assistant over documents." };

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test", AUTH_MODE: "none", AZURE_OPENAI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENABLED: "true", PATHFINDER_LOCAL_AI_ENDPOINT: "https://test-runtime.openai.azure.com",
    AZURE_OPENAI_API_KEY: "synthetic-key", PATHFINDER_WIZARD_DEPLOYMENT: "synthetic-wizard",
    PATHFINDER_ARCHITECTURE_DEPLOYMENT: "synthetic-architect", PATHFINDER_JUDGE_DEPLOYMENT: "synthetic-judge"
  });
  delete process.env.PATHFINDER_AI_MODE;
  delete process.env.WEBSITE_SITE_NAME;
  delete process.env.CONTAINER_APP_NAME;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://test-runtime.openai.azure.com/openai/v1/chat/completions");
    providerCalls++;
    const body = JSON.parse(init.body);
    const data = JSON.parse(body.messages[1].content);
    const judging = body.messages[0].content.includes("independent solution-architecture reviewer");
    const drawing = body.messages[0].content.includes("already-written AI recommendation");
    let reply;
    if (judging) {
      judgeCalls++;
      assert.equal(data.useCase.summary, input.summary);
      assert.equal(data.deterministicDraft, undefined);
      reply = { passed: accept, issues: accept ? [] : ["The test AI reviewer rejected the proposal."], summary: accept ? "The proposed AI architecture fits the scenario." : "Revise the proposal." };
    } else if (drawing) {
      assert.deepEqual(data.recommendation, recommendationFixture(input.summary));
      assert.equal(data.deterministicDraft, undefined);
      reply = architectureFixture();
    } else {
      assert.equal(data.useCase.summary, input.summary);
      assert.ok(data.deterministicDraft);
      reply = recommendationFixture(input.summary);
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  };
  const request = body => new Request("http://localhost/api/tiebreak", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const response = await POST(request({ input, decision: { basePatternId: "FORGED_DRAFT" } }));
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.authority, "ai");
  assert.equal(report.contractVersion, RECOMMENDATION_CONTRACT_VERSION);
  assert.equal(report.recommendedBasePatternId, "ai-selected-document-application");
  assert.equal(providerCalls, 1);
  assert.equal(judgeCalls, 0);
  assert.equal(report.generation.reasoningEffort, "xhigh");
  assert.equal(report.review.status, "not-requested");
  assert.equal(report.aiValidated, false);
  assert.equal(report.architecture, null);
  console.log("PASS real route returns the AI-selected architecture rather than the supplied or deterministic route");

  const status = await GET(new Request("http://localhost/api/tiebreak"));
  assert.equal((await status.json()).enabled, true);
  assert.equal((await POST(request({ input: { channels: "not-an-array" } }))).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/tiebreak", { method: "POST", body: "{" }))).status, 400);
  console.log("PASS structured invalid input is rejected before provider access");

  accept = false;
  const reviewed = await POST(request({ input, operation: "review", previousRecommendation: report }));
  assert.equal(reviewed.status, 200);
  const findings = await reviewed.json();
  assert.equal(findings.review.status, "issues-found");
  assert.ok(findings.review.issues.length > 0);
  assert.equal(findings.aiValidated, false);
  assert.equal(findings.architecture, null);
  assert.deepEqual(findings.recommendedStack, report.recommendedStack);
  assert.equal(judgeCalls, 1);
  assert.equal(providerCalls, 2);
  const visualResponse = await POST(request({ input, operation: "architecture", previousRecommendation: report }));
  assert.equal(visualResponse.status, 200);
  const visual = await visualResponse.json();
  assert.equal(visual.reportId, report.reportId);
  assert.deepEqual(visual.recommendedStack, report.recommendedStack);
  assert.match(visual.architecture.svg, /data-stack-band/);
  assert.equal(providerCalls, 3);
  assert.equal((await POST(request({ input, operation: "architecture" }))).status, 400);
  assert.equal((await POST(request({ input, operation: "review" }))).status, 400);
  console.log("PASS optional review returns findings alongside the unchanged AI architecture");

  process.env.AZURE_OPENAI_ENABLED = "false";
  const count = providerCalls;
  const disabled = await POST(request({ input }));
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "AI_DISABLED");
  assert.equal(providerCalls, count);
  console.log("PASS disabled AI does not fall back or invoke providers");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
