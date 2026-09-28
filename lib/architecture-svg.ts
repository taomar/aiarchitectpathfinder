import type { ArchitectureDecision, DecisionInput } from "./types";
import { buildArchitectureView, type ArchitectureView } from "./architecture-view";
import { buildArchitectureLayout, connectionStyle, DIAGRAM_LEGEND, type DiagramFocus } from "./architecture-layout";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function wrapArchitectureText(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    if (!lines.length || lines[lines.length - 1].length + word.length + 1 > width) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  }
  return lines.length ? lines : [""];
}
const lineText = (lines: string[], x: number, y: number, size: number, color = "#18344F", bold = false, anchor = "start") =>
  lines.map((line, i) => `<text x="${x}" y="${y + i * size * 1.35}" text-anchor="${anchor}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="${bold ? 600 : 400}" fill="${color}">${xml(line)}</text>`).join("");

export function renderArchitectureViewSvg(view: ArchitectureView, icons?: Map<string, string | null>, focus: DiagramFocus = "overview") {
  const graph = buildArchitectureLayout(view, focus);
  const width = Math.max(1280, graph.width + 80);
  const contextLines = wrapArchitectureText(`${view.audience.join(", ") || "Users as selected"}  •  ${view.actionBoundary}`, Math.floor((width - 68) / 8));
  const contextHeight = contextLines.length * 22;
  const disclaimerY = 72 + contextHeight;
  const top = disclaimerY + 82;
  const left = (width - graph.width) / 2;
  const body: string[] = [];
  body.push(lineText([graph.title], 34, 44, 29, "#17344F", true));
  body.push(lineText(contextLines, 34, 77, 16, "#4B637B"));
  body.push(`<rect x="34" y="${disclaimerY}" width="${width - 68}" height="35" rx="3" fill="#FFF4DB"/>`);
  body.push(lineText([view.disclaimer], 47, disclaimerY + 24, 16, "#795711", true));
  body.push(lineText(["Visible boxes show logical layers and service boundaries, not verified network isolation."], 34, disclaimerY + 60, 14, "#506880"));
  body.push(`<g transform="translate(${left} ${top})" data-connected-architecture="true">`);
  for (const group of graph.groups) {
    const stacked = graph.layoutStyle === "stacked";
    body.push(`<g data-boundary-id="${xml(group.id)}"${stacked ? ` data-stack-band="${group.id === "cross-cutting" ? "control-rail" : "layer"}"` : ""}><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="2" fill="#${group.fill}" stroke="${graph.highLevel ? "#6B8FAE" : "#A9BDCF"}" stroke-width="${graph.highLevel ? 1.8 : 1.3}"/>`);
    if (stacked) {
      body.push(lineText([group.title], group.x + 18, group.y + 29, 18, "#244764", true));
      if (group.id === "cross-cutting") body.push(lineText([group.subtitle], group.x + 18, group.y + 50, 12, "#52657B"));
      else {
        body.push(lineText([group.subtitle], group.x + group.width - 18, group.y + 28, 12, "#52657B", false, "end"));
        body.push(`<line x1="${group.x + 16}" y1="${group.y + 41}" x2="${group.x + group.width - 16}" y2="${group.y + 41}" stroke="#C8D8E6" stroke-width="1"/>`);
      }
    } else {
      body.push(lineText([group.title], group.x + 12, group.y + 19, 14, "#244764", true));
      body.push(lineText([group.subtitle], group.x + 12, group.y + group.height + 16, 11.5, "#566D83"));
    }
    body.push("</g>");
  }
  for (const connection of graph.connections) {
    const style = connectionStyle(connection.edge.kind);
    const points = connection.points.map(point => `${point.x},${point.y}`).join(" ");
    body.push(`<g data-connection-id="${connection.id}" data-from="${xml(connection.edge.from)}" data-to="${xml(connection.edge.to)}" data-kind="${connection.edge.kind}"><title>${xml(`${connection.number}. ${connection.edge.label}`)}</title><polyline points="${points}" fill="none" stroke="#${style.color}" stroke-width="2.3"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} marker-end="url(#arrow-${style.kind})"/></g>`);
  }
  for (const placed of graph.nodes) {
    const node = placed.node;
    const pending = node.state === "confirm" || !node.required;
    body.push(`<g ${placed.annotation ? "data-control-id" : "data-component-id"}="${xml(node.id)}" data-layer="${node.layer}"${node.provider ? ` data-provider="${node.provider}"` : ""}><title>${xml([node.detail, ...node.controls].join(" · "))}</title>`);
    if (graph.layoutStyle !== "stacked" || pending) body.push(`<rect x="${placed.x}" y="${placed.y}" width="${placed.width}" height="${placed.height}" rx="3" fill="#FFFFFF" stroke="${pending ? "#A9771D" : "#B6C7D8"}" stroke-width="1.2"${pending ? ' stroke-dasharray="6 4"' : ""}/>`);
    const image = node.icon ? icons ? icons.get(node.icon) : node.icon : null;
    const iconSize = graph.highLevel ? 48 : 44;
    if (image) body.push(`<image href="${xml(image)}" x="${placed.x + placed.width / 2 - iconSize / 2}" y="${placed.y + 16}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"/>`);
    else {
      const cx = placed.x + placed.width / 2;
      const cy = placed.y + 38;
      body.push('<g data-generic-component="true" aria-hidden="true">');
      if (placed.glyph === "person") body.push(`<circle cx="${cx}" cy="${cy - 16}" r="8" fill="#E5F0F9" stroke="#365875" stroke-width="2"/><rect x="${cx - 16}" y="${cy - 3}" width="32" height="30" rx="12" fill="#E5F0F9" stroke="#365875" stroke-width="2"/>`);
      else if (placed.glyph === "phone") body.push(`<rect x="${cx - 13}" y="${cy - 23}" width="26" height="45" rx="4" fill="#F2F6FA" stroke="#55758F" stroke-width="2"/><line x1="${cx - 7}" x2="${cx + 7}" y1="${cy - 17}" y2="${cy - 17}" stroke="#55758F" stroke-width="2"/><circle cx="${cx}" cy="${cy + 16}" r="2" fill="#55758F"/>`);
      else {
        body.push(`<rect x="${cx - 25}" y="${cy - 18}" width="50" height="35" rx="3" fill="#F2F6FA" stroke="#55758F" stroke-width="2"/>`);
        const symbol = placed.glyph === "api" ? "API" : placed.glyph === "code" ? "{ }" : placed.glyph === "pipeline" ? "ETL" : placed.glyph === "window" ? "WEB" : "SYS";
        body.push(lineText([symbol], cx, cy + 5, 13, "#365875", true, "middle"));
      }
      body.push("</g>");
    }
    body.push(lineText(placed.labelLines, placed.x + placed.width / 2, placed.y + (graph.highLevel ? 92 : 82), graph.highLevel ? 18 : 16, "#153750", true, "middle"));
    body.push(lineText([placed.caption], placed.x + placed.width / 2, placed.y + placed.height - 12, 10.5, pending ? "#805E18" : "#536D82", false, "middle"));
    body.push("</g>");
  }
  for (const connection of graph.connections) {
    const style = connectionStyle(connection.edge.kind);
    if (graph.highLevel) {
      const box = connection.labelBox;
      body.push(`<g data-connection-label="${connection.id}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="3" fill="#FFFFFF"/>`);
      body.push(lineText(connection.labelLines, connection.labelPoint.x, box.y + 19, 14, `#${style.color}`, false, "middle"));
      body.push("</g>");
      continue;
    }
    body.push(`<g data-flow-number="${connection.number}"><circle cx="${connection.labelPoint.x}" cy="${connection.labelPoint.y}" r="12" fill="#FFFFFF" stroke="#${style.color}" stroke-width="1.6"/>`);
    body.push(lineText([String(connection.number)], connection.labelPoint.x, connection.labelPoint.y + 4, 12, `#${style.color}`, true, "middle"));
    body.push("</g>");
  }
  body.push("</g>");
  let y = top + graph.height + 27;
  if (!graph.highLevel) {
  body.push(lineText(["Connection references (not execution step numbers)"], 34, y, 17, "#17344F", true));
  y += 26;
  const names = new Map(graph.nodes.map(item => [item.node.id, item.node.label]));
  const columnWidth = (width - 84) / 2;
  let rowHeight = 0;
  graph.connections.forEach((connection, index) => {
    const x = 34 + (index % 2) * (columnWidth + 16);
    const description = `${connection.number}. ${names.get(connection.edge.from)} → ${names.get(connection.edge.to)}: ${connection.edge.label}`;
    const lines = wrapArchitectureText(description, Math.floor(columnWidth / 7.4));
    body.push(lineText(lines, x, y, 13, `#${connectionStyle(connection.edge.kind).color}`));
    rowHeight = Math.max(rowHeight, lines.length * 18 + 9);
    if (index % 2 === 1 || index === graph.connections.length - 1) { y += rowHeight; rowHeight = 0; }
  });
  y += 16;
  }
  const legend = graph.highLevel
    ? DIAGRAM_LEGEND.filter(style => graph.connections.some(connection => connectionStyle(connection.edge.kind).kind === style.kind))
    : DIAGRAM_LEGEND;
  for (const [index, style] of legend.entries()) {
    const x = 34 + index * ((width - 68) / legend.length);
    body.push(`<line x1="${x}" x2="${x + 35}" y1="${y}" y2="${y}" stroke="#${style.color}" stroke-width="2.3"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} marker-end="url(#arrow-${style.kind})"/>`);
    body.push(lineText([style.label], x + 45, y + 4, 12, "#405B72"));
  }
  y += 45;
  if (!graph.highLevel) {
  const notes = [
    { title: "Identity & authorization", items: [...view.controls.identity, ...view.controls.security] },
    { title: "Readiness & operations", items: [...view.controls.readiness, ...view.controls.operations] },
    { title: "Deployment posture", items: view.controls.network }
  ];
  const noteWidth = (width - 104) / 3;
  let maxNoteHeight = 0;
  for (const [index, note] of notes.entries()) {
    const x = 34 + index * (noteWidth + 18);
    let noteY = y + 25;
    const parts = [lineText([note.title], x + 14, noteY, 16, "#264964", true)];
    noteY += 29;
    if (!note.items.length) {
      parts.push(lineText(["No separate control selected"], x + 14, noteY, 13, "#526B80"));
      noteY += 24;
    }
    for (const item of note.items) {
      const lines = wrapArchitectureText(`${item.label}${item.required ? "" : " (recommended)"}`, Math.floor((noteWidth - 28) / 7.3));
      parts.push(lineText(lines, x + 14, noteY, 13, "#334F67"));
      noteY += lines.length * 18 + 7;
    }
    const height = noteY - y + 8;
    maxNoteHeight = Math.max(maxNoteHeight, height);
    body.push(`<rect x="${x}" y="${y}" width="${noteWidth}" height="${height}" rx="3" fill="#F7F9FC" stroke="#D4DFE9"/>${parts.join("")}`);
  }
  y += maxNoteHeight + 28;
  for (const node of graph.nodes.filter(item => item.node.controls.length)) {
    const lines = wrapArchitectureText(`${node.node.label} — source boundary: ${node.node.controls.join("; ")}`, Math.floor((width - 68) / 7.1));
    body.push(lineText(lines, 34, y, 13, "#345B50"));
    y += lines.length * 18 + 9;
  }
  if (view.decisions.length) {
    y += 14;
    body.push(lineText(["Open decisions / validation conditions"], 34, y, 17, "#795711", true));
    y += 26;
    for (const decision of view.decisions) {
      const lines = wrapArchitectureText(decision, Math.floor((width - 68) / 7.1));
      body.push(lineText(lines, 34, y, 13, "#725A2D"));
      y += lines.length * 18 + 7;
    }
  }
  }
  body.push(lineText([graph.highLevel
    ? "High-level integration • Detailed controls, sizing and validation conditions remain in the Technical view."
    : "Architecture Pathfinder • connected diagnostic view • Logical design, not a verified deployment"], 34, y + 24, 12, "#526B80"));
  const markers = DIAGRAM_LEGEND.map(style => `<marker id="arrow-${style.kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#${style.color}"/></marker>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y + 43}" viewBox="0 0 ${width} ${y + 43}" role="img" aria-label="Connected layered architecture"><defs>${markers}</defs><rect width="100%" height="100%" fill="#FFFFFF"/>${body.join("")}</svg>`;
}

export function buildArchitectureSvg(decision: ArchitectureDecision, input?: DecisionInput, icons?: Map<string, string | null>) {
  return renderArchitectureViewSvg(buildArchitectureView(decision, input), icons);
}
