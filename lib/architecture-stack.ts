import type { ArchitectureLayout, DiagramBox, DiagramConnection, DiagramGroup, DiagramNode } from "./architecture-layout";

type Point = { x: number; y: number };
class RouteUnavailable extends Error {}
const LAYERS = [
  { id: "experience", title: "Experience & access", subtitle: "User channels and approved entry points", layers: ["channels", "edge"], fill: "F3F7FC" },
  { id: "application", title: "Application & orchestration", subtitle: "Workload runtime and service integration", layers: ["runtime", "interfaces"], fill: "EDF5FC" },
  { id: "intelligence", title: "AI & grounding", subtitle: "Models, agents and authorized retrieval", layers: ["models", "grounding"], fill: "F4F2FA" },
  { id: "data", title: "Data & knowledge", subtitle: "Authoritative sources and source-owned permissions", layers: ["data"], fill: "EFF8F4" },
  { id: "preparation", title: "Content preparation", subtitle: "Background ingestion, separate from the user journey", layers: ["preparation"], fill: "F5F7F9" }
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

function routeThroughLabel(
  start: Point, end: Point, width: number, height: number,
  routeObstacles: DiagramBox[], labelObstacles: DiagramBox[], bounds: DiagramBox, xs: number[], ys: number[]
) {
  const candidates = xs.flatMap(x => ys.map(y => ({ x: x - width / 2, y: y - height / 2, width, height })))
    .filter(box => box.x > 8 && box.y > 8 && box.x + width < bounds.width - 8 && box.y + height < bounds.height - 8 &&
      !labelObstacles.some(obstacle => intersects(inflate(box, 6), obstacle)))
    .sort((a, b) => distance(start, center(a)) + distance(center(a), end) - distance(start, center(b)) - distance(center(b), end));
  for (const labelBox of candidates.slice(0, 48)) {
    const left = { x: labelBox.x - 12, y: center(labelBox).y };
    const right = { x: labelBox.x + width + 12, y: center(labelBox).y };
    const directions = start.x <= end.x ? [[left, right], [right, left]] : [[right, left], [left, right]];
    for (const [entry, exit] of directions) {
      try {
        const obstacles = [...routeObstacles, inflate(labelBox, 5)];
        const before = orthogonalRoute(start, entry, obstacles, xs, ys);
        const after = orthogonalRoute(exit, end, obstacles, xs, ys);
        return { labelBox, points: simplify([...before, ...after]) };
      } catch (error) {
        if (!(error instanceof RouteUnavailable)) throw error;
      }
    }
  }
  throw new Error("The stacked architecture has no unobstructed connection-label corridor.");
}

export function stackArchitecture(base: ArchitectureLayout): ArchitectureLayout {
  const groups: DiagramGroup[] = [];
  const nodes: DiagramNode[] = [];
  const railNodes = base.nodes.filter(item => CROSS_CUTTING.includes(item.node.layer));
  const activeLayers = LAYERS.map(layer => ({
    ...layer, nodes: base.nodes.filter(item => layer.layers.includes(item.node.layer))
  })).filter(layer => layer.nodes.length);
  const assigned = activeLayers.reduce((count, layer) => count + layer.nodes.length, railNodes.length);
  if (assigned !== base.nodes.length) throw new Error("An AI component has no reference-architecture presentation layer.");
  const cellWidth = Math.max(220, ...base.nodes.map(node => node.width));
  const columns = Math.min(3, Math.max(1, ...activeLayers.map(layer => layer.nodes.length)));
  const gapX = Math.max(180, ...base.connections.map(connection => connection.labelBox.width + 64));
  const mainX = 120;
  const mainWidth = Math.max(820, columns * cellWidth + (columns - 1) * gapX + 64);
  const mainRows: Array<{ top: number; bottom: number }> = [];
  let y = 24;
  for (const layer of activeLayers) {
    const firstY = y;
    let rowY = y + 76;
    for (let index = 0; index < layer.nodes.length; index += 3) {
      const row = layer.nodes.slice(index, index + 3);
      const rowHeight = Math.max(...row.map(node => node.height));
      const rowWidth = row.length * cellWidth + (row.length - 1) * gapX;
      row.forEach((item, column) => nodes.push({
        ...item, x: mainX + (mainWidth - rowWidth) / 2 + column * (cellWidth + gapX) + (cellWidth - item.width) / 2,
        y: rowY + (rowHeight - item.height) / 2
      }));
      mainRows.push({ top: rowY, bottom: rowY + rowHeight });
      rowY += rowHeight + 92;
    }
    const height = rowY - firstY - 60;
    groups.push({ id: layer.id, title: layer.title, subtitle: layer.subtitle, fill: layer.fill, x: mainX, y: firstY, width: mainWidth, height });
    y = firstY + height + 116;
  }
  const railWidth = cellWidth + 48;
  const railHeight = railNodes.reduce((height, item) => height + item.height + 42, 74);
  const totalHeight = Math.max(y - 80, railNodes.length ? railHeight + 48 : 0, 260);
  const railX = mainX + mainWidth + 220;
  if (railNodes.length) {
    const space = Math.max(32, (totalHeight - 92 - railNodes.reduce((height, item) => height + item.height, 0)) / (railNodes.length + 1));
    let railY = 78 + space;
    for (const item of railNodes) {
      nodes.push({ ...item, x: railX + (railWidth - item.width) / 2, y: railY });
      railY += item.height + space;
    }
    groups.push({ id: "cross-cutting", title: "Identity & governance", subtitle: "Cross-cutting services", fill: "F4F5FA",
      x: railX, y: 24, width: railWidth, height: totalHeight - 48 });
  }
  const width = railNodes.length ? railX + railWidth + 64 : mainX + mainWidth + 120;
  const height = totalHeight + 32;
  const bounds = { x: 0, y: 0, width, height };
  const nodeById = new Map(nodes.map(node => [node.node.id, node]));
  const titleBoxes = groups.map(group => ({ x: group.x + 12, y: group.y + 8, width: Math.min(group.width - 24, 370), height: 34 }));
  const obstacles = [...nodes.map(node => inflate(node, 12)), ...titleBoxes];
  const labelObstacles = [...nodes.map(node => inflate(node, 32)), ...titleBoxes];
  const xs = [
    28, 58, 88, mainX + 20, mainX + mainWidth - 20, mainX + mainWidth + 48, mainX + mainWidth + 96,
    railX - 72, railX - 24, width - 28, ...nodes.flatMap(node => [node.x - 24, node.x + node.width + 24, center(node).x])
  ].filter(value => value > 0 && value < width);
  const ys = [12, height - 12, ...mainRows.flatMap(row => [row.top - 26, row.bottom + 26, row.bottom + 56, row.bottom + 86]),
    ...nodes.flatMap(node => [node.y - 24, node.y + node.height + 24, center(node).y])].filter(value => value > 0 && value < height);
  const portCounts = new Map<string, number>();
  const port = (node: DiagramNode, other: DiagramNode) => {
    const source = center(node), target = center(other);
    const control = CROSS_CUTTING.includes(node.node.layer);
    const otherControl = CROSS_CUTTING.includes(other.node.layer);
    const side = control !== otherControl ? (control ? "left" : "bottom")
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
    let points = simplify([from.anchor, ...route, to.anchor]);
    let labelBox = labelAlongRoute(points, connection.labelBox.width, connection.labelBox.height, labelObstacles, bounds);
    if (!labelBox) {
      const labelled = routeThroughLabel(from.outside, to.outside, connection.labelBox.width, connection.labelBox.height, obstacles, labelObstacles, bounds, xs, ys);
      labelBox = labelled.labelBox;
      points = simplify([from.anchor, ...labelled.points, to.anchor]);
    }
    obstacles.push(inflate(labelBox, 5));
    labelObstacles.push(inflate(labelBox, 5));
    xs.push(labelBox.x - 12, labelBox.x + labelBox.width + 12);
    ys.push(labelBox.y - 12, labelBox.y + labelBox.height + 12);
    connections.push({ ...connection, points, labelBox, labelPoint: center(labelBox) });
  }
  return { ...base, title: "Layered reference architecture", layoutStyle: "stacked", width, height, groups, nodes, connections };
}
