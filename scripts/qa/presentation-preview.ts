import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import PptxGenJS from "pptxgenjs";
import { decide } from "../../lib/decision-engine";
import { prepareDecisionInputForRecommendation } from "../../lib/summary-intake";
import { TieBreakSchema } from "../../lib/azure-openai";
import { withAiRecommendation } from "../../components/FinalRecommendation";
import { displayPatternName } from "../../lib/pathfinder-category";
import { buildArchitectureView } from "../../lib/architecture-view";
import { renderArchitectureViewSvg } from "../../lib/architecture-svg";
import { buildPowerPoint } from "../../lib/powerpoint";

const recordPath = process.argv[2];
const configuredOutput = process.env.DESIGN_ARTIFACT_DIR;
if (!recordPath || !configuredOutput) throw new Error("Pass a recorded report path and set DESIGN_ARTIFACT_DIR outside the repository.");
const outputDirectory: string = configuredOutput;
const root = process.cwd();
const relative = path.relative(root, path.resolve(outputDirectory));
if (!(path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))) {
  throw new Error("Generated presentations must remain outside the repository.");
}
async function main() {
const require = createRequire(path.join(root, "package.json"));
const sharp: typeof import("sharp") = require("sharp");
const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
const input = prepareDecisionInputForRecommendation(record.input);
const review = TieBreakSchema.extend({}).passthrough().parse(record.report);
const decision = withAiRecommendation(decide(input), { ...review, aiValidated: true });
const model = buildArchitectureView(decision, input);
const nodes = model.layers.flatMap(layer => layer.nodes);
const assets: Record<string, string> = {};
const svgAssets = new Map<string, string | null>();
for (const node of nodes) {
  if (!node.icon) continue;
  const source = path.join(root, "public", ...node.icon.split("/").filter(Boolean));
  const png = await sharp(fs.readFileSync(source)).resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  assets[node.id] = `data:image/png;base64,${png.toString("base64")}`;
  svgAssets.set(node.icon, assets[node.id]);
}
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public", "ms-icons", "microsoft-logo.png")).toString("base64")}`;
fs.mkdirSync(outputDirectory, { recursive: true });
const pptx = new PptxGenJS();
const result = buildPowerPoint(pptx, {
  input, decision, tieBreak: { ...review, aiValidated: true },
  architectureSummary: review.proposedArchitectureSummary,
  solutionType: displayPatternName(decision),
  refinement: record.notes
}, { logo, icons: assets });
await pptx.writeFile({ fileName: path.join(outputDirectory, "pathfinder-redesigned.pptx") });
const svg = renderArchitectureViewSvg(model, svgAssets);
fs.writeFileSync(path.join(outputDirectory, "layered-architecture.svg"), svg);
await sharp(Buffer.from(svg)).resize({ width: 1520 }).png().toFile(path.join(outputDirectory, "layered-architecture.png"));
fs.writeFileSync(path.join(outputDirectory, "architecture-model.json"), JSON.stringify(model, null, 2));
console.log(`Generated ${result.slides} slides and the shared layered diagram without model calls.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
