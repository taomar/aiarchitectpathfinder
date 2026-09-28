import type PptxGenJS from "pptxgenjs";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "./types";
import { ARCHITECTURE_DISCLAIMER, buildArchitectureView, type ArchitectureView } from "./architecture-view";
import { reportUseCaseSummary } from "./export";
import { availableDiagramFocuses, buildArchitectureLayout, connectionStyle, type ArchitectureLayout } from "./architecture-layout";
import { AcceptedRecommendationSchema, recommendationDecision, recommendationReviewLabel, type AcceptedRecommendation } from "./recommendation-contract";

/*
 * THESIS: An architecture decision story, not a document squeezed into slide boxes.
 * WORLD: Microsoft mark, white space, deep navy, Azure blue, Aptos, editable diagrams.
 * STORY: Understand the direction, trace the boundaries, identify required review.
 * OPENING: Large left-aligned headline; a restrained architecture motif on the right.
 * FORM: At most 15 slides: decision, connected views, service-sizing table, and review gates.
 */

type Slide = ReturnType<PptxGenJS["addSlide"]>;
type TextOptions = Parameters<Slide["addText"]>[1];
export type PowerPointAssets = { logo: string; icons?: Record<string, string> };
export type PowerPointDetails = {
  input: DecisionInput;
  decision: ArchitectureDecision;
  tieBreak?: TieBreakResponse | null;
  architectureSummary: string;
  refinement?: string;
  solutionType?: string;
};
const C = { ink: "122A43", navy: "0B2B4A", blue: "0078D4", pale: "F1F6FB", line: "D5E0EB", muted: "50657A", amber: "805B13", amberFill: "FFF4D8" };
const W = 13.333333;
const H = 7.5;
export const MAX_POWERPOINT_SLIDES = 15;
export const SERVICE_ROWS_PER_SLIDE = 4;
const deckState = new WeakMap<PptxGenJS, { page: number; assets?: PowerPointAssets }>();
const clean = (items: string[]) => [...new Set(items.map(item => item.trim()).filter(Boolean))];

export function splitIntoSlideChunks(value: string, maxChars = 720) {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new RangeError("Slide chunk size must be a positive integer.");
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const paragraph = window.lastIndexOf("\n\n");
    const word = window.lastIndexOf(" ");
    const boundary = paragraph > maxChars / 2 ? paragraph : word > 0 ? word : maxChars;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function wrapSlideText(value: string, maxChars: number) {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, "").split("\n")) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let current = "";
    for (const token of paragraph.trim().split(/\s+/)) {
      for (const word of splitIntoSlideChunks(token, maxChars)) {
        if (current && current.length + word.length + 1 > maxChars) { lines.push(current); current = ""; }
        current += (current ? " " : "") + word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function text(slide: Slide, value: string, x: number, y: number, w: number, h: number, size = 20, options: TextOptions = {}) {
  slide.addText(value, {
    x, y, w, h, fontFace: "Aptos", fontSize: size, color: C.ink,
    margin: 0, valign: "top", breakLine: false, paraSpaceAfter: 0,
    ...options
  });
}

function rect(pptx: PptxGenJS, slide: Slide, x: number, y: number, w: number, h: number, fill: string, line = fill) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: line, width: 0.8 } });
}

function logo(pptx: PptxGenJS, slide: Slide, x: number, y: number, w: number) {
  const data = deckState.get(pptx)?.assets?.logo;
  if (data) {
    slide.addImage({ data, x, y, w, h: w * 46 / 216 });
    return;
  }
  // Pure layout helpers can be used without external image IO in offline tests.
  const s = w * 0.145;
  ["F25022", "7FBA00", "00A4EF", "FFB900"].forEach((color, index) =>
    rect(pptx, slide, x + index % 2 * (s + 0.018), y + Math.floor(index / 2) * (s + 0.018), s, s, color));
  text(slide, "Microsoft", x + s * 2 + 0.1, y + 0.01, w - s * 2 - 0.1, s * 2 + 0.03, w * 11.2, { color: "5E5E5E" });
}

function frame(pptx: PptxGenJS, title: string, section: string, dark = false) {
  const state = deckState.get(pptx) ?? { page: 0 };
  if (state.page >= MAX_POWERPOINT_SLIDES) throw new Error("The presentation exceeded its 15-slide budget.");
  state.page++;
  deckState.set(pptx, state);
  const slide = pptx.addSlide();
  slide.background = { color: dark ? C.navy : "FFFFFF" };
  if (dark) rect(pptx, slide, 10.98, 0.26, 1.7, 0.5, "FFFFFF");
  logo(pptx, slide, 11.07, 0.34, 1.5);
  text(slide, `Architecture Pathfinder · ${section}`, 0.65, 0.35, 9.8, 0.25, 11, { color: dark ? "C9DCEE" : C.muted });
  text(slide, title, 0.65, 0.91, 12.0, 0.8, 30, { bold: true, color: dark ? "FFFFFF" : C.ink, fontFace: "Aptos Display" });
  slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 6.94, w: 12.02, h: 0, line: { color: dark ? "45627D" : C.line, width: 0.7 } });
  text(slide, ARCHITECTURE_DISCLAIMER, 0.65, 7.04, 11.6, 0.27, 12, { color: dark ? "DBE8F4" : C.muted });
  text(slide, String(state.page).padStart(2, "0"), 12.25, 7.04, 0.42, 0.25, 11, { align: "right", color: dark ? "DBE8F4" : C.muted });
  return slide;
}

function sentence(value: string) {
  return value.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
}

function addCover(pptx: PptxGenJS, details: PowerPointDetails, view: ArchitectureView) {
  const slide = pptx.addSlide();
  deckState.get(pptx)!.page++;
  slide.background = { color: "FFFFFF" };
  rect(pptx, slide, 9.06, 0, W - 9.06, H, C.navy);
  logo(pptx, slide, 0.7, 0.55, 2.25);
  text(slide, "Architecture Pathfinder", 0.72, 1.42, 7.6, 0.38, 18, { color: C.muted });
  const title = details.tieBreak?.useCaseTitle?.trim() || "Your proposed architecture";
  text(slide, wrapSlideText(title, 31).join("\n"), 0.69, 2.0, 7.72, 2.15, 39, { bold: true, fontFace: "Aptos Display" });
  const overview = sentence(reportUseCaseSummary(details.input, details.decision, details.tieBreak));
  const summaryLines = wrapSlideText(overview, 45);
  const coverSummary = summaryLines.length <= 4 ? summaryLines
    : wrapSlideText(details.tieBreak?.highLevelFlow?.at(-1) || details.tieBreak?.useCaseTitle || "Proposed architecture", 45);
  text(slide, coverSummary.join("\n"), 0.72, 4.42, 7.6, 1.42, 20, { color: C.muted });
  rect(pptx, slide, 0.7, 6.25, 7.65, 0.76, C.amberFill);
  text(slide, ARCHITECTURE_DISCLAIMER, 0.9, 6.37, 7.23, 0.54, 14.5, { color: C.amber, bold: true });
  text(slide, "Proposed\narchitecture", 9.58, 1.22, 3.15, 1.2, 26, { color: "FFFFFF", bold: true });
  const groups = [
    { title: "Experience", layer: "channels" },
    { title: "Intelligence", layer: "runtime" },
    { title: "Knowledge", layer: "data" }
  ];
  groups.forEach((group, index) => {
    const y = 2.95 + index * 1.13;
    const name = view.layers.find(layer => layer.id === group.layer)?.nodes[0]?.label ?? "Confirm the design";
    slide.addShape(pptx.ShapeType.line, { x: 9.63, y, w: 0.32, h: 0, line: { color: "5DC3F2", width: 2.5 } });
    text(slide, group.title, 10.07, y - 0.11, 2.45, 0.25, 12, { color: "ABCBE6" });
    text(slide, wrapSlideText(name, 26).join("\n"), 10.07, y + 0.22, 2.5, 0.66, 18, { color: "FFFFFF", bold: true });
  });
  if (details.tieBreak?.review) text(slide, recommendationReviewLabel(details.tieBreak.review), 9.57, 6.29, 3.05, 0.34, 11.5, { color: "C9DCEE" });
  text(slide, "Proposed design · review before implementation", 9.57, 6.71, 3.05, 0.45, 11.5, { color: "C9DCEE" });
}

function addDecision(pptx: PptxGenJS, details: PowerPointDetails, view: ArchitectureView) {
  const slide = frame(pptx, "The recommended direction", "Decision");
  const family = details.solutionType || view.title;
  text(slide, wrapSlideText(family, 30).join("\n"), 0.77, 1.88, 7.2, 1.85, 35, { color: C.blue, bold: true });
  const rationale = sentence(details.decision.rationale[0] || details.decision.finalRecommendation);
  const rationaleLines = wrapSlideText(rationale, 45);
  const decisionRationale = rationaleLines.length <= 3 ? rationaleLines
    : wrapSlideText(details.tieBreak?.highLevelFlow?.at(-1) || "Confirm the requirements before implementation.", 45);
  text(slide, decisionRationale.join("\n"), 0.79, 3.95, 7.02, 1.45, 21, { color: C.ink });
  slide.addShape(pptx.ShapeType.line, { x: 8.57, y: 1.96, w: 0, h: 3.4, line: { color: C.line, width: 1 } });
  const facts = [
    ["Audience", view.audience.length > 3 ? "Multiple selected audiences" : view.audience.join(", ") || "To be confirmed"],
    ["Channels", view.layers.find(layer => layer.id === "channels")!.nodes.length > 3 ? "Multiple selected channels" : view.layers.find(layer => layer.id === "channels")?.nodes.map(node => node.label).join(", ") || "Confirm the entry experience"]
  ];
  facts.forEach(([label, value], index) => {
    const y = 2.0 + index * 1.42;
    text(slide, label, 9.0, y, 3.05, 0.28, 13, { color: C.muted });
    text(slide, wrapSlideText(value, 28).join("\n"), 9.0, y + 0.4, 3.05, 0.85, 19, { bold: true });
  });
  text(slide, "Action boundary", 0.79, 5.68, 11.5, 0.23, 13, { color: C.muted });
  text(slide, wrapSlideText(view.actionBoundary, 95).join("\n"), 0.79, 6.03, 11.7, 0.66, 16, { bold: true });
}

export function addArchitectureBlueprintSlide(pptx: PptxGenJS, details: {
  input: DecisionInput; decision: ArchitectureDecision; useCaseSummary: string;
  architectureSummary: string; solutionType: string; displayPattern: string;
}) {
  const view = buildArchitectureView(details.decision, details.input);
  const overview = buildArchitectureLayout(view);
  if (!overview.nodes.length) {
    const slide = frame(pptx, "Architecture decisions to confirm", "AI recommendation");
    text(slide, "The AI requested clarification before defining the connected architecture.", 0.85, 2.1, 11.5, 1.0, 24);
    return;
  }
  const available = availableDiagramFocuses(view);
  const detailsOrder = (["data", "preparation", "request", "models"] as const).filter(focus => available.includes(focus));
  const needsDetail = overview.nodes.length > 7 ||
    Math.min(12.04 / overview.width, 4.9 / overview.height) * 18 * 72 < 12;
  const focuses = needsDetail ? ["overview" as const, ...detailsOrder.slice(0, 2)] : ["overview" as const];
  for (const focus of focuses) {
    const graph = focus === "overview" ? overview : buildArchitectureLayout(view, focus);
    const slide = frame(pptx, graph.title, focus === "overview" && needsDetail
      ? "Topology overview · readable detail views follow" : "Connected architecture");
    addConnectedDiagram(pptx, slide, graph);
  }
}

function addConnectedDiagram(pptx: PptxGenJS, slide: Slide, graph: ArchitectureLayout) {
  const box = { x: 0.64, y: 1.88, width: 12.04, height: graph.highLevel ? 4.9 : 4.18 };
  const scale = Math.min(box.width / graph.width, box.height / graph.height);
  const left = box.x + (box.width - graph.width * scale) / 2;
  const top = box.y + (box.height - graph.height * scale) / 2;
  const px = (value: number) => left + value * scale;
  const py = (value: number) => top + value * scale;
  const font = (value: number) => value * scale * 72;
  for (const group of graph.groups) {
    rect(pptx, slide, px(group.x), py(group.y), group.width * scale, group.height * scale, group.fill, graph.highLevel ? "6B8FAE" : "ADBECE");
    const stacked = graph.layoutStyle === "stacked";
    text(slide, group.title, px(group.x + (stacked ? 18 : 10)), py(group.y + (stacked ? 10 : 5)),
      (group.width - 36) * scale, (stacked ? 27 : 19) * scale, font(stacked ? 18 : 13), { bold: true, color: "274962" });
  }
  for (const connection of graph.connections) {
    const style = connectionStyle(connection.edge.kind);
    const points = connection.points;
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1], end = points[index];
      const dx = end.x - start.x, dy = end.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.001) continue;
      slide.addShape(pptx.ShapeType.line, {
        x: px(Math.min(start.x, end.x)), y: py(Math.min(start.y, end.y)),
        w: Math.max(Math.abs(dx) * scale, 0.001), h: Math.abs(dy) * scale,
        flipH: dx < 0, flipV: dy < 0,
        line: {
          color: style.color, width: 1.3,
          ...(style.dash ? { dashType: connection.edge.kind === "contains" || connection.edge.kind === "policy" ? "dash" as const : "lgDash" as const } : {}),
          ...(index === points.length - 1 ? { endArrowType: "triangle" as const } : {})
        }
      });
    }
  }
  for (const placed of graph.nodes) {
    const node = placed.node;
    const pending = node.state === "confirm" || !node.required;
    if (graph.layoutStyle !== "stacked" || pending) rect(pptx, slide, px(placed.x), py(placed.y), placed.width * scale, placed.height * scale, "FFFFFF", pending ? "AF8025" : "B8C8D7");
    const image = deckState.get(pptx)?.assets?.icons?.[node.id];
    const iconSize = graph.highLevel ? 48 : 44;
    if (image) slide.addImage({ data: image, x: px(placed.x + placed.width / 2 - iconSize / 2), y: py(placed.y + 16), w: iconSize * scale, h: iconSize * scale });
    else {
      const cx = placed.x + placed.width / 2;
      const cy = placed.y + 38;
      if (placed.glyph === "person") {
        slide.addShape(pptx.ShapeType.ellipse, { x: px(cx - 8), y: py(cy - 24), w: 16 * scale, h: 16 * scale, fill: { color: "E5F0F9" }, line: { color: "365875", width: 1 } });
        slide.addShape(pptx.ShapeType.roundRect, { x: px(cx - 16), y: py(cy - 3), w: 32 * scale, h: 30 * scale, fill: { color: "E5F0F9" }, line: { color: "365875", width: 1 } });
      } else if (placed.glyph === "phone") {
        rect(pptx, slide, px(cx - 13), py(cy - 23), 26 * scale, 45 * scale, "F2F6FA", "55758F");
        slide.addShape(pptx.ShapeType.line, { x: px(cx - 7), y: py(cy - 17), w: 14 * scale, h: 0, line: { color: "55758F", width: 0.8 } });
        slide.addShape(pptx.ShapeType.ellipse, { x: px(cx - 2), y: py(cy + 14), w: 4 * scale, h: 4 * scale, fill: { color: "55758F" }, line: { color: "55758F" } });
      } else {
        rect(pptx, slide, px(cx - 25), py(cy - 18), 50 * scale, 35 * scale, "F2F6FA", "55758F");
        const symbol = placed.glyph === "api" ? "API" : placed.glyph === "code" ? "{ }" : placed.glyph === "pipeline" ? "ETL" : placed.glyph === "window" ? "WEB" : "SYS";
        text(slide, symbol, px(cx - 25), py(cy - 18), 50 * scale, 35 * scale, font(13), { bold: true, align: "center", valign: "middle", color: "365875" });
      }
    }
    text(slide, placed.labelLines.join("\n"), px(placed.x + 8), py(placed.y + (graph.highLevel ? 77 : 68)),
      (placed.width - 16) * scale, placed.labelLines.length * (graph.highLevel ? 25 : 22) * scale,
      font(graph.highLevel ? 18 : 16), { bold: true, align: "center" });
    text(slide, placed.caption, px(placed.x + 5), py(placed.y + placed.height - 21), (placed.width - 10) * scale, 16 * scale, font(10), { color: pending ? C.amber : C.muted, align: "center" });
  }
  for (const connection of graph.connections) {
    if (graph.highLevel) {
      const label = connection.labelBox;
      rect(pptx, slide, px(label.x), py(label.y), label.width * scale, label.height * scale, "FFFFFF");
      text(slide, connection.labelLines.join("\n"), px(label.x), py(label.y + 4), label.width * scale,
        (label.height - 4) * scale, font(14), { align: "center", color: connectionStyle(connection.edge.kind).color });
      continue;
    }
    const size = 24 * scale;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: px(connection.labelPoint.x) - size / 2, y: py(connection.labelPoint.y) - size / 2,
      w: size, h: size, fill: { color: "FFFFFF" }, line: { color: connectionStyle(connection.edge.kind).color, width: 0.8 }
    });
    text(slide, String(connection.number), px(connection.labelPoint.x) - size / 2, py(connection.labelPoint.y) - size / 2,
      size, size, font(12), { bold: true, align: "center", valign: "middle", color: connectionStyle(connection.edge.kind).color });
  }
  const visibleLabels = graph.highLevel ? [] : graph.connections.slice(0, 12);
  visibleLabels.forEach((connection, index) => {
    text(slide, `${connection.number}. ${connection.shortLabel}`, 0.72 + index % 4 * 3.08, 6.12 + Math.floor(index / 4) * 0.24,
      2.95, 0.22, 10.5, { color: connectionStyle(connection.edge.kind).color });
  });
}

function conciseItems(items: string[], maximum = 6) {
  return clean(items).flatMap(item => {
    const sentences = item.split(/(?<=[.!?])\s+/);
    return sentences.filter(value => value.trim().length <= 240).slice(0, 1);
  }).slice(0, maximum);
}

function addServiceSizing(pptx: PptxGenJS, report: AcceptedRecommendation) {
  const services = [...report.serviceSizing].sort((left, right) =>
    Number(right.provider === "azure") - Number(left.provider === "azure") || left.name.localeCompare(right.name));
  const title = services.some(service => service.provider === "azure")
    ? "Azure services & environment sizing" : "Services & environment sizing";
  if (!services.length) {
    const slide = frame(pptx, title, "AI-proposed configuration");
    text(slide, "Service sizing needs clarification before implementation.", 0.85, 2.1, 11.5, 0.9, 24);
    return;
  }
  for (let offset = 0; offset < services.length; offset += SERVICE_ROWS_PER_SLIDE) {
    const page = services.slice(offset, offset + SERVICE_ROWS_PER_SLIDE);
    const slide = frame(pptx, title, `Proposed starting configuration · ${Math.floor(offset / SERVICE_ROWS_PER_SLIDE) + 1}/${Math.ceil(services.length / SERVICE_ROWS_PER_SLIDE)}`);
    const header = ["Service", "Purpose", "Dev", "Test", "Prod"].map(value => ({
      text: value, options: { bold: true, color: "FFFFFF", fill: { color: C.navy } }
    }));
    const rows: PptxGenJS.TableRow[] = [header, ...page.map((service, index) => [
      `${service.name}\n${service.provider === "azure" ? "Azure" : service.provider === "microsoft-saas" ? "Microsoft SaaS" : service.provider === "logical" ? "Logical capability" : "External dependency"}`,
      service.purpose, service.dev, service.test, service.prod
    ].map(value => ({
      text: wrapSlideText(value, 27).join("\n"),
      options: { fill: { color: index % 2 ? "FFFFFF" : C.pale }, color: C.ink }
    })))];
    slide.addTable(rows, {
      x: 0.68, y: 1.92, w: 12.0,
      colW: [2.35, 2.15, 2.5, 2.5, 2.5],
      rowH: [0.46, ...page.map(() => 1.02)],
      fontFace: "Aptos", fontSize: 13, margin: [5, 3, 5, 3], valign: "top",
      border: { type: "solid", color: C.line, pt: 0.8 },
      autoPage: false
    });
    text(slide, "Sizing is proposed, not measured. Confirm load, tokens, corpus, region and service limits.", 0.75, 6.66, 11.85, 0.23, 11, { color: C.muted });
  }
}

function addFinalConditions(pptx: PptxGenJS, report: AcceptedRecommendation) {
  const controls = conciseItems(report.securityControls, 6);
  const controlSlide = frame(pptx, "Security & delivery boundaries", "AI recommendation");
  controls.forEach((value, index) => {
    const x = index % 2 ? 6.85 : 0.84;
    const y = 2.02 + Math.floor(index / 2) * 1.5;
    text(controlSlide, wrapSlideText(value, 47).join("\n"), x, y, 5.55, 1.24, 18);
  });
  if (!controls.length) text(controlSlide, "Security requirements must be confirmed before implementation.", 0.84, 2.1, 11.4, 1, 24);
  const conditions = conciseItems([...report.sizingAssumptions, ...report.questionsToAskNext, ...report.riskFlags], 6);
  const finalSlide = frame(pptx, "Confirm before implementation", "Sizing and review");
  if (report.review.status === "issues-found") text(finalSlide,
    `${report.review.issues.length} unresolved AI review findings. Read the full findings on the Recommendation page.`,
    0.84, 1.72, 11.6, 0.23, 11, { color: C.amber, bold: true });
  conditions.forEach((value, index) => {
    const x = index % 2 ? 6.85 : 0.84;
    const y = 2.02 + Math.floor(index / 2) * 1.5;
    text(finalSlide, wrapSlideText(value, 47).join("\n"), x, y, 5.55, 1.24, 18);
  });
}

export function buildPowerPoint(pptx: PptxGenJS, details: PowerPointDetails, assets: PowerPointAssets) {
  if (!assets.logo.startsWith("data:image/png;base64,")) throw new Error("The Microsoft logo must be loaded before exporting.");
  const report = AcceptedRecommendationSchema.parse(details.tieBreak);
  const approved: PowerPointDetails = {
    ...details, decision: recommendationDecision(report), tieBreak: report,
    architectureSummary: report.proposedArchitectureSummary, solutionType: report.solutionType
  };
  deckState.set(pptx, { page: 0, assets });
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Architecture Pathfinder";
  pptx.company = "Architecture Pathfinder";
  pptx.title = report.useCaseTitle;
  pptx.subject = ARCHITECTURE_DISCLAIMER;
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
  const view = buildArchitectureView(approved.decision, approved.input);
  addCover(pptx, approved, view);
  addDecision(pptx, approved, view);
  addArchitectureBlueprintSlide(pptx, {
    ...approved, useCaseSummary: report.useCaseSummary,
    solutionType: report.solutionType, displayPattern: report.displayPatternName
  });
  addServiceSizing(pptx, report);
  addFinalConditions(pptx, report);
  return { slides: deckState.get(pptx)!.page, model: view };
}
