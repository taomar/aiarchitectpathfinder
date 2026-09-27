import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "../app/page";
import { QuestionCard } from "../components/QuestionCard";
import { ProgressRail } from "../components/ProgressRail";
import { FinalRecommendation, readAiReviewAvailability } from "../components/FinalRecommendation";
import { decide } from "../lib/decision-engine";
import { EXAMPLES } from "../lib/examples";
import { QUESTIONS } from "../lib/questions";
import { emptyInput } from "../lib/types";

const summary = QUESTIONS.find((question) => question.id === "summary");
assert.ok(summary);
const summaryMarkup = renderToStaticMarkup(
  <QuestionCard question={summary} input={emptyInput()} onChange={() => {}} />
);
const labelId = summaryMarkup.match(/<textarea[^>]*aria-labelledby="([^"]+)"/)?.[1];
assert.ok(labelId, "The scenario textarea must have an accessible name from its visible heading.");
assert.ok(summaryMarkup.includes(`<h2 id="${labelId}"`), "The name must reference the rendered question heading.");
assert.match(summaryMarkup, /aria-expanded="false"/, "Contextual help must expose its collapsed state.");

const externalAccess = QUESTIONS.find((question) => question.id === "externalAccessConfirmed");
assert.ok(externalAccess);
const singleMarkup = renderToStaticMarkup(
  <QuestionCard
    question={externalAccess}
    input={{ ...emptyInput(), externalAccessConfirmed: false }}
    onChange={() => {}}
  />
);
assert.equal((singleMarkup.match(/aria-pressed="true"/g) ?? []).length, 1, "Exactly one single-choice answer is selected.");
assert.equal((singleMarkup.match(/aria-pressed="false"/g) ?? []).length, 2, "Unselected answers must expose their state.");
assert.match(singleMarkup, /aria-pressed="true"[^>]*>No<\/button>/, "The selected state must correspond to the actual answer.");

const progressMarkup = renderToStaticMarkup(<ProgressRail input={emptyInput()} currentStepId="scenario" />);
assert.match(progressMarkup, /<nav[^>]*aria-label="Profile progress"/, "Progress navigation must have a meaningful accessible name.");
assert.match(progressMarkup, /aria-current="step"/, "The current profile step must be exposed.");

const landingMarkup = renderToStaticMarkup(<Page />);
assert.equal((landingMarkup.match(/<main\b/g) ?? []).length, 1, "The application page must expose one main landmark.");
assert.equal((landingMarkup.match(/<h1\b/g) ?? []).length, 1, "The initial page must expose one primary heading.");

const input = EXAMPLES[0].input;
const recommendationMarkup = renderToStaticMarkup(
  <FinalRecommendation
    input={input}
    decision={decide(input)}
    usageSession={{ id: "offline-ui-check", source: "test", startedAt: "2026-09-21T00:00:00Z" }}
    onBack={() => {}}
    onReset={() => {}}
  />
);
assert.doesNotMatch(recommendationMarkup, /Preparing recommendation|Waiting for LLM/);
const exportButton = [...recommendationMarkup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .find((match) => match[2].includes("Export as PowerPoint"));
assert.ok(exportButton, "The baseline export must render before any optional AI request completes.");
assert.doesNotMatch(exportButton[1], /\sdisabled(?:=|\s|$)/, "AI availability must not disable baseline export.");

async function checkAvailability() {
  const originalFetch = globalThis.fetch;
  try {
    for (const enabled of [false, true]) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, "/api/tiebreak");
        assert.equal(options?.method, "GET");
        return Response.json({ enabled });
      };
      assert.equal(await readAiReviewAvailability(), enabled);
    }
    for (const invalid of [null, {}, { enabled: "false" }]) {
      globalThis.fetch = async () => Response.json(invalid);
      await assert.rejects(readAiReviewAvailability(), /availability could not be checked/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log("UI accessibility and baseline-first AI availability checks passed.");
}

checkAvailability().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
