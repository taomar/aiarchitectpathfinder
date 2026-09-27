import { randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const environment = process.argv[2];
if (!environment || !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,60}$/.test(environment)) {
  console.error("Usage: node scripts/deploy-external-password.mjs <azd-environment>");
  process.exit(1);
}
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const values = {
  AUTH_MODE: "password",
  AUTH_PASSWORD_HASH: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`,
  AUTH_SESSION_SECRET: randomBytes(48).toString("base64url")
};
try {
  for (const [name, value] of Object.entries(values)) {
    execFileSync("azd", ["env", "set", name, value, "--environment", environment], {
      stdio: "pipe", windowsHide: true
    });
  }
  const directory = resolve(".azure", environment);
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, "access-password.txt");
  writeFileSync(file, password + "\n", { mode: 0o600 });
  console.log(`Authentication configured. Read the generated password locally from ${file}.`);
  console.log("Do not commit or upload this file. Rotating the password invalidates existing sessions after redeployment.");
} catch {
  console.error("Could not save authentication settings. Check the selected azd environment and retry; no password was printed.");
  process.exitCode = 1;
}
