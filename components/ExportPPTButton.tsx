"use client";

import { useState } from "react";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "@/lib/types";
import {
  buildArchitectureSummary,
  shouldUseGeneratedArchitectureSummary
} from "@/lib/architecture-summary";
import { displayPatternName } from "@/lib/pathfinder-category";
import { reportDetailSections, reportUseCaseSummary } from "@/lib/export";
import { trackUsageEvent, type UsageSession } from "@/lib/usage-client";

const MS_BLUE = "0078D4";
const MS_BLUE_DARK = "005A9E";
const MS_TEXT = "201F1E";
const MS_SUBTLE = "605E5C";
const MS_PANEL = "F7FAFE";
const MS_BORDER = "D6E3F3";

type DecisionLayerName = ArchitectureDecision["architectureLayers"][number]["layer"];

/** Measure a data-URL image's natural pixel dimensions. */
async function measureImage(dataUrl: string): Promise<{ w: number; h: number } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = dataUrl;
    });
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    if (w <= 0 || h <= 0) return null;
    return { w, h };
  } catch {
    return null;
  }
}

/**
 * Compute aspect-preserving placement inside a box, centered.
 * Returns inches (PowerPoint units) for x/y/w/h.
 */
function fitInBox(
  natural: { w: number; h: number } | null,
  box: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (!natural) return box;
  const ar = natural.w / natural.h;
  let w = box.w;
  let h = w / ar;
  if (h > box.h) {
    h = box.h;
    w = h * ar;
  }
  const x = box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  return { x, y, w, h };
}

/** Render a Mermaid diagram string to a PNG data URL using a hidden canvas. */
async function mermaidToPng(code: string): Promise<string | null> {
  if (!code?.trim()) return null;

  // Strategy 1: reuse the SVG that MermaidDiagram already rendered on the page.
  // This avoids re-initializing mermaid (which can clash with the on-page
  // instance) and guarantees we rasterize exactly what the user sees.
  let svg: string | null = null;
  if (typeof document !== "undefined") {
    const host = document.querySelector('[data-mermaid-host="true"]');
    const rendered = host?.getAttribute("data-mermaid-code") === code ? host.querySelector("svg") : null;
    if (rendered) svg = new XMLSerializer().serializeToString(rendered);
  }

  // Strategy 2: render fresh via mermaid.
  if (!svg) {
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        flowchart: { curve: "basis", padding: 12, htmlLabels: false },
        fontFamily: "Segoe UI, Arial, sans-serif"
      });
      const out = await mermaid.render(`pptmmd-${Date.now()}`, code);
      svg = out.svg;
    } catch {
      return null;
    }
  }

  if (!svg) return null;

  try {
    // Mermaid emits style="max-width:..." with no width/height attributes;
    // in Chromium an <img> loading such SVG resolves to 0 natural size,
    // producing an empty canvas. Parse the viewBox and inject explicit sizes.
    let vbW = 1600;
    let vbH = 900;
    const vbMatch = svg.match(/viewBox="([\d.\-\s]+)"/i);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        vbW = parts[2];
        vbH = parts[3];
      }
    }
    if (!/xmlns=/.test(svg)) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    svg = svg.replace(/style="[^"]*max-width:[^"]*"/i, "");
    svg = svg.replace(/\swidth="[^"]*"/i, "").replace(/\sheight="[^"]*"/i, "");
    svg = svg.replace("<svg", `<svg width="${vbW}" height="${vbH}"`);

    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = dataUrl;
    });
    const W = 1600;
    const naturalW = img.naturalWidth || vbW;
    const naturalH = img.naturalHeight || vbH;
    const H = Math.max(400, Math.round((naturalH / Math.max(1, naturalW)) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function imageDataUrlToPng(dataUrl: string, targetWidth = 2200): Promise<string | null> {
  if (!dataUrl) return null;
  if (/^data:image\/(png|jpe?g|webp);/i.test(dataUrl)) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = (e) => reject(e);
      im.src = dataUrl;
    });
    const naturalW = img.naturalWidth || 1700;
    const naturalH = img.naturalHeight || 900;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.max(700, Math.round((naturalH / Math.max(1, naturalW)) * targetWidth));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function asBullets(items: string[], fallback = "None", max = 5, maxChars = 110) {
  const all = items.map((item) => truncate(item, maxChars)).filter(Boolean);
  const clean = all.slice(0, max);
  if (all.length > max) clean.push(`+ ${all.length - max} more item${all.length - max === 1 ? "" : "s"}`);
  return (clean.length ? clean : [fallback]).map((text) => ({ text, options: { bullet: true } }));
}

function paragraphs(text: string, max = 4) {
  const items = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  return (items.length ? items : [text.trim()]).filter(Boolean).slice(0, max);
}

function truncate(text: string, max = 520) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function splitIntoSlideChunks(text: string, maxChars = 720) {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new RangeError("Slide chunk size must be a positive integer.");
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const paragraphBreak = window.lastIndexOf("\n\n");
    const wordBreak = window.lastIndexOf(" ");
    const boundary = paragraphBreak > maxChars / 2 ? paragraphBreak : wordBreak > 0 ? wordBreak : maxChars;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function compactSentence(text: string, max = 360) {
  const firstSentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  return truncate(firstSentences || text, max);
}

export function ExportPPTButton({
  input,
  decision,
  tieBreak,
  category,
  mermaidCode,
  mermaidFallback,
  architectureImageDataUrl,
  refinement,
  usageSession,
  compact = false
}: {
  input: DecisionInput;
  decision: ArchitectureDecision;
  tieBreak: TieBreakResponse | null;
  category: { category: string; description: string };
  mermaidCode: string;
  /** Deterministic mermaid string used if `mermaidCode` fails to render (e.g. malformed AI output). */
  mermaidFallback?: string;
  architectureImageDataUrl: string | null;
  refinement?: string;
  usageSession?: UsageSession;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const displayPattern = displayPatternName(decision);
  const solutionLabel = decision.basePatternId === "m365_copilot_productivity" ? displayPattern : category.category;
  const useCaseSummary = reportUseCaseSummary(input, decision, tieBreak);
  const generatedArchitectureSummary = buildArchitectureSummary(
    input,
    decision,
    solutionLabel
  );
  const architectureSummary = tieBreak?.aiValidated && tieBreak.proposedArchitectureSummary?.trim()
    ? tieBreak.proposedArchitectureSummary : shouldUseGeneratedArchitectureSummary(
    tieBreak?.proposedArchitectureSummary,
    useCaseSummary,
    decision.finalRecommendation,
    solutionLabel
  )
    ? generatedArchitectureSummary
    : tieBreak?.proposedArchitectureSummary || generatedArchitectureSummary;

  const handle = async () => {
    setBusy(true);
    try {
      const pptxgenMod = await import("pptxgenjs");
      const PptxGenJS = (pptxgenMod as any).default ?? (pptxgenMod as any);
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
      pptx.title = tieBreak?.useCaseTitle || solutionLabel;
      pptx.company = "Microsoft AI Architecture Pathfinder";

      let mermaidPng = await mermaidToPng(mermaidCode);
      if (!mermaidPng && mermaidFallback && mermaidFallback !== mermaidCode) {
        mermaidPng = await mermaidToPng(mermaidFallback);
      }
      const architecturePng = architectureImageDataUrl
        ? (await imageDataUrlToPng(architectureImageDataUrl)) || architectureImageDataUrl
        : null;

      // ---------- Slide 1: Cover ----------
      const s1 = pptx.addSlide();
      s1.background = { color: MS_BLUE };
      s1.addShape("rect", {
        x: 0,
        y: 6.6,
        w: 13.33,
        h: 0.9,
        fill: { color: MS_BLUE_DARK },
        line: { type: "none" }
      });
      s1.addText("Architecture Recommendation", {
        x: 0.6,
        y: 0.6,
        w: 12,
        h: 0.5,
        fontSize: 16,
        color: "FFFFFF",
        fontFace: "Segoe UI",
        bold: false
      });
      s1.addText(tieBreak?.useCaseTitle || solutionLabel, {
        x: 0.6,
        y: 1.2,
        w: 12,
        h: 1.6,
        fontSize: 44,
        color: "FFFFFF",
        fontFace: "Segoe UI Semibold",
        bold: true
      });
      s1.addText(
        compactSentence(useCaseSummary, 520),
        {
          x: 0.6,
          y: 2.85,
          w: 12,
          h: 2.1,
          fontSize: 15,
          color: "E1EFFF",
          fontFace: "Segoe UI",
          valign: "top",
          fit: "shrink"
        }
      );
      s1.addText(
        [
          { text: "Recommended path: ", options: { bold: true, color: "FFFFFF" } },
          { text: displayPattern, options: { color: "FFFFFF" } },
          { text: "    Solution family: ", options: { bold: true, color: "FFFFFF" } },
          { text: solutionLabel, options: { color: "FFFFFF" } }
        ],
        { x: 0.6, y: 6.75, w: 12, h: 0.5, fontSize: 12, fontFace: "Segoe UI" }
      );
      s1.addText(
        "Disclaimer: this deck contains only suggested building blocks. Validate fit against your architecture standards, security baseline and regulatory obligations before adopting.",
        {
          x: 0.6,
          y: 7.15,
          w: 12,
          h: 0.35,
          fontSize: 9,
          color: "E1EFFF",
          italic: true,
          fontFace: "Segoe UI"
        }
      );

      addExecutiveSummarySlide(pptx, {
        useCaseSummary,
        architectureSummary,
        solutionType: solutionLabel,
        displayPattern,
        overlays: decision.overlays.map((overlay) => overlay.name)
      });

      addHowItWorksSlides(pptx, decision.endToEndFlow);

      addHiddenWhyArchitectureSlide(pptx, {
        rationale: decision.rationale,
        overlays: decision.overlays.map((overlay) => `${overlay.name}: ${overlay.reason}`),
        assumptions: decision.assumptions,
        risks: decision.riskFlags
      });

      addUseCaseArchitectureSlides(pptx, {
        input,
        decision,
        useCaseSummary,
        architectureSummary,
        solutionType: solutionLabel,
        displayPattern
      });

      // ---------- Supporting visual architecture reference ----------
      if (architecturePng) {
        const sImg = pptx.addSlide();
        addSlideHeader(sImg, "Architecture Visual Reference");
        const box = { x: 0.45, y: 0.95, w: 12.43, h: 6.25 };
        const dims = await measureImage(architecturePng);
        const fit = fitInBox(dims, box);
        sImg.addShape("rect", {
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          fill: { color: "FFFFFF" },
          line: { color: MS_BORDER, pt: 1 }
        });
        sImg.addImage({
          data: architecturePng,
          x: fit.x,
          y: fit.y,
          w: fit.w,
          h: fit.h
        });
        sImg.addText("High-level visual reference. Consult the complete report appendix and validate implementation details before building.", {
          x: 0.6,
          y: 7.18,
          w: 12.1,
          h: 0.24,
          fontSize: 9,
          color: MS_SUBTLE,
          italic: true,
          fontFace: "Segoe UI"
        });
      }

      // ---------- Slide 5: Component flow ----------
      if (mermaidPng) {
        const sMmd = pptx.addSlide();
        addSlideHeader(sMmd, "Service Flow");
        const box = { x: 0.6, y: 1.05, w: 12.1, h: 6.05 };
        const dims = await measureImage(mermaidPng);
        const fit = fitInBox(dims, box);
        sMmd.addShape("rect", {
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          fill: { color: "FFFFFF" },
          line: { color: MS_BORDER, pt: 1 }
        });
        sMmd.addImage({
          data: mermaidPng,
          x: fit.x,
          y: fit.y,
          w: fit.w,
          h: fit.h
        });
        sMmd.addText("Service interaction flow rendered from the recommended architecture", {
          x: 0.6,
          y: 7.18,
          w: 12.1,
          h: 0.24,
          fontSize: 9,
          color: MS_SUBTLE,
          italic: true,
          fontFace: "Segoe UI"
        });
      }

      // ---------- Slide 6: Technology stack ----------
      const stackSlide = pptx.addSlide();
      addSlideHeader(stackSlide, "Technology Stack");
      stackSlide.addShape("rect", { x: 0.45, y: 1.05, w: 6.1, h: 6.0, fill: { color: MS_PANEL }, line: { color: MS_BORDER, pt: 1 } });
      stackSlide.addShape("rect", { x: 6.78, y: 1.05, w: 6.1, h: 6.0, fill: { color: "FFFFFF" }, line: { color: "E1DFDD", pt: 1 } });
      stackSlide.addText("Recommended components", {
        x: 0.6,
        y: 1.2,
        w: 5.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: MS_TEXT,
        fontFace: "Segoe UI Semibold"
      });
      stackSlide.addText(
        asBullets(decision.recommendedStack, "—", 5, 95),
        {
          x: 0.72,
          y: 1.65,
          w: 5.55,
          h: 5.3,
          fontSize: 11,
          color: MS_TEXT,
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 4,
          fit: "shrink"
        }
      );
      stackSlide.addText("Optional add-ons", {
        x: 6.9,
        y: 1.2,
        w: 5.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: MS_TEXT,
        fontFace: "Segoe UI Semibold"
      });
      stackSlide.addText(
        asBullets(decision.optionalAddOns, "None", 5, 95),
        {
          x: 7.02,
          y: 1.65,
          w: 5.55,
          h: 5.3,
          fontSize: 11,
          color: MS_SUBTLE,
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 4,
          fit: "shrink"
        }
      );

      // ---------- Slide 8: Assumptions & risks ----------
      const assumptions = [
        ...decision.assumptions,
        ...(tieBreak?.assumptions || []).filter(
          (a) => !decision.assumptions.includes(a)
        )
      ];
      const risks = [
        ...decision.riskFlags,
        ...(tieBreak?.riskFlags || []).filter((r) => !decision.riskFlags.includes(r))
      ];
      const sA = pptx.addSlide();
      addSlideHeader(sA, "Assumptions & Risks");
      sA.addText("Assumptions", {
        x: 0.6,
        y: 1.2,
        w: 5.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: MS_TEXT,
        fontFace: "Segoe UI Semibold"
      });
      sA.addText(
        asBullets(assumptions, "None recorded", 4, 115),
        {
          x: 0.6,
          y: 1.65,
          w: 5.8,
          h: 5.3,
          fontSize: 10.5,
          color: MS_TEXT,
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 4,
          fit: "shrink"
        }
      );
      sA.addText("Risk flags", {
        x: 6.9,
        y: 1.2,
        w: 5.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: MS_TEXT,
        fontFace: "Segoe UI Semibold"
      });
      sA.addText(
        asBullets(risks, "None recorded", 4, 115),
        {
          x: 6.9,
          y: 1.65,
          w: 5.8,
          h: 5.3,
          fontSize: 10.5,
          color: "8A4B00",
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 4,
          fit: "shrink"
        }
      );

      // ---------- Slide 9: Security & guardrails ----------
      const sSec = pptx.addSlide();
      addSlideHeader(sSec, "Security & Guardrails");
      sSec.addText("Key controls", {
        x: 0.6,
        y: 1.2,
        w: 5.8,
        h: 0.4,
        fontSize: 14,
        bold: true,
        color: MS_TEXT,
        fontFace: "Segoe UI Semibold"
      });
      sSec.addText(
        asBullets(decision.securityControls, "No additional controls selected", 5, 105),
        {
          x: 0.6,
          y: 1.65,
          w: 5.8,
          h: 5.3,
          fontSize: 10.5,
          color: MS_TEXT,
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 4,
          fit: "shrink"
        }
      );
      sSec.addText(
        "Recommended safeguards",
        {
          x: 6.9,
          y: 1.2,
          w: 5.8,
          h: 0.4,
          fontSize: 14,
          bold: true,
          color: MS_TEXT,
          fontFace: "Segoe UI Semibold"
        }
      );
      const ztBullets = decision.zeroTrust.controls.length
        ? [decision.zeroTrust.rationale, ...decision.zeroTrust.controls].slice(0, 5)
        : [decision.zeroTrust.rationale];
      sSec.addText(
        ztBullets.map((s, i) => ({
          text: s,
          options: { bullet: i > 0, bold: i === 0 }
        })),
        {
          x: 6.9,
          y: 1.65,
          w: 5.8,
          h: 5.3,
          fontSize: 10.5,
          color: MS_TEXT,
          fontFace: "Segoe UI",
          valign: "top",
          paraSpaceAfter: 3,
          fit: "shrink"
        }
      );

      addContentSlide(pptx, "Recommended Next Steps", [
        { label: "Recommendation", value: compactSentence(decision.finalRecommendation || "—", 430) },
        {
          label: "Customer validation",
          value:
            "This recommendation provides suggested building blocks only. Validate fit against your architecture standards, data residency, regulatory obligations and security baseline before adopting any component."
        }
      ]);
      addReportDetailsSlides(pptx, { input, decision, tieBreak, architectureSummary, refinement });

      const filename = `architecture-${decision.basePatternId}-${Date.now()}.pptx`;
      await pptx.writeFile({ fileName: filename });
      if (usageSession) {
        trackUsageEvent({
          eventType: "powerpoint_exported",
          sessionId: usageSession.id,
          source: usageSession.source,
          sourceDetail: usageSession.sourceDetail,
          solutionType: category.category,
          displayPattern,
          basePatternId: decision.basePatternId,
          confidence: decision.confidence
        });
      }
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(`Could not export PowerPoint: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className={compact ? "btn-compact bg-white text-ms-blueDark hover:bg-blue-50 disabled:opacity-50" : "btn-primary"} onClick={handle} disabled={busy}>
      {busy ? "Building PowerPoint…" : "Export as PowerPoint"}
    </button>
  );
}

function addSlideHeader(slide: any, title: string) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.33,
    h: 0.7,
    fill: { color: MS_BLUE },
    line: { type: "none" }
  });
  slide.addText(title, {
    x: 0.6,
    y: 0.1,
    w: 12,
    h: 0.5,
    fontSize: 20,
    color: "FFFFFF",
    fontFace: "Segoe UI Semibold",
    bold: true
  });
}

function addFooter(slide: any, text = "Microsoft AI Architecture Pathfinder") {
  slide.addText(text, {
    x: 0.6,
    y: 7.22,
    w: 8.5,
    h: 0.22,
    fontSize: 8,
    color: MS_SUBTLE,
    fontFace: "Segoe UI"
  });
}

function addExecutiveSummarySlide(
  pptx: any,
  details: {
    useCaseSummary: string;
    architectureSummary: string;
    solutionType: string;
    displayPattern: string;
    overlays: string[];
  }
) {
  const slide = pptx.addSlide();
  addSlideHeader(slide, "Executive Summary");
  slide.addShape("rect", {
    x: 0.6,
    y: 1.05,
    w: 12.1,
    h: 0.75,
    fill: { color: MS_PANEL },
    line: { color: MS_BORDER, pt: 1 }
  });
  slide.addText("Recommended solution", {
    x: 0.9,
    y: 1.18,
    w: 2.4,
    h: 0.22,
    fontSize: 8.5,
    bold: true,
    color: MS_BLUE,
    fontFace: "Segoe UI Semibold",
    charSpacing: 1.3
  });
  slide.addText(
    `${details.solutionType} (${details.displayPattern})${details.overlays.length ? ` with ${details.overlays.join(", ")}` : ""}`,
    {
      x: 0.9,
      y: 1.42,
      w: 11.25,
      h: 0.25,
      fontSize: 12,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      fit: "shrink"
    }
  );

  slide.addShape("rect", {
    x: 0.6,
    y: 2.1,
    w: 12.1,
    h: 2.05,
    fill: { color: "FFFFFF" },
    line: { color: "E1DFDD", pt: 1 }
  });
  slide.addText("SUMMARY OF USE CASE", {
    x: 0.9,
    y: 2.35,
    w: 11.4,
    h: 0.25,
    fontSize: 9.5,
    bold: true,
    color: MS_BLUE,
    fontFace: "Segoe UI Semibold",
    charSpacing: 1.5
  });
  slide.addText(truncate(details.useCaseSummary, 620), {
    x: 0.9,
    y: 2.78,
    w: 11.25,
    h: 0.95,
    fontSize: 11.5,
    color: MS_TEXT,
    fontFace: "Segoe UI",
    valign: "top",
    fit: "shrink"
  });

  const architectureText = compactSentence(details.architectureSummary, 520);
  slide.addShape("rect", {
    x: 0.6,
    y: 4.45,
    w: 12.1,
    h: 2.35,
    fill: { color: MS_PANEL },
    line: { color: MS_BORDER, pt: 1 }
  });
  slide.addText("RECOMMENDED ARCHITECTURE", {
    x: 0.9,
    y: 4.7,
    w: 11.4,
    h: 0.25,
    fontSize: 9.5,
    bold: true,
    color: MS_BLUE,
    fontFace: "Segoe UI Semibold",
    charSpacing: 1.5
  });
  slide.addText(architectureText, {
    x: 0.9,
    y: 5.12,
    w: 11.25,
    h: 1.25,
    fontSize: 10.5,
    color: MS_TEXT,
    fontFace: "Segoe UI",
    valign: "top",
    breakLine: false,
    fit: "shrink"
  });
  addFooter(slide);
}

function addHiddenWhyArchitectureSlide(
  pptx: any,
  details: { rationale: string[]; overlays: string[]; assumptions: string[]; risks: string[] }
) {
  const slide = pptx.addSlide();
  slide.hidden = true;
  addSlideHeader(slide, "Why This Architecture");
  slide.addText("Presenter note: this hidden slide captures the rationale behind the recommendation.", {
    x: 0.6,
    y: 0.92,
    w: 12.1,
    h: 0.3,
    fontSize: 10,
    color: MS_SUBTLE,
    italic: true,
    fontFace: "Segoe UI"
  });
  const sections = [
    { title: "Rationale", items: details.rationale },
    { title: "Architecture additions", items: details.overlays },
    { title: "Assumptions", items: details.assumptions },
    { title: "Risks to validate", items: details.risks }
  ];
  sections.forEach((section, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = col === 0 ? 0.6 : 6.85;
    const y = row === 0 ? 1.45 : 4.18;
    slide.addShape("rect", {
      x,
      y,
      w: 5.85,
      h: 2.22,
      fill: { color: index === 0 ? MS_PANEL : "FFFFFF" },
      line: { color: index === 0 ? MS_BORDER : "E1DFDD", pt: 1 }
    });
    slide.addText(section.title.toUpperCase(), {
      x: x + 0.28,
      y: y + 0.22,
      w: 5.2,
      h: 0.25,
      fontSize: 8.5,
      bold: true,
      color: MS_BLUE,
      fontFace: "Segoe UI Semibold",
      charSpacing: 1.2
    });
    slide.addText(asBullets(section.items, "None", 4, 95), {
      x: x + 0.35,
      y: y + 0.62,
      w: 5.1,
      h: 1.25,
      fontSize: 9.5,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      valign: "top",
      paraSpaceAfter: 2,
      fit: "shrink"
    });
  });
  addFooter(slide, "Hidden slide - rationale for presenter use");
}

function addHowItWorksSlides(pptx: any, steps: string[]) {
  const cleaned = steps.map((step) => step.trim()).filter(Boolean);
  if (cleaned.length === 0) return;

  const chunks: string[][] = [];
  for (let i = 0; i < cleaned.length; i += 6) chunks.push(cleaned.slice(i, i + 6));

  chunks.forEach((chunk, chunkIndex) => {
    const slide = pptx.addSlide();
    addSlideHeader(slide, chunks.length > 1 ? `How It Works (${chunkIndex + 1}/${chunks.length})` : "How It Works");
    slide.addText("End-to-end workflow for the recommended architecture", {
      x: 0.6,
      y: 0.85,
      w: 12.1,
      h: 0.28,
      fontSize: 10,
      color: MS_SUBTLE,
      fontFace: "Segoe UI"
    });

    const leftX = 0.6;
    const rightX = 6.9;
    const topY = 1.35;
    const rowH = 1.62;
    const boxW = 5.75;

    chunk.forEach((step, index) => {
      const column = index < 3 ? 0 : 1;
      const row = index % 3;
      const x = column === 0 ? leftX : rightX;
      const y = topY + row * rowH;
      const stepNumber = chunkIndex * 6 + index + 1;

      slide.addShape("rect", {
        x,
        y,
        w: boxW,
        h: 1.25,
        rectRadius: 0.08,
        fill: { color: index === 0 && chunkIndex === 0 ? MS_PANEL : "FFFFFF" },
        line: { color: MS_BORDER, pt: 1 }
      });
      slide.addShape("ellipse", {
        x: x + 0.18,
        y: y + 0.22,
        w: 0.42,
        h: 0.42,
        fill: { color: MS_BLUE },
        line: { type: "none" }
      });
      slide.addText(String(stepNumber), {
        x: x + 0.18,
        y: y + 0.285,
        w: 0.42,
        h: 0.2,
        fontSize: 8.5,
        bold: true,
        align: "center",
        color: "FFFFFF",
        fontFace: "Segoe UI Semibold"
      });
      slide.addText(truncate(step, 180), {
        x: x + 0.75,
        y: y + 0.18,
        w: boxW - 0.95,
        h: 0.9,
        fontSize: 10.5,
        color: MS_TEXT,
        fontFace: "Segoe UI",
        valign: "mid",
        fit: "shrink"
      });
    });

    addFooter(slide);
  });
}

function uniqueItems(items: string[], max = 5, maxChars = 86) {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of items) {
    const clean = truncate(item, maxChars);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    values.push(clean);
  }
  if (values.length > max) return [...values.slice(0, max), `+ ${values.length - max} more`];
  return values;
}

function layerSelections(decision: ArchitectureDecision, layerName: DecisionLayerName) {
  return decision.architectureLayers.find((layer) => layer.layer === layerName)?.selections
    .filter((selection) => !/^(?:not required|none selected|no separate)\b/i.test(selection.trim())) ?? [];
}

function layerReasons(decision: ArchitectureDecision, layerNames: DecisionLayerName[]) {
  return uniqueItems(
    layerNames
      .map((name) => decision.architectureLayers.find((layer) => layer.layer === name)?.reason ?? "")
      .filter(Boolean),
    2,
    115
  );
}

function selectionsFor(decision: ArchitectureDecision, layerNames: DecisionLayerName[], max = 5, maxChars = 78) {
  return uniqueItems(layerNames.flatMap((name) => layerSelections(decision, name)), max, maxChars);
}

function selectedSignal(values: string[] | undefined, fallback: string) {
  return values?.length ? values.map((value) => value.replace(/_/g, " ")).join(", ") : fallback;
}

function addUseCaseArchitectureSlides(
  pptx: any,
  details: {
    input: DecisionInput;
    decision: ArchitectureDecision;
    useCaseSummary: string;
    architectureSummary: string;
    solutionType: string;
    displayPattern: string;
  }
) {
  addArchitectureBlueprintSlide(pptx, details);
  addArchitectureDesignSlide(pptx, details);
}

export function addArchitectureBlueprintSlide(
  pptx: any,
  details: {
    input: DecisionInput;
    decision: ArchitectureDecision;
    useCaseSummary: string;
    architectureSummary: string;
    solutionType: string;
    displayPattern: string;
  }
) {
  const { input, decision } = details;
  const slide = pptx.addSlide();
  addSlideHeader(slide, "Use Case Architecture Blueprint");
  slide.addText(compactSentence(details.useCaseSummary, 260), {
    x: 0.6,
    y: 0.86,
    w: 8.2,
    h: 0.45,
    fontSize: 9.5,
    color: MS_SUBTLE,
    fontFace: "Segoe UI",
    fit: "shrink"
  });
  slide.addText(`${details.solutionType} | ${details.displayPattern}`, {
    x: 9.05,
    y: 0.86,
    w: 3.65,
    h: 0.35,
    fontSize: 9,
    bold: true,
    align: "right",
    color: MS_BLUE,
    fontFace: "Segoe UI Semibold",
    fit: "shrink"
  });

  slide.addShape("rect", {
    x: 0.45,
    y: 1.42,
    w: 12.43,
    h: 4.42,
    fill: { color: "FFFFFF" },
    line: { color: MS_BORDER, pt: 1.1 }
  });
  slide.addShape("rect", {
    x: 0.45,
    y: 1.42,
    w: 12.43,
    h: 0.34,
    fill: { color: MS_PANEL },
    line: { type: "none" }
  });
  const boundary = decision.basePatternId === "m365_copilot_productivity"
    ? "Microsoft 365 tenant / native productivity boundary"
    : details.solutionType === "Copilot Studio"
    ? "Power Platform environment / selected supporting services"
    : "Target Azure landing zone / solution boundary";
  slide.addText(boundary, {
    x: 0.68,
    y: 1.49,
    w: 5.8,
    h: 0.18,
    fontSize: 8.2,
    bold: true,
    color: MS_BLUE_DARK,
    fontFace: "Segoe UI Semibold",
    charSpacing: 0.7
  });

  const columns = [
    {
      title: "Consumers",
      subtitle: selectedSignal(input.users, "Selected users"),
      layers: ["User/Channel" as DecisionLayerName],
      fallback: selectedSignal(input.channels, "Portal or approved channel")
    },
    {
      title: "Experience",
      subtitle: "Entry point",
      layers: ["Experience" as DecisionLayerName, "Identity" as DecisionLayerName],
      fallback: "Authenticated UX, Teams, portal, API, or embedded surface"
    },
    {
      title: "Runtime",
      subtitle: "Execution host",
      layers: ["Runtime/Backend" as DecisionLayerName, "Orchestration" as DecisionLayerName],
      fallback: "No separate runtime or orchestration selected"
    },
    {
      title: "AI and Grounding",
      subtitle: "Reasoning path",
      layers: ["AI Platform" as DecisionLayerName, "Analytics/Grounding" as DecisionLayerName],
      fallback: "No separate model or grounding service selected"
    },
    {
      title: "Data and APIs",
      subtitle: "System of record",
      layers: ["Knowledge/Data" as DecisionLayerName, "Integration" as DecisionLayerName],
      fallback: "No separate data or integration component selected"
    },
    {
      title: "Controls",
      subtitle: "Operate safely",
      layers: ["Security" as DecisionLayerName, "Observability" as DecisionLayerName, "Network/Deployment" as DecisionLayerName],
      fallback: "Identity, audit, monitoring, network isolation, and policy controls"
    }
  ];

  const cardW = 1.82;
  const gap = 0.2;
  const startX = 0.68;
  const cardY = 1.98;
  columns.forEach((column, index) => {
    const x = startX + index * (cardW + gap);
    const items = selectionsFor(decision, column.layers, Number.MAX_SAFE_INTEGER, 56);
    slide.addShape("rect", {
      x,
      y: cardY,
      w: cardW,
      h: 3.45,
      rectRadius: 0.06,
      fill: { color: index % 2 === 0 ? MS_PANEL : "FFFFFF" },
      line: { color: MS_BORDER, pt: 0.85 }
    });
    slide.addText(column.title.toUpperCase(), {
      x: x + 0.12,
      y: cardY + 0.18,
      w: cardW - 0.24,
      h: 0.2,
      fontSize: 7.3,
      bold: true,
      color: MS_BLUE,
      fontFace: "Segoe UI Semibold",
      charSpacing: 0.65,
      fit: "shrink"
    });
    slide.addText(truncate(column.subtitle, 55), {
      x: x + 0.12,
      y: cardY + 0.46,
      w: cardW - 0.24,
      h: 0.36,
      fontSize: 8.2,
      bold: true,
      color: MS_TEXT,
      fontFace: "Segoe UI Semibold",
      fit: "shrink"
    });
    slide.addText(asBullets(items, column.fallback, 4, 56), {
      x: x + 0.2,
      y: cardY + 0.96,
      w: cardW - 0.32,
      h: 2.2,
      fontSize: 7.6,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      valign: "top",
      paraSpaceAfter: 2,
      fit: "shrink"
    });
    if (index < columns.length - 1) {
      slide.addText("to", {
        x: x + cardW + 0.02,
        y: cardY + 1.58,
        w: gap + 0.02,
        h: 0.2,
        fontSize: 7,
        bold: true,
        color: MS_BLUE,
        align: "center",
        fontFace: "Segoe UI Semibold"
      });
    }
  });

  const designIntent = [
    `The user enters through ${selectedSignal(input.channels, "the selected channel")}; identity and authorization gate access before the runtime executes any agent, workflow, or retrieval path.`,
    compactSentence(details.architectureSummary, 260)
  ];
  slide.addShape("rect", {
    x: 0.6,
    y: 6.12,
    w: 12.1,
    h: 0.78,
    fill: { color: MS_PANEL },
    line: { color: MS_BORDER, pt: 0.8 }
  });
  slide.addText("Design intent", {
    x: 0.85,
    y: 6.25,
    w: 1.3,
    h: 0.2,
    fontSize: 8.5,
    bold: true,
    color: MS_BLUE,
    fontFace: "Segoe UI Semibold"
  });
  slide.addText(designIntent.join(" "), {
    x: 2.0,
    y: 6.2,
    w: 10.35,
    h: 0.46,
    fontSize: 8.6,
    color: MS_TEXT,
    fontFace: "Segoe UI",
    fit: "shrink"
  });
  addFooter(slide);
}

function addArchitectureDesignSlide(
  pptx: any,
  details: {
    input: DecisionInput;
    decision: ArchitectureDecision;
    useCaseSummary: string;
    architectureSummary: string;
    solutionType: string;
    displayPattern: string;
  }
) {
  const { decision } = details;
  const slide = pptx.addSlide();
  addSlideHeader(slide, "Implementation Architecture Design");
  slide.addText("Concrete responsibilities, boundaries, and guardrails for building the recommended use case architecture.", {
    x: 0.6,
    y: 0.86,
    w: 12.1,
    h: 0.28,
    fontSize: 9.8,
    color: MS_SUBTLE,
    fontFace: "Segoe UI"
  });

  const cards = [
    {
      title: "User access and experience",
      layers: ["User/Channel" as DecisionLayerName, "Experience" as DecisionLayerName, "Identity" as DecisionLayerName],
      owns: "Front door for the workload, sign-in, consent, and the visible user journey.",
      guardrail: "Do not bypass Entra/EasyAuth, RBAC, external identity, or tenant controls selected for this audience."
    },
    {
      title: "Runtime and orchestration",
      layers: ["Runtime/Backend" as DecisionLayerName, "Orchestration" as DecisionLayerName],
      owns: "Conversation/session state, prompts, tool calls, deterministic actions, retries, and business workflow execution.",
      guardrail: "Business writes go through approved APIs or workflows; the model does not write directly to systems of record."
    },
    {
      title: "Model and grounding path",
      layers: ["AI Platform" as DecisionLayerName, "Analytics/Grounding" as DecisionLayerName],
      owns: "Model selection, RAG or Fabric analytics grounding, citations, query shaping, and answer quality checks.",
      guardrail: "Use only the selected grounding path; do not add Fabric, Azure AI Search, or custom RAG unless the scenario requires it."
    },
    {
      title: "Knowledge, data, and integration",
      layers: ["Knowledge/Data" as DecisionLayerName, "Integration" as DecisionLayerName],
      owns: "Connectors, ingestion, indexing, API contracts, source permissions, and data freshness expectations.",
      guardrail: "Keep source permissions authoritative; avoid copying regulated data into unapproved stores."
    },
    {
      title: "Security and network boundary",
      layers: ["Security" as DecisionLayerName, "Network/Deployment" as DecisionLayerName],
      owns: "WAF/APIM, managed identities, secrets, private connectivity, data residency, and inbound/outbound exposure.",
      guardrail: "Public endpoints, if selected, terminate at the edge; private services remain behind private networking where required."
    },
    {
      title: "Operations and validation",
      layers: ["Observability" as DecisionLayerName],
      owns: "Tracing, evaluation, monitoring, audit logs, incident signals, and release gates for prompt/model changes.",
      guardrail: "Ship with telemetry and evaluation coverage before production rollout, especially for regulated or external users."
    }
  ];

  cards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = col === 0 ? 0.6 : 6.78;
    const y = 1.28 + row * 1.88;
    const selected = selectionsFor(decision, card.layers, 4, 74);
    const reasons = layerReasons(decision, card.layers);
    const selectedText = selected.length ? selected.join("; ") : "Use the selected services from the recommendation stack.";
    const reasonText = reasons.length ? reasons.join(" ") : card.owns;

    slide.addShape("rect", {
      x,
      y,
      w: 5.95,
      h: 1.58,
      rectRadius: 0.06,
      fill: { color: index === 0 ? MS_PANEL : "FFFFFF" },
      line: { color: index === 0 ? MS_BORDER : "E1DFDD", pt: 0.85 }
    });
    slide.addText(card.title.toUpperCase(), {
      x: x + 0.25,
      y: y + 0.16,
      w: 5.45,
      h: 0.2,
      fontSize: 7.8,
      bold: true,
      color: MS_BLUE,
      fontFace: "Segoe UI Semibold",
      charSpacing: 0.8,
      fit: "shrink"
    });
    slide.addText([
      { text: "Build: ", options: { bold: true, color: MS_TEXT } },
      { text: truncate(selectedText, 145), options: { color: MS_TEXT } },
      { text: "\nDesign: ", options: { bold: true, color: MS_TEXT } },
      { text: truncate(reasonText, 150), options: { color: MS_TEXT } },
      { text: "\nGuardrail: ", options: { bold: true, color: MS_TEXT } },
      { text: truncate(card.guardrail, 145), options: { color: MS_TEXT } }
    ], {
      x: x + 0.25,
      y: y + 0.45,
      w: 5.45,
      h: 0.92,
      fontSize: 7.8,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      fit: "shrink",
      breakLine: false
    });
  });

  const mustNotInclude = uniqueItems(decision.forbiddenUnlessConfirmed.concat(decision.blockedComponents), 3, 96);
  slide.addShape("rect", {
    x: 0.6,
    y: 6.98,
    w: 12.1,
    h: 0.32,
    fill: { color: "FFF7ED" },
    line: { color: "F7C46C", pt: 0.75 }
  });
  slide.addText(`Validate before build: ${mustNotInclude.length ? mustNotInclude.join("; ") : "review data residency, identity, network exposure, and operational ownership."}`, {
    x: 0.85,
    y: 7.04,
    w: 11.6,
    h: 0.16,
    fontSize: 7.6,
    color: "8A4B00",
    fontFace: "Segoe UI",
    fit: "shrink"
  });
}

export function addReportDetailsSlides(
  pptx: any,
  details: {
    input: DecisionInput;
    decision: ArchitectureDecision;
    tieBreak?: TieBreakResponse | null;
    architectureSummary: string;
    refinement?: string;
  }
) {
  addArchitectureNarrativeSlide(pptx, details.architectureSummary, "Complete Architecture Narrative");
  for (const section of reportDetailSections(details.input, details.decision, details.tieBreak, details.refinement)) {
    addArchitectureNarrativeSlide(pptx, section.items.join("\n\n"), `Appendix: ${section.title}`);
  }
}

function addArchitectureNarrativeSlide(pptx: any, architectureSummary: string, title = "Recommended Architecture") {
  const chunks = splitIntoSlideChunks(architectureSummary, 1400);
  chunks.forEach((chunk, index) => {
    const slide = pptx.addSlide();
    addSlideHeader(slide, chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title);
    slide.addShape("rect", {
      x: 0.6,
      y: 1.05,
      w: 12.1,
      h: 5.95,
      fill: { color: index === 0 ? MS_PANEL : "FFFFFF" },
      line: { color: index === 0 ? MS_BORDER : "E1DFDD", pt: 1 }
    });
    slide.addText(index === 0 ? title.toUpperCase() : `${title.toUpperCase()} CONTINUED`, {
      x: 0.95,
      y: 1.35,
      w: 11.35,
      h: 0.25,
      fontSize: 9.5,
      bold: true,
      color: MS_BLUE,
      fontFace: "Segoe UI Semibold",
      charSpacing: 1.5
    });
    slide.addText(chunk, {
      x: 0.95,
      y: 1.85,
      w: 11.25,
      h: 4.45,
      fontSize: 12.2,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      valign: "top",
      breakLine: false,
      fit: "shrink"
    });
    addFooter(slide);
  });
}

function addContentSlide(
  pptx: any,
  title: string,
  blocks: { label: string; value: string }[]
) {
  const s = pptx.addSlide();
  addSlideHeader(s, title);
  let y = 1.1;
  for (const b of blocks) {
    const blockHeight = b.label ? 1.9 : 2.1;
    s.addShape("rect", {
      x: 0.55,
      y: y - 0.06,
      w: 12.25,
      h: blockHeight,
      fill: { color: b.label ? "FFFFFF" : MS_PANEL },
      line: { color: b.label ? "E1DFDD" : MS_BORDER, pt: 0.75 }
    });
    if (b.label) {
      s.addText(b.label.toUpperCase(), {
        x: 0.85,
        y: y + 0.16,
        w: 11.5,
        h: 0.3,
        fontSize: 10,
        bold: true,
        color: MS_BLUE,
        fontFace: "Segoe UI Semibold",
        charSpacing: 2
      });
      y += 0.48;
    }
    s.addText(compactSentence(b.value || "—", b.label ? 430 : 520), {
      x: 0.85,
      y,
      w: 11.55,
      h: b.label ? 1.12 : 1.32,
      fontSize: b.label ? 11.5 : 12.5,
      color: MS_TEXT,
      fontFace: "Segoe UI",
      valign: "top",
      fit: "shrink"
    });
    y += blockHeight + 0.18;
    if (y > 6.8) break;
  }
  addFooter(s);
}
