"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Building2, Check, Layers3, Minus, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { ArchitectureDecision, DecisionInput, emptyInput, WizardQuestion } from "@/lib/types";
import { decide } from "@/lib/decision-engine";
import { classifyAdaptiveQuestions, normalizeDecisionInput } from "@/lib/adaptive-wizard";
import { QUESTIONS } from "@/lib/questions";
import { applicableWizardSteps, ApplicableWizardStep, WIZARD_VERSION } from "@/lib/wizard-steps";
import { inferDecisionInputFromSummary, prepareDecisionInputForRecommendation } from "@/lib/summary-intake";
import { QuestionCard } from "./QuestionCard";
import { ProgressRail } from "./ProgressRail";
import { DecisionPreview } from "./DecisionPreview";
import { FinalRecommendation } from "./FinalRecommendation";
import { LandingCoachmarks } from "./LandingCoachmarks";
import { Coachmarks, type CoachStep } from "./Coachmarks";
import { BrandMark } from "./BrandMark";
import { EXAMPLES } from "@/lib/examples";
import type { OptionElimination } from "./MultiSelectCard";
import {
  createUsageSession,
  trackSessionStarted,
  trackUsageEvent,
  type UsageSession
} from "@/lib/usage-client";

type Stage = "landing" | "wizard" | "final";
type FinalPayload = { input: DecisionInput; decision: ArchitectureDecision };

const STORAGE_KEY = "ai-pdn:input";

const unique = (items: string[]) => Array.from(new Set(items));

const inferredArrayFields = [
  "users",
  "channels",
  "capabilities",
  "dataSources",
  "behaviors",
  "lifecycleControls",
  "runtimePreferences",
  "modelStrategy",
  "securityControls",
  "networkControls",
  "advancedRagRequirements"
] as const;

const ignoredInferredValues = new Set(["unknown", "none"]);
const meaningful = (values: readonly string[] | undefined) => (values ?? []).filter((value) => value && !ignoredInferredValues.has(value));

// Scalar / non-array intent fields that the summary inference can set. Tracked so a
// summary edit re-derives example/auto-origin values instead of leaking them, while
// preserving fields the user set by hand through the wizard questions.
const inferredScalarFields = [
  "fabricAnalyticsIntent",
  "fabricUserAccess",
  "semanticModelUsed",
  "semanticModelSecurityKnown",
  "semanticModelConfirmations",
  "writeBackConfirmed",
  "externalAccessConfirmed",
  "externalAccessUnknown",
  "lowCodePreferred",
  "m365ExtensibilityRequired",
  "workflowExecution"
] as const;

const meaningfulScalar = (value: unknown) =>
  Array.isArray(value)
    ? value.some((item) => item && item !== "unknown" && item !== "none")
    : value !== undefined && value !== null;

const isQuestionAnswered = (question: WizardQuestion, input: DecisionInput) =>
  question.id === "summary" || (question.isAnswered ? question.isAnswered(input) : false);

const groupTip = (questions: WizardQuestion[]) => {
  if (questions.some((question) => question.type === "text")) {
    return "Optional - add a short scenario, or continue without one.";
  }
  if (questions.some((question) => question.type === "multi")) {
    return "Select all that apply in this section, then continue.";
  }
  return "Answer the visible items in this section, then continue.";
};

// The built-in opt-out value ("Not sure" / "None") for a question, or undefined if it
// has none. Used so a whole section can be skipped by auto-filling each unanswered
// question with its own opt-out — every section becomes skippable without changing the
// deterministic engine (it already understands "unknown"/"none").
function optOutValueForQuestion(question: WizardQuestion): unknown {
  if (question.type === "text") return "";
  const ids = (question.options ?? []).map((option) => option.id);
  if (question.type === "single") return ids.includes("unknown") ? "unknown" : undefined;
  if (question.type === "multi") {
    if (ids.includes("unknown")) return ["unknown"];
    if (ids.includes("none")) return ["none"];
    return undefined;
  }
  return undefined;
}

// Per-platform color themes — used to color-code the platform outcome cards and
// the scenario gallery pills, reinforcing the three-family model at a glance.
type PlatformTheme = { tile: string; text: string; border: string; hoverBorder: string; pill: string; dot: string };
const PLATFORM_THEMES: Record<"copilot" | "foundry" | "hybrid", PlatformTheme> = {
  copilot: { tile: "bg-[#EAF4FF]", text: "text-[#0F6CBD]", border: "border-[#BBD6F2]", hoverBorder: "hover:border-[#86B7E8]", pill: "bg-[#EAF4FF] text-[#0F6CBD]", dot: "bg-[#0F6CBD]" },
  foundry: { tile: "bg-[#F1ECFE]", text: "text-[#6D34D6]", border: "border-[#DDD0FB]", hoverBorder: "hover:border-[#B79BF3]", pill: "bg-[#F1ECFE] text-[#6D34D6]", dot: "bg-[#6D34D6]" },
  hybrid: { tile: "bg-[#E2F6F2]", text: "text-[#0E8F80]", border: "border-[#B6E8E0]", hoverBorder: "hover:border-[#7FD6C9]", pill: "bg-[#E2F6F2] text-[#0E8F80]", dot: "bg-[#0E8F80]" }
};
type PlatformKey = "copilot" | "foundry" | "hybrid";
const platformKeyFor = (name: string): PlatformKey => {
  const lower = name.toLowerCase();
  if (lower.startsWith("ai foundry")) return "foundry";
  if (lower.startsWith("hybrid")) return "hybrid";
  return "copilot";
};
const platformThemeFor = (name: string): PlatformTheme => PLATFORM_THEMES[platformKeyFor(name)];

// Guided tour for the wizard screen — opt-in, auto-shown only the first time so it never
// interrupts a returning user mid-task. Mirrors the landing walkthrough's spotlight engine.
const WIZARD_COACH_STEPS: CoachStep[] = [
  {
    selector: '[data-coach="wizard-live"]',
    title: "Your recommendation builds as you go",
    body: "Every answer updates this panel in real time — the platform, how strong the match is, and what it will use. You never have to guess where you stand."
  },
  {
    selector: '[data-coach="wizard-buildtext"]',
    title: "In a hurry? Describe it and skip the questions",
    body: "Type your scenario in the box above and tick this to build the recommendation straight from your description — we infer the details and apply the same safety checks. You can still open the wizard afterwards to fine-tune."
  },
  {
    selector: '[data-coach="wizard-skip"]',
    title: "Not sure on a section? Skip it",
    body: "Use “Why this matters” on any question for a plain-language explainer, or “Skip section” to let us fill safe defaults. You can always come back."
  },
  {
    selector: '[data-coach="wizard-view"]',
    title: "See your full recommendation",
    body: "When this button lights up, you’ve answered enough for a complete result — architecture diagram, guardrails, and an exportable plan."
  }
];

// Scenario-gallery filter band: lets visitors narrow the 15 stories to a single agent
// family. Counts + active fills reuse the per-platform palette so the chips visually
// map to the same three colors used by the outcome tiles and gallery pills.
type ExampleFilter = "all" | PlatformKey;
const EXAMPLE_FILTERS: { key: ExampleFilter; label: string }[] = [
  { key: "all", label: "All scenarios" },
  { key: "copilot", label: "Copilot Studio" },
  { key: "foundry", label: "AI Foundry" },
  { key: "hybrid", label: "Hybrid" }
];
const EXAMPLE_FILTER_ACTIVE: Record<ExampleFilter, string> = {
  all: "border-gray-900 bg-gray-900 text-white",
  copilot: "border-[#0F6CBD] bg-[#0F6CBD] text-white",
  foundry: "border-[#6D34D6] bg-[#6D34D6] text-white",
  hybrid: "border-[#0E8F80] bg-[#0E8F80] text-white"
};
const EXAMPLE_FILTER_DOT: Record<ExampleFilter, string> = {
  all: "bg-gray-400",
  copilot: "bg-[#0F6CBD]",
  foundry: "bg-[#6D34D6]",
  hybrid: "bg-[#0E8F80]"
};
const EXAMPLE_COUNTS: Record<PlatformKey, number> = EXAMPLES.reduce(
  (acc, example) => {
    acc[platformKeyFor(example.name)] += 1;
    return acc;
  },
  { copilot: 0, foundry: 0, hybrid: 0 } as Record<PlatformKey, number>
);

export function Wizard() {
  const [stage, setStage] = useState<Stage>("landing");
  const [input, setInput] = useState<DecisionInput>(emptyInput());
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [filterLoadingIds, setFilterLoadingIds] = useState<string[]>([]);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [eliminations, setEliminations] = useState<Record<string, OptionElimination[]>>({});
  const [expandedExampleIds, setExpandedExampleIds] = useState<string[]>([]);
  const [truncatedExampleIds, setTruncatedExampleIds] = useState<string[]>([]);
  const [exampleFilter, setExampleFilter] = useState<ExampleFilter>("all");
  const [coachReplay, setCoachReplay] = useState(0);
  const [wizardCoachReplay, setWizardCoachReplay] = useState(0);
  const [usageSession, setUsageSession] = useState<UsageSession | null>(null);
  const [nextSessionSource, setNextSessionSource] = useState("wizard");
  const [finalPayload, setFinalPayload] = useState<FinalPayload | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());
  const autoInferredRef = useRef<Partial<Record<(typeof inferredArrayFields)[number], string[]>>>({});
  const autoInferredScalarsRef = useRef<Set<string>>(new Set());
  const exampleTextRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const restoredFinalSession = useMemo(() => createUsageSession("restored_final"), []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.stage && parsed?.input) {
          const restoredInput = { ...emptyInput(), ...parsed.input };
          setStage(parsed.stage);
          setInput(restoredInput);
          if (Array.isArray(parsed.confirmed)) setConfirmed(parsed.confirmed);
          if (parsed.usageSession?.id) setUsageSession(parsed.usageSession);
          if (typeof parsed.nextSessionSource === "string") setNextSessionSource(parsed.nextSessionSource);
          // Restore the auto-inferred tracking so a summary edit after a page reload
          // re-derives example/auto values instead of leaking them. Fall back to
          // seeding from the restored profile for sessions saved before this existed.
          if (parsed.autoInferred && typeof parsed.autoInferred === "object") {
            autoInferredRef.current = parsed.autoInferred;
            autoInferredScalarsRef.current = new Set(
              Array.isArray(parsed.autoInferredScalars) ? parsed.autoInferredScalars : []
            );
          } else {
            seedAutoInferredFromInput(restoredInput);
          }
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stage,
          input,
          confirmed,
          usageSession,
          nextSessionSource,
          autoInferred: autoInferredRef.current,
          autoInferredScalars: Array.from(autoInferredScalarsRef.current)
        })
      );
    } catch {}
  }, [stage, input, confirmed, usageSession, nextSessionSource]);

  useEffect(() => {
    if (stage !== "landing") return;
    const measure = () => {
      setTruncatedExampleIds((current) => {
        const currentSet = new Set(current);
        const expandedSet = new Set(expandedExampleIds);
        const next = EXAMPLES
          .filter((example) => {
            if (expandedSet.has(example.id)) return currentSet.has(example.id);
            const node = exampleTextRefs.current[example.id];
            return !!node && node.scrollHeight > node.clientHeight + 1;
          })
          .map((example) => example.id);
        return next.length === current.length && next.every((id) => currentSet.has(id)) ? current : next;
      });
    };
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [expandedExampleIds, stage, exampleFilter]);

  const recommendationInput = useMemo(() => prepareDecisionInputForRecommendation(input), [input]);
  const directTextReady = !!input.directTextRecommendation && !!(input.summary ?? "").trim();
  const decision = useMemo(() => decide(recommendationInput), [recommendationInput]);
  const adaptiveState = useMemo(() => classifyAdaptiveQuestions(input, QUESTIONS), [input]);
  const displayedAdaptiveState = useMemo(
    () =>
      directTextReady
        ? {
            ...adaptiveState,
            canGenerateRecommendation: true,
            recommendationReadinessReason:
              "Built from your description. We filled in the details and applied the same safety checks.",
            unresolvedCriticalQuestions: [],
            nextQuestionReason: undefined
          }
        : adaptiveState,
    [adaptiveState, directTextReady]
  );
  const applicableSteps = useMemo(() => applicableWizardSteps(input), [input]);

  const currentStep = useMemo<ApplicableWizardStep | null>(() => {
    const criticalIds = new Set(displayedAdaptiveState.unresolvedCriticalQuestions);
    const firstUnconfirmed = applicableSteps.find((step) =>
      step.questions.some((question) => !confirmed.includes(question.id))
    );
    if (firstUnconfirmed) return firstUnconfirmed;
    return applicableSteps.find((step) =>
      step.questions.some((question) => criticalIds.has(question.id))
    ) ?? null;
  }, [displayedAdaptiveState.unresolvedCriticalQuestions, applicableSteps, confirmed]);

  const totalSteps = applicableSteps.length;
  const currentStepIndex = currentStep ? applicableSteps.findIndex((step) => step.id === currentStep.id) : totalSteps - 1;
  const currentStepNumber = currentStep ? currentStepIndex + 1 : totalSteps;
  const criticalIds = useMemo(() => new Set(displayedAdaptiveState.unresolvedCriticalQuestions), [displayedAdaptiveState.unresolvedCriticalQuestions]);
  const currentIsCritical = !!currentStep && currentStep.questions.some((question) => criticalIds.has(question.id));
  const currentUnanswered = currentStep
    ? currentStep.questions.filter((question) => !isQuestionAnswered(question, input))
    : [];
  // Every section is skippable as long as each still-unanswered question has a built-in
  // opt-out ("Not sure"/"None"). Skipping auto-fills those opt-outs, so conditional
  // questions (e.g. the M365 Agents SDK confirm) no longer block the whole section.
  const canSkipCurrent =
    !!currentStep &&
    currentUnanswered.length > 0 &&
    currentUnanswered.every((question) => optOutValueForQuestion(question) !== undefined);
  const currentQuestionIds = currentStep?.questions.map((question) => question.id).join("|") ?? "";

  const eliminationsFor = (question: WizardQuestion): OptionElimination[] => {
    if (question.id === "modelStrategy") return [];
    return eliminations[question.id] ?? [];
  };

  useEffect(() => {
    if (!currentStep || confirmed.length === 0) return;
    const toFetch = currentStep.questions
      .filter((question) => question.id !== "modelStrategy" && (question.options?.length ?? 0) > 0);
    if (toFetch.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();
    const ids = toFetch.map((question) => question.id);
    setFilterError(null);
    setEliminations({});
    setFilterLoadingIds(ids);
    (async () => {
      try {
        await Promise.all(
          toFetch.map(async (question) => {
            const res = await fetch("/api/wizard-filter", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ input, questionId: question.id }),
              signal: controller.signal
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "AI wizard assistance failed.");
            if (!Array.isArray(data?.eliminate)) throw new Error("AI wizard returned an invalid response.");
            if (!cancelled && Array.isArray(data?.eliminate)) {
              setEliminations((prev) => ({ ...prev, [question.id]: data.eliminate }));
            }
          })
        );
      } catch (error) {
        if (!cancelled) {
          console.error("[wizard-v7] AI assistance failed", error);
          setFilterError("AI assistance is unavailable for this step. All choices remain visible; review them or change an answer to retry.");
          setEliminations({});
        }
      } finally {
        if (!cancelled) {
          setFilterLoadingIds((prev) => prev.filter((id) => !ids.includes(id)));
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.id, currentQuestionIds, confirmed.length, input]);

  const updateInput = (next: DecisionInput) => {
    setFinalPayload(null);
    setInput((current) => {
      const normalized = normalizeDecisionInput(next);
      const summaryText = (normalized.summary ?? "").trim();
      const summaryChanged = (normalized.summary ?? "") !== (current.summary ?? "");

      // "Build from text" mode: the scenario text is the single source of truth, so the
      // structured profile is always re-derived purely from the summary. This makes the
      // wizard chips and the recommendation reflect the edited text and prevents stale
      // example/wizard selections from leaking (including via the "skip wizard" checkbox
      // handler, which rebuilds from a stale closure).
      const buildFromText = !!normalized.directTextRecommendation && !!summaryText;

      if (!summaryText) {
        if (summaryChanged) {
          autoInferredRef.current = {};
          autoInferredScalarsRef.current = new Set();
        }
        return normalized;
      }

      if (!summaryChanged && !buildFromText) {
        // Manual structured edit (a wizard question changed a field, not the summary).
        // Any scalar field the user changed by hand becomes manual so a later summary
        // edit will not silently overwrite it.
        for (const field of inferredScalarFields) {
          if (JSON.stringify((normalized as any)[field]) !== JSON.stringify((current as any)[field])) {
            autoInferredScalarsRef.current.delete(field);
          }
        }
        return normalized;
      }

      const inferred = inferDecisionInputFromSummary({ ...normalized, directTextRecommendation: true });
      const previousAuto = autoInferredRef.current;
      const nextAuto: Partial<Record<(typeof inferredArrayFields)[number], string[]>> = {};
      const merged: DecisionInput = { ...normalized };

      for (const field of inferredArrayFields) {
        const inferredValues = meaningful((inferred as any)[field]);
        if (buildFromText) {
          // Text is authoritative — replace, never union, so example/wizard residue is dropped.
          (merged as any)[field] = inferredValues;
        } else {
          // Wizard mode with an optional summary: keep manual selections, add inferred.
          const currentValues = Array.isArray((normalized as any)[field]) ? ((normalized as any)[field] as string[]) : [];
          const manuallySelected = currentValues.filter((value) => !ignoredInferredValues.has(value) && !(previousAuto[field] ?? []).includes(value));
          (merged as any)[field] = unique([...manuallySelected, ...inferredValues]);
        }
        nextAuto[field] = inferredValues;
      }

      const nextScalars = new Set<string>();
      for (const field of inferredScalarFields) {
        const inferredValue = (inferred as any)[field];
        if (buildFromText) {
          (merged as any)[field] = inferredValue;
          if (meaningfulScalar(inferredValue)) nextScalars.add(field);
        } else {
          const isAuto = autoInferredScalarsRef.current.has(field);
          if (isAuto) {
            (merged as any)[field] = inferredValue;
            if (meaningfulScalar(inferredValue)) nextScalars.add(field);
          } else {
            (merged as any)[field] = meaningfulScalar((normalized as any)[field]) ? (normalized as any)[field] : inferredValue;
          }
        }
      }

      autoInferredRef.current = nextAuto;
      autoInferredScalarsRef.current = nextScalars;
      return normalizeDecisionInput(merged);
    });
  };

  // Treat a loaded/restored profile (example or persisted session) as the auto-derived
  // baseline so that editing the summary re-derives those fields instead of leaking
  // them. Manual wizard edits made afterwards are detected and preserved.
  const seedAutoInferredFromInput = (seed: DecisionInput) => {
    const nextAuto: Partial<Record<(typeof inferredArrayFields)[number], string[]>> = {};
    for (const field of inferredArrayFields) nextAuto[field] = meaningful((seed as any)[field]);
    autoInferredRef.current = nextAuto;
    const scalars = new Set<string>();
    for (const field of inferredScalarFields) {
      if (meaningfulScalar((seed as any)[field])) scalars.add(field);
    }
    autoInferredScalarsRef.current = scalars;
  };

  const clearAutoInferred = () => {
    autoInferredRef.current = {};
    autoInferredScalarsRef.current = new Set();
  };

  const startUsageSession = (source: string, sourceDetail?: string) => {
    const session = createUsageSession(source, sourceDetail);
    setUsageSession(session);
    setNextSessionSource("wizard");
    trackSessionStarted(session);
    return session;
  };

  const viewRecommendation = () => {
    if (!usageSession) startUsageSession(nextSessionSource);
    setFinalPayload({ input: recommendationInput, decision });
    setStage("final");
  };

  const canContinue = (): boolean => {
    if (!currentStep) return false;
    // The scenario summary is optional. "Build from text" with a real summary jumps
    // straight to the recommendation; an empty summary is not a blocker — Continue
    // simply advances into the guided wizard (the flag is cleared in handleContinue).
    if (currentStep.id === "scenario" && input.directTextRecommendation) return true;
    return currentStep.questions.every((question) => {
      const blocking = question.required || criticalIds.has(question.id);
      return !blocking || isQuestionAnswered(question, input);
    });
  };

  const confirmStep = () => {
    if (!currentStep) return;
    const ids = currentStep.questions.map((question) => question.id);
    setConfirmed((current) => unique([...current, ...ids]));
  };

  const handleContinue = () => {
    if (!currentStep || !canContinue()) return;
    if (currentStep.id === "scenario") {
      if (directTextReady) {
        confirmStep();
        startUsageSession("direct_text");
        setFinalPayload({ input: recommendationInput, decision });
        setStage("final");
        return;
      }
      // "Build from text" was checked but the summary is empty — there is nothing to
      // infer. Drop the direct-text flag so the recommendation is not labelled
      // "wizard skipped", then advance into the guided wizard like a normal step.
      if (input.directTextRecommendation) {
        setInput((current) => ({ ...current, directTextRecommendation: false }));
      }
    }
    confirmStep();
  };

  const handleSkip = () => {
    if (!currentStep || !canSkipCurrent) return;
    // Auto-fill each unanswered question with its built-in opt-out so the section is
    // resolved deterministically (the engine handles "unknown"/"none"). This also
    // unblocks "View recommendation" so a skipped/own-text flow always reaches the end.
    let nextInput: DecisionInput = input;
    for (const question of currentStep.questions) {
      if (isQuestionAnswered(question, nextInput)) continue;
      const optOut = optOutValueForQuestion(question);
      if (optOut === undefined) continue;
      nextInput = question.apply ? question.apply(nextInput, optOut) : nextInput;
    }
    // Opt-outs are explicit choices: mark any changed scalar as manual so a later
    // summary edit will not silently overwrite it.
    for (const field of inferredScalarFields) {
      if (JSON.stringify((nextInput as any)[field]) !== JSON.stringify((input as any)[field])) {
        autoInferredScalarsRef.current.delete(field);
      }
    }
    setFinalPayload(null);
    setInput(normalizeDecisionInput(nextInput));
    const ids = currentStep.questions.map((question) => question.id);
    setConfirmed((current) => unique([...current, ...ids]));
  };

  const goBack = () => {
    setConfirmed((current) => {
      const confirmedSet = new Set(current);
      const activeIndex = currentStep ? applicableSteps.findIndex((step) => step.id === currentStep.id) : applicableSteps.length;
      const previousStep = [...applicableSteps]
        .slice(0, Math.max(activeIndex, 0))
        .reverse()
        .find((step) => step.questions.some((question) => confirmedSet.has(question.id))) ??
        [...applicableSteps]
          .reverse()
          .find((step) => step.questions.some((question) => confirmedSet.has(question.id)));
      if (!previousStep) return current;
      const removeIds = new Set(previousStep.questions.map((question) => question.id));
      return current.filter((id) => !removeIds.has(id));
    });
  };

  const reset = () => {
    if (usageSession) {
      trackUsageEvent({
        eventType: "start_over",
        sessionId: usageSession.id,
        source: usageSession.source,
        sourceDetail: usageSession.sourceDetail
      });
    }
    setInput(emptyInput());
    setConfirmed([]);
    setFinalPayload(null);
    setExpandedExampleIds([]);
    setExampleFilter("all");
    setUsageSession(null);
    setNextSessionSource("start_over");
    clearAutoInferred();
    setStage("landing");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const toggleExample = (id: string) => {
    setExpandedExampleIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const loadExampleInput = (next: DecisionInput) => {
    setFinalPayload(null);
    const normalized = normalizeDecisionInput({ ...emptyInput(), ...next });
    seedAutoInferredFromInput(normalized);
    setInput(normalized);
    setConfirmed([]);
  };

  const loadExampleToRecommendation = (next: DecisionInput, exampleId: string) => {
    const normalized = normalizeDecisionInput({ ...emptyInput(), ...next });
    seedAutoInferredFromInput(normalized);
    const prepared = prepareDecisionInputForRecommendation(normalized);
    setInput(normalized);
    setConfirmed([]);
    setFinalPayload({ input: prepared, decision: decide(prepared) });
    startUsageSession("example", `${exampleId}:recommendation`);
    setStage("final");
  };

  const loadExampleToWizard = (next: DecisionInput, exampleId: string) => {
    loadExampleInput(next);
    startUsageSession("example", `${exampleId}:wizard`);
    setStage("wizard");
  };

  if (stage === "landing") {
    return (
      <div className="min-h-screen bg-brand-soft">
        <LandingCoachmarks replay={coachReplay} />
        <div className="layout-shell-wide py-6">
          <section className="brand-hero rounded-2xl border border-[#0F6CBD]/30 shadow-brand">
            <div className="relative grid gap-8 p-6 lg:grid-cols-[minmax(0,1.05fr)_22rem] lg:items-center lg:p-9">
              {/* Left: value proposition + primary actions */}
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <BrandMark tone="dark" withTagline size="lg" />
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80">
                    v{WIZARD_VERSION}
                  </span>
                </div>
                <h1 className="mt-5 max-w-xl text-3xl font-bold leading-[1.1] tracking-tight text-white lg:text-[2.6rem]">
                  Find the right Microsoft Agentic Platform
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 lg:text-base">
                  Describe what you want your AI agent to do, in plain language. Pathfinder maps it to the right Microsoft platform &mdash; with the guardrails, diagram, and a plan you can share.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    data-coach="cta"
                    className="cta-pulse-btn cta-pop inline-flex min-h-[3.5rem] items-center justify-center gap-2 rounded-xl bg-white px-7 text-base font-extrabold tracking-tight text-[#0A4C8F] transition-colors hover:bg-[#EAF4FF] lg:text-lg focus:outline-none focus:ring-2 focus:ring-[#3CC1FF] focus:ring-offset-2 focus:ring-offset-[#0A4C8F]"
                    onClick={() => {
                      setInput(emptyInput());
                      setConfirmed([]);
                      clearAutoInferred();
                      setStage("wizard");
                    }}
                  >
                    <Sparkles className="h-5 w-5 text-[#0F6CBD]" /> Start your use case <ArrowRight className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      document.getElementById("scenario-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-xl border border-white/35 bg-white/10 px-6 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    Browse example scenarios
                  </button>
                </div>
                {input.users.length > 0 ? (
                  <button
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 underline-offset-4 hover:underline"
                    onClick={() => setStage("wizard")}
                  >
                    Resume your profile <ArrowRight className="h-4 w-4" />
                  </button>
                ) : null}
                <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/75">
                  <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#7FE0A3]" /> No technical expertise needed</span>
                  <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#7FE0A3]" /> Takes a few minutes</span>
                  <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#7FE0A3]" /> Exportable results</span>
                </div>
              </div>

              {/* Right: how it works, 3 simple steps */}
              <div className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">How it works</p>
                  <button
                    type="button"
                    onClick={() => setCoachReplay((n) => n + 1)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 transition hover:bg-white/20"
                  >
                    <Sparkles className="h-3 w-3" /> Show me how
                  </button>
                </div>
                <ol className="mt-4 space-y-4">
                  {[
                    ["Describe your use case", "Tell us what the agent should do and who uses it."],
                    ["We match the platform", "Copilot Studio, AI Foundry, or a hybrid \u2014 with guardrails."],
                    ["Get a shareable plan", "Architecture, diagram, and exportable artifacts."]
                  ].map(([title, body], i) => (
                    <li key={title} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[#0A4C8F]">{i + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-white">{title}</div>
                        <div className="mt-0.5 text-xs leading-snug text-white/75">{body}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>

          {/* Platform outcomes in plain language — each card filters the scenario gallery */}
          <section className="mt-6">
            <div className="grid gap-4 md:grid-cols-3">
              {([
                { key: "copilot", icon: Layers3, title: "Copilot Studio", body: "Low-code agents inside Teams and Microsoft 365 for everyday business questions.", theme: PLATFORM_THEMES.copilot },
                { key: "foundry", icon: BriefcaseBusiness, title: "AI Foundry", body: "Custom agents and apps with tools, model operations, and full control.", theme: PLATFORM_THEMES.foundry },
                { key: "hybrid", icon: ShieldCheck, title: "Hybrid", body: "Copilot agents combined with Foundry services when you need both.", theme: PLATFORM_THEMES.hybrid }
              ] as const).map(({ key, icon, title, body, theme }) => {
                const TypedIcon = icon as typeof Building2;
                const t = theme;
                const count = EXAMPLE_COUNTS[key];
                return (
                  <button
                    key={title}
                    type="button"
                    onClick={() => {
                      setExampleFilter(key);
                      document.getElementById("scenario-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    aria-label={`Show ${count} ${title} example scenarios`}
                    className={`group flex gap-3 rounded-xl border bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-cardLg focus:outline-none focus-visible:ring-2 focus-visible:ring-ms-blue focus-visible:ring-offset-1 ${t.border} ${t.hoverBorder}`}
                  >
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${t.tile} ${t.text}`}>
                      <TypedIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${t.text}`}>{title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-gray-600">{body}</div>
                      <div className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold ${t.text}`}>
                        View {count} example{count === 1 ? "" : "s"}
                        <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section id="scenario-gallery" className="mt-8 scroll-mt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-gray-900">
                  Not sure where to start? Try a real scenario
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  {EXAMPLES.length} real customer stories across Copilot Studio, AI Foundry, and hybrid agent paths. Load one to see the result instantly.
                </p>
              </div>
              <span className="text-xs text-gray-500">Tap a card to read the full story.</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter scenarios by platform">
              {EXAMPLE_FILTERS.map((f) => {
                const active = exampleFilter === f.key;
                const count = f.key === "all" ? EXAMPLES.length : EXAMPLE_COUNTS[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setExampleFilter(f.key)}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? EXAMPLE_FILTER_ACTIVE[f.key]
                        : "border-ms-border bg-white text-gray-700 hover:bg-blue-50 hover:border-[#86B7E8]"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white/80" : EXAMPLE_FILTER_DOT[f.key]}`} />
                    <span>{f.label}</span>
                    <span className={`rounded-full px-1.5 text-[10px] font-bold leading-4 ${active ? "bg-white/25 text-white" : "bg-gray-100 text-gray-600"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
              {EXAMPLES.filter((ex) => exampleFilter === "all" || platformKeyFor(ex.name) === exampleFilter).map((ex, exampleIndex) => {
                const expanded = expandedExampleIds.includes(ex.id);
                const truncated = truncatedExampleIds.includes(ex.id) || (ex.input.summary?.length ?? 0) > 180;
                const theme = platformThemeFor(ex.name);
                return (
                  <article
                    key={ex.id}
                    data-coach={exampleIndex === 0 ? "examples" : undefined}
                    className={`group flex min-h-[172px] flex-col justify-between rounded-xl border border-ms-border bg-white p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-cardLg ${theme.hoverBorder}`}
                    title={ex.input.summary}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold ${theme.pill}`}>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} />
                          <span className="truncate">{ex.name}</span>
                        </div>
                        {truncated ? (
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ms-border bg-white text-ms-blue transition hover:bg-blue-50"
                            onClick={() => toggleExample(ex.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? "Collapse story" : "Show full story"}
                            title={expanded ? "Collapse story" : "Show full story"}
                          >
                            {expanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </button>
                        ) : null}
                      </div>
                      <p
                        ref={(node) => {
                          exampleTextRefs.current[ex.id] = node;
                        }}
                        className={`mt-2 text-sm leading-relaxed text-gray-800 ${expanded ? "" : "line-clamp-4"}`}
                      >
                        {ex.input.summary}
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="btn-primary w-full whitespace-nowrap"
                        onClick={() => loadExampleToRecommendation(ex.input, ex.id)}
                        title="Load this scenario directly to the recommendation"
                      >
                        Load this Scenario
                      </button>
                      <button
                        type="button"
                        data-coach={exampleIndex === 0 ? "wizard" : undefined}
                        className="btn-outline w-full whitespace-nowrap"
                        onClick={() => loadExampleToWizard(ex.input, ex.id)}
                        title="Open this scenario in the guided wizard"
                      >
                        Build in Wizard
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (stage === "final") {
    const finalInput = finalPayload?.input ?? recommendationInput;
    const finalDecision = finalPayload?.decision ?? decision;
    return (
      <div className="min-h-screen bg-brand-soft">
        <div className="layout-shell-final py-6">
          <FinalRecommendation
            input={finalInput}
            decision={finalDecision}
            usageSession={usageSession ?? restoredFinalSession}
            onBack={() => {
              setFinalPayload(null);
              setStage("wizard");
            }}
            onReset={reset}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-soft">
      <div className="layout-shell-wide py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ms-border bg-white px-4 py-2.5 shadow-card">
        <div className="flex items-center gap-3">
          <BrandMark tone="light" size="sm" />
          <span className="hidden h-5 w-px bg-ms-border sm:block" />
          <button className="hidden text-sm font-medium text-ms-blue hover:text-ms-blueDark sm:inline" onClick={reset}>
            ← Start over
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-xs font-medium text-gray-500 sm:block">
            Step {currentStepNumber} of {totalSteps}
          </div>
          <button
            type="button"
            onClick={() => setWizardCoachReplay((n) => n + 1)}
            className="inline-flex items-center gap-1 rounded-full border border-ms-border bg-white px-2.5 py-1 text-xs font-medium text-ms-blue transition hover:bg-blue-50"
            title="Show a quick walkthrough of this screen"
          >
            <Sparkles className="h-3.5 w-3.5" /> How this works
          </button>
          <button
            className="btn-outline"
            onClick={goBack}
            disabled={confirmed.length === 0}
          >
            Back
          </button>
          <button
            data-coach="wizard-view"
            className="btn-primary"
            onClick={viewRecommendation}
            disabled={!displayedAdaptiveState.canGenerateRecommendation}
            title={displayedAdaptiveState.canGenerateRecommendation ? "View recommendation" : displayedAdaptiveState.recommendationReadinessReason}
          >
            View recommendation
          </button>
        </div>
      </div>

      <Coachmarks steps={WIZARD_COACH_STEPS} storageKey="ai-pdn:coach-wizard" replay={wizardCoachReplay} autoShow="once" />

      <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_22rem] 2xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <div>
          <ProgressRail input={input} currentStepId={currentStep?.id} />
        </div>
        <div className="space-y-3">
          {currentStep ? (
            <>
              <section className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ms-blue font-semibold">
                      {currentStep.shortTitle}
                    </div>
                    <h1 className="text-xl font-semibold mt-1">{currentStep.title}</h1>
                    <p className="mt-2 text-sm text-gray-600">{currentStep.description}</p>
                  </div>
                  {currentIsCritical ? (
                    <span className="badge badge-warn shrink-0">Needed</span>
                  ) : displayedAdaptiveState.canGenerateRecommendation ? (
                    <span className="badge badge-success shrink-0">Ready</span>
                  ) : null}
                </div>

                <div className="mt-4 space-y-4">
                  {filterError ? <p role="alert" className="text-sm text-amber-800">{filterError}</p> : null}
                  {currentStep.questions.map((question) => {
                    const questionEliminations = eliminationsFor(question);
                    return (
                      <QuestionCard
                        key={question.id}
                        question={question}
                        input={input}
                        onChange={updateInput}
                        eliminations={questionEliminations}
                        filterLoading={filterLoadingIds.includes(question.id) && question.id !== "modelStrategy" && questionEliminations.length === 0}
                        variant="section"
                      />
                    );
                  })}
                </div>
              </section>

              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {groupTip(currentStep.questions)}
                </div>
                <div className="flex gap-2" data-coach="wizard-skip">
                  {canSkipCurrent ? (
                    <button className="btn-outline" onClick={handleSkip}>
                      Skip section
                    </button>
                  ) : null}
                  <button
                    className="btn-primary"
                    onClick={handleContinue}
                    disabled={!canContinue()}
                    title={
                      canContinue()
                        ? "Continue"
                        : "Answer the required items in this section to continue"
                    }
                  >
                    Continue →
                  </button>
                </div>
              </div>
            </>
          ) : (
            <section className="card">
              <h2 className="text-xl font-semibold">All sections answered</h2>
              <p className="text-sm text-gray-600 mt-2">
                You can review your profile in the side panel and continue to the recommendation.
              </p>
              <button
                className="btn-primary mt-4"
                onClick={viewRecommendation}
                disabled={!displayedAdaptiveState.canGenerateRecommendation}
                title={
                  displayedAdaptiveState.canGenerateRecommendation
                    ? "View recommendation"
                    : displayedAdaptiveState.recommendationReadinessReason
                }
              >
                View recommendation
              </button>
            </section>
          )}
        </div>
        <div data-coach="wizard-live">
          <DecisionPreview decision={decision} adaptiveState={displayedAdaptiveState} />
        </div>
      </div>
    </div>
    </div>
  );
}
