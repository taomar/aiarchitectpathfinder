import assert from "node:assert/strict";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { buildArchitectureView } from "../../lib/architecture-view";
import { availableDiagramFocuses, buildArchitectureLayout, type DiagramBox } from "../../lib/architecture-layout";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";

function overlaps(a: DiagramBox, b: DiagramBox) {
  return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
}

let diagrams = 0;
let edges = 0;
for (const example of EXAMPLES) {
  const view = buildArchitectureView(decide(example.input), example.input);
  for (const focus of availableDiagramFocuses(view)) {
    const graph = buildArchitectureLayout(view, focus);
    assert.deepEqual(graph, buildArchitectureLayout(view, focus), "Layout must be deterministic.");
    const ids = new Set(graph.nodes.map(item => item.node.id));
    for (const [index, placed] of graph.nodes.entries()) {
      assert.ok(placed.x >= 0 && placed.y >= 0 && placed.x + placed.width <= graph.width + 1 && placed.y + placed.height <= graph.height + 1, example.id);
      for (const other of graph.nodes.slice(index + 1)) assert.equal(overlaps(placed, other), false, `${example.id}/${focus}: overlapping nodes ${placed.node.id} and ${other.node.id}`);
    }
    for (const connection of graph.connections) {
      assert.ok(ids.has(connection.edge.from) && ids.has(connection.edge.to));
      assert.ok(connection.points.length >= 2);
      assert.ok(connection.points.every(point => Number.isFinite(point.x + point.y)));
      assert.ok(graph.nodes.every(node => !overlaps({
        x: connection.labelPoint.x - 9, y: connection.labelPoint.y - 9, width: 18, height: 18
      }, node)), `${example.id}/${focus}: connection reference overlaps a service`);
    }
    if (focus === "overview") {
      for (const edge of view.edges) assert.ok(graph.connections.some(connection =>
        connection.edge.from === edge.from && connection.edge.to === edge.to && connection.edge.kind === edge.kind
      ), "Every model relationship must be drawn, not listed only as text.");
      assert.deepEqual(graph.nodes.filter(node => !node.annotation).map(node => node.node.id).sort(), view.layers.flatMap(layer => layer.nodes.map(node => node.id)).sort());
    }
    const svg = renderArchitectureViewSvg(view, new Map(), focus);
    assert.equal((svg.match(/data-connection-id=/g) ?? []).length, graph.connections.length);
    assert.equal((svg.match(/<polyline /g) ?? []).length, graph.connections.length);
    assert.equal((svg.match(/marker-end="url\(#arrow-/g) ?? []).length, graph.connections.length + 5);
    assert.doesNotMatch(svg, /NaN|undefined/);
    diagrams++;
    edges += graph.connections.length;
  }
  console.log(`PASS connected diagrams: ${example.id}`);
}
console.log(`Verified ${diagrams} deterministic diagrams and ${edges} drawn directional connections.`);
