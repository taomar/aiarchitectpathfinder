import assert from "node:assert/strict";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { decide } from "../lib/decision-engine";
import { EXAMPLES } from "../lib/examples";
import { emptyInput } from "../lib/types";
import { buildArchitectureSummary } from "../lib/architecture-summary";
import { buildArchitectureView } from "../lib/architecture-view";
import { renderArchitectureViewSvg } from "../lib/architecture-svg";
import { buildArchitectureLayout } from "../lib/architecture-layout";
import { buildMermaidDiagram, displayPatternName } from "../lib/pathfinder-category";
import { recommendationDecision, AcceptedRecommendationSchema } from "../lib/recommendation-contract";
import { toJSON, toMarkdown, reportDetailSections } from "../lib/export";
import { buildPowerPoint, MAX_POWERPOINT_SLIDES, splitIntoSlideChunks } from "../lib/powerpoint";
import { withAiRecommendation, recommendationNotes } from "../components/FinalRecommendation";
import { acceptedFixture } from "./qa/recommendation-fixture";

process.env.AZURE_OPENAI_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Network access is forbidden in output checks."); };

async function main() {
  for (const example of EXAMPLES) {
    const decision = decide(example.input);
    const view = buildArchitectureView(decision, example.input);
    assert.doesNotMatch(renderArchitectureViewSvg(view, new Map()), /NaN|undefined|href="\/ms-icons/);
    assert.equal(new Set(view.layers.flatMap(layer => layer.nodes.map(node => node.id))).size, view.layers.reduce((n, layer) => n + layer.nodes.length, 0));
  }
  console.log("PASS legacy wizard drafts still produce valid diagnostic views for all shipped examples");

  const input = { ...emptyInput(), summary: "A read-only document web application." };
  const report = acceptedFixture(input.summary);
  const poisonedDraft = {
    ...decide(EXAMPLES[0].input),
    basePatternId: "BASELINE_ROUTE_MUST_NOT_APPEAR",
    basePatternName: "BASELINE_NAME_MUST_NOT_APPEAR",
    recommendedStack: ["BASELINE_SERVICE_MUST_NOT_APPEAR"],
    securityControls: ["BASELINE_CONTROL_MUST_NOT_APPEAR"],
    assumptions: ["BASELINE_ASSUMPTION_MUST_NOT_APPEAR"],
    riskFlags: ["BASELINE_RISK_MUST_NOT_APPEAR"]
  };
  const presented = withAiRecommendation(poisonedDraft, report);
  assert.equal(presented.basePatternId, report.recommendedBasePatternId);
  assert.equal(displayPatternName(presented), report.displayPatternName);
  assert.deepEqual(presented.recommendedStack, report.recommendedStack);
  assert.deepEqual(presented.architectureLayers, report.architectureLayers);
  assert.deepEqual(presented.securityControls, report.securityControls);
  assert.deepEqual(presented.assumptions, report.assumptions);
  assert.deepEqual(presented.riskFlags, report.riskFlags);
  assert.equal(presented.confidence, report.confidence);
  assert.throws(() => withAiRecommendation(poisonedDraft, null));
  console.log("PASS only the accepted AI report owns recommendation output; no baseline merge or fallback");

  const model = buildArchitectureView(presented, input);
  const contradictoryInput = { ...emptyInput(), users: ["citizens" as const], channels: ["teams" as const], writeBackConfirmed: true };
  assert.strictEqual(buildArchitectureView(presented, contradictoryInput), presented.approvedArchitecture);
  assert.deepEqual(model.edges, report.architectureGraph.edges);
  assert.deepEqual(model.layers.flatMap(layer => layer.nodes.map(node => node.id)).sort(), report.architectureGraph.nodes.map(node => node.id).sort());
  assert.equal(buildMermaidDiagram(presented, contradictoryInput), report.mermaidDiagram);
  assert.doesNotMatch(report.mermaidDiagram, /subgraph|source boundary/);
  assert.equal((report.mermaidDiagram.match(/ --> /g) ?? []).length, report.highLevelFlow.length - 1);
  assert.deepEqual(presented.highLevelFlow, report.highLevelFlow);
  const layout = buildArchitectureLayout(model);
  assert.equal(layout.connections.length, report.architectureGraph.edges.length, "No inferred connections may be added by layout.");
  assert.equal(layout.nodes.length, report.architectureGraph.nodes.length, "No inferred control nodes may be added by layout.");
  assert.ok(layout.nodes.every(node => !node.annotation));
  assert.equal(buildArchitectureSummary(contradictoryInput, presented, "wrong family"), report.proposedArchitectureSummary);
  console.log("PASS diagrams and summaries preserve the AI artifact without deterministic re-evaluation");

  const exported = JSON.parse(toJSON(input, poisonedDraft, report));
  assert.deepEqual(exported.decision, presented);
  const markdown = toMarkdown(input, poisonedDraft, report);
  const allDetails = JSON.stringify(reportDetailSections(input, poisonedDraft, report));
  assert.match(markdown, /Not independently reviewed/);
  for (const text of [JSON.stringify(exported), markdown, allDetails]) assert.doesNotMatch(text, /BASELINE_.*MUST_NOT_APPEAR/);
  for (const service of report.recommendedStack) assert.ok(markdown.includes(service));
  console.log("PASS JSON and Markdown exports cannot restore a caller's deterministic draft");

  const changed = structuredClone(report);
  changed.recommendedBasePatternId = "reviewer-selected-alternative";
  changed.displayPatternName = "The AI selected a different runtime";
  changed.solutionType = "AI-approved alternative";
  changed.recommendedStack = ["A different approved service"];
  changed.architectureLayers = [{ layer: "Runtime/Backend", selections: ["A different approved service"], reason: "User constraints warrant this design.", required: true }];
  const alternative = recommendationDecision(AcceptedRecommendationSchema.parse(changed));
  assert.equal(displayPatternName(alternative), changed.displayPatternName);
  assert.deepEqual(alternative.recommendedStack, changed.recommendedStack);
  console.log("PASS presentation honors AI changes to route, platform, services and layers");

  const notes = recommendationNotes("Explain the access boundary.", "Keep the business operation read-only.");
  assert.ok(notes.includes("Explain the access boundary."));
  assert.ok(notes.includes("Keep the business operation read-only."));
  assert.equal(recommendationNotes(notes, notes), notes);
  assert.throws(() => splitIntoSlideChunks("value", 0), RangeError);
  const long = "Long report sentence. ".repeat(150);
  assert.equal(splitIntoSlideChunks(long, 240).join("").replace(/\s/g, ""), long.replace(/\s/g, ""));
  console.log("PASS refinement context and plain-text helpers preserve content");

  const deck = new PptxGenJS();
  const logo = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "ms-icons", "microsoft-logo.png")).toString("base64")}`;
  const generated = buildPowerPoint(deck, {
    input, decision: poisonedDraft, tieBreak: report,
    architectureSummary: "BASELINE_SUMMARY_MUST_NOT_APPEAR", solutionType: "BASELINE_FAMILY_MUST_NOT_APPEAR"
  }, { logo });
  const archive = await JSZip.loadAsync(await deck.write({ outputType: "nodebuffer" }));
  const slideNames = Object.keys(archive.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideNames.length, generated.slides);
  assert.ok(slideNames.length <= MAX_POWERPOINT_SLIDES);
  const slides = await Promise.all(slideNames.map(name => archive.file(name)!.async("string")));
  const text = slides.join("\n");
  assert.match(text, /Not independently reviewed/);
  assert.doesNotMatch(text, /BASELINE_.*MUST_NOT_APPEAR|Technical appendix|Presenter note/);
  assert.ok(slides.some(xml => xml.includes("<a:tbl>")), "The service-sizing inventory must be an editable table.");
  for (const service of report.serviceSizing) {
    for (const value of [service.name, service.dev, service.test, service.prod]) {
      assert.ok(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes(value.replace(/\s+/g, " ")), value);
    }
  }
  for (const name of Object.keys(archive.files).filter(name => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))) {
    const notesXml = await archive.file(name)!.async("string");
    assert.ok(![...notesXml.matchAll(/<a:t>(.*?)<\/a:t>/g)].some(match => /[A-Za-z]/.test(match[1])), "Presenter commentary is not allowed.");
  }
  console.log(`PASS concise AI-owned PowerPoint: ${generated.slides} slides, editable service sizing, no commentary`);
  console.log("All output-authority and concise-export checks passed.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
