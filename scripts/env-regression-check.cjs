const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

process.env.AZURE_OPENAI_ENABLED = "false";

const root = path.resolve(__dirname, "..");
const cwd = path.join(root, "synthetic-env-fixture");
const sourcePath = path.join(root, "lib", "env-defaults.ts");
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const keys = ["AZURE_OPENAI_ENABLED", "PATHFINDER_APIM_BASE_URL", "PATHFINDER_APIM_TOKEN_SCOPE"];

function run(env, files, unreadable = false, browserWindow) {
  const checked = [];
  const read = [];
  const absoluteFiles = new Map(Object.entries(files).map(([name, value]) => [path.resolve(cwd, name), value]));
  const fakeFs = {
    existsSync(file) { checked.push(file); return absoluteFiles.has(file); },
    readFileSync(file) {
      read.push(file);
      if (unreadable) throw Object.assign(new Error("Synthetic permission failure"), { code: "EACCES" });
      return absoluteFiles.get(file);
    }
  };
  const module = { exports: {} };
  vm.runInThisContext(`(function(exports, require, module, process, window) { ${compiled}\n})`, { filename: sourcePath })(
    module.exports,
    (id) => {
      if (id === "fs") return fakeFs;
      if (id === "path") return path;
      throw new Error(`Unexpected environment-loader dependency: ${id}`);
    },
    module,
    { env, cwd: () => cwd },
    browserWindow
  );
  module.exports.loadLocalEnvDefaults(keys);
  return { env, checked, read };
}

const host = run({
  NODE_ENV: "development",
  AZURE_OPENAI_ENABLED: "false",
  PATHFINDER_APIM_BASE_URL: "https://explicit-host.example.test",
  PATHFINDER_APIM_TOKEN_SCOPE: ""
}, {
  ".env.local": "AZURE_OPENAI_ENABLED=true\nPATHFINDER_APIM_BASE_URL=https://file.example.test\nPATHFINDER_APIM_TOKEN_SCOPE=file-scope"
});
assert.equal(host.env.AZURE_OPENAI_ENABLED, "false", "A file must not override the host kill switch.");
assert.equal(host.env.PATHFINDER_APIM_BASE_URL, "https://explicit-host.example.test");
assert.equal(host.env.PATHFINDER_APIM_TOKEN_SCOPE, "", "Explicit empty host settings are authoritative.");
assert.deepEqual(host.checked, [], "Fully configured host settings must not depend on fallback-file access.");
assert.doesNotThrow(() => run({ ...host.env }, {
  ".env.local": "AZURE_OPENAI_ENABLED=true"
}, true));

const emptyHost = run({
  NODE_ENV: "development",
  AZURE_OPENAI_ENABLED: "false",
  PATHFINDER_APIM_BASE_URL: "",
  PATHFINDER_APIM_TOKEN_SCOPE: ""
}, {
  ".env.local": "PATHFINDER_APIM_BASE_URL=https://placeholder.example.test"
});
assert.equal(emptyHost.env.PATHFINDER_APIM_BASE_URL, "", "An explicitly disabled endpoint must remain empty.");

const local = run({ NODE_ENV: "development" }, {
  ".env.local": "AZURE_OPENAI_ENABLED='false'\nPATHFINDER_APIM_BASE_URL=\"https://local.example.test\"\nNOT_ALLOWED=ignored",
  ".env": "AZURE_OPENAI_ENABLED=true\nPATHFINDER_APIM_TOKEN_SCOPE=local-scope",
  ".env.example": "PATHFINDER_APIM_BASE_URL=https://sample.example.test",
  "..\\.env.local": "AZURE_OPENAI_ENABLED=true"
});
assert.equal(local.env.AZURE_OPENAI_ENABLED, "false");
assert.equal(local.env.PATHFINDER_APIM_BASE_URL, "https://local.example.test");
assert.equal(local.env.PATHFINDER_APIM_TOKEN_SCOPE, "local-scope");
assert.equal(local.env.NOT_ALLOWED, undefined);
assert.deepEqual(local.checked, [path.join(cwd, ".env.local"), path.join(cwd, ".env")]);

const sampleOnly = run({ NODE_ENV: "development" }, {
  ".env.example": "AZURE_OPENAI_ENABLED=true\nPATHFINDER_APIM_BASE_URL=https://sample.example.test",
  "..\\.env.local": "AZURE_OPENAI_ENABLED=true"
});
assert.equal(sampleOnly.env.PATHFINDER_APIM_BASE_URL, undefined);
assert.equal(sampleOnly.env.AZURE_OPENAI_ENABLED, undefined);
assert.deepEqual(sampleOnly.read, []);

const production = run({ NODE_ENV: "production", AZURE_OPENAI_ENABLED: "false" }, {
  ".env.local": "AZURE_OPENAI_ENABLED=true",
  ".env.example": "PATHFINDER_APIM_BASE_URL=https://sample.example.test"
}, true);
assert.deepEqual(production.checked, [], "Production must not scan fallback files.");
assert.deepEqual(production.read, []);
assert.equal(production.env.AZURE_OPENAI_ENABLED, "false");
const browser = run({ NODE_ENV: "development", AZURE_OPENAI_ENABLED: "false" }, {
  ".env.local": "PATHFINDER_APIM_BASE_URL=https://placeholder.example.test"
}, false, {});
assert.deepEqual(browser.checked, [], "Browser contexts must not scan files.");
assert.throws(
  () => run({ NODE_ENV: "development" }, { ".env.local": "AZURE_OPENAI_ENABLED=true" }, true),
  /Could not read local configuration/,
  "Configuration IO failures must be explicit."
);

function apiFixture(env, files) {
  const modules = new Map();
  const checked = [];
  const read = [];
  const absoluteFiles = new Map(Object.entries(files).map(([name, value]) => [path.resolve(cwd, name), value]));
  const fakeFs = {
    existsSync(file) { checked.push(file); return absoluteFiles.has(file); },
    readFileSync(file) { read.push(file); return absoluteFiles.get(file); }
  };
  let externalCalls = 0;
  function forbiddenExternalCall() {
    externalCalls += 1;
    throw new Error("External calls are forbidden in configuration tests.");
  }
  function load(file) {
    file = path.resolve(root, file);
    if (!file.startsWith(root + path.sep)) throw new Error("Source must stay in the worktree.");
    if (!path.extname(file)) file += ".ts";
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText;
    function requireMock(id) {
      if (id === "fs") return fakeFs;
      if (id === "node:fs/promises") return { readFile: forbiddenExternalCall };
      if (id === "@azure/identity") return {
        DefaultAzureCredential: class { getToken() { return forbiddenExternalCall(); } }
      };
      if (id.startsWith(".")) return load(path.resolve(path.dirname(file), id));
      if (["node:crypto", "node:path", "path", "zod", "@dagrejs/dagre"].includes(id)) return require(id);
      throw new Error(`Unexpected configuration dependency: ${id}`);
    }
    vm.runInThisContext(
      `(function(exports, require, module, process, fetch) { ${code}\n})`,
      { filename: file }
    )(module.exports, requireMock, module, { env, cwd: () => cwd }, forbiddenExternalCall);
    return module.exports;
  }
  return { load, env, checked, read, externalCalls: () => externalCalls };
}

const fallbackFiles = {
  ".env.local": [
    "AZURE_OPENAI_ENABLED=true",
    "PATHFINDER_APIM_BASE_URL=https://file.example.test",
    "PATHFINDER_APIM_TOKEN_SCOPE=file-scope",
    "PATHFINDER_CHAT_DEPLOYMENT_NAME=file-model"
  ].join("\n"),
  ".env.example": "AZURE_OPENAI_ENABLED=true\nPATHFINDER_APIM_BASE_URL=https://sample.example.test",
  "..\\.env.local": "AZURE_OPENAI_ENABLED=true"
};

for (const mode of ["development", "production"]) {
  for (const scope of ["", "api://synthetic-approved/.default"]) {
    const runtime = apiFixture({
      NODE_ENV: mode,
      AZURE_OPENAI_ENABLED: "false",
      PATHFINDER_APIM_BASE_URL: "https://approved.example.test",
      PATHFINDER_APIM_TOKEN_SCOPE: scope,
      PATHFINDER_CHAT_DEPLOYMENT_NAME: "approved-model"
    }, fallbackFiles);
    const ai = runtime.load("lib\\azure-openai.ts");
    const apim = runtime.load("lib\\pathfinder-apim.ts");
    assert.equal(ai.azureOpenAIEnabled(), false, "Callers must honor the host kill switch.");
    assert.equal(ai.azureOpenAIStatus().enabled, false);
    assert.equal(runtime.env.AZURE_OPENAI_ENABLED, "false");
    assert.equal(apim.pathfinderConfig().baseUrl, "https://approved.example.test");
    assert.equal(apim.pathfinderConfig().chatDeploymentName, "approved-model");
    assert.equal(apim.pathfinderConfig().tokenScope, scope);
    assert.equal(apim.pathfinderApimStatus().present.authMode, scope ? "bearer" : "temporary-no-token",
      "Explicitly configured APIM mode must remain unchanged.");
    assert.equal(apim.pathfinderApimEnabled(), true, "Configuration presence is independent of the AI kill switch.");
    assert.equal(runtime.externalCalls(), 0);
    if (mode === "production") assert.deepEqual(runtime.checked, []);
    assert.ok(runtime.checked.every((file) => file === path.join(cwd, ".env.local") || file === path.join(cwd, ".env")));
  }
}

const unconfiguredProduction = apiFixture({
  NODE_ENV: "production",
  AZURE_OPENAI_ENABLED: "false"
}, fallbackFiles);
assert.equal(unconfiguredProduction.load("lib\\pathfinder-apim.ts").pathfinderApimEnabled(), false,
  "Production must not configure the gateway from local/example placeholders.");
assert.equal(unconfiguredProduction.load("lib\\azure-openai.ts").azureOpenAIStatus().enabled, false);
assert.deepEqual(unconfiguredProduction.checked, []);
assert.equal(unconfiguredProduction.externalCalls(), 0);
assert.equal(process.env.AZURE_OPENAI_ENABLED, "false");

console.log("Environment precedence checks passed (synthetic files/env; host, empty, production, browser, example/ancestor and APIM-mode parity; no network).");
