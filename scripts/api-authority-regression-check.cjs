require("tsx/cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { decide } = require("../lib/decision-engine.ts");
const { prepareDecisionInputForRecommendation } = require("../lib/summary-intake.ts");
const { emptyInput } = require("../lib/types.ts");

globalThis.fetch = async () => { throw new Error("Network calls are forbidden in API authority checks."); };
let captured;
const responses = {
  "@/lib/app-auth": { requireAppAccess: () => null },
  "@/lib/azure-openai": {
    azureOpenAIEnabled: () => true,
    azureOpenAIStatus: () => ({ enabled: true }),
    tieBreak: async (input, decision, notes, options) => {
      captured = { input, decision, notes, options };
      return { recommendedBasePatternId: decision.basePatternId };
    }
  },
  "@/lib/decision-engine": { decide },
  "@/lib/summary-intake": { prepareDecisionInputForRecommendation },
  "@/lib/pathfinder-apim": { PathfinderApimError: class extends Error {} },
  "next/server": { NextResponse: Response }
};
const routePath = path.join(__dirname, "..", "app", "api", "tiebreak", "route.ts");
const compiled = ts.transpileModule(fs.readFileSync(routePath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const route = { exports: {} };
vm.runInThisContext(`(function(exports, require, module) { ${compiled}\n})`, { filename: routePath })(
  route.exports,
  (id) => {
    if (!Object.hasOwn(responses, id)) throw new Error(`Unexpected route dependency: ${id}`);
    return responses[id];
  },
  route
);

async function verify(input) {
  const expectedInput = prepareDecisionInputForRecommendation(input);
  const expectedDecision = decide(expectedInput);
  const response = await route.exports.POST(new Request("http://localhost/api/tiebreak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      decision: { basePatternId: "forged-client-route", overlays: [], blockedComponents: [] },
      userNotes: "Preserve approved read-only access.",
      recommendationMode: "deep"
    })
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(captured.input, expectedInput, "Provider input must be the prepared profile.");
  assert.deepEqual(captured.decision, expectedDecision, "Provider policy must be recomputed server-side, never supplied by the client.");
  assert.equal(captured.notes, "Preserve approved read-only access.");
  assert.equal(captured.options.recommendationMode, "deep");
  assert.equal((await response.json()).recommendedBasePatternId, expectedDecision.basePatternId);
}

async function main() {
  await verify({
    ...emptyInput(),
    users: ["internal_employees"],
    channels: ["teams"],
    capabilities: ["operational_query"],
    dataSources: ["azure_sql"],
    behaviors: ["read_only_query"],
    writeBackConfirmed: false
  });
  await verify({
    ...emptyInput(),
    summary: "Employees use Teams to answer read-only policy questions from SharePoint documents.",
    directTextRecommendation: true,
    users: ["external_customers"],
    channels: ["web"],
    dataSources: ["azure_sql"],
    capabilities: ["record_update"],
    behaviors: ["record_update"],
    writeBackConfirmed: true
  });
  console.log("API authority regressions passed (actual route and decision engine; model mocked; no network).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
