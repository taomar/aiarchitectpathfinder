"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { ArchitectureDecision, ArchitectureLayer, DecisionInput, TieBreakResponse } from "@/lib/types";
import { ArchitectureLayerTable } from "./ArchitectureLayerTable";
import { ExportPPTButton } from "./ExportPPTButton";
import { MermaidDiagram } from "./MermaidDiagram";
import { ArchitectureImage } from "./ArchitectureImage";
import { BrandMark } from "./BrandMark";
import { Coachmarks, type CoachStep } from "./Coachmarks";
import {
  buildMermaidDiagram,
  categoryForDecision,
  describeConfidence,
  displayPatternName
} from "@/lib/pathfinder-category";
import {
  buildArchitectureSummary,
  shouldUseGeneratedArchitectureSummary
} from "@/lib/architecture-summary";
import { QUESTIONS } from "@/lib/questions";
import {
  trackArchitectureOutput,
  trackUsageEvent,
  type UsageSession
} from "@/lib/usage-client";
import { readJsonResponse } from "@/lib/api-response";
import { reportUseCaseSummary } from "@/lib/export";
import { RECOMMENDATION_CLIENT_TIMEOUT_MS } from "@/lib/recommendation-policy";

const layerOrder: ArchitectureLayer["layer"][] = [
  "User/Channel",
  "Identity",
  "Experience",
  "Runtime/Backend",
  "Analytics/Grounding",
  "Orchestration",
  "AI Platform",
  "Knowledge/Data",
  "Integration",
  "Security",
  "Observability",
  "Network/Deployment"
];

const layerNames = new Set<string>(layerOrder);

type RecommendationTab = "overview" | "architecture" | "governance" | "technical";

function cleanList(items?: string[]) {
  return Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));
}

function mergeArchitectureLayers(
  deterministicLayers: ArchitectureLayer[],
  aiLayers?: ArchitectureLayer[]
) {
  if (!aiLayers?.length) return deterministicLayers;
  const byLayer = new Map<ArchitectureLayer["layer"], ArchitectureLayer>();
  for (const layer of deterministicLayers) byLayer.set(layer.layer, layer);
  for (const layer of aiLayers) {
    if (!layerNames.has(layer.layer)) continue;
    const baseline = byLayer.get(layer.layer);
    const selections = cleanList([
      ...(baseline?.required ? baseline.selections : []),
      ...(layer.selections ?? [])
    ]);
    if (selections.length === 0) continue;
    byLayer.set(layer.layer, {
      layer: layer.layer,
      selections,
      required: !!baseline?.required || !!layer.required,
      reason: layer.reason?.trim() || "LLM-refined from deterministic draft."
    });
  }
  return layerOrder.map((layer) => byLayer.get(layer)).filter((layer): layer is ArchitectureLayer => !!layer);
}

export function withAiRecommendation(
  decision: ArchitectureDecision,
  tieBreak: TieBreakResponse | null
): ArchitectureDecision {
  if (!tieBreak) return decision;
  const recommendedStack = cleanList(tieBreak.recommendedStack);
  const optionalAddOns = cleanList(tieBreak.optionalAddOns);
  const endToEndFlow = cleanList(tieBreak.endToEndFlow);
  const rationale = cleanList(tieBreak.rationale);
  const securityControls = cleanList(tieBreak.securityControls);
  const zeroTrustControls = cleanList(tieBreak.zeroTrust?.controls);
  return {
    ...decision,
    basePatternName: decision.basePatternId === "m365_copilot_productivity"
      ? decision.basePatternName
      : tieBreak.displayPatternName?.trim() || decision.basePatternName,
    recommendedStack: cleanList([...decision.recommendedStack, ...recommendedStack]),
    optionalAddOns: optionalAddOns.length ? optionalAddOns : decision.optionalAddOns,
    architectureLayers: mergeArchitectureLayers(decision.architectureLayers, tieBreak.architectureLayers),
    endToEndFlow: endToEndFlow.length ? endToEndFlow : decision.endToEndFlow,
    rationale: rationale.length ? rationale : decision.rationale,
    securityControls: cleanList([...decision.securityControls, ...securityControls]),
    zeroTrust: tieBreak.zeroTrust
      ? {
          applicable: decision.zeroTrust.applicable || tieBreak.zeroTrust.applicable,
          rationale: tieBreak.zeroTrust.rationale?.trim() || decision.zeroTrust.rationale,
          controls: cleanList([...decision.zeroTrust.controls, ...zeroTrustControls])
        }
      : decision.zeroTrust,
    finalRecommendation: tieBreak.finalRecommendation?.trim() || decision.finalRecommendation
  };
}

export function recommendationNotes(appliedNotes: string | null, draft: string) {
  const applied = appliedNotes?.replace(/^Deep validation:\s*/i, "").trim() ?? "";
  const accepted = /^Deep validation with (?:GPT-?5\.4|AI reviewer)$/i.test(applied) ? "" : applied;
  return cleanList([accepted, draft]).join("\n\n");
}

function RecommendationLoading({ message }: { message: string }) {
  return (
    <div className="mt-3 flex min-h-[120px] items-center justify-center rounded-md border border-ms-border bg-ms-gray/30 text-xs text-gray-600">
      <span className="mr-2 h-5 w-5 rounded-full border-2 border-ms-blue border-t-transparent animate-spin" />
      {message}
    </div>
  );
}

function SourceBadge({ loading, aiReady }: { loading: boolean; aiReady: boolean }) {
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${
      loading
        ? "bg-gray-100 text-gray-600"
        : aiReady
        ? "bg-emerald-100 text-emerald-800"
        : "bg-blue-100 text-blue-800"
    }`} title={loading ? "The current draft remains available while AI review runs" : aiReady ? "AI-authored report accepted after separate AI review" : "Rules-based draft; no accepted AI report for this revision"}>
      {loading ? "AI report pending" : aiReady ? "AI-reviewed" : "Rules-based draft"}
    </span>
  );
}

function selectedLabels(input: DecisionInput, questionId: string) {
  const question = QUESTIONS.find((item) => item.id === questionId);
  const rawValue = question?.read?.(input) ?? (input as any)[questionId];
  const values = Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : [];
  return values
    .map((value) => question?.options?.find((option) => option.id === value)?.label ?? String(value).replace(/_/g, " "))
    .filter(Boolean);
}

function ChipList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  const visible = values.slice(0, 5);
  const hiddenCount = values.length - visible.length;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {visible.map((value) => (
          <span key={value} className="rounded-full bg-[#EFF6FC] px-2.5 py-1 text-xs font-medium text-ms-blue">
            {value}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">+{hiddenCount} more</span>
        ) : null}
      </div>
    </div>
  );
}

function ParagraphText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return (
    <div className="mt-1 space-y-2 text-xs leading-relaxed text-ms-text">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

const architectureSummarySectionTitles = [
  "Solution overview",
  "Experience and runtime",
  "AI, data, and integration",
  "Security and operations",
  "Overlays and follow-ups"
];

function ArchitectureSummarySections({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div className="mt-4 grid gap-2.5">
      {paragraphs.map((paragraph, index) => {
        const isLead = index === 0;
        return (
          <div
            key={index}
            className={`group relative overflow-hidden rounded-xl border bg-white px-4 py-3.5 shadow-card transition hover:shadow-md ${
              isLead ? "border-ms-blue/30" : "border-ms-border"
            }`}
          >
            <span
              className={`absolute inset-y-0 left-0 w-1 ${isLead ? "bg-ms-blue" : "bg-ms-blue/25"}`}
              aria-hidden="true"
            />
            <div className="flex gap-3.5 pl-1.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ring-4 ${
                  isLead
                    ? "bg-ms-blue text-white ring-ms-blue/10"
                    : "bg-[#EAF2FB] text-ms-blueDark ring-[#EAF2FB]/40"
                }`}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ms-blue">
                  {architectureSummarySectionTitles[index] ?? `Detail ${index + 1}`}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ms-text">{paragraph}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UserScenarioPanel({ input }: { input: DecisionInput }) {
  const scenarioText = input.summary?.trim();
  const groups = [
    { label: "Audience", values: selectedLabels(input, "users") },
    { label: "Access", values: selectedLabels(input, "channels") },
    { label: "Needs", values: selectedLabels(input, "capabilities") },
    { label: "Information", values: selectedLabels(input, "dataSources") },
    { label: "Behavior", values: selectedLabels(input, "behaviors") }
  ];
  return (
    <section className="rounded-xl border border-ms-border bg-gradient-to-b from-white to-[#F8FBFE] p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">User input</div>
          <h2 className="mt-1 text-base font-semibold">Your scenario</h2>
        </div>
        {input.directTextRecommendation ? (
          <span className="badge badge-info">Built from text</span>
        ) : null}
      </div>
      <blockquote className="mt-3 rounded-lg border border-ms-border border-l-4 border-l-ms-blue bg-white px-3 py-2.5 text-xs leading-relaxed text-gray-800 shadow-sm">
        {scenarioText || "No free-text scenario was provided. The recommendation is based on the selected wizard answers."}
      </blockquote>
      <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
        {groups.map((group) => (
          <ChipList key={group.label} label={group.label} values={group.values} />
        ))}
      </div>
    </section>
  );
}

function UserInputSummary({ input, refinement }: { input: DecisionInput; refinement?: string | null }) {
  const scenarioText = input.summary?.trim();
  const groups = [
    { label: "Audience", values: selectedLabels(input, "users") },
    { label: "Access", values: selectedLabels(input, "channels") },
    { label: "Needs", values: selectedLabels(input, "capabilities") },
    { label: "Information", values: selectedLabels(input, "dataSources") },
    { label: "Behavior", values: selectedLabels(input, "behaviors") }
  ];

  return (
    <div className="rounded-lg border border-[#D6E3F3] bg-[#F7FAFE] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ms-blue">User input</div>
          <h3 className="mt-1 text-sm font-semibold text-ms-text">Scenario being evaluated</h3>
        </div>
        {input.directTextRecommendation ? <span className="badge badge-info">Built from text</span> : null}
      </div>
      <p className="mt-2 rounded-md border border-ms-border bg-white px-3 py-2 text-sm leading-relaxed text-gray-800">
        {scenarioText || "No free-text scenario was provided. The recommendation is based on the selected wizard answers."}
      </p>
      {refinement ? (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Refinement applied</span>
          <p className="mt-0.5">{refinement}</p>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
        {groups.map((group) => (
          <ChipList key={group.label} label={group.label} values={group.values} />
        ))}
      </div>
    </div>
  );
}

const checkLabel = (agent: string) => {
  if (/router/i.test(agent)) return "Route";
  if (/critic/i.test(agent)) return "Review";
  if (/composer/i.test(agent)) return "Write-up";
  if (/verifier|guardrail/i.test(agent)) return "Guardrails";
  return agent;
};

const aiReviewFetchDefaults: RequestInit = {
  credentials: "include",
  cache: "no-store"
};

export async function readAiReviewAvailability(signal?: AbortSignal, onAuthRefreshPolicy?: (enabled: boolean) => void): Promise<boolean> {
  const response = await fetch("/api/tiebreak", {
    ...aiReviewFetchDefaults,
    method: "GET",
    headers: { Accept: "application/json" },
    signal
  });
  const status = await readJsonResponse<unknown>(response, "Optional AI availability");
  if (!response.ok || !status || typeof status !== "object" || !("enabled" in status) || typeof status.enabled !== "boolean") {
    throw new Error("Optional AI availability could not be checked. Reload to retry; the rules-based recommendation remains available.");
  }
  onAuthRefreshPolicy?.("authRefreshEnabled" in status && status.authRefreshEnabled === true);
  return status.enabled;
}

// Refresh is available only when the host explicitly enables an Entra token store.
async function refreshAuthSession(enabled: boolean): Promise<boolean> {
  if (!enabled) return false;
  try {
    const response = await fetch("/.auth/refresh", {
      credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) console.warn("[auth] Session refresh rejected:", response.status);
    return response.ok;
  } catch (error) {
    console.warn("[auth] Session refresh unavailable:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

// A network-level fetch failure ("Failed to fetch" TypeError) is most often an EasyAuth
// 302-to-login redirect that the SPA cannot follow — treat it as auth-recoverable.
function isLikelyAuthFetchFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|load failed/i.test(message);
}

function isAiReviewAuthError(message: string) {
  return /active sign-in session|current browser session|authentication page|sign in again|login/i.test(message);
}

function isAiReviewDisabledError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (error instanceof Error && error.name === "AiReviewDisabledError") ||
    /(?:AI review|Pathfinder APIM|Azure OpenAI)[^\n]*(?:not enabled|disabled)/i.test(message);
}

export function aiReviewErrorMessage(error: unknown, availability = false) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const reference = message.match(/Reference: ([0-9a-f-]{36})/i)?.[1];
  const detail = availability
    ? "Optional AI availability could not be confirmed. Reload to try again."
    : isAiReviewDisabledError(error)
    ? "Optional AI review is disabled in this environment."
    : isAiReviewAuthError(message)
    ? "Sign in again to use optional AI review."
    : /429|too_many_requests|rate limited|temporarily at capacity|capacity/i.test(message)
    ? "Optional AI review is temporarily at capacity. Try again shortly."
    : (error instanceof Error && error.name === "AbortError") || /timed out|timeout/i.test(message)
    ? "Optional AI review timed out."
    : "Optional AI review is unavailable right now.";
  return `${detail} Your existing recommendation remains available.${reference ? ` Reference: ${reference}.` : ""}`;
}

function AgentPipelinePanel({
  enabled,
  loading,
  error,
  trace,
  decision
}: {
  enabled: boolean | null;
  loading: boolean;
  error: string | null;
  trace: TieBreakResponse["agentTrace"];
  decision: ArchitectureDecision;
}) {
  const optionalStatus = loading ? "running" : error ? "unavailable" : enabled === null ? "pending" : enabled ? "not reported" : "skipped";
  const optionalSummary = loading
    ? "Optional AI review is in progress; the rules-based recommendation remains available."
    : error
    ? "The optional AI check did not complete."
    : enabled === null
    ? "Checking whether optional AI review is available."
    : enabled
    ? "No completed AI check evidence was returned."
    : "Optional AI review is disabled or unavailable.";
  const fallbackTrace = [
    {
      agent: "Deterministic Router",
      status: "passed",
      summary: `Selected ${decision.basePatternId} with ${decision.overlays.length} overlay(s).`,
      details: decision.candidateBasePatternIds
    },
    {
      agent: "Architecture Critic",
      status: optionalStatus,
      summary: optionalSummary,
      details: []
    },
    {
      agent: "Recommendation Composer",
      status: optionalStatus,
      summary: optionalSummary,
      details: []
    },
    {
      agent: "Guardrail Verifier",
      status: optionalStatus,
      summary: optionalSummary,
      details: []
    }
  ];
  const items = trace?.length ? trace : fallbackTrace;
  const hasReviewCaveats = !!trace?.some((item) => item.status === "warning" || item.status === "failed");
  const rateLimited = !!error && /429|too_many_requests|rate limited|temporarily at capacity|capacity/i.test(error);
  const reference = error?.match(/Reference: ([0-9a-f-]{36})/i)?.[1];
  const statusClass = (status: string) => {
    if (status === "passed") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (status === "failed") return "bg-rose-100 text-rose-800 border-rose-200";
    if (status === "warning") return "bg-amber-100 text-amber-800 border-amber-200";
    if (status === "running") return "bg-blue-100 text-blue-800 border-blue-200";
    return "bg-gray-100 text-gray-700 border-gray-200";
  };

  return (
    <section className="rounded-lg border border-ms-border bg-white p-3 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Recommendation checks</h2>
          <p className="mt-0.5 text-[11px] text-gray-600">
            The rules-based route is always available. Optional AI review and artifact checks are shown separately.
          </p>
        </div>
        <span role="status" aria-live="polite" className={`badge ${error ? rateLimited ? "badge-warn" : "badge-info" : loading ? "badge-muted" : hasReviewCaveats ? "badge-warn" : trace?.length ? "badge-success" : "badge-info"}`}>
          {error ? rateLimited ? "AI busy" : "Rules-based result ready" : loading ? "Optional AI review running" : hasReviewCaveats ? "Review caveats" : trace?.length ? "Checked" : enabled === false ? "AI disabled" : enabled === null ? "Checking AI availability" : "Ready"}
        </span>
      </div>
      {enabled === false && !error ? (
        <p role="status" className="mt-2 text-xs text-gray-600">
          Optional AI review is disabled. Your rules-based recommendation, diagrams, and exports remain available.
        </p>
      ) : null}
      {(loading || error) && trace?.length ? (
        <p className="mt-2 text-xs text-gray-600">{loading
          ? "The last completed review remains visible while the optional update runs."
          : "The last completed review is retained; the latest optional update did not complete."}</p>
      ) : null}
      {error ? (
        <div className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${rateLimited ? "border-amber-200 bg-amber-50 text-amber-900" : "border-ms-border bg-[#FAFBFC] text-gray-700"}`}>
          <p>{error}</p>
          {rateLimited ? (
            <p className="mt-1 text-xs text-amber-800">Try the AI write-up again shortly.{reference ? ` Reference: ${reference}.` : ""}</p>
          ) : reference ? (
            <p className="mt-1 text-[11px] text-gray-500">Reference: {reference}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {items.map((item, index) => (
          <div key={item.agent} className="rounded-md border border-ms-border bg-[#FAFBFC] px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-ms-border bg-white text-[11px] font-semibold text-ms-blue">
                {index + 1}
              </span>
              <div className="text-xs font-semibold text-gray-900">{checkLabel(item.agent)}</div>
            </div>
            <span className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusClass(item.status)}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
      {trace?.length ? (
        <details className="mt-3 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium text-ms-blue">Show check details</summary>
          <ul className="mt-2 space-y-1">
            {items.map((item) => (
              <li key={item.agent}>
                <span className="font-semibold">{checkLabel(item.agent)}:</span> {item.summary}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function FinalRecommendation({
  input,
  decision,
  usageSession,
  onBack,
  onReset
}: {
  input: DecisionInput;
  decision: ArchitectureDecision;
  usageSession: UsageSession;
  onBack: () => void;
  onReset: () => void;
}) {
  const [aoaiEnabled, setAoaiEnabled] = useState<boolean | null>(null);
  const [canRefreshAuth, setCanRefreshAuth] = useState(false);
  const [tieBreakResult, setTieBreakResult] = useState<TieBreakResponse | null>(null);
  const [tieBreakError, setTieBreakError] = useState<string | null>(null);
  const [tieBreakLoading, setTieBreakLoading] = useState(false);
  const [architectureImageDataUrl, setArchitectureImageDataUrl] = useState<string | null>(
    null
  );
  const [userNotes, setUserNotes] = useState("");
  const [refining, setRefining] = useState(false);
  const [deepValidating, setDeepValidating] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [appliedNotes, setAppliedNotes] = useState<string | null>(null);
  const [refinedAt, setRefinedAt] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<RecommendationTab>("overview");
  const [recommendationCoachReplay, setRecommendationCoachReplay] = useState(0);

  // Guided tour for the recommendation screen — button-triggered only (never auto-shown),
  // so it never covers a result the user just waited for. Steps switch to the right tab
  // before spotlighting, so the Generate-architecture and Refine guides always land.
  const recommendationCoachSteps = useMemo<CoachStep[]>(
    () => [
      {
        selector: '[data-coach="rec-result"]',
        title: "Your recommended platform",
        body: "This is the Microsoft platform that best fits your scenario, with a plain-language note on how strong the match is and why.",
        onBeforeShow: () => setActiveTab("overview")
      },
      {
        selector: '[data-coach="rec-tabs"]',
        title: "Explore the full plan",
        body: "Switch between the architecture diagram, governance and guardrails, and the technical layer detail — each tab drills deeper into the same recommendation."
      },
      {
        selector: '[data-coach="rec-refine"]',
        title: "Refine the recommendation",
        body: "Add review context or ask for clearer reasoning. Profile inputs and safety rules stay in force; use Back to wizard to change requirements.",
        onBeforeShow: () => setActiveTab("overview")
      },
      {
        selector: '[data-coach="rec-architecture"]',
        title: "Generate the architecture diagram",
        body: "Open the Architecture tab and click “Generate architecture” to render a labelled diagram from the final recommendation, using Microsoft service icons.",
        onBeforeShow: () => setActiveTab("architecture")
      },
      {
        selector: '[data-coach="rec-export"]',
        title: "Export to share",
        body: "Download a ready-to-share PowerPoint of the full recommendation — summary, architecture, and guardrails — to send to your team or stakeholders.",
        onBeforeShow: () => setActiveTab("overview")
      }
    ].filter((step) => aoaiEnabled === true || step.selector !== '[data-coach="rec-refine"]'),
    [aoaiEnabled]
  );
  const [architectureRequested, setArchitectureRequested] = useState(false);
  const [architectureRendering, setArchitectureRendering] = useState(false);
  const [imageRefreshNonce, setImageRefreshNonce] = useState(0);
  const architectureRenderStartedAt = useRef(0);
  const architectureRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTrackedArchitecture = useRef<string | null>(null);
  const pendingChangeReason = useRef("recommendation_ready");
  // Tracks every in-flight AI-review request (initial load, refinement, deep
  // validation) so they can all be aborted at once when the user navigates away
  // (Start over / Back). Aborting the fetch closes the HTTP connection, which the
  // API route forwards to the upstream model call — so no stray LLM call keeps
  // running to compete with or bleed into the next scenario.
  const pendingControllersRef = useRef<Set<AbortController>>(new Set());
  // Monotonic id for every AI-review request. Each request (initial load,
  // refinement, deep validation) takes the next id; a result is only applied if its
  // id is still >= the last applied id. This guarantees the user's latest action
  // wins and a slow cold initial load (30-45s) can never land late and overwrite a
  // refinement the user applied while it was still running — which previously made
  // "Apply refinement" silently revert to the un-refined recommendation.
  const requestSeqRef = useRef(0);
  const lastAppliedSeqRef = useRef(0);

  async function requestRecommendation(mode: "fast" | "deep", notes?: string, signal?: AbortSignal): Promise<TieBreakResponse> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new DOMException("The AI review timed out.", "TimeoutError")), RECOMMENDATION_CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/tiebreak", {
        ...aiReviewFetchDefaults,
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        // Send only user input; the server owns routing and guardrail calculation.
        body: JSON.stringify({ input, userNotes: notes, recommendationMode: mode }),
        signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
      });
      const data = await readJsonResponse<Partial<TieBreakResponse> & { error?: string; correlationId?: string; status?: { enabled?: boolean } | number }>(res, "AI review");
      if (!res.ok) {
        const reference = data?.correlationId ? ` Reference: ${data.correlationId}` : "";
        const error = new Error(`${data?.error || "Recommendation generation failed"}${reference}`);
        if (typeof data.status === "object" && data.status?.enabled === false) error.name = "AiReviewDisabledError";
        throw error;
      }
      return data as TieBreakResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  // Creates an AbortController registered in the shared set so a navigation-away
  // unmount can cancel it. The caller must call release() in a finally block.
  function trackController() {
    const controller = new AbortController();
    pendingControllersRef.current.add(controller);
    return {
      controller,
      release() {
        pendingControllersRef.current.delete(controller);
      }
    };
  }

  async function applyRefinement() {
    if (!userNotes.trim() || !aoaiEnabled) return;
    const notes = recommendationNotes(appliedNotes, userNotes);
    const seq = ++requestSeqRef.current;
    const { controller, release } = trackController();
    setRefining(true);
    setTieBreakError(null);
    setRefineError(null);
    try {
      const data = await requestRecommendation("fast", notes, controller.signal);
      // Drop this result if the user already triggered a newer request or a newer
      // result was already applied, so we never revert to stale output.
      if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return;
      lastAppliedSeqRef.current = seq;
      pendingChangeReason.current = "refinement";
      setTieBreakResult(data);
      setTieBreakError(null);
      setAppliedNotes(notes);
      setRefinedAt(new Date());
      setUserNotes("");
      setArchitectureRequested(false);
      setArchitectureRendering(false);
      setArchitectureImageDataUrl(null);
    } catch (e: any) {
      if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return; // navigated away or superseded — drop silently
      // An expired EasyAuth session surfaces as a network "Failed to fetch"; refresh
      // the token and retry once before surfacing an error to the user.
      if (isLikelyAuthFetchFailure(e)) {
        try {
          if (!await refreshAuthSession(canRefreshAuth)) throw e;
          const data = await requestRecommendation("fast", notes, controller.signal);
          if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return;
          lastAppliedSeqRef.current = seq;
          pendingChangeReason.current = "refinement";
          setTieBreakResult(data);
          setTieBreakError(null);
          setAppliedNotes(notes);
          setRefinedAt(new Date());
          setUserNotes("");
          setArchitectureRequested(false);
          setArchitectureRendering(false);
          setArchitectureImageDataUrl(null);
          return;
        } catch (retryError: any) {
          if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return;
          const retryMessage = retryError?.message ?? "Refinement failed";
          if (isAiReviewDisabledError(retryError) || isAiReviewAuthError(retryMessage)) setAoaiEnabled(false);
          setRefineError(aiReviewErrorMessage(retryError));
          return;
        }
      }
      const message = e?.message ?? "Refinement failed";
      if (isAiReviewDisabledError(e) || isAiReviewAuthError(message)) setAoaiEnabled(false);
      setRefineError(aiReviewErrorMessage(e));
    } finally {
      release();
      if (!controller.signal.aborted) setRefining(false);
    }
  }

  async function runDeepValidation() {
    if (!aoaiEnabled || deepValidating) return;
    const seq = ++requestSeqRef.current;
    const { controller, release } = trackController();
    setDeepValidating(true);
    setTieBreakError(null);
    setRefineError(null);
    try {
      const notes = recommendationNotes(appliedNotes, userNotes) || undefined;
      const data = await requestRecommendation("deep", notes, controller.signal);
      if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return;
      lastAppliedSeqRef.current = seq;
      pendingChangeReason.current = "deep_validation";
      setTieBreakResult(data);
      setTieBreakError(null);
      setAppliedNotes(notes ? `Deep validation: ${notes}` : "Deep validation with AI reviewer");
      setRefinedAt(new Date());
      setUserNotes("");
      setArchitectureRequested(false);
      setArchitectureRendering(false);
      setArchitectureImageDataUrl(null);
    } catch (e: any) {
      if (controller.signal.aborted || seq < lastAppliedSeqRef.current) return; // navigated away or superseded — drop silently
      const message = e?.message ?? "Deep validation failed";
      if (isAiReviewDisabledError(e) || isAiReviewAuthError(message)) setAoaiEnabled(false);
      setRefineError(aiReviewErrorMessage(e));
    } finally {
      release();
      if (!controller.signal.aborted) setDeepValidating(false);
    }
  }

  // Abort every in-flight AI-review request when the component unmounts (Start over
  // / Back), so no pending or running model call survives into the next scenario.
  useEffect(() => {
    const controllers = pendingControllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  // Keep the EasyAuth session fresh while the recommendation page is open so a long
  // session never silently 302s a background /api/tiebreak call. Runs on mount, every
  // 20 minutes, and whenever the tab regains focus.
  useEffect(() => {
    if (aoaiEnabled !== true || !canRefreshAuth) return;
    void refreshAuthSession(true);
    const interval = setInterval(() => void refreshAuthSession(true), 20 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAuthSession(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [aoaiEnabled, canRefreshAuth]);

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;
    let authRefreshEnabled = false;
    // This initial load is the first AI-review request. A refinement / deep
    // validation the user triggers later takes a higher id, so the guards below
    // stop a slow initial load (or its retry) from landing late and overwriting an
    // already-applied refinement.
    const loadSeq = ++requestSeqRef.current;

    const runOnce = async () => {
      const controller = new AbortController();
      activeController = controller;
      pendingControllersRef.current.add(controller);
      try {
        return await requestRecommendation("fast", undefined, controller.signal);
      } finally {
        pendingControllersRef.current.delete(controller);
      }
    };

    (async () => {
      setTieBreakLoading(true);
      setTieBreakError(null);
      try {
        const controller = new AbortController();
        activeController = controller;
        pendingControllersRef.current.add(controller);
        const timer = setTimeout(() => controller.abort(), 10_000);
        let enabled: boolean;
        try {
          enabled = await readAiReviewAvailability(controller.signal, (value) => {
            authRefreshEnabled = value;
            if (!cancelled) setCanRefreshAuth(value);
          });
        } finally {
          clearTimeout(timer);
          pendingControllersRef.current.delete(controller);
        }
        if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
        setAoaiEnabled(enabled);
        if (!enabled) {
          setTieBreakLoading(false);
          return;
        }
      } catch (error) {
        if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
        setAoaiEnabled(false);
        setTieBreakError(aiReviewErrorMessage(error, true));
        setTieBreakLoading(false);
        return;
      }
      try {
        const data = await runOnce();
        if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
        lastAppliedSeqRef.current = loadSeq;
        setTieBreakResult(data);
        setAoaiEnabled(true);
        setTieBreakError(null);
      } catch (error) {
        if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
        if (isAiReviewDisabledError(error)) {
          setAoaiEnabled(false);
          setTieBreakError(aiReviewErrorMessage(error));
          return;
        }
        // The server owns transport and report-repair retries. Reissue the whole
        // workflow only after a supported sign-in refresh actually succeeds.
        try {
          if (!isLikelyAuthFetchFailure(error) || !await refreshAuthSession(authRefreshEnabled)) throw error;
          if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
          const data = await runOnce();
          if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
          lastAppliedSeqRef.current = loadSeq;
          setTieBreakResult(data);
          setAoaiEnabled(true);
          setTieBreakError(null);
        } catch (e2: any) {
          if (cancelled || loadSeq < lastAppliedSeqRef.current) return;
          const message = e2?.message ?? "AI review failed.";
          if (isAiReviewDisabledError(e2) || isAiReviewAuthError(message)) setAoaiEnabled(false);
          setTieBreakError(aiReviewErrorMessage(e2));
        }
      } finally {
        if (!cancelled) setTieBreakLoading(false);
      }
    })();

    // Run exactly once per mount. Each case (Start over / load example / back-and-
    // forth) remounts this component, so a fresh mount triggers one load. Empty
    // deps make the load immune to benign prop/state churn that previously re-ran
    // the effect mid-flight and cancelled the in-flight result.
    return () => {
      cancelled = true;
      activeController?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (architectureRevealTimer.current) clearTimeout(architectureRevealTimer.current);
    };
  }, []);

  const aiBaseDiffers =
    !!tieBreakResult &&
    tieBreakResult.recommendedBasePatternId !== decision.basePatternId;

  const presentedDecision = useMemo(
    () => withAiRecommendation(decision, tieBreakResult),
    [decision, tieBreakResult]
  );
  const categoryInfo = useMemo(() => categoryForDecision(presentedDecision), [presentedDecision]);
  const deterministicDiagram = useMemo(() => buildMermaidDiagram(presentedDecision), [presentedDecision]);
  const baselineDiagram = useMemo(() => buildMermaidDiagram(decision), [decision]);
  const displayPattern = useMemo(() => presentedDecision.basePatternId === "m365_copilot_productivity"
    ? displayPatternName(presentedDecision)
    : tieBreakResult?.displayPatternName?.trim() || displayPatternName(presentedDecision), [presentedDecision, tieBreakResult]);
  const optionalAiLoading = tieBreakLoading || refining || deepValidating || (aoaiEnabled === null && !tieBreakError);
  const hasUsableRecommendation = presentedDecision.architectureLayers.length > 0 || !!presentedDecision.finalRecommendation.trim();
  const initialAiRecommendationLoading = !hasUsableRecommendation && optionalAiLoading;
  const componentFlowLoading = !hasUsableRecommendation && initialAiRecommendationLoading;
  const executiveSummaryLoading = !hasUsableRecommendation && (initialAiRecommendationLoading || refining || deepValidating);
  const architectureDiagramLoading = !hasUsableRecommendation && initialAiRecommendationLoading;
  const activeMermaid = componentFlowLoading ? "" : deterministicDiagram;
  const solutionType = presentedDecision.basePatternId === "m365_copilot_productivity"
    ? displayPatternName(presentedDecision)
    : tieBreakResult?.solutionType?.trim() || categoryInfo.category;
  const recommendationPreparing = !hasUsableRecommendation && (initialAiRecommendationLoading || refining || deepValidating);
  const refinementText = useMemo(() => {
    const text = appliedNotes?.replace(/^Deep validation:\s*/i, "").trim() ?? "";
    return /^Deep validation with (?:GPT-?5\.4|AI reviewer)$/i.test(text) ? "" : text;
  }, [appliedNotes]);
  const displayInput = input;
  const leaveReview = (navigate: () => void) => {
    if ((userNotes.trim() || appliedNotes) && !window.confirm(
      "This AI review and its notes are not saved with the wizard profile. Export first to keep this result. Leave the review?"
    )) return;
    navigate();
  };

  const confidencePresentation = useMemo(
    () => describeConfidence(presentedDecision, displayInput),
    [presentedDecision, displayInput]
  );

  const requestArchitecture = () => {
    if (architectureRevealTimer.current) clearTimeout(architectureRevealTimer.current);
    architectureRenderStartedAt.current = Date.now();
    setArchitectureRequested(true);
    setArchitectureRendering(true);
    setArchitectureImageDataUrl(null);
    setImageRefreshNonce((n) => n + 1);
  };

  const handleArchitectureGenerated = (dataUrl: string | null) => {
    setArchitectureImageDataUrl(dataUrl);
    if (dataUrl) {
      trackUsageEvent({
        eventType: "architecture_diagram_generated",
        sessionId: usageSession.id,
        source: usageSession.source,
        sourceDetail: usageSession.sourceDetail,
        solutionType,
        basePatternId: presentedDecision.basePatternId
      });
      const elapsed = Date.now() - architectureRenderStartedAt.current;
      const delay = Math.max(800 - elapsed, 0);
      architectureRevealTimer.current = setTimeout(() => {
        setArchitectureRendering(false);
      }, delay);
    }
  };

  const useCaseTitle =
    tieBreakResult?.useCaseTitle?.trim() || solutionType;
  const baseUseCaseSummary = reportUseCaseSummary(input, presentedDecision, tieBreakResult);
  // The AI regenerates useCaseSummary from the refinement (sent as userNotes), so the
  // visible summary already reflects it — never bolt on a literal "Refinement applied" line.
  const useCaseSummary = baseUseCaseSummary;
  const solutionTypeDetails = [displayPattern, ...presentedDecision.overlays.map((o) => o.name)];
  const generatedArchitectureSummary = useMemo(
    () => buildArchitectureSummary(displayInput, presentedDecision, solutionType),
    [displayInput, presentedDecision, solutionType]
  );
  const aiArchitectureSummary = tieBreakResult?.proposedArchitectureSummary?.trim() || "";
  const baseProposedArchitectureSummary = tieBreakResult?.aiValidated && aiArchitectureSummary
    ? aiArchitectureSummary : shouldUseGeneratedArchitectureSummary(
    aiArchitectureSummary,
    useCaseSummary,
    presentedDecision.finalRecommendation,
    solutionType
  )
    ? generatedArchitectureSummary
    : aiArchitectureSummary;
  // The AI regenerates the architecture summary from the refinement; appending a literal
  // "Refinement applied" paragraph here previously created a bogus extra "Detail" section.
  const proposedArchitectureSummary = baseProposedArchitectureSummary;

  useEffect(() => {
    if (recommendationPreparing || executiveSummaryLoading || !usageSession) return;
    const fingerprint = JSON.stringify({
      sessionId: usageSession.id,
      basePatternId: presentedDecision.basePatternId,
      overlays: presentedDecision.overlays.map((overlay) => overlay.id),
      solutionType,
      confidence: presentedDecision.confidence,
      summary: proposedArchitectureSummary.slice(0, 500)
    });
    if (lastTrackedArchitecture.current === fingerprint) return;
    lastTrackedArchitecture.current = fingerprint;
    trackArchitectureOutput({
      session: usageSession,
      input: displayInput,
      decision: presentedDecision,
      solutionType,
      changeReason: pendingChangeReason.current,
      summary: proposedArchitectureSummary
    });
    pendingChangeReason.current = "profile_or_recommendation_change";
  }, [displayInput, executiveSummaryLoading, presentedDecision, proposedArchitectureSummary, recommendationPreparing, solutionType, usageSession]);

  const combinedAssumptions = useMemo(() => {
    const set = new Set<string>();
    [...presentedDecision.assumptions, ...(tieBreakResult?.assumptions ?? [])].forEach((a) => {
      if (a && a.trim()) set.add(a.trim());
    });
    if (refinementText) set.add(`User refinement applied: ${refinementText}`);
    return Array.from(set);
  }, [presentedDecision.assumptions, refinementText, tieBreakResult]);

  const combinedRisks = useMemo(() => {
    const set = new Set<string>();
    [...presentedDecision.riskFlags, ...(tieBreakResult?.riskFlags ?? [])].forEach((r) => {
      if (r && r.trim()) set.add(r.trim());
    });
    return Array.from(set);
  }, [presentedDecision.riskFlags, tieBreakResult]);

  const tabs: Array<{ id: RecommendationTab; label: string; description: string }> = [
    { id: "overview", label: "Overview", description: "Input, recommendation, checks, and services" },
    { id: "architecture", label: "Architecture", description: "Diagram, service flow, and rationale" },
    { id: "governance", label: "Governance", description: "Assumptions, risks, controls, and safeguards" },
    { id: "technical", label: "Technical", description: "Architecture layers and detailed reasoning" }
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* ============ DISCLAIMER ============ */}
      <details className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 shadow-sm">
        <summary className="cursor-pointer font-semibold">
          Disclaimer and validation note
        </summary>
        <p className="mt-1 leading-relaxed">
          This is only a <em>suggested</em> set of building blocks for the described use case. Validate fit against your organization's architecture standards, data residency, regulatory obligations, security baseline, pricing, SKUs, and service availability.
        </p>
      </details>

      {/* ============ REFINED BANNER ============ */}
      {appliedNotes && refinedAt ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] uppercase tracking-wider font-semibold">
                Refined
              </span>
              <span className="text-xs text-emerald-800">
                Review updated; profile inputs are unchanged
                {" "}
                <span className="text-emerald-700">
                  ({refinedAt.toLocaleTimeString()})
                </span>
              </span>
            </div>
            <button
              type="button"
              className="text-[11px] text-emerald-800 underline"
              onClick={() => {
                setRefinedAt(null);
              }}
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2 text-xs">
            <div className="font-semibold text-emerald-800 uppercase tracking-wider text-[10px]">
              Your input applied
            </div>
            <blockquote className="mt-1 border-l-2 border-emerald-400 pl-3 italic text-emerald-900">
              {appliedNotes}
            </blockquote>
          </div>
        </div>
      ) : null}

      {/* ============ RECOMMENDATION HEADER ============ */}
      <Coachmarks steps={recommendationCoachSteps} storageKey="ai-pdn:coach-recommendation" replay={recommendationCoachReplay} autoShow="never" />
      <section className="brand-hero rounded-2xl border border-[#0F6CBD]/30 p-5 shadow-brand">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-3">
          <BrandMark tone="dark" withTagline size="sm" />
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 md:justify-end">
            <button
              type="button"
              onClick={() => setRecommendationCoachReplay((n) => n + 1)}
              className="btn-compact inline-flex items-center gap-1.5 border border-[#3CC1FF]/60 bg-[#3CC1FF]/15 font-semibold text-white hover:bg-[#3CC1FF]/30"
              title="Show a quick walkthrough of this screen"
            >
              <Sparkles className="h-4 w-4" /> How this works
            </button>
            <span data-coach="rec-export" className="inline-flex">
              {recommendationPreparing ? (
                <button className="btn-compact border border-white/30 bg-white/10 text-white opacity-60 cursor-not-allowed" disabled>
                  Export as PowerPoint
                </button>
              ) : (
                <ExportPPTButton
                  input={displayInput}
                  decision={presentedDecision}
                  tieBreak={tieBreakResult}
                  category={categoryInfo}
                  mermaidCode={activeMermaid}
                  mermaidFallback={baselineDiagram}
                  architectureImageDataUrl={architectureImageDataUrl}
                  refinement={refinementText}
                  usageSession={usageSession}
                  compact
                />
              )}
            </span>
            <button className="btn-compact border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => leaveReview(onBack)}>Back to wizard</button>
            <button className="btn-compact border border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => leaveReview(onReset)}>Start over</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4" data-coach="rec-result">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
              <span>Your recommendation</span>
              {optionalAiLoading ? (
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">{aoaiEnabled === null ? "Checking AI availability" : "Optional AI review running"}</span>
              ) : tieBreakError || refineError ? (
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white" title="The AI update did not finish. The last report or a clearly labeled rules-based draft remains available.">{tieBreakResult ? "Current result retained" : "Rules-based draft"}</span>
              ) : tieBreakResult ? (
                <span className="rounded-full bg-emerald-200/20 px-2.5 py-0.5 text-xs font-medium text-emerald-50">AI-refined</span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white lg:text-3xl">
              {recommendationPreparing ? "Preparing recommendation" : solutionType}
            </h1>
            {recommendationPreparing ? (
              <p className="mt-1 text-sm font-semibold text-white/85">
                Recommendation path will appear when checks complete.
              </p>
            ) : (
              <p className="mt-1 text-sm font-semibold text-white/85">
                Recommended path: {displayPattern}
              </p>
            )}
          </div>
        </div>

        <p className="mt-3 max-w-6xl text-sm leading-relaxed text-white/90">
          {recommendationPreparing
            ? "Pathfinder is reviewing the deterministic route, composing the business summary, and checking guardrails."
            : useCaseSummary}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/20 pt-3">
          {!recommendationPreparing ? (
            <>
              <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-ms-blueDark">{solutionType}</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  confidencePresentation.tone === "high"
                    ? "bg-emerald-200/20 text-emerald-50"
                    : confidencePresentation.tone === "medium"
                    ? "bg-amber-200/20 text-amber-50"
                    : "bg-rose-200/20 text-rose-50"
                }`}
                title={confidencePresentation.detail}
              >
                {confidencePresentation.label}
              </span>
              {presentedDecision.overlays.map((o) => (
                <span key={o.id} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white" title={o.reason}>
                  + {o.name}
                </span>
              ))}
            </>
          ) : (
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">Composing final recommendation</span>
          )}
        </div>
        {!recommendationPreparing && confidencePresentation.detail ? (
          <p className="mt-2 text-xs leading-relaxed text-white/80">{confidencePresentation.detail}</p>
        ) : null}
      </section>

      <nav className="rounded-2xl border border-ms-border bg-white p-1.5 shadow-card" aria-label="Recommendation sections" data-coach="rec-tabs">
        <div className="grid gap-1 md:grid-cols-4">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  active
                    ? "bg-[#EFF6FC] text-ms-blue ring-1 ring-[#BBD6F2]"
                    : "text-gray-600 hover:bg-gray-50 hover:text-ms-text"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {activeTab === "overview" ? (
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)] xl:items-start">
        <div className="space-y-4">
        <div className="card rounded-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Recommendation summary</h2>
            {executiveSummaryLoading ? (
              <span className="badge badge-muted">Waiting for LLM</span>
            ) : (
              <span className="badge badge-info">Solution Type: {solutionType}</span>
            )}
          </div>
          <div className="mt-3">
            <UserInputSummary input={displayInput} refinement={refinementText} />
          </div>
          {executiveSummaryLoading ? (
            <div className="mt-3 flex min-h-[140px] items-center justify-center rounded-md border border-ms-border bg-ms-gray/30 text-xs text-gray-600">
              <span className="mr-2 h-5 w-5 rounded-full border-2 border-ms-blue border-t-transparent animate-spin" />
              Waiting for the LLM to generate the executive summary...
            </div>
          ) : (
            <>
              <div className="mt-3 rounded-lg border border-ms-blue/20 border-l-4 border-l-ms-blue bg-[#F7FAFE] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                  Recommended path
                </div>
                <p className="mt-1 text-base font-semibold text-ms-text">
                  {solutionType}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">
                  {solutionTypeDetails.join(" + ")}
                </p>
              </div>
              <div className="mt-4 rounded-lg border border-ms-border bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                  Use case summary
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ms-text">
                  {useCaseSummary}
                </p>
              </div>

              {proposedArchitectureSummary ? (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                    Recommended solution architecture
                  </div>
                  <ArchitectureSummarySections text={proposedArchitectureSummary} />
                </div>
              ) : presentedDecision.finalRecommendation ? (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                    Recommended solution architecture
                  </div>
                  <ArchitectureSummarySections text={presentedDecision.finalRecommendation} />
                </div>
              ) : null}
            </>
          )}

          {!executiveSummaryLoading && aiBaseDiffers ? (
            <div className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
              AI suggested a different routing pattern (
              <code>{tieBreakResult?.recommendedBasePatternId}</code>) but deterministic
              rules retain <strong>{displayPattern}</strong>. Review the
              suggested follow-up questions below to refine.
            </div>
          ) : null}

          {!executiveSummaryLoading && tieBreakResult && tieBreakResult.questionsToAskNext.length > 0 ? (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                Questions to confirm
              </div>
              <ul className="mt-1 text-sm list-disc list-inside space-y-0.5 text-ms-text">
                {tieBreakResult.questionsToAskNext.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {aoaiEnabled ? (
            <div className="mt-5 rounded-lg border border-ms-border bg-[#FAFBFC] p-4" data-coach="rec-refine">
              <label htmlFor="recommendation-refinement" className="block text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                Refine the recommendation
              </label>
              <p className="text-xs text-gray-600 mt-1">
                Add review context, discuss assumptions, or request clearer reasoning.
                Profile inputs and required controls stay in force. Use Back to wizard
                to change the architecture requirements. AI reviews and notes are
                session-only; export before leaving or reloading.
              </p>
              <textarea
                id="recommendation-refinement"
                className="mt-3 w-full border border-gray-300 rounded-md bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ms-blue/40"
                rows={4}
                placeholder="e.g. Confirmed: users are internal only. Please emphasise Microsoft 365 Copilot extensibility and remove Logic Apps from the architecture."
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                disabled={refining}
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded bg-ms-blue text-white hover:bg-ms-blue-dark disabled:opacity-50"
                  onClick={applyRefinement}
                  disabled={refining || !userNotes.trim()}
                >
                  {refining ? "Refining…" : "Apply refinement"}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-ms-blue text-ms-blue bg-white hover:bg-ms-blue/5 disabled:opacity-50"
                  onClick={runDeepValidation}
                  disabled={deepValidating || refining || aoaiEnabled !== true}
                  title="Runs the architecture model at medium reasoning, followed by a separate AI review."
                >
                  {deepValidating ? "Deep validating…" : "Deep validate"}
                </button>
                {userNotes && !refining ? (
                  <button
                    type="button"
                    className="text-xs text-gray-600 underline"
                    onClick={() => setUserNotes("")}
                  >
                    Clear
                  </button>
                ) : null}
                {refineError ? (
                  <span role="alert" className="text-xs text-red-700">{refineError}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        </div>

        <aside className="space-y-4">

        <div className="card rounded-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Recommended services</h2>
            <SourceBadge loading={optionalAiLoading} aiReady={!!tieBreakResult && !tieBreakError} />
          </div>
          {initialAiRecommendationLoading ? (
            <RecommendationLoading message="Waiting for the LLM to generate the technology stack..." />
          ) : (
            <>
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
                  Core services
                </div>
                <ul className="mt-2 space-y-1.5 text-xs">
                  {presentedDecision.recommendedStack.map((s) => (
                    <li key={s} className="flex items-start gap-2 rounded-md bg-[#F7FAFE] px-2.5 py-1.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ms-blue shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
                  Optional additions
                </div>
                {presentedDecision.optionalAddOns.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-400">None</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {presentedDecision.optionalAddOns.map((s) => (
                      <li key={s} className="flex items-start gap-2 rounded-md bg-gray-50 px-2.5 py-1.5">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                        <span className="text-gray-700">{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

          <AgentPipelinePanel
            enabled={aoaiEnabled}
            loading={aoaiEnabled === true && optionalAiLoading}
            error={tieBreakError || refineError}
            trace={tieBreakResult?.agentTrace}
            decision={decision}
          />
        </aside>
      </section>
      ) : null}

      {activeTab === "architecture" ? (
      <>
      {/* ============ HIGH-LEVEL ARCHITECTURE (MICROSOFT ICONS) ============ */}
      <section className="card rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3" data-coach="rec-architecture">
          <div>
            <h2 className="text-base font-semibold">Connected Microsoft architecture</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Service icons, labeled connections, and logical workload boundaries. Request paths and background preparation are distinct; the page and PowerPoint share the same connected layout.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={requestArchitecture}
            disabled={architectureDiagramLoading}
            title={architectureDiagramLoading ? "Wait for the recommendation to finish first" : "Generate the architecture diagram"}
          >
            {architectureRequested ? "Regenerate architecture" : "Generate architecture"}
          </button>
        </div>
        <div className="mt-3">
          {architectureDiagramLoading ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-[#FAFBFC] p-6 text-center">
              <p className="text-sm font-medium text-gray-800">Architecture generation will be available when the recommendation finishes.</p>
              <p className="text-xs text-gray-500 mt-1">No architecture image is generated until you click Generate architecture.</p>
            </div>
          ) : !architectureRequested ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ms-blue/30 bg-[#F7FAFE] p-6 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ms-blue shadow-sm">
                +
              </span>
              <p className="text-sm font-medium text-gray-800">Architecture diagram is ready to generate.</p>
              <p className="text-xs text-gray-500 mt-1">Click Generate architecture to render the layered diagram from the final recommendation.</p>
            </div>
          ) : (
            <>
              {architectureRendering ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-[#FAFBFC] p-6 text-center">
                  <div className="w-10 h-10 border-2 border-ms-blue border-t-transparent rounded-full animate-spin" />
                  <p role="status" className="text-sm font-medium text-gray-800 mt-3">Generating architecture...</p>
                  <p className="text-xs text-gray-500 mt-1">The previous diagram is hidden while a new one is rendered from the latest recommendation.</p>
                </div>
              ) : null}
              <div className={architectureRendering ? "hidden" : ""}>
                <ArchitectureImage
                  key={imageRefreshNonce}
                  decision={presentedDecision}
                  input={displayInput}
                  refreshNonce={imageRefreshNonce}
                  onGenerated={handleArchitectureGenerated}
                  onError={() => setArchitectureRendering(false)}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* ============ COMPONENT FLOW ============ */}
      <section className="card rounded-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Service flow</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Concrete paths from the same model. Dashed confirmation paths are proposed decisions, not enabled access. Source permissions remain independent at each data boundary.
            </p>
          </div>
          {componentFlowLoading ? (
            <span className="badge badge-muted">Loading</span>
          ) : (
            <span className="badge badge-muted">High-level</span>
          )}
        </div>
        <div className="mt-4 border border-gray-200 rounded-xl bg-white p-3 shadow-sm">
          {componentFlowLoading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-gray-600">
              <span className="mr-2 h-5 w-5 rounded-full border-2 border-ms-blue border-t-transparent animate-spin" />
              Loading component flow...
            </div>
          ) : (
            <MermaidDiagram code={activeMermaid} fallbackCode={baselineDiagram} />
          )}
        </div>
      </section>

      {/* ============ END TO END FLOW + RATIONALE ============ */}
      <section className="grid gap-3 xl:grid-cols-2">
        <div className="card rounded-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">How it works</h2>
            <SourceBadge loading={optionalAiLoading} aiReady={!!tieBreakResult && !tieBreakError} />
          </div>
          {initialAiRecommendationLoading ? (
            <RecommendationLoading message="Waiting for the LLM to generate the end-to-end flow..." />
          ) : (
            <ol className="mt-3 space-y-1.5 text-xs">
              {presentedDecision.endToEndFlow.map((s, i) => (
                <li key={i} className="flex gap-2.5 rounded-lg border border-ms-border bg-[#FAFBFC] px-2.5 py-1.5">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-ms-blue text-white text-xs font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="card rounded-xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Why this recommendation</h2>
            <SourceBadge loading={optionalAiLoading} aiReady={!!tieBreakResult && !tieBreakError} />
          </div>
          {initialAiRecommendationLoading ? (
            <RecommendationLoading message="Waiting for the LLM to generate the rationale..." />
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs">
              {presentedDecision.rationale.map((r, i) => (
                <li key={i} className="flex gap-2 rounded-lg border border-ms-border bg-[#FAFBFC] px-2.5 py-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ms-blue shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      </>
      ) : null}

      {activeTab === "governance" ? (
      <>
      <section className="card rounded-xl border-l-4 border-l-ms-blue bg-[#F7FAFE]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">
              Selection rationale
            </div>
            <h2 className="mt-1 text-base font-semibold">Why this solution was chosen</h2>
          </div>
          <span className="badge badge-info">{solutionType}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ms-text">
          Pathfinder selected <span className="font-semibold">{displayPattern}</span> because it best matches the selected users, channel, data, behavior, runtime, security, and deployment signals while preserving deterministic guardrails.
        </p>
        {initialAiRecommendationLoading ? (
          <RecommendationLoading message="Waiting for the LLM to refine the selection rationale..." />
        ) : presentedDecision.rationale.length === 0 ? (
          <p className="mt-3 text-xs text-gray-500">No additional rationale was returned for this recommendation.</p>
        ) : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {presentedDecision.rationale.map((reason, index) => (
              <li key={index} className="flex gap-2 rounded-md border border-[#D6E3F3] bg-white px-3 py-2 text-xs leading-relaxed text-ms-text">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ms-blue" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ============ ASSUMPTIONS + RISKS + SECURITY ============ */}
      <section className="grid gap-3 xl:grid-cols-3">
        <div className="card rounded-xl border-t-4 border-t-gray-300">
          <h2 className="text-base font-semibold">Assumptions to confirm</h2>
          {combinedAssumptions.length === 0 && decision.missingQuestions.length === 0 ? (
            <p className="mt-2 text-xs text-gray-400">None recorded.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs">
              {combinedAssumptions.map((s, i) => (
                <li key={`a${i}`} className="flex gap-2 rounded-md bg-gray-50 px-2.5 py-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
              {decision.missingQuestions.map((q) => (
                <li key={q.id} className="flex gap-2 rounded-md bg-amber-50 px-2.5 py-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-amber-900">Missing: {q.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card rounded-xl border-t-4 border-t-amber-400">
          <h2 className="text-base font-semibold">Risks to review</h2>
          {combinedRisks.length === 0 ? (
            <p className="mt-2 text-xs text-gray-400">No risks flagged.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs">
              {combinedRisks.map((r, i) => (
                <li key={i} className="flex gap-2 rounded-md bg-amber-50 px-2.5 py-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-amber-900">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card rounded-xl border-t-4 border-t-emerald-500">
          <h2 className="text-base font-semibold">Security and access</h2>
          {presentedDecision.securityControls.length === 0 ? (
            <p className="mt-2 text-xs text-gray-400">None selected.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs">
              {presentedDecision.securityControls.map((s) => (
                <li key={s} className="flex gap-2 rounded-md bg-emerald-50 px-2.5 py-1.5">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ============ ZERO TRUST ZONE ============ */}
      <section
        className={`card rounded-xl border-l-4 ${
          presentedDecision.zeroTrust.applicable
            ? "border-l-emerald-600 bg-emerald-50/40"
            : "border-l-gray-300"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-emerald-700 font-semibold">
              Recommended Safeguards
            </div>
            <h2 className="mt-1 text-base font-semibold">Guardrails for this workload</h2>
          </div>
          <span
            className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${
              presentedDecision.zeroTrust.applicable
                ? "bg-emerald-600 text-white"
                : "bg-gray-200 text-gray-700"
            }`}
          >
            Recommended
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ms-text">{presentedDecision.zeroTrust.rationale}</p>
        {presentedDecision.zeroTrust.controls.length > 0 ? (
          <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2 2xl:grid-cols-3">
            {presentedDecision.zeroTrust.controls.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[11px] text-gray-500 italic">
          Required controls are listed separately above. These safeguards help apply verify explicitly,
          least-privilege access, and assume-breach practices without making every safeguard mandatory.
        </p>
      </section>

      </>
      ) : null}

      {activeTab === "technical" ? (
      <>
      {/* ============ ARCHITECTURE LAYERS ============ */}
      <section className="card rounded-xl">
        <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Architecture details</h2>
          <SourceBadge loading={optionalAiLoading} aiReady={!!tieBreakResult && !tieBreakError} />
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Every layer can hold multiple selections — overlays compose with the base pattern.
        </p>
        <div className="mt-3">
          {initialAiRecommendationLoading ? (
            <RecommendationLoading message="Waiting for the LLM to generate the architecture layers..." />
          ) : (
            <ArchitectureLayerTable layers={presentedDecision.architectureLayers} />
          )}
        </div>
      </section>

      {/* ============ AI REASONING (collapsed-feel) ============ */}
      {tieBreakResult && tieBreakResult.reasoning.length > 0 ? (
        <section className="card rounded-xl">
          <details>
            <summary className="cursor-pointer text-base font-semibold">
              Technical details
            </summary>
            <p className="mt-2 text-xs text-gray-500">
              Background tie-break output. Deterministic rules above always take precedence.
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Reasoning
                </h3>
                <ul className="list-inside list-disc space-y-0.5 text-xs">
                  {tieBreakResult.reasoning.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                {tieBreakResult.recommendedOverlays.length > 0 ? (
                  <>
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                      AI-suggested overlays
                    </h3>
                    <ul className="list-inside list-disc space-y-0.5 text-xs">
                      {tieBreakResult.recommendedOverlays.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {tieBreakResult.mustNotInclude.length > 0 ? (
                  <>
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mt-3">
                      Must not include
                    </h3>
                    <ul className="list-inside list-disc space-y-0.5 text-xs">
                      {tieBreakResult.mustNotInclude.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </div>
          </details>
        </section>
      ) : null}
      </>
      ) : null}

    </div>
  );
}
