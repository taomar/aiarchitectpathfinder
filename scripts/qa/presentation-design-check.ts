import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { buildArchitectureSummary } from "../../lib/architecture-summary";
import { displayPatternName } from "../../lib/pathfinder-category";
import { ARCHITECTURE_DISCLAIMER, buildArchitectureView } from "../../lib/architecture-view";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";
import { buildPowerPoint } from "../../lib/powerpoint";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const logoBytes = fs.readFileSync(path.join(process.cwd(), "public", "ms-icons", "microsoft-logo.png"));
const logo = `data:image/png;base64,${logoBytes.toString("base64")}`;
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function main() {
  for (const example of EXAMPLES) {
    const decision = decide(example.input);
    const model = buildArchitectureView(decision, example.input);
    assert.deepEqual(model, buildArchitectureView(decision, example.input), "The same profile must produce the same model.");
    const reordered = buildArchitectureView({
      ...decision,
      architectureLayers: [...decision.architectureLayers].reverse().map(layer => ({ ...layer, selections: [...layer.selections].reverse() }))
    }, example.input);
    assert.deepEqual(model.layers.map(layer => ({ id: layer.id, nodes: layer.nodes.map(node => node.id) })),
      reordered.layers.map(layer => ({ id: layer.id, nodes: layer.nodes.map(node => node.id) })),
      "Equivalent selections must keep the same placement regardless of click order.");
    assert.deepEqual(model.edges, reordered.edges, "Equivalent selections must preserve the same source and request boundaries.");
    const nodes = model.layers.flatMap(layer => layer.nodes);
    const ids = nodes.map(node => node.id);
    assert.equal(new Set(ids).size, ids.length, example.id);
    for (const edge of model.edges) {
      assert.ok(ids.includes(edge.from) && ids.includes(edge.to), example.id);
      assert.notEqual(edge.from, edge.to, example.id);
      const from = nodes.find(node => node.id === edge.from)!;
      const to = nodes.find(node => node.id === edge.to)!;
      assert.ok(!(from.layer === "models" && (to.layer === "data" || to.layer === "interfaces")), "Models must not directly access operational data.");
    }
    for (const node of nodes) if (node.icon) {
      assert.ok(fs.existsSync(path.join(process.cwd(), "public", ...node.icon.split("/").filter(Boolean))), node.icon);
    }
    assert.ok(!model.controls.security.some(control => /prep for ai|semantic model readiness/i.test(control.label)), "Readiness is not authorization.");
    const svg = renderArchitectureViewSvg(model, new Map());
    assert.ok(svg.includes(ARCHITECTURE_DISCLAIMER));
    assert.doesNotMatch(svg, /NaN|undefined|href="\/ms-icons/);
    console.log(`PASS repeatable layers: ${example.id}`);
  }

  for (const index of [0, 5, 10]) {
    const example = EXAMPLES[index];
    const decision = decide(example.input);
    const presentation = new PptxGenJS();
    const summary = buildArchitectureSummary(example.input, decision, displayPatternName(decision));
    const result = buildPowerPoint(presentation, {
      input: example.input, decision, architectureSummary: summary,
      solutionType: displayPatternName(decision)
    }, { logo });
    const zip = await JSZip.loadAsync(await presentation.write({ outputType: "nodebuffer" }));
    const imageHashes = new Map<string, string>();
    for (const name of Object.keys(zip.files).filter(name => name.startsWith("ppt/media/") && !zip.files[name].dir)) {
      imageHashes.set(path.posix.basename(name), hash(await zip.file(name)!.async("nodebuffer")));
    }
    const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    assert.equal(slides.length, result.slides);
    const fullText: string[] = [];
    for (const name of slides) {
      const xml = await zip.file(name)!.async("string");
      const text = decode([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => match[1]).join("\n"));
      fullText.push(text);
      assert.ok(text.includes(ARCHITECTURE_DISCLAIMER), `${name}: disclaimer`);
      assert.doesNotMatch(xml, /show="0"|<a:normAutofit/);
      assert.doesNotMatch(text, /\+\s*\d+\s+more(?:\s+items)?|…/);
      const rels = await zip.file(`ppt/slides/_rels/${path.posix.basename(name)}.rels`)!.async("string");
      const hasLogo = [...rels.matchAll(/Target="([^"]+)"/g)].some(match => imageHashes.get(path.posix.basename(match[1])) === hash(logoBytes));
      assert.ok(hasLogo, `${name}: Microsoft logo`);
      for (const match of xml.matchAll(/<a:xfrm[^>]*>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>[\s\S]*?<\/a:xfrm>/g)) {
        const [x, y, w, h] = match.slice(1).map(Number);
        assert.ok(x >= 0 && y >= 0 && x + w <= 12192010 && y + h <= 6858010, `${example.id}: shape outside slide ${name}`);
      }
    }
    const normalized = fullText.join(" ").replace(/\s+/g, " ");
    for (const value of [example.input.summary!, ...decision.securityControls, ...decision.riskFlags]) {
      assert.ok(normalized.includes(value.replace(/\s+/g, " ")), `${example.id}: full source text missing`);
    }
    console.log(`PASS PowerPoint: ${example.id}, ${slides.length} slides, logo/disclaimer on every slide, no auto-shrink or clipping.`);
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
