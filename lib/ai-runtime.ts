import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { z } from "zod";
import { loadLocalEnvDefaults } from "./env-defaults";
import { pathfinderConfig, pathfinderPostJson } from "./pathfinder-apim";
import { AI_REASONING_EFFORTS, ARCHITECT_REQUEST_TIMEOUT_MS, MAXIMUM_REASONING_EFFORT, REVIEW_REQUEST_TIMEOUT_MS } from "./recommendation-policy";
import type { ModelOutputSchema } from "./model-output-schema";

export type AiRole = "wizard" | "architecture" | "judge";
export type ReasoningEffort = typeof AI_REASONING_EFFORTS[number];
export const AI_POLICY_VERSION = "9.1-high-level-sol-max";

export class AiRoleConfigurationError extends Error {
  readonly code = "AI_ROLE_NOT_CONFIGURED";
  constructor(readonly role: AiRole, message: string) { super(message); this.name = "AiRoleConfigurationError"; }
}

export class AiProviderError extends Error {
  readonly code = "AI_PROVIDER_ERROR";
  constructor(readonly role: AiRole, readonly status: number) {
    const label = role === "judge" ? "AI reviewer" : role === "architecture" ? "AI architect" : "Wizard AI";
    const action = status === 429 ? "The model is temporarily at capacity. Retry shortly."
      : status === 401 || status === 403 ? "Check the configured model credentials and access."
      : status === 400 || status === 404 ? "Check the model deployment and supported request settings."
      : "The provider could not complete the request. Retry shortly.";
    super(`${label} request failed at the model provider (HTTP ${status}). ${action}`);
    this.name = "AiProviderError";
  }
}

const CompletionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() })
  })).min(1)
});
let credential: DefaultAzureCredential | undefined;
let workloadCredential: { clientId: string; credential: ManagedIdentityCredential } | undefined;

function externalAuthentication(): "apiKey" | "managedIdentity" {
  const mode = process.env.PATHFINDER_FOUNDRY_AUTH;
  if (mode === "apiKey") {
    if (!process.env.AZURE_OPENAI_API_KEY?.trim()) {
      throw new Error("External Foundry API-key authentication requires AZURE_OPENAI_API_KEY.");
    }
    return mode;
  }
  if (mode === "managedIdentity") {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(process.env.AZURE_CLIENT_ID ?? "")) {
      throw new Error("External Foundry managed-identity authentication requires the existing identity's AZURE_CLIENT_ID.");
    }
    return mode;
  }
  throw new Error("External Foundry authentication must be apiKey or managedIdentity.");
}

function settings() {
  loadLocalEnvDefaults([
    "PATHFINDER_LOCAL_AI_ENABLED", "PATHFINDER_LOCAL_AI_ENDPOINT",
    "PATHFINDER_WIZARD_DEPLOYMENT", "PATHFINDER_ARCHITECTURE_DEPLOYMENT",
    "PATHFINDER_JUDGE_DEPLOYMENT", "PATHFINDER_JUDGE_REASONING_EFFORT",
    "PATHFINDER_AI_MODE", "PATHFINDER_FOUNDRY_ENDPOINT", "PATHFINDER_FOUNDRY_AUTH",
    "AZURE_OPENAI_API_KEY", "AZURE_CLIENT_ID"
  ]);
  const mode = process.env.PATHFINDER_AI_MODE;
  if (mode && mode !== "external-foundry" && mode !== "internal-apim") {
    throw new Error("PATHFINDER_AI_MODE must be external-foundry or internal-apim.");
  }
  const external = mode === "external-foundry";
  const externalAuth = external ? externalAuthentication() : undefined;
  const local = !external && mode !== "internal-apim" && process.env.NODE_ENV !== "production" &&
    !process.env.WEBSITE_SITE_NAME && !process.env.CONTAINER_APP_NAME &&
    process.env.PATHFINDER_LOCAL_AI_ENABLED === "true";
  const config = pathfinderConfig();
  let endpoint = config.baseUrl;
  if (local || external) {
    const url = new URL((external ? process.env.PATHFINDER_FOUNDRY_ENDPOINT : process.env.PATHFINDER_LOCAL_AI_ENDPOINT) || "");
    const validHost = external
      ? /\.(cognitiveservices|openai|services\.ai)\.azure\.com$/i.test(url.hostname)
      : /\.(cognitiveservices|openai)\.azure\.com$/i.test(url.hostname);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !validHost ||
      url.pathname !== "/" || url.port) {
      throw new Error(`${external ? "External Foundry" : "Local AI"} requires an HTTPS Azure OpenAI resource root URL.`);
    }
    endpoint = url.origin;
  }
  const transport = external ? "external-foundry" : local ? "local-foundry" : "apim";
  return { local, external, externalAuth, transport, endpoint, config };
}

export function aiRoleSettings(role: AiRole) {
  const { local, external, transport, endpoint, config } = settings();
  const names: Record<AiRole, string | undefined> = {
    wizard: process.env.PATHFINDER_WIZARD_DEPLOYMENT,
    architecture: process.env.PATHFINDER_ARCHITECTURE_DEPLOYMENT,
    judge: process.env.PATHFINDER_JUDGE_DEPLOYMENT
  };
  if (external && !names[role]?.trim()) {
    throw new AiRoleConfigurationError(role, `External Foundry requires an explicit ${role} deployment name.`);
  }
  const defaultModel = local
    ? role === "wizard" ? "gpt-5.6-terra" : "gpt-5.6-sol"
    : config.chatDeploymentName;
  const effort = role === "wizard" ? "low" : role === "judge"
    ? process.env.PATHFINDER_JUDGE_REASONING_EFFORT || "medium" : MAXIMUM_REASONING_EFFORT;
  if (!AI_REASONING_EFFORTS.some(value => value === effort)) {
    throw new AiRoleConfigurationError(role, "PATHFINDER_JUDGE_REASONING_EFFORT must be low, medium, high or xhigh.");
  }
  return {
    role, model: names[role]?.trim() || defaultModel,
    reasoningEffort: effort as ReasoningEffort,
    maxCompletionTokens: role === "wizard" ? 4096 : role === "judge" ? 8192 : 32768,
    transport,
    endpoint,
    policyVersion: AI_POLICY_VERSION
  };
}

export function aiRuntimeStatus() {
  const { transport, endpoint } = settings();
  const roleStatus = (role: AiRole) => {
    try {
      const { model, reasoningEffort } = aiRoleSettings(role);
      return { configured: true, model, reasoningEffort };
    } catch (error) {
      if (role !== "judge" || !(error instanceof AiRoleConfigurationError)) throw error;
      console.warn("[ai] Optional reviewer is not configured:", error.message);
      return { configured: false, error: error.message };
    }
  };
  const roles = {
    wizard: roleStatus("wizard"), architecture: roleStatus("architecture"), judge: roleStatus("judge")
  };
  return {
    enabled: !!endpoint,
    transport,
    policyVersion: AI_POLICY_VERSION,
    roles,
    reviewAvailable: roles.judge.configured
  };
}

function transientNetworkError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; cause?: { code?: string } };
  const code = value.code ?? value.cause?.code;
  return (code !== undefined && [
    "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"
  ].includes(code)) || (error instanceof TypeError && /fetch failed|terminated/i.test(error.message));
}

function retryDelay(response: Response) {
  const value = response.headers.get("retry-after");
  if (value === null) return 500;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 500;
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.min(milliseconds, 120001));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestAiJson(
  role: AiRole, system: string, payload: unknown,
  options: {
    signal?: AbortSignal;
    reasoningEffort?: ReasoningEffort;
    maxCompletionTokens?: number;
    responseSchema?: ModelOutputSchema;
  } = {}
): Promise<unknown> {
  if ((process.env.AZURE_OPENAI_ENABLED ?? "").toLowerCase() === "false") {
    throw new Error("AI is disabled by configuration.");
  }
  const { local, external, externalAuth, endpoint, config } = settings();
  const policy = aiRoleSettings(role);
  const body = {
    model: policy.model,
    messages: [
      { role: "system", content: `${system}\n\nRespond with one valid JSON object only.` },
      { role: "user", content: JSON.stringify(payload) }
    ],
    response_format: options.responseSchema
      ? { type: "json_schema", json_schema: options.responseSchema }
      : { type: "json_object" },
    reasoning_effort: options.reasoningEffort ?? policy.reasoningEffort,
    max_completion_tokens: options.maxCompletionTokens ?? policy.maxCompletionTokens
  };
  const timeoutMs = role === "wizard" ? 60_000
    : role === "architecture" ? ARCHITECT_REQUEST_TIMEOUT_MS : REVIEW_REQUEST_TIMEOUT_MS;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(timeoutMs)
  ]);
  console.info("[ai-v7] requesting", { role, model: body.model, effort: body.reasoning_effort });
  let raw: unknown;
  if (local || external) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (externalAuth === "managedIdentity") {
      const clientId = process.env.AZURE_CLIENT_ID!;
      if (workloadCredential?.clientId !== clientId) {
        workloadCredential = { clientId, credential: new ManagedIdentityCredential({ clientId }) };
      }
      const token = await workloadCredential.credential.getToken("https://cognitiveservices.azure.com/.default", { abortSignal: signal });
      if (!token?.token) throw new Error("External Foundry authentication did not return a workload token.");
      headers.Authorization = `Bearer ${token.token}`;
    } else if (process.env.AZURE_OPENAI_API_KEY) {
      headers["api-key"] = external ? process.env.AZURE_OPENAI_API_KEY.trim() : process.env.AZURE_OPENAI_API_KEY;
    } else {
      credential ??= new DefaultAzureCredential();
      const token = await credential.getToken("https://cognitiveservices.azure.com/.default", { abortSignal: signal });
      if (!token?.token) throw new Error("Local AI authentication did not return a token.");
      headers.Authorization = `Bearer ${token.token}`;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        signal.throwIfAborted();
        const response = await fetch(`${endpoint}/openai/v1/chat/completions`, {
          method: "POST", headers, body: JSON.stringify(body), signal
        });
        if (!response.ok) {
          if (attempt === 1 && (response.status === 429 || (response.status >= 500 && response.status <= 599))) {
            const delay = retryDelay(response);
            await response.body?.cancel();
            console.warn("[ai-v7] retrying transient response", { role, attempt: 2, status: response.status });
            await waitForRetry(delay, signal);
            continue;
          }
          await response.body?.cancel();
          throw new AiProviderError(role, response.status);
        }
        raw = await response.json();
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt !== 1 || !transientNetworkError(error)) throw error;
        console.warn("[ai-v7] retrying transient connection failure", { role, attempt: 2 });
        await waitForRetry(500, signal);
      }
    }
  } else {
    raw = (await pathfinderPostJson(config.chatPath, body, { signal, timeoutMs })).json;
  }
  const parsed = CompletionSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`AI ${role} returned an invalid completion response.`);
  const choice = parsed.data.choices[0];
  if (choice.finish_reason !== "stop" || choice.message.refusal || !choice.message.content?.trim()) {
    throw new Error(`AI ${role} response is incomplete or refused (${choice.finish_reason}).`);
  }
  try {
    const value: unknown = JSON.parse(choice.message.content);
    console.info("[ai-v7] completed", { role, model: parsed.data.model ?? body.model });
    return value;
  } catch {
    throw new Error(`AI ${role} returned invalid JSON.`);
  }
}
