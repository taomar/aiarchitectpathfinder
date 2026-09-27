"use client";

import { AdaptiveWizardState, ArchitectureDecision } from "@/lib/types";
import { categoryForDecision, describeConfidence, displayPatternName } from "@/lib/pathfinder-category";
import { QUESTIONS } from "@/lib/questions";

const labelForPattern = (id?: string) => {
  const map: Record<string, string> = {
    clarification_required: "Needs clarification",
    m365_copilot_productivity: "Copilot Studio",
    copilot_studio_internal_assistant: "Copilot Studio",
    copilot_studio_fabric_data_agent: "Copilot Studio",
    document_rag_agent: "AI Foundry",
    azure_ai_foundry_app: "AI Foundry",
    external_ai_app: "AI Foundry",
    business_action_agent: "AI Foundry",
    custom_ai_app: "AI Foundry"
  };
  return id ? map[id] ?? "Needs clarification" : "Not enough information yet";
};

export function DecisionPreview({
  decision,
  adaptiveState
}: {
  decision: ArchitectureDecision;
  adaptiveState: AdaptiveWizardState;
}) {
  const skippedLabels = adaptiveState.hiddenQuestions
    .filter((q) => q.relevance === "hidden" || q.relevance === "optional_later")
    .slice(0, 4)
    .map((q) => QUESTIONS.find((question) => question.id === q.questionId)?.title ?? q.questionId);
  const category = categoryForDecision(decision).category;
  const displayName = displayPatternName(decision);
  const nextQuestion = adaptiveState.unresolvedCriticalQuestions[0]
    ? QUESTIONS.find((question) => question.id === adaptiveState.unresolvedCriticalQuestions[0])
    : undefined;
  const confidence = describeConfidence(decision, adaptiveState.normalizedInput);
  return (
    <aside className="card sticky top-3">
      <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
        Your recommendation so far
      </h3>
      <div className="mt-2">
        <div className="text-lg font-semibold leading-snug">
          {adaptiveState.canGenerateRecommendation
            ? displayName
            : labelForPattern(adaptiveState.likelyBasePattern)}
        </div>
        <div className="mt-1 text-xs text-gray-500">{category}</div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`badge ${
              confidence.tone === "high"
                ? "badge-success"
                : confidence.tone === "medium"
                ? "badge-warn"
                : "badge-danger"
            }`}
          >
            {confidence.label}
          </span>
        </div>
        {confidence.detail ? (
          <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{confidence.detail}</p>
        ) : null}
      </div>

      <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
        <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          Status
        </div>
        <div className="mt-1 text-sm leading-relaxed text-gray-700">
          {adaptiveState.recommendationReadinessReason}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={adaptiveState.canGenerateRecommendation ? "badge badge-success" : "badge badge-warn"}>
            {adaptiveState.canGenerateRecommendation ? "Ready to view" : "A few more answers needed"}
          </span>
          {adaptiveState.skippedCount > 0 ? (
            <span className="badge badge-info">{adaptiveState.skippedCount} not needed</span>
          ) : null}
        </div>
        {skippedLabels.length > 0 ? (
          <details className="mt-2 text-xs text-gray-500">
            <summary className="cursor-pointer">Questions we skipped — they don&apos;t change your result</summary>
            <div className="mt-1">{skippedLabels.join(", ")}</div>
          </details>
        ) : null}
      </div>

      {decision.overlays.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Included add-ons
          </div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {decision.overlays.map((o) => (
              <li key={o.id} className="badge badge-info">{o.name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          What it will use
        </div>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-700">
          {decision.recommendedStack.slice(0, 8).map((s) => (
            <li key={s}>{s}</li>
          ))}
          {decision.recommendedStack.length > 8 ? (
            <li className="text-gray-400">+{decision.recommendedStack.length - 8} more</li>
          ) : null}
        </ul>
      </div>

      {decision.blockedComponents.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Kept out for safety
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
            {decision.blockedComponents.map((s) => (
              <li key={s} className="flex items-start gap-1">
                <span className="text-red-500">✕</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {adaptiveState.unresolvedCriticalQuestions.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Answer next
          </div>
          <div className="mt-1 text-xs text-gray-700">
            {nextQuestion?.title ?? adaptiveState.unresolvedCriticalQuestions[0]}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
