"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Check, FileText, ShieldCheck } from "lucide-react";
import type { RecommendationProgress } from "@/lib/recommendation-progress";

export function RecommendationProgressPanel({
  progress, startedAt, previousAiResult, issues, operation
}: {
  progress: RecommendationProgress | null;
  startedAt: number;
  previousAiResult: boolean;
  issues: string[];
  operation: "generate" | "review";
}) {
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const [paused, setPaused] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [startedAt]);
  useEffect(() => {
    if (!panel.current) return;
    const observer = new IntersectionObserver(entries => setOffscreen(!entries[0].isIntersecting));
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);
  const stage = progress?.stage ?? "preparing";
  const revising = stage === "revising" || (progress?.attempt ?? 0) > 1;
  const architectActive = stage === "architect" || stage === "revising";
  const reviewing = stage === "reviewing";
  const handingOff = stage === "handoff";
  const complete = stage === "complete";
  const reviewOperation = operation === "review";
  const steps = reviewOperation ? [
    { title: "AI recommendation", detail: "Current proposal, unchanged", icon: FileText, active: false, done: true },
    { title: "AI Review", detail: complete ? "Review finished" : "Independent quality judgment", icon: ShieldCheck, active: handingOff || reviewing, done: complete },
    { title: "Findings", detail: complete ? "Ready alongside the proposal" : "No automatic rewriting", icon: Check, active: false, done: complete }
  ] : [
    { title: "Use case", detail: previousAiResult ? "Prior AI result + your update" : "Your input + preliminary draft", icon: FileText, active: stage === "preparing", done: stage !== "preparing" },
    { title: "Sol · Max reasoning", detail: architectActive ? revising ? "Correcting output format" : "Writing the recommendation" : complete ? "Recommendation ready" : "Waiting for input", icon: Bot, active: architectActive, done: complete },
    { title: "Your recommendation", detail: complete ? "Ready · diagram builds separately" : "Architecture image follows in the background", icon: Check, active: false, done: complete }
  ];
  return (
    <section ref={panel} data-ai-stage={stage} data-motion-paused={paused || hidden || offscreen}
      className="recommendation-generation-panel rounded-2xl border border-[#BBD6F2] bg-white p-5 shadow-brand sm:p-6"
      aria-label="AI recommendation progress">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ms-text">{reviewOperation ? "Running optional AI review" : revising ? "Updating your AI recommendation" : "Preparing your AI recommendation"}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
            {reviewOperation ? "Keep reading while the optional review runs. Findings will not automatically rewrite or discard the recommendation." : previousAiResult ? "Keep reading the current recommendation while Sol prepares the update." :
              "You can read and browse the preliminary rules-based preview below. It is not the final AI recommendation. The architecture image will be built separately afterward."}
          </p>
        </div>
        <span className="rounded-full bg-[#EFF6FC] px-3 py-1 text-xs font-medium text-ms-blue" aria-label={`${elapsed} seconds elapsed`}>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed
        </span>
      </div>
      <div className="mt-5 grid items-center gap-3 sm:grid-cols-[1fr_2rem_1fr_2rem_1fr]">
        {steps.map((step, index) => <div key={step.title} className="contents">
          {index > 0 && <div className={`recommendation-generation-link hidden h-8 items-center justify-center sm:flex ${index === 1 && (reviewOperation ? handingOff || reviewing : architectActive) ? "is-transferring" : ""}`} aria-hidden="true">
            <ArrowRight className="h-5 w-5 text-[#8BAECC]" />
            {index === 1 && (reviewOperation ? handingOff || reviewing : architectActive) && <span className="recommendation-transfer-dot" />}
          </div>}
          <div className={`recommendation-generation-step rounded-xl border p-4 ${step.active ? "is-active border-ms-blue bg-[#F3F8FE]" : step.done ? "border-emerald-200 bg-emerald-50/50" : "border-ms-border bg-[#FAFBFC]"}`}>
            <div className="flex items-center gap-3">
              <span className={`recommendation-generation-symbol flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${step.done ? "bg-emerald-100 text-emerald-700" : step.active ? "bg-ms-blue text-white" : "bg-slate-100 text-slate-500"}`} aria-hidden="true">
                {step.done ? <Check className="h-5 w-5" /> : <step.icon className="h-5 w-5" />}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ms-text">{step.title}</h3>
                <p className={`mt-1 text-[11px] leading-relaxed ${step.active ? "text-ms-blueDark" : step.done ? "text-emerald-800" : "text-slate-600"}`}>{step.detail}</p>
              </div>
            </div>
            <div className="recommendation-stage-activity mt-3 h-1 overflow-hidden rounded bg-[#DFEAF5]" aria-hidden="true">
              {step.active ? <span /> : step.done ? <div className="h-full bg-emerald-400" /> : null}
            </div>
          </div>
        </div>)}
      </div>
      {issues.length > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
        <h3 className="font-semibold">Corrections requested for this revision</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-4">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      </div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ms-border pt-3">
        <p role="status" aria-live="polite" aria-atomic="true" className="text-xs leading-relaxed text-ms-blueDark">
          {progress?.message ?? "Connecting to the recommendation service."}
          {progress?.model ? <span className="ml-2 text-slate-500">{progress.model}</span> : null}
        </p>
        <button type="button" className="text-[11px] text-slate-600 underline" onClick={() => setPaused(value => !value)}>
          {paused ? "Resume animation" : "Pause animation"}
        </button>
      </div>
    </section>
  );
}
