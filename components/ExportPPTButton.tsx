"use client";

import { useState } from "react";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "@/lib/types";
import { buildArchitectureView } from "@/lib/architecture-view";
import { buildArchitectureLayout } from "@/lib/architecture-layout";
import { AcceptedRecommendationSchema, recommendationDecision } from "@/lib/recommendation-contract";
import { buildPowerPoint, type PowerPointAssets } from "@/lib/powerpoint";
import { trackUsageEvent, type UsageSession } from "@/lib/usage-client";

export { addArchitectureBlueprintSlide, splitIntoSlideChunks } from "@/lib/powerpoint";

async function pngAsset(path: string) {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Presentation asset could not be loaded: ${path} (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:image/png;base64,${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))}`;
}

async function diagramIcon(path: string) {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Architecture icon could not be loaded: ${path} (${response.status}).`);
  const content = await response.text();
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const result = new Image();
    result.onload = () => resolve(result);
    result.onerror = () => reject(new Error(`Architecture icon could not be rendered: ${path}`));
    result.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not prepare presentation graphics.");
  const ratio = Math.min(192 / image.naturalWidth, 192 / image.naturalHeight);
  const w = image.naturalWidth * ratio;
  const h = image.naturalHeight * ratio;
  context.drawImage(image, (192 - w) / 2, (192 - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

export function ExportPPTButton({
  input, decision, tieBreak, category, refinement, usageSession, compact = false
}: {
  input: DecisionInput;
  decision: ArchitectureDecision;
  tieBreak: TieBreakResponse | null;
  category: { category: string; description: string };
  mermaidCode: string;
  mermaidFallback?: string;
  architectureImageDataUrl: string | null;
  refinement?: string;
  usageSession?: UsageSession;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportPresentation = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { default: PptxGenJS } = await import("pptxgenjs");
      const report = AcceptedRecommendationSchema.parse(tieBreak);
      const approved = recommendationDecision(report);
      const solutionType = report.solutionType;
      const architectureSummary = report.proposedArchitectureSummary;
      const model = buildArchitectureView(approved);
      const diagramNodes = buildArchitectureLayout(model).nodes.map(item => item.node);
      const paths = [...new Set(diagramNodes.flatMap(node => node.icon ? [node.icon] : []))];
      const [logo, images] = await Promise.all([
        pngAsset("/ms-icons/microsoft-logo.png"),
        Promise.all(paths.map(async path => [path, await diagramIcon(path)] as const))
      ]);
      const byPath = new Map(images);
      const assets: PowerPointAssets = {
        logo,
        icons: Object.fromEntries(diagramNodes
          .flatMap(node => node.icon && byPath.has(node.icon) ? [[node.id, byPath.get(node.icon)!]] : []))
      };
      const pptx = new PptxGenJS();
      buildPowerPoint(pptx, { input, decision: approved, tieBreak: report, architectureSummary, refinement, solutionType }, assets);
      await pptx.writeFile({ fileName: `architecture-${report.recommendedBasePatternId}-${Date.now()}.pptx` });
      if (usageSession) trackUsageEvent({
        eventType: "powerpoint_exported", sessionId: usageSession.id,
        source: usageSession.source, sourceDetail: usageSession.sourceDetail,
        solutionType, displayPattern: report.displayPatternName,
        basePatternId: report.recommendedBasePatternId, confidence: report.confidence
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PowerPoint export failed.";
      console.error("[powerpoint] Export failed:", message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col gap-2">
      <button
        className={compact ? "btn-compact bg-white text-ms-blueDark hover:bg-blue-50 disabled:opacity-50" : "btn-primary"}
        type="button" onClick={exportPresentation} disabled={busy}
      >
        {busy ? "Building PowerPoint…" : "Export as PowerPoint"}
      </button>
      {error && <span role="alert" className="max-w-md rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</span>}
    </span>
  );
}
