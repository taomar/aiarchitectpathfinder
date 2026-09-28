import assert from "node:assert/strict";
import { POST } from "../app/api/tiebreak/route";
import { tieBreak } from "../lib/azure-openai";
import { decide } from "../lib/decision-engine";
import { emptyInput } from "../lib/types";
import { acceptedFixture, recommendationFixture } from "./qa/recommendation-fixture";
import { readRecommendationResponse, RecommendationRequestError, type RecommendationProgress } from "../lib/recommendation-progress";
import {
  RECOMMENDATION_MAX_ATTEMPTS, ARCHITECT_REQUEST_TIMEOUT_MS, REVIEW_REQUEST_TIMEOUT_MS,
  RECOMMENDATION_TIMEOUT_MS, RECOMMENDATION_CLIENT_TIMEOUT_MS
} from "../lib/recommendation-policy";

const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };
const originalTimeout = AbortSignal.timeout;
const originalNow = Date.now;
const encoder = new TextEncoder();
const accepted = { ...acceptedFixture("A read-only document assistant."), useCaseTitle: "R\u00e9sum\u00e9 source assistant" };
const input = { ...emptyInput(), summary: "A read-only document assistant." };
const phase: RecommendationProgress = { stage: "architect", attempt: 1, elapsedMs: 5, message: "Architect is composing." };
let release: (() => void) | undefined;
let openReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let providerSignal: AbortSignal | undefined;
let behavior: "normal" | "pause" | "abort" | "budget" | "bad-request" = "normal";
let fakeTime = 0;
let modelCalls = 0;
const deadlines: Array<{ deadline: number; controller: AbortController }> = [];

function ndjson(lines: unknown[], chunk = 17, endNewline = true) {
  const bytes = encoder.encode(lines.map(line => JSON.stringify(line)).join("\n") + (endNewline ? "\n" : ""));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunk) controller.enqueue(bytes.slice(offset, offset + chunk));
      controller.close();
    }
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}

function advance(milliseconds: number) {
  fakeTime += milliseconds;
  for (const item of deadlines) if (fakeTime >= item.deadline && !item.controller.signal.aborted) {
    item.controller.abort(new DOMException("Budget exhausted.", "TimeoutError"));
  }
}

function request(notes: string, signal?: AbortSignal) {
  return new Request("http://localhost/api/tiebreak", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ input, userNotes: notes }), signal
  });
}

async function main() {
  const events = [{ type: "progress", progress: phase }, { type: "heartbeat", elapsedMs: 10 }, { type: "result", report: accepted }];
  for (const size of [1, 7, 1024]) {
    const progress: RecommendationProgress[] = [];
    assert.deepEqual(await readRecommendationResponse(ndjson(events, size, false), event => progress.push(event)), accepted);
    assert.deepEqual(progress, [phase]);
  }
  assert.deepEqual(await readRecommendationResponse(Response.json(accepted), () => {}), accepted);
  await assert.rejects(readRecommendationResponse(Response.json({ error: "Provider unavailable", code: "TEST" }, { status: 503 }), () => {}),
    error => error instanceof RecommendationRequestError && error.code === "TEST");
  for (const lines of [
    events.slice(0, 2),
    [{ type: "error", error: "Review rejected", code: "AI_REVIEW_REJECTED", issues: ["Keep the operation read-only."] }],
    [...events, { type: "heartbeat", elapsedMs: 11 }],
    [{ type: "progress", progress: { ...phase, stage: "invented" } }]
  ]) {
    await assert.rejects(readRecommendationResponse(ndjson(lines), () => {}), RecommendationRequestError);
  }
  let cancelled = false;
  await assert.rejects(readRecommendationResponse(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode("invalid json\n")); },
    cancel() { cancelled = true; }
  }), { headers: { "Content-Type": "application/x-ndjson" } }), () => {}), /invalid recommendation stream/);
  assert.equal(cancelled, true);
  await assert.rejects(readRecommendationResponse(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }
  }), { headers: { "Content-Type": "application/x-ndjson" } }), () => {}), /size limit/);
  console.log("PASS chunked/UTF-8-compatible parsing, JSON compatibility, truncation, terminal errors and cleanup");

  Object.assign(process.env, {
    NODE_ENV: "test", AUTH_MODE: "none", AZURE_OPENAI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENABLED: "true", PATHFINDER_LOCAL_AI_ENDPOINT: "https://stream-test.openai.azure.com",
    AZURE_OPENAI_API_KEY: "synthetic-key", PATHFINDER_WIZARD_DEPLOYMENT: "synthetic-wizard",
    PATHFINDER_ARCHITECTURE_DEPLOYMENT: "synthetic-architect", PATHFINDER_JUDGE_DEPLOYMENT: "synthetic-judge"
  });
  delete process.env.PATHFINDER_AI_MODE;
  delete process.env.WEBSITE_SITE_NAME;
  delete process.env.CONTAINER_APP_NAME;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /json/i, "JSON-mode provider calls must explicitly instruct JSON output.");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    const context = JSON.parse(body.messages[1].content);
    const judging = body.messages[0].content.includes("independent solution-architecture reviewer");
    providerSignal = init?.signal ?? undefined;
    if (behavior === "bad-request") return Response.json({ error: { message: "Synthetic invalid request." } }, { status: 400 });
    if (!judging && behavior === "pause") await new Promise<void>(resolve => { release = resolve; });
    if (behavior === "abort") {
      await new Promise<void>((_resolve, reject) => providerSignal!.addEventListener("abort", () => reject(providerSignal!.reason), { once: true }));
    }
    if (behavior === "budget") {
      advance([285_000, 285_000][modelCalls++]);
      providerSignal?.throwIfAborted();
    }
    const value = judging
      ? { passed: true, issues: [], summary: "The proposal fits the user requirements." }
      : recommendationFixture(context.useCase.summary);
    if (!judging) assert.equal(body.reasoning_effort, "xhigh");
    if (behavior === "budget" && modelCalls === 1 && "serviceSizing" in value) value.serviceSizing[0].dev = "x".repeat(91);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
  };

  behavior = "budget";
  AbortSignal.timeout = milliseconds => {
    const controller = new AbortController();
    deadlines.push({ deadline: fakeTime + milliseconds, controller });
    return controller.signal;
  };
  Date.now = () => fakeTime;
  const phases: string[] = [];
  const report = await tieBreak(input, decide(input), "Verify the full repair budget", { onProgress: event => phases.push(event.stage) });
  assert.equal(report.authority, "ai");
  assert.equal(modelCalls, 2);
  assert.equal(fakeTime, 570_000);
  assert.equal(report.review.status, "not-requested");
  assert.equal(RECOMMENDATION_TIMEOUT_MS, RECOMMENDATION_MAX_ATTEMPTS * ARCHITECT_REQUEST_TIMEOUT_MS);
  assert.ok(RECOMMENDATION_CLIENT_TIMEOUT_MS > RECOMMENDATION_TIMEOUT_MS);
  assert.deepEqual(phases, ["preparing", "architect", "revising", "architect", "complete"]);
  AbortSignal.timeout = originalTimeout;
  Date.now = originalNow;
  console.log("PASS maximum-reasoning and format-repair budgets: 570 seconds without a premature cutoff (fake clock)");

  behavior = "pause";
  const streamed = await POST(request("Verify streamed handoff"));
  assert.equal(streamed.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  openReader = streamed.body!.getReader();
  const first = await openReader.read();
  const text = new TextDecoder();
  let streamText = text.decode(first.value);
  assert.match(streamText, /"stage":"preparing"/);
  console.log("PASS initial progress arrives before model completion; waiting for the real 10-second heartbeat");
  while (!streamText.includes('"type":"heartbeat"')) {
    const piece = await openReader.read();
    assert.equal(piece.done, false);
    streamText += text.decode(piece.value);
  }
  release!();
  while (true) {
    const piece = await openReader.read();
    if (piece.done) break;
    streamText += text.decode(piece.value);
  }
  openReader.releaseLock();
  openReader = undefined;
  const completedEvents = streamText.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(completedEvents.at(-1).type, "result");
  assert.equal(completedEvents.filter(event => event.type === "result").length, 1);
  assert.deepEqual(completedEvents.filter(event => event.type === "progress").map(event => event.progress.stage),
    ["preparing", "architect", "complete"]);
  console.log("PASS server heartbeat, real stage order, accepted result and immediate stream closure");

  behavior = "normal";
  const cacheEvents: RecommendationProgress[] = [];
  const cachedResponse = await POST(request("Verify streamed handoff"));
  assert.equal((await readRecommendationResponse(cachedResponse, event => cacheEvents.push(event))).cacheHit, true);
  assert.deepEqual(cacheEvents.map(event => event.stage), ["preparing", "complete"]);
  assert.equal(cacheEvents[1].cached, true);
  const reviewPhases: string[] = [];
  const reviewed = await POST(new Request("http://localhost/api/tiebreak", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ input, operation: "review", previousRecommendation: completedEvents.at(-1).report })
  }));
  const reviewResult = await readRecommendationResponse(reviewed, event => reviewPhases.push(event.stage));
  assert.equal(reviewResult.review.status, "passed");
  assert.deepEqual(reviewResult.architecture, completedEvents.at(-1).report.architecture);
  assert.deepEqual(reviewPhases, ["handoff", "reviewing", "complete"]);
  console.log("PASS independent review streams only when explicitly requested and preserves the architecture");

  behavior = "abort";
  const cancelledResponse = await POST(request("Cancel the provider request"));
  openReader = cancelledResponse.body!.getReader();
  await openReader.read();
  await openReader.cancel();
  assert.equal(providerSignal?.aborted, true);
  openReader.releaseLock();
  openReader = undefined;
  console.log("PASS cached acceptance and stream cancellation aborting the upstream model call");

  behavior = "bad-request";
  const failed = await POST(request("Expose the provider request failure"));
  await assert.rejects(readRecommendationResponse(failed, () => {}),
    error => error instanceof RecommendationRequestError && error.code === "AI_PROVIDER_ERROR" && /HTTP 400/.test(error.message));
  console.log("PASS provider failures remain explicit errors, not fallback recommendations");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  release?.();
  if (openReader) { await openReader.cancel(); openReader.releaseLock(); }
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  Date.now = originalNow;
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
});
