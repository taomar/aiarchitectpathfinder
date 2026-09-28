"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RecommendationPageLayout, type RecommendationTab } from "./RecommendationPageLayout";
import type { ArchitectureBuildState } from "./ArchitectureBuildNotice";
import { AcceptedRecommendationSchema, RECOMMENDATION_CONTRACT_VERSION, recommendationDecision, attachRecommendationArchitecture, type AcceptedRecommendation } from "@/lib/recommendation-contract";
import { RECOMMENDATION_CLIENT_TIMEOUT_MS, REVIEW_CLIENT_TIMEOUT_MS } from "@/lib/recommendation-policy";
import { RecommendationRequestError, readRecommendationResponse, type RecommendationProgress } from "@/lib/recommendation-progress";
import { readJsonResponse } from "@/lib/api-response";
import { trackArchitectureOutput, trackUsageEvent, type UsageSession } from "@/lib/usage-client";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "@/lib/types";

type Phase = "loading" | "refining" | "reviewing" | "ready" | "error";
type GenerationState = {
  phase: Phase;
  operation: "generate" | "review";
  report: AcceptedRecommendation | null;
  message: string | null;
  issues: string[];
  progress: RecommendationProgress | null;
  startedAt: number;
};

export function withAiRecommendation(_draft: ArchitectureDecision, report: TieBreakResponse | null): ArchitectureDecision {
  return recommendationDecision(AcceptedRecommendationSchema.parse(report));
}

export function recommendationNotes(appliedNotes: string | null, draft: string) {
  const previous = appliedNotes?.replace(/^Deep validation:\s*/i, "").trim() ?? "";
  const accepted = /^Deep validation with (?:GPT-?5\.4|AI reviewer)$/i.test(previous) ? "" : previous;
  return [...new Set([accepted, draft.trim()].filter(Boolean))].join("\n\n");
}

export function aiReviewErrorMessage(error: unknown, availability = false) {
  if (error instanceof RecommendationRequestError) return error.message;
  if (error instanceof Error && /AbortError|TimeoutError/.test(error.name)) {
    return "The AI request timed out. Your previous architecture, if any, is unchanged.";
  }
  return availability
    ? "AI availability could not be confirmed. Retry when the service is available."
    : "The AI recommendation could not be completed. Please retry.";
}

export async function readAiReviewAvailability(
  signal?: AbortSignal,
  onAuthRefreshPolicy?: (enabled: boolean) => void,
  onReviewAvailability?: (enabled: boolean) => void
): Promise<boolean> {
  const response = await fetch("/api/tiebreak", {
    credentials: "include", cache: "no-store", headers: { Accept: "application/json" }, signal, method: "GET"
  });
  if (response.status === 401) throw new RecommendationRequestError(
    "Your session expired or the local app restarted. Sign in again before continuing.", "AUTHENTICATION_REQUIRED"
  );
  const value = await readJsonResponse<unknown>(response, "AI availability");
  if (!response.ok || !value || typeof value !== "object" || !("enabled" in value) || typeof value.enabled !== "boolean") {
    throw new RecommendationRequestError("AI availability could not be checked. Please retry.", "AI_UNAVAILABLE");
  }
  if ("contractVersion" in value && value.contractVersion !== RECOMMENDATION_CONTRACT_VERSION) {
    throw new RecommendationRequestError("The app was updated. Reload this page before generating a recommendation.", "APP_VERSION_MISMATCH");
  }
  onAuthRefreshPolicy?.("authRefreshEnabled" in value && value.authRefreshEnabled === true);
  onReviewAvailability?.("reviewAvailable" in value && value.reviewAvailable === true);
  return value.enabled;
}

export function FinalRecommendation({
  input, decision: advisoryDraft, usageSession, onBack, onReset
}: {
  input: DecisionInput;
  decision: ArchitectureDecision;
  usageSession: UsageSession;
  onBack: () => void;
  onReset: () => void;
}) {
  const [state, setState] = useState<GenerationState>(() => ({
    phase: "loading", operation: "generate", report: null, message: null, issues: [], progress: null, startedAt: Date.now()
  }));
  const [activeTab, setActiveTab] = useState<RecommendationTab>("overview");
  const [userNotes, setUserNotes] = useState("");
  const [appliedNotes, setAppliedNotes] = useState<string | null>(null);
  const [diagramRevision, setDiagramRevision] = useState(0);
  const [diagramUrl, setDiagramUrl] = useState<string | null>(null);
  const [canRefreshAuth, setCanRefreshAuth] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const active = useRef<AbortController | null>(null);
  const architectureActive = useRef<AbortController | null>(null);
  const architectureSequence = useRef(0);
  const [architectureState, setArchitectureState] = useState<ArchitectureBuildState>({
    phase: "idle", progress: null, message: null
  });
  const sequence = useRef(0);
  const lastTracked = useRef<string | null>(null);
  const lastRequest = useRef<{ mode: "fast" | "deep"; notes: string | undefined; operation: "generate" | "review" }>({
    mode: "fast", notes: undefined, operation: "generate"
  });
  const inputKey = JSON.stringify(input);
  const report = state.report;
  const busy = ["loading", "refining", "reviewing"].includes(state.phase);
  const acceptedDecision = useMemo(() => report ? recommendationDecision(report) : null, [report]);
  const preliminary = !report && busy;
  const presentationDecision = acceptedDecision ?? (preliminary ? advisoryDraft : null);

  const generate = useCallback(async (
    mode: "fast" | "deep",
    notes: string | undefined,
    previous: AcceptedRecommendation | null,
    phase: Phase,
    operation: "generate" | "review" = "generate"
  ) => {
    active.current?.abort();
    if (operation === "generate") {
      architectureActive.current?.abort();
      architectureSequence.current++;
      setArchitectureState(current => current.phase === "building"
        ? { phase: "error", progress: null, message: "The previous image build was cancelled for this update." } : current);
    }
    const controller = new AbortController();
    active.current = controller;
    const request = ++sequence.current;
    lastRequest.current = { mode, notes, operation };
    setState({ phase, operation, report: previous, message: null, issues: [], progress: null, startedAt: Date.now() });
    try {
      let reviewAvailable = false;
      const enabled = await readAiReviewAvailability(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), value => {
        if (!controller.signal.aborted && request === sequence.current) setCanRefreshAuth(value);
      }, value => {
        reviewAvailable = value;
        if (!controller.signal.aborted && request === sequence.current) setCanReview(value);
      });
      if (!enabled) throw new RecommendationRequestError(
        "AI generation is disabled. Enable a model connection before generating a recommendation.", "AI_DISABLED"
      );
      if (operation === "review" && !reviewAvailable) throw new RecommendationRequestError(
        "Optional AI review is not configured. Your generated architecture is still available.", "AI_ROLE_NOT_CONFIGURED"
      );
      const response = await fetch("/api/tiebreak", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
        body: JSON.stringify({ input, operation, userNotes: notes, recommendationMode: mode, previousRecommendation: previous ?? undefined }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(operation === "review" ? REVIEW_CLIENT_TIMEOUT_MS : RECOMMENDATION_CLIENT_TIMEOUT_MS)])
      });
      const result = await readRecommendationResponse(response, progress => {
        if (!controller.signal.aborted && request === sequence.current) {
          setState(current => ({ ...current, progress, issues: progress.issues ?? current.issues }));
        }
      });
      if (controller.signal.aborted || request !== sequence.current) return;
      setState(current => ({
        ...current, phase: "ready", message: null, issues: [],
        report: operation === "review" && current.report?.reportId === result.reportId
          ? { ...current.report, review: result.review, aiValidated: result.aiValidated, agentTrace: result.agentTrace }
          : result
      }));
      if (operation === "generate") {
        setAppliedNotes(notes?.trim() || null);
        setUserNotes("");
        setDiagramUrl(null);
        setDiagramRevision(value => value + 1);
      }
    } catch (error) {
      if (controller.signal.aborted || request !== sequence.current) return;
      console.error("[recommendation] Generation did not complete:", error instanceof Error ? error.message : String(error));
      setState(current => ({
        ...current, phase: "error",
        report: operation === "review" && current.report?.reportId === previous?.reportId ? current.report : previous,
        message: aiReviewErrorMessage(error),
        issues: error instanceof RecommendationRequestError ? error.issues : []
      }));
    } finally {
      if (active.current === controller) active.current = null;
    }
  // The use-case snapshot changes only when the user changes or reloads the profile.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  useEffect(() => {
    setAppliedNotes(null);
    setUserNotes("");
    setActiveTab("overview");
    void generate("fast", undefined, null, "loading");
    return () => { active.current?.abort(); architectureActive.current?.abort(); sequence.current++; architectureSequence.current++; };
  }, [generate]);

  const reportId = report?.reportId;
  useEffect(() => {
    if (!report || report.outcome !== "recommended") {
      setArchitectureState({ phase: "idle", progress: null, message: null });
      return;
    }
    if (report.architecture) {
      setArchitectureState({ phase: "ready", progress: null, message: null });
      setDiagramUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(report.architecture.svg)}`);
      return;
    }
    const controller = new AbortController();
    architectureActive.current = controller;
    const request = ++architectureSequence.current;
    const snapshot = report;
    setArchitectureState({ phase: "building", progress: null, message: null });
    void (async () => {
      try {
        const response = await fetch("/api/tiebreak", {
          method: "POST", credentials: "include", cache: "no-store",
          headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
          body: JSON.stringify({ input, operation: "architecture", previousRecommendation: snapshot }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(RECOMMENDATION_CLIENT_TIMEOUT_MS)])
        });
        const result = await readRecommendationResponse(response, progress => {
          if (!controller.signal.aborted && request === architectureSequence.current) {
            setArchitectureState({ phase: "building", progress, message: null });
          }
        });
        if (controller.signal.aborted || request !== architectureSequence.current) return;
        if (result.reportId !== snapshot.reportId || !result.architecture) {
          throw new RecommendationRequestError("The image response did not match the displayed recommendation.", "AI_OUTPUT_INVALID");
        }
        const artifact = result.architecture;
        setState(current => current.report?.reportId === snapshot.reportId
          ? { ...current, report: attachRecommendationArchitecture(current.report, artifact) } : current);
        setDiagramUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.architecture.svg)}`);
        setArchitectureState({ phase: "ready", progress: null, message: null });
      } catch (error) {
        if (controller.signal.aborted || request !== architectureSequence.current) return;
        console.error("[architecture] Background build failed:", error instanceof Error ? error.message : String(error));
        setArchitectureState({ phase: "error", progress: null, message: aiReviewErrorMessage(error) });
      } finally {
        if (architectureActive.current === controller) architectureActive.current = null;
      }
    })();
    return () => { controller.abort(); architectureSequence.current++; };
    // A review only changes metadata; it must not restart or replace a pending visual job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, diagramRevision]);

  useEffect(() => {
    if (!canRefreshAuth) return;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/.auth/refresh", {
          credentials: "include", cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
        });
        if (!response.ok) console.warn("[auth] Session refresh rejected:", response.status);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("[auth] Session refresh unavailable:", error instanceof Error ? error.message : String(error));
      }
    };
    const timer = setInterval(() => void refresh(), 20 * 60 * 1000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [canRefreshAuth]);

  useEffect(() => {
    if (!acceptedDecision || !report || busy) return;
    const fingerprint = report.reportId;
    if (lastTracked.current === fingerprint) return;
    lastTracked.current = fingerprint;
    trackArchitectureOutput({
      session: usageSession, input, decision: acceptedDecision, solutionType: report.solutionType,
      changeReason: appliedNotes ? "ai_refinement" : "ai_recommendation",
      summary: report.proposedArchitectureSummary
    });
  }, [acceptedDecision, report, busy, input, usageSession, appliedNotes]);

  const leave = (navigate: () => void) => {
    if ((userNotes.trim() || appliedNotes) && !window.confirm("Your AI recommendation and review notes are session-only. Export before leaving. Leave this recommendation?")) return;
    active.current?.abort();
    architectureActive.current?.abort();
    navigate();
  };
  const retry = () => void generate(
    lastRequest.current.mode, lastRequest.current.notes, report,
    lastRequest.current.operation === "review" ? "reviewing" : report ? "refining" : "loading",
    lastRequest.current.operation
  );
  const update = (feedback = false) => {
    if (busy || !report) return;
    const notes = recommendationNotes(appliedNotes, [
      userNotes.trim(), feedback ? "Address the optional AI review findings attached to the previous recommendation. Preserve the user's requirements." : ""
    ].filter(Boolean).join("\n\n"));
    void generate("fast", notes || undefined, report, "refining");
  };
  const review = () => {
    if (busy || !report || !canReview) return;
    void generate(report.recommendationMode, appliedNotes ?? undefined, report, "reviewing", "review");
  };
  const diagramGenerated = (url: string | null) => {
    setDiagramUrl(url);
    if (url && report) trackUsageEvent({
      eventType: "architecture_diagram_generated", sessionId: usageSession.id,
      source: usageSession.source, sourceDetail: usageSession.sourceDetail,
      solutionType: report.solutionType, basePatternId: report.recommendedBasePatternId
    });
  };

  return <RecommendationPageLayout
    input={input} decision={presentationDecision} report={report} preliminary={preliminary} busy={busy}
    operation={state.operation} canReview={canReview}
    progress={state.progress} startedAt={state.startedAt} message={state.message} issues={state.issues}
    activeTab={activeTab} onTab={setActiveTab} userNotes={userNotes} onNotes={setUserNotes} appliedNotes={appliedNotes}
    onRefine={() => update()} onReview={review} onApplyReviewFeedback={() => update(true)} onRetry={retry}
    onBack={() => leave(onBack)} onReset={() => leave(onReset)}
    diagramRevision={diagramRevision} diagramUrl={diagramUrl}
    architectureState={architectureState}
    onDiagram={() => {
      if (busy) return;
      setState(current => current.report ? { ...current, report: { ...current.report, architecture: null } } : current);
      setDiagramRevision(value => value + 1);
    }}
    onDiagramGenerated={diagramGenerated} usageSession={usageSession}
  />;
}
