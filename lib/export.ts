import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "./types";
import { buildMermaidDiagram, displayPatternName } from "./pathfinder-category";
import { AcceptedRecommendationSchema, recommendationDecision, recommendationReviewLabel } from "./recommendation-contract";

function exportDecision(decision: ArchitectureDecision, review?: TieBreakResponse | null) {
  return review?.authority === "ai"
    ? recommendationDecision(AcceptedRecommendationSchema.parse(review))
    : decision;
}

export function toJSON(input: DecisionInput, decision: ArchitectureDecision, review?: TieBreakResponse | null, refinement?: string): string {
  return JSON.stringify({ input, decision: exportDecision(decision, review), ...(review ? { review } : {}), ...(refinement ? { refinement } : {}) }, null, 2);
}

function clean(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function tableCell(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function reportUseCaseSummary(input: DecisionInput, decision: ArchitectureDecision, review?: TieBreakResponse | null) {
  return review?.useCaseSummary?.trim() || input.summary?.trim() || decision.finalRecommendation || "Recommendation generated from the selected profile.";
}

export function reportDetailSections(input: DecisionInput, decision: ArchitectureDecision, review?: TieBreakResponse | null, refinement?: string) {
  decision = exportDecision(decision, review);
  const profile = Object.entries(input)
    .filter(([key, value]) => key !== "summary" && value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") || "(none)" : String(value)}`);
  const assumptions = clean([...decision.assumptions, ...(review?.assumptions ?? [])]);
  const risks = clean([...decision.riskFlags, ...(review?.riskFlags ?? [])]);
  const questions = clean([...decision.missingQuestions.map((question) => question.title), ...(review?.questionsToAskNext ?? [])]);
  const exclusions = clean([...decision.blockedComponents, ...decision.forbiddenUnlessConfirmed, ...(review?.mustNotInclude ?? [])]);
  return [
    {
      title: "Scenario and decision context",
      items: [
        `User scenario: ${input.summary?.trim() || "(no free-text scenario provided)"}`,
        ...(refinement ? [`Review notes (profile unchanged): ${refinement}`] : []),
        `Recommended solution: ${displayPatternName(decision)}`,
        `Base route: ${decision.basePatternId}; ${decision.authority === "ai" ? "AI" : "draft"} confidence: ${decision.confidence}`,
        `Generation mode: ${review ? review.recommendationMode || "AI write-up" : "preliminary draft"}`,
        ...(review?.review ? [recommendationReviewLabel(review.review)] : []),
        `Candidate routes: ${decision.candidateBasePatternIds.join(", ") || "(none)"}`,
        ...profile
      ]
    },
    {
      title: "Complete architecture and services",
      items: [
        ...decision.recommendedStack.map((item) => `Recommended: ${item}`),
        ...decision.optionalAddOns.map((item) => `Optional: ${item}`),
        ...decision.overlays.map((overlay) => `Overlay: ${overlay.name} — ${overlay.reason}`),
        ...decision.architectureLayers.map((layer) => `${layer.layer} (${layer.required ? "required" : "optional"}): ${layer.selections.join("; ")}. Reason: ${layer.reason}`)
      ]
    },
    {
      title: "Complete workflow and rationale",
      items: [
        ...decision.endToEndFlow.map((step, index) => `${index + 1}. ${step}`),
        ...decision.rationale.map((item) => `Rationale: ${item}`),
        `Final recommendation: ${decision.finalRecommendation}`
      ]
    },
    {
      title: "Conditions and next steps",
      items: [
        ...assumptions.map((item) => `Assumption: ${item}`),
        ...risks.map((item) => `Risk: ${item}`),
        ...questions.map((item) => `Confirm before adoption: ${item}`),
        ...exclusions.map((item) => `Excluded or conditional: ${item}`)
      ]
    },
    {
      title: "Complete security and safeguards",
      items: [
        ...decision.securityControls.map((item) => `Control: ${item}`),
        `Safeguards: ${decision.zeroTrust.rationale}`,
        ...decision.zeroTrust.controls.map((item) => `Safeguard: ${item}`)
      ]
    },
    {
      title: "AI review details",
      items: [
        ...(review?.review ? [recommendationReviewLabel(review.review)] : []),
        ...(review?.review && review.review.status !== "not-requested" ? [review.review.summary, ...review.review.issues] : []),
        ...(review?.reasoning ?? []),
        ...(review?.agentTrace ?? []).flatMap((item) => [
          `${item.agent} (${item.status}): ${item.summary}`,
          ...item.details.map((detail) => `${item.agent}: ${detail}`)
        ])
      ]
    }
  ].map((section) => ({ ...section, items: clean(section.items) })).filter((section) => section.items.length);
}

export function toMarkdown(input: DecisionInput, decision: ArchitectureDecision, review?: TieBreakResponse | null, refinement?: string): string {
  decision = exportDecision(decision, review);
  const displayPattern = displayPatternName(decision);
  const assumptions = clean([...decision.assumptions, ...(review?.assumptions ?? [])]);
  const risks = clean([...decision.riskFlags, ...(review?.riskFlags ?? [])]);
  const layerLines = decision.architectureLayers
    .map(
      (l) =>
        `| ${tableCell(l.layer)} | ${l.required ? "Required" : "Optional"} | ${tableCell(l.selections.join("; "))} | ${tableCell(l.reason)} |`
    )
    .join("\n");

  const overlays = decision.overlays
    .map((o) => `- **${o.name}** — ${o.reason}`)
    .join("\n");

  return `# AI Platform Recommendation

${review?.review ? recommendationReviewLabel(review.review) : "Preliminary architecture"}

## Use Case Summary
${input.summary || "(no summary provided)"}

## Confirmed Profile
- Users: ${input.users.join(", ") || "—"}
- Channels: ${input.channels.join(", ") || "—"}
- Capabilities: ${input.capabilities.join(", ") || "—"}
- Data sources: ${input.dataSources.join(", ") || "—"}
- Behaviors: ${input.behaviors.join(", ") || "—"}
- Lifecycle controls: ${input.lifecycleControls.join(", ") || "—"}
- Runtime preferences: ${input.runtimePreferences.join(", ") || "—"}
- Security controls: ${input.securityControls.join(", ") || "—"}
- Network controls: ${input.networkControls.join(", ") || "—"}

## 1. Architecture Choice
**${displayPattern}** (confidence: ${decision.confidence})

### Active Overlays
${overlays || "- (none)"}

### Recommended Stack
${decision.recommendedStack.map((s) => `- ${s}`).join("\n")}

### Optional Add-ons
${decision.optionalAddOns.map((s) => `- ${s}`).join("\n") || "- (none)"}

### Forbidden Unless Confirmed
${decision.forbiddenUnlessConfirmed.map((s) => `- ${s}`).join("\n") || "- (none)"}

### Rationale
${decision.rationale.map((s) => `- ${s}`).join("\n")}

## 2. High-Level Architecture
| Layer | Required | Selections | Reason |
|---|---|---|---|
${layerLines}

## 3. End-to-End Flow
${decision.endToEndFlow.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## 4. Key Security Controls
${decision.securityControls.map((s) => `- ${s}`).join("\n") || "- (none)"}

## 5. Blocked Components
${decision.blockedComponents.map((s) => `- ${s}`).join("\n") || "- (none)"}

## 6. Assumptions / Missing Confirmations
${
  assumptions.length || decision.missingQuestions.length
    ? [
        ...assumptions.map((s) => `- ${s}`),
        ...decision.missingQuestions.map((q) => `- Missing: ${q.title}`)
      ].join("\n")
    : "- (none)"
}

## Risk Flags
${risks.map((s) => `- ${s}`).join("\n") || "- (none)"}

## Final Recommendation
${decision.finalRecommendation}

## Complete Report Details
${reportDetailSections(input, decision, review, refinement).map((section) => `### ${section.title}\n${section.items.map((item) => `- ${item}`).join("\n")}`).join("\n\n")}

## Service Flow
\`\`\`mermaid
${buildMermaidDiagram(decision)}
\`\`\`
`;
}
