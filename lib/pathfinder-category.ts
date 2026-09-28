import type { ArchitectureDecision, DecisionInput } from "./types";
import { lowConfidenceReason } from "./rules";
import { architectureFlowMermaid, architectureViewMermaid, buildArchitectureView } from "./architecture-view";

export type PathfinderCategory =
  | "Needs Clarification"
  | "Copilot Studio"
  | "AI Foundry"
  | "Hybrid Copilot Studio + AI Foundry";

export type CategoryInfo = {
  category: string;
  description: string;
  badgeClass: string;
};

const BASE_TO_CATEGORY: Record<string, PathfinderCategory> = {
  clarification_required: "Needs Clarification",
  m365_copilot_productivity: "Copilot Studio",
  copilot_studio_internal_assistant: "Copilot Studio",
  copilot_studio_fabric_data_agent: "Copilot Studio",
  document_rag_agent: "AI Foundry",
  azure_ai_foundry_app: "AI Foundry",
  external_ai_app: "AI Foundry",
  business_action_agent: "AI Foundry",
  custom_ai_app: "AI Foundry"
};

const DESCRIPTIONS: Record<PathfinderCategory, string> = {
  "Needs Clarification":
    "Pathfinder needs a confirmed audience, access channel, and grounding/data path before selecting Copilot Studio, AI Foundry, or a hybrid architecture.",
  "Copilot Studio":
    "Copilot Studio is the solution family for Microsoft 365 and Teams-centered agents, including Fabric Data Agent, Graph, SharePoint, native knowledge, and Copilot Studio actions where selected.",
  "AI Foundry":
    "AI Foundry is the solution family for custom channels, Azure AI Foundry Agent Service, Foundry Models, Azure OpenAI model deployments, advanced RAG, external apps, and model operations.",
  "Hybrid Copilot Studio + AI Foundry":
    "Copilot Studio provides the user-facing conversational experience while AI Foundry supplies model deployments, model operations, evaluation, tracing, or custom model endpoints behind the scenes."
};

export function categoryForDecision(decision: ArchitectureDecision): CategoryInfo {
  if (decision.authority === "ai") {
    return {
      category: decision.solutionType ?? decision.basePatternName,
      description: decision.finalRecommendation,
      badgeClass: "badge-info"
    };
  }
  const base = BASE_TO_CATEGORY[decision.basePatternId] ?? "AI Foundry";
  const hasFoundry = decision.overlays.some((o) => /foundry/i.test(o.id) || /foundry/i.test(o.name)) ||
    decision.overlays.some((o) => /model_customization/i.test(o.id)) ||
    decision.recommendedStack.some((s) => /foundry agent service|model catalog|fine-tuned|azure machine learning|azure ai foundry \(evaluation|foundry evaluation|foundry tracing|foundry monitoring/i.test(s)) ||
    decision.architectureLayers.some((layer) => layer.layer === "AI Platform" && layer.required && layer.selections.some((s) =>
      !/^(?:not required|no\b|none\b)/i.test(s.trim()) &&
      /^(?:azure ai foundry\b|foundry models\b|azure openai (?:model )?deployment\b|azure machine learning\b|fine-tuned\b|foundry model catalog\b)/i.test(s.trim()))) ||
    decision.architectureLayers.some((layer) => layer.layer === "Observability" && layer.selections.some((s) => /azure ai foundry evaluation|foundry evaluation|foundry tracing|foundry monitoring/i.test(s)));
  const hasHybrid = decision.overlays.some((o) => /hybrid|private/i.test(o.id) || /hybrid|private/i.test(o.name));
  const hasCopilotStudioExperience = decision.architectureLayers.some(
    (l) => l.layer === "Experience" && l.selections.some((s) => /copilot studio/i.test(s))
  );
  let category: PathfinderCategory = base;
  if (hasCopilotStudioExperience && hasFoundry) category = "Hybrid Copilot Studio + AI Foundry";
  else if (hasCopilotStudioExperience) category = "Copilot Studio";
  else if (hasFoundry || decision.basePatternId === "azure_ai_foundry_app") category = "AI Foundry";
  const badge: Record<PathfinderCategory, string> = {
    "Needs Clarification": "badge-warn",
    "Copilot Studio": "badge-info",
    "AI Foundry": "badge-success",
    "Hybrid Copilot Studio + AI Foundry": "badge-success"
  };
  return {
    category,
    description: decision.basePatternId === "m365_copilot_productivity"
      ? "Microsoft 365 Copilot is the native productivity experience over Microsoft Graph and existing tenant permissions; no custom agent or application is required."
      : hasHybrid ? `${DESCRIPTIONS[category]} Private/hybrid deployment controls are applied as an overlay.` : DESCRIPTIONS[category],
    badgeClass: badge[category]
  };
}

export function displayPatternName(decision: ArchitectureDecision): string {
  if (decision.authority === "ai") return decision.basePatternName;
  if (decision.basePatternId === "m365_copilot_productivity") return "Microsoft 365 Copilot";
  return categoryForDecision(decision).category;
}

export type ConfidencePresentation = {
  tone: "high" | "medium" | "low";
  label: string;
  detail?: string;
};

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function describeConfidence(decision: ArchitectureDecision, input: DecisionInput): ConfidencePresentation {
  if (decision.authority === "ai") return {
    tone: decision.confidence, label: `AI confidence: ${decision.confidence}`, detail: decision.confidenceReason
  };
  if (decision.confidence === "high") return { tone: "high", label: "Strong match" };
  if (decision.confidence === "medium") return { tone: "medium", label: "Good match" };
  const category = categoryForDecision(decision).category;
  const reason = lowConfidenceReason(input, decision.candidateBasePatternIds ?? []);
  if (reason?.code === "cross_family") {
    if (category.startsWith("Hybrid")) return {
      tone: "medium", label: "Hybrid solution",
      detail: "This combines Copilot Studio and AI Foundry, so it intentionally draws on both families."
    };
    return {
      tone: "low", label: "Comparing options",
      detail: `More than one route fits across ${joinWithAnd(reason.families)}. Confirm the profile requirements to resolve the alternatives; AI review cannot change the selected route.`
    };
  }
  if (reason?.code === "missing_gate") return {
    tone: "low", label: "Add a detail",
    detail: `Tell us ${joinWithAnd(reason.gates)} to sharpen this recommendation.`
  };
  if (reason?.code === "skipped_gates") return {
    tone: "low", label: "Quick estimate",
    detail: `You skipped ${joinWithAnd(reason.gates)}. Add ${reason.gates.length > 1 ? "them" : "it"} for a sharper match.`
  };
  return { tone: "low", label: "Still narrowing down" };
}

export function buildMermaidDiagram(decision: ArchitectureDecision, input?: DecisionInput): string {
  if (decision.authority === "ai") {
    if (!decision.highLevelFlow) throw new Error("The AI recommendation has no authored high-level flow.");
    return architectureFlowMermaid(decision.highLevelFlow);
  }
  return architectureViewMermaid(buildArchitectureView(decision, input));
}
