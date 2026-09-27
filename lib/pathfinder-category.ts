import type { ArchitectureDecision, DecisionInput } from "./types";
import { lowConfidenceReason } from "./rules";

export type PathfinderCategory =
  | "Needs Clarification"
  | "Copilot Studio"
  | "AI Foundry"
  | "Hybrid Copilot Studio + AI Foundry";

export type CategoryInfo = {
  category: PathfinderCategory;
  description: string;
  badgeClass: string;
};

const BASE_TO_CATEGORY: Record<string, PathfinderCategory> = {
  clarification_required: "Needs Clarification",
  m365_copilot_productivity: "Copilot Studio",
  copilot_studio_internal_assistant: "Copilot Studio",
  copilot_studio_fabric_data_agent: "Copilot Studio",
  document_rag_agent: "AI Foundry",
  azure_ai_foundry_app: "AI Foundry",
  external_ai_app: "AI Foundry",
  business_action_agent: "AI Foundry",
  custom_ai_app: "AI Foundry"
};

const DESCRIPTIONS: Record<PathfinderCategory, string> = {
  "Needs Clarification":
    "Pathfinder needs a confirmed audience, access channel, and grounding/data path before selecting Copilot Studio, AI Foundry, or a hybrid architecture.",
  "Copilot Studio":
    "Copilot Studio is the solution family for Microsoft 365 and Teams-centered agents, including Fabric Data Agent, Graph, SharePoint, native knowledge, and Copilot Studio actions where selected.",
  "AI Foundry":
    "AI Foundry is the solution family for custom channels, Azure AI Foundry Agent Service, Foundry Models, Azure OpenAI model deployments, advanced RAG, external apps, and model operations.",
  "Hybrid Copilot Studio + AI Foundry":
    "Copilot Studio provides the user-facing conversational experience while AI Foundry supplies model deployments, model operations, evaluation, tracing, or custom model endpoints behind the scenes."
};

export function categoryForDecision(decision: ArchitectureDecision): CategoryInfo {
  const base = BASE_TO_CATEGORY[decision.basePatternId] ?? "AI Foundry";
  const hasFoundry = decision.overlays.some((o) => /foundry/i.test(o.id) || /foundry/i.test(o.name)) ||
    decision.overlays.some((o) => /model_customization/i.test(o.id)) ||
    decision.recommendedStack.some((s) => /foundry agent service|model catalog|fine-tuned|azure machine learning|azure ai foundry \(evaluation|foundry evaluation|foundry tracing|foundry monitoring/i.test(s)) ||
    decision.architectureLayers.some((layer) => layer.layer === "AI Platform" && layer.required && layer.selections.some((s) =>
      !/^(?:not required|no\b|none\b)/i.test(s.trim()) &&
      /^(?:azure ai foundry\b|foundry models\b|azure openai (?:model )?deployment\b|azure machine learning\b|fine-tuned\b|foundry model catalog\b)/i.test(s.trim()))) ||
    decision.architectureLayers.some((layer) => layer.layer === "Observability" && layer.selections.some((s) => /azure ai foundry evaluation|foundry evaluation|foundry tracing|foundry monitoring/i.test(s)));
  const hasHybrid = decision.overlays.some(
    (o) => /hybrid|private/i.test(o.id) || /hybrid|private/i.test(o.name)
  );
  const hasCopilotStudioExperience = decision.architectureLayers.some(
    (l) => l.layer === "Experience" && l.selections.some((s) => /copilot studio/i.test(s))
  );
  let category: PathfinderCategory = base;
  if (hasCopilotStudioExperience && hasFoundry) {
    category = "Hybrid Copilot Studio + AI Foundry";
  } else if (hasCopilotStudioExperience) {
    category = "Copilot Studio";
  } else if (hasFoundry || decision.basePatternId === "azure_ai_foundry_app") {
    category = "AI Foundry";
  }
  const badge: Record<PathfinderCategory, string> = {
    "Needs Clarification": "badge-warn",
    "Copilot Studio": "badge-info",
    "AI Foundry": "badge-success",
    "Hybrid Copilot Studio + AI Foundry": "badge-success"
  };
  return {
    category,
    description: decision.basePatternId === "m365_copilot_productivity"
      ? "Microsoft 365 Copilot is the native productivity experience over Microsoft Graph and existing tenant permissions; no custom agent or application is required."
      : hasHybrid
      ? `${DESCRIPTIONS[category]} Private/hybrid deployment controls are applied as an overlay.`
      : DESCRIPTIONS[category],
    badgeClass: badge[category]
  };
}

export function displayPatternName(decision: ArchitectureDecision): string {
  if (decision.basePatternId === "m365_copilot_productivity") return "Microsoft 365 Copilot";
  return categoryForDecision(decision).category;
}

export type ConfidencePresentation = {
  /** Drives the badge color only — independent of the logged engine confidence. */
  tone: "high" | "medium" | "low";
  /** Short, plain-language badge label shown instead of "low/medium/high confidence". */
  label: string;
  /** Optional one-line explanation of why, plus what to do about it. */
  detail?: string;
};

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Turn the engine confidence into plain, non-technical wording for end users. "low" is
 * never shown as a bare alarming label: a genuine Copilot-vs-Foundry fork reads as
 * "Comparing options", a Hybrid result reads as a positive "Hybrid solution", and a sparse
 * or skipped profile reads as an actionable nudge naming exactly what to add. The underlying
 * decision.confidence value is unchanged (still logged truthfully for analytics).
 */
export function describeConfidence(decision: ArchitectureDecision, input: DecisionInput): ConfidencePresentation {
  if (decision.confidence === "high") return { tone: "high", label: "Strong match" };
  if (decision.confidence === "medium") return { tone: "medium", label: "Good match" };
  const category = categoryForDecision(decision).category;
  const reason = lowConfidenceReason(input, decision.candidateBasePatternIds ?? []);
  if (reason?.code === "cross_family") {
    if (category.startsWith("Hybrid")) {
      return {
        tone: "medium",
        label: "Hybrid solution",
        detail: "This combines Copilot Studio and AI Foundry, so it intentionally draws on both families."
      };
    }
    return {
      tone: "low",
      label: "Comparing options",
      detail: `More than one route fits across ${joinWithAnd(reason.families)}. Confirm the profile requirements to resolve the alternatives; AI review cannot change the selected route.`
    };
  }
  if (reason?.code === "missing_gate") {
    return {
      tone: "low",
      label: "Add a detail",
      detail: `Tell us ${joinWithAnd(reason.gates)} to sharpen this recommendation.`
    };
  }
  if (reason?.code === "skipped_gates") {
    return {
      tone: "low",
      label: "Quick estimate",
      detail: `You skipped ${joinWithAnd(reason.gates)}. Add ${reason.gates.length > 1 ? "them" : "it"} for a sharper match.`
    };
  }
  return { tone: "low", label: "Still narrowing down" };
}

/**
 * Deterministic Mermaid diagram built from the decision's architecture layers.
 * Renders a left-to-right flow: User → Channel → Runtime → Knowledge/Data,
 * Controls, policies, security, networking and observability details stay in
 * the architecture layer table, not this high-level flow.
 */
export function buildMermaidDiagram(decision: ArchitectureDecision): string {
  const layerMap = new Map<string, string[]>();
  for (const l of decision.architectureLayers) {
    const items = l.selections.filter(
      (s) => s && s !== "Not required for this use case"
    );
    if (items.length > 0) layerMap.set(l.layer, items);
  }

  const safe = (s: string) =>
    s.replace(/[\[\]()|{}\r\n]/g, " ").replace(/"/g, "'").trim();
  const id = (prefix: string, i: number) => `${prefix}${i}`;

  const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));
  const labelFor = (value: string): string | null => {
    const text = value.toLowerCase();
    const readOnly = /read[- ]only/.test(text) ? " (read-only)" : "";
    if (/not required|permissions|least-privilege|rbac|authorization|audit trail|confirmation|policy|read-only access|\brls\b|\bols\b|conditional access|deny by default|prep for ai|versioning|readiness|region pinning|throttling|jwt|ip allow-list|secrets|certificates|prompt-shield|content safety/i.test(value)) return null;
    if (/copilot studio.*(?:orchestration|coordination)/i.test(value)) return `Copilot Studio Coordination${readOnly}`;
    if (text.includes("agent framework")) return `${text.includes("semantic kernel") ? "Agent Framework / Semantic Kernel" : "Agent Framework"}${readOnly}`;
    if (text.includes("semantic kernel")) return `Semantic Kernel${readOnly}`;
    if (text.includes("durable functions") && text.includes("logic apps")) return `Durable Functions / Logic Apps${readOnly}`;
    if (text.includes("copilot studio")) return "Copilot Studio";
    if (text.includes("microsoft 365 copilot")) return "Microsoft 365 Copilot";
    if (text.includes("teams")) return "Teams";
    if (text.includes("microsoft 365")) return "Microsoft 365";
    if (text.includes("sharepoint")) return "SharePoint";
    if (text.includes("microsoft graph")) return "Microsoft Graph";
    if (text.includes("fabric data agent")) return "Fabric Data Agent";
    if (text.includes("fabric onelake")) return "Fabric OneLake";
    if (text.includes("fabric lakehouse")) return "Fabric Lakehouse";
    if (text.includes("fabric warehouse")) return "Fabric Warehouse";
    if (text.includes("power bi semantic")) return "Power BI Semantic Model";
    if (text.includes("kql") || text.includes("eventhouse")) return "KQL / Eventhouse";
    if (text.includes("azure ai search")) return "Azure AI Search";
    if (text.includes("multi-model")) return "Multi-model Routing";
    if (text.includes("fine-tuned")) return "Fine-tuned Model";
    if (text.includes("model catalog")) return "Foundry Model Catalog";
    if (text.includes("azure machine learning") || text.includes("managed online endpoint")) return "Azure Machine Learning Endpoint";
    if (text.includes("azure ai foundry agent service")) return "Azure AI Foundry Agent Service";
    if (text.includes("azure ai foundry")) return "Azure AI Foundry";
    if (text.includes("azure openai")) return "Azure OpenAI Model Deployment";
    if (text.includes("power automate")) return `Power Automate${readOnly}`;
    if (text.includes("copilot studio action") || text.includes("action / tool")) return "Copilot Studio Action";
    if (text.includes("sql server connector")) return "SQL Server Connector";
    if (text.includes("logic apps")) return `Logic Apps${readOnly}`;
    if (text.includes("durable functions")) return `Durable Functions${readOnly}`;
    if (text.includes("azure functions") || text === "functions") return "Azure Functions";
    if (text.includes("app service")) return "Azure App Service";
    if (text.includes("container apps")) return "Azure Container Apps";
    if (text.includes("custom backend") || text.includes("backend api")) return "Custom Backend API";
    if (text.includes("apim") || text.includes("api management")) return "API Management";
    if (text.includes("custom connector")) return "Custom Connector";
    if (text.includes("connector") || text.includes("governed")) return "Governed Connector";
    if (text.includes("azure sql")) return "Azure SQL";
    if (text.includes("dataverse")) return "Dataverse";
    if (text.includes("business api")) return "Business APIs";
    if (text.includes("erp") || text.includes("crm")) return "ERP / CRM";
    if (text.includes("on-prem")) return "On-premises Systems";
    if (text.includes("blob")) return "Blob Storage";
    if (text.includes("documents") || text.includes("pdf")) return "Documents";
    if (text.includes("internet")) return "Internet";
    if (text.includes("entra external")) return "Entra External ID";
    if (text.includes("entra")) return "Entra ID";
    if (text.includes("key vault")) return "Key Vault";
    if (text.includes("managed identity")) return "Managed Identity";
    if (text.includes("front door") || text.includes("waf")) return "Front Door / WAF";
    if (text.includes("purview")) return "Microsoft Purview";
    if (text.includes("defender")) return "Microsoft Defender";
    if (text.includes("private link") || text.includes("private endpoint")) return "Private Link";
    if (text.includes("vnet")) return "VNet";
    if (text.includes("vpn") || text.includes("expressroute")) return "VPN / ExpressRoute";
    if (text.includes("app insights") || text.includes("application insights")) return "Application Insights";
    if (text.includes("log analytics")) return "Log Analytics";
    if (text.includes("copilot studio analytics")) return "Copilot Studio Analytics";
    return value.length <= 34 ? value : null;
  };

  const majorLabels = (items: string[], max = 4) =>
    unique(items.map((item) => labelFor(item)).filter((item): item is string => !!item)).slice(0, max);

  const lines: string[] = ["flowchart LR"];

  // helper to declare a cluster and return the first node for reliable linking
  const cluster = (
    subId: string,
    title: string,
    items: string[],
    nodePrefix: string,
    shape: "round" | "stadium" | "rect" = "rect"
  ): { lines: string[]; firstNode: string | null } => {
    if (items.length === 0) return { lines: [], firstNode: null };
    const out: string[] = [];
    out.push(`  subgraph ${subId}["${safe(title)}"]`);
    items.forEach((it, i) => {
      const nid = id(nodePrefix, i);
      const label = safe(it);
      if (shape === "round") out.push(`    ${nid}(["${label}"])`);
      else if (shape === "stadium") out.push(`    ${nid}(("${label}"))`);
      else out.push(`    ${nid}["${label}"]`);
    });
    out.push("  end");
    return { lines: out, firstNode: id(nodePrefix, 0) };
  };

  const users = majorLabels(layerMap.get("User/Channel") ?? [], 3);
  const runtime = majorLabels([
    ...(layerMap.get("Runtime/Backend") ?? []),
    ...(layerMap.get("Experience") ?? [])
  ], 4);
  const orchestration = majorLabels(layerMap.get("Orchestration") ?? [], 3);
  const models = majorLabels(layerMap.get("AI Platform") ?? [], 3);
  const knowledge = majorLabels(layerMap.get("Knowledge/Data") ?? [], 5);
  const grounding = majorLabels(layerMap.get("Analytics/Grounding") ?? [], 3);
  const integration = majorLabels(layerMap.get("Integration") ?? [], 4);

  const clusters = {
    U: cluster("U", "User / Channel", users, "u", "stadium"),
    R: cluster("R", "Runtime / Experience", runtime, "r"),
    O: cluster("O", "Orchestration", orchestration, "o"),
    M: cluster("M", "AI Platform", models, "m"),
    G: cluster("G", "Analytics / Grounding", grounding, "g"),
    IN: cluster("IN", "Integration", integration, "in"),
    K: cluster("K", "Knowledge / Data", knowledge, "k")
  };

  for (const c of Object.values(clusters)) lines.push(...c.lines);

  const isOperational = (value: string) => /azure sql|dataverse|erp|crm|business apis|on-premises systems/i.test(value);
  const isFabric = (value: string) => /fabric onelake|fabric lakehouse|fabric warehouse|power bi semantic|kql|eventhouse/i.test(value);
  const isDocument = (value: string) => /documents|blob storage|sharepoint|microsoft graph/i.test(value);
  const hasGovernedFabricAccess = (layerMap.get("Integration") ?? []).some((value) => /governed fabric/i.test(value));
  const needsGovernedAccess = knowledge.some((value) => isOperational(value) || (hasGovernedFabricAccess && isFabric(value)));
  const edge = (from: string | null, to: string | null, label?: string) => {
    if (from && to) lines.push(label ? `  ${from} -. ${label} .-> ${to}` : `  ${from} --> ${to}`);
  };

  const chain: Array<keyof typeof clusters> = [];
  if (users.length) chain.push("U");
  if (runtime.length) chain.push("R");
  if (orchestration.length) chain.push("O");
  for (let i = 0; i < chain.length - 1; i++) {
    edge(clusters[chain[i]].firstNode, clusters[chain[i + 1]].firstNode);
  }

  const runtimeNode = clusters.O.firstNode ?? clusters.R.firstNode ?? clusters.U.firstNode;
  models.forEach((_, index) => edge(runtimeNode, id("m", index), needsGovernedAccess ? "reasoning/generation" : undefined));
  const reasoningNode = clusters.M.firstNode ?? runtimeNode;
  const accessIndex = integration.findIndex((value) => /connector|power automate|logic apps|functions/i.test(value));
  const accessNode = integration.length ? id("in", Math.max(accessIndex, 0)) : null;
  if (needsGovernedAccess) {
    edge(runtimeNode, clusters.IN.firstNode);
    if (accessNode !== clusters.IN.firstNode) edge(clusters.IN.firstNode, accessNode);
  } else {
    edge(runtimeNode, clusters.IN.firstNode, "integration");
  }

  const groundedSources = new Set<number>();
  grounding.forEach((value, index) => {
    const fabricAgent = /fabric data agent/i.test(value);
    const documentSearch = /azure ai search/i.test(value);
    const groundingNode = id("g", index);
    edge(needsGovernedAccess ? runtimeNode : reasoningNode, groundingNode, needsGovernedAccess ? (fabricAgent ? "analytics" : "retrieval") : undefined);
    knowledge.forEach((source, sourceIndex) => {
      const matches = fabricAgent ? isFabric(source) : documentSearch ? isDocument(source) : !isOperational(source) && !hasGovernedFabricAccess;
      if (!matches) return;
      groundedSources.add(sourceIndex);
      edge(groundingNode, id("k", sourceIndex), fabricAgent ? "analytics grounding" : documentSearch ? "document grounding" : "grounding");
    });
  });
  knowledge.forEach((source, index) => {
    if (isOperational(source) || (hasGovernedFabricAccess && isFabric(source))) {
      edge(accessNode, id("k", index));
    } else if (!groundedSources.has(index)) {
      edge(reasoningNode, id("k", index));
    }
  });

  // styling
  lines.push("  classDef m365 fill:#E5F1FB,stroke:#0078D4,color:#0a2540;");
  lines.push("  classDef azure fill:#E8F5E9,stroke:#2E7D32,color:#1b3a1f;");
  lines.push("  classDef sec fill:#FFF4E5,stroke:#B45309,color:#5a2d04;");
  lines.push("  classDef data fill:#F3E8FF,stroke:#7E22CE,color:#3b0764;");
  return lines.join("\n");
}
