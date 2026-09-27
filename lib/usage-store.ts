import { createHash, randomUUID } from "node:crypto";
import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { userFromHeaderMap } from "./admin-auth";

// Offline GeoIP lookup. We store country metadata only, never raw IP addresses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const geoip = require("geoip-lite") as { lookup: (ip: string) => { country?: string } | null };

type UsageEventType =
  | "session_started"
  | "start_over"
  | "architecture_output"
  | "architecture_diagram_generated"
  | "powerpoint_exported";

export type UsageEventInput = {
  sessionId?: string;
  clientId?: string;
  eventType?: UsageEventType;
  source?: string;
  sourceDetail?: string;
  changeReason?: string;
  architectureFingerprint?: string;
  solutionType?: string;
  displayPattern?: string;
  basePatternId?: string;
  confidence?: string;
  lowConfidenceReason?: string;
  overlayCount?: number;
  directTextRecommendation?: boolean;
  users?: string[];
  channels?: string[];
  dataSources?: string[];
  modelStrategies?: string[];
};

type UsageEventDocument = Required<Pick<UsageEventInput, "sessionId" | "eventType">> & {
  id: string;
  type: "usageEvent";
  createdAt: string;
  day: string;
  userHash: string;
  ipHash?: string;
  countryCode?: string;
  countryName?: string;
  source: string;
  sourceDetail?: string;
  changeReason?: string;
  architectureFingerprint?: string;
  solutionType?: string;
  displayPattern?: string;
  basePatternId?: string;
  confidence?: string;
  lowConfidenceReason?: string;
  overlayCount?: number;
  directTextRecommendation?: boolean;
  users?: string[];
  channels?: string[];
  dataSources?: string[];
  modelStrategies?: string[];
};

export type UsageSummary = {
  configured: boolean;
  generatedAt: string;
  rangeDays: number;
  totals: {
    sessionsStarted: number;
    architectureSessions: number;
    architectureCreated: number;
    architectureModified: number;
    diagramGenerated: number;
    exports: number;
    uniqueUsers: number;
    totalEvents: number;
  };
  daily: Array<{
    day: string;
    sessionsStarted: number;
    architectureCreated: number;
    architectureModified: number;
    uniqueUsers: number;
    totalEvents: number;
  }>;
  bySource: Array<{ source: string; sessions: number; architectures: number }>;
  bySolutionType: Array<{ solutionType: string; count: number }>;
  byConfidence: Array<{ confidence: string; count: number }>;
  lowConfidenceReasons: Array<{ reason: string; count: number }>;
  byCountry: Array<{ country: string; countryCode: string; sessions: number; architectures: number; uniqueUsers: number }>;
  recentSessions: Array<{
    sessionId: string;
    firstSeen: string;
    lastSeen: string;
    source: string;
    sourceDetail?: string;
    userHash: string;
    country?: string;
    countryCode?: string;
    outputs: number;
    modifications: number;
    solutionType?: string;
    basePatternId?: string;
    confidence?: string;
    lowConfidenceReason?: string;
    directTextRecommendation?: boolean;
  }>;
  insights: string[];
  message?: string;
};

let containerPromise: Promise<Container | null> | null = null;

function usageConfig() {
  const endpoint = process.env.USAGE_COSMOS_ENDPOINT;
  const key = process.env.USAGE_COSMOS_KEY;
  const authMode = (process.env.USAGE_COSMOS_AUTH || "managedIdentity").toLowerCase();
  const database = process.env.USAGE_COSMOS_DATABASE || "pathfinderUsage";
  const container = process.env.USAGE_COSMOS_CONTAINER || "usageEvents";
  if (!endpoint) return null;
  return { endpoint, key, authMode, database, container };
}

export function usageConfigured() {
  return !!usageConfig();
}

async function usageContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const config = usageConfig();
      if (!config) return null;
      const useKey = config.authMode === "key" && !!config.key;
      const client = useKey
        ? new CosmosClient({ endpoint: config.endpoint, key: config.key })
        : new CosmosClient({ endpoint: config.endpoint, aadCredentials: new DefaultAzureCredential() });
      return client.database(config.database).container(config.container);
    })();
  }
  return containerPromise;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function headerValue(headerMap: Headers, name: string) {
  return headerMap.get(name) || headerMap.get(name.toLowerCase()) || headerMap.get(name.toUpperCase());
}

function normalizeIp(raw: string | undefined | null) {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  if (!first || first === "::1" || first === "127.0.0.1") return undefined;
  const bracket = first.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket?.[1]) return bracket[1].replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(first)) return first.replace(/:\d+$/, "");
  return first.replace(/^::ffff:/, "");
}

function countryNameFor(code: string | undefined) {
  if (!code || code === "ZZ") return "Unknown";
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function geoFromHeaders(headerMap: Headers) {
  const ip = normalizeIp(
    headerValue(headerMap, "x-forwarded-for") ||
      headerValue(headerMap, "x-client-ip") ||
      headerValue(headerMap, "x-real-ip") ||
      headerValue(headerMap, "cf-connecting-ip") ||
      headerValue(headerMap, "x-azure-clientip")
  );
  const lookup = ip ? geoip.lookup(ip) : null;
  const countryCode = lookup?.country?.toUpperCase() || "ZZ";
  return {
    ipHash: ip ? hash(ip) : undefined,
    countryCode,
    countryName: countryNameFor(countryCode)
  };
}

function cleanArray(values: unknown) {
  return Array.isArray(values)
    ? values.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
    : undefined;
}

function documentId(event: UsageEventInput, sessionId: string) {
  if (event.eventType === "architecture_output" && event.architectureFingerprint) {
    return `architecture:${hash(`${sessionId}:${event.architectureFingerprint}`)}`;
  }
  if (event.eventType === "architecture_diagram_generated" && event.architectureFingerprint) {
    return `diagram:${hash(`${sessionId}:${event.architectureFingerprint}`)}`;
  }
  return `${event.eventType || "event"}:${Date.now()}:${randomUUID()}`;
}

export async function recordUsageEvent(input: UsageEventInput, headerMap: Headers) {
  const container = await usageContainer();
  if (!container) return { recorded: false, configured: false };

  const eventType = input.eventType || "architecture_output";
  const sessionId = input.sessionId?.trim() || randomUUID();
  const user = userFromHeaderMap(headerMap);
  const userKey = user?.email || input.clientId || "anonymous";
  const geo = geoFromHeaders(headerMap);
  const createdAt = new Date().toISOString();
  const doc: UsageEventDocument = {
    id: documentId({ ...input, eventType }, sessionId),
    type: "usageEvent",
    sessionId,
    eventType,
    createdAt,
    day: createdAt.slice(0, 10),
    userHash: hash(userKey.toLowerCase()),
    ipHash: geo.ipHash,
    countryCode: geo.countryCode,
    countryName: geo.countryName,
    source: input.source?.trim() || "unknown",
    sourceDetail: input.sourceDetail?.trim() || undefined,
    changeReason: input.changeReason?.trim() || undefined,
    architectureFingerprint: input.architectureFingerprint?.trim() || undefined,
    solutionType: input.solutionType?.trim() || undefined,
    displayPattern: input.displayPattern?.trim() || undefined,
    basePatternId: input.basePatternId?.trim() || undefined,
    confidence: input.confidence?.trim() || undefined,
    lowConfidenceReason: input.lowConfidenceReason?.trim() || undefined,
    overlayCount: Number.isFinite(input.overlayCount) ? Number(input.overlayCount) : undefined,
    directTextRecommendation: input.directTextRecommendation === true || undefined,
    users: cleanArray(input.users),
    channels: cleanArray(input.channels),
    dataSources: cleanArray(input.dataSources),
    modelStrategies: cleanArray(input.modelStrategies)
  };
  await container.items.upsert(doc);
  return { recorded: true, configured: true, sessionId };
}

function countBy<T>(items: T[], key: (item: T) => string | undefined) {
  const map = new Map<string, number>();
  for (const item of items) {
    const value = key(item) || "Unknown";
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function emptyUsageSummary(generatedAt: string, rangeDays: number, insight: string, message: string): UsageSummary {
  return {
    configured: false,
    generatedAt,
    rangeDays,
    totals: {
      sessionsStarted: 0,
      architectureSessions: 0,
      architectureCreated: 0,
      architectureModified: 0,
      diagramGenerated: 0,
      exports: 0,
      uniqueUsers: 0,
      totalEvents: 0
    },
    daily: [],
    bySource: [],
    bySolutionType: [],
    byConfidence: [],
    lowConfidenceReasons: [],
    byCountry: [],
    recentSessions: [],
    insights: [insight],
    message
  };
}

export async function getUsageSummary(rangeDays = 30): Promise<UsageSummary> {
  const generatedAt = new Date().toISOString();
  let container: Container | null = null;
  try {
    container = await usageContainer();
  } catch (err: any) {
    console.error("[usage] Cosmos initialization failed:", err?.message ?? err);
    return emptyUsageSummary(
      generatedAt,
      rangeDays,
      "Usage storage is configured but currently unavailable. Check Cosmos DB networking and managed identity role assignments.",
      "Usage storage is currently unavailable."
    );
  }
  if (!container) {
    return emptyUsageSummary(
      generatedAt,
      rangeDays,
      "Usage storage is not configured yet. Set USAGE_COSMOS_ENDPOINT and grant the app managed identity Cosmos DB data-plane access to enable history.",
      "Usage storage is not configured."
    );
  }

  const days = Math.min(Math.max(rangeDays, 1), 180);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const query = {
    query:
      "SELECT c.id, c.sessionId, c.eventType, c.createdAt, c.day, c.userHash, c.countryCode, c.countryName, c.source, c.sourceDetail, c.changeReason, c.solutionType, c.basePatternId, c.confidence, c.lowConfidenceReason, c.directTextRecommendation FROM c WHERE c.type = @type AND c.createdAt >= @since",
    parameters: [
      { name: "@type", value: "usageEvent" },
      { name: "@since", value: since }
    ]
  };
  let resources: UsageEventDocument[] = [];
  try {
    ({ resources } = await container.items.query<UsageEventDocument>(query, { maxItemCount: 5000 }).fetchAll());
  } catch (err: any) {
    console.error("[usage] Cosmos query failed:", err?.message ?? err);
    return emptyUsageSummary(
      generatedAt,
      days,
      "Usage storage is configured but the app could not query it. Check Cosmos DB networking/firewall and managed identity access.",
      "Usage storage is currently unavailable."
    );
  }

  const bySession = new Map<string, UsageEventDocument[]>();
  const users = new Set<string>();
  for (const event of resources) {
    users.add(event.userHash);
    const events = bySession.get(event.sessionId) ?? [];
    events.push(event);
    bySession.set(event.sessionId, events);
  }

  const sessionRows = Array.from(bySession.entries()).map(([sessionId, events]) => {
    events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const outputs = events.filter((event) => event.eventType === "architecture_output");
    const first = events[0];
    const last = events[events.length - 1];
    const latestOutput = outputs[outputs.length - 1];
    const countryEvent = events.find((event) => event.countryCode && event.countryCode !== "ZZ") || latestOutput || first;
    return {
      sessionId,
      firstSeen: first.createdAt,
      lastSeen: last.createdAt,
      source: first.source || latestOutput?.source || "unknown",
      sourceDetail: first.sourceDetail || latestOutput?.sourceDetail,
      userHash: first.userHash,
      country: countryEvent.countryName || countryNameFor(countryEvent.countryCode),
      countryCode: countryEvent.countryCode || "ZZ",
      outputs: outputs.length,
      modifications: Math.max(outputs.length - 1, 0),
      solutionType: latestOutput?.solutionType,
      basePatternId: latestOutput?.basePatternId,
      confidence: latestOutput?.confidence,
      lowConfidenceReason: latestOutput?.lowConfidenceReason,
      directTextRecommendation: latestOutput?.directTextRecommendation,
      events
    };
  });

  const architectureSessions = sessionRows.filter((session) => session.outputs > 0);
  const dailyMap = new Map<string, { day: string; sessionsStarted: Set<string>; architectureCreated: Set<string>; architectureModified: number; uniqueUsers: Set<string>; totalEvents: number }>();
  for (const event of resources) {
    const item = dailyMap.get(event.day) ?? {
      day: event.day,
      sessionsStarted: new Set<string>(),
      architectureCreated: new Set<string>(),
      architectureModified: 0,
      uniqueUsers: new Set<string>(),
      totalEvents: 0
    };
    item.totalEvents += 1;
    item.uniqueUsers.add(event.userHash);
    if (event.eventType === "session_started") item.sessionsStarted.add(event.sessionId);
    dailyMap.set(event.day, item);
  }
  for (const session of architectureSessions) {
    const outputs = session.events.filter((event) => event.eventType === "architecture_output");
    outputs.forEach((event, index) => {
      const item = dailyMap.get(event.day) ?? {
        day: event.day,
        sessionsStarted: new Set<string>(),
        architectureCreated: new Set<string>(),
        architectureModified: 0,
        uniqueUsers: new Set<string>(),
        totalEvents: 0
      };
      if (index === 0) item.architectureCreated.add(event.sessionId);
      else item.architectureModified += 1;
      dailyMap.set(event.day, item);
    });
  }

  const daily = Array.from(dailyMap.values())
    .map((item) => ({
      day: item.day,
      sessionsStarted: item.sessionsStarted.size,
      architectureCreated: item.architectureCreated.size,
      architectureModified: item.architectureModified,
      uniqueUsers: item.uniqueUsers.size,
      totalEvents: item.totalEvents
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const sourceCounts = countBy(sessionRows, (session) => session.source).map((item) => ({
    source: item.name,
    sessions: item.count,
    architectures: architectureSessions.filter((session) => (session.source || "Unknown") === item.name).length
  }));
  const solutionCounts = countBy(architectureSessions, (session) => session.solutionType).map((item) => ({
    solutionType: item.name,
    count: item.count
  }));
  const byCountryMap = new Map<string, { country: string; countryCode: string; sessions: Set<string>; architectures: Set<string>; uniqueUsers: Set<string> }>();
  for (const session of sessionRows) {
    const countryCode = session.countryCode || "ZZ";
    const country = session.country || countryNameFor(countryCode);
    const row = byCountryMap.get(countryCode) ?? {
      country,
      countryCode,
      sessions: new Set<string>(),
      architectures: new Set<string>(),
      uniqueUsers: new Set<string>()
    };
    row.sessions.add(session.sessionId);
    row.uniqueUsers.add(session.userHash);
    if (session.outputs > 0) row.architectures.add(session.sessionId);
    byCountryMap.set(countryCode, row);
  }
  const byCountry = Array.from(byCountryMap.values())
    .map((item) => ({
      country: item.country,
      countryCode: item.countryCode,
      sessions: item.sessions.size,
      architectures: item.architectures.size,
      uniqueUsers: item.uniqueUsers.size
    }))
    .sort((a, b) => b.sessions - a.sessions || b.architectures - a.architectures || a.country.localeCompare(b.country));

  const architectureCreated = architectureSessions.length;
  const architectureModified = architectureSessions.reduce((sum, session) => sum + session.modifications, 0);
  const sessionsStarted = resources.filter((event) => event.eventType === "session_started").length;
  const conversion = sessionsStarted ? Math.round((architectureCreated / sessionsStarted) * 100) : architectureCreated ? 100 : 0;
  const avgMods = architectureCreated ? architectureModified / architectureCreated : 0;
  const busiest = daily.reduce((best, day) => (!best || day.totalEvents > best.totalEvents ? day : best), daily[0] as (typeof daily)[number] | undefined);
  const lowConfidence = architectureSessions.filter((session) => session.confidence === "low").length;
  const byConfidence = countBy(architectureSessions, (session) => session.confidence || "unknown").map((item) => ({
    confidence: item.name,
    count: item.count
  }));
  const lowReasonLabels: Record<string, string> = {
    cross_family: "Spans Copilot Studio + AI Foundry (AI tie-break decides)",
    missing_gate: "A core question was left empty",
    skipped_gates: "Two or more sections skipped"
  };
  const lowConfidenceReasons = countBy(
    architectureSessions.filter((session) => session.confidence === "low"),
    (session) => lowReasonLabels[session.lowConfidenceReason ?? ""] ?? "Unspecified / older session"
  ).map((item) => ({ reason: item.name, count: item.count }));
  const topLowReason = lowConfidenceReasons[0];
  const insights = [
    architectureCreated
      ? `${architectureCreated} architecture session${architectureCreated === 1 ? "" : "s"} produced a recommendation in the last ${days} days.`
      : `No completed architecture sessions were recorded in the last ${days} days.`,
    sessionsStarted
      ? `${conversion}% of started sessions reached a generated architecture output.`
      : "Session start tracking is enabled, but no starts were recorded in this range.",
    architectureCreated
      ? `Average modifications per completed architecture: ${avgMods.toFixed(1)}.`
      : "Modification rate will appear after the first architecture output is recorded.",
    busiest ? `Busiest day was ${busiest.day} with ${busiest.totalEvents} tracked event${busiest.totalEvents === 1 ? "" : "s"}.` : "Daily usage trends will appear after events are recorded.",
    lowConfidence
      ? `${lowConfidence} completed architecture session${lowConfidence === 1 ? "" : "s"} had low confidence${topLowReason ? ` — most common reason: ${topLowReason.reason} (${topLowReason.count}).` : "."}`
      : "No low-confidence completed sessions in this range."
  ];

  return {
    configured: true,
    generatedAt,
    rangeDays: days,
    totals: {
      sessionsStarted,
      architectureSessions: architectureCreated,
      architectureCreated,
      architectureModified,
      diagramGenerated: resources.filter((event) => event.eventType === "architecture_diagram_generated").length,
      exports: resources.filter((event) => event.eventType === "powerpoint_exported").length,
      uniqueUsers: users.size,
      totalEvents: resources.length
    },
    daily,
    bySource: sourceCounts,
    bySolutionType: solutionCounts,
    byConfidence,
    lowConfidenceReasons,
    byCountry,
    recentSessions: sessionRows
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, 20)
      .map(({ events, ...session }) => session),
    insights
  };
}
