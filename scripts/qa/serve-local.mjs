import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { randomBytes, scryptSync, X509Certificate } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const project = path.resolve(process.env.E2E_PROJECT_ROOT || sourceRoot);
const artifacts = process.env.E2E_ARTIFACT_DIR && path.resolve(process.env.E2E_ARTIFACT_DIR);
const artifactRelative = artifacts && path.relative(sourceRoot, artifacts);
if (!artifacts || !(path.isAbsolute(artifactRelative) || artifactRelative === ".." || artifactRelative.startsWith(`..${path.sep}`))) {
  throw new Error("E2E_ARTIFACT_DIR must be outside the repository so secrets and test downloads cannot be published.");
}
const environment = process.env.E2E_AZD_ENV;
if (!environment) throw new Error("Set E2E_AZD_ENV to an existing configured azd environment. This server creates no Azure resources.");
let values;
try {
  values = JSON.parse(execFileSync("azd", ["env", "get-values", "--environment", environment, "--output", "json"], {
    cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  }));
} catch {
  throw new Error("Could not read the configured azd environment; no configuration values were printed.");
}
const ai = JSON.parse(values.APP_AI_SETTINGS || "{}");
if (ai.PATHFINDER_AI_MODE !== "external-foundry" || ai.AZURE_OPENAI_ENABLED !== "true") {
  throw new Error("Local live testing requires an explicitly enabled external Foundry configuration.");
}
if (!fs.existsSync(path.join(project, ".next", "BUILD_ID"))) throw new Error("Build the selected project before starting the production-mode test server.");
const port = Number(process.env.E2E_HTTPS_PORT || 3217);
const backendPort = Number(process.env.E2E_BACKEND_PORT || 3218);
if (![port, backendPort].every(value => Number.isInteger(value) && value > 1024 && value < 65536) || port === backendPort) {
  throw new Error("Choose distinct unprivileged test ports.");
}
fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const tls = path.join(artifacts, "tls");
const certificateFile = path.join(tls, "localhost-cert.pem");
const keyFile = path.join(tls, "localhost-key.pem");
const certificateValid = fs.existsSync(certificateFile) && fs.existsSync(keyFile) &&
  Date.parse(new X509Certificate(fs.readFileSync(certificateFile)).validTo) > Date.now() + 60_000;
if (!certificateValid) {
  execFileSync("pwsh", ["-NoProfile", "-File", path.join(sourceRoot, "scripts", "qa", "create-local-cert.ps1"), "-Directory", tls], {
    stdio: "inherit", windowsHide: true
  });
}
const origin = `https://127.0.0.1:${port}`;
const accessFile = path.join(artifacts, "local-access.json");
const previousPassword = fs.existsSync(accessFile) ? JSON.parse(fs.readFileSync(accessFile, "utf8")).password : undefined;
const password = process.env.E2E_PASSWORD ?? previousPassword ?? randomBytes(24).toString("base64url");
if (typeof password !== "string" || password.length < 12) {
  throw new Error("The local QA password must contain at least 12 characters.");
}
const salt = randomBytes(16).toString("hex");
fs.writeFileSync(accessFile, JSON.stringify({ origin, password }), { mode: 0o600 });
fs.writeFileSync(path.join(artifacts, "model-config.json"), JSON.stringify(ai), { mode: 0o600 });
const standalone = path.join(project, ".next", "standalone");
const server = path.join(standalone, "server.js");
if (!fs.existsSync(server)) throw new Error("Build the project with its own outputFileTracingRoot before starting the standalone server.");
fs.cpSync(path.join(project, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
fs.cpSync(path.join(project, "public"), path.join(standalone, "public"), { recursive: true });
const log = fs.createWriteStream(path.join(artifacts, "server.log"), { flags: "a" });
const child = spawn(process.execPath, [server], {
  cwd: standalone, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  env: {
    ...process.env, ...ai, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1", PORT: String(backendPort),
    AUTH_MODE: "password", APP_ORIGIN: origin,
    AUTH_PASSWORD_HASH: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`,
    AUTH_SESSION_SECRET: randomBytes(48).toString("base64url"),
    ADMIN_EMAILS: "operator@example.test", ADMIN_LOCAL_BYPASS: "false",
    USAGE_COSMOS_ENDPOINT: "", APPLICATIONINSIGHTS_CONNECTION_STRING: ""
  }
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", data => log.write(`${new Date().toISOString()} ${data.toString()}`));
}
const proxy = https.createServer({
  cert: fs.readFileSync(path.join(tls, "localhost-cert.pem")),
  key: fs.readFileSync(path.join(tls, "localhost-key.pem"))
}, (request, response) => {
  const upstream = http.request({
    hostname: "127.0.0.1", port: backendPort, path: request.url, method: request.method,
    headers: { ...request.headers, "x-forwarded-proto": "https", "x-forwarded-host": request.headers.host }
  }, result => {
    response.writeHead(result.statusCode || 502, result.headers);
    result.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("Local test backend is unavailable.");
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
});
proxy.on("error", error => { console.error("Local HTTPS listener failed:", error.message); child.kill(); process.exitCode = 1; });
child.on("error", error => { console.error("Local backend failed to start:", error.message); proxy.close(); process.exitCode = 1; });
child.on("exit", code => { proxy.close(); log.end(); if (code) process.exitCode = code; });
proxy.listen(port, "127.0.0.1", () => {
  console.log(`Local production-mode test server: ${origin}`);
  console.log(`Test artifacts are outside the repository: ${artifacts}`);
  console.log("Credentials are not printed; the browser test reads its ephemeral local-access file.");
});
const shutdown = () => { proxy.close(); child.kill(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
