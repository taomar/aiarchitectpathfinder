import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { acceptedFixture } from "./recommendation-fixture";
import { ARCHITECTURE_DISCLAIMER } from "../../lib/architecture-view";
import { approvedArchitectureView } from "../../lib/recommendation-contract";
import { buildArchitectureLayout } from "../../lib/architecture-layout";
import { MAX_POWERPOINT_SLIDES } from "../../lib/powerpoint";
import { caseDirectory, capturePowerPoint, diagnostics, login } from "./helpers";

test("accepted AI nodes and edges render without another evaluation", async ({ page }, info) => {
  await login(page);
  const report = acceptedFixture();
  let generations = 0;
  await page.route("**/api/tiebreak", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, authRefreshEnabled: false } });
    generations++;
    await route.fulfill({ json: report });
  });
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Architecture\b/ }).click();
  const diagram = page.getByRole("img", { name: /^Architecture diagram for/ });
  await expect(diagram.locator("svg")).toBeVisible();
  const model = approvedArchitectureView(report.architecture);
  const ids = await diagram.locator("[data-component-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-component-id")).sort());
  expect(ids).toEqual(report.architecture.graph.nodes.map(node => node.id).sort());
  await expect(diagram.locator("[data-connection-id]")).toHaveCount(report.architecture.graph.edges.length);
  await expect(diagram.locator("[data-connection-label]")).toHaveCount(report.architecture.graph.edges.length);
  await expect(diagram.locator("[data-flow-number]")).toHaveCount(0);
  const bands = await diagram.locator('[data-stack-band="layer"] > rect:first-of-type').evaluateAll(elements => elements.map(element => ({
    x: Number(element.getAttribute("x")), y: Number(element.getAttribute("y")),
    width: Number(element.getAttribute("width")), height: Number(element.getAttribute("height"))
  })));
  expect(bands.length).toBeGreaterThan(2);
  for (const [index, band] of bands.entries()) {
    expect(band.x).toBe(bands[0].x);
    expect(band.width).toBe(bands[0].width);
    if (index) expect(band.y).toBeGreaterThanOrEqual(bands[index - 1].y + bands[index - 1].height);
  }
  await expect(diagram.locator('[data-boundary-id="cross-cutting"][data-stack-band="layer"]')).toHaveCount(1);
  await expect(diagram).not.toContainText("Connection references");
  await expect(diagram).not.toContainText("Open decisions / validation conditions");
  const flow = page.locator("section").filter({ has: page.getByRole("heading", { name: "High-level solution flow", exact: true }) });
  await expect(flow.locator("svg g.node")).toHaveCount(report.architecture.flow.nodes.length);
  await expect(flow.locator("svg g.cluster")).toHaveCount(0);
  await expect(flow.locator("svg .flowchart-link")).toHaveCount(report.architecture.flow.edges.length);
  await expect(diagram).toContainText(ARCHITECTURE_DISCLAIMER);
  await diagram.screenshot({ path: path.join(caseDirectory(info), "ai-approved-architecture.png") });
  await page.getByLabel("Diagram detail", { exact: true }).selectOption("preparation");
  await expect(diagram.locator("[data-connection-id]")).toHaveCount(buildArchitectureLayout(model, "preparation").connections.length);
  await page.getByRole("button", { name: "Zoom in architecture", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fit (125%)", exact: true })).toBeVisible();
  expect(generations, "Changing diagram presentation must not re-run AI or deterministic evaluation.").toBe(1);
  expect(diagnostics(page).pageErrors).toEqual([]);
  fs.writeFileSync(path.join(caseDirectory(info), "diagnostics.json"), JSON.stringify(diagnostics(page), null, 2));
});

test("browser exports at most 15 slides with Dev Test Prod table and no appendix", async ({ page }, info) => {
  await login(page);
  const report = acceptedFixture();
  await page.route("**/api/tiebreak", route => route.fulfill({ json: route.request().method() === "GET" ? { enabled: true } : report }));
  await page.getByRole("article").first().getByRole("button", { name: "Load this Scenario", exact: true }).click();
  await expect(page.getByText("AI-generated", { exact: true })).toBeVisible();
  const artifact = await capturePowerPoint(page, caseDirectory(info), "concise-ai-export.pptx");
  const slides = artifact.content as Array<{ slide: string; text: string }>;
  expect(slides.length).toBeLessThanOrEqual(MAX_POWERPOINT_SLIDES);
  expect(slides.every(slide => slide.text.includes(ARCHITECTURE_DISCLAIMER))).toBe(true);
  expect(slides.some(slide => /Azure services.*sizing/.test(slide.text))).toBe(true);
  expect(slides.some(slide => /Dev/.test(slide.text) && /Test/.test(slide.text) && /Prod/.test(slide.text))).toBe(true);
  expect(slides.every(slide => !/Technical appendix|Presenter note/.test(slide.text))).toBe(true);
  expect(diagnostics(page).pageErrors).toEqual([]);
});
