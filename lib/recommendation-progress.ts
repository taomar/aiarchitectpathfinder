import { z } from "zod";
import { AcceptedRecommendationSchema, type AcceptedRecommendation } from "./recommendation-contract";
import { RECOMMENDATION_MAX_ATTEMPTS } from "./recommendation-policy";

export const RecommendationProgressSchema = z.object({
  stage: z.enum(["preparing", "architect", "handoff", "reviewing", "revising", "complete"]),
  attempt: z.number().int().min(0).max(RECOMMENDATION_MAX_ATTEMPTS),
  elapsedMs: z.number().int().nonnegative(),
  message: z.string().min(1).max(600),
  model: z.string().max(120).optional(),
  cached: z.boolean().optional(),
  issues: z.array(z.string().max(2000)).max(18).optional()
});
export type RecommendationProgress = z.infer<typeof RecommendationProgressSchema>;

const ErrorSchema = z.object({
  error: z.string().min(1),
  code: z.string().optional(),
  issues: z.array(z.string()).optional()
});
export type GenerationFailure = z.infer<typeof ErrorSchema>;
export type RecommendationStreamEvent =
  | { type: "progress"; progress: RecommendationProgress }
  | { type: "heartbeat"; elapsedMs: number }
  | { type: "result"; report: AcceptedRecommendation }
  | ({ type: "error" } & GenerationFailure);

const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), progress: RecommendationProgressSchema }),
  z.object({ type: z.literal("heartbeat"), elapsedMs: z.number().int().nonnegative() }),
  z.object({ type: z.literal("result"), report: AcceptedRecommendationSchema }),
  ErrorSchema.extend({ type: z.literal("error") })
]);

export class RecommendationRequestError extends Error {
  constructor(message: string, readonly code: string, readonly issues: string[] = []) { super(message); }
}

export async function readRecommendationResponse(
  response: Response,
  onProgress: (event: RecommendationProgress) => void
): Promise<AcceptedRecommendation> {
  const isStream = response.headers.get("content-type")?.includes("application/x-ndjson");
  if (!isStream) {
    const body: unknown = await response.json();
    if (!response.ok) {
      const failure = ErrorSchema.safeParse(body);
      throw new RecommendationRequestError(
        failure.success ? failure.data.error : "AI generation could not complete.",
        failure.success ? failure.data.code ?? "AI_UNAVAILABLE" : "AI_UNAVAILABLE",
        failure.success ? failure.data.issues ?? [] : []
      );
    }
    return AcceptedRecommendationSchema.parse(body);
  }
  if (!response.ok || !response.body) throw new RecommendationRequestError("The generation stream could not be opened.", "AI_STREAM_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let accepted: AcceptedRecommendation | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = StreamEventSchema.parse(JSON.parse(line));
    if (accepted) throw new RecommendationRequestError("The generation stream returned data after completion.", "AI_STREAM_INVALID");
    if (event.type === "progress") onProgress(event.progress);
    else if (event.type === "error") throw new RecommendationRequestError(event.error, event.code ?? "AI_UNAVAILABLE", event.issues ?? []);
    else if (event.type === "result") accepted = event.report;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) throw new RecommendationRequestError("The recommendation stream exceeded its size limit.", "AI_STREAM_INVALID");
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!accepted) throw new RecommendationRequestError("The connection ended before the AI recommendation was accepted. Please retry.", "AI_STREAM_INCOMPLETE");
    return accepted;
  } catch (error) {
    try { await reader.cancel(); } catch (cleanupError) {
      console.warn("[recommendation] Stream cleanup failed:", cleanupError instanceof Error ? cleanupError.name : "Unknown error");
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new RecommendationRequestError("The service returned an invalid recommendation stream. Please retry.", "AI_STREAM_INVALID");
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
