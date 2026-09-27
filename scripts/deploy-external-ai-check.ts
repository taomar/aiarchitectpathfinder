import assert from "node:assert/strict";
import { DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { aiRoleSettings, aiRuntimeStatus, requestAiJson } from "../lib/ai-runtime";

const saved = { ...process.env };
const originalFetch = globalThis.fetch;
const originalManagedToken = ManagedIdentityCredential.prototype.getToken;
const originalDefaultToken = DefaultAzureCredential.prototype.getToken;
const endpoint = "https://synthetic-external.openai.azure.com";
let calls = 0;
let managedTokens = 0;

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    WEBSITE_SITE_NAME: "synthetic-host",
    PATHFINDER_AI_MODE: "external-foundry",
    PATHFINDER_FOUNDRY_ENDPOINT: endpoint,
    PATHFINDER_FOUNDRY_AUTH: "apiKey",
    PATHFINDER_WIZARD_DEPLOYMENT: "configured-wizard",
    PATHFINDER_ARCHITECTURE_DEPLOYMENT: "configured-architecture",
    PATHFINDER_JUDGE_DEPLOYMENT: "configured-judge",
    AZURE_OPENAI_ENABLED: "true",
    AZURE_OPENAI_API_KEY: "synthetic-key-for-unit-test-only",
    PATHFINDER_LOCAL_AI_ENABLED: "true",
    PATHFINDER_LOCAL_AI_ENDPOINT: "https://must-not-be-used.openai.azure.com/",
    PATHFINDER_APIM_BASE_URL: "https://synthetic-existing-gateway.example",
    AZURE_CLIENT_ID: "99999999-9999-9999-9999-999999999999"
  });
  ManagedIdentityCredential.prototype.getToken = async () => {
    managedTokens++;
    return { token: "synthetic-workload-token", expiresOnTimestamp: Date.now() + 60000 };
  };
  DefaultAzureCredential.prototype.getToken = async () => {
    throw new Error("Hosted external mode must not fall back to a developer credential.");
  };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), `${endpoint}/openai/v1/chat/completions`);
    const headers = new Headers(init?.headers);
    if (process.env.PATHFINDER_FOUNDRY_AUTH === "managedIdentity") {
      assert.equal(headers.get("authorization"), "Bearer synthetic-workload-token");
      assert.equal(headers.get("api-key"), null);
    } else {
      assert.equal(headers.get("api-key"), "synthetic-key-for-unit-test-only");
      assert.equal(headers.get("authorization"), null);
    }
    calls++;
    return Response.json({
      choices: [{ finish_reason: "stop", message: { content: '{"verified":true}' } }]
    });
  };
  console.log("External AI: explicit hosted mode and role deployment mapping");
  assert.equal(aiRuntimeStatus().transport, "external-foundry");
  assert.equal(aiRoleSettings("wizard").model, "configured-wizard");
  assert.equal(aiRoleSettings("architecture").model, "configured-architecture");
  assert.equal(aiRoleSettings("judge").model, "configured-judge");
  assert.deepEqual(await requestAiJson("wizard", "Return JSON.", {}), { verified: true });
  process.env.PATHFINDER_FOUNDRY_AUTH = "managedIdentity";
  assert.deepEqual(await requestAiJson("judge", "Return JSON.", {}), { verified: true });
  assert.equal(managedTokens, 1);
  assert.equal(calls, 2);

  console.log("External AI: invalid configuration fails before any request");
  for (const invalid of ["http://synthetic-external.openai.azure.com", "https://attacker.example", `${endpoint}/api/projects/demo`]) {
    process.env.PATHFINDER_FOUNDRY_ENDPOINT = invalid;
    assert.throws(() => aiRoleSettings("wizard"));
  }
  process.env.PATHFINDER_FOUNDRY_ENDPOINT = endpoint;
  process.env.PATHFINDER_FOUNDRY_AUTH = "unsupported";
  assert.throws(() => aiRoleSettings("wizard"), /auth/i);
  process.env.PATHFINDER_FOUNDRY_AUTH = "apiKey";
  delete process.env.AZURE_OPENAI_API_KEY;
  assert.throws(() => aiRoleSettings("wizard"), /key/i);
  process.env.AZURE_OPENAI_API_KEY = "synthetic-key-for-unit-test-only";
  delete process.env.PATHFINDER_ARCHITECTURE_DEPLOYMENT;
  assert.throws(() => aiRoleSettings("architecture"), /deployment/i);
  process.env.PATHFINDER_ARCHITECTURE_DEPLOYMENT = "configured-architecture";
  process.env.PATHFINDER_AI_MODE = "misspelled";
  assert.throws(() => aiRoleSettings("wizard"), /mode/i);
  assert.equal(calls, 2);

  console.log("External AI: original hosted APIM-only default remains intact");
  delete process.env.PATHFINDER_AI_MODE;
  assert.equal(aiRoleSettings("wizard").transport, "apim",
    "A local development opt-in must not enable direct Foundry on the internal host.");
  assert.equal(calls, 2);

  console.log("External AI: one bounded retry includes response-body network failures");
  process.env.PATHFINDER_AI_MODE = "external-foundry";
  let attempts = 0;
  const signals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = async (_input, init) => {
    signals.push(init?.signal);
    attempts++;
    if (attempts === 1) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET" } }));
        }
      }));
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"recovered":true}' } }] });
  };
  assert.deepEqual(await requestAiJson("wizard", "Return JSON.", {}), { recovered: true });
  assert.equal(attempts, 2);
  assert.equal(signals[0], signals[1], "Retries must share the original deadline.");
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response("busy", { status: 429, headers: { "Retry-After": "0" } });
  };
  await assert.rejects(() => requestAiJson("wizard", "Return JSON.", {}), /HTTP 429/);
  assert.equal(attempts, 2, "Persistent errors must not trigger a third attempt.");
  attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return new Response("busy", { status: 503, headers: { "Retry-After": "60" } });
  };
  const controller = new AbortController();
  const cancellation = setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(() => requestAiJson("wizard", "Return JSON.", {}, { signal: controller.signal }), /abort/i);
    assert.equal(attempts, 1, "Cancellation during Retry-After must prevent the second request.");
  } finally {
    clearTimeout(cancellation);
  }
  console.log("External Foundry boundary passed; no network or real credentials used.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
  ManagedIdentityCredential.prototype.getToken = originalManagedToken;
  DefaultAzureCredential.prototype.getToken = originalDefaultToken;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
