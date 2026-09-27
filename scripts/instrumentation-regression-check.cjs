const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

process.env.AZURE_OPENAI_ENABLED = "false";

const filename = path.resolve(__dirname, "..", "instrumentation.ts");
const source = fs.readFileSync(filename, "utf8");
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const sdk = "@azure/monitor-opentelemetry";
const sdkImports = [];

function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0]?.text === sdk
  ) {
    sdkImports.push(node);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(sdkImports.length, 1, "Registration should lazily import the Azure Monitor SDK once.");

function hasConjunct(expression, left, right) {
  if (!ts.isBinaryExpression(expression)) return false;
  if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return hasConjunct(expression.left, left, right) || hasConjunct(expression.right, left, right);
  }
  return expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    expression.left.getText(ast) === left &&
    ts.isStringLiteral(expression.right) &&
    expression.right.text === right;
}

for (const sdkImport of sdkImports) {
  let nodeGuarded = false;
  let browserGuarded = false;
  for (let child = sdkImport, parent = child.parent; parent; child = parent, parent = parent.parent) {
    if (!ts.isIfStatement(parent) || parent.thenStatement !== child) continue;
    nodeGuarded ||= hasConjunct(parent.expression, "process.env.NEXT_RUNTIME", "nodejs");
    browserGuarded ||= hasConjunct(parent.expression, "typeof window", "undefined");
  }
  assert.ok(nodeGuarded, "The SDK import must be inside a positive Node-runtime branch for Edge dependency pruning.");
  assert.ok(browserGuarded, "The SDK import must also be excluded from browser compilation.");
}

const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

async function registerFixture(env, failure, browserWindow) {
  const calls = [];
  const errors = [];
  let imports = 0;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    window: browserWindow,
    process: { env: { ...env, AZURE_OPENAI_ENABLED: "false" } },
    require(id) {
      assert.equal(id, sdk, "Only the mocked telemetry SDK may be loaded.");
      imports += 1;
      if (failure === "import") throw new Error("Fixture import failure");
      return {
        useAzureMonitor(options) {
          calls.push(options);
          if (failure === "initialize") throw new Error("Fixture initialization failure");
        }
      };
    },
    console: { error: (...args) => errors.push(args) }
  }, { filename });
  await exports.register();
  return { imports, calls, errors };
}

async function main() {
  const connectionString = "offline-test-placeholder";
  for (const runtime of [undefined, "edge"]) {
    const result = await registerFixture({
      NEXT_RUNTIME: runtime,
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString
    });
    assert.equal(result.imports, 0, "Non-Node registration must not load Node-only dependencies.");
    assert.equal(result.errors.length, 0);
  }

  const disabled = await registerFixture({ NEXT_RUNTIME: "nodejs" });
  assert.equal(disabled.imports, 0, "Unconfigured telemetry must not load the SDK.");

  const configured = {
    NEXT_RUNTIME: "nodejs",
    APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString
  };
  const browser = await registerFixture(configured, undefined, {});
  assert.equal(browser.imports, 0, "A browser context must not load the Node SDK even with a runtime setting.");
  const enabled = await registerFixture(configured);
  assert.equal(enabled.imports, 1);
  assert.equal(enabled.calls.length, 1);
  assert.equal(enabled.calls[0].azureMonitorExporterOptions.connectionString, connectionString);
  assert.equal(enabled.calls[0].instrumentationOptions.http.enabled, true);
  assert.equal(enabled.calls[0].instrumentationOptions.azureSdk.enabled, true);
  for (const name of ["mongoDb", "mySql", "postgreSql", "redis", "redis4"]) {
    assert.equal(enabled.calls[0].instrumentationOptions[name].enabled, false);
  }
  assert.equal(enabled.errors.length, 0);

  for (const failure of ["import", "initialize"]) {
    const result = await registerFixture(configured, failure);
    assert.equal(result.errors.length, 1, "Telemetry failures must be logged without rejecting registration.");
    assert.match(result.errors[0][0], /Azure Monitor init failed/);
  }
  console.log("Instrumentation guard and registration regression checks passed (SDK mocked; no network).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
