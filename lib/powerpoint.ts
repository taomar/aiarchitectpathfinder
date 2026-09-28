import type PptxGenJS from "pptxgenjs";
import type { ArchitectureDecision, DecisionInput, TieBreakResponse } from "./types";
import { ARCHITECTURE_DISCLAIMER, buildArchitectureView, type ArchitectureView, type ViewNode } from "./architecture-view";
import { reportDetailSections, reportUseCaseSummary } from "./export";

/*
 * THESIS: An architecture decision story, not a document squeezed into slide boxes.
 * WORLD: Microsoft mark, white space, deep navy, Azure blue, Aptos, editable diagrams.
 * STORY: Understand the direction, trace the boundaries, identify required review.
 * OPENING: Large left-aligned headline; a restrained architecture motif on the right.
 * FORM: Executive narrative followed by the same repeatable layers and a lossless appendix.
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
  slide.addNotes(`${ARCHITECTURE_DISCLAIMER}\nThis is planning guidance, not confirmation of a deployed environment or Microsoft approval.`);
  return slide;
}

function sentence(value: string) {
  return value.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
}

function paginate(value: string, chars = 111, lines = 19) {
  const wrapped = wrapSlideText(value, chars);
  const result: string[] = [];
  for (let i = 0; i < wrapped.length; i += lines) {
    const page = wrapped.slice(i, i + lines).join("\n").trim();
    if (page) result.push(page);
  }
  return result;
}

function prosePages(pptx: PptxGenJS, title: string, value: string, section: string, size = 20) {
  const chars = size >= 20 ? 80 : 118;
  const lines = size >= 20 ? 13 : 18;
  const pages = paginate(value, chars, lines);
  pages.forEach((page, index) => {
    const slide = frame(pptx, pages.length > 1 ? `${title} · ${index + 1}/${pages.length}` : title, section);
    text(slide, page, 0.82, 1.91, 11.62, 4.88, size, { lineSpacingMultiple: 1.12 });
  });
}

function nodeCard(pptx: PptxGenJS, slide: Slide, node: ViewNode, x: number, y: number, w: number, h: number) {
  const pending = node.state === "confirm";
  rect(pptx, slide, x, y, w, h, pending ? C.amberFill : C.pale, pending ? "DDC38C" : C.line);
  const image = deckState.get(pptx)?.assets?.icons?.[node.id];
  const titleX = x + (image ? 0.64 : 0.2);
  if (image) slide.addImage({ data: image, x: x + 0.17, y: y + 0.19, w: 0.31, h: 0.31 });
  const label = wrapSlideText(node.label, Math.max(18, Math.floor((w - (image ? 0.84 : 0.4)) * 7.2))).join("\n");
  text(slide, label, titleX, y + 0.17, w - (titleX - x) - 0.15, h - 0.47, 18, { bold: true, color: C.ink });
  text(slide, pending ? "Needs confirmation" : !node.required ? "Optional component" : node.state === "managed" ? "Microsoft-managed" : node.kind === "capability" ? "Logical capability" : node.kind === "source" ? "Source-owned permissions" : "Proposed component",
    x + 0.2, y + h - 0.27, w - 0.4, 0.19, 10.5, { color: pending ? C.amber : C.muted });
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
  const summaryLines = wrapSlideText(overview, 67);
  if (summaryLines.length <= 5) text(slide, summaryLines.join("\n"), 0.72, 4.42, 7.6, 1.42, 20, { color: C.muted });
  else text(slide, details.solutionType || "Architecture recommendation", 0.72, 4.46, 7.6, 1.05, 28, { color: C.blue, bold: true });
  rect(pptx, slide, 0.7, 6.25, 7.65, 0.76, C.amberFill);
  text(slide, ARCHITECTURE_DISCLAIMER, 0.9, 6.42, 7.23, 0.44, 14.5, { color: C.amber, bold: true });
  text(slide, "A clear path from\nneed to design", 9.58, 1.22, 3.15, 1.2, 26, { color: "FFFFFF", bold: true });
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
  text(slide, "Proposed design · review before implementation", 9.57, 6.71, 3.05, 0.45, 11.5, { color: "C9DCEE" });
  slide.addNotes(ARCHITECTURE_DISCLAIMER);
}

function addDecision(pptx: PptxGenJS, details: PowerPointDetails, view: ArchitectureView) {
  const slide = frame(pptx, "The recommended direction", "Decision");
  const family = details.solutionType || view.title;
  text(slide, wrapSlideText(family, 25).join("\n"), 0.77, 1.88, 7.2, 1.42, 35, { color: C.blue, bold: true });
  const rationale = sentence(details.decision.rationale[0] || details.decision.finalRecommendation);
  const rationaleLines = wrapSlideText(rationale, 56);
  text(slide, rationaleLines.length <= 7 ? rationaleLines.join("\n") : "The following pages explain the architecture, component responsibilities, source boundaries and validation conditions.",
    0.79, 3.55, 7.02, 2.5, 21, { color: C.ink });
  slide.addShape(pptx.ShapeType.line, { x: 8.57, y: 1.96, w: 0, h: 4.17, line: { color: C.line, width: 1 } });
  const facts = [
    ["Audience", view.audience.length > 3 ? "Multiple selected audiences" : view.audience.join(", ") || "To be confirmed"],
    ["Channels", view.layers.find(layer => layer.id === "channels")!.nodes.length > 3 ? "Multiple selected channels" : view.layers.find(layer => layer.id === "channels")?.nodes.map(node => node.label).join(", ") || "Confirm the entry experience"],
    ["Action boundary", view.actionBoundary]
  ];
  facts.forEach(([label, value], index) => {
    const y = 2.0 + index * 1.42;
    text(slide, label, 9.0, y, 3.05, 0.28, 13, { color: C.muted });
    text(slide, wrapSlideText(value, 28).join("\n"), 9.0, y + 0.4, 3.05, 0.85, 19, { bold: true });
  });
}

export function addArchitectureBlueprintSlide(pptx: PptxGenJS, details: {
  input: DecisionInput; decision: ArchitectureDecision; useCaseSummary: string;
  architectureSummary: string; solutionType: string; displayPattern: string;
}) {
  const view = buildArchitectureView(details.decision, details.input);
  const rows = view.layers.filter(layer => layer.nodes.length).flatMap(layer => {
    const columns = layer.nodes.some(node => node.label.length > 48) ? 1 : 3;
    const result: Array<{ title: string; description: string; nodes: ViewNode[] }> = [];
    for (let i = 0; i < layer.nodes.length; i += columns) {
      result.push({ title: layer.title, description: layer.description, nodes: layer.nodes.slice(i, i + columns) });
    }
    return result;
  });
  if (!rows.length) {
    prosePages(pptx, "Confirm the architecture inputs", details.decision.finalRecommendation, "Architecture");
    return;
  }
  for (let offset = 0; offset < rows.length; offset += 3) {
    const slide = frame(pptx, offset ? "One architecture, layer by layer · continued" : "One architecture, layer by layer", "Architecture");
    rows.slice(offset, offset + 3).forEach((row, index) => {
      const y = 1.96 + index * 1.53;
      text(slide, wrapSlideText(row.title, 18).join("\n"), 0.73, y + 0.16, 1.93, 0.9, 18, { bold: true });
      const x0 = 2.91;
      const gap = 0.14;
      const w = (9.61 - gap * (row.nodes.length - 1)) / row.nodes.length;
      row.nodes.forEach((node, nodeIndex) => nodeCard(pptx, slide, node, x0 + nodeIndex * (w + gap), y, w, 1.31));
    });
  }
}

function addReview(pptx: PptxGenJS, details: PowerPointDetails, view: ArchitectureView) {
  const considerations = clean([
    ...view.decisions,
    ...details.decision.missingQuestions.map(question => question.title),
    ...(details.tieBreak?.questionsToAskNext ?? []),
    ...details.decision.riskFlags, ...(details.tieBreak?.riskFlags ?? [])
  ]);
  const selected = considerations.slice(0, 3);
  if (selected.length) prosePages(pptx, "Resolve these points before implementation",
    selected.map((item, index) => `${index + 1}. ${item}`).join("\n\n"), "Review");
  const slide = frame(pptx, "This is a design proposal—not a sign-off", "Required review", true);
  text(slide, "Review and validate\nbefore implementation.", 0.83, 2.02, 11.55, 1.52, 36, { color: "FFFFFF", bold: true });
  const gates = [
    ["Architecture", "Confirm scope, responsibilities, selected components and integration boundaries."],
    ["Security & data", "Confirm identity, source permissions, action authority, privacy and compliance."],
    ["Delivery readiness", "Validate quality, service availability, capacity, cost and operational support."]
  ];
  gates.forEach(([title, body], index) => {
    const x = 0.86 + index * 4.13;
    text(slide, title, x, 4.25, 3.63, 0.36, 21, { color: "FFFFFF", bold: true });
    text(slide, wrapSlideText(body, 37).join("\n"), x, 4.91, 3.56, 1.17, 17, { color: "D6E5F2" });
  });
}

export function addReportDetailsSlides(pptx: PptxGenJS, details: PowerPointDetails) {
  prosePages(pptx, "Complete architecture narrative", details.architectureSummary, "Technical appendix", 14);
  for (const section of reportDetailSections(details.input, details.decision, details.tieBreak, details.refinement)) {
    prosePages(pptx, section.title, section.items.join("\n\n"), "Technical appendix", 14);
  }
}

export function buildPowerPoint(pptx: PptxGenJS, details: PowerPointDetails, assets: PowerPointAssets) {
  if (!assets.logo.startsWith("data:image/png;base64,")) throw new Error("The Microsoft logo must be loaded before exporting.");
  deckState.set(pptx, { page: 0, assets });
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Architecture Pathfinder";
  pptx.company = "Architecture Pathfinder";
  pptx.title = details.tieBreak?.useCaseTitle?.trim() || "Suggested architecture";
  pptx.subject = ARCHITECTURE_DISCLAIMER;
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };
  const view = buildArchitectureView(details.decision, details.input);
  addCover(pptx, details, view);
  addDecision(pptx, details, view);
  prosePages(pptx, "Why this architecture fits", details.architectureSummary.split(/\n\s*\n/)[0], "Recommendation", 20);
  addArchitectureBlueprintSlide(pptx, {
    ...details, useCaseSummary: reportUseCaseSummary(details.input, details.decision, details.tieBreak),
    solutionType: details.solutionType || view.title, displayPattern: details.solutionType || view.title
  });
  addReview(pptx, details, view);
  const divider = frame(pptx, "Technical appendix", "Complete source detail", true);
  text(divider, "The full design record,\nwithout clipped sentences.", 0.86, 2.36, 11.4, 1.8, 38, { bold: true, color: "FFFFFF" });
  text(divider, "Inputs · components · controls · conditions · review notes", 0.89, 4.77, 11.4, 0.7, 22, { color: "C9DCEE" });
  addReportDetailsSlides(pptx, details);
  const names = new Map(view.layers.flatMap(layer => layer.nodes).map(node => [node.id, node.label]));
  prosePages(pptx, "Source-boundary register", view.edges.map(edge =>
    `${names.get(edge.from)} ${edge.kind === "conditional" ? "···" : "→"} ${names.get(edge.to)}\n${edge.kind === "conditional" ? "Confirmation required: " : ""}${edge.label}`
  ).join("\n\n"), "Technical appendix", 14);
  return { slides: deckState.get(pptx)!.page, model: view };
}
