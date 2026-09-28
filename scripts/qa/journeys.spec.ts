import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { caseDirectory, captureDiagrams, capturePowerPoint, diagnostics, judgeOutputs, login, mockWizardAssistance, progress, reviewAfter, type OutputArtifact } from "./helpers";

test.afterEach(async ({ page }, info) => {
  fs.writeFileSync(path.join(caseDirectory(info), "browser-diagnostics.json"), JSON.stringify(diagnostics(page), null, 2));
  if (!page.isClosed()) {
    fs.writeFileSync(path.join(caseDirectory(info), "last-visible-state.txt"), await page.locator("body").innerText());
  }
});

for (const scenario of [
  {
    name: "external mobile claims",
    story: "Customer claims app",
    expected: /AI Foundry/,
    intent: "External policyholders use a public mobile app to check their own claims and ask questions about their own claim documents, with exact source citations. It is read-only and must enforce access to each customer's records.",
    requirements: ["External identity and per-customer authorization.", "Document retrieval and citations, distinct from governed claim-status API lookup.", "No direct model writes, no implied M365 Agents SDK.", "Do not assert private-only networking unless it is a prerequisite/option, rather than a selected requirement."],
    notes: "Explain how customer-specific authorization is enforced before document retrieval and claim lookup. Keep this read-only; do not add new requirements."
  },
  {
    name: "hybrid document search",
    story: "Smart search over many documents in Teams",
    expected: /Hybrid/,
    intent: "Internal employees use Teams to ask questions across millions of project documents. Keep the everyday Teams experience and provide stronger search quality and precise sources with governed document access.",
    requirements: ["Teams/Copilot experience remains present.", "Advanced document retrieval is justified and distinct from analytics.", "Authorization applies before retrieving documents.", "Do not add record writes or claim all infrastructure is already deployed."],
    notes: null
  },
  {
    name: "governed Fabric analytics",
    story: "Ask questions about sales numbers",
    expected: /Copilot Studio/,
    intent: "Internal sales managers ask read-only sales performance and trend questions in Teams using official Power BI semantic-model reporting, with governed Fabric analytics and existing user permissions.",
    requirements: ["Use Fabric Data Agent for governed analytics, not document-RAG search as a replacement.", "Identify Power BI semantic-model Read permission, workspace/item permissions, applicable RLS/OLS, and preparation for AI.", "No writes or unnecessary custom orchestration.", "Do not turn uncertainty about readiness into a claim that it is verified."],
    notes: null
  }
]) {
  test(`live ${scenario.name} preserves constraints across all output surfaces`, async ({ page }, info) => {
    test.setTimeout(720_000);
    const directory = caseDirectory(info);
    await login(page);
    const story = page.getByRole("article").filter({ hasText: scenario.story });
    const initial = await reviewAfter(page, "initial-review", () =>
      story.getByRole("button", { name: "Load this Scenario", exact: true }).click(), directory);
    expect(String(initial.report.solutionType)).toMatch(scenario.expected);
    const outputs: OutputArtifact[] = [{ id: "initial-recommendation", kind: "actual API report", content: initial.report }];
    let updateError: unknown;
    try {
      if (scenario.notes) {
        await page.getByRole("textbox", { name: "Refine the recommendation", exact: true }).fill(scenario.notes);
        const refined = await reviewAfter(page, "refined-review", () =>
          page.getByRole("button", { name: "Apply refinement", exact: true }).click(), directory);
        expect(refined.input).toEqual(initial.input);
        expect(refined.notes).toContain(scenario.notes);
        outputs.push({ id: "refined-recommendation", kind: "actual refined API report, same input profile", content: refined.report });
      } else if (scenario.name === "hybrid document search") {
        const deep = await reviewAfter(page, "optional-review", () =>
          page.getByRole("button", { name: "AI Review (optional)", exact: true }).click(), directory, "review");
        expect(deep.input).toEqual(initial.input);
        expect(deep.report.architecture?.graph).toEqual(initial.report.architecture?.graph);
        outputs.push({ id: "optional-review", kind: "optional AI findings without architecture regeneration", content: deep.report });
      }
    } catch (error) {
      updateError = error;
      console.log("The update failed; checking and judging the previously accepted result that remains visible.");
    }
    outputs.push(...await captureDiagrams(page, directory));
    outputs.push(await capturePowerPoint(page, directory));
    for (const tab of ["Governance", "Technical", "Overview"]) {
      await page.getByRole("button", { name: new RegExp(`^${tab}\\b`) }).click();
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/\bundefined\b|\[object Object\]/);
      fs.writeFileSync(path.join(directory, `${tab.toLowerCase()}-visible.txt`), text);
    }
    const judgments = await judgeOutputs(directory, scenario.intent, scenario.requirements, outputs, initial.input);
    expect(judgments.filter(item => item.verdict === "fail"), JSON.stringify(judgments, null, 2)).toEqual([]);
    if (updateError) throw updateError;
    expect(diagnostics(page).pageErrors).toEqual([]);
    expect(diagnostics(page).httpErrors).toEqual([]);
  });
}

test("live direct-text correction yields only the new scenario after backtracking", async ({ page }, info) => {
  const directory = caseDirectory(info);
  await login(page);
  await mockWizardAssistance(page);
  await page.getByRole("article").filter({ hasText: "HR policy answers in Teams" })
    .getByRole("button", { name: "Build in Wizard", exact: true }).click();
  const summary = "External customers use a mobile app to check their own insurance claim status through an existing business API and ask questions about PDF claim documents, with citations. Read-only; require external identity and per-customer permissions. No Teams, no record updates.";
  await page.getByRole("textbox", { name: "Tell us the scenario", exact: true }).fill("Internal employees ask questions in Teams.");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("textbox", { name: "Tell us the scenario", exact: true }).fill(summary);
  await page.getByRole("checkbox", { name: /Skip the wizard/ }).check();
  const review = await reviewAfter(page, "corrected-direct-review", () =>
    page.getByRole("button", { name: "Continue →", exact: true }).click(), directory);
  expect(review.input.summary).toBe(summary);
  expect(review.input.users).not.toContain("internal_employees");
  expect(review.input.channels).not.toContain("teams");
  const outputs: OutputArtifact[] = [
    { id: "corrected-report", kind: "actual API report after correcting the scenario", content: review.report },
    ...await captureDiagrams(page, directory),
    await capturePowerPoint(page, directory)
  ];
  const judgments = await judgeOutputs(directory, summary,
    ["No stale HR, internal-employees, SharePoint, or Teams solution carried from the starting example.", "Read-only API lookup and document citations remain distinct.", "Customer-specific identity and access controls required."],
    outputs, review.input);
  expect(judgments.filter(item => item.verdict === "fail"), JSON.stringify(judgments, null, 2)).toEqual([]);
});

test("live HR scenario produces consistent reviewed diagrams and PowerPoint", async ({ page }, info) => {
  const directory = caseDirectory(info);
  await login(page);
  const story = page.getByRole("article").filter({ hasText: "HR policy answers in Teams" });
  const review = await reviewAfter(page, "initial-review", () =>
    story.getByRole("button", { name: "Load this Scenario", exact: true }).click(), directory);
  expect(String(review.report.solutionType)).toMatch(/Copilot Studio/);
  expect(review.input.users).toContain("internal_employees");
  expect(review.input.channels).toContain("teams");
  const outputs: OutputArtifact[] = [
    { id: "recommendation", kind: "actual recommendation API output", content: review.report }
  ];
  outputs.push(...await captureDiagrams(page, directory));
  outputs.push(await capturePowerPoint(page, directory));
  const assessments = await judgeOutputs(directory,
    "Internal employees need read-only HR policy answers inside Teams, grounded in their organization's handbooks and policy documents, with sources. They must not create or change HR records.",
    ["Keep an internal Teams experience.", "Provide governed document grounding and citations.", "Do not introduce record writes or imply confirmed private-network requirements.", "The diagram and exported deck must agree with the reviewed recommendation."],
    outputs, review.input);
  expect(assessments.filter(item => item.verdict === "fail"), JSON.stringify(assessments, null, 2)).toEqual([]);
  expect(diagnostics(page).pageErrors).toEqual([]);
  expect(diagnostics(page).httpErrors).toEqual([]);
});

test("live wizard assistance keeps valid choices while evaluating the current profile", async ({ page }, info) => {
  const directory = caseDirectory(info);
  await login(page);
  await page.getByRole("article").filter({ hasText: "HR policy answers in Teams" })
    .getByRole("button", { name: "Build in Wizard", exact: true }).click();
  const responses = ["users", "channels"].map(questionId => page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/wizard-filter" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON().questionId === questionId, { timeout: 180_000 }));
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  const received = await progress("Live wizard option assistance", () => Promise.all(responses));
  const outputs: OutputArtifact[] = [];
  for (const response of received) {
    const request = response.request().postDataJSON();
    const result = await response.json();
    expect(response.status(), JSON.stringify(result)).toBe(200);
    expect(Array.isArray(result.eliminate)).toBe(true);
    const selected = request.input[request.questionId] as string[];
    expect(result.eliminate.some((item: { id: string }) => selected.includes(item.id) || item.id === "unknown")).toBe(false);
    outputs.push({ id: `wizard-${request.questionId}`, kind: "actual wizard-assistance response", content: { question: request.questionId, profile: request.input, result } });
  }
  await expect(page.getByRole("button", { name: "Employees inside your organization", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Teams", exact: true })).toHaveAttribute("aria-pressed", "true");
  const judgments = await judgeOutputs(directory,
    "The current wizard profile is an internal employee read-only HR document assistant in Teams.",
    ["The assistance must not hide selected choices or unknown.", "Only clearly inapplicable unselected options may be removed; leaving alternatives visible is acceptable.", "Filtering is guidance, not authorization to change the profile."],
    outputs);
  expect(judgments.filter(item => item.verdict === "fail"), JSON.stringify(judgments, null, 2)).toEqual([]);
});
