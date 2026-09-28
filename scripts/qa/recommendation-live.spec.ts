import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { RECOMMENDATION_CLIENT_TIMEOUT_MS } from "../../lib/recommendation-policy";
import { MAX_POWERPOINT_SLIDES } from "../../lib/powerpoint";
import { caseDirectory, capturePowerPoint, diagnostics, login, reviewAfter } from "./helpers";

test(process.env.E2E_REPLAY_DIR ? "recorded real Sol maximum result renders high-level views and exports" : "live Sol maximum generation reaches the browser and exports before optional review", async ({ page }, info) => {
  test.setTimeout(RECOMMENDATION_CLIENT_TIMEOUT_MS + 120_000);
  await login(page);
  const directory = caseDirectory(info);
  const captured = await reviewAfter(page, "live-ai-authority", async () => {
    await page.getByRole("article").filter({ hasText: "HR policy answers in Teams" })
      .getByRole("button", { name: "Load this Scenario", exact: true }).click();
    if (!process.env.E2E_REPLAY_DIR) {
      await expect(page.locator('[data-preliminary-preview="true"]')).toBeVisible();
      await expect(page.locator("[data-ai-stage]")).toHaveAttribute("data-ai-stage", /architect|revising/);
      await page.screenshot({ path: path.join(directory, "real-ai-progress.png"), fullPage: true });
    }
  }, directory);
  expect(captured.report.authority).toBe("ai");
  expect(captured.report.generation.reasoningEffort).toBe("xhigh");
  expect(captured.report.aiValidated).toBe(false);
  expect(captured.report.review.status).toBe("not-requested");
  expect(captured.report.agentTrace.find(item => item.agent === "Architecture Critic")?.status).toBe("skipped");
  await expect(page.locator('[data-preliminary-preview="true"]')).toHaveCount(0);
  await expect(page.locator("[data-recommendation-layout]")).toHaveAttribute("data-recommendation-layout", "classic");
  await expect(page.getByRole("heading", { name: captured.report.solutionType, exact: true, level: 1 })).toBeVisible();
  await page.screenshot({ path: path.join(directory, "accepted-ai-original-layout.png"), fullPage: true });
  await page.getByRole("button", { name: /^Architecture\b/ }).click();
  await page.getByRole("button", { name: "Generate architecture", exact: true }).click();
  const diagram = page.getByRole("img", { name: /^Architecture diagram for/ });
  await expect(diagram.locator("svg")).toBeVisible();
  const ids = await diagram.locator("[data-component-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-component-id")).sort());
  expect(ids).toEqual(captured.report.architectureGraph.nodes.map(node => node.id).sort());
  await expect(diagram.locator("[data-connection-id]")).toHaveCount(captured.report.architectureGraph.edges.length);
  await expect(diagram.locator("[data-connection-label]")).toHaveCount(captured.report.architectureGraph.edges.length);
  const flow = page.locator("section").filter({ has: page.getByRole("heading", { name: "High-level solution flow", exact: true }) });
  await expect(flow.locator("svg g.node")).toHaveCount(captured.report.highLevelFlow.length);
  await expect(flow.locator("svg .flowchart-link")).toHaveCount(captured.report.highLevelFlow.length - 1);
  await flow.screenshot({ path: path.join(directory, "live-ai-high-level-flow.png") });
  await diagram.screenshot({ path: path.join(directory, "live-ai-graph.png") });
  await page.getByRole("button", { name: /^Technical\b/ }).click();
  await expect(page.getByRole("heading", { name: "Services and Dev / Test / Prod sizing", exact: true })).toBeVisible();
  const sizingSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Services and Dev / Test / Prod sizing", exact: true }) });
  for (const service of captured.report.serviceSizing) {
    const row = sizingSection.getByRole("row").filter({ has: page.getByText(service.name, { exact: true }) });
    await expect(row).toContainText(service.dev);
    await expect(row).toContainText(service.test);
    await expect(row).toContainText(service.prod);
  }
  const artifact = await capturePowerPoint(page, directory, "live-ai-concise.pptx");
  const slides = artifact.content as Array<{ slide: string; text: string }>;
  expect(slides.length).toBeLessThanOrEqual(MAX_POWERPOINT_SLIDES);
  const slideText = slides.map(slide => slide.text).join("\n").replace(/\s+/g, " ");
  for (const service of captured.report.serviceSizing) {
    expect(slideText).toContain(service.name.replace(/\s+/g, " "));
  }
  expect(diagnostics(page).pageErrors).toEqual([]);
  fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(diagnostics(page), null, 2));
  console.log(`OBSERVED accepted live AI: ${captured.report.solutionType}; ${captured.report.architectureGraph.nodes.length} nodes; ${captured.report.architectureGraph.edges.length} edges; ${slides.length} slides.`);
});
