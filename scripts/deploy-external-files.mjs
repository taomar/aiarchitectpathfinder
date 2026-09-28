import { lstatSync } from "node:fs";
import { extname, relative } from "node:path";

const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".svg",
  ".ps1", ".yaml", ".yml", ".bicep", ".bicepparam"
]);

export function distributableSource(root, source) {
  const path = relative(root, source).replaceAll("\\", "/");
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Distribution does not permit symlinks: ${path}`);
  if (/(^|\/)(\.git|\.azure|\.internal|\.serena|node_modules|\.next|\.env[^/]*)(\/|$)/i.test(path)) return false;
  if (stat.isDirectory()) return true;
  if (path === "public/ms-icons/microsoft-logo.png") return true;
  return sourceExtensions.has(extname(path).toLowerCase()) ||
    path === ".gitignore" || path === "docs/deployment/env.example";
}
