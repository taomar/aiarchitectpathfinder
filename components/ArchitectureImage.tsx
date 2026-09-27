"use client";

import { useEffect, useMemo, useState } from "react";
import { displayPatternName } from "@/lib/pathfinder-category";
import type { ArchitectureDecision, ArchitectureLayer, DecisionInput } from "@/lib/types";

type DiagramNode = { id: string; label: string; iconPath: string | null };
type ColumnSpec = { id: string; title: string; nodes: DiagramNode[] };
type LaneSpec = { id: string; title: string; nodes: DiagramNode[] };

const NOT_REQUIRED = "Not required for this use case";
const ICON_NOTE = "Microsoft architecture icon assets from Azure, Fabric, Power Platform, Microsoft 365, and Microsoft Entra icon sets.";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function isServiceLike(value: string) {
  const text = value.trim();
  if (!text || text === NOT_REQUIRED || text === "-") return false;
  if (/^none selected$|^not required/i.test(text)) return false;
  if (/^no\b|\bno separate\b|\bno dedicated\b|\bnot needed\b|\bnot applicable\b|\bwithout a separate\b/i.test(text)) return false;
  if (/\bnot part\b|\bnot selected\b|\bno .* required\b/i.test(text)) return false;
  if (/\boptional\b|\bif needed\b|\bif .* selected\b|\bunless\b|\breassess\b/i.test(text)) return false;
  if (/^selected (channel|identity provider|data source|experience|runtime)/i.test(text)) return false;
  return true;
}

function layerValues(decision: ArchitectureDecision, layerName: ArchitectureLayer["layer"]) {
  return decision.architectureLayers.find((layer) => layer.layer === layerName)?.selections.filter(isServiceLike) ?? [];
}

function userLabels(input?: DecisionInput) {
  const map: Record<string, string> = {
    internal_employees: "Internal employees",
    external_customers: "External customers",
    citizens: "Citizens",
    partners: "Partners / B2B users",
    admins: "Admins",
    developers: "Developers",
    mixed: "Mixed users",
    unknown: "Users"
  };
  return (input?.users?.length ? input.users : ["unknown"]).map((user) => map[user] ?? user).slice(0, 2);
}

function iconPathFor(label: string): string | null {
  const value = label.toLowerCase();
  if (/copilot studio/.test(value)) return "/ms-icons/power-platform/copilot-studio.svg";
  if (/power automate/.test(value)) return "/ms-icons/power-platform/power-automate.svg";
  if (/dataverse/.test(value)) return "/ms-icons/power-platform/dataverse.svg";
  if (/power apps/.test(value)) return "/ms-icons/power-platform/power-apps.svg";
  if (/power pages/.test(value)) return "/ms-icons/power-platform/power-pages.svg";
  if (/power platform/.test(value)) return "/ms-icons/power-platform/power-platform.svg";
  if (/fabric data agent/.test(value)) return "/ms-icons/fabric/data-agent.svg";
  if (/fabric warehouse/.test(value)) return "/ms-icons/fabric/warehouse.svg";
  if (/fabric lakehouse/.test(value)) return "/ms-icons/fabric/lakehouse.svg";
  if (/fabric onelake|onelake/.test(value)) return "/ms-icons/fabric/onelake.svg";
  if (/power bi semantic model|semantic model/.test(value)) return "/ms-icons/fabric/semantic-model.svg";
  if (/workspace|item permissions|fabric \/ power bi permissions|power bi/.test(value)) return "/ms-icons/fabric/power-bi.svg";
  if (/kql|eventhouse/.test(value)) return "/ms-icons/fabric/kql-database.svg";
  if (/microsoft fabric|fabric /.test(value)) return "/ms-icons/fabric/fabric.svg";
  if (/microsoft 365 copilot/.test(value)) return "/ms-icons/fabric/copilot.svg";
  if (/teams/.test(value)) return "/ms-icons/m365/teams-chat.svg";
  if (/sharepoint/.test(value)) return "/ms-icons/m365/sharepoint.svg";
  if (/^microsoft 365$|microsoft graph|microsoft 365 content|m365 content/.test(value)) return "/ms-icons/m365/m365-cloud.svg";
  if (/document|pdf|file/.test(value)) return "/ms-icons/m365/m365-document.svg";
  if (/entra external|external id|external identit/.test(value)) return "/ms-icons/azure/external-identities.svg";
  if (/managed identity|managed identities/.test(value)) return "/ms-icons/azure/managed-identities.svg";
  if (/entra|identity|conditional access|rbac|authorization/.test(value)) return "/ms-icons/entra/entra-id.svg";
  if (/azure openai/.test(value)) return "/ms-icons/azure/azure-openai.svg";
  if (/azure ai search|cognitive search|search/.test(value)) return "/ms-icons/azure/azure-ai-search.svg";
  if (/azure ai foundry|foundry models|ai foundry|model operations|model catalog|fine-tuned/.test(value)) return "/ms-icons/azure/azure-ai-studio.svg";
  if (/machine learning|azure ml|managed online endpoint/.test(value)) return "/ms-icons/azure/azure-machine-learning.svg";
  if (/api management|apim/.test(value)) return "/ms-icons/azure/api-management.svg";
  if (/app service|custom backend|web app|portal|mobile app|backend/.test(value)) return "/ms-icons/azure/app-services.svg";
  if (/logic apps/.test(value)) return "/ms-icons/azure/logic-apps.svg";
  if (/custom connector|connector/.test(value)) return "/ms-icons/azure/custom-connector.svg";
  if (/function|durable/.test(value)) return "/ms-icons/azure/function-apps.svg";
  if (/container apps|container instances/.test(value)) return "/ms-icons/azure/container-instances.svg";
  if (/aks|kubernetes/.test(value)) return "/ms-icons/azure/aks.svg";
  if (/azure sql/.test(value)) return "/ms-icons/azure/azure-sql.svg";
  if (/sql database|sql server/.test(value)) return "/ms-icons/azure/sql-database.svg";
  if (/blob|storage/.test(value)) return "/ms-icons/azure/storage-account.svg";
  if (/key vault|secret/.test(value)) return "/ms-icons/azure/key-vault.svg";
  if (/front door|cdn/.test(value)) return "/ms-icons/azure/front-door.svg";
  if (/waf|web application firewall/.test(value)) return "/ms-icons/azure/waf.svg";
  if (/firewall|defender/.test(value)) return "/ms-icons/azure/firewall.svg";
  if (/private link|private endpoint/.test(value)) return "/ms-icons/azure/private-link.svg";
  if (/vnet|virtual network/.test(value)) return "/ms-icons/azure/virtual-network.svg";
  if (/application insights/.test(value)) return "/ms-icons/azure/application-insights.svg";
  if (/log analytics/.test(value)) return "/ms-icons/azure/log-analytics.svg";
  if (/monitor|observability|audit/.test(value)) return "/ms-icons/azure/azure-monitor.svg";
  if (/purview/.test(value)) return "/ms-icons/azure/azure-ai-services.svg";
  if (/content safety|prompt shield|dlp|permission|workspace|read permission|prep for ai|rls|ols/.test(value)) return "/ms-icons/entra/entra-id.svg";
  return null;
}

function canonicalLabel(value: string) {
  const text = value.trim();
  const lower = text.toLowerCase();
  const readOnly = /read[- ]only/.test(lower) ? " (read-only)" : "";
  if (/copilot studio managed ai experience/.test(lower)) return "Copilot Studio managed AI experience";
  if (/copilot studio.*(?:orchestration|coordination)/.test(lower)) return `Copilot Studio Coordination${readOnly}`;
  if (/agent framework/.test(lower)) return `${/semantic kernel/.test(lower) ? "Agent Framework / Semantic Kernel" : "Agent Framework"}${readOnly}`;
  if (/semantic kernel/.test(lower)) return `Semantic Kernel${readOnly}`;
  if (/durable functions/.test(lower)) return `${/logic apps/.test(lower) ? "Durable Functions / Logic Apps" : "Durable Functions"}${readOnly}`;
  if (/copilot studio agent|copilot studio managed runtime|copilot studio/.test(lower)) return "Copilot Studio Agent";
  if (/microsoft 365 copilot/.test(lower)) return "Microsoft 365 Copilot";
  if (/^m365$|^microsoft 365$/.test(lower)) return "Microsoft 365";
  if (/teams/.test(lower)) return "Microsoft Teams";
  if (/web app/.test(lower)) return "Web app";
  if (/mobile app/.test(lower)) return "Mobile app";
  if (/portal/.test(lower)) return "Portal";
  if (/^api$|^api experience/.test(lower)) return "API";
  if (/^embedded/.test(lower)) return "Embedded experience";
  if (/^multiple channels/.test(lower)) return "Multiple channels";
  if (/front door|waf/.test(lower)) return lower.includes("waf") ? "Front Door + WAF" : "Azure Front Door";
  if (/api management|apim/.test(lower)) return "API Management";
  if (/governed fabric.*(?:api|report)/.test(lower)) return "Governed Fabric API / reports";
  if (/governed fabric.*(?:storage|processing)/.test(lower)) return "Governed Fabric storage access";
  if (/fabric data agent/.test(lower)) return "Microsoft Fabric Data Agent";
  if (/fine-tuned/.test(lower)) return /azure openai/.test(lower) ? "Fine-tuned Azure OpenAI model" : "Fine-tuned model";
  if (/azure machine learning|azure ml|managed online endpoint/.test(lower)) return "Azure Machine Learning";
  if (/azure ai foundry agent service/.test(lower)) return "Azure AI Foundry Agent Service";
  if (/azure openai/.test(lower)) return "Azure OpenAI deployment";
  if (/azure ai foundry|foundry models|model operations/.test(lower)) return "Azure AI Foundry";
  if (/azure ai search|cognitive search/.test(lower)) return "Azure AI Search";
  if (/power bi semantic/.test(lower)) return "Power BI Semantic Model";
  if (/fabric warehouse/.test(lower)) return "Fabric Warehouse";
  if (/fabric lakehouse/.test(lower)) return "Fabric Lakehouse";
  if (/fabric onelake|onelake/.test(lower)) return "Fabric OneLake";
  if (/kql|eventhouse/.test(lower)) return "KQL / Eventhouse";
  if (/sharepoint/.test(lower)) return "SharePoint";
  if (/microsoft graph|m365 content|microsoft 365 content/.test(lower)) return "Microsoft Graph";
  if (/document.*(?:ingestion|indexing)/.test(lower)) return "Document ingestion pipeline";
  if (/document|pdf|file/.test(lower)) return "Documents";
  if (/blob storage/.test(lower)) return "Blob Storage";
  if (/azure sql/.test(lower)) return "Azure SQL";
  if (/dataverse/.test(lower)) return "Dataverse";
  if (/business api/.test(lower)) return "Business APIs";
  if (/erp|crm/.test(lower)) return "ERP / CRM";
  if (/custom backend/.test(lower)) return "Custom backend";
  if (/app service/.test(lower)) return "Azure App Service";
  if (/container apps/.test(lower)) return "Azure Container Apps";
  if (/functions?/.test(lower)) return "Azure Functions";
  if (/logic apps/.test(lower)) return `Logic Apps${readOnly}`;
  if (/power automate/.test(lower)) return `Power Automate${readOnly}`;
  if (/custom connector/.test(lower)) return "Custom connector";
  if (/power platform connector/.test(lower)) return "Power Platform connector";
  if (/governed.*connector/.test(lower)) return "Governed connector";
  if (/managed identity/.test(lower)) return "Managed Identity";
  if (/key vault/.test(lower)) return "Key Vault";
  if (/entra external|external id/.test(lower)) return "Entra External ID";
  if (/entra|identity/.test(lower)) return "Microsoft Entra ID";
  if (/application insights/.test(lower)) return "Application Insights";
  if (/log analytics/.test(lower)) return "Log Analytics";
  if (/monitor|observability/.test(lower)) return "Azure Monitor";
  if (/private link|private endpoint/.test(lower)) return "Private Link";
  if (/virtual network|vnet/.test(lower)) return "Virtual Network";
  if (/fabric \/ power bi permissions/.test(lower)) return "Fabric / Power BI permissions";
  if (/read permission/.test(lower)) return "Power BI Semantic Model read permission";
  if (/workspace \/ item|workspace\/item/.test(lower)) return "Workspace / item permissions";
  if (/rls \/ ols|row-level|object-level/.test(lower)) return "RLS / OLS if applicable";
  if (/semantic model readiness|prep for ai/.test(lower)) return "Semantic model readiness / Prep for AI";
  if (/rbac|authorization/.test(lower)) return "RBAC / authorization checks";
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function makeNode(raw: string): DiagramNode | null {
  const label = canonicalLabel(raw);
  if (!isServiceLike(label)) return null;
  return { id: label.toLowerCase(), label, iconPath: iconPathFor(label) };
}

function unique(nodes: Array<DiagramNode | null>, max: number) {
  const seen = new Set<string>();
  const out: DiagramNode[] = [];
  for (const node of nodes) {
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    if (out.length >= max) break;
  }
  return out;
}

function stackNodes(decision: ArchitectureDecision, pattern: RegExp, max: number) {
  return unique(decision.recommendedStack.filter((item) => pattern.test(item)).map((item) => makeNode(item)), max);
}

function layerNodes(decision: ArchitectureDecision, layerName: ArchitectureLayer["layer"], max: number, filter?: RegExp) {
  return unique(layerValues(decision, layerName).filter((item) => !filter || filter.test(item)).map((item) => makeNode(item)), max);
}

function nodesFromValues(values: string[], max: number) {
  return unique(values.map((item) => makeNode(item)), max);
}

function isChannelValue(value: string) {
  const label = canonicalLabel(value);
  return ["Microsoft Teams", "Microsoft 365", "Microsoft 365 Copilot", "Web app", "Mobile app", "Portal", "API", "Embedded experience", "Multiple channels"].includes(label);
}

function isApimValue(value: string) {
  return /api management|apim/i.test(value);
}

function buildColumns(decision: ArchitectureDecision, input?: DecisionInput): ColumnSpec[] {
  const overlayIds = new Set(decision.overlays.map((overlay) => overlay.id));
  const forcedGrounding: DiagramNode[] = [];
  if (decision.basePatternId === "copilot_studio_fabric_data_agent" || overlayIds.has("fabric_data_agent")) {
    const node = makeNode("Microsoft Fabric Data Agent");
    if (node) forcedGrounding.push(node);
  }
  if (decision.basePatternId === "document_rag_agent" || overlayIds.has("document_rag_overlay")) {
    const node = makeNode("Azure AI Search");
    if (node) forcedGrounding.push(node);
  }
  const users = unique(userLabels(input).map((label) => makeNode(label)), 2);
  const channels = nodesFromValues([
    ...layerValues(decision, "User/Channel"),
    ...decision.recommendedStack
  ].filter(isChannelValue), 2);
  const runtime = unique([
    ...layerNodes(decision, "Experience", 2, /copilot studio|microsoft 365 copilot/i),
    ...layerNodes(decision, "Orchestration", 3, /agent framework|semantic kernel|coordination|orchestration|functions|logic apps|power automate/i),
    ...layerNodes(decision, "Runtime/Backend", 2, /agent service|custom backend|app service|functions|container|aks|copilot studio/i),
    ...stackNodes(decision, /copilot studio|foundry agent service|custom backend|app service|functions|container apps|aks/i, 2)
  ], 4);
  const modelCandidates = unique([
    ...layerNodes(decision, "AI Platform", 3),
    ...layerNodes(decision, "AI Platform", 20, /machine learning|fine-tuned|model catalog/i),
    ...stackNodes(decision, /azure ai foundry|azure openai|foundry models|machine learning|fine-tuned|model catalog|copilot studio managed/i, 20)
  ], 20).filter((node) => !/multi-model routing|agent service|^copilot studio agent$/i.test(node.label));
  modelCandidates.sort((a, b) => Number(/machine learning|fine-tuned/i.test(b.label)) - Number(/machine learning|fine-tuned/i.test(a.label)));
  const models = modelCandidates.length > 4
    ? [...modelCandidates.slice(0, 3), { id: "model-overflow", label: `+ ${modelCandidates.length - 3} model components; see details`, iconPath: null }]
    : modelCandidates;
  const knowledge = unique([
    ...layerNodes(decision, "Knowledge/Data", 4),
    ...stackNodes(decision, /power bi semantic|fabric warehouse|fabric lakehouse|fabric onelake|onelake|kql|eventhouse|sharepoint|microsoft graph|documents|pdf|blob storage|azure sql|dataverse|business api|erp|crm/i, 4)
  ], 3);
  const grounding = unique([
    ...forcedGrounding,
    ...layerNodes(decision, "Analytics/Grounding", 3, /fabric data agent|azure ai search|search|retrieval|grounding/i),
    ...stackNodes(decision, /fabric data agent|azure ai search/i, 3)
  ], 2);
  const needsGovernedAccess = layerValues(decision, "Knowledge/Data").some((value) => /azure sql|dataverse|erp|crm|business apis|on-prem/i.test(value)) ||
    layerValues(decision, "Integration").some((value) => /governed fabric/i.test(value));
  const access = layerNodes(decision, "Integration", 3, /governed fabric|connector|power automate|logic apps|functions|backend api|api management|apim/i);
  const placeholder = (id: string, label: string): DiagramNode => ({ id, label, iconPath: null });
  return [
    { id: "users", title: "Users", nodes: users.length ? users : [placeholder("users", "Users")] },
    { id: "channels", title: "Channels", nodes: channels.length ? channels : [placeholder("channel", "Channel to confirm")] },
    { id: "runtime", title: "Runtime", nodes: runtime.length ? runtime : [placeholder("runtime", "Runtime")] },
    { id: "models", title: "Models", nodes: models.length ? models : [placeholder("model", "Managed model")] },
    ...(grounding.length ? [{ id: "grounding", title: "AI Agents / Grounding", nodes: grounding }] : []),
    ...(needsGovernedAccess ? [{ id: "access", title: "Governed Access", nodes: access.length ? access : [placeholder("access", "Access path to confirm")] }] : []),
    { id: "knowledge", title: "Knowledge & Data", nodes: knowledge.length ? knowledge : [placeholder("knowledge", "Knowledge/Data")] }
  ];
}

function buildLanes(decision: ArchitectureDecision): LaneSpec[] {
  const identity = layerNodes(decision, "Identity", 3);
  const security = nodesFromValues([
    ...layerValues(decision, "Security"),
    ...decision.recommendedStack.filter((item) => /entra|permission|rbac|rls|ols|key vault|managed identity|defender|purview|dlp|conditional access/i.test(item))
  ].filter((item) => !isApimValue(item) && !/front door|waf|web application firewall/i.test(item)), 5);
  const integrationEdge = nodesFromValues([
    ...layerValues(decision, "Integration"),
    ...decision.recommendedStack.filter((item) => /api management|apim|front door|waf|custom connector|power automate|logic apps|durable functions|azure functions|model deployment endpoint|governed connector|backend api/i.test(item))
  ].filter((item) => /api management|apim|front door|waf|connector|power automate|logic apps|durable functions|azure functions|model deployment endpoint|governed fabric|backend api/i.test(item)), 5);
  const network = nodesFromValues(layerValues(decision, "Network/Deployment").filter((item) => !isApimValue(item)), 4);
  const observability = unique([
    ...layerNodes(decision, "Observability", 4),
    ...stackNodes(decision, /application insights|log analytics|monitor|foundry evaluation|tracing/i, 4)
  ], 4);
  return [
    { id: "identity", title: "Identity", nodes: identity },
    { id: "security", title: "Security", nodes: security },
    { id: "integration", title: "Integration / Edge", nodes: integrationEdge },
    { id: "network", title: "Network/Deployment", nodes: network },
    { id: "observability", title: "Observability", nodes: observability }
  ].filter((lane) => lane.nodes.length > 0);
}

function wrapText(value: string, maxChars = 17, maxLines = 3) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (!last || `${last} ${word}`.length > maxChars) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
    if (lines.length >= maxLines) break;
  }
  return lines;
}

function hexPoints(cx: number, cy: number, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + (Math.PI / 3) * index;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
}

function fallbackIcon(label: string, cx: number, cy: number) {
  if (/user|employee|customer|citizen|partner|admin|developer/i.test(label)) {
    return `<circle cx="${cx - 9}" cy="${cy - 8}" r="7" fill="#0078D4"/><circle cx="${cx + 10}" cy="${cy - 8}" r="7" fill="#005A9E"/><rect x="${cx - 22}" y="${cy + 4}" width="24" height="18" rx="8" fill="#0078D4"/><rect x="${cx + 1}" y="${cy + 4}" width="24" height="18" rx="8" fill="#005A9E"/>`;
  }
  const initials = label.split(/\s+|\//).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "MS";
  return `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#005A9E">${escapeXml(initials)}</text>`;
}

async function iconToDataUrl(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Icon not found: ${path}`);
  const svg = await response.text();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function buildIconDataMap(columns: ColumnSpec[], lanes: LaneSpec[]) {
  const paths = Array.from(new Set([...columns, ...lanes].flatMap((group) => group.nodes.map((node) => node.iconPath)).filter((path): path is string => !!path)));
  const entries = await Promise.all(paths.map(async (path) => {
    try {
      return [path, await iconToDataUrl(path)] as const;
    } catch {
      return [path, null] as const;
    }
  }));
  return new Map(entries);
}

function renderIcon(node: DiagramNode, cx: number, cy: number, iconData?: Map<string, string | null>, radius = 34) {
  const embeddedIcon = node.iconPath && iconData ? iconData.get(node.iconPath) : null;
  const icon = iconData ? embeddedIcon : node.iconPath;
  const imageSize = radius * 1.05;
  return `<polygon points="${hexPoints(cx, cy, radius)}" fill="#FFFFFF" stroke="#0078D4" stroke-width="2"/>${icon ? `<image href="${icon}" x="${cx - imageSize / 2}" y="${cy - imageSize / 2}" width="${imageSize}" height="${imageSize}" preserveAspectRatio="xMidYMid meet"/>` : fallbackIcon(node.label, cx, cy)}`;
}

function renderColumn(column: ColumnSpec, x: number, y: number, width: number, height: number, iconData?: Map<string, string | null>) {
  const visibleNodes = column.nodes.slice(0, 4);
  const nodeGap = visibleNodes.length >= 3 ? 122 : 118;
  const startY = visibleNodes.length === 1 ? y + height / 2 - 22 : y + 92;
  const nodes = visibleNodes.map((node, index) => {
    const cy = startY + index * nodeGap;
    const lines = wrapText(node.label, 20, 3);
    return `<g>${renderIcon(node, x + width / 2, cy, iconData, 32)}${lines.map((line, lineIndex) => `<text x="${x + width / 2}" y="${cy + 52 + lineIndex * 14}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="13" fill="#201F1E">${escapeXml(line)}</text>`).join("")}</g>`;
  }).join("");
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="#F8F9FA" stroke="#C8C6C4" stroke-width="1.4"/><text x="${x + width / 2}" y="${y + 28}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#323130">${escapeXml(column.title)}</text>${nodes}</g>`;
}

function renderLane(lane: LaneSpec, x: number, y: number, width: number, height: number, iconData?: Map<string, string | null>) {
  const titleWidth = 160;
  const available = width - titleWidth - 24;
  const visibleNodes = lane.nodes.slice(0, 5);
  const step = available / Math.max(visibleNodes.length, 1);
  const nodes = visibleNodes.map((node, index) => {
    const cx = x + titleWidth + 34 + step * index + Math.min(step / 2, 82);
    const cy = y + height / 2;
    const lines = wrapText(node.label, 26, 2);
    return `<g>${renderIcon(node, cx, cy, iconData, 29)}${lines.map((line, lineIndex) => `<text x="${cx + 46}" y="${cy - 4 + lineIndex * 14}" font-family="Segoe UI, Arial" font-size="12" fill="#201F1E">${escapeXml(line)}</text>`).join("")}</g>`;
  }).join("");
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#F8F9FA" stroke="#C8C6C4" stroke-width="1.3"/><text x="${x + 20}" y="${y + height / 2 - 2}" font-family="Segoe UI, Arial" font-size="18" font-weight="700" fill="#323130">${escapeXml(lane.title)}</text>${nodes}</g>`;
}

export function buildArchitectureSvg(decision: ArchitectureDecision, input?: DecisionInput, iconData?: Map<string, string | null>) {
  const columns = buildColumns(decision, input);
  const lanes = buildLanes(decision);
  const width = 1700;
  const marginX = 48;
  const titleY = 48;
  const topY = 84;
  const maxColumnNodes = Math.max(...columns.map((column) => Math.min(column.nodes.length, 4)), 1);
  const columnWidth = 206;
  const columnHeight = Math.max(330, 142 + maxColumnNodes * 118);
  const gap = (width - marginX * 2 - columnWidth * columns.length) / (columns.length - 1);
  const columnPositions = columns.map((column, index) => ({ column, x: marginX + index * (columnWidth + gap), centerX: marginX + index * (columnWidth + gap) + columnWidth / 2 }));
  const laneX = marginX;
  const laneWidth = width - marginX * 2;
  const identityY = topY + columnHeight + 60;
  const laneHeight = 96;
  const laneGap = 24;
  const lanePositions = lanes.map((lane, index) => ({ lane, y: identityY + index * (laneHeight + laneGap) }));
  const diagramHeight = lanePositions.length ? lanePositions[lanePositions.length - 1].y + laneHeight + 34 : topY + columnHeight + 60;
  const riskLines = decision.riskFlags.filter((risk) => risk.trim()).flatMap((risk) => wrapText(`Risk: ${risk}`, 185, Number.POSITIVE_INFINITY));
  const riskHeight = riskLines.length ? 54 + riskLines.length * 18 : 0;
  const height = diagramHeight + (riskHeight ? riskHeight + 24 : 0);
  const solidArrows = columnPositions.slice(0, -1).map((current, index) => {
    const next = columnPositions[index + 1];
    const y = topY + columnHeight / 2;
    return `<path d="M ${current.x + columnWidth} ${y} L ${next.x - 12} ${y}" stroke="#8A8886" stroke-width="2" fill="none" marker-end="url(#arrow-gray)"/>`;
  }).join("");
  const dashedConnectors = columnPositions.map(({ centerX }) => {
    const parts: string[] = [];
    let start = topY + columnHeight;
    for (const { y } of lanePositions) {
      parts.push(`<path d="M ${centerX} ${start} L ${centerX} ${y}" stroke="#8A8886" stroke-width="1.5" stroke-dasharray="5 5"/>`);
      start = y + laneHeight;
    }
    return parts.join("");
  }).join("");
  const riskNote = riskLines.length
    ? `<g><rect x="${marginX}" y="${diagramHeight}" width="${laneWidth}" height="${riskHeight}" rx="8" fill="#FFF7ED" stroke="#F7C46C"/><text x="${marginX + 16}" y="${diagramHeight + 25}" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#8A4B00">Validate before adoption</text>${riskLines.map((line, index) => `<text x="${marginX + 16}" y="${diagramHeight + 48 + index * 18}" font-family="Segoe UI, Arial" font-size="13" fill="#8A4B00">${escapeXml(line)}</text>`).join("")}</g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="max-width:100%;height:auto;display:block"><defs><marker id="arrow-gray" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#8A8886"/></marker></defs><rect width="${width}" height="${height}" fill="#FFFFFF"/><text x="${width / 2}" y="${titleY}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="34" font-weight="700" fill="#323130">${escapeXml(`Recommended Architecture — ${displayPatternName(decision)}`)}</text>${solidArrows}${dashedConnectors}${columnPositions.map(({ column, x }) => renderColumn(column, x, topY, columnWidth, columnHeight, iconData)).join("")}${lanePositions.map(({ lane, y }) => renderLane(lane, laneX, y, laneWidth, laneHeight, iconData)).join("")}${riskNote}</svg>`;
}

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ArchitectureImage({ decision, input, refreshNonce = 0, onGenerated, onError }: { decision: ArchitectureDecision; input?: DecisionInput; autoGenerate?: boolean; refreshNonce?: number; onGenerated?: (dataUrl: string | null) => void; onError?: (message: string) => void }) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(decision, input), [decision, input]);
  const lanes = useMemo(() => buildLanes(decision), [decision]);
  const decisionKey = `${decision.basePatternId}::${decision.overlays.map((overlay) => overlay.id).join(",")}::${decision.architectureLayers.map((layer) => `${layer.layer}:${layer.selections.join("|")}`).join(";")}::${decision.recommendedStack.join("|")}::${JSON.stringify(decision.riskFlags)}::${input?.users.join("|") ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    setSvgMarkup(null);
    setDataUrl(null);
    setError(null);
    onGenerated?.(null);
    (async () => {
      try {
        const directIconSvg = buildArchitectureSvg(decision, input);
        if (!cancelled) {
          setSvgMarkup(directIconSvg);
        }
        try {
          const iconData = await buildIconDataMap(columns, lanes);
          const embeddedIconSvg = buildArchitectureSvg(decision, input, iconData);
          const embeddedDataUrl = svgToDataUrl(embeddedIconSvg);
          if (!cancelled) {
            setSvgMarkup(embeddedIconSvg);
            setDataUrl(embeddedDataUrl);
            onGenerated?.(embeddedDataUrl);
          }
        } catch {
          const fallbackSvg = buildArchitectureSvg(decision, input, new Map());
          const fallbackDataUrl = svgToDataUrl(fallbackSvg);
          if (!cancelled) {
            setSvgMarkup(fallbackSvg);
            setDataUrl(fallbackDataUrl);
            onGenerated?.(fallbackDataUrl);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          const message = err?.message ?? "Failed to render Microsoft architecture diagram.";
          setError(message);
          onGenerated?.(null);
          onError?.(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, refreshNonce]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-success">Microsoft layered architecture diagram</span>
        {dataUrl ? <a className="btn-outline" href={dataUrl} download={`architecture-${decision.basePatternId}.svg`}>Download SVG</a> : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {!dataUrl && !error ? (
        <div className="mt-3 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ms-blue border-t-transparent" />
          <p className="mt-2 text-xs text-gray-600">Rendering Microsoft layered architecture diagram...</p>
        </div>
      ) : null}
      {svgMarkup ? (
        <div className="mt-3 border border-gray-200 rounded-lg bg-white p-3 shadow-sm">
          <div
            role="img"
            aria-label={`Architecture diagram for ${displayPatternName(decision)}`}
            className="w-full overflow-x-auto rounded"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-gray-500">{ICON_NOTE}</p>
    </div>
  );
}
