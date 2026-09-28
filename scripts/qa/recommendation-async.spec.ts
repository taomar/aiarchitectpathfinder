import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { acceptedFixture, initialFixture } from "./recommendation-fixture";
import { caseDirectory, diagnostics, login } from "./helpers";

async function load(page: Page) {
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
}
function latch() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

test("recommendation renders first while automatic architecture builds independently", async ({ page }, info) => {
  await login(page);
  const gate = latch();
  const initial = initialFixture();
  const completed = acceptedFixture();
  const operations: string[] = [];
  let visibleAtArchitectureRequest = false;
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, reviewAvailable: true } });
    const request = route.request().postDataJSON();
    operations.push(request.operation);
    if (request.operation === "generate") return route.fulfill({ json: initial });
    expect(request.operation).toBe("architecture");
    expect(request.previousRecommendation.reportId).toBe(initial.reportId);
    visibleAtArchitectureRequest = await page.getByRole("heading", { name: "Recommendation summary", exact: true }).isVisible();
    await gate.promise;
    await route.fulfill({ json: completed });
  });
  await load(page);
  await expect.poll(() => operations).toEqual(["generate", "architecture"]);
  expect(visibleAtArchitectureRequest).toBe(true);
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Architecture build notification" })).toContainText("Recommendation ready");
  await expect(page.getByRole("textbox", { name: "Refine the recommendation", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "AI Review (optional)", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeDisabled();
  await page.screenshot({ path: path.join(caseDirectory(info), "text-before-diagram.png"), fullPage: true });
  await page.getByRole("button", { name: /^Architecture\b/ }).click();
  await expect(page.getByRole("img", { name: /^Architecture diagram for/ })).toHaveCount(0);
  gate.release();
  await expect(page.getByText("Architecture and image are ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Architecture diagram for/ }).locator("svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
  expect(operations).toEqual(["generate", "architecture"]);
  expect(diagnostics(page).pageErrors).toEqual([]);
});

test("background failure retains the recommendation and retry does not repeat generation", async ({ page }) => {
  await login(page);
  let builds = 0;
  const operations: string[] = [];
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, reviewAvailable: true } });
    const request = route.request().postDataJSON();
    operations.push(request.operation);
    if (request.operation === "generate") return route.fulfill({ json: initialFixture() });
    builds++;
    return builds === 1 ? route.fulfill({ status: 502, json: { error: "Synthetic image renderer unavailable.", code: "AI_VISUAL_ERROR" } })
      : route.fulfill({ json: acceptedFixture() });
  });
  await load(page);
  const notice = page.getByRole("region", { name: "Architecture build notification" });
  await expect(notice).toContainText("Synthetic image renderer unavailable.");
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recommended services", exact: true })).toBeVisible();
  await expect(page.locator('section[role="alert"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Retry architecture image", exact: true }).click();
  await expect(notice).toContainText("Architecture and image are ready");
  expect(operations).toEqual(["generate", "architecture", "architecture"]);
});

for (const architectureFinishesFirst of [true, false]) {
  test(`concurrent optional review and image build preserve both results (${architectureFinishesFirst ? "image" : "review"} first)`, async ({ page }) => {
    await login(page);
    const imageGate = latch(), reviewGate = latch();
    const report = initialFixture();
    const reviewed = { ...report, aiValidated: true, review: {
      status: "passed" as const, model: "test-reviewer", reasoningEffort: "medium" as const,
      scope: "recommendation" as const, architectureId: null,
      summary: "Recommendation text reviewed without its pending diagram.", issues: []
    } };
    let reviews = 0;
    await page.route("**/api/tiebreak", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, reviewAvailable: true } });
      const request = route.request().postDataJSON();
      if (request.operation === "generate") return route.fulfill({ json: report });
      if (request.operation === "architecture") { await imageGate.promise; return route.fulfill({ json: acceptedFixture() }); }
      reviews++;
      await reviewGate.promise;
      return route.fulfill({ json: reviewed });
    });
    await load(page);
    await expect(page.getByRole("region", { name: "Architecture build notification" })).toContainText("building architecture");
    await page.getByRole("button", { name: "AI Review (optional)", exact: true }).click();
    await expect.poll(() => reviews).toBe(1);
    if (architectureFinishesFirst) {
      imageGate.release();
      await expect(page.getByText("Architecture and image are ready", { exact: true })).toBeVisible();
      reviewGate.release();
    } else {
      reviewGate.release();
      await expect(page.getByRole("region", { name: "Optional AI review findings" })).toBeVisible();
      imageGate.release();
    }
    await expect(page.getByRole("region", { name: "Optional AI review findings" })).toContainText("diagram not reviewed");
    await expect(page.getByText("Architecture and image are ready", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View architecture", exact: true }).click();
    await expect(page.getByRole("img", { name: /^Architecture diagram for/ }).locator("svg")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeEnabled();
    expect(diagnostics(page).pageErrors).toEqual([]);
  });
}

test("navigation cancels an in-flight background architecture request", async ({ page }) => {
  await login(page);
  const gate = latch();
  let requested = false;
  let cancelled = false;
  page.on("requestfailed", request => {
    if (request.url().endsWith("/api/tiebreak") && request.method() === "POST" &&
        request.postDataJSON().operation === "architecture") cancelled = true;
  });
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
    if (route.request().postDataJSON().operation === "generate") return route.fulfill({ json: initialFixture() });
    requested = true;
    await gate.promise;
    if (!route.request().failure()) await route.fulfill({ json: acceptedFixture() });
  });
  await load(page);
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start your use case", exact: true })).toBeVisible();
  await expect.poll(() => cancelled).toBe(true);
  gate.release();
  await expect(page.getByRole("region", { name: "Architecture build notification" })).toHaveCount(0);
});

test("a refined recommendation cannot receive an obsolete diagram response", async ({ page }) => {
  await login(page);
  const oldGate = latch();
  const oldReport = initialFixture("Original recommendation snapshot.");
  const newReport = initialFixture("Updated recommendation snapshot.");
  let generations = 0, oldBuildStarted = false, oldBuildCancelled = false;
  page.on("requestfailed", request => {
    if (request.url().endsWith("/api/tiebreak") && request.method() === "POST" &&
        request.postDataJSON().operation === "architecture" &&
        request.postDataJSON().previousRecommendation.reportId === oldReport.reportId) oldBuildCancelled = true;
  });
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, reviewAvailable: true } });
    const request = route.request().postDataJSON();
    if (request.operation === "generate") return route.fulfill({ json: ++generations === 1 ? oldReport : newReport });
    if (request.previousRecommendation.reportId === oldReport.reportId) {
      oldBuildStarted = true;
      await oldGate.promise;
      if (!route.request().failure()) return route.fulfill({ json: acceptedFixture(oldReport.useCaseSummary) });
      return;
    }
    return route.fulfill({ json: acceptedFixture(newReport.useCaseSummary) });
  });
  await load(page);
  await expect.poll(() => oldBuildStarted).toBe(true);
  await page.getByRole("textbox", { name: "Refine the recommendation", exact: true }).fill("Clarify the current source boundary.");
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect.poll(() => oldBuildCancelled).toBe(true);
  await expect(page.getByText(newReport.useCaseSummary, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Architecture and image are ready", { exact: true })).toBeVisible();
  oldGate.release();
  await expect(page.getByText(oldReport.useCaseSummary, { exact: true })).toHaveCount(0);
  expect(generations).toBe(2);
  expect(diagnostics(page).pageErrors).toEqual([]);
});
