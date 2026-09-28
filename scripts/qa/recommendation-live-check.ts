import fs from "node:fs";
import path from "node:path";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { prepareDecisionInputForRecommendation } from "../../lib/summary-intake";
import { tieBreak } from "../../lib/azure-openai";
import { AcceptedRecommendationSchema, recommendationDecision } from "../../lib/recommendation-contract";
import { buildArchitectureView } from "../../lib/architecture-view";
import assert from "node:assert/strict";

async function main() {
  const directory = process.env.E2E_ARTIFACT_DIR;
  if (!directory) throw new Error("Set E2E_ARTIFACT_DIR outside the repository.");
  const relative = path.relative(process.cwd(), path.resolve(directory));
  if (!(path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))) {
    throw new Error("Live report artifacts must remain outside the repository.");
  }
  const sample = EXAMPLES.find(item => item.id === process.argv[2]);
  if (!sample) throw new Error("Pass an existing synthetic example ID.");
  const settings = JSON.parse(fs.readFileSync(path.join(directory, "model-config.json"), "utf8")) as Record<string, string>;
  Object.assign(process.env, settings, { NODE_ENV: "production" });
  const input = sample.input;
  const draft = decide(prepareDecisionInputForRecommendation(input));
  const started = Date.now();
  const output = path.join(directory, "ai-authority-live");
  fs.mkdirSync(output, { recursive: true });
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (url, init) => {
    const number = ++call;
    const response = await originalFetch(url, init);
    if (response.headers.get("content-type")?.includes("application/json")) {
      const content: unknown = await response.clone().json();
      fs.writeFileSync(path.join(output, `${sample.id}-${started}-call-${number}.json`), JSON.stringify({ status: response.status, response: content }, null, 2));
    }
    return response;
  };
  console.log(`START live AI authority check: ${sample.id}`);
  const progress = setInterval(() => console.log(`WAIT AI composition/review: ${Math.round((Date.now() - started) / 1000)}s`), 15_000);
  try {
    const report = AcceptedRecommendationSchema.parse(await tieBreak(input, draft, undefined, {
      onProgress: event => console.log(`PHASE ${event.stage}, attempt ${event.attempt}, ${Math.round(event.elapsedMs / 1000)}s: ${event.message}`)
    }));
    const presented = recommendationDecision(report);
    assert.equal(report.generation.reasoningEffort, "xhigh");
    assert.equal(report.review.status, "not-requested");
    assert.equal(report.aiValidated, false);
    assert.deepEqual(buildArchitectureView(presented).edges, report.architectureGraph.edges);
    assert.deepEqual(presented.recommendedStack, report.recommendedStack);
    fs.writeFileSync(path.join(output, `${sample.id}.json`), JSON.stringify({ input, report, elapsedMs: Date.now() - started }, null, 2));
    console.log(JSON.stringify({
      example: sample.id, authority: report.authority, outcome: report.outcome,
      initialDraft: draft.basePatternId, acceptedRoute: report.recommendedBasePatternId,
      solution: report.solutionType, graphNodes: report.architectureGraph.nodes.length,
      graphEdges: report.architectureGraph.edges.length, sizingRows: report.serviceSizing.length,
      generation: report.generation, independentReview: report.review.status,
      changes: report.changesFromDraft, seconds: Math.round((Date.now() - started) / 1000)
    }, null, 2));
    console.log("PASS live Sol maximum generation and exact AI graph; independent review was not requested.");
  } finally {
    clearInterval(progress);
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "issues" in error) console.error(JSON.stringify(error.issues));
  process.exitCode = 1;
});
