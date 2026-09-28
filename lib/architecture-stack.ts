import type { ArchitectureLayout, DiagramBox, DiagramConnection, DiagramGroup, DiagramNode } from "./architecture-layout";

type Point = { x: number; y: number };
class RouteUnavailable extends Error {}
const LAYERS = [
  { id: "experience", title: "Experience", subtitle: "User channels and approved entry points", layers: ["channels", "edge"] },
  { id: "cross-cutting", title: "Identity & access", subtitle: "Cross-cutting controls", layers: ["identity", "security", "operations", "network"] },
  { id: "application", title: "Application & orchestration", subtitle: "Workload runtime and service integration", layers: ["runtime", "interfaces"] },
  { id: "intelligence", title: "AI & grounding", subtitle: "Models and authorized retrieval", layers: ["models", "grounding"] },
  { id: "data", title: "Data & preparation", subtitle: "Sources and background preparation", layers: ["data", "preparation"] }
];
const CROSS_CUTTING = ["identity", "security", "operations", "network"];
const inflate = (box: DiagramBox, padding: number): DiagramBox => ({
  x: box.x - padding, y: box.y - padding, width: box.width + 2 * padding, height: box.height + 2 * padding
});
const intersects = (a: DiagramBox, b: DiagramBox) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const center = (box: DiagramBox): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const simplify = (points: Point[]) => points.filter((point, index) => {
  const previous = points[index - 1], next = points[index + 1];
  return !previous || !next || !(
    previous.x === point.x && point.x === next.x || previous.y === point.y && point.y === next.y
  );
});

function clearSegment(a: Point, b: Point, obstacles: DiagramBox[]) {
  return !obstacles.some(box => a.x === b.x
    ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width);
}

function orthogonalRoute(start: Point, end: Point, obstacles: DiagramBox[], xs: number[], ys: number[]): Point[] {
  const xValues = [...new Set([...xs, start.x, end.x])].sort((a, b) => a - b);
  const yValues = [...new Set([...ys, start.y, end.y])].sort((a, b) => a - b);
  const columns = xValues.length;
  const id = (point: Point) => yValues.indexOf(point.y) * columns + xValues.indexOf(point.x);
  const point = (index: number): Point => ({ x: xValues[index % columns], y: yValues[Math.floor(index / columns)] });
  const first = id(start), last = id(end);
  const open = new Set([first]);
  const cost = new Map([[first, 0]]);
  const previous = new Map<number, number>();
  const visited = new Set<number>();
  while (open.size) {
    let current = first, best = Infinity;
    for (const candidate of open) {
      const score = cost.get(candidate)! + distance(point(candidate), end);
      if (score < best) { best = score; current = candidate; }
    }
    if (current === last) {
      const route = [end];
      while (current !== first) { current = previous.get(current)!; route.push(point(current)); }
      return simplify(route.reverse());
    }
    open.delete(current);
    visited.add(current);
    const at = point(current), column = current % columns, row = Math.floor(current / columns);
    const neighbors = [
      ...(column ? [current - 1] : []), ...(column < columns - 1 ? [current + 1] : []),
      ...(row ? [current - columns] : []), ...(row < yValues.length - 1 ? [current + columns] : [])
    ];
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      const nextPoint = point(next);
      if (!clearSegment(at, nextPoint, obstacles)) continue;
      const preceding = previous.get(current);
      const turn = preceding === undefined ? 0 : (() => {
        const before = point(preceding);
        return (before.x === at.x) !== (at.x === nextPoint.x) ? 14 : 0;
      })();
      const nextCost = cost.get(current)! + distance(at, nextPoint) + turn;
      if (nextCost >= (cost.get(next) ?? Infinity)) continue;
      cost.set(next, nextCost);
      previous.set(next, current);
      open.add(next);
    }
  }
  throw new RouteUnavailable("A connection could not be routed between the stacked architecture layers.");
}

function labelAlongRoute(points: Point[], width: number, height: number, obstacles: DiagramBox[], bounds: DiagramBox) {
  const segments = points.slice(1).map((end, index) => ({ start: points[index], end }))
    .sort((a, b) => Number(b.start.y === b.end.y) - Number(a.start.y === a.end.y) ||
      distance(b.start, b.end) - distance(a.start, a.end));
  for (const { start, end } of segments) {
    for (const fraction of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const x = start.x + (end.x - start.x) * fraction;
      const y = start.y + (end.y - start.y) * fraction;
      const candidates = start.y === end.y
        ? [{ x: x - width / 2, y: y - height / 2, width, height }]
        : [{ x: x + 12, y: y - height / 2, width, height }, { x: x - width - 12, y: y - height / 2, width, height }];
      for (const box of candidates) {
        if (box.x < 8 || box.y < 8 || box.x + width > bounds.width - 8 || box.y + height > bounds.height - 8) continue;
        if (!obstacles.some(obstacle => intersects(inflate(box, 5), obstacle))) return box;
      }
    }
  }
  return undefined;
}

function placeNearbyLabel(
  points: Point[], width: number, height: number,
  obstacles: DiagramBox[], bounds: DiagramBox, xs: number[], ys: number[]
) {
  const nearestPoint = (target: Point) => points.slice(1).map((end, index) => {
    const start = points[index];
    return start.x === end.x
      ? { x: start.x, y: Math.max(Math.min(start.y, end.y), Math.min(Math.max(start.y, end.y), target.y)) }
      : { x: Math.max(Math.min(start.x, end.x), Math.min(Math.max(start.x, end.x), target.x)), y: start.y };
  }).sort((a, b) => distance(a, target) - distance(b, target))[0];
  const labelXs = [...new Set([...xs, ...Array.from({ length: Math.floor(bounds.width / 40) }, (_, index) => 20 + index * 40)])];
  const labelYs = [...new Set([...ys, ...Array.from({ length: Math.floor(bounds.height / 24) }, (_, index) => 12 + index * 24)])];
  const candidates = labelXs.flatMap(x => labelYs.map(y => ({ x: x - width / 2, y: y - height / 2, width, height })))
    .filter(box => box.x > 8 && box.y > 8 && box.x + width < bounds.width - 8 && box.y + height < bounds.height - 8 &&
      !obstacles.some(obstacle => intersects(inflate(box, 5), obstacle)))
    .sort((a, b) => distance(nearestPoint(center(a)), center(a)) - distance(nearestPoint(center(b)), center(b)));
  for (const labelBox of candidates.slice(0, 192)) {
    const target = center(labelBox), start = nearestPoint(target);
    for (const corner of [{ x: start.x, y: target.y }, { x: target.x, y: start.y }]) {
      if (clearSegment(start, corner, obstacles) && clearSegment(corner, target, obstacles)) {
        return { labelBox, labelLeader: simplify([start, corner, target]) };
      }
    }
  }
  throw new Error("The stacked architecture has no readable connection-label position.");
}

export function createStackedTemplate(base: ArchitectureLayout): ArchitectureLayout {
  const groups: DiagramGroup[] = [];
  const nodes: DiagramNode[] = [];
  const activeLayers = LAYERS.map(layer => ({
    ...layer, nodes: base.nodes.filter(item => layer.layers.includes(item.node.layer))
  })).filter(layer => layer.nodes.length);
  const assigned = activeLayers.reduce((count, layer) => count + layer.nodes.length, 0);
  if (assigned !== base.nodes.length) throw new Error("An AI component has no reference-architecture presentation layer.");
  const mainX = 36, mainWidth = 1128, labelRailWidth = 238;
  const contentX = mainX + labelRailWidth + 30;
  const cellWidth = (mainWidth - labelRailWidth - 60) / 3;
  let y = 24;
  for (const layer of activeLayers) {
    const firstY = y;
    for (let index = 0; index < layer.nodes.length; index += 3) {
      const row = layer.nodes.slice(index, index + 3);
      const controls = layer.id === "cross-cutting";
      const rowHeight = Math.max(...row.map(node => node.height)) +
        (controls ? row.length > 1 ? 132 : 44 : layer.nodes.length > 3 ? 224 : 88);
      row.forEach((item, column) => {
        const shift = controls ? 3 - row.length : (3 - row.length) / 2;
        const cx = contentX + cellWidth * (column + shift + 0.5);
        nodes.push({ ...item, x: cx - item.width / 2, y: y + (rowHeight - item.height) / 2 });
      });
      y += rowHeight;
    }
    groups.push({ id: layer.id, title: layer.title, subtitle: layer.subtitle, fill: "FFFFFF",
      x: mainX, y: firstY, width: mainWidth, height: y - firstY, labelRailWidth });
  }
  return { ...base, title: "Layered reference architecture", layoutStyle: "stacked",
    width: 1200, height: y + 24, groups, nodes, connections: [] };
}

export function stackArchitecture(base: ArchitectureLayout): ArchitectureLayout {
  const template = createStackedTemplate(base);
  const { groups, nodes, width, height } = template;
  const bounds = { x: 0, y: 0, width, height };
  const nodeById = new Map(nodes.map(node => [node.node.id, node]));
  const titleBoxes = groups.map(group => ({ x: group.x, y: group.y, width: group.labelRailWidth!, height: group.height }));
  const obstacles = [...nodes.map(node => inflate(node, 12)), ...titleBoxes];
  const labelObstacles = [...nodes.map(node => inflate(node, 8)), ...titleBoxes];
  const xs = [
    288, 302, 1168, 1180, ...nodes.flatMap(node => [node.x - 24, node.x + node.width + 24, center(node).x])
  ].filter(value => value > 0 && value < width);
  const rows = [...new Set(nodes.map(node => center(node).y))].sort((a, b) => a - b).map(row => {
    const items = nodes.filter(node => center(node).y === row);
    return { top: Math.min(...items.map(node => node.y)), bottom: Math.max(...items.map(node => node.y + node.height)) };
  });
  const gapCenters = rows.slice(1).map((row, index) => (rows[index].bottom + row.top) / 2);
  const ys = [12, height - 12, ...gapCenters, ...groups.flatMap(group => [group.y + 12, group.y + group.height - 12, group.y + group.height]),
    ...nodes.flatMap(node => [node.y - 24, node.y + node.height + 24, center(node).y])].filter(value => value > 0 && value < height);
  const portCounts = new Map<string, number>();
  const port = (node: DiagramNode, other: DiagramNode) => {
    const source = center(node), target = center(other);
    const control = CROSS_CUTTING.includes(node.node.layer);
    const otherControl = CROSS_CUTTING.includes(other.node.layer);
    const side = control !== otherControl ? (control ? (source.y < target.y ? "bottom" : "top") : "right")
      : Math.abs(source.y - target.y) < 4 ? (source.x < target.x ? "right" : "left")
      : source.y < target.y ? "bottom" : "top";
    const key = `${node.node.id}:${side}`;
    const used = portCounts.get(key) ?? 0;
    portCounts.set(key, used + 1);
    const axis = side === "top" || side === "bottom" ? node.width : node.height;
    const offset = Math.min(used * 14, axis / 2 - 16) * (used % 2 ? -1 : 1);
    const anchor: Point = side === "left" ? { x: node.x, y: source.y + offset }
      : side === "right" ? { x: node.x + node.width, y: source.y + offset }
      : side === "top" ? { x: source.x + offset, y: node.y }
      : { x: source.x + offset, y: node.y + node.height };
    const outside = { x: anchor.x + (side === "left" ? -18 : side === "right" ? 18 : 0),
      y: anchor.y + (side === "top" ? -18 : side === "bottom" ? 18 : 0) };
    return { anchor, outside };
  };
  const connections: DiagramConnection[] = [];
  for (const connection of base.connections) {
    const source = nodeById.get(connection.edge.from), target = nodeById.get(connection.edge.to);
    if (!source || !target) throw new Error("A stacked integration relationship references a missing component.");
    const from = port(source, target), to = port(target, source);
    let route: Point[];
    try { route = orthogonalRoute(from.outside, to.outside, obstacles, xs, ys); }
    catch (cause) { throw new Error(`Cannot route ${source.node.id} to ${target.node.id} in the stacked architecture.`, { cause }); }
    const points = simplify([from.anchor, ...route, to.anchor]);
    let labelBox = labelAlongRoute(points, connection.labelBox.width, connection.labelBox.height, labelObstacles, bounds);
    let labelLeader: Point[] | undefined;
    if (!labelBox) {
      const labelled = placeNearbyLabel(points, connection.labelBox.width, connection.labelBox.height, labelObstacles, bounds, xs, ys);
      labelBox = labelled.labelBox;
      labelLeader = labelled.labelLeader;
    }
    labelObstacles.push(inflate(labelBox, 5));
    connections.push({ ...connection, points, labelBox, labelLeader, labelPoint: center(labelBox) });
  }
  return { ...template, connections };
}
