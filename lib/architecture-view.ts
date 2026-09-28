import type { ArchitectureDecision, ArchitectureLayer, DecisionInput } from "./types";
import { isActionable } from "./rules";

export const ARCHITECTURE_DISCLAIMER = "Suggested architecture — requires review and validation before implementation.";

export type ViewLayerId = "channels" | "edge" | "runtime" | "models" | "grounding" | "interfaces" | "data" | "preparation";
export type ViewState = "selected" | "managed" | "confirm";
export type ViewNode = {
  id: string;
  label: string;
  detail: string;
  layer: ViewLayerId;
  kind: "component" | "platform" | "capability" | "source";
  state: ViewState;
  required: boolean;
  icon?: string;
  sourceLabels: string[];
  controls: string[];
};
export type ViewEdge = {
  from: string;
  to: string;
  label: string;
  kind: "request" | "query" | "preparation" | "contains" | "conditional";
};
export type ViewControl = { label: string; scope: string; required: boolean };
export type ArchitectureView = {
  version: 1;
  title: string;
  disclaimer: string;
  audience: string[];
  actionBoundary: string;
  layers: Array<{ id: ViewLayerId; title: string; description: string; nodes: ViewNode[] }>;
  edges: ViewEdge[];
  controls: {
    identity: ViewControl[];
    security: ViewControl[];
    readiness: ViewControl[];
    operations: ViewControl[];
    network: ViewControl[];
  };
  decisions: string[];
};

const LAYERS: Array<{ id: ViewLayerId; title: string; description: string }> = [
  { id: "channels", title: "Channels", description: "Where the user starts" },
  { id: "edge", title: "Edge & API policies", description: "The approved entry boundary" },
  { id: "runtime", title: "Experience & runtime", description: "Who owns the interaction and execution" },
  { id: "models", title: "Models", description: "Inference capabilities and their platform" },
  { id: "grounding", title: "Grounding & retrieval", description: "How authorized context is obtained" },
  { id: "interfaces", title: "Governed interfaces", description: "Controlled access to operational systems" },
  { id: "data", title: "Source systems", description: "Authoritative data and source permissions" },
  { id: "preparation", title: "Background preparation", description: "Separate from the interactive request" }
];

const audienceNames: Record<string, string> = {
  internal_employees: "Internal employees", external_customers: "External customers",
  citizens: "Citizens", partners: "Partners", admins: "Administrators",
  developers: "Developers", mixed: "Mixed audience", unknown: "Audience to confirm"
};
const sourceLayer: Record<ArchitectureLayer["layer"], ViewLayerId | null> = {
  "User/Channel": "channels", Identity: null, Experience: "runtime",
  "Runtime/Backend": "runtime", "Analytics/Grounding": "grounding",
  Orchestration: "runtime", "AI Platform": "models", "Knowledge/Data": "data",
  Integration: "interfaces", Security: null, Observability: null, "Network/Deployment": null
};
const icon = (family: string, name: string) => `/ms-icons/${family}/${name}.svg`;
type Definition = {
  id: string; label: string; layer: ViewLayerId; match: RegExp;
  kind?: ViewNode["kind"]; state?: ViewState; icon?: string;
};

const DEFINITIONS: Definition[] = [
  { id: "native-knowledge", label: "Copilot Studio native knowledge", layer: "grounding", match: /copilot studio.*native knowledge|native.*knowledge source/i, kind: "capability", state: "managed", icon: icon("power-platform", "copilot-studio") },
  { id: "copilot-model", label: "Microsoft-managed AI", layer: "models", match: /copilot studio.*(?:managed ai|managed model)/i, kind: "capability", state: "managed", icon: icon("power-platform", "copilot-studio") },
  { id: "copilot-coordination", label: "Copilot Studio coordination", layer: "runtime", match: /copilot studio.*(?:coordination|orchestration)/i, kind: "capability", state: "managed", icon: icon("power-platform", "copilot-studio") },
  { id: "foundry-agent", label: "Foundry Agent Service", layer: "runtime", match: /foundry agent service/i, icon: icon("azure", "foundry-agent-service") },
  { id: "custom-backend", label: "Custom backend", layer: "runtime", match: /\bbackend\b/i, kind: "capability" },
  { id: "copilot-studio", label: "Copilot Studio", layer: "runtime", match: /copilot studio/i, state: "managed", icon: icon("power-platform", "copilot-studio") },
  { id: "m365-copilot", label: "Microsoft 365 Copilot", layer: "runtime", match: /microsoft 365 copilot/i, state: "managed", icon: icon("fabric", "copilot") },
  { id: "fabric-agent", label: "Microsoft Fabric Data Agent", layer: "grounding", match: /fabric data agent/i, icon: icon("fabric", "data-agent") },
  { id: "search", label: "Azure AI Search", layer: "grounding", match: /azure ai search/i, icon: icon("azure", "azure-ai-search") },
  { id: "preparation", label: "Content preparation", layer: "preparation", match: /document.*(?:ingestion|indexing|preparation)|ocr.*pipeline|enriched chunks|retrieval chunks|index metadata/i, kind: "capability" },
  { id: "fine-tuned-openai", label: "Fine-tuned Azure OpenAI model", layer: "models", match: /fine.tuned.*azure openai|azure openai.*fine.tuned/i, icon: icon("azure", "azure-openai") },
  { id: "fine-tuned-foundry", label: "Fine-tuned Foundry model", layer: "models", match: /fine.tuned.*foundry|foundry.*fine.tuned/i, icon: icon("azure", "foundry-models") },
  { id: "openai", label: "Azure OpenAI deployment", layer: "models", match: /azure openai/i, icon: icon("azure", "azure-openai") },
  { id: "azure-ml", label: "Azure Machine Learning endpoint", layer: "models", match: /azure machine learning|azure ml|managed online endpoint/i, icon: icon("azure", "azure-machine-learning") },
  { id: "foundry", label: "Microsoft Foundry", layer: "models", match: /azure ai foundry|foundry models|foundry model catalog/i, kind: "platform", icon: icon("azure", "microsoft-foundry") },
  { id: "apim", label: "API Management", layer: "edge", match: /api management|\bapim\b/i, icon: icon("azure", "api-management") },
  { id: "waf", label: "Front Door / WAF", layer: "edge", match: /front door|\bwaf\b|web application firewall/i, icon: icon("azure", "front-door") },
  { id: "pbi", label: "Power BI semantic model", layer: "data", match: /power bi semantic|semantic model/i, kind: "source", icon: icon("fabric", "semantic-model") },
  { id: "lakehouse", label: "Fabric Lakehouse", layer: "data", match: /fabric lakehouse/i, kind: "source", icon: icon("fabric", "lakehouse") },
  { id: "warehouse", label: "Fabric Warehouse", layer: "data", match: /fabric warehouse/i, kind: "source", icon: icon("fabric", "warehouse") },
  { id: "onelake", label: "Fabric OneLake", layer: "data", match: /fabric onelake|\bonelake\b/i, kind: "source", icon: icon("fabric", "onelake") },
  { id: "kql", label: "KQL / Eventhouse", layer: "data", match: /\bkql\b|eventhouse/i, kind: "source", icon: icon("fabric", "kql-database") },
  { id: "sharepoint", label: "SharePoint", layer: "data", match: /sharepoint/i, kind: "source", icon: icon("m365", "sharepoint") },
  { id: "graph", label: "Microsoft 365 content", layer: "data", match: /microsoft graph|m365 content|microsoft 365 content/i, kind: "source", icon: icon("m365", "m365-cloud") },
  { id: "blob", label: "Blob Storage", layer: "data", match: /blob storage|blob files/i, kind: "source", icon: icon("azure", "storage-account") },
  { id: "sql", label: "Azure SQL", layer: "data", match: /azure sql|sql server|sql database/i, kind: "source", icon: icon("azure", "azure-sql") },
  { id: "dataverse", label: "Dataverse", layer: "data", match: /dataverse/i, kind: "source", icon: icon("power-platform", "dataverse") },
  { id: "business-api", label: "Business APIs", layer: "data", match: /business api|operational.*api|data.*\bapi\b/i, kind: "source" },
  { id: "erp", label: "ERP / CRM", layer: "data", match: /\berp\b|\bcrm\b/i, kind: "source" },
  { id: "on-prem", label: "On-premises systems", layer: "data", match: /on-prem/i, kind: "source", icon: icon("azure", "virtual-network") },
  { id: "documents", label: "Document repository", layer: "data", match: /documents|pdfs|document repository|files/i, kind: "source", icon: icon("m365", "m365-document") },
  { id: "teams", label: "Microsoft Teams", layer: "channels", match: /\bteams\b/i, icon: icon("m365", "teams-chat") },
  { id: "m365", label: "Microsoft 365", layer: "channels", match: /microsoft 365|\bm365\b/i, icon: icon("m365", "m365-cloud") },
  { id: "mobile", label: "Mobile app", layer: "channels", match: /\bmobile\b/i, kind: "capability" },
  { id: "web", label: "Web app / portal", layer: "channels", match: /web app|portal|website/i, kind: "capability" },
  { id: "api-channel", label: "API interface", layer: "channels", match: /^api(?: experience)?$/i, kind: "capability" },
  { id: "durable-functions", label: "Durable Functions", layer: "runtime", match: /durable functions/i, icon: icon("azure", "function-apps") },
  { id: "functions", label: "Azure Functions", layer: "runtime", match: /azure functions/i, icon: icon("azure", "function-apps") },
  { id: "logic-apps", label: "Logic Apps", layer: "runtime", match: /logic apps/i, icon: icon("azure", "logic-apps") },
  { id: "power-automate", label: "Power Automate", layer: "runtime", match: /power automate/i, icon: icon("power-platform", "power-automate") },
  { id: "app-service", label: "App Service", layer: "runtime", match: /app service/i, icon: icon("azure", "app-services") },
  { id: "container-apps", label: "Container Apps", layer: "runtime", match: /container apps/i, icon: icon("azure", "container-instances") },
  { id: "aks", label: "AKS", layer: "runtime", match: /\baks\b|kubernetes/i, icon: icon("azure", "aks") }
];

const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
const absent = (value: string) => /^(not required|none selected|no separate|no dedicated|not applicable)\b/i.test(value.trim());
function stableId(layer: string, value: string) {
  let hash = 2166136261;
  for (const character of value.toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${layer}-${(hash >>> 0).toString(16)}`;
}

export function buildArchitectureView(decision: ArchitectureDecision, input?: DecisionInput): ArchitectureView {
  const nodes = new Map<string, ViewNode>();
  const controls: ArchitectureView["controls"] = { identity: [], security: [], readiness: [], operations: [], network: [] };
  const decisions: string[] = [];
  const audience = (input?.users ?? []).map(value => audienceNames[value] ?? value);
  const addControl = (group: keyof ArchitectureView["controls"], label: string, scope: string, required: boolean) => {
    const existing = controls[group].find(item => item.label.toLowerCase() === label.toLowerCase());
    if (existing) existing.required ||= required;
    else controls[group].push({ label, scope, required });
  };
  const add = (definition: Omit<ViewNode, "sourceLabels" | "controls">, original: string) => {
    const existing = nodes.get(definition.id);
    if (existing) {
      existing.sourceLabels = unique([...existing.sourceLabels, original]).sort();
      existing.detail = unique([...existing.detail.split("\n"), ...definition.detail.split("\n")]).sort().join("\n");
      existing.required ||= definition.required;
      return existing;
    }
    const node = { ...definition, sourceLabels: [original], controls: [] };
    nodes.set(node.id, node);
    return node;
  };
  for (const layer of decision.architectureLayers) {
    for (const original of unique(layer.selections).filter(value => !absent(value))) {
      if (layer.layer === "User/Channel" && /users|employees|customers|policyholders|citizens|partners|audience/i.test(original) &&
          !/teams|microsoft 365|app\b|portal|\bapi\b|channel/i.test(original)) {
        if (!audience.length) audience.push(original);
        continue;
      }
      if (/prep for ai|semantic model readiness/i.test(original)) {
        addControl("readiness", original, "Semantic model configuration; does not grant access", layer.required);
        continue;
      }
      if (layer.layer === "Identity") { addControl("identity", original, "Selected application and source identity boundaries", layer.required); continue; }
      if (layer.layer === "Observability" || /evaluation.*tracing|tracing.*monitoring|model operations/i.test(original)) {
        addControl("operations", original, "Runtime, retrieval, model and source operations", layer.required); continue;
      }
      if (layer.layer === "Network/Deployment") { addControl("network", original, "Proposed deployment posture; validate before implementation", layer.required); continue; }
      if (layer.layer === "Security" && !/api management|\bapim\b|front door|\bwaf\b/i.test(original)) {
        addControl("security", original, /read permission|workspace|rls|ols|fabric|power bi|repository|source/i.test(original)
          ? "Enforced by each relevant source; permissions are not inherited across sources"
          : "Application and source boundaries", layer.required);
        continue;
      }
      const preferred = sourceLayer[layer.layer] ?? "edge";
      let definition: Definition | undefined;
      if (layer.layer === "Integration" && /governed fabric/i.test(original)) {
        definition = { id: "fabric-access", label: /report|api/i.test(original) ? "Governed Fabric reports / APIs" : "Governed Fabric storage access", layer: "interfaces", kind: "capability", match: /./, icon: icon("fabric", "fabric") };
      } else if (layer.layer === "Analytics/Grounding" && /operational|governed.*connector|data.access/i.test(original) &&
          !/fabric data agent|azure ai search|native knowledge/i.test(original)) {
        definition = { id: "governed-access", label: "Governed data access", layer: "interfaces", kind: "capability", match: /./ };
      } else if (layer.layer === "Integration" && !/api management|\bapim\b|front door|\bwaf\b|document.*(?:ingest|index|prepar)|ocr/i.test(original)) {
        if (/model deployment endpoint|azure ai search index/i.test(original)) continue;
        definition = { id: "governed-access", label: "Governed data access", layer: "interfaces", kind: "capability", match: /./ };
      } else if (layer.layer === "Runtime/Backend" && /backend/i.test(original)) {
        definition = DEFINITIONS.find(item => item.id === "custom-backend");
      } else if (layer.layer === "Knowledge/Data" && /\bapis?\b/i.test(original)) {
        definition = DEFINITIONS.find(item => item.id === "business-api");
      } else {
        definition = DEFINITIONS.find(item => item.match.test(original) &&
          (item.layer !== "data" || layer.layer === "Knowledge/Data") &&
          (item.layer !== "channels" || layer.layer === "User/Channel" || layer.layer === "Experience"));
      }
      if (!definition && /authorization|permission|rbac|entitlement/i.test(original)) {
        addControl("security", original, "Applied before source access", layer.required); continue;
      }
      const id = definition?.id ?? stableId(preferred, original);
      add({
        id, label: `${definition?.label ?? original}${layer.layer === "Orchestration" && /read[- ]only/i.test(original) && definition ? " (read-only)" : ""}`, detail: layer.reason,
        layer: definition?.layer ?? preferred, kind: definition?.kind ?? "component",
        required: layer.required,
        state: definition?.state ?? (/to confirm|unknown|unresolved/i.test(original) ? "confirm" : "selected"),
        icon: definition?.icon
      }, original);
    }
  }

  // A generic document type is not a second repository when its concrete store is selected.
  if (nodes.has("documents") && nodes.has("blob")) nodes.delete("documents");
  const data = [...nodes.values()].filter(node => node.layer === "data");
  const documentSources = data.filter(node => ["documents", "blob", "sharepoint", "graph"].includes(node.id));
  const fabricSources = data.filter(node => ["pbi", "lakehouse", "warehouse", "onelake", "kql"].includes(node.id));
  const operationalSources = data.filter(node => !documentSources.includes(node) && !fabricSources.includes(node));
  for (const source of data) {
    source.controls = controls.security.filter(control => control.required && (
      /source|repository|least.privilege|authorization|rbac/i.test(control.label) ||
      (source.id === "pbi" && /read permission|workspace|rls|ols|power bi/i.test(control.label)) ||
      (fabricSources.includes(source) && /fabric/i.test(control.label))
    )).map(control => control.label);
    if (!source.controls.length) source.controls.push("Confirm least-privilege source authorization");
  }

  if (documentSources.length && !nodes.has("search") && !nodes.has("native-knowledge")) {
    add({
      id: "retrieval-decision", label: "Document retrieval design", detail: "Confirm the repository, permission-aware retrieval and citation behavior.",
      layer: "grounding", kind: "capability", state: "confirm", required: true, icon: icon("m365", "m365-document")
    }, "Document retrieval design to confirm");
    decisions.push("Confirm the document repository and permission-aware retrieval design before treating the document-answer path as implemented.");
  }
  if (nodes.has("search") && documentSources.length && !nodes.has("preparation")) {
    add({
      id: "preparation", label: "Content preparation", detail: "A separately authorized preparation identity populates derived search content before queries.",
      layer: "preparation", kind: "capability", state: "confirm", required: true
    }, "Confirm ingestion, indexing and any embedding configuration");
    decisions.push("Confirm the ingestion owner, derived-content permissions and any embedding/vectorization configuration.");
  }
  if (operationalSources.length && !nodes.has("governed-access")) {
    add({
      id: "governed-access", label: "Governed data access", detail: "An application/tool capability, not an additional deployment. Source authorization remains authoritative.",
      layer: "interfaces", kind: "capability", state: "selected", required: true
    }, "Controlled source operations");
  }
  if (fabricSources.length && !nodes.has("fabric-agent") && !nodes.has("fabric-access")) {
    add({ id: "fabric-access", label: "Governed Fabric access", detail: "Use the selected source interface and its permissions.", layer: "interfaces", kind: "capability", state: "selected", required: true, icon: icon("fabric", "fabric") }, "Governed Fabric source access");
  }
  const edges: ViewEdge[] = [];
  const connect = (from: string | undefined, to: string | undefined, label: string, kind: ViewEdge["kind"] = "request") => {
    if (!from || !to || from === to || !nodes.has(from) || !nodes.has(to)) return;
    const effectiveKind = (kind === "request" || kind === "query") && (!nodes.get(from)!.required || !nodes.get(to)!.required) ? "conditional" : kind;
    if (!edges.some(edge => edge.from === from && edge.to === to && edge.label === label)) edges.push({ from, to, label, kind: effectiveKind });
  };
  const runtime = [...nodes.values()].filter(node => node.layer === "runtime");
  const entry = ["copilot-studio", "custom-backend", "m365-copilot", "foundry-agent"].find(id => nodes.has(id)) ?? runtime[0]?.id;
  const processor = nodes.has("foundry-agent") ? "foundry-agent" : entry;
  const gateways = ["waf", "apim"].filter(id => nodes.has(id));
  const channels = [...nodes.values()].filter(node => node.layer === "channels");
  const entryNodes = new Set<string>();
  for (const channel of channels) {
    const customChannel = ["mobile", "web", "api-channel"].includes(channel.id);
    const channelEntry = customChannel && nodes.has("custom-backend") ? "custom-backend" : entry;
    if (channelEntry) entryNodes.add(channelEntry);
    connect(channel.id, customChannel && gateways.length ? gateways[0] : channelEntry, "approved entry");
  }
  const gatewayEntry = nodes.has("custom-backend") ? "custom-backend" : entry;
  if (gateways.length && gatewayEntry) entryNodes.add(gatewayEntry);
  gateways.forEach((id, index) => connect(id, gateways[index + 1] ?? gatewayEntry, "gateway policy"));
  if (!entryNodes.size && entry) entryNodes.add(entry);
  for (const runtimeEntry of entryNodes) {
    if (nodes.has("foundry-agent") || runtimeEntry === entry) connect(runtimeEntry, processor, "delegated execution");
  }
  runtime.filter(node => !entryNodes.has(node.id) && node.id !== processor).forEach(node => connect(processor, node.id, "hosting / coordination", "contains"));
  const inference = [...nodes.values()].filter(node => node.layer === "models" && node.kind !== "platform");
  inference.forEach(node => {
    connect(node.id === "copilot-model" && nodes.has("copilot-studio") ? "copilot-studio" : processor, node.id, "inference with approved context");
    if (node.id !== "copilot-model") connect("foundry", node.id, "platform hosts deployment", "contains");
  });
  if (nodes.has("foundry") && !inference.length) connect(processor, "foundry", "confirm model endpoint", "conditional");
  for (const source of operationalSources) {
    connect(processor, "governed-access", "authorized operation");
    connect("governed-access", source.id, "source permissions", "query");
  }
  if (nodes.has("search")) {
    connect(processor, "search", "permission-filtered retrieval", "query");
    documentSources.forEach(source => connect(source.id, "preparation", "authorized background read", "preparation"));
    connect("preparation", "search", "populate derived index", "preparation");
  } else if (nodes.has("native-knowledge")) {
    connect(processor, "native-knowledge", "managed retrieval", "query");
    documentSources.forEach(source => connect("native-knowledge", source.id, "source permissions", "query"));
  } else if (nodes.has("retrieval-decision")) {
    connect(processor, "retrieval-decision", "design not yet confirmed", "conditional");
    documentSources.forEach(source => connect("retrieval-decision", source.id, "confirm governed retrieval", "conditional"));
  }
  if (nodes.has("fabric-agent")) {
    connect(processor, "fabric-agent", "governed analytics", "query");
    for (const source of fabricSources) {
      if (nodes.has("pbi") && source.id !== "pbi") {
        source.state = "confirm";
        source.detail = "Confirm this source's preparation or independent-query role and permissions; semantic-model RLS does not automatically apply.";
        connect("fabric-agent", source.id, "source role / permissions to confirm", "conditional");
        decisions.push(`Confirm the ${source.label} role independently of the semantic model's query and authorization boundary.`);
      } else connect("fabric-agent", source.id, "source-scoped analytics permissions", "query");
    }
  } else {
    for (const source of fabricSources) {
      connect(processor, "fabric-access", "governed Fabric interface");
      connect("fabric-access", source.id, "approved source operation", "query");
    }
  }
  for (const node of nodes.values()) {
    if (entry && node.id !== entry && !edges.some(edge => edge.from === node.id || edge.to === node.id)) {
      node.state = "confirm";
      connect(entry, node.id, "confirm responsibility and connection", "conditional");
    }
  }
  for (const node of nodes.values()) if (node.state === "confirm") decisions.push(`${node.label}: ${node.detail}`);
  const order = ["teams", "m365", "mobile", "web", "api-channel", "waf", "apim", "copilot-studio", "m365-copilot", "custom-backend", "foundry-agent", "copilot-coordination"];
  const nodeOrder = (node: ViewNode) => order.includes(node.id) ? order.indexOf(node.id) : order.length;
  for (const values of Object.values(controls)) values.sort((left, right) => left.label.localeCompare(right.label));
  for (const node of nodes.values()) node.controls.sort();
  return {
    version: 1, title: decision.basePatternName, disclaimer: ARCHITECTURE_DISCLAIMER,
    audience: unique(audience).sort(),
    actionBoundary: input ? isActionable(input) ? "Business actions only through approved interfaces" : "Read-only business interaction" : "Follow the confirmed action permissions",
    layers: LAYERS.map(layer => ({
      ...layer, nodes: [...nodes.values()].filter(node => node.layer === layer.id)
        .sort((left, right) => nodeOrder(left) - nodeOrder(right) || left.label.localeCompare(right.label))
    })),
    edges: edges.sort((left, right) => `${left.from}|${left.to}|${left.kind}|${left.label}`.localeCompare(`${right.from}|${right.to}|${right.kind}|${right.label}`)),
    controls, decisions: unique([...decisions, ...decision.missingQuestions.map(question => question.title), ...decision.riskFlags]).sort()
  };
}

export function architectureViewMermaid(view: ArchitectureView): string {
  const escape = (value: string) => value.replace(/["<>[\]{}|\r\n]/g, " ").trim();
  const nodes = view.layers.flatMap(layer => layer.nodes);
  const id = (value: string) => `n${nodes.findIndex(node => node.id === value)}`;
  const lines = ["flowchart LR"];
  for (const layer of view.layers.filter(item => item.nodes.length)) {
    lines.push(`  subgraph ${layer.id}["${escape(layer.title)}"]`);
    for (const node of layer.nodes) {
      lines.push(`    ${id(node.id)}["${escape(node.label)}${node.state === "confirm" ? " — CONFIRM" : !node.required ? " — OPTIONAL" : ""}"]`);
    }
    lines.push("  end");
  }
  for (const edge of view.edges) {
    lines.push(edge.kind === "conditional"
      ? `  ${id(edge.from)} -. "${escape(edge.label)}" .-> ${id(edge.to)}`
      : edge.kind === "contains" || edge.kind === "preparation"
      ? `  ${id(edge.from)} -. "${escape(edge.label)}" .-> ${id(edge.to)}`
      : `  ${id(edge.from)} -->|"${escape(edge.label)}"| ${id(edge.to)}`);
  }
  nodes.filter(node => node.controls.length).forEach(node => {
    const controlId = `c${nodes.indexOf(node)}`;
    lines.push(`  ${controlId}["${escape(node.controls.join("; "))}"]`);
    lines.push(`  ${controlId} -. "source boundary" .-> ${id(node.id)}`);
  });
  lines.push("  classDef default fill:#FFFFFF,stroke:#B8C8DB,color:#12243A;");
  const pending = nodes.filter(node => node.state === "confirm").map(node => id(node.id));
  if (pending.length) {
    lines.push("  classDef pending fill:#FFF5DD,stroke:#B77912,stroke-dasharray:5 4,color:#704A0B;");
    lines.push(`  class ${pending.join(",")} pending;`);
  }
  return lines.join("\n");
}
