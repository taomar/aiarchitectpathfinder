import { defineConfig } from "@playwright/test";
import path from "node:path";

const artifacts = process.env.E2E_ARTIFACT_DIR;
if (!artifacts) throw new Error("Set E2E_ARTIFACT_DIR outside the repository before running browser tests.");
const artifactRelative = path.relative(__dirname, path.resolve(artifacts));
if (!(path.isAbsolute(artifactRelative) || artifactRelative === ".." || artifactRelative.startsWith(`..${path.sep}`))) {
  throw new Error("Browser results and downloads must stay outside the repository.");
}
const baseURL = process.env.E2E_BASE_URL || "https://127.0.0.1:3217";
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) {
  throw new Error("This human-behavior suite is restricted to a local test server.");
}
const run = process.env.E2E_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");

export default defineConfig({
  testDir: "./scripts/qa",
  testMatch: "**/*.spec.ts",
  timeout: 480_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  outputDir: path.join(artifacts, run, "browser-results"),
  reporter: [
    ["line"],
    ["json", { outputFile: path.join(artifacts, run, "playwright-results.json") }]
  ],
  use: {
    baseURL,
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "off",
    video: "off"
  }
});
