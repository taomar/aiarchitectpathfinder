import type { ArchitectureDecision, DecisionInput } from "./types";
import { categoryForDecision, displayPatternName } from "./pathfinder-category";
import { lowConfidenceReason } from "./rules";

const CLIENT_ID_KEY = "ai-pdn:usage-client-id";

export type UsageSession = {
  id: string;
  source: string;
  sourceDetail?: string;
  startedAt: string;
};

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createUsageSession(source: string, sourceDetail?: string): UsageSession {
  return {
    id: randomId(),
    source,
    sourceDetail,
    startedAt: new Date().toISOString()
  };
}

function clientId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const next = randomId();
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return "anonymous";
  }
}

function architectureFingerprint(decision: ArchitectureDecision, solutionType: string, summary?: string) {
  return JSON.stringify({
    basePatternId: decision.basePatternId,
    overlays: decision.overlays.map((overlay) => overlay.id).sort(),
    recommendedStack: decision.recommendedStack,
    solutionType,
    confidence: decision.confidence,
    summary: summary?.slice(0, 500)
  });
}

export function trackUsageEvent(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ clientId: clientId(), ...payload });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/usage", blob);
      return;
    }
  } catch {
    /* fall through */
  }
  fetch("/api/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => {});
}

export function trackSessionStarted(session: UsageSession) {
  trackUsageEvent({
    eventType: "session_started",
    sessionId: session.id,
    source: session.source,
    sourceDetail: session.sourceDetail
  });
}

export function trackArchitectureOutput({
  session,
  input,
  decision,
  solutionType,
  changeReason,
  summary
}: {
  session: UsageSession;
  input: DecisionInput;
  decision: ArchitectureDecision;
  solutionType?: string;
  changeReason: string;
  summary?: string;
}) {
  const resolvedSolutionType = solutionType || categoryForDecision(decision).category;
  const lowReason =
    decision.confidence === "low"
      ? lowConfidenceReason(input, decision.candidateBasePatternIds ?? [])?.code
      : undefined;
  trackUsageEvent({
    eventType: "architecture_output",
    sessionId: session.id,
    source: session.source,
    sourceDetail: session.sourceDetail,
    changeReason,
    architectureFingerprint: architectureFingerprint(decision, resolvedSolutionType, summary),
    solutionType: resolvedSolutionType,
    displayPattern: displayPatternName(decision),
    basePatternId: decision.basePatternId,
    confidence: decision.confidence,
    lowConfidenceReason: lowReason,
    overlayCount: decision.overlays.length,
    directTextRecommendation: input.directTextRecommendation === true,
    users: input.users,
    channels: input.channels,
    dataSources: input.dataSources,
    modelStrategies: input.modelStrategy ?? []
  });
}
