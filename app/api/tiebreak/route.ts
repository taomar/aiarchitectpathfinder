import { NextResponse } from "next/server";
import { z } from "zod";
import { azureOpenAIEnabled, azureOpenAIStatus, tieBreak, reviewRecommendation, buildRecommendationArchitecture, RecommendationFormatError } from "@/lib/azure-openai";
import { PathfinderApimError } from "@/lib/pathfinder-apim";
import { decide } from "@/lib/decision-engine";
import { prepareDecisionInputForRecommendation } from "@/lib/summary-intake";
import { authMode, requireAppAccess } from "@/lib/app-auth";
import { AcceptedRecommendationSchema, DecisionInputSchema } from "@/lib/recommendation-contract";
import type { AcceptedRecommendation } from "@/lib/recommendation-contract";
import { AiProviderError, AiRoleConfigurationError } from "@/lib/ai-runtime";
import type { GenerationFailure, RecommendationProgress, RecommendationStreamEvent } from "@/lib/recommendation-progress";

const RequestSchema = z.object({
  input: DecisionInputSchema,
  operation: z.enum(["generate", "review", "architecture"]).default("generate"),
  userNotes: z.string().max(8000).optional(),
  recommendationMode: z.enum(["fast", "deep"]).optional(),
  previousRecommendation: AcceptedRecommendationSchema.optional()
}).superRefine((request, context) => {
  if (request.operation !== "generate" && !request.previousRecommendation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["previousRecommendation"], message: "A generated recommendation is required." });
  }
});

function generationFailure(error: unknown): {
  body: GenerationFailure & { correlationId?: string; retryAfterSeconds?: number };
  status: number;
  headers?: Record<string, string>;
} {
  if (error instanceof SyntaxError) return {
    body: { error: "The request body must be valid JSON.", code: "INVALID_INPUT" }, status: 400
  };
  if (error instanceof RecommendationFormatError) {
    console.error("[/api/tiebreak] Recommendation not accepted:", { code: error.code, issueCount: error.issues.length });
    return { body: { error: error.message, code: error.code, issues: error.issues }, status: 422 };
  }
  console.error("[/api/tiebreak] Generation failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof AiRoleConfigurationError) return {
    body: { error: error.message, code: error.code }, status: 503
  };
  if (error instanceof AiProviderError) return {
    body: { error: error.message, code: error.code }, status: error.status === 429 ? 429 : 502
  };
  if (error instanceof PathfinderApimError) return {
    body: {
      error: error.status === 429 ? "AI generation is temporarily at capacity. Retry shortly." : "The AI provider could not complete the recommendation.",
      code: error.code, correlationId: error.correlationId, retryAfterSeconds: error.retryAfterSeconds
    },
    status: error.status === 429 ? 429 : 502,
    headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
  };
  const timedOut = error instanceof Error && /AbortError|TimeoutError/.test(error.name);
  return {
    body: {
      error: timedOut ? "The AI request timed out. Your previous architecture, if any, is unchanged." : "The AI request could not complete. Please retry.",
      code: timedOut ? "AI_TIMEOUT" : "AI_GENERATION_FAILED"
    },
    status: timedOut ? 504 : 502
  };
}

function streamRecommendation(
  request: Request,
  generate: (signal: AbortSignal, onProgress: (event: RecommendationProgress) => void) => Promise<AcceptedRecommendation>
) {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  const encoder = new TextEncoder();
  const started = Date.now();
  let closed = false;
  let dispose = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const finish = () => {
        closed = true;
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (closed) return;
        finish();
        controller.error(signal.reason);
      };
      dispose = finish;
      const emit = (event: RecommendationStreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      heartbeat = setInterval(() => emit({ type: "heartbeat", elapsedMs: Date.now() - started }), 10_000);
      void generate(signal, progress => emit({ type: "progress", progress })).then(report => {
        if (closed) return;
        clearInterval(heartbeat);
        emit({ type: "result", report });
        finish();
        controller.close();
      }).catch(error => {
        if (closed) return;
        clearInterval(heartbeat);
        emit({ type: "error", ...generationFailure(error).body });
        finish();
        controller.close();
      });
    },
    cancel(reason) {
      dispose();
      cancellation.abort(reason ?? new DOMException("Recommendation stream cancelled.", "AbortError"));
    }
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Vary: "Accept"
    }
  });
}

export async function GET(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  try {
    return NextResponse.json({
      ...azureOpenAIStatus(),
      authRefreshEnabled: authMode() === "entra" && process.env.AUTH_TOKEN_REFRESH_ENABLED === "true"
    });
  } catch (error) {
    console.error("[/api/tiebreak] Configuration unavailable:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "AI configuration could not be loaded.", code: "AI_CONFIGURATION_INVALID" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  try {
    if (!azureOpenAIEnabled()) return NextResponse.json(
      { error: "AI recommendation generation is disabled.", code: "AI_DISABLED", status: { enabled: false } },
      { status: 503 }
    );
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({
      error: "The use-case request is invalid.", code: "INVALID_INPUT",
      issues: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`)
    }, { status: 400 });

    const deterministicDraft = parsed.data.operation === "generate"
      ? decide(prepareDecisionInputForRecommendation(parsed.data.input)) : undefined;
    const mode = parsed.data.recommendationMode ?? "fast";
    const generate = (signal: AbortSignal, onProgress?: (event: RecommendationProgress) => void) =>
      parsed.data.operation === "review"
        ? reviewRecommendation(parsed.data.input, parsed.data.previousRecommendation!, parsed.data.userNotes, { signal, onProgress })
        : parsed.data.operation === "architecture"
        ? buildRecommendationArchitecture(parsed.data.previousRecommendation!, { signal, onProgress })
        : tieBreak(parsed.data.input, deterministicDraft!, parsed.data.userNotes, {
      recommendationMode: mode,
      previousRecommendation: parsed.data.previousRecommendation,
      signal, onProgress
    });
    if (req.headers.get("accept")?.includes("application/x-ndjson")) return streamRecommendation(req, generate);
    return NextResponse.json(await generate(req.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    const failure = generationFailure(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: failure.headers });
  }
}
