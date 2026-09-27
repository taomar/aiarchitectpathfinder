import assert from "node:assert/strict";
import React from "react";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { decide } from "../lib/decision-engine";
import { emptyInput, type Channel, type DecisionInput, type TieBreakResponse } from "../lib/types";
import { EXAMPLES } from "../lib/examples";
import { prepareDecisionInputForRecommendation } from "../lib/summary-intake";
import { isActionable, requiresOrchestration } from "../lib/rules";
import { buildArchitectureSummary } from "../lib/architecture-summary";
import { buildMermaidDiagram, categoryForDecision, displayPatternName } from "../lib/pathfinder-category";
import { reportDetailSections, reportUseCaseSummary, toJSON, toMarkdown } from "../lib/export";
import { buildArchitectureSvg } from "../components/ArchitectureImage";
import { FinalRecommendation, recommendationNotes, withAiRecommendation } from "../components/FinalRecommendation";
import { addArchitectureBlueprintSlide, addReportDetailsSlides, splitIntoSlideChunks } from "../components/ExportPPTButton";

process.env.AZURE_OPENAI_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Network calls are forbidden in output regression checks."); };

const checks: Array<{ name: string; run: () => void | Promise<void> }> = [];
const check = (name: string, run: () => void | Promise<void>) => checks.push({ name, run });
const example = (id: string) => {
  const item = EXAMPLES.find((candidate) => candidate.id === id);
  assert.ok(item, `Example ${id} exists`);
  return item.input;
};
const svgText = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1]).join(" ");
const summary = (input: DecisionInput) => {
  const decision = decide(input);
  return buildArchitectureSummary(input, decision, categoryForDecision(decision).category);
};

function reviewFor(decision: ReturnType<typeof decide>, changes: Partial<TieBreakResponse> = {}): TieBreakResponse {
  return {
    recommendedBasePatternId: decision.basePatternId,
    recommendedOverlays: decision.overlays.map((overlay) => overlay.id),
    reasoning: [],
    questionsToAskNext: [],
    assumptions: [],
    riskFlags: [],
    mustNotInclude: [],
    useCaseTitle: "Offline report fixture",
    useCaseSummary: "",
    proposedArchitectureSummary: "",
    recommendationMode: "deep",
    ...changes
  };
}

type ReportElement = { type: any; props: Record<string, any> };
const reportNodes = (node: any): ReportElement[] => Array.isArray(node)
  ? node.flatMap(reportNodes)
  : node?.props ? [node, ...reportNodes(node.props.children)] : [];
const reportText = (node: any): string => typeof node === "string"
  ? node
  : Array.isArray(node) ? node.map(reportText).join("") : node?.props ? reportText(node.props.children) : "";
const reportComponent = (nodes: ReportElement[], name: string) => {
  const found = nodes.find((node) => typeof node.type === "function" && node.type.name === name);
  assert.ok(found, `${name} must be present in the usable report.`);
  return found;
};
const reportButton = (nodes: ReportElement[], label: string) => {
  const found = nodes.find((node) => node.type === "button" && reportText(node).startsWith(label));
  assert.ok(found, `${label} button exists.`);
  return found;
};

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});
const settleUntil = async (ready: () => boolean) => {
  for (let attempt = 0; attempt < 30 && !ready(); attempt++) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(ready(), "Mocked async lifecycle should settle without a real network or timeout wait.");
};

function mockReportLifecycle(fetchResponse: typeof fetch, initialStates: any[] = []) {
  const input = example("copilot_hr_policy_teams");
  const decision = decide(input);
  const originalHooks = { useState: React.useState, useRef: React.useRef, useMemo: React.useMemo, useEffect: React.useEffect };
  const originalFetch = globalThis.fetch;
  const states = initialStates.slice();
  const refs: Array<{ current: any }> = [];
  const effects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let recordEffects = true;
  Object.assign(React, {
    useState(initial: any) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial: any) {
      const index = refIndex++;
      return refs[index] ?? (refs[index] = { current: initial });
    },
    useMemo(factory: () => unknown) { return factory(); },
    useEffect(effect: () => void | (() => void)) { if (recordEffects) effects.push(effect); }
  });
  globalThis.fetch = (url, options) => new Promise<Response>((resolve, reject) => {
    const signal = options?.signal;
    const aborted = () => reject(Object.assign(new Error("Mock request aborted"), { name: "AbortError" }));
    if (signal?.aborted) return aborted();
    signal?.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => fetchResponse(url, options)).then(resolve, reject).finally(() => signal?.removeEventListener("abort", aborted));
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    const nodes = reportNodes(FinalRecommendation({
      input, decision,
      usageSession: { id: "offline-ai-lifecycle", source: "test", startedAt: "2026-09-21T00:00:00Z" },
      onBack() {}, onReset() {}
    }));
    recordEffects = false;
    return nodes;
  };
  return {
    input, decision, states, render,
    mount() {
      const nodes = render();
      for (const effect of effects.splice(0)) {
        const cleanup = effect();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      }
      return nodes;
    },
    dispose() {
      cleanups.reverse().forEach((cleanup) => cleanup());
      Object.assign(React, originalHooks);
      globalThis.fetch = originalFetch;
    }
  };
}

function assertUsableBaseline(nodes: ReportElement[], decision: ReturnType<typeof decide>) {
  const exported = reportComponent(nodes, "ExportPPTButton");
  assert.equal(exported.props.decision.basePatternId, decision.basePatternId);
  assert.deepEqual(exported.props.decision.recommendedStack, decision.recommendedStack);
  const renderedText = reportText(nodes);
  assert.doesNotMatch(renderedText, /Preparing recommendation|Waiting for the LLM/);
  decision.recommendedStack.forEach((service) => assert.ok(renderedText.includes(service), `${service} must remain visible during optional review.`));
}

check("all shipped examples generate valid, portable SVG markup", () => {
  for (const item of EXAMPLES) {
    const svg = buildArchitectureSvg(decide(item.input), item.input, new Map());
    assert.match(svg, /^<svg /, item.id);
    assert.doesNotMatch(svg, /NaN|undefined|href="\/ms-icons/, item.id);
  }
});

check("all supported channels have non-null diagram nodes", () => {
  const channels: Channel[] = ["m365_copilot", "teams", "m365", "web", "mobile", "portal", "api", "embedded", "multiple", "unknown"];
  for (const channel of channels) {
    const input = { ...example("foundry_contact_center_multimodel"), channels: [channel] };
    const svg = buildArchitectureSvg(decide(input), input, new Map());
    assert.match(svg, /<svg /, channel);
    assert.doesNotMatch(svg, /undefined|NaN/, channel);
  }
});

for (const intent of ["storage_only", "predefined_reports_apis"] as const) {
  for (const runtime of ["custom_backend", "copilot_studio", "foundry_agent_service"] as const) {
    check(`${intent} stays opted out in ${runtime} summaries and diagrams`, () => {
      const internal = runtime === "copilot_studio";
      const input: DecisionInput = {
        ...emptyInput(),
        users: internal ? ["internal_employees"] : ["citizens"],
        channels: internal ? ["teams"] : ["portal"],
        capabilities: ["operational_query"],
        dataSources: ["fabric_warehouse"],
        behaviors: ["qa", "read_only_query"],
        runtimePreferences: [runtime],
        lifecycleControls: ["none"],
        securityControls: internal ? ["entra_id"] : ["entra_external_id"],
        networkControls: ["public"],
        fabricAnalyticsIntent: intent,
        fabricUserAccess: internal ? "internal_fabric_permissions" : "external_customers_citizens",
        externalAccessConfirmed: !internal
      };
      const decision = decide(input);
      assert.doesNotMatch(summary(input), /Microsoft Fabric Data Agent/i);
      const visual = svgText(buildArchitectureSvg(decision, input, new Map()));
      assert.doesNotMatch(visual, /Microsoft Fabric Data Agent/i);
      assert.match(visual, /Governed Fabric/);
      const diagram = buildMermaidDiagram(decision);
      assert.doesNotMatch(diagram, /Fabric Data Agent|m0 --> k0/);
      assert.match(diagram, /in\d+ --> k0/);
      assert.ok(reportDetailSections(input, decision).some((section) => section.items.includes(`fabricAnalyticsIntent: ${intent}`)));
    });
  }
}

check("analytics and legacy Fabric default retain their Data Agent", () => {
  for (const intent of [undefined, "read_only_analytics_qa"] as const) {
    const input: DecisionInput = {
      ...emptyInput(),
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["fabric_analytics"],
      dataSources: ["fabric_warehouse"],
      behaviors: ["qa", "analytics"],
      runtimePreferences: ["copilot_studio"],
      lifecycleControls: ["none"],
      securityControls: ["entra_id"],
      networkControls: ["public"],
      fabricAnalyticsIntent: intent,
      fabricUserAccess: "internal_fabric_permissions"
    };
    const decision = decide(input);
    assert.match(summary(input), /Microsoft Fabric Data Agent/);
    assert.match(svgText(buildArchitectureSvg(decision, input, new Map())), /Microsoft Fabric Data Agent/);
    assert.match(buildMermaidDiagram(decision), /analytics grounding/);
  }
});

check("native Microsoft 365 product is not narrated as a custom Copilot Studio solution", () => {
  const input: DecisionInput = {
    ...emptyInput(),
    summary: "Our 800 employees need native meeting and email summaries in Microsoft 365.",
    users: ["internal_employees"],
    channels: ["m365_copilot", "m365"],
    capabilities: ["personal_productivity"],
    dataSources: ["m365_graph", "sharepoint"],
    behaviors: ["qa", "summarization"],
    runtimePreferences: ["none"],
    lifecycleControls: ["none"],
    securityControls: ["entra_id"],
    networkControls: ["public"],
    advancedRagRequirements: ["none"]
  };
  const decision = decide(input);
  assert.equal(decision.basePatternId, "m365_copilot_productivity");
  assert.equal(categoryForDecision(decision).category, "Copilot Studio", "Existing family bucket remains stable.");
  assert.equal(displayPatternName(decision), "Microsoft 365 Copilot");
  assert.equal(withAiRecommendation(decision, reviewFor(decision, { displayPatternName: "Copilot Studio" })).basePatternName, decision.basePatternName);
  assert.match(summary(input), /recommended solution is a Microsoft 365 Copilot architecture/i);
  assert.doesNotMatch(summary(input), /Copilot Studio|organization's Azure subscription/);
  assert.equal(reportUseCaseSummary(input, decision), input.summary);
});

check("required Foundry model operations classify a Copilot experience as hybrid", () => {
  const decision = decide(example("copilot_hr_policy_teams"));
  decision.architectureLayers = decision.architectureLayers.map((layer) => layer.layer === "AI Platform"
    ? { ...layer, required: true, selections: ["Copilot Studio managed AI experience", "Azure AI Foundry / Foundry Models"] }
    : layer);
  assert.equal(categoryForDecision(decision).category, "Hybrid Copilot Studio + AI Foundry");
});

check("managed Copilot model descriptions do not imply a separate Foundry deployment", () => {
  const decision = decide(example("copilot_hr_policy_teams"));
  decision.architectureLayers = decision.architectureLayers.map((layer) => layer.layer === "AI Platform"
    ? { ...layer, required: true, selections: ["Copilot Studio managed AI experience using built-in Azure OpenAI capabilities"] }
    : layer);
  assert.equal(categoryForDecision(decision).category, "Copilot Studio");
});

check("specialized model identities survive the SVG projection", () => {
  for (const id of ["foundry_underwriting_model_ops", "foundry_contact_center_multimodel", "foundry_manufacturing_quality", "hybrid_fabric_scoring_finance"]) {
    const input = example(id);
    const visual = svgText(buildArchitectureSvg(decide(input), input, new Map()));
    assert.match(visual, /Azure Machine Learning/, id);
    if (id === "foundry_underwriting_model_ops") assert.match(visual, /Fine-tuned Azure OpenAI model/);
  }
});

check("operational and Fabric grounding edges preserve access semantics", () => {
  const input: DecisionInput = {
    ...emptyInput(), users: ["internal_employees"], channels: ["portal"],
    capabilities: ["custom_app", "operational_query"], dataSources: ["on_prem"],
    behaviors: ["qa", "read_only_query"], runtimePreferences: ["custom_backend"],
    lifecycleControls: ["none"], securityControls: ["entra_id"], networkControls: ["on_prem_connectivity"]
  };
  const onPrem = buildMermaidDiagram(decide(input));
  assert.doesNotMatch(onPrem, /m\d+ --> k\d+/);
  const finance = buildMermaidDiagram(decide(example("hybrid_fabric_scoring_finance")));
  assert.match(finance, /analytics grounding/);
  assert.doesNotMatch(finance, /document grounding/);
  assert.match(finance, /in\d+ --> k2/);
});

check("Teams-only SQL lookup does not invent an API channel or document grounding", () => {
  const input = prepareDecisionInputForRecommendation({
    ...emptyInput(),
    summary: "Employees use Teams to look up order status in Azure SQL. The assistant is read-only.",
    directTextRecommendation: true
  });
  const decision = decide(input);
  assert.deepEqual(input.channels, ["teams"]);
  assert.deepEqual(input.dataSources, ["azure_sql"]);
  const svg = buildArchitectureSvg(decision, input, new Map());
  const titleIndex = svg.indexOf(">Channels</text>");
  assert.ok(titleIndex >= 0);
  const start = svg.lastIndexOf("<g><rect", titleIndex);
  const nextColumn = svg.indexOf("<g><rect", start + 1);
  const channelColumn = svgText(svg.slice(start, nextColumn < 0 ? undefined : nextColumn));
  assert.match(channelColumn, /Microsoft Teams/);
  assert.doesNotMatch(channelColumn, /\bAPI\b/);
  const flow = buildMermaidDiagram(decision);
  assert.doesNotMatch(flow, /document grounding|Azure AI Search|m\d+ --> k\d+/);
  assert.match(flow, /in\d+ --> k0/);
});

function coordinatedSqlInput(runtime: "copilot_studio" | "custom_backend" | "foundry_agent_service", behavior: "multi_agent" | "long_running_process", confirmed?: boolean): DecisionInput {
  return {
    ...emptyInput(),
    users: ["internal_employees"],
    channels: ["teams"],
    capabilities: behavior === "multi_agent" ? ["operational_query", "multi_agent"] : ["operational_query"],
    dataSources: ["azure_sql"],
    behaviors: ["qa", "read_only_query", behavior],
    runtimePreferences: [runtime],
    lifecycleControls: ["monitoring"],
    securityControls: ["entra_id", "audit"],
    networkControls: ["public"],
    ...(confirmed === undefined ? {} : { writeBackConfirmed: confirmed })
  };
}

check("read-only coordination remains visible without granting SQL writes", () => {
  for (const runtime of ["copilot_studio", "custom_backend", "foundry_agent_service"] as const) {
    for (const behavior of ["multi_agent", "long_running_process"] as const) {
      for (const confirmed of [undefined, false]) {
        const input = coordinatedSqlInput(runtime, behavior, confirmed);
        const decision = decide(input);
        const context = `${runtime}/${behavior}/${String(confirmed)}`;
        assert.equal(isActionable(input), false, context);
        assert.equal(requiresOrchestration(input), true, context);
        const orchestration = decision.architectureLayers.find((layer) => layer.layer === "Orchestration");
        assert.equal(orchestration?.required, true, context);
        const narrative = buildArchitectureSummary(input, decision, categoryForDecision(decision).category);
        assert.match(narrative, /Required coordination uses/, context);
        assert.match(narrative, /no business writes are authorized/, context);
        assert.doesNotMatch(narrative, /SQL writes use|All writes to|Controlled SQL write/i, context);
        const flow = buildMermaidDiagram(decision);
        assert.match(flow, /subgraph O\["Orchestration"\]/, context);
        assert.match(flow, /read-only/, context);
        const visual = svgText(buildArchitectureSvg(decision, input, new Map()));
        assert.match(visual, /Coordination|Durable Functions|Logic Apps|Power Automate/, context);
        assert.match(visual, /read-only/, context);
        if (orchestration?.selections.some((selection) => /Agent Framework/i.test(selection))) {
          assert.match(narrative, /Agent Framework/, context);
          assert.match(flow, /Agent Framework/, context);
          assert.match(visual, /Agent Framework/, context);
        }
      }
    }
  }
});

check("canonical selected coordination frameworks are not simultaneously blanket-forbidden", () => {
  const conflicts: string[] = [];
  for (const runtime of ["copilot_studio", "custom_backend", "foundry_agent_service"] as const) {
    for (const confirmed of [undefined, false]) {
      const decision = decide(coordinatedSqlInput(runtime, "multi_agent", confirmed));
      const selected = decision.architectureLayers.some((layer) =>
        layer.layer === "Orchestration" && layer.required && layer.selections.some((selection) => /Agent Framework/i.test(selection)));
      if (selected && decision.forbiddenUnlessConfirmed.some((item) => /^(?:Microsoft )?Agent Framework$/i.test(item.trim()))) {
        conflicts.push(`${runtime}/writeBackConfirmed=${String(confirmed)}`);
      }
    }
  }
  assert.deepEqual(conflicts, [], "Shared canonical decision must not select and blanket-forbid the same framework.");
});

check("external document summaries retain required read-only long-running coordination", () => {
  const input: DecisionInput = {
    ...coordinatedSqlInput("custom_backend", "long_running_process", false),
    users: ["partners"], channels: ["portal"],
    capabilities: ["custom_app", "document_rag"],
    dataSources: ["documents", "blob_storage"],
    behaviors: ["qa", "retrieval", "long_running_process"],
    advancedRagRequirements: ["hybrid_search"],
    securityControls: ["entra_external_id"],
    externalAccessConfirmed: true
  };
  const decision = decide(input);
  assert.equal(decision.architectureLayers.find((layer) => layer.layer === "Orchestration")?.required, true);
  assert.match(summary(input), /Required coordination uses/);
  assert.match(summary(input), /no business writes are authorized/);
  assert.doesNotMatch(summary(input), /SQL writes use|All writes to/);
});

check("explicit business writes keep their authorized action narrative", () => {
  const input: DecisionInput = {
    ...coordinatedSqlInput("copilot_studio", "multi_agent", true),
    capabilities: ["business_workflow", "record_update", "multi_agent"],
    behaviors: ["record_update", "multi_agent"],
    workflowExecution: ["controlled_action"]
  };
  assert.equal(isActionable(input), true);
  assert.equal(requiresOrchestration(input), true);
  assert.match(summary(input), /SQL writes use/);
  assert.doesNotMatch(summary(input), /no business writes are authorized/);
});

check("AI presentation cannot downgrade deterministic required controls", () => {
  const decision = decide(example("foundry_citizen_benefits_portal"));
  const review = reviewFor(decision, {
    recommendedStack: ["Azure AI Foundry"],
    securityControls: ["Entra External ID"],
    architectureLayers: [
      { layer: "Security", selections: ["Entra External ID"], required: false, reason: "AI wording" },
      { layer: "Integration", selections: ["Approved connector"], required: false, reason: "AI wording" }
    ],
    zeroTrust: { applicable: false, controls: ["A supplemental safeguard"], rationale: "Supplementary guidance" }
  });
  const presented = withAiRecommendation(decision, review);
  for (const name of ["Security", "Integration"]) {
    const original = decision.architectureLayers.find((layer) => layer.layer === name)!;
    const actual = presented.architectureLayers.find((layer) => layer.layer === name)!;
    assert.equal(actual.required, original.required);
    original.selections.forEach((selection) => assert.ok(actual.selections.includes(selection)));
  }
  decision.recommendedStack.forEach((selection) => assert.ok(presented.recommendedStack.includes(selection)));
  decision.securityControls.forEach((selection) => assert.ok(presented.securityControls.includes(selection)));
  decision.zeroTrust.controls.forEach((selection) => assert.ok(presented.zeroTrust.controls.includes(selection)));
});

check("deep validation and later refinements retain accepted context", () => {
  const first = recommendationNotes(null, "Keep all processing in the approved region.");
  assert.equal(recommendationNotes(first, ""), first);
  const second = recommendationNotes(`Deep validation: ${first}`, "Keep the solution read-only.");
  assert.ok(second.includes(first));
  assert.ok(second.includes("Keep the solution read-only."));
  assert.equal(recommendationNotes("Deep validation with GPT-5.4", ""), "");
  assert.equal(recommendationNotes(first, first), first);
});

check("actual report handlers preserve notes, clear old errors and reject AI diagram input", async () => {
  const input = example("copilot_hr_policy_teams");
  const decision = decide(input);
  const review = reviewFor(decision, { mermaidDiagram: 'flowchart LR\n BAD["UNCHECKED_DIAGRAM_MARKER"]' });
  const originalHooks = { useState: React.useState, useRef: React.useRef, useMemo: React.useMemo, useEffect: React.useEffect };
  const originalFetch = globalThis.fetch;
  const states: any[] = [true, null, "Previous initial review failed"];
  const refs: Array<{ current: any }> = [];
  const requests: Array<{ recommendationMode: string; userNotes?: string }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  type Element = { type: any; props: Record<string, any> };
  const descendants = (node: any): Element[] => Array.isArray(node)
    ? node.flatMap(descendants)
    : node?.props ? [node, ...descendants(node.props.children)] : [];
  const text = (node: any): string => typeof node === "string"
    ? node
    : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return descendants(FinalRecommendation({
      input, decision,
      usageSession: { id: "offline-output-check", source: "test", startedAt: "2026-09-21T00:00:00Z" },
      onBack() {}, onReset() {}
    }));
  };
  const button = (nodes: Element[], label: string) => {
    const found = nodes.find((node) => node.type === "button" && text(node) === label);
    assert.ok(found, `Button ${label} exists`);
    return found;
  };

  try {
    // Controlled hook state exercises real handlers/props without mounting a DOM or running effects.
    Object.assign(React, {
      useState(initial: any) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value: any) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef(initial: any) {
        const index = refIndex++;
        return refs[index] ?? (refs[index] = { current: initial });
      },
      useMemo(factory: () => unknown) { return factory(); },
      useEffect() {}
    });
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/tiebreak", "Only the mocked local review endpoint may be called.");
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify(review), { status: 200, headers: { "content-type": "application/json" } });
    };
    let nodes = render();
    const firstNotes = "FIRST_ACCEPTED_CONSTRAINT. Add an Azure ML endpoint for scoring.";
    nodes.find((node) => node.type === "textarea")!.props.onChange({ target: { value: firstNotes } });
    await button(render(), "Apply refinement").props.onClick();
    nodes = render();
    const pipeline = nodes.find((node) => typeof node.type === "function" && node.type.name === "AgentPipelinePanel");
    assert.equal(pipeline?.props.error, null, "Successful refinement clears obsolete initial errors.");
    await button(nodes, "Deep validate").props.onClick();
    nodes = render();
    nodes.find((node) => node.type === "textarea")!.props.onChange({ target: { value: "SECOND_ACCEPTED_CONSTRAINT" } });
    await button(render(), "Apply refinement").props.onClick();
    assert.equal(requests[1].recommendationMode, "deep");
    assert.equal(requests[1].userNotes, firstNotes);
    assert.match(requests[2].userNotes ?? "", /FIRST_ACCEPTED_CONSTRAINT[\s\S]*SECOND_ACCEPTED_CONSTRAINT/);
    nodes = render();
    const architectureTab = nodes.find((node) => node.type === "button" && text(node).startsWith("Architecture"));
    assert.ok(architectureTab);
    architectureTab.props.onClick();
    nodes = render();
    const diagram = nodes.find((node) => typeof node.type === "function" && node.type.name === "MermaidDiagram");
    const ppt = nodes.find((node) => typeof node.type === "function" && node.type.name === "ExportPPTButton");
    assert.ok(diagram && ppt);
    assert.doesNotMatch(diagram.props.code, /UNCHECKED_DIAGRAM_MARKER/);
    assert.equal(ppt.props.mermaidCode, diagram.props.code);
    assert.equal(ppt.props.mermaidFallback, diagram.props.fallbackCode);
    assert.match(ppt.props.refinement, /FIRST_ACCEPTED_CONSTRAINT[\s\S]*SECOND_ACCEPTED_CONSTRAINT/);
    assert.deepEqual(ppt.props.input, input, "Review notes must not silently rewrite the confirmed profile.");
    button(nodes, "Generate architecture").props.onClick();
    nodes = render();
    const imageContainer = nodes.find((node) => node.type === "div" && node.props.children?.type?.name === "ArchitectureImage");
    assert.equal(imageContainer?.props.className, "hidden");
    imageContainer!.props.children.props.onError("Synthetic renderer failure");
    const recovered = render().find((node) => node.type === "div" && node.props.children?.type?.name === "ArchitectureImage");
    assert.equal(recovered?.props.className, "", "A terminal renderer failure must expose the child's error instead of retaining the parent spinner.");
  } finally {
    Object.assign(React, originalHooks);
    globalThis.fetch = originalFetch;
  }
});

check("baseline and exports remain usable while capability is pending or disabled", async () => {
  const capability = deferredResponse();
  const requests: Array<{ url: string; method: string }> = [];
  const harness = mockReportLifecycle(async (url, options) => {
    requests.push({ url: String(url), method: options?.method ?? "GET" });
    assert.equal(url, "/api/tiebreak");
    assert.equal(options?.method, "GET", "Disabled capability must never launch model review.");
    return capability.promise;
  });
  try {
    assertUsableBaseline(harness.mount(), harness.decision);
    let nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    reportButton(nodes, "Technical").props.onClick();
    assert.deepEqual(reportComponent(harness.render(), "ArchitectureLayerTable").props.layers, harness.decision.architectureLayers);
    reportButton(harness.render(), "Architecture").props.onClick();
    nodes = harness.render();
    assert.equal(reportButton(nodes, "Generate architecture").props.disabled, false);
    assert.match(reportComponent(nodes, "MermaidDiagram").props.code, /^flowchart LR/);
    reportButton(nodes, "Overview").props.onClick();
    capability.resolve(jsonResponse({ enabled: false }));
    await settleUntil(() => harness.states[0] === false && harness.states[3] === false);
    nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    assert.equal(nodes.some((node) => node.type === "button" && /Apply refinement|Deep validate/.test(reportText(node))), false);
    const pipeline = reportComponent(nodes, "AgentPipelinePanel");
    const panelText = reportText(pipeline.type(pipeline.props));
    assert.match(panelText, /AI disabled/);
    assert.doesNotMatch(panelText, /\bwaiting\b|\brunning\b/i);
    assert.deepEqual(requests, [{ url: "/api/tiebreak", method: "GET" }]);
  } finally {
    harness.dispose();
  }
});

check("capability-check failure never launches a model request or hides the baseline", async () => {
  const methods: string[] = [];
  const harness = mockReportLifecycle(async (url, options) => {
    assert.equal(url, "/api/tiebreak");
    methods.push(options?.method ?? "GET");
    return jsonResponse({ error: "UPSTREAM_INTERNAL_DETAIL_MARKER" }, 503);
  });
  try {
    harness.mount();
    await settleUntil(() => harness.states[0] === false && harness.states[3] === false);
    const nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    assert.deepEqual(methods, ["GET"]);
    const pipeline = reportComponent(nodes, "AgentPipelinePanel");
    assert.match(pipeline.props.error, /availability could not be confirmed/i);
    assert.doesNotMatch(pipeline.props.error, /UPSTREAM_INTERNAL_DETAIL_MARKER/);
    assert.equal(nodes.some((node) => node.type === "button" && /Apply refinement|Deep validate/.test(reportText(node))), false);
  } finally {
    harness.dispose();
  }
});

check("enabled background review does not gate results and a disabled response is not retried", async () => {
  const model = deferredResponse();
  const methods: string[] = [];
  const harness = mockReportLifecycle(async (url, options) => {
    assert.equal(url, "/api/tiebreak", "Disabled model response must not trigger auth-refresh/retry calls.");
    methods.push(options?.method ?? "GET");
    return options?.method === "GET" ? jsonResponse({ enabled: true }) : model.promise;
  });
  try {
    harness.mount();
    await settleUntil(() => methods.includes("POST"));
    let nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    assert.equal(reportComponent(nodes, "AgentPipelinePanel").props.loading, true);
    reportButton(nodes, "Technical").props.onClick();
    assert.deepEqual(reportComponent(harness.render(), "ArchitectureLayerTable").props.layers, harness.decision.architectureLayers);
    reportButton(harness.render(), "Overview").props.onClick();
    model.resolve(jsonResponse({ error: "Pathfinder APIM is not enabled.", status: { enabled: false } }, 400));
    await settleUntil(() => harness.states[0] === false && harness.states[3] === false);
    nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    assert.match(reportComponent(nodes, "AgentPipelinePanel").props.error, /AI review is disabled/);
    assert.doesNotMatch(reportComponent(nodes, "AgentPipelinePanel").props.error, /Pathfinder APIM/);
    assert.deepEqual(methods, ["GET", "POST"]);
  } finally {
    harness.dispose();
  }
});

check("a successful optional initial review enriches the already-usable baseline", async () => {
  const model = deferredResponse();
  const methods: string[] = [];
  const harness = mockReportLifecycle(async (url, options) => {
    assert.equal(url, "/api/tiebreak");
    methods.push(options?.method ?? "GET");
    return options?.method === "GET" ? jsonResponse({ enabled: true }) : model.promise;
  });
  try {
    harness.mount();
    await settleUntil(() => methods.includes("POST"));
    assertUsableBaseline(harness.render(), harness.decision);
    const review = reviewFor(harness.decision, {
      useCaseSummary: "COMPLETED_OPTIONAL_REVIEW_MARKER",
      solutionType: categoryForDecision(harness.decision).category,
      displayPatternName: displayPatternName(harness.decision),
      finalRecommendation: harness.decision.finalRecommendation,
      recommendedStack: harness.decision.recommendedStack,
      architectureLayers: harness.decision.architectureLayers,
      endToEndFlow: harness.decision.endToEndFlow,
      rationale: harness.decision.rationale,
      securityControls: harness.decision.securityControls
    });
    model.resolve(jsonResponse(review));
    await settleUntil(() => !!harness.states[1] && harness.states[3] === false);
    const nodes = harness.render();
    assertUsableBaseline(nodes, harness.decision);
    assert.match(reportText(nodes), /COMPLETED_OPTIONAL_REVIEW_MARKER/);
    assert.deepEqual(reportComponent(nodes, "ExportPPTButton").props.tieBreak, review);
    assert.equal(reportComponent(nodes, "AgentPipelinePanel").props.loading, false);
    assert.deepEqual(methods, ["GET", "POST"]);
  } finally {
    harness.dispose();
  }
});

check("failed optional updates retain the last usable review and transient capacity remains retryable", async () => {
  const originalDecision = decide(example("copilot_hr_policy_teams"));
  const previous = reviewFor(originalDecision, { finalRecommendation: "LAST_USABLE_RECOMMENDATION_MARKER", useCaseSummary: "LAST_USABLE_SUMMARY_MARKER" });
  const initial: any[] = [true, previous];
  initial[9] = "PREVIOUS_ACCEPTED_NOTE";
  const deep = deferredResponse();
  let calls = 0;
  const harness = mockReportLifecycle(async (url, options) => {
    assert.equal(url, "/api/tiebreak");
    assert.equal(options?.method, "POST");
    calls++;
    return calls === 1
      ? deep.promise
      : calls === 2
      ? jsonResponse({ error: "AI review is temporarily at capacity.", status: 429 }, 429)
      : jsonResponse({ error: "Pathfinder APIM is not enabled.", status: { enabled: false } }, 400);
  }, initial);
  try {
    const pending = reportButton(harness.render(), "Deep validate").props.onClick();
    let nodes = harness.render();
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.tieBreak, previous);
    assert.match(reportText(nodes), /LAST_USABLE_SUMMARY_MARKER/);
    assert.doesNotMatch(reportText(nodes), /Preparing recommendation/);
    deep.resolve(jsonResponse({ error: "RAW_PROVIDER_ERROR_MARKER" }, 503));
    await pending;
    nodes = harness.render();
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.tieBreak, previous);
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.refinement, "PREVIOUS_ACCEPTED_NOTE");
    assert.doesNotMatch(reportText(nodes), /RAW_PROVIDER_ERROR_MARKER/);
    nodes.find((node) => node.type === "textarea")!.props.onChange({ target: { value: "NEW_UNACCEPTED_DRAFT" } });
    await reportButton(harness.render(), "Apply refinement").props.onClick();
    nodes = harness.render();
    assert.equal(harness.states[0], true, "A transient 429 is not a permanently disabled capability.");
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.tieBreak, previous);
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.refinement, "PREVIOUS_ACCEPTED_NOTE");
    assert.match(reportComponent(nodes, "AgentPipelinePanel").props.error, /temporarily at capacity/);
    assert.equal(calls, 2);
    await reportButton(nodes, "Deep validate").props.onClick();
    nodes = harness.render();
    assert.equal(harness.states[0], false);
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.tieBreak, previous);
    assert.equal(reportComponent(nodes, "ExportPPTButton").props.refinement, "PREVIOUS_ACCEPTED_NOTE");
    assert.match(reportComponent(nodes, "AgentPipelinePanel").props.error, /AI review is disabled/);
    assert.doesNotMatch(reportText(nodes), /Pathfinder APIM/);
    assert.equal(nodes.some((node) => node.type === "button" && /Apply refinement|Deep validate/.test(reportText(node))), false);
    assert.equal(calls, 3, "A disabled response must not trigger a retry.");
  } finally {
    harness.dispose();
  }
});

check("Markdown escapes table cells and exports complete review context", () => {
  const input = example("copilot_hr_policy_teams");
  const decision = decide(input);
  decision.architectureLayers[0] = { ...decision.architectureLayers[0], reason: "read | audit\nline two" };
  const review = reviewFor(decision, { riskFlags: ["AI_RISK_MARKER"], questionsToAskNext: ["CONFIRM_MARKER"], mustNotInclude: ["EXCLUSION_MARKER"] });
  const markdown = toMarkdown(input, decision, review, "ACCEPTED_REFINEMENT_MARKER");
  assert.match(markdown, /read \\\| audit<br>line two/);
  for (const marker of ["AI_RISK_MARKER", "CONFIRM_MARKER", "EXCLUSION_MARKER", "ACCEPTED_REFINEMENT_MARKER"]) assert.ok(markdown.includes(marker));
  const json = JSON.parse(toJSON(input, decision, review, "ACCEPTED_REFINEMENT_MARKER"));
  assert.deepEqual(json.review, review);
  assert.equal(json.refinement, "ACCEPTED_REFINEMENT_MARKER");
  assert.equal(json.input.summary, input.summary);
});

check("native knowledge does not become a fictitious Not required integration service", () => {
  assert.doesNotMatch(summary(example("copilot_hr_policy_teams")), /through Not required|Not required.*for governed access/);
});

check("slide pagination bounds long sentences without dropping content", () => {
  assert.throws(() => splitIntoSlideChunks("text", 0), RangeError);
  const text = `${"unbroken".repeat(180)} ${"long sentence ".repeat(250)}`;
  const chunks = splitIntoSlideChunks(text, 720);
  assert.ok(chunks.every((chunk) => chunk.length <= 720));
  assert.equal(chunks.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
});

check("real PPTX appendix preserves every condition, question, control and narrative", async () => {
  const input = example("hybrid_fabric_scoring_finance");
  const decision = decide(input);
  const markers = Array.from({ length: 9 }, (_, index) => `LATE_RISK_${index + 1}_MARKER`);
  decision.missingQuestions = [{ id: "review-confirmation", type: "text", layer: "Validation", title: "MISSING_QUESTION_MARKER", required: true }];
  const review = reviewFor(decision, {
    riskFlags: markers,
    assumptions: ["AI_ASSUMPTION_MARKER"],
    questionsToAskNext: ["FOLLOWUP_QUESTION_MARKER"],
    mustNotInclude: ["AI_EXCLUSION_MARKER"],
    agentTrace: [{ agent: "Guardrail Verifier", status: "warning", summary: "CHECK_SUMMARY_MARKER", details: ["CHECK_DETAIL_MARKER"] }]
  });
  review.assumptions.push(...Array.from({ length: 8 }, (_, index) => `LATE_ASSUMPTION_${index + 1}_MARKER`));
  const architectureSummary = `FIRST_NARRATIVE_MARKER ${"Full architecture narrative detail. ".repeat(80)}\n\nSECOND_NARRATIVE_MARKER\n\nTHIRD_NARRATIVE_MARKER`;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  addArchitectureBlueprintSlide(deck, {
    input, decision, architectureSummary,
    useCaseSummary: reportUseCaseSummary(input, decision),
    solutionType: categoryForDecision(decision).category,
    displayPattern: displayPatternName(decision)
  });
  addReportDetailsSlides(deck, { input, decision, tieBreak: review, architectureSummary, refinement: "ACCEPTED_REFINEMENT_MARKER" });
  const zip = await JSZip.loadAsync(await deck.write({ outputType: "nodebuffer" }));
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const textFor = async (name: string) => [...(await zip.file(name)!.async("string")).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join("\n");
  const fullText = (await Promise.all(slideNames.map(textFor))).join("\n");
  for (const marker of [...markers, ...review.assumptions, "MISSING_QUESTION_MARKER", "FOLLOWUP_QUESTION_MARKER", "AI_EXCLUSION_MARKER", "CHECK_DETAIL_MARKER", "ACCEPTED_REFINEMENT_MARKER", "SECOND_NARRATIVE_MARKER", "THIRD_NARRATIVE_MARKER"]) {
    assert.ok(fullText.includes(marker), `${marker} must survive actual PPTX serialization`);
  }
  for (const control of decision.securityControls) assert.ok(fullText.includes(control), control);
  assert.ok(fullText.includes(input.summary!));
  const blueprint = await textFor("ppt/slides/slide1.xml");
  assert.doesNotMatch(blueprint, /Not required for this use case/);
  assert.doesNotMatch(blueprint, /\+ 1 more item\b/);
  assert.match(blueprint, /\+ \d{2} more items/);
});

check("read-only coordination survives actual PPTX export without a write-path narrative", async () => {
  const input = coordinatedSqlInput("custom_backend", "multi_agent", false);
  const decision = decide(input);
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  addReportDetailsSlides(deck, { input, decision, architectureSummary: summary(input) });
  const zip = await JSZip.loadAsync(await deck.write({ outputType: "nodebuffer" }));
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const texts = await Promise.all(slideNames.map(async (name) =>
    [...(await zip.file(name)!.async("string")).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("\n")));
  const fullText = texts.join("\n");
  assert.match(fullText, /Agent Framework/);
  assert.match(fullText, /Required coordination uses/);
  assert.match(fullText, /no business writes are authorized/);
  assert.doesNotMatch(fullText, /SQL writes use|All writes to/);
});

check("Fabric channel feasibility warning remains in report exports without forcing a reroute", async () => {
  const input: DecisionInput = {
    ...emptyInput(), users: ["internal_employees"], channels: ["teams", "m365_copilot"],
    capabilities: ["fabric_analytics"], dataSources: ["fabric_warehouse"],
    behaviors: ["analytics", "qa"], runtimePreferences: ["copilot_studio"],
    fabricAnalyticsIntent: "read_only_analytics_qa", fabricUserAccess: "internal_fabric_permissions"
  };
  const decision = decide(input);
  const warning = decision.riskFlags.find((risk) => /not currently supported.*Microsoft 365 Copilot/.test(risk));
  assert.ok(warning);
  assert.equal(decision.basePatternId, "copilot_studio_fabric_data_agent");
  assert.ok(decision.architectureLayers.find((layer) => layer.layer === "User/Channel")?.selections.includes("Microsoft 365 Copilot"));
  assert.ok(toMarkdown(input, decision).includes(warning));
  assert.ok(JSON.parse(toJSON(input, decision)).decision.riskFlags.includes(warning));
  assert.ok(svgText(buildArchitectureSvg(decision, input, new Map())).includes(warning));
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  addReportDetailsSlides(deck, { input, decision, architectureSummary: summary(input) });
  const zip = await JSZip.loadAsync(await deck.write({ outputType: "nodebuffer" }));
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const texts = await Promise.all(slideNames.map(async (name) =>
    [...(await zip.file(name)!.async("string")).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("\n")));
  assert.ok(texts.join("\n").includes(warning));
});

async function main() {
  let failures = 0;
  for (const item of checks) {
    try {
      await item.run();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${item.name}`, error);
    }
  }
  assert.equal(failures, 0, `${failures}/${checks.length} output regression checks failed`);
  console.log(`All ${checks.length} offline output regression checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
