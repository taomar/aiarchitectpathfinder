import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { RECOMMENDATION_CLIENT_TIMEOUT_MS } from "../../lib/recommendation-policy";
import { readRecommendationResponse } from "../../lib/recommendation-progress";
import { recommendationContent } from "../../lib/recommendation-contract";
import { MAX_POWERPOINT_SLIDES } from "../../lib/powerpoint";
import { caseDirectory, capturePowerPoint, diagnostics, login, progress, reviewAfter } from "./helpers";

test(process.env.E2E_REPLAY_DIR ? "recorded real recommendation renders its clean architecture" : "recommendation appears before the separate background architecture call", async ({ page }, info) => {
  test.setTimeout(RECOMMENDATION_CLIENT_TIMEOUT_MS * 2 + 120_000);
  await login(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      const response = await original(url, init);
      if (init?.method === "POST" && String(url).endsWith("/api/tiebreak") &&
          JSON.parse(String(init.body)).operation === "architecture") {
        Reflect.set(window, "__qaArchitectureResult", response.clone().text().then(text => ({
          text, status: response.status, contentType: response.headers.get("content-type") ?? "application/json"
        })));
      }
      return response;
    };
  });
  const directory = caseDirectory(info);
  const captured = await reviewAfter(page, "recommendation-first", async () => {
    await page.getByRole("article").filter({ hasText: "HR policy answers in Teams" })
      .getByRole("button", { name: "Load this Scenario", exact: true }).click();
  }, directory);
  expect(captured.report.generation.reasoningEffort).toBe("xhigh");
  expect(captured.report.review.status).toBe("not-requested");
  await expect(page.getByRole("heading", { name: captured.report.solutionType, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Refine the recommendation", exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(directory, "recommendation-before-architecture.png"), fullPage: true });
  let report = captured.report;
  if (!process.env.E2E_REPLAY_DIR) expect(report.architecture).toBeNull();
  if (!report.architecture) {
    await page.waitForFunction(() => !!Reflect.get(window, "__qaArchitectureResult"), null, { timeout: RECOMMENDATION_CLIENT_TIMEOUT_MS });
    const response = await progress("Background architecture", () => page.evaluate(() => Reflect.get(window, "__qaArchitectureResult") as Promise<{ text: string; status: number; contentType: string }>));
    report = await readRecommendationResponse(new Response(response.text, { status: response.status, headers: { "Content-Type": response.contentType } }),
      event => console.log(`OBSERVED architecture phase: ${event.stage}`));
  }
  expect(recommendationContent(report)).toEqual(recommendationContent(captured.report));
  expect(report.reportId).toBe(captured.report.reportId);
  expect(report.architecture).not.toBeNull();
  if (!report.architecture) throw new Error("Background architecture did not arrive.");
  fs.writeFileSync(path.join(directory, "completed-architecture.json"), JSON.stringify({ ...captured, report }, null, 2));
  await expect(page.getByText("Architecture and image are ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View architecture", exact: true }).click();
  const diagram = page.getByRole("img", { name: /^Architecture diagram for/ });
  await expect(diagram.locator("svg")).toBeVisible();
  const ids = await diagram.locator("[data-component-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-component-id")).sort());
  expect(ids).toEqual(report.architecture.graph.nodes.map(node => node.id).sort());
  await expect(diagram.locator("[data-connection-id]")).toHaveCount(report.architecture.graph.edges.length);
  await diagram.screenshot({ path: path.join(directory, "clean-architecture.png") });
  const flow = page.locator("section").filter({ has: page.getByRole("heading", { name: "High-level solution flow", exact: true }) });
  await expect(flow.locator("svg g.node")).toHaveCount(report.architecture.flow.nodes.length);
  await expect(flow.locator("svg .flowchart-link")).toHaveCount(report.architecture.flow.edges.length);
  await flow.screenshot({ path: path.join(directory, "high-level-flow.png") });
  await page.getByRole("button", { name: /^Technical\b/ }).click();
  const sizing = page.locator("section").filter({ has: page.getByRole("heading", { name: "Services and Dev / Test / Prod sizing", exact: true }) });
  for (const service of report.serviceSizing) {
    const row = sizing.getByRole("row").filter({ has: page.getByText(service.name, { exact: true }) });
    await expect(row).toContainText(service.dev);
    await expect(row).toContainText(service.prod);
  }
  const artifact = await capturePowerPoint(page, directory, "recommendation-with-architecture.pptx");
  const slides = artifact.content as Array<{ slide: string; text: string }>;
  expect(slides.length).toBeLessThanOrEqual(MAX_POWERPOINT_SLIDES);
  const text = slides.map(slide => slide.text).join("\n").replace(/\s+/g, " ");
  for (const service of report.serviceSizing) expect(text).toContain(service.name.replace(/\s+/g, " "));
  expect(diagnostics(page).pageErrors).toEqual([]);
  console.log(`OBSERVED text first, then ${report.architecture.graph.nodes.length} diagram components, ${report.architecture.flow.nodes.length} flow nodes, ${slides.length} slides.`);
});
