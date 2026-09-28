import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { DecisionInput } from "../../lib/types";
import { acceptedFixture } from "./recommendation-fixture";
import { caseDirectory, diagnostics, login, mockWizardAssistance } from "./helpers";

function fixture(input: DecisionInput, title = "Synthetic reviewed report") {
  const accepted = acceptedFixture(input.summary || title);
  return {
    ...accepted, useCaseTitle: title,
    proposedArchitectureSummary: `${title}. ${accepted.proposedArchitectureSummary}`
  };
}

async function controlledRecommendations(page: Page) {
  const captured: Array<Record<string, unknown>> = [];
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
      return;
    }
    const body = route.request().postDataJSON();
    captured.push(body);
    await route.fulfill({ json: fixture(body.input) });
  });
  return captured;
}

async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("ai-pdn:input") || "{}"));
}

test.afterEach(async ({ page }, info) => {
  const directory = caseDirectory(info);
  fs.writeFileSync(path.join(directory, "browser-diagnostics.json"), JSON.stringify(diagnostics(page), null, 2));
  if (!page.isClosed()) fs.writeFileSync(path.join(directory, "last-visible-state.txt"), await page.locator("body").innerText());
});

test("keyboard walkthroughs and example filters work at desktop and mobile widths", async ({ page }, info) => {
  await login(page, true);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const filters = page.getByRole("group", { name: "Filter scenarios by platform" });
  for (const platform of ["Copilot Studio", "AI Foundry", "Hybrid"]) {
    await filters.getByRole("button", { name: `${platform} 5`, exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(5);
  }
  await filters.getByRole("button", { name: "All scenarios 15", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(15);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Start your use case", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(caseDirectory(info), "mobile-landing.png"), fullPage: true });
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Tell us the scenario", level: 1 })).toBeVisible();
});

test("empty shortcut, wrong choices, backtracking and refresh preserve the corrected profile", async ({ page }) => {
  await login(page);
  await mockWizardAssistance(page);
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await page.getByRole("checkbox", { name: /Skip the wizard/ }).check();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Users and access", level: 1 })).toBeVisible();
  expect((await saved(page)).input.directTextRecommendation).toBe(false);
  const users = page.getByRole("region", { name: "Who uses it?", exact: true });
  const channels = page.getByRole("region", { name: "Where will they open it?", exact: true });
  await users.getByRole("button", { name: "Customers outside your organization", exact: true }).click();
  await users.getByRole("button", { name: "Customers outside your organization", exact: true }).click();
  await users.getByRole("button", { name: "Employees inside your organization", exact: true }).click();
  await channels.getByRole("button", { name: "Web app", exact: true }).click();
  await channels.getByRole("button", { name: "Web app", exact: true }).click();
  await channels.getByRole("button", { name: "Teams", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What it should do", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(users.getByRole("button", { name: "Employees inside your organization", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Users and access", level: 1 })).toBeVisible();
  const state = await saved(page);
  expect(state.input.users).toEqual(["internal_employees"]);
  expect(state.input.channels).toEqual(["teams"]);
  await users.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue →", exact: true })).toBeDisabled();
  await users.getByRole("button", { name: "Employees inside your organization", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue →", exact: true })).toBeEnabled();
});

test("skipping optional sections reaches a recommendation without leaking old example answers", async ({ page }) => {
  await login(page);
  await mockWizardAssistance(page);
  const requests = await controlledRecommendations(page);
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  for (let section = 0; section < 6; section++) {
    if (await page.getByRole("heading", { name: "All sections answered", exact: true }).isVisible()) break;
    const previous = (await saved(page)).confirmed.length;
    await page.getByRole("button", { name: "Skip section", exact: true }).click();
    await expect.poll(async () => (await saved(page)).confirmed.length).toBeGreaterThan(previous);
  }
  await expect(page.getByRole("heading", { name: "All sections answered", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View recommendation", exact: true }).last().click();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  const input = requests[0].input as Record<string, unknown>;
  expect(input.users).toEqual(["unknown"]);
  expect(input.channels).toEqual(["unknown"]);
  expect(input.directTextRecommendation ?? false).toBe(false);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start your use case", exact: true })).toBeVisible();
  expect((await saved(page)).input.users).toEqual([]);
});

test("editing an example into a new direct-text scenario removes the old audience and data", async ({ page }) => {
  await login(page);
  await mockWizardAssistance(page);
  const requests = await controlledRecommendations(page);
  await page.getByRole("article").filter({ hasText: "HR policy answers in Teams" })
    .getByRole("button", { name: "Build in Wizard", exact: true }).click();
  const summary = "Customers use a public mobile app to read their own insurance claims and supporting PDF documents. Require external identity and citations. No record updates.";
  await page.getByRole("textbox", { name: "Tell us the scenario", exact: true }).fill(summary);
  await page.getByRole("checkbox", { name: /Skip the wizard/ }).check();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  const input = requests[0].input as Record<string, unknown>;
  expect(input.summary).toBe(summary);
  expect(input.channels).toContain("mobile");
  expect(input.channels).not.toContain("teams");
  expect(input.users).not.toContain("internal_employees");
  expect(input.dataSources).not.toContain("sharepoint");
  await page.reload();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].input).toEqual(requests[0].input);
});

test("a failed wizard batch cannot apply a late successful filter over the visible error", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wizard-filter", async route => {
    const body = route.request().postDataJSON();
    if (body.questionId === "users") {
      await route.fulfill({ status: 503, json: { error: "Synthetic unavailable filter." } });
    } else {
      await delayed;
      if (!route.request().failure()) {
        await route.fulfill({ json: { eliminate: [{ id: "mobile", reason: "Synthetic late filter." }] } });
      }
    }
  });
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "All choices remain visible" })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Mobile app", exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await expect(page.getByRole("button", { name: "Mobile app", exact: true })).toBeVisible();
});

test("a review can finish after the old deadline without duplicate requests or password auth refresh", async ({ page }) => {
  await login(page);
  await page.clock.install();
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
    count++;
    await delayed;
    await route.fulfill({ json: fixture(route.request().postDataJSON().input) });
  });
  const sent = page.waitForRequest(request => new URL(request.url()).pathname === "/api/tiebreak" && request.method() === "POST");
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  await sent;
  await page.clock.fastForward(121_000);
  expect(count).toBe(1);
  release();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  expect(count).toBe(1);
  expect(diagnostics(page).httpErrors.filter(item => item.path === "/.auth/refresh")).toEqual([]);
});

test("an AI refinement replaces the prior artifact and protects unsaved notes on navigation", async ({ page }) => {
  await login(page);
  let requests = 0;
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
    const body = route.request().postDataJSON();
    requests++;
    if (requests > 1) expect(body.previousRecommendation.authority).toBe("ai");
    await route.fulfill({ json: fixture(body.input, requests === 1 ? "OLD_INITIAL_REPORT" : "LATEST_REFINED_REPORT") });
  });
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  const notes = page.getByRole("textbox", { name: "Refine the recommendation", exact: true });
  await expect(notes).toBeVisible();
  await notes.fill("Explain document permissions and keep the operation read-only.");
  await page.getByRole("button", { name: "Apply refinement", exact: true }).click();
  await expect(page.getByText(/LATEST_REFINED_REPORT/).first()).toBeVisible();
  await expect(page.getByText(/OLD_INITIAL_REPORT/)).toHaveCount(0);
  expect(requests).toBe(2);
  const dismiss = page.waitForEvent("dialog").then(dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Back to wizard", exact: true }).click();
  await dismiss;
  await expect(page.getByRole("textbox", { name: "Refine the recommendation", exact: true })).toBeVisible();
  const accept = page.waitForEvent("dialog").then(dialog => dialog.accept());
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await accept;
  await expect(page.getByRole("button", { name: "Start your use case", exact: true })).toBeVisible();
  expect((await saved(page)).input.summary ?? "").toBe("");
});

test("an unavailable AI report shows an explicit error and no deterministic recommendation", async ({ page }) => {
  await login(page);
  let count = 0;
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
    count++;
    await route.fulfill({ status: 503, json: { error: "Synthetic model service unavailable." } });
  });
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  await expect(page.getByText("AI recommendation unavailable", { exact: true })).toBeVisible();
  expect(count).toBe(1);
  await expect(page.getByRole("button", { name: "Generate architecture", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recommended services", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export as PowerPoint", exact: true })).toBeDisabled();
  await expect(page.getByText("AI-generated", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry AI recommendation", exact: true })).toBeEnabled();
});

test("password sessions protect APIs and admin access and logout invalidates browser access", async ({ page }) => {
  await login(page);
  const cookies = await page.context().cookies();
  const session = cookies.find(cookie => cookie.name === "__Host-pathfinder-session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  const admin = await page.request.get("/api/admin/usage", {
    headers: { "x-ms-client-principal-name": "operator@example.test" }
  });
  expect(admin.status()).toBe(403);
  const foreign = await page.request.post("/api/usage", { headers: { Origin: "https://untrusted.example" }, data: {} });
  expect(foreign.status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Access password")).toBeVisible();
  expect((await page.request.get("/api/tiebreak")).status()).toBe(401);
  const invalid = await page.request.post("/api/auth/login", {
    headers: { Origin: new URL(page.url()).origin },
    form: { password: "invalid-synthetic-password" }, maxRedirects: 0
  });
  expect(invalid.status()).toBe(303);
  expect(invalid.headers()["set-cookie"]).toBeUndefined();
  expect(invalid.headers().location).toContain("error=invalid");
});

test("rapid navigation cancels a pending review and never restores the abandoned scenario", async ({ page }) => {
  await login(page);
  await mockWizardAssistance(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
    await pending;
    if (!route.request().failure()) await route.fulfill({ json: fixture(route.request().postDataJSON().input, "ABANDONED_SCENARIO") });
  });
  const started = page.waitForRequest(request => new URL(request.url()).pathname === "/api/tiebreak" && request.method() === "POST");
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  const request = await started;
  const cancelled = page.waitForEvent("requestfailed", item => item === request);
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await cancelled;
  release();
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us the scenario", exact: true }).fill("A new unrelated scenario for a new customer.");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(page.getByText(/ABANDONED_SCENARIO/)).toHaveCount(0);
  expect((await saved(page)).stage).toBe("wizard");
  expect((await saved(page)).input.summary).toBe("A new unrelated scenario for a new customer.");
});

test("repeated back-and-forth edits converge to the last choices without advancing twice", async ({ page }) => {
  await login(page);
  await mockWizardAssistance(page);
  await page.getByRole("button", { name: "Start your use case", exact: true }).click();
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  const users = page.getByRole("region", { name: "Who uses it?", exact: true });
  const channels = page.getByRole("region", { name: "Where will they open it?", exact: true });
  for (let round = 0; round < 3; round++) {
    const selected = users.getByRole("button", { name: "Employees inside your organization", exact: true });
    if (await selected.getAttribute("aria-pressed") !== "true") await selected.click();
    await users.getByRole("button", { name: "Partner organizations", exact: true }).click();
    await users.getByRole("button", { name: "Partner organizations", exact: true }).click();
    const teams = channels.getByRole("button", { name: "Teams", exact: true });
    if (await teams.getAttribute("aria-pressed") !== "true") await teams.click();
    await channels.getByRole("button", { name: "Web app", exact: true }).click();
    await channels.getByRole("button", { name: "Web app", exact: true }).click();
    await page.getByRole("button", { name: "Continue →", exact: true }).click({ clickCount: 2, delay: 30 });
    await expect(page.getByRole("heading", { name: "What it should do", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Users and access", level: 1 })).toBeVisible();
  }
  const state = await saved(page);
  expect(state.input.users).toEqual(["internal_employees"]);
  expect(state.input.channels).toEqual(["teams"]);
  expect(new Set(state.confirmed).size).toBe(state.confirmed.length);
});
