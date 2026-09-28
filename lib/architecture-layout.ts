import { graphlib, layout, type GraphLabel, type NodeLabel, type EdgeLabel, type Point } from "@dagrejs/dagre";
import type { ArchitectureView, ViewEdge, ViewNode } from "./architecture-view";
import { stackArchitecture } from "./architecture-stack";

export type DiagramFocus = "overview" | "request" | "models" | "data" | "preparation";
export type DiagramBox = { x: number; y: number; width: number; height: number };
export type DiagramNode = DiagramBox & { node: ViewNode; annotation: boolean; compact?: boolean; reference?: boolean; labelLines: string[]; caption: string; glyph: "person" | "phone" | "window" | "api" | "code" | "pipeline" | "service" };
export type DiagramEdge = Omit<ViewEdge, "kind"> & { kind: ViewEdge["kind"] | "policy" };
export type DiagramGroup = DiagramBox & { id: string; title: string; subtitle: string; fill: string; labelRailWidth?: number };
export type DiagramConnection = {
  id: string;
  number: number;
  edge: DiagramEdge;
  points: Point[];
  labelPoint: Point;
  shortLabel: string;
  labelLines: string[];
  labelBox: DiagramBox;
  labelLeader?: Point[];
};
export type ArchitectureLayout = {
  version: 3;
  highLevel: boolean;
  layoutStyle: "graph" | "stacked";
  focus: DiagramFocus;
  title: string;
  width: number;
  height: number;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  connections: DiagramConnection[];
};

const GROUPS = [
  { id: "client", title: "User experience", subtitle: "Client boundary", layers: ["channels"], fill: "F8FAFC" },
  { id: "edge", title: "Entry & API governance", subtitle: "Approved ingress", layers: ["edge"], fill: "F2F7FD" },
  { id: "app", title: "Application & orchestration", subtitle: "Logical workload boundary", layers: ["runtime", "interfaces"], fill: "EFF6FC" },
  { id: "ai", title: "Model & grounding services", subtitle: "Service dependencies", layers: ["models", "grounding"], fill: "F5F2FB" },
  { id: "source", title: "Authoritative sources", subtitle: "Source-owned access boundary", layers: ["data"], fill: "F0F8F5" },
  { id: "prepare", title: "Background preparation", subtitle: "Separate ingestion identity", layers: ["preparation"], fill: "F7F7F9" },
  { id: "ai-controls", title: "Identity, security & operations", subtitle: "AI-authored control dependencies", layers: ["identity", "security", "operations"], fill: "F4F8F4" },
  { id: "network", title: "Network dependencies", subtitle: "AI-authored network components", layers: ["network"], fill: "F3F6FA" }
];

const HIGH_LEVEL_GROUPS = [
  { id: "experience", title: "Experience / entry layer", subtitle: "Logical layer boundary", layers: ["channels", "edge"], fill: "F3F7FB" },
  { id: "application-ai", title: "Application / AI layer", subtitle: "Logical layer boundary", layers: ["runtime", "interfaces", "models", "grounding"], fill: "EDF5FC" },
  { id: "sources", title: "Data / source layer", subtitle: "Source-owned access boundary", layers: ["data", "preparation"], fill: "F0F8F5" },
  { id: "governance", title: "Identity / governance layer", subtitle: "Cross-cutting logical boundary", layers: ["identity", "security", "operations", "network"], fill: "F4F5FA" }
];
const PROVIDER_NAMES = { azure: "Azure", "microsoft-saas": "Microsoft SaaS", external: "External", logical: "Logical" };
const SYMBOLS: Record<NonNullable<ViewNode["symbol"]>, DiagramNode["glyph"]> = {
  person: "person", app: "window", api: "api", workflow: "pipeline", generic: "service"
};

export const DIAGRAM_LEGEND = [
  { kind: "request", color: "156DAF", dash: "", label: "Request / authorized query" },
  { kind: "preparation", color: "6D519B", dash: "8 5", label: "Background preparation" },
  { kind: "contains", color: "61758A", dash: "2 5", label: "Hosting / dependency" },
  { kind: "policy", color: "527462", dash: "3 4", label: "Identity / operational control" },
  { kind: "conditional", color: "A46B10", dash: "9 5", label: "Proposed — confirm first" }
] as const;

export function connectionStyle(kind: DiagramEdge["kind"]) {
  return DIAGRAM_LEGEND.find(item => item.kind === kind) ?? DIAGRAM_LEGEND[0];
}

export function wrapDiagramLabel(value: string, max = 24) {
  const words = value.trim().split(/\s+/).flatMap(word => {
    const letters = Array.from(word);
    return Array.from({ length: Math.ceil(letters.length / max) }, (_, index) => letters.slice(index * max, (index + 1) * max).join(""));
  });
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > max) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}

function shortLabel(edge: DiagramEdge) {
  const labels: Record<string, string> = {
    "approved entry": "Request",
    "gateway policy": "API / edge policy",
    "delegated execution": "Invoke agent",
    "hosting / coordination": "Coordinate",
    "inference with approved context": "Inference",
    "platform hosts deployment": "Hosts deployment",
    "confirm model endpoint": "Confirm endpoint",
    "authorized operation": "Authorized tool call",
    "source permissions": "Source-authorized access",
    "permission-filtered retrieval": "Scoped retrieval",
    "authorized background read": "Read source content",
    "populate derived index": "Populate index",
    "managed retrieval": "Native retrieval",
    "design not yet confirmed": "Confirm retrieval design",
    "confirm governed retrieval": "Confirm access",
    "governed analytics": "Analytics query",
    "source role / permissions to confirm": "Confirm source role",
    "source-scoped analytics permissions": "Source-scoped query",
    "governed Fabric interface": "Approved Fabric access",
    "approved source operation": "Scoped operation",
    "confirm responsibility and connection": "Confirm connection"
  };
  return labels[edge.label] ?? edge.label;
}

function focusEdges(view: ArchitectureView, focus: DiagramFocus) {
  const nodes = new Map(view.layers.flatMap(layer => layer.nodes).map(node => [node.id, node]));
  if (focus === "overview") return view.edges;
  return view.edges.filter(edge => {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    if (focus === "preparation") return edge.kind === "preparation";
    if (focus === "request") return [from.layer, to.layer].every(layer => ["channels", "edge", "runtime", "identity", "security"].includes(layer));
    if (focus === "models") return to.layer === "models" || from.layer === "models";
    return edge.kind !== "preparation" && (
      ["grounding", "interfaces", "data"].includes(from.layer) ||
      ["grounding", "interfaces", "data"].includes(to.layer)
    );
  });
}

export function availableDiagramFocuses(view: ArchitectureView): DiagramFocus[] {
  return (["overview", "request", "models", "data", "preparation"] as const).filter(focus => focus === "overview" || focusEdges(view, focus).length > 0);
}

export function diagramFocusTitle(focus: DiagramFocus) {
  return {
    overview: "High-level component integration",
    request: "Entry & orchestration",
    models: "Model inference & hosting",
    data: "Grounding & source access",
    preparation: "Background ingestion & indexing"
  }[focus];
}

function createArchitectureLayout(view: ArchitectureView, focus: DiagramFocus, direction: "LR" | "TB"): ArchitectureLayout {
  const highLevel = view.authority === "ai";
  const isAudience = (node: ViewNode) => node.layer === "channels" && !node.icon &&
    view.audience.some(audience => audience.trim().toLowerCase() === node.label.trim().toLowerCase());
  const edges: DiagramEdge[] = [...focusEdges(view, focus)];
  const connectedIds = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const nodes = view.layers.flatMap(layer => layer.nodes)
    .filter(node => focus === "overview" || connectedIds.has(node.id));
  const annotations = new Set<string>();
  const addAnnotation = (id: string, label: string, icon: string, detail: string, target: string, edgeLabel: string, required: boolean) => {
    annotations.add(id);
    nodes.push({ id, label, icon, detail, layer: "runtime", kind: "capability", state: "selected", required, sourceLabels: [detail], controls: [] });
    edges.push({ from: target, to: id, label: edgeLabel, kind: required ? "policy" : "conditional" });
  };
  const entry = ["custom-backend", "copilot-studio", "foundry-agent", "m365-copilot"].find(id => nodes.some(node => node.id === id));
  if (view.authority !== "ai" && (focus === "overview" || focus === "request") && entry) {
    const providers = new Map<string, (typeof view.controls.identity)[number]>();
    for (const identity of view.controls.identity.filter(item => /entra/i.test(item.label))) {
      const key = /external/i.test(identity.label) ? "external" : "workforce";
      const existing = providers.get(key);
      providers.set(key, { ...identity, required: identity.required || !!existing?.required });
    }
    for (const [key, identity] of providers) {
      addAnnotation(`control-identity-${key}`, key === "external" ? "Microsoft Entra External ID" : "Microsoft Entra ID",
        key === "external" ? "/ms-icons/azure/external-identities.svg" : "/ms-icons/entra/entra-id.svg",
        identity.scope, entry, "Identity / token-validation dependency", identity.required);
    }
  }
  if (view.authority !== "ai" && focus === "overview" && entry) {
    const insights = view.controls.operations.find(item => /application insights/i.test(item.label));
    if (insights) {
      annotations.add("control-telemetry");
      nodes.push({ id: "control-telemetry", label: "Application Insights", icon: "/ms-icons/azure/application-insights.svg", detail: insights.scope,
        layer: "runtime", kind: "component", state: "selected", required: insights.required, sourceLabels: [insights.label], controls: [] });
      edges.push({ from: entry, to: "control-telemetry", label: "Application telemetry", kind: insights.required ? "policy" : "conditional" });
    }
  }
  const compound = focus === "overview";
  const graph = new graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ compound, multigraph: true })
    .setGraph({ rankdir: direction, ranksep: compound ? 56 : 74, nodesep: 34, edgesep: 14, marginx: 24, marginy: 30, ranker: "network-simplex" })
    .setDefaultEdgeLabel(() => ({}));
  const groupByLayer = new Map<string, string>();
  const groups = compound ? (highLevel ? HIGH_LEVEL_GROUPS : GROUPS)
    .filter(group => nodes.some(node => !annotations.has(node.id) && group.layers.includes(node.layer))) : [];
  if (compound && annotations.size) groups.push({ id: "controls", title: "Identity & operations", subtitle: "Control-plane dependencies", layers: [], fill: "F4F8F4" });
  for (const group of groups) {
    graph.setNode(`group-${group.id}`, { width: 0, height: 0, label: group.title });
    group.layers.forEach(layer => groupByLayer.set(layer, group.id));
  }
  const labels = new Map<string, string[]>();
  for (const node of nodes) {
    const lines = wrapDiagramLabel(node.label);
    labels.set(node.id, lines);
    graph.setNode(node.id, {
      width: Math.max(highLevel ? 200 : 184, Math.max(...lines.map(line => line.length)) * (highLevel ? 9 : 8.3) + 28),
      height: highLevel ? 108 + lines.length * 25 : 92 + lines.length * 21
    });
    if (compound) {
      const groupId = annotations.has(node.id) ? "controls" : groupByLayer.get(node.layer);
      if (!groupId) throw new Error(`No presentation layer exists for ${node.layer}.`);
      graph.setParent(node.id, `group-${groupId}`);
    }
  }
  const mainEdges = [...edges].sort((a, b) =>
    Number(a.kind === "preparation") - Number(b.kind === "preparation") ||
    `${a.from}|${a.to}|${a.label}`.localeCompare(`${b.from}|${b.to}|${b.label}`));
  mainEdges.forEach((edge, index) => {
    const labelLines = wrapDiagramLabel(edge.label, 24);
    graph.setEdge(edge.from, edge.to, {
      width: highLevel ? Math.max(70, ...labelLines.map(line => line.length * 7.6 + 20)) : 30,
      height: highLevel ? labelLines.length * 20 + 10 : 24,
      labelpos: "c", minlen: 1,
      weight: edge.kind === "request" ? 4 : edge.kind === "query" ? 3 : 1
    }, `connection-${index}`);
  });
  if (nodes.length) layout(graph);
  const bounds = graph.graph();
  const box = (id: string): DiagramBox => {
    const node = graph.node(id);
    if (node.x === undefined || node.y === undefined || !Number.isFinite(node.x + node.y + node.width + node.height)) {
      throw new Error(`Architecture layout has no valid position for ${id}.`);
    }
    return { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height };
  };
  const orderedEdges: Array<{ edge: DiagramEdge; index: number }> = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<number>();
  const priority: Record<DiagramEdge["kind"], number> = { request: 0, query: 1, policy: 2, contains: 3, preparation: 4, conditional: 5 };
  const traverse = (start: string) => {
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      if (seenNodes.has(current)) continue;
      seenNodes.add(current);
      mainEdges.map((edge, index) => ({ edge, index }))
        .filter(item => item.edge.from === current && !seenEdges.has(item.index))
        .sort((a, b) => priority[a.edge.kind] - priority[b.edge.kind] || a.edge.to.localeCompare(b.edge.to))
        .forEach(item => { seenEdges.add(item.index); orderedEdges.push(item); queue.push(item.edge.to); });
    }
  };
  nodes.filter(node => node.layer === "channels").forEach(node => traverse(node.id));
  nodes.filter(node => !mainEdges.some(edge => edge.to === node.id)).forEach(node => traverse(node.id));
  nodes.forEach(node => traverse(node.id));
  return {
    version: 3, highLevel, layoutStyle: "graph", focus, title: diagramFocusTitle(focus),
    width: Math.max(compound ? 640 : 400, bounds.width ?? 0), height: Math.max(compound ? 280 : 220, (bounds.height ?? 0) + 22),
    groups: groups.map(group => ({ ...box(`group-${group.id}`), id: group.id, title: group.title, subtitle: group.subtitle, fill: group.fill })),
    nodes: nodes.map(node => ({
      ...box(node.id), node, annotation: annotations.has(node.id), labelLines: labels.get(node.id)!,
      glyph: node.symbol ? SYMBOLS[node.symbol] : highLevel ? "service" : isAudience(node) ? "person" : node.id === "mobile" ? "phone" : node.id === "web" ? "window" :
        node.id === "custom-backend" ? "code" : node.layer === "interfaces" || node.id === "business-api" || node.id === "api-channel" ? "api" :
          node.layer === "preparation" ? "pipeline" : "service",
      caption: isAudience(node) ? "User / actor" : highLevel && node.provider
        ? `${PROVIDER_NAMES[node.provider]} · ${node.state === "confirm" ? "confirm" : !node.required ? "optional" : node.state === "managed" ? "managed" : "proposed"}`
        : annotations.has(node.id) ? node.required ? "Selected control dependency" : "Recommended control dependency" : node.state === "confirm" ? "Confirm before implementation" : !node.required ? "Optional capability" : node.state === "managed" ? "Microsoft-managed" :
        node.kind === "source" ? "Source permissions apply" : node.kind === "platform" ? "Hosting / governance platform" :
        node.kind === "capability" ? "Logical capability" : "Proposed component"
    })),
    connections: orderedEdges.map(({ edge, index }, displayIndex) => {
      const result = graph.edge({ v: edge.from, w: edge.to, name: `connection-${index}` });
      if (!result.points || result.points.length < 2 || result.x === undefined || result.y === undefined ||
          result.width === undefined || result.height === undefined) {
        throw new Error(`Architecture layout could not route ${edge.from} to ${edge.to}.`);
      }
      return {
        id: `connection-${displayIndex + 1}`, number: displayIndex + 1, edge, points: result.points,
        labelPoint: { x: result.x, y: result.y },
        shortLabel: highLevel ? edge.label : shortLabel(edge),
        labelLines: highLevel ? wrapDiagramLabel(edge.label, 24) : [String(displayIndex + 1)],
        labelBox: { x: result.x - result.width / 2, y: result.y - result.height / 2, width: result.width, height: result.height }
      };
    })
  };
}

export function buildArchitectureLayout(view: ArchitectureView, focus: DiagramFocus = "overview"): ArchitectureLayout {
  if (view.authority === "ai" && focus === "overview") {
    const nodes = view.layers.flatMap(layer => layer.nodes).map(node => {
      const labelLines = wrapDiagramLabel(node.label, 24);
      const controls = ["identity", "security", "operations", "network"].includes(node.layer);
      const pending = node.state === "confirm" || !node.required;
      return {
        node, x: 0, y: 0, width: controls ? 246 : Math.max(110, ...labelLines.map(line => line.length * 9 + 16)),
        height: controls ? Math.max(52, labelLines.length * 23 + 14) : 58 + labelLines.length * 24 + (pending ? 18 : 0),
        annotation: false, reference: true, compact: controls, labelLines, glyph: node.symbol ? SYMBOLS[node.symbol] : "service" as const,
        caption: pending ? node.state === "confirm" ? "Implementation to confirm" : "Optional" : ""
      };
    });
    const connections = view.edges.map((edge, index) => {
      const labelLines = wrapDiagramLabel(edge.label, 26);
      return {
        id: `connection-${index + 1}`, number: index + 1, edge, points: [],
        labelPoint: { x: 0, y: 0 }, shortLabel: edge.label, labelLines,
        labelBox: { x: 0, y: 0, width: Math.max(64, ...labelLines.map(line => line.length * 7.4 + 18)), height: labelLines.length * 20 + 8 }
      };
    });
    return stackArchitecture({ version: 3, highLevel: true, layoutStyle: "stacked", focus, title: "Layered reference architecture", width: 0, height: 0, groups: [], nodes, connections });
  }
  const horizontal = createArchitectureLayout(view, focus, "LR");
  if (focus === "overview") return horizontal;
  const vertical = createArchitectureLayout(view, focus, "TB");
  const fit = (graph: ArchitectureLayout) => Math.min(12.04 / graph.width, 4.18 / graph.height);
  return fit(vertical) > fit(horizontal) ? vertical : horizontal;
}
