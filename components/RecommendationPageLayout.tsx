"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { Coachmarks, type CoachStep } from "./Coachmarks";
import { ArchitectureLayerTable } from "./ArchitectureLayerTable";
import { ArchitectureImage } from "./ArchitectureImage";
import { MermaidDiagram } from "./MermaidDiagram";
import { ExportPPTButton } from "./ExportPPTButton";
import { RecommendationProgressPanel } from "./RecommendationProgress";
import { displayPatternName } from "@/lib/pathfinder-category";
import { QUESTIONS } from "@/lib/questions";
import type { ArchitectureDecision, DecisionInput } from "@/lib/types";
import type { AcceptedRecommendation } from "@/lib/recommendation-contract";
import { recommendationReviewLabel } from "@/lib/recommendation-contract";
import type { RecommendationProgress } from "@/lib/recommendation-progress";
import type { UsageSession } from "@/lib/usage-client";

export type RecommendationTab = "overview" | "architecture" | "governance" | "technical";
const tabs: Array<{ id: RecommendationTab; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Input, recommendation, checks, and services" },
  { id: "architecture", label: "Architecture", description: "Diagram, service flow, and rationale" },
  { id: "governance", label: "Governance", description: "Assumptions, risks, controls, and safeguards" },
  { id: "technical", label: "Technical", description: "Architecture layers and detailed reasoning" }
];

function selectedLabels(input: DecisionInput, id: string) {
  const question = QUESTIONS.find(item => item.id === id);
  const raw: unknown = question?.read?.(input);
  return (Array.isArray(raw) ? raw : []).map(value =>
    question?.options?.find(option => option.id === value)?.label ?? String(value).replace(/_/g, " "));
}

function UserInputSummary({ input, refinement }: { input: DecisionInput; refinement: string | null }) {
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
        <div><div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ms-blue">User input</div>
          <h3 className="mt-0.5 text-sm font-semibold text-ms-text">Scenario being evaluated</h3></div>
        {input.directTextRecommendation && <span className="badge badge-info">Built from text</span>}
      </div>
      <p className="mt-2 rounded-md border border-ms-border bg-white px-3 py-2 text-sm leading-relaxed text-gray-800">
        {input.summary?.trim() || "The recommendation is based on the selected wizard answers."}
      </p>
      {refinement && <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Refinement applied</span>
        <p className="mt-0.5">{refinement}</p>
      </div>}
      <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
        {groups.filter(group => group.values.length).map(group => <div key={group.label}>
          <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{group.label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {group.values.slice(0, 5).map(value => <span key={value} className="rounded-full bg-[#EFF6FC] px-2.5 py-1 text-xs font-medium text-ms-blue">{value}</span>)}
            {group.values.length > 5 && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">+{group.values.length - 5} more</span>}
          </div>
        </div>)}
      </div>
    </div>
  );
}

function ArchitectureSummarySections({ value }: { value: string }) {
  const titles = ["Solution overview", "Experience and runtime", "AI, data, and integration", "Security and operations", "Overlays and follow-ups"];
  return <div className="mt-4 grid gap-2.5">
    {value.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <div key={index}
      className={`group relative overflow-hidden rounded-xl border bg-white px-4 py-3.5 shadow-card transition hover:shadow-md ${index === 0 ? "border-ms-blue/30" : "border-ms-border"}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${index === 0 ? "bg-ms-blue" : "bg-ms-blue/25"}`} aria-hidden="true" />
      <div className="flex gap-3.5 pl-1.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ring-4 ${index === 0 ? "bg-ms-blue text-white ring-ms-blue/10" : "bg-[#EAF2FB] text-ms-blueDark ring-[#EAF2FB]/40"}`}>{index + 1}</span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ms-blue">{titles[index] ?? `Detail ${index + 1}`}</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ms-text">{paragraph}</p>
        </div>
      </div>
    </div>)}
  </div>;
}

function SourceBadge({ preliminary, busy, report }: { preliminary: boolean; busy: boolean; report: AcceptedRecommendation | null }) {
  return <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ${preliminary || busy || !report || report.review.status === "not-requested" ? "bg-gray-100 text-gray-600" : report.review.status === "passed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
    {preliminary ? "Preliminary preview" : busy ? "AI request running" : report ? recommendationReviewLabel(report.review) : "AI-generated"}
  </span>;
}

type Props = {
  input: DecisionInput;
  decision: ArchitectureDecision | null;
  report: AcceptedRecommendation | null;
  preliminary: boolean;
  busy: boolean;
  operation: "generate" | "review";
  canReview: boolean;
  progress: RecommendationProgress | null;
  startedAt: number;
  message: string | null;
  issues: string[];
  activeTab: RecommendationTab;
  onTab: (tab: RecommendationTab) => void;
  userNotes: string;
  onNotes: (value: string) => void;
  appliedNotes: string | null;
  onRefine: () => void;
  onReview: () => void;
  onApplyReviewFeedback: () => void;
  onRetry: () => void;
  onBack: () => void;
  onReset: () => void;
  architectureRequested: boolean;
  diagramRevision: number;
  diagramUrl: string | null;
  onDiagram: () => void;
  onDiagramGenerated: (url: string | null) => void;
  usageSession: UsageSession;
};

export function RecommendationPageLayout(props: Props) {
  const { input, decision, report, preliminary, busy, message, issues, activeTab, userNotes, appliedNotes } = props;
  const [coachReplay, setCoachReplay] = useState(0);
  const [dismissedNotes, setDismissedNotes] = useState<string | null>(null);
  const solutionType = report?.solutionType ?? (decision ? displayPatternName(decision) : "AI recommendation");
  const displayPattern = report?.displayPatternName ?? solutionType;
  const summary = report?.proposedArchitectureSummary ?? decision?.finalRecommendation ?? "";
  const useCaseSummary = report?.useCaseSummary ?? input.summary ?? "";
  const generating = busy && props.operation === "generate";
  const dimClass = generating ? "recommendation-preview-dim" : "";
  const coachSteps = useMemo<CoachStep[]>(() => [
    { selector: '[data-coach="rec-result"]', title: "Your recommended platform", body: "This is the AI-generated architecture for your use case. Independent review is optional.", onBeforeShow: () => props.onTab("overview") },
    { selector: '[data-coach="rec-tabs"]', title: "Explore the full plan", body: "The tabs show different views of the same AI-generated recommendation." },
    { selector: '[data-coach="rec-refine"]', title: "Refine the recommendation", body: "Ask the AI to correct or improve the design.", onBeforeShow: () => props.onTab("overview") },
    { selector: '[data-coach="rec-architecture"]', title: "Generate the architecture diagram", body: "Render the AI-authored graph without re-evaluating the architecture.", onBeforeShow: () => props.onTab("architecture") },
    { selector: '[data-coach="rec-export"]', title: "Export to share", body: "Download the concise PowerPoint, including Dev/Test/Prod sizing.", onBeforeShow: () => props.onTab("overview") }
  ], [props.onTab]);
  const badge = <SourceBadge preliminary={preliminary} busy={busy} report={report} />;
  return <div className="space-y-5 pb-10" data-recommendation-layout="classic">
    <details className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 shadow-sm">
      <summary className="cursor-pointer font-semibold">Disclaimer and validation note</summary>
      <p className="mt-1 leading-relaxed">This is a <em>suggested architecture</em> that requires review and validation before implementation. Validate architecture standards, data residency, security, pricing, sizing and service availability.</p>
    </details>
    {appliedNotes && appliedNotes !== dismissedNotes && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] uppercase tracking-wider font-semibold">Refined</span>
        <button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => setDismissedNotes(appliedNotes)}>Dismiss</button>
      </div>
      <div className="mt-2 text-xs"><div className="font-semibold text-emerald-800 uppercase tracking-wider text-[10px]">Your input applied</div>
        <blockquote className="mt-1 border-l-2 border-emerald-400 pl-3 italic text-emerald-900">{appliedNotes}</blockquote></div>
    </div>}
    {report && <Coachmarks steps={coachSteps} storageKey="ai-pdn:coach-recommendation" replay={coachReplay} autoShow="never" />}
    <section className="brand-hero rounded-2xl border border-[#0F6CBD]/30 p-5 shadow-brand">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-3">
        <BrandMark tone="dark" withTagline size="sm" />
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 md:justify-end">
          <button type="button" disabled={busy || !report} onClick={() => setCoachReplay(value => value + 1)}
            className="btn-compact inline-flex items-center gap-1.5 border border-[#3CC1FF]/60 bg-[#3CC1FF]/15 font-semibold text-white hover:bg-[#3CC1FF]/30 disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> How this works
          </button>
          <span data-coach="rec-export" className="inline-flex">
            {report && decision && !generating ? <ExportPPTButton input={input} decision={decision} tieBreak={report}
              category={{ category: report.solutionType, description: report.finalRecommendation }}
              mermaidCode={report.mermaidDiagram} architectureImageDataUrl={props.diagramUrl}
              refinement={appliedNotes ?? undefined} usageSession={props.usageSession} compact /> :
              <button className="btn-compact border border-white/30 bg-white/10 text-white opacity-60" disabled>Export as PowerPoint</button>}
          </span>
          <button className="btn-compact border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={props.onBack}>Back to wizard</button>
          <button className="btn-compact border border-white/30 bg-transparent text-white hover:bg-white/10" onClick={props.onReset}>Start over</button>
        </div>
      </div>
      <div className={`mt-4 ${dimClass}`} data-coach="rec-result" data-preliminary-header={preliminary || undefined}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
              <span>{preliminary ? "Preliminary preview · not AI-approved" : "Your recommendation"}</span>
              <span role="status" className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
                {busy ? props.operation === "review" ? "Optional AI review in progress" : report ? "AI update in progress" : "AI generation in progress" : message ? report ? "Previous AI result retained" : "AI recommendation unavailable" : report?.outcome === "needs-clarification" ? "AI requests clarification" : "AI-generated"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-white lg:text-3xl">{solutionType}</h1>
            {decision && <p className="mt-1 text-sm font-semibold text-white/85">Recommended path: {displayPattern}</p>}
          </div>
        </div>
        <p className="mt-3 max-w-6xl text-sm leading-relaxed text-white/90">{useCaseSummary}</p>
        {decision && <div className="mt-4 flex flex-wrap gap-2 border-t border-white/20 pt-3">
          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-ms-blueDark">{solutionType}</span>
          {report && <span className="rounded-full bg-emerald-200/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-50">AI confidence: {report.confidence}</span>}
          {decision.overlays.map(overlay => <span key={overlay.id} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white" title={overlay.reason}>+ {overlay.name}</span>)}
        </div>}
        {report && <p className="mt-2 text-xs leading-relaxed text-white/80">{report.confidenceReason}<br />
          {report.generation.model} · {report.generation.reasoningEffort === "xhigh" ? "Maximum reasoning (xhigh)" : `${report.generation.reasoningEffort} reasoning`} · {recommendationReviewLabel(report.review)}
        </p>}
      </div>
    </section>

    {busy && <RecommendationProgressPanel progress={props.progress} startedAt={props.startedAt} previousAiResult={!!report} issues={issues} operation={props.operation} />}
    {message && <section role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <p className="font-semibold">{message}</p>
      <p className="mt-1 text-xs">{report ? "Your AI-generated architecture remains available; this request did not change it." : "No AI result was generated. The preliminary preview has not been promoted to a recommendation."}</p>
      {issues.length > 0 && <div className="mt-3"><h3 className="font-semibold">Why this attempt was not accepted</h3><ul className="mt-2 list-disc space-y-2 pl-5">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      <button type="button" className="btn-primary mt-3" disabled={busy} onClick={props.onRetry}>{props.operation === "review" ? "Retry AI review" : "Retry AI recommendation"}</button>
      <a className="ml-3 text-xs underline" href="/login">Sign in again</a>
    </section>}
    {report && report.review.status !== "not-requested" && <section aria-label="Optional AI review findings"
      className={`rounded-lg border px-4 py-3 text-sm ${report.review.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
      <h2 className="font-semibold">{recommendationReviewLabel(report.review)}</h2>
      <p className="mt-1 text-xs leading-relaxed">{report.review.summary}</p>
      {report.review.status === "issues-found" && <>
        <p className="mt-2 text-xs">These are the optional reviewer's findings. The AI-generated architecture is still available and has not been rewritten or discarded.</p>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-xs">{report.review.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        <button type="button" className="btn-primary mt-3" disabled={busy} onClick={props.onApplyReviewFeedback}>Apply review feedback</button>
      </>}
    </section>}
    {!decision && <div className="card rounded-xl"><UserInputSummary input={input} refinement={appliedNotes} /></div>}

    {decision && <div data-preliminary-preview={preliminary || undefined} aria-disabled={preliminary || undefined} aria-busy={busy}
      ref={element => { if (element) element.inert = generating; }}
      className={`${dimClass} ${!busy ? "recommendation-result-reveal" : ""} space-y-5`}>
      <nav className="rounded-2xl border border-ms-border bg-white p-1.5 shadow-card" aria-label="Recommendation sections" data-coach="rec-tabs">
        <div className="grid gap-1 md:grid-cols-4">
          {tabs.map(tab => <button key={tab.id} type="button" disabled={generating} aria-current={activeTab === tab.id ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-left transition ${activeTab === tab.id ? "bg-[#EFF6FC] text-ms-blue ring-1 ring-[#BBD6F2]" : "text-gray-600 hover:bg-gray-50 hover:text-ms-text"}`} onClick={() => props.onTab(tab.id)}>
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{tab.description}</span>
          </button>)}
        </div>
      </nav>

      {activeTab === "overview" && <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)] xl:items-start">
        <div className="space-y-4">
          <div className="card rounded-xl">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Recommendation summary</h2><span className="badge badge-info">Solution Type: {solutionType}</span></div>
            <div className="mt-3"><UserInputSummary input={input} refinement={appliedNotes} /></div>
            <div className="mt-3 rounded-lg border border-ms-blue/20 border-l-4 border-l-ms-blue bg-[#F7FAFE] px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Recommended path</div>
              <p className="mt-1 text-base font-semibold text-ms-text">{solutionType}</p>
              <p className="mt-0.5 text-xs text-gray-600">{[displayPattern, ...decision.overlays.map(item => item.name)].join(" + ")}</p>
            </div>
            <div className="mt-4 rounded-lg border border-ms-border bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Use case summary</div>
              <p className="mt-1 text-sm leading-relaxed text-ms-text">{useCaseSummary}</p>
            </div>
            <div className="mt-4"><div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Recommended solution architecture</div><ArchitectureSummarySections value={summary} /></div>
            {report?.questionsToAskNext.length ? <div className="mt-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Questions to confirm</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">{report.questionsToAskNext.map((question, index) => <li key={index}>{question}</li>)}</ul>
            </div> : null}
            <div className="mt-5 rounded-lg border border-ms-border bg-[#FAFBFC] p-4" data-coach="rec-refine">
              <label htmlFor="recommendation-refinement" className="block text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Refine the recommendation</label>
              <p className="mt-1 text-xs text-gray-600">Add context, correct a requirement, or request an alternative. Sol generates the update at maximum reasoning. Independent AI review is optional and never automatically discards the result.</p>
              <textarea id="recommendation-refinement" className="mt-3 w-full rounded-md border border-gray-300 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ms-blue/40"
                rows={4} maxLength={8000} placeholder="Clarify requirements or ask the AI to improve the architecture." value={userNotes}
                onChange={event => props.onNotes(event.target.value)} disabled={busy || !report} />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" className="rounded bg-ms-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" onClick={props.onRefine} disabled={busy || !report || !userNotes.trim()}>Apply refinement</button>
                <button type="button" className="rounded border border-ms-blue bg-white px-3 py-1.5 text-xs font-semibold text-ms-blue disabled:opacity-50" onClick={props.onReview} disabled={busy || !report || !props.canReview}>AI Review (optional)</button>
                {userNotes && <button type="button" className="text-xs text-gray-600 underline" disabled={busy} onClick={() => props.onNotes("")}>Clear</button>}
              </div>
            </div>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="card rounded-xl">
            <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Recommended services</h2>{badge}</div>
            <div className="mt-3"><div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Core services</div>
              <ul className="mt-2 space-y-1.5 text-xs">{decision.recommendedStack.map(service => <li key={service} className="flex items-start gap-2 rounded-md bg-[#F7FAFE] px-2.5 py-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ms-blue" /><span>{service}</span></li>)}</ul></div>
            <div className="mt-4"><div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">Optional additions</div>
              {!decision.optionalAddOns.length ? <p className="mt-1 text-xs text-gray-400">None</p> : <ul className="mt-2 space-y-1.5 text-xs">{decision.optionalAddOns.map((item, index) => <li key={index} className="flex items-start gap-2 rounded-md bg-gray-50 px-2.5 py-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" /><span className="text-gray-700">{item}</span></li>)}</ul>}</div>
          </div>
          <section className="rounded-lg border border-ms-border bg-white p-3 shadow-card">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Recommendation checks</h2><p className="mt-0.5 text-[11px] text-gray-600">Sol authors the recommendation. Structural checks are automatic; independent AI review runs only when you request it.</p></div>{badge}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(report?.agentTrace ?? [
                { agent: "AI Architect", summary: "Preparing the architecture.", details: [], status: "pending" },
                { agent: "AI Review", summary: "Optional; not requested.", details: [], status: "skipped" }
              ]).map((item, index) => <div key={item.agent} className="rounded-md border border-ms-border bg-[#FAFBFC] px-2.5 py-2">
                <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-ms-border bg-white text-[11px] font-semibold text-ms-blue">{index + 1}</span><div className="text-xs font-semibold text-gray-900">{item.agent}</div></div>
                <span className={`mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${item.status === "passed" ? "border-emerald-200 bg-emerald-100 text-emerald-800" : "border-gray-200 bg-gray-100 text-gray-700"}`}>{item.status === "skipped" ? "Not requested" : item.status}</span>
              </div>)}
            </div>
            {report && <details className="mt-3 text-xs text-gray-600"><summary className="cursor-pointer font-medium text-ms-blue">Show check details</summary><ul className="mt-2 space-y-2">{report.agentTrace.map(item => <li key={item.agent}><strong>{item.agent}:</strong> {item.summary}<p className="mt-1">{item.details.join(" · ")}</p></li>)}</ul></details>}
          </section>
        </aside>
      </section>}

      {activeTab === "architecture" && <>
        <section className="card rounded-xl"><div className="flex flex-wrap items-center justify-between gap-3" data-coach="rec-architecture">
          <div><h2 className="text-base font-semibold">Layered reference architecture</h2><p className="mt-0.5 text-xs text-gray-500">Stacked logical layers, matching service icons and cross-layer integrations. Identity and governance sit alongside the workload. Rendering does not re-evaluate the architecture.</p></div>
          <button type="button" className="btn-primary" onClick={props.onDiagram} disabled={generating || !report?.architectureGraph.nodes.length}>{props.architectureRequested ? "Regenerate architecture" : "Generate architecture"}</button>
        </div>
          <div className="mt-3">{props.architectureRequested && report
            ? <ArchitectureImage decision={decision} input={input} refreshNonce={props.diagramRevision} onGenerated={props.onDiagramGenerated} />
            : <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ms-blue/30 bg-[#F7FAFE] p-6 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-ms-blue shadow-sm">+</span><p className="text-sm font-medium text-gray-800">Architecture diagram is ready to generate.</p><p className="mt-1 text-xs text-gray-500">Click Generate architecture to render the AI-authored components and connections.</p></div>}</div>
        </section>
        <section className="card rounded-xl"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">High-level solution flow</h2><p className="mt-0.5 text-sm text-gray-500">The short main journey authored by the AI. Detailed implementation steps remain below.</p></div><span className="badge badge-muted">AI-authored</span></div>
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">{report?.highLevelFlow.length ? <MermaidDiagram code={report.mermaidDiagram} /> : <p className="text-xs text-gray-600">The AI requested clarification before defining the flow.</p>}</div>
        </section>
        <section className="grid gap-3 xl:grid-cols-2">
          <div className="card rounded-xl"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">How it works</h2>{badge}</div><ol className="mt-3 space-y-1.5 text-xs">{decision.endToEndFlow.map((step, index) => <li key={index} className="flex gap-2.5 rounded-lg border border-ms-border bg-[#FAFBFC] px-2.5 py-1.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ms-blue text-xs font-semibold text-white">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div>
          <div className="card rounded-xl"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Why this recommendation</h2>{badge}</div><ul className="mt-3 space-y-1.5 text-xs">{decision.rationale.map((reason, index) => <li key={index} className="flex gap-2 rounded-lg border border-ms-border bg-[#FAFBFC] px-2.5 py-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ms-blue" /><span>{reason}</span></li>)}</ul></div>
        </section>
      </>}

      {activeTab === "governance" && <>
        <section className="card rounded-xl border-l-4 border-l-ms-blue bg-[#F7FAFE]">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[11px] uppercase tracking-[0.16em] text-ms-blue font-semibold">Selection rationale</div><h2 className="mt-1 text-base font-semibold">Why this solution was chosen</h2></div><span className="badge badge-info">{solutionType}</span></div>
          <p className="mt-2 text-sm leading-relaxed text-ms-text">{decision.finalRecommendation}</p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">{decision.rationale.map((reason, index) => <li key={index} className="flex gap-2 rounded-md border border-[#D6E3F3] bg-white px-3 py-2 text-xs leading-relaxed text-ms-text"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ms-blue" /><span>{reason}</span></li>)}</ul>
        </section>
        <section className="grid gap-3 xl:grid-cols-3">
          <div className="card rounded-xl border-t-4 border-t-gray-300"><h2 className="text-base font-semibold">Assumptions to confirm</h2>
            <ul className="mt-3 space-y-1.5 text-xs">{decision.assumptions.map((value, index) => <li key={index} className="rounded-md bg-gray-50 px-2.5 py-1.5">{value}</li>)}
              {decision.missingQuestions.map(question => <li key={question.id} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900">Missing: {question.title}</li>)}</ul>
            {!decision.assumptions.length && !decision.missingQuestions.length && <p className="mt-2 text-xs text-gray-400">None recorded.</p>}
          </div>
          <div className="card rounded-xl border-t-4 border-t-amber-400"><h2 className="text-base font-semibold">Risks to review</h2>
            {decision.riskFlags.length ? <ul className="mt-3 space-y-1.5 text-xs">{decision.riskFlags.map((value, index) => <li key={index} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900">{value}</li>)}</ul> : <p className="mt-2 text-xs text-gray-400">No risks flagged.</p>}
          </div>
          <div className="card rounded-xl border-t-4 border-t-emerald-500"><h2 className="text-base font-semibold">Security and access</h2>
            {decision.securityControls.length ? <ul className="mt-3 space-y-1.5 text-xs">{decision.securityControls.map((value, index) => <li key={index} className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-emerald-950">{value}</li>)}</ul> : <p className="mt-2 text-xs text-gray-400">None selected.</p>}
          </div>
        </section>
        <section className={`card rounded-xl border-l-4 ${decision.zeroTrust.applicable ? "border-l-emerald-600 bg-emerald-50/40" : "border-l-gray-300"}`}>
          <div className="flex items-start justify-between gap-3"><div><div className="text-[11px] uppercase tracking-[0.16em] text-emerald-700 font-semibold">Recommended safeguards</div><h2 className="mt-1 text-base font-semibold">Guardrails for this workload</h2></div><span className="rounded-full bg-emerald-600 px-2 py-1 text-[10px] uppercase tracking-wider text-white">Recommended</span></div>
          <p className="mt-2 text-xs leading-relaxed text-ms-text">{decision.zeroTrust.rationale}</p>
          <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2 2xl:grid-cols-3">{decision.zeroTrust.controls.map((value, index) => <li key={index} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" /><span>{value}</span></li>)}</ul>
          <p className="mt-3 text-[11px] italic text-gray-500">Required controls are listed separately. Validate each safeguard against the actual workload.</p>
        </section>
      </>}

      {activeTab === "technical" && <>
        <section className="card rounded-xl"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Architecture details</h2>{badge}</div><p className="mt-0.5 text-xs text-gray-500">AI-authored layers and component responsibilities.</p><div className="mt-3"><ArchitectureLayerTable layers={decision.architectureLayers} /></div></section>
        {report && <section className="card rounded-xl"><details>
          <summary className="cursor-pointer text-base font-semibold">Detailed controls and boundary conditions</summary>
          <p className="mt-2 text-xs text-gray-500">These AI-authored details are kept out of the high-level diagrams.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">{Object.entries(report.architectureGraph.controls).filter(([, controls]) => controls.length).map(([group, controls]) =>
            <div key={group}><h3 className="text-sm font-semibold capitalize">{group}</h3><ul className="mt-2 space-y-2 text-xs">{controls.map((control, index) =>
              <li key={index}><strong>{control.label}</strong>{control.required ? " (required)" : " (recommended)"}<p className="mt-1 text-gray-600">{control.scope}</p></li>)}</ul></div>
          )}</div>
          {report.architectureGraph.decisions.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Open decisions</h3><ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{report.architectureGraph.decisions.map((value, index) => <li key={index}>{value}</li>)}</ul></div>}
        </details></section>}
        {report && <section className="card rounded-xl">
          <h2 className="text-base font-semibold">Services and Dev / Test / Prod sizing</h2>
          <p className="mt-1 text-xs text-gray-500">AI-proposed starting configurations—not measured production capacity.</p>
          <div className="mt-3 overflow-auto"><table className="w-full min-w-[760px] border-collapse text-left text-xs"><thead className="bg-gray-50 text-gray-600"><tr>{["Service", "Purpose", "Dev", "Test", "Prod"].map(label => <th key={label} className="border-b border-gray-200 p-3">{label}</th>)}</tr></thead><tbody>
            {report.serviceSizing.map(service => <tr key={service.id}><td className="border-b border-gray-100 p-3"><strong>{service.name}</strong><div className="mt-1 text-gray-500">{service.provider}</div></td><td className="border-b border-gray-100 p-3">{service.purpose}</td><td className="border-b border-gray-100 p-3">{service.dev}</td><td className="border-b border-gray-100 p-3">{service.test}</td><td className="border-b border-gray-100 p-3">{service.prod}</td></tr>)}
          </tbody></table></div>
          <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-gray-600">{report.sizingAssumptions.map((value, index) => <li key={index}>{value}</li>)}</ul>
        </section>}
        {report && <section className="card rounded-xl"><details><summary className="cursor-pointer text-base font-semibold">Technical details</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2"><div><h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">AI reasoning</h3><ul className="list-inside list-disc space-y-0.5 text-xs">{report.reasoning.map((value, index) => <li key={index}>{value}</li>)}</ul></div>
            <div><h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Excluded or conditional</h3><ul className="list-inside list-disc space-y-0.5 text-xs">{report.mustNotInclude.map((value, index) => <li key={index}>{value}</li>)}</ul></div></div>
          {report.changesFromDraft.length > 0 && <div className="mt-4"><h3 className="text-xs font-semibold text-ms-blue">AI corrections to the preliminary draft</h3><ul className="mt-2 list-inside list-disc space-y-1 text-xs">{report.changesFromDraft.map((change, index) => <li key={index}>{change.change} — {change.reason}</li>)}</ul></div>}
        </details></section>}
      </>}
    </div>}
  </div>;
}
