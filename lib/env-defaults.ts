import * as fs from "fs";
import * as path from "path";

export function loadLocalEnvDefaults(keys: readonly string[]) {
  if (typeof window !== "undefined" || process.env.NODE_ENV === "production") return;
  // Empty host values are intentional settings, not gaps for a file to replace.
  const allowed = new Set(keys.filter((key) => process.env[key] === undefined));
  if (allowed.size === 0) return;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new Error(`Could not read local configuration ${name}.`, { cause: error });
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim();
      if (!allowed.has(key) || process.env[key] !== undefined) continue;
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
