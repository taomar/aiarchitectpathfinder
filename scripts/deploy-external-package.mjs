import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distributableSource } from "./deploy-external-files.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".deploy", "source");
const marker = resolve(output, ".pathfinder-generated-package");
if (existsSync(output)) {
  if (!existsSync(marker)) throw new Error("Refusing to replace an unrecognized .deploy/source directory.");
  rmSync(output, { recursive: true });
}
mkdirSync(output, { recursive: true });
writeFileSync(marker, "Generated source deployment package; no environment files.\n");

const files = [
  "app", "components", "lib", "public",
  "package.json", "package-lock.json", "next.config.mjs", "next-env.d.ts",
  "tsconfig.json", "tailwind.config.ts", "postcss.config.js", "proxy.ts", "instrumentation.ts"
];
for (const file of files) {
  cpSync(resolve(root, file), resolve(output, file), {
    recursive: true,
    filter: (source) => distributableSource(root, source)
  });
  console.log(`Packaged ${file}`);
}
const manifest = JSON.parse(readFileSync(resolve(output, "package.json"), "utf8"));
if (!manifest.scripts?.build || !manifest.scripts?.start) throw new Error("The package needs build and start scripts.");
console.log("Source package ready. App Service/Oryx builds on Linux; local configuration and internal deployment files are excluded.");
