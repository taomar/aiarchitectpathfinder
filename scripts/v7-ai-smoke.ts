import assert from "node:assert/strict";
import { aiRuntimeStatus } from "../lib/ai-runtime";
import { tieBreak } from "../lib/azure-openai";
import { eliminateOptions } from "../lib/wizard-filter";
import { decide } from "../lib/decision-engine";
import { emptyInput } from "../lib/types";
import { QUESTIONS } from "../lib/questions";

async function main() {
  console.log("v7 live smoke: synthetic data only; no deployment or resource changes.");
  console.log(JSON.stringify(aiRuntimeStatus(), null, 2));
  const input = {
    ...emptyInput(),
    summary: "Internal employees ask read-only handbook questions in Teams using SharePoint. Use Copilot Studio native knowledge; no writes or custom runtime.",
    users: ["internal_employees" as const], channels: ["teams" as const],
    capabilities: ["employee_assistant" as const], dataSources: ["sharepoint" as const],
    behaviors: ["qa" as const], runtimePreferences: ["copilot_studio" as const],
    advancedRagRequirements: ["none" as const], writeBackConfirmed: false
  };
  const question = QUESTIONS.find(item => item.id === "behaviors");
  assert.ok(question);
  const wizard = await eliminateOptions(input, question);
  console.log("Wizard AI completed:", { eliminated: wizard.eliminate.length, note: wizard.note });
  const report = await tieBreak(input, decide(input));
  assert.ok(report.proposedArchitectureSummary);
  assert.ok(report.agentTrace?.some(item => item.agent === "Architecture Critic" && item.status === "passed"));
  console.log("Architecture AI and independent judge completed:", {
    title: report.useCaseTitle, summaryCharacters: report.proposedArchitectureSummary.length,
    stages: report.agentTrace?.map(item => ({ stage: item.agent, status: item.status }))
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
