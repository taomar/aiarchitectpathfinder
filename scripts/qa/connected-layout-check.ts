import assert from "node:assert/strict";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { buildArchitectureView, type ViewLayerId } from "../../lib/architecture-view";
import { availableDiagramFocuses, buildArchitectureLayout, connectionStyle, type DiagramBox } from "../../lib/architecture-layout";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";
import { recommendationDecision } from "../../lib/recommendation-contract";
import { acceptedFixture } from "./recommendation-fixture";
import { createStackedTemplate } from "../../lib/architecture-stack";

function overlaps(a: DiagramBox, b: DiagramBox) {
  return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
}

let diagrams = 0;
let edges = 0;
const cases = EXAMPLES.map(example => ({ id: example.id, view: buildArchitectureView(decide(example.input), example.input) }));
cases.push({ id: "ai-authored-high-level-integration", view: buildArchitectureView(recommendationDecision(acceptedFixture())) });
for (const layers of [
  Array.from({ length: 12 }, () => "runtime" as const),
  ["channels", "channels", "runtime", "runtime", "models", "grounding", "data", "data", "preparation", "identity", "security", "operations"] satisfies ViewLayerId[]
]) {
  const view = buildArchitectureView(recommendationDecision(acceptedFixture()));
  const template = view.layers.flatMap(layer => layer.nodes)[0];
  const nodes = layers.map((layer, index) => ({
    ...template, id: `component-${index}`, label: `Logical component ${index + 1}`, layer, provider: "logical" as const
  }));
  view.layers = view.layers.map(layer => ({ ...layer, nodes: nodes.filter(node => node.layer === layer.id) }));
  view.edges = [
    ...nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, label: "Authorized request", kind: "request" as const })),
    ...nodes.slice(0, 7).map((node, index) => ({ from: node.id, to: nodes[(index + 4) % nodes.length].id, label: "Service dependency", kind: "policy" as const }))
  ];
  cases.push({ id: `ai-maximum-${new Set(layers).size}-layer-reference`, view });
}
for (const example of cases) {
  const view = example.view;
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
      assert.ok(graph.nodes.every(node => !overlaps(graph.highLevel ? connection.labelBox : {
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
    const legendItems = graph.highLevel ? new Set(graph.connections.map(connection => connectionStyle(connection.edge.kind).kind)).size : 5;
    assert.equal((svg.match(/marker-end="url\(#arrow-/g) ?? []).length, graph.connections.length + legendItems);
    if (graph.highLevel) {
      assert.equal((svg.match(/data-connection-label=/g) ?? []).length, graph.connections.length);
      assert.doesNotMatch(svg, /Connection references|data-flow-number|Open decisions \/ validation conditions/);
      assert.ok(graph.groups.length <= 6);
      if (focus === "overview") {
        assert.equal(graph.layoutStyle, "stacked");
        const bands = graph.groups.filter(group => group.id !== "cross-cutting");
        assert.ok(bands.length > 0);
        for (const [index, band] of bands.entries()) {
          assert.equal(band.x, bands[0].x);
          assert.equal(band.width, bands[0].width);
          if (index) assert.ok(band.y >= bands[index - 1].y + bands[index - 1].height, "Reference layers must be stacked vertically without overlap.");
        }
        assert.deepEqual(createStackedTemplate({ ...graph, connections: [] }).nodes, graph.nodes, "The clean layer template must be independent of the connections.");
        if (example.id === "ai-authored-high-level-integration") {
          const entry = graph.connections.find(connection => connection.edge.from === "web" && connection.edge.to === "backend");
          assert.equal(entry?.points.length, 2, "Aligned components in consecutive layers need a direct connector, not a routing loop.");
          const controls = graph.groups.find(group => group.id === "cross-cutting")!;
          assert.ok(controls.height < graph.height / 2, "A single identity component must not stretch into a full-height rail.");
        }
      }
      for (const [index, connection] of graph.connections.entries()) {
        for (const other of graph.connections.slice(index + 1)) {
          assert.equal(overlaps(connection.labelBox, other.labelBox), false, `${example.id}/${focus}: inline relationship labels overlap`);
        }
      }
    }
    assert.doesNotMatch(svg, /NaN|undefined/);
    diagrams++;
    edges += graph.connections.length;
  }
  console.log(`PASS connected diagrams: ${example.id}`);
}
console.log(`Verified ${diagrams} deterministic diagrams and ${edges} drawn directional connections.`);
