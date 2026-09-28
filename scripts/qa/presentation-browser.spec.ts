import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { prepareDecisionInputForRecommendation } from "../../lib/summary-intake";
import { ARCHITECTURE_DISCLAIMER, buildArchitectureView } from "../../lib/architecture-view";
import { buildArchitectureLayout } from "../../lib/architecture-layout";
import { caseDirectory, capturePowerPoint, diagnostics, login } from "./helpers";

test("all shipped scenarios render the same layered model on the recommendation page", async ({ page }, info) => {
  test.setTimeout(180_000);
  await login(page);
  await page.route("**/api/tiebreak", async route => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: { enabled: false, authRefreshEnabled: false } });
  });
  for (const [index, example] of EXAMPLES.entries()) {
    await page.getByRole("article").nth(index).getByRole("button", { name: "Load this Scenario", exact: true }).click();
    await page.getByRole("button", { name: /^Architecture\b/ }).click();
    await expect(page.getByRole("heading", { name: "Connected Microsoft architecture", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Generate architecture", exact: true }).click();
    const diagram = page.getByRole("img", { name: /^Architecture diagram for/ });
    await expect(diagram.locator("svg")).toBeVisible();
    const input = prepareDecisionInputForRecommendation(example.input);
    const model = buildArchitectureView(decide(input), input);
    const actualIds = await diagram.locator("[data-component-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-component-id")).sort());
    expect(actualIds).toEqual(model.layers.flatMap(layer => layer.nodes.map(node => node.id)).sort());
    await expect(diagram.locator("[data-connection-id]")).toHaveCount(buildArchitectureLayout(model).connections.length);
    expect(await diagram.locator("polyline[marker-end]").count()).toBeGreaterThan(0);
    await expect(diagram).toContainText(ARCHITECTURE_DISCLAIMER);
    const flow = page.locator("section").filter({ has: page.getByRole("heading", { name: "Service flow", exact: true }) });
    await expect(flow.locator("svg")).toBeVisible();
    console.log(`PASS rendered layers and flow: ${example.id}`);
    if ([0, 5, 10].includes(index)) await diagram.screenshot({ path: path.join(caseDirectory(info), `${example.id}.png`) });
    if (index === 5) {
      await page.getByLabel("Diagram detail", { exact: true }).selectOption("preparation");
      await expect(diagram.locator("[data-connection-id]")).toHaveCount(buildArchitectureLayout(model, "preparation").connections.length);
      await page.getByRole("button", { name: "Zoom in architecture", exact: true }).click();
      await expect(page.getByRole("button", { name: "Fit (125%)", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Fit (125%)", exact: true }).click();
    }
    await page.getByRole("button", { name: "Start over", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start your use case", exact: true })).toBeVisible();
  }
  fs.writeFileSync(path.join(caseDirectory(info), "diagnostics.json"), JSON.stringify(diagnostics(page), null, 2));
  expect(diagnostics(page).pageErrors).toEqual([]);
  expect(diagnostics(page).httpErrors).toEqual([]);
});

test("the browser downloads the redesigned Microsoft-branded presentation", async ({ page }, info) => {
  await login(page);
  await page.route("**/api/tiebreak", route => route.fulfill({ json: { enabled: false, authRefreshEnabled: false } }));
  await page.getByRole("article").filter({ hasText: "Customer claims app" })
    .getByRole("button", { name: "Load this Scenario", exact: true }).click();
  const artifact = await capturePowerPoint(page, caseDirectory(info), "redesigned-browser-export.pptx");
  const slides = artifact.content as Array<{ slide: string; text: string }>;
  expect(slides.every(slide => slide.text.includes(ARCHITECTURE_DISCLAIMER))).toBe(true);
  expect(slides.some(slide => slide.text.includes("Technical appendix"))).toBe(true);
  expect(slides.every(slide => !/\+\s*\d+\s+more items|…/.test(slide.text))).toBe(true);
  expect(diagnostics(page).pageErrors).toEqual([]);
  expect(diagnostics(page).httpErrors).toEqual([]);
});
