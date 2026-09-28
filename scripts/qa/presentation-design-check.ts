import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { EXAMPLES } from "../../lib/examples";
import { decide } from "../../lib/decision-engine";
import { ARCHITECTURE_DISCLAIMER, buildArchitectureView } from "../../lib/architecture-view";
import { AcceptedRecommendationSchema, recommendationDecision, type AcceptedRecommendation } from "../../lib/recommendation-contract";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";
import { buildPowerPoint, MAX_POWERPOINT_SLIDES } from "../../lib/powerpoint";
import { acceptedFixture } from "./recommendation-fixture";

const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const logoBytes = fs.readFileSync(path.join(process.cwd(), "public", "ms-icons", "microsoft-logo.png"));
const logo = `data:image/png;base64,${logoBytes.toString("base64")}`;
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function checkDeck(report: AcceptedRecommendation, name: string) {
  const decision = recommendationDecision(report);
  const presentation = new PptxGenJS();
  const result = buildPowerPoint(presentation, {
    input: EXAMPLES[0].input,
    decision: decide(EXAMPLES[0].input),
    tieBreak: report,
    architectureSummary: "IGNORED_CALLER_SUMMARY",
    solutionType: "IGNORED_CALLER_FAMILY"
  }, { logo });
  assert.deepEqual(result.model, buildArchitectureView(decision));
  assert.ok(result.slides <= MAX_POWERPOINT_SLIDES, `${name}: actual slide count must be <=15`);
  const zip = await JSZip.loadAsync(await presentation.write({ outputType: "nodebuffer" }));
  const imageHashes = new Map<string, string>();
  for (const file of Object.keys(zip.files).filter(file => file.startsWith("ppt/media/") && !zip.files[file].dir)) {
    imageHashes.set(path.posix.basename(file), hash(await zip.file(file)!.async("nodebuffer")));
  }
  const slides = Object.keys(zip.files).filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file));
  assert.equal(slides.length, result.slides);
  let tables = 0;
  const fullText: string[] = [];
  for (const file of slides) {
    const xml = await zip.file(file)!.async("string");
    const content = decode([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(match => match[1]).join(" "));
    fullText.push(content);
    assert.ok(content.includes(ARCHITECTURE_DISCLAIMER), `${file}: disclaimer`);
    assert.doesNotMatch(xml, /show="0"|<a:normAutofit/);
    assert.doesNotMatch(content, /Technical appendix|Presenter note|IGNORED_CALLER/);
    tables += (xml.match(/<a:tbl>/g) ?? []).length;
    const rels = await zip.file(`ppt/slides/_rels/${path.posix.basename(file)}.rels`)!.async("string");
    assert.ok([...rels.matchAll(/Target="([^"]+)"/g)].some(match => imageHashes.get(path.posix.basename(match[1])) === hash(logoBytes)), `${file}: logo`);
    for (const match of xml.matchAll(/<a:xfrm[^>]*>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>[\s\S]*?<\/a:xfrm>/g)) {
      const [x, y, w, h] = match.slice(1).map(Number);
      assert.ok(x >= 0 && y >= 0 && x + w <= 12192010 && y + h <= 6858010, `${name}: shape outside ${file}`);
    }
  }
  assert.equal(tables, Math.ceil(report.serviceSizing.length / 4));
  const normalized = fullText.join(" ").replace(/\s+/g, " ");
  for (const service of report.serviceSizing) {
    for (const value of [service.name, service.dev, service.test, service.prod]) {
      assert.ok(normalized.includes(value.replace(/\s+/g, " ")), `${name}: service/environment value missing: ${value}`);
    }
  }
  for (const file of Object.keys(zip.files).filter(file => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(file))) {
    const xml = await zip.file(file)!.async("string");
    assert.ok(![...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].some(match => /[A-Za-z]/.test(match[1])), "No presenter commentary.");
  }
  console.log(`PASS ${name}: ${slides.length} slides, ${tables} sizing tables, logo/disclaimer and no commentary`);
}

async function main() {
  for (const example of EXAMPLES) {
    const report = acceptedFixture(example.input.summary);
    const decision = recommendationDecision(report);
    const view = buildArchitectureView(decision, example.input);
    assert.deepEqual(view, buildArchitectureView(decision, { ...example.input, dataSources: [], runtimePreferences: [] }));
    assert.deepEqual(view.edges, report.architectureGraph.edges);
    assert.doesNotMatch(renderArchitectureViewSvg(view, new Map()), /NaN|undefined|href="\/ms-icons/);
  }
  console.log("PASS AI graph is independent of all 15 input profiles once accepted");
  await checkDeck(acceptedFixture(), "Standard AI recommendation");

  const maximum = acceptedFixture();
  maximum.architectureGraph.nodes.push(
    { id: "monitor", label: "Monitor", layer: "operations", provider: "logical", kind: "capability", state: "selected", required: true, icon: "generic", detail: "Synthetic capacity-layout fixture.", controls: [] },
    { id: "gateway", label: "Gateway", layer: "edge", provider: "logical", kind: "capability", state: "confirm", required: true, icon: "generic", detail: "Synthetic capacity-layout fixture.", controls: [] }
  );
  maximum.architectureGraph.edges.push(
    { from: "backend", to: "monitor", kind: "policy", label: "Telemetry" },
    { from: "web", to: "gateway", kind: "conditional", label: "Confirm gateway" }
  );
  const cell = "Proposed environment size; validate measured request, token and corpus capacity";
  for (let index = maximum.serviceSizing.length; index < 32; index++) maximum.serviceSizing.push({
    id: `synthetic-service-${index}`, name: `Synthetic Azure service ${index}`,
    provider: "azure", purpose: "Synthetic layout fixture, not a real capacity recommendation",
    nodeIds: ["backend"], dev: cell, test: cell, prod: cell, assumptions: [], references: []
  });
  maximum.assumptions = Array.from({ length: 40 }, () => "A detailed assumption that remains available on the recommendation page. ".repeat(15));
  maximum.riskFlags = Array.from({ length: 40 }, () => "A detailed risk requiring review. ".repeat(20));
  maximum.proposedArchitectureSummary = "Long narrative on the page. ".repeat(350);
  await checkDeck(AcceptedRecommendationSchema.parse(maximum), "Maximum 32-service and long-narrative fixture");
  console.log("Concise presentation contract verified.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
