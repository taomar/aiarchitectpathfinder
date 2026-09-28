import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { distributableSource } from "./deploy-external-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".deploy", "publish");
const marker = resolve(output, ".pathfinder-generated-export");
const initialized = existsSync(resolve(output, ".git"));
const refresh = process.argv.includes("--refresh");
if (initialized && !refresh) {
  throw new Error("Refusing to overwrite an initialized publication repository.");
}
if (existsSync(output)) {
  if (!existsSync(marker)) throw new Error("Refusing to replace an unrecognized publication directory.");
  if (initialized) {
    // Refresh only previously selected files, preserving the independent publication history.
    const tracked = execFileSync("git", ["-C", output, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of tracked) {
      const target = resolve(output, file);
      if (relative(output, target).startsWith("..")) throw new Error("Publication path escapes the generated directory.");
      rmSync(target, { force: true });
    }
  } else {
    rmSync(output, { recursive: true });
  }
}
mkdirSync(output, { recursive: true });
writeFileSync(marker, "Generated external source snapshot. Review before publishing.\n");

const excludedScripts = new Set(["deploy.ps1", "deployment-regression-check.ps1", "dev-local.ps1"]);
const selected = [
  "app", "components", "lib", "public", "scripts",
  ".gitignore", "azure.yaml", "package.json", "package-lock.json", "PRODUCT.md", "DESIGN.md",
  "playwright.config.ts",
  "next.config.mjs", "postcss.config.js", "tailwind.config.ts", "tsconfig.json",
  "proxy.ts", "instrumentation.ts",
  "infra/main.bicep", "infra/main.bicepparam",
  "docs/deployment/README.md", "docs/deployment/simple.md",
  "docs/deployment/entra.md", "docs/deployment/configuration.md", "docs/deployment/local.md", "docs/deployment/architecture-views.md",
  "docs/deployment/env.example"
];
for (const item of selected) {
  const destination = resolve(output, item);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(resolve(root, item), destination, {
    recursive: true,
    filter: (source) => {
      const path = relative(root, source).replaceAll("\\", "/");
      if (path.startsWith("scripts/") && excludedScripts.has(path.slice("scripts/".length))) return false;
      return distributableSource(root, source);
    }
  });
}

const manifestPath = resolve(output, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
  if ([...excludedScripts].some((file) => command.replaceAll("\\", "/").includes(`scripts/${file}`))) {
    delete manifest.scripts[name];
  }
}
Object.assign(manifest.scripts, {
  deploy: "pwsh -NoProfile -File scripts/deploy-external.ps1",
  "deploy:validate": "pwsh -NoProfile -File scripts/deploy-external.ps1 -ValidateOnly",
  "auth:setup": "node scripts/deploy-external-password.mjs",
  "test:auth": "tsx scripts/deploy-external-auth-check.ts",
  "test:external-ai": "tsx scripts/deploy-external-ai-check.ts"
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(resolve(output, ".env.example"), readFileSync(resolve(root, "docs/deployment/env.example")));
writeFileSync(resolve(output, "README.md"),
  readFileSync(resolve(root, "docs/deployment/README.md"), "utf8")
    .replace(/\]\((simple|entra|configuration|local|architecture-views)\.md/g, "](" + "docs/deployment/$1.md"));
writeFileSync(resolve(output, "next-env.d.ts"),
  '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
writeFileSync(resolve(output, ".gitignore"),
  readFileSync(resolve(root, ".gitignore"), "utf8") + "\n.pathfinder-generated-export\n");
console.log(`External source snapshot assembled at ${output}.`);
console.log("Only allowlisted source formats were selected; Office documents, spreadsheets, PDFs, archives, local state and Git history are excluded.");
console.log("Review every selected file and scan the snapshot before creating its initial commit.");
