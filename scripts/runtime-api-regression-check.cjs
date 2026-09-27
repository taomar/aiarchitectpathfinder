const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

process.env.AZURE_OPENAI_ENABLED = "false";
const root = path.resolve(__dirname, "..");
const modules = new Map();
const requests = [];
const completions = [];
let routeEnabled = true;
let credentialsRequested = 0;
const env = {
  NODE_ENV: "production",
  AZURE_OPENAI_ENABLED: "false",
  PATHFINDER_APIM_BASE_URL: "https://example.invalid",
  PATHFINDER_APIM_TOKEN_SCOPE: ""
};

class NextResponse extends Response {
  static json(value, init) { return Response.json(value, init); }
}

async function mockFetch(url, init) {
  assert.equal(new URL(url).hostname, "example.invalid", "Only the synthetic gateway is allowed.");
  assert.ok(completions.length, "Unexpected additional provider attempt.");
  requests.push(JSON.parse(init.body));
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(completions.shift()) } }]
  });
}

function load(file) {
  file = path.resolve(root, file);
  if (!file.startsWith(root + path.sep)) throw new Error("Source must stay in the worktree.");
  if (!path.extname(file)) file += ".ts";
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  let compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  }).outputText;
  if (path.basename(file) === "azure-openai.ts") {
    compiled += "\nexports.reviewHooks = { reviewRecommendation };";
  }
  function requireMock(id) {
    if (id === "@/lib/app-auth") return { requireAppAccess: () => null };
    if (id === "fs") return { existsSync: () => false };
    if (id === "@azure/identity") return {
      DefaultAzureCredential: class {
        getToken() {
          credentialsRequested += 1;
          throw new Error("Credential access is forbidden.");
        }
      }
    };
    if (id === "next/server") return { NextResponse };
    if (id === "@/lib/azure-openai") {
      const ai = load("lib\\azure-openai.ts");
      // Exercise the real review pipeline without changing the application's disabled setting.
      return {
        ...ai,
        azureOpenAIEnabled: () => routeEnabled,
        tieBreak: ai.reviewHooks.reviewRecommendation
      };
    }
    if (id.startsWith("@/")) return load(path.join(root, id.slice(2)));
    if (id.startsWith(".")) return load(path.resolve(path.dirname(file), id));
    if (["node:crypto", "path", "zod"].includes(id)) return require(id);
    throw new Error(`Unexpected dependency: ${id}`);
  }
  vm.runInThisContext(
    "(function(exports,require,module,process,fetch){" + compiled + "\n})",
    { filename: file }
  )(module.exports, requireMock, module, {
    env: path.basename(file) === "ai-runtime.ts" ? { ...env, AZURE_OPENAI_ENABLED: "true" } : env,
    cwd: () => root
  }, mockFetch);
  return module.exports;
}

async function main() {
  const { emptyInput } = load("lib\\types.ts");
  const { decide } = load("lib\\decision-engine.ts");
  const { prepareDecisionInputForRecommendation } = load("lib\\summary-intake.ts");
  const { buildMermaidDiagram, displayPatternName } = load("lib\\pathfinder-category.ts");
  const { POST } = load("app\\api\\tiebreak\\route.ts");
  const ai = load("lib\\azure-openai.ts");
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const internal = {
    ...emptyInput(),
    users: ["internal_employees"],
    channels: ["teams"],
    capabilities: ["operational_query"],
    dataSources: ["azure_sql"],
    behaviors: ["read_only_query"],
    runtimePreferences: ["copilot_studio"],
    securityControls: ["entra_id", "rbac", "audit"],
    writeBackConfirmed: false
  };
  const external = {
    ...internal,
    users: ["citizens"],
    channels: ["web"],
    dataSources: ["fabric_lakehouse"],
    capabilities: ["fabric_analytics"],
    behaviors: ["analytics"],
    runtimePreferences: ["custom_backend"],
    securityControls: ["entra_external_id", "apim", "waf", "rbac"],
    fabricAnalyticsIntent: "read_only_analytics_qa",
    fabricUserAccess: "anonymous_users"
  };
  const draft = () => ({
    recommendedBasePatternId: "model-owned-route",
    recommendedOverlays: ["model-owned-overlay"],
    solutionType: "AI Foundry",
    displayPatternName: "AI Foundry",
    finalRecommendation: "UNTRUSTED_PLAN",
    recommendedStack: ["Azure AI Search"],
    architectureLayers: [{
      layer: "Security", selections: ["None"], required: false, reason: "UNTRUSTED_REASON"
    }],
    endToEndFlow: ["UNTRUSTED_DIRECT_WRITE: LLM -> Azure SQL"],
    rationale: ["UNTRUSTED_RATIONALE"],
    zeroTrust: { applicable: false, rationale: "UNTRUSTED_TRUST", controls: [] },
    assumptions: [],
    riskFlags: [],
    reasoning: ["Useful follow-up explanation"],
    proposedArchitectureSummary: "UNTRUSTED_SUMMARY",
    architectureDiagramPrompt: "UNTRUSTED_DIAGRAM",
    mermaidDiagram: "flowchart LR\nA[UNTRUSTED_LLM] --> B[Azure SQL]",
    agentTrace: [{ agent: "Guardrail Verifier", status: "passed", summary: "Everything verified" }]
  });
  const canonicalFields = [
    "recommendedStack", "optionalAddOns", "architectureLayers", "endToEndFlow",
    "rationale", "securityControls", "zeroTrust"
  ];
  let cases = 0;

  function assertContained(result, decision) {
    assert.equal(result.recommendedBasePatternId, decision.basePatternId);
    assert.deepEqual(result.recommendedOverlays, decision.overlays.map((overlay) => overlay.id));
    for (const field of canonicalFields) {
      assert.deepEqual(result[field], plain(decision[field]), `${field} must remain authoritative.`);
    }
    for (const value of decision.assumptions) assert.ok(result.assumptions.includes(value));
    for (const value of decision.riskFlags) assert.ok(result.riskFlags.includes(value));
    assert.equal(result.mermaidDiagram, buildMermaidDiagram(decision));
    assert.doesNotMatch(result.proposedArchitectureSummary + result.architectureDiagramPrompt + result.mermaidDiagram, /UNTRUSTED/);
    assert.ok(result.recommendedStack.length);
    assert.ok(result.architectureLayers.length);
    assert.ok(result.endToEndFlow.length);
    assert.equal(result.agentTrace.find((item) => item.agent === "Guardrail Verifier").status, "passed");
    assert.equal(result.aiValidated, true);
    assert.equal(result.finalRecommendation, "AI-authored solution explanation.");
    assert.ok(result.reasoning.includes("Useful follow-up explanation"));
  }

  function validDraft(decision, input) {
    return {
      ...plain(decision),
      recommendedBasePatternId: decision.basePatternId,
      recommendedOverlays: decision.overlays.map(item => item.id),
      solutionType: displayPatternName(decision),
      displayPatternName: displayPatternName(decision),
      finalRecommendation: "AI-authored solution explanation.",
      useCaseTitle: "Scenario-specific AI design",
      useCaseSummary: input.summary || "AI-authored use case summary.",
      proposedArchitectureSummary: "AI-authored architecture study with the selected requirements, controls and data paths.",
      reasoning: ["Useful follow-up explanation"], questionsToAskNext: [], mustNotInclude: [],
      mermaidDiagram: ""
    };
  }

  async function exercise(name, input, extra = {}) {
    const prepared = prepareDecisionInputForRecommendation(input);
    const decision = decide(prepared);
    const count = requests.length;
    completions.push(validDraft(decision, prepared), { passed: true, issues: [] });
    const payload = { input, userNotes: name, recommendationMode: "deep", ...extra };
    const response = await POST(new Request("http://localhost/api/tiebreak", {
      method: "POST", body: JSON.stringify(payload)
    }));
    assert.equal(response.status, 200, name);
    const result = await response.json();
    assert.equal(requests.length, count + 2, `${name} needs a composer and separate judge.`);
    const sent = JSON.parse(requests[count].messages.at(-1).content);
    assert.deepEqual(sent.decisionInput, plain(prepared), "Routing and AI must use the same prepared profile.");
    assert.equal(sent.currentBasePatternId, decision.basePatternId);
    assertContained(result, decision);
    cases += 1;
    return { result, decision, sent, payload };
  }

  await exercise("legacy decision ignored", internal, {
    decision: { basePatternId: "client-owned-route", overlays: [], blockedComponents: [] }
  });

  const omitted = await exercise("mandatory controls preserved", external);
  assert.ok(omitted.decision.securityControls.length, "The fixture must require controls.");
  assert.ok(omitted.decision.architectureLayers.some((layer) => layer.required));
  assert.ok(omitted.decision.riskFlags.length, "The fixture must require risk flags.");
  assert.equal(omitted.result.zeroTrust.applicable, omitted.decision.zeroTrust.applicable);

  const approved = await exercise("accepted report", internal);
  for (const [name, invalid] of [
    ["hostile structural edits", draft()],
    ["empty model presentation", {
      recommendedBasePatternId: "ignored",
      recommendedStack: [], architectureLayers: [], endToEndFlow: [], rationale: [], securityControls: [],
      reasoning: ["Useful follow-up explanation"]
    }]
  ]) {
    const count = requests.length;
    completions.push(invalid, invalid);
    const response = await POST(new Request("http://localhost/api/tiebreak", {
      method: "POST", body: JSON.stringify({ input: internal, userNotes: name })
    }));
    assert.equal(response.status, 500, "Rejected AI output must not become a successful static report.");
    assert.match((await response.json()).error, /did not pass review/);
    assert.equal(requests.length, count + 2, "Only one structural repair is allowed.");
    cases++;
  }

  for (const [intent, summary] of [
    ["storage_only", "Internal employees use Teams. Fabric Lakehouse is only for storage."],
    ["predefined_reports_apis", "Internal employees use Teams to only use predefined reports from Fabric Lakehouse, with no conversational analytics."]
  ]) {
    const result = await exercise(`prepared ${intent}`, {
      ...external, directTextRecommendation: true, summary, fabricAnalyticsIntent: "read_only_analytics_qa"
    });
    assert.equal(result.sent.decisionInput.fabricAnalyticsIntent, intent);
    assert.equal(result.sent.fabricDataAgentRequired, false);
    assert.doesNotMatch(result.result.recommendedStack.join(" "), /Fabric Data Agent/i);
    assert.ok(result.result.recommendedStack.some((value) => /Governed Fabric/i.test(value)));
  }

  const count = requests.length;
  const cachedResponse = await POST(new Request("http://localhost/api/tiebreak", {
    method: "POST", body: JSON.stringify(approved.payload)
  }));
  const cached = await cachedResponse.json();
  assert.equal(cachedResponse.status, 200);
  assert.equal(cached.cacheHit, true);
  assert.equal(requests.length, count, "Only the complete canonical response may be cached.");
  assertContained(cached, approved.decision);

  routeEnabled = false;
  const disabled = await POST(new Request("http://localhost/api/tiebreak", {
    method: "POST", body: JSON.stringify({ input: internal })
  }));
  assert.equal(disabled.status, 400);
  assert.equal(ai.azureOpenAIEnabled(), false);
  await assert.rejects(ai.tieBreak(internal, decide(internal)), /not enabled/);
  assert.equal(requests.length, count);
  assert.equal(credentialsRequested, 0);
  assert.equal(completions.length, 0);
  assert.equal(process.env.AZURE_OPENAI_ENABLED, "false");
  console.log(`Runtime API regression checks passed (${cases} mocked-fetch cases, cache and disabled checks; no network).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
