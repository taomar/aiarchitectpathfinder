import { NextResponse } from "next/server";
import { azureOpenAIEnabled, azureOpenAIStatus, tieBreak } from "@/lib/azure-openai";
import { PathfinderApimError } from "@/lib/pathfinder-apim";
import { decide } from "@/lib/decision-engine";
import { prepareDecisionInputForRecommendation } from "@/lib/summary-intake";
import { authMode, requireAppAccess } from "@/lib/app-auth";

export async function GET(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  return NextResponse.json({
    ...azureOpenAIStatus(),
    authRefreshEnabled: authMode() === "entra" && process.env.AUTH_TOKEN_REFRESH_ENABLED === "true"
  });
}

export async function POST(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  if (!azureOpenAIEnabled()) {
    return NextResponse.json(
      { error: "Pathfinder APIM is not enabled.", status: azureOpenAIStatus() },
      { status: 400 }
    );
  }
  try {
    const body = await req.json();
    if (!body?.input) {
      return NextResponse.json({ error: "Missing input." }, { status: 400 });
    }
    // The server owns routing and guardrails. Legacy clients may still send a
    // decision field, but it is never authoritative over the prepared profile.
    const preparedInput = prepareDecisionInputForRecommendation(body.input);
    const decision = decide(preparedInput);
    const userNotes = typeof body?.userNotes === "string" ? body.userNotes : undefined;
    const recommendationMode = body?.recommendationMode === "deep" ? "deep" : "fast";
    const result = await tieBreak(preparedInput, decision, userNotes, {
      recommendationMode,
      reasoningEffort: "medium",
      maxCompletionTokens: recommendationMode === "deep" ? 32768 : 24000,
      // Forward the request's abort signal so that when the client disconnects
      // (e.g. the user hits "Start over" mid-generation), the upstream model call
      // is cancelled instead of running to completion and consuming capacity.
      signal: req.signal
    });
    return NextResponse.json(result);
  } catch (err: any) {
    // A client-cancelled request (navigation / "Start over") is expected — don't
    // treat it as a server error or emit noisy logs.
    if (req.signal?.aborted || err?.name === "AbortError") {
      return new NextResponse(null, { status: 499 });
    }
    const cause = err?.cause?.message ?? err?.cause?.code ?? "";
    const msg = err?.message ?? "Tie-break failed.";
    console.error("[/api/tiebreak] error:", msg, cause, err?.stack);
    if (err instanceof PathfinderApimError) {
      const headers: HeadersInit = {};
      if (err.retryAfterSeconds) headers["Retry-After"] = String(err.retryAfterSeconds);
      const isRateLimited = err.status === 429;
      return NextResponse.json(
        {
          error: isRateLimited
            ? "AI review is temporarily at capacity. Pathfinder is showing the deterministic recommendation."
            : "AI review returned an unexpected upstream response. Pathfinder is showing the deterministic recommendation.",
          status: err.status,
          code: err.code,
          correlationId: err.correlationId,
          retryAfterSeconds: err.retryAfterSeconds
        },
        { status: isRateLimited ? 429 : 502, headers }
      );
    }
    return NextResponse.json(
      { error: cause ? `${msg} (cause: ${cause})` : msg },
      { status: 500 }
    );
  }
}
