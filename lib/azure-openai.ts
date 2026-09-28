import { z } from "zod";
import { createHash } from "node:crypto";
import { loadLocalEnvDefaults } from "./env-defaults";
import { aiRoleSettings, aiRuntimeStatus, requestAiJson } from "./ai-runtime";
import {
  MAXIMUM_REASONING_EFFORT, RECOMMENDATION_MAX_ATTEMPTS,
  RECOMMENDATION_TIMEOUT_MS, REVIEW_REQUEST_TIMEOUT_MS
} from "./recommendation-policy";
import { architectureFlowMermaid } from "./architecture-view";
import {
  AiRecommendationSchema, AcceptedRecommendationSchema, recommendationContent,
  RECOMMENDATION_CONTRACT_VERSION, type AcceptedRecommendation, type RecommendationReview
} from "./recommendation-contract";
import { recommendationComposerPrompt, RECOMMENDATION_JUDGE_PROMPT } from "./recommendation-prompts";
import type { ArchitectureDecision, DecisionInput } from "./types";
import { loadPathfinderEnv } from "./pathfinder-apim";
import type { RecommendationProgress } from "./recommendation-progress";
import { modelOutputSchema } from "./model-output-schema";

export { AiRecommendationSchema as TieBreakSchema } from "./recommendation-contract";

let environmentLoaded = false;
export function loadEnvExampleFallback() {
  loadPathfinderEnv();
  if (environmentLoaded || typeof window !== "undefined") return;
  loadLocalEnvDefaults(["AZURE_OPENAI_ENABLED", "AZURE_OPENAI_MAX_COMPLETION_TOKENS"]);
  environmentLoaded = true;
}

export function azureOpenAIEnabled() {
  loadEnvExampleFallback();
  return process.env.AZURE_OPENAI_ENABLED?.toLowerCase() !== "false" && !!aiRoleSettings("architecture").endpoint;
}

export function azureOpenAIStatus() {
  loadEnvExampleFallback();
  return {
    ...aiRuntimeStatus(), enabled: azureOpenAIEnabled(),
    authority: "ai", contractVersion: RECOMMENDATION_CONTRACT_VERSION
  };
}

export class RecommendationFormatError extends Error {
  readonly code = "AI_OUTPUT_INVALID";
  constructor(readonly issues: string[], message = "The AI response did not satisfy the report/diagram format.") {
    super(message);
    this.name = "RecommendationFormatError";
  }
}

export type TieBreakOptions = {
  signal?: AbortSignal;
  maxCompletionTokens?: number;
  recommendationMode?: "fast" | "deep";
  previousRecommendation?: AcceptedRecommendation;
  onProgress?: (event: RecommendationProgress) => void;
};

const cache = new Map<string, AcceptedRecommendation>();
const reviewCache = new Map<string, Exclude<RecommendationReview, { status: "not-requested" }>>();
export const RecommendationJudgmentSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string().trim().min(1).max(2000)).max(15),
  summary: z.string().trim().min(1).max(1600)
}).strict();
const ComposerOutputSchema = modelOutputSchema("architecture_recommendation", AiRecommendationSchema);
const JudgeOutputSchema = modelOutputSchema("architecture_judgment", RecommendationJudgmentSchema);

function inputOrigin(input: DecisionInput) {
  return input.directTextRecommendation
    ? "Narrative is authoritative; structured fields were inferred."
    : "Narrative and selected wizard answers are the user's requirements.";
}

function progressReporter(options: Pick<TieBreakOptions, "onProgress">) {
  const started = Date.now();
  return (
    stage: RecommendationProgress["stage"], attempt: number, message: string,
    details: Pick<RecommendationProgress, "model" | "cached" | "issues"> = {}
  ) => options.onProgress?.({ stage, attempt, message, ...details, elapsedMs: Date.now() - started });
}

function retain<T>(store: Map<string, T>, key: string, value: T) {
  store.set(key, structuredClone(value));
  if (store.size > 50) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

export function architectureIssues(report: unknown, _advisoryDraft?: ArchitectureDecision): string[] {
  const parsed = AiRecommendationSchema.safeParse(report);
  return parsed.success ? [] : parsed.error.issues.slice(0, 18)
    .map(issue => `${issue.path.join(".") || "report"}: ${issue.message}`);
}

export async function tieBreak(
  input: DecisionInput,
  deterministicDraft: ArchitectureDecision,
  userNotes?: string,
  options: TieBreakOptions = {}
): Promise<AcceptedRecommendation> {
  if (!azureOpenAIEnabled()) throw new Error("AI recommendation generation is disabled in this environment.");
  const progress = progressReporter(options);
  const composer = aiRoleSettings("architecture");
  progress("preparing", 0, "Use case and preliminary draft received. Independent AI review is optional.");
  const mode = options.recommendationMode ?? "fast";
  const context = {
    useCase: input, inputOrigin: inputOrigin(input),
    deterministicDraft: JSON.parse(JSON.stringify(deterministicDraft)),
    deterministicAuthority: "advisory-only; AI may correct or replace all architectural choices",
    refinement: userNotes?.trim() || undefined,
    previousRecommendation: options.previousRecommendation
  };
  const maxCompletionTokens = options.maxCompletionTokens ?? composer.maxCompletionTokens;
  const key = createHash("sha256").update(JSON.stringify({
    context, mode, contract: RECOMMENDATION_CONTRACT_VERSION, composer,
    effort: MAXIMUM_REASONING_EFFORT, maxCompletionTokens
  })).digest("hex");
  const saved = cache.get(key);
  if (saved) {
    progress("complete", 0, "Loaded this previously generated AI architecture. Independent review remains optional.", { cached: true });
    return { ...structuredClone(saved), cacheHit: true };
  }
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(RECOMMENDATION_TIMEOUT_MS)]);
  let issues: string[] = [];
  let previousCandidate: unknown;
  for (let attempt = 1; attempt <= RECOMMENDATION_MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted();
    progress("architect", attempt, attempt === 1
      ? "Sol is composing the architecture at maximum supported reasoning (xhigh)."
      : "Sol is correcting the report format without changing unrelated design decisions.", { model: composer.model });
    const raw = await requestAiJson("architecture", recommendationComposerPrompt(mode), {
      ...context, previousCandidate, repairIssues: issues
    }, { signal, reasoningEffort: MAXIMUM_REASONING_EFFORT, maxCompletionTokens, responseSchema: ComposerOutputSchema });
    previousCandidate = raw;
    const candidate = AiRecommendationSchema.safeParse(raw);
    if (!candidate.success) {
      issues = architectureIssues(raw);
      console.warn("[recommendation] Report format needs repair", { attempt, issueCount: issues.length });
      if (attempt < RECOMMENDATION_MAX_ATTEMPTS) progress("revising", attempt, "The output format needs correction before it can be displayed.", {
        model: composer.model, issues
      });
      continue;
    }
    const report = AcceptedRecommendationSchema.parse({
      ...candidate.data,
      authority: "ai", contractVersion: RECOMMENDATION_CONTRACT_VERSION,
      aiValidated: false,
      generation: { model: composer.model, reasoningEffort: MAXIMUM_REASONING_EFFORT },
      review: { status: "not-requested" },
      recommendedOverlays: candidate.data.overlays.map(overlay => overlay.id),
      recommendationMode: mode, cacheHit: false,
      mermaidDiagram: architectureFlowMermaid(candidate.data.highLevelFlow),
      architectureDiagramPrompt: "Render the AI-authored architectureGraph exactly. Layout and icons are presentation only; do not infer or change nodes, edges, source permissions, services, or sizing.",
      agentTrace: [
        { agent: "Recommendation Composer", status: "passed", summary: "AI evaluated the use case and advisory draft and authored the recommendation.", details: [composer.model, `reasoning: ${MAXIMUM_REASONING_EFFORT} (maximum)`] },
        { agent: "Output Contract", status: "passed", summary: "Report shape and graph references are valid. No deterministic architectural comparison was used.", details: [`contract-${RECOMMENDATION_CONTRACT_VERSION}`] },
        { agent: "Architecture Critic", status: "skipped", summary: "Independent AI review was not requested. It can be run separately.", details: [] }
      ]
    });
    retain(cache, key, report);
    progress("complete", attempt, "The AI architecture is ready. You can optionally request an independent AI review.", { model: composer.model });
    return report;
  }
  throw new RecommendationFormatError(issues);
}

export async function reviewRecommendation(
  input: DecisionInput,
  report: AcceptedRecommendation,
  userNotes?: string,
  options: Pick<TieBreakOptions, "signal" | "onProgress"> = {}
): Promise<AcceptedRecommendation> {
  loadEnvExampleFallback();
  if (process.env.AZURE_OPENAI_ENABLED?.toLowerCase() === "false") throw new Error("AI review is disabled in this environment.");
  const reviewer = aiRoleSettings("judge");
  const progress = progressReporter(options);
  const proposal = recommendationContent(report);
  const context = {
    useCase: input, inputOrigin: inputOrigin(input),
    refinement: userNotes?.trim() || undefined, proposedRecommendation: proposal
  };
  const key = createHash("sha256").update(JSON.stringify({ context, reviewer, contract: RECOMMENDATION_CONTRACT_VERSION })).digest("hex");
  let review = reviewCache.get(key);
  const cached = !!review;
  if (!review) {
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(REVIEW_REQUEST_TIMEOUT_MS)]);
    progress("handoff", 1, "Sending the current AI architecture and user requirements to the optional reviewer.");
    progress("reviewing", 1, "The independent reviewer is inspecting the proposal. Your architecture will remain available.", { model: reviewer.model });
    const parsed = RecommendationJudgmentSchema.safeParse(await requestAiJson(
      "judge", RECOMMENDATION_JUDGE_PROMPT, context, { signal, responseSchema: JudgeOutputSchema }
    ));
    if (!parsed.success) throw new RecommendationFormatError(
      parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`),
      "The AI reviewer returned an invalid review format. Your architecture has not changed."
    );
    const judgment = parsed.data;
    const passed = judgment.passed && judgment.issues.length === 0;
    review = {
      status: passed ? "passed" : "issues-found",
      summary: judgment.summary,
      issues: passed ? [] : judgment.issues.length ? judgment.issues : [judgment.summary],
      model: reviewer.model, reasoningEffort: reviewer.reasoningEffort
    };
    retain(reviewCache, key, review);
  }
  const result = AcceptedRecommendationSchema.parse({
    ...report, review, aiValidated: review.status === "passed", cacheHit: cached,
    mermaidDiagram: architectureFlowMermaid(proposal.highLevelFlow),
    agentTrace: [
      ...report.agentTrace.filter(item => item.agent !== "Architecture Critic"),
      {
        agent: "Architecture Critic", status: review.status === "passed" ? "passed" : "warning",
        summary: review.summary, details: [review.model, `reasoning: ${review.reasoningEffort}`]
      }
    ]
  });
  progress("complete", 1, review.status === "passed"
    ? "Optional AI review passed. The AI-authored architecture is unchanged."
    : "Optional AI review found issues. The findings are shown alongside your unchanged architecture.",
  { model: reviewer.model, cached });
  return result;
}
