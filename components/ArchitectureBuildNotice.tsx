"use client";

import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import type { RecommendationProgress } from "@/lib/recommendation-progress";

export type ArchitectureBuildState = {
  phase: "idle" | "building" | "ready" | "error";
  progress: RecommendationProgress | null;
  message: string | null;
};

export function ArchitectureBuildNotice({ state, onOpen, onRetry }: {
  state: ArchitectureBuildState;
  onOpen: () => void;
  onRetry: () => void;
}) {
  if (state.phase === "idle") return null;
  const failed = state.phase === "error";
  const ready = state.phase === "ready";
  return <section aria-label="Architecture build notification" aria-live="polite" aria-atomic="true"
    className={`sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-card ${failed
      ? "border-amber-200 bg-amber-50 text-amber-950" : ready
      ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-[#BBD6F2] bg-[#F3F8FE] text-ms-blueDark"}`}>
    <div className="flex items-start gap-3">
      {failed ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /> : ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        : <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin motion-reduce:animate-none" />}
      <div>
        <p className="font-semibold">{failed ? "Architecture image could not be completed" : ready
          ? "Architecture and image are ready" : "Recommendation ready — building architecture in the background"}</p>
        <p className="mt-1 text-xs leading-relaxed">{failed ? `${state.message} Your recommendation is still available.`
          : ready ? "The stacked diagram and flow illustrate this recommendation." : state.progress?.message ?? "You can read and use the recommendation while its diagram is prepared."}</p>
      </div>
    </div>
    {ready && <button type="button" className="btn-outline" onClick={onOpen}>View architecture</button>}
    {failed && <button type="button" className="btn-outline" onClick={onRetry}>Retry architecture image</button>}
  </section>;
}
