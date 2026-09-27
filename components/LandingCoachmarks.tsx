"use client";

import { Coachmarks, type CoachStep } from "./Coachmarks";

const STEPS: CoachStep[] = [
  {
    selector: '[data-coach="cta"]',
    title: "Start your use case for an Agentic AI Platform",
    body: "Answer a short guided profile and we recommend the right Microsoft agent platform — Copilot Studio, AI Foundry, or hybrid — with guardrails and exportable artifacts."
  },
  {
    selector: '[data-coach="examples"]',
    title: "Or load a ready Agentic AI scenario",
    body: "Short on time? Pick a quantified customer story. Use “Load this Scenario” to jump straight to a recommendation, or “Build in Wizard” to tweak it first."
  },
  {
    selector: '[data-coach="wizard"]',
    title: "Build through the Wizard after loading",
    body: "Loaded a scenario but want to adjust it? “Build in Wizard” opens it in the guided wizard so you can refine the users, data, and behaviors before generating your recommendation."
  }
];

export function LandingCoachmarks({
  storageKey = "ai-pdn:coach-autoshow",
  replay = 0
}: {
  storageKey?: string;
  replay?: number;
}) {
  return <Coachmarks steps={STEPS} storageKey={storageKey} replay={replay} autoShow="always" />;
}
