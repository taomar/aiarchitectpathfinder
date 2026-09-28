import type { ArchitectureDecision, DecisionInput } from "./types";
import { buildArchitectureView, type ArchitectureView, type ViewNode } from "./architecture-view";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function wrapArchitectureText(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    if (!lines.length || lines[lines.length - 1].length + word.length + 1 > width) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines.length ? lines : [""];
}

function text(lines: string[], x: number, y: number, size: number, color = "#172C45", bold = false, lineHeight = size * 1.3) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${bold ? 600 : 400}" fill="${color}">${xml(line)}</text>`).join("");
}

function nodeHeight(node: ViewNode) {
  return Math.max(116, 58 + wrapArchitectureText(node.label, 27).length * 27 + 30);
}

export function renderArchitectureViewSvg(view: ArchitectureView, icons?: Map<string, string | null>) {
  const width = 1520;
  const margin = 44;
  const labelWidth = 245;
  const contentX = margin + labelWidth;
  const contentWidth = width - margin - contentX;
  const gap = 16;
  const cardWidth = (contentWidth - gap * 2) / 3;
  const parts: string[] = [];
  const title = wrapArchitectureText(view.title, 62);
  parts.push(text(title, margin, 55, 32, "#11263F", true, 38));
  let y = 68 + title.length * 38;
  parts.push(text([view.actionBoundary + ". The same layers and boundaries in every view."], margin, y, 18, "#52657C"));
  y += 30;
  parts.push(`<rect x="${margin}" y="${y}" width="${width - margin * 2}" height="42" rx="5" fill="#FFF5DC"/>`);
  parts.push(text([view.disclaimer], margin + 16, y + 27, 17, "#705011", true));
  y += 76;
  for (const [index, layer] of view.layers.entries()) {
    const rows: ViewNode[][] = [];
    for (let i = 0; i < layer.nodes.length; i += 3) rows.push(layer.nodes.slice(i, i + 3));
    const heights = rows.map(row => Math.max(...row.map(nodeHeight)));
    const height = layer.nodes.length ? heights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows.length - 1) * gap : 62;
    parts.push(`<line x1="${margin}" y1="${y - 14}" x2="${width - margin}" y2="${y - 14}" stroke="#D7E1EC"/>`);
    parts.push(text([String(index + 1).padStart(2, "0")], margin, y + 22, 14, "#0078D4", true));
    parts.push(text(wrapArchitectureText(layer.title, 21), margin + 35, y + 22, 20, "#172C45", true, 26));
    const descriptionY = y + 38 + wrapArchitectureText(layer.title, 21).length * 26;
    parts.push(text(wrapArchitectureText(layer.description, 29), margin + 35, descriptionY, 14, "#52657C", false, 19));
    if (!layer.nodes.length) parts.push(text(["No separate component selected"], contentX + 18, y + 32, 17, "#697B8D"));
    let rowY = y;
    rows.forEach((row, rowIndex) => {
      row.forEach((node, column) => {
        const x = contentX + column * (cardWidth + gap);
        const height = heights[rowIndex];
        const pending = node.state === "confirm";
        const fill = pending ? "#FFF9EC" : "#F5F8FC";
        parts.push(`<g data-component-id="${xml(node.id)}"><rect x="${x}" y="${rowY}" width="${cardWidth}" height="${height}" rx="7" fill="${fill}" stroke="${pending ? "#C49635" : "#CAD7E6"}"${pending ? ' stroke-dasharray="6 4"' : ""}/>`);
        const image = node.icon ? icons ? icons.get(node.icon) : node.icon : null;
        if (image) parts.push(`<image href="${xml(image)}" x="${x + 17}" y="${rowY + 22}" width="34" height="34" preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`);
        else parts.push(`<circle cx="${x + 32}" cy="${rowY + 39}" r="9" fill="${pending ? "#B98215" : "#0078D4"}" aria-hidden="true"/>`);
        parts.push(text(wrapArchitectureText(node.label, 27), x + 67, rowY + 37, 21, "#172C45", true, 27));
        const status = pending ? "Needs confirmation" : !node.required ? "Optional in the proposed design" : node.kind === "source" ? "Source permissions remain authoritative" : node.state === "managed" ? "Microsoft-managed capability" : node.kind === "capability" ? "Logical capability, not an extra deployment" : "Selected in the proposed design";
        parts.push(text(wrapArchitectureText(status, 43), x + 18, rowY + height - 28, 13, pending ? "#865910" : "#52657C", false, 17));
        parts.push("</g>");
      });
      rowY += heights[rowIndex] + gap;
    });
    y += Math.max(height, 100) + 28;
  }

  const nodes = view.layers.flatMap(layer => layer.nodes);
  const names = new Map(nodes.map(node => [node.id, node.label]));
  const pathGroups = [
    { title: "Request & governed access", kinds: ["request", "query"] },
    { title: "Background preparation", kinds: ["preparation"] },
    { title: "Confirm before enabling", kinds: ["conditional"] }
  ];
  for (const group of pathGroups) {
    const edges = view.edges.filter(edge => group.kinds.includes(edge.kind));
    if (!edges.length) continue;
    y += 16;
    parts.push(text([group.title], margin, y + 20, 23, "#172C45", true));
    y += 54;
    for (const edge of edges) {
      const arrow = edge.kind === "conditional" ? " ··· " : " → ";
      const lines = wrapArchitectureText(`${names.get(edge.from)}${arrow}${names.get(edge.to)} — ${edge.label}`, 108);
      parts.push(text(lines, margin + 18, y, 17, edge.kind === "conditional" ? "#865910" : "#364E68", false, 24));
      y += lines.length * 24 + 12;
    }
  }

  const controlGroups: Array<{ key: keyof ArchitectureView["controls"]; title: string }> = [
    { key: "identity", title: "Identity" }, { key: "security", title: "Security & source boundaries" },
    { key: "readiness", title: "Readiness — not authorization" }, { key: "operations", title: "Operations" },
    { key: "network", title: "Deployment posture" }
  ];
  for (const group of controlGroups) {
    const values = view.controls[group.key];
    if (!values.length) continue;
    y += 20;
    parts.push(`<line x1="${margin}" y1="${y}" x2="${width - margin}" y2="${y}" stroke="#D7E1EC"/>`);
    y += 38;
    parts.push(text([group.title], margin, y, 22, "#172C45", true));
    y += 36;
    for (const item of values) {
      const label = wrapArchitectureText(item.label + (item.required ? "" : " (recommended)"), 72);
      parts.push(text(label, margin + 18, y, 17, "#172C45", true, 23));
      y += label.length * 23;
      const scope = wrapArchitectureText(item.scope, 118);
      parts.push(text(scope, margin + 18, y, 14, "#52657C", false, 20));
      y += scope.length * 20 + 16;
    }
  }
  if (view.decisions.length) {
    y += 16;
    parts.push(text(["Open design decisions"], margin, y, 24, "#172C45", true));
    y += 37;
    for (const decision of view.decisions) {
      const lines = wrapArchitectureText(decision, 113);
      parts.push(text(lines, margin + 18, y, 16, "#865910", false, 23));
      y += lines.length * 23 + 12;
    }
  }
  y += 46;
  parts.push(text(["Architecture Pathfinder • component view v1 • Selected does not mean deployed or verified"], margin, y, 14, "#52657C"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 30}" viewBox="0 0 ${width} ${y + 30}" role="img" aria-label="Proposed layered architecture"><rect width="100%" height="100%" fill="#FFFFFF"/>${parts.join("")}</svg>`;
}

export function buildArchitectureSvg(decision: ArchitectureDecision, input?: DecisionInput, icons?: Map<string, string | null>) {
  return renderArchitectureViewSvg(buildArchitectureView(decision, input), icons);
}
