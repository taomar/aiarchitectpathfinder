import { randomUUID } from "node:crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { loadLocalEnvDefaults } from "./env-defaults";

let pathfinderEnvLoaded = false;
let credential: DefaultAzureCredential | null = null;

type PathfinderConfig = {
  baseUrl: string;
  chatPath: string;
  imageGenerationsPath: string;
  imageEditsPath: string;
  chatDeploymentName: string;
  imageDeploymentName: string;
  tokenScope: string;
  audience: string;
};

export type PathfinderRequestResult = {
  json: any;
  status: number;
  correlationId: string;
};

export class PathfinderApimError extends Error {
  status: number;
  correlationId: string;
  code?: string;
  retryAfterSeconds?: number;

  constructor(message: string, details: { status: number; correlationId: string; code?: string; retryAfterSeconds?: number }) {
    super(message);
    this.name = "PathfinderApimError";
    this.status = details.status;
    this.correlationId = details.correlationId;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 120_000;
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET"
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True for transient connection-level failures (socket resets, DNS hiccups,
 * dropped keep-alive connections, our own per-attempt timeout aborts) that are
 * safe to retry. A caller-initiated cancel is handled separately and never retried.
 */
function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  const code = e.code ?? e.cause?.code ?? "";
  if (code && TRANSIENT_NETWORK_CODES.has(code)) return true;
  const message = `${e.message ?? ""} ${e.cause?.message ?? ""}`.toLowerCase();
  return /fetch failed|socket hang up|network|connection (?:reset|closed|refused|timeout)|timed out|terminated|other side closed/.test(message);
}

/**
 * Combines the caller's AbortSignal (if any) with a per-attempt timeout so a
 * stalled upstream request aborts and is retried instead of hanging indefinitely.
 */
function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Pathfinder APIM request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  let onParentAbort: (() => void) | undefined;
  if (parent) {
    if (parent.aborted) {
      controller.abort((parent as { reason?: unknown }).reason);
    } else {
      onParentAbort = () => controller.abort((parent as { reason?: unknown }).reason);
      parent.addEventListener("abort", onParentAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (parent && onParentAbort) parent.removeEventListener("abort", onParentAbort);
    }
  };
}

export function loadPathfinderEnv() {
  if (pathfinderEnvLoaded || typeof window !== "undefined") return;
  const keys = [
    "PATHFINDER_APIM_BASE_URL",
    "PATHFINDER_CHAT_PATH",
    "PATHFINDER_IMAGE_GENERATIONS_PATH",
    "PATHFINDER_IMAGE_EDITS_PATH",
    "PATHFINDER_CHAT_DEPLOYMENT_NAME",
    "PATHFINDER_IMAGE_DEPLOYMENT_NAME",
    "PATHFINDER_APIM_TOKEN_SCOPE",
    "PATHFINDER_APIM_AUDIENCE"
  ];
  loadLocalEnvDefaults(keys);
  pathfinderEnvLoaded = true;
}

function normalizePath(value: string | undefined, fallback: string) {
  const raw = value?.trim() || fallback;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function pathfinderConfig(): PathfinderConfig {
  loadPathfinderEnv();
  return {
    baseUrl: (process.env.PATHFINDER_APIM_BASE_URL || "").replace(/\/$/, ""),
    chatPath: normalizePath(process.env.PATHFINDER_CHAT_PATH, "/chat/completions"),
    imageGenerationsPath: normalizePath(process.env.PATHFINDER_IMAGE_GENERATIONS_PATH, "/image/generations"),
    imageEditsPath: normalizePath(process.env.PATHFINDER_IMAGE_EDITS_PATH, "/image/edits"),
    chatDeploymentName: process.env.PATHFINDER_CHAT_DEPLOYMENT_NAME || "gpt-54",
    imageDeploymentName: process.env.PATHFINDER_IMAGE_DEPLOYMENT_NAME || "mai-image-25",
    tokenScope: process.env.PATHFINDER_APIM_TOKEN_SCOPE || "",
    audience: process.env.PATHFINDER_APIM_AUDIENCE || ""
  };
}

export function pathfinderApimEnabled(kind: "chat" | "image" = "chat") {
  const config = pathfinderConfig();
  if (!config.baseUrl) return false;
  if (kind === "chat") return !!config.chatPath && !!config.chatDeploymentName;
  return !!config.imageGenerationsPath && !!config.imageDeploymentName;
}

export function pathfinderApimStatus() {
  const config = pathfinderConfig();
  return {
    enabled: pathfinderApimEnabled("chat"),
    present: {
      PATHFINDER_APIM_BASE_URL: !!config.baseUrl,
      PATHFINDER_CHAT_PATH: !!config.chatPath,
      PATHFINDER_IMAGE_GENERATIONS_PATH: !!config.imageGenerationsPath,
      PATHFINDER_IMAGE_EDITS_PATH: !!config.imageEditsPath,
      PATHFINDER_CHAT_DEPLOYMENT_NAME: !!config.chatDeploymentName,
      PATHFINDER_IMAGE_DEPLOYMENT_NAME: !!config.imageDeploymentName,
      PATHFINDER_APIM_TOKEN_SCOPE: !!config.tokenScope,
      PATHFINDER_APIM_AUDIENCE: !!config.audience,
      authMode: config.tokenScope ? "bearer" : "temporary-no-token"
    }
  };
}

async function bearerToken(scope: string) {
  if (!scope) return undefined;
  credential ??= new DefaultAzureCredential();
  const token = await credential.getToken(scope);
  return token?.token;
}

function apimUrl(path: string) {
  const config = pathfinderConfig();
  return `${config.baseUrl}${path}`;
}

function safeErrorCode(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const code = (value as { error?: { code?: string }; code?: string }).error?.code || (value as { code?: string }).code;
  return typeof code === "string" ? code.slice(0, 80) : undefined;
}

function compactSnippet(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function retryAfterSeconds(response: Response) {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  return undefined;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text.trim()) return { json: undefined, contentType, snippet: "" };
  try {
    return { json: JSON.parse(text), contentType, snippet: compactSnippet(text) };
  } catch {
    return { json: undefined, contentType, snippet: compactSnippet(text) };
  }
}

export async function pathfinderPostJson(path: string, body: Record<string, unknown>, init?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PathfinderRequestResult> {
  const config = pathfinderConfig();
  if (!config.baseUrl) throw new Error("Pathfinder APIM base URL is not configured.");
  const correlationId = randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-correlation-id": correlationId
  };
  const token = await bearerToken(config.tokenScope);
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = init?.timeoutMs && init.timeoutMs > 0 ? init.timeoutMs : DEFAULT_TIMEOUT_MS;
  const payload = JSON.stringify(body);
  let lastStatus = 0;
  let lastCode: string | undefined;
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const timeout = createTimeoutSignal(init?.signal, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(apimUrl(path), {
          method: "POST",
          headers,
          body: payload,
          signal: timeout.signal
        });
      } catch (err) {
        // Caller intentionally cancelled (navigation/unmount) — never retry.
        if (init?.signal?.aborted) throw err;
        lastNetworkError = err;
        const errCode = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (isTransientNetworkError(err) && attempt < MAX_ATTEMPTS - 1) {
          console.warn("[pathfinder-apim] transient network error, retrying", {
            attempt,
            correlationId,
            code: errCode,
            message: (err as { message?: string })?.message
          });
          await sleep(500 * 2 ** attempt);
          continue;
        }
        console.error("[pathfinder-apim] network request failed", {
          correlationId,
          code: errCode,
          message: (err as { message?: string })?.message
        });
        throw new PathfinderApimError(
          `Pathfinder APIM network request failed: ${(err as { message?: string })?.message ?? "connection error"}. Correlation ID: ${correlationId}`,
          { status: 504, correlationId, code: "NetworkError" }
        );
      }
      lastStatus = response.status;
      const parsed = await parseJsonSafely(response);
      lastCode = safeErrorCode(parsed.json);
      if (response.ok) {
        if (parsed.json === undefined) {
          console.error("[pathfinder-apim] non-json success response", {
            status: response.status,
            correlationId,
            contentType: parsed.contentType,
            snippet: parsed.snippet
          });
          throw new PathfinderApimError(`Pathfinder APIM returned a non-JSON response with status ${response.status}. Correlation ID: ${correlationId}`, {
            status: response.status,
            correlationId,
            code: "NonJsonResponse"
          });
        }
        return { json: parsed.json, status: response.status, correlationId };
      }
      if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
        console.error("[pathfinder-apim] request failed", { status: response.status, correlationId, code: lastCode });
        const retryAfter = retryAfterSeconds(response);
        const message = response.status === 429
          ? `Pathfinder APIM is temporarily rate limited. Correlation ID: ${correlationId}${lastCode ? ` Code: ${lastCode}` : ""}`
          : `Pathfinder APIM request failed with status ${response.status}. Correlation ID: ${correlationId}${lastCode ? ` Code: ${lastCode}` : ""}`;
        throw new PathfinderApimError(message, {
          status: response.status,
          correlationId,
          code: lastCode,
          retryAfterSeconds: retryAfter
        });
      }
      const retryAfter = retryAfterSeconds(response);
      const delay = retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt;
      await sleep(delay);
    } finally {
      timeout.cleanup();
    }
  }
  throw new PathfinderApimError(
    `Pathfinder APIM request failed after ${MAX_ATTEMPTS} attempts. Correlation ID: ${correlationId}${lastStatus ? ` Status: ${lastStatus}` : ""}${lastCode ? ` Code: ${lastCode}` : ""}${lastNetworkError ? ` (last network error: ${(lastNetworkError as { message?: string })?.message ?? "connection error"})` : ""}`,
    {
      status: lastStatus || 504,
      correlationId,
      code: lastCode ?? (lastNetworkError ? "NetworkError" : undefined)
    }
  );
}

export function chatBody(body: Record<string, unknown>) {
  const config = pathfinderConfig();
  return { model: config.chatDeploymentName, ...body };
}

export function imageGenerationBody(body: Record<string, unknown>) {
  const config = pathfinderConfig();
  return { model: config.imageDeploymentName, ...body };
}
