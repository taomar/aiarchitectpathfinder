import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { acceptedFixture } from "./recommendation-fixture";
import { caseDirectory, diagnostics, login } from "./helpers";
import type { RecommendationProgress, RecommendationStreamEvent } from "../../lib/recommendation-progress";

type StreamHarness = {
  requests: Array<Record<string, unknown>>;
  aborts: number;
  send: (event: RecommendationStreamEvent, finish?: boolean) => void;
};

async function installStream(page: Page, reviewAvailable = true) {
  await page.route("**/api/tiebreak", route => route.fulfill({ json: { enabled: true, reviewAvailable, authRefreshEnabled: false } }));
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let writer: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cleanup = () => {};
    const state: StreamHarness = {
      requests: [], aborts: 0,
      send(event, finish = false) {
        if (!writer) throw new Error("No active test stream.");
        writer.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
        if (finish) { cleanup(); writer.close(); writer = undefined; }
      }
    };
    Object.defineProperty(window, "__recommendationStreamTest", { value: state });
    window.fetch = async (url, init) => {
      const address = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (new URL(address, location.href).pathname !== "/api/tiebreak" || init?.method !== "POST") return originalFetch(url, init);
      state.requests.push(JSON.parse(String(init.body)));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          writer = controller;
          const abort = () => { state.aborts++; writer = undefined; controller.error(init.signal?.reason); };
          init.signal?.addEventListener("abort", abort, { once: true });
          cleanup = () => init.signal?.removeEventListener("abort", abort);
        },
        cancel() { cleanup(); writer = undefined; }
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    };
  });
}

async function send(page: Page, event: RecommendationStreamEvent, finish = false) {
  await page.evaluate(({ event, finish }) => {
    const state = Reflect.get(window, "__recommendationStreamTest") as StreamHarness;
    state.send(event, finish);
  }, { event, finish });
}

async function stage(page: Page, value: RecommendationProgress["stage"], attempt = 1) {
  await send(page, { type: "progress", progress: {
    stage: value, attempt, elapsedMs: 1000, message: `Observed server phase: ${value}`, model: "synthetic-model"
  } });
  await expect(page.locator("[data-ai-stage]")).toHaveAttribute("data-ai-stage", value);
}

async function loadExample(page: Page) {
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(1);
}

test("the original layout shows an inert preview and only server events advance AI progress", async ({ page }, info) => {
  await login(page);
  await installStream(page);
  await page.clock.install();
  await loadExample(page);
  const preview = page.locator('[data-preliminary-preview="true"]');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await expect(preview).toHaveCSS("opacity", "0.28");
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back to wizard", exact: true })).toBeEnabled();
  await stage(page, "architect");
  await page.clock.fastForward(30_000);
  await expect(page.locator("[data-ai-stage]")).toHaveAttribute("data-ai-stage", "architect");
  await expect(page.locator(".recommendation-generation-symbol").first()).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Pause animation", exact: true }).click();
  await expect(page.locator("[data-ai-stage]")).toHaveAttribute("data-motion-paused", "true");
  await page.screenshot({ path: path.join(caseDirectory(info), "generation-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(caseDirectory(info), "generation-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await send(page, { type: "progress", progress: {
    stage: "revising", attempt: 1, elapsedMs: 2000, message: "The output format needs a correction.",
    issues: ["Shorten the environment-sizing table cell."]
  } });
  await expect(page.getByText("Shorten the environment-sizing table cell.", { exact: true })).toBeVisible();
  await stage(page, "architect", 2);
  await expect(page.getByText("Shorten the environment-sizing table cell.", { exact: true })).toBeVisible();
  await send(page, { type: "result", report: acceptedFixture() }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(page.locator("[data-ai-stage]")).toHaveCount(0);
  await expect(page.locator("[data-recommendation-layout]")).toHaveAttribute("data-recommendation-layout", "classic");
  await expect(page.getByRole("heading", { name: "Recommendation summary", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended services", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommendation checks", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "AI Review (optional)", exact: true })).toBeEnabled();
  await expect(page.getByText("AI review passed", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(caseDirectory(info), "accepted-original-layout.png"), fullPage: true });
  expect(diagnostics(page).pageErrors).toEqual([]);
});

test("stream errors remove the preliminary draft and allow an explicit retry", async ({ page }) => {
  await login(page);
  await installStream(page);
  await loadExample(page);
  await stage(page, "reviewing");
  await send(page, { type: "error", code: "AI_PROVIDER_ERROR", error: "AI reviewer request failed at the model provider (HTTP 400)." }, true);
  const errorPanel = page.locator('section[role="alert"]');
  await expect(errorPanel).toContainText("AI reviewer request failed");
  await expect(page.locator('[data-preliminary-preview="true"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recommended services", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry AI recommendation", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(2);
  await send(page, { type: "result", report: acceptedFixture() }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(errorPanel).toHaveCount(0);
});

test("an optional review failure preserves the AI result and retry does not regenerate it", async ({ page }) => {
  await login(page);
  await installStream(page);
  await loadExample(page);
  const report = acceptedFixture();
  await send(page, { type: "result", report }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI Review (optional)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(2);
  await send(page, { type: "error", error: "The AI reviewer service is unavailable.", code: "AI_PROVIDER_ERROR" }, true);
  await expect(page.getByText("Previous AI result retained", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: report.solutionType, exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('[data-preliminary-preview="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Retry AI review", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(3);
  const requests = await page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests);
  expect(requests[1].operation).toBe("review");
  expect(requests[2]).toEqual(requests[1]);
  await page.getByRole("button", { name: "Back to wizard", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).aborts)).toBe(1);
  await expect(page.locator("[data-ai-stage]")).toHaveCount(0);
});

test("optional review findings stay alongside the architecture until the user chooses refinement", async ({ page }) => {
  await login(page);
  await installStream(page);
  await loadExample(page);
  const report = acceptedFixture();
  await send(page, { type: "result", report }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI Review (optional)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(2);
  await stage(page, "reviewing");
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Recommended services", exact: true })).toBeVisible();
  const findings = {
    ...report,
    review: { status: "issues-found" as const, model: "test-reviewer", reasoningEffort: "medium" as const,
      scope: "recommendation-and-architecture" as const, architectureId: report.architecture.id,
      summary: "Clarify the source authorization boundary.", issues: ["SharePoint must enforce its own document permissions."] }
  };
  await send(page, { type: "result", report: findings }, true);
  await expect(page.getByRole("region", { name: "Optional AI review findings" })).toContainText(findings.review.issues[0]);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.locator('section[role="alert"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(2);
  await page.getByRole("button", { name: "Apply review feedback", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests.length)).toBe(3);
  const requests = await page.evaluate(() => (Reflect.get(window, "__recommendationStreamTest") as StreamHarness).requests);
  expect(requests[2].operation).toBe("generate");
  expect(requests[2].userNotes).toContain("Address the optional AI review findings");
  await send(page, { type: "result", report: acceptedFixture("Updated AI proposal.") }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Optional AI review findings" })).toHaveCount(0);
});

test("a reviewer that is not configured does not block generation or exports", async ({ page }) => {
  await login(page);
  await installStream(page, false);
  await loadExample(page);
  await send(page, { type: "result", report: acceptedFixture() }, true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Review (optional)", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
  await expect(page.locator('section[role="alert"]')).toHaveCount(0);
});
