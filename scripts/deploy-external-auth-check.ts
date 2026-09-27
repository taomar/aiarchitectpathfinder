import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import {
  appOrigin, authMode, createLoginLimiter, createSession, hasAppAccess, requireAppAccess,
  safeReturnPath, sessionCookie, sessionCookieName, validateAuthConfiguration, verifyPassword, verifySession
} from "../lib/app-auth";
import { adminEmails, isAdminRequest } from "../lib/admin-auth";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { GET as health } from "../app/api/health/route";

const original = { ...process.env };
const password = randomBytes(24).toString("base64url");
const salt = randomBytes(16).toString("hex");
const hash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const origin = "https://auth-fixture.example";
let cases = 0;

function check(name: string, run: () => void) {
  run();
  cases++;
  console.log(`PASS ${name}`);
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "production", AUTH_MODE: "password", APP_ORIGIN: origin,
    AUTH_PASSWORD_HASH: hash, AUTH_SESSION_SECRET: randomBytes(48).toString("base64url")
  });
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAIL;
  check("password configuration and no default administrators", () => {
    validateAuthConfiguration();
    assert.deepEqual(adminEmails(), []);
    assert.equal(appOrigin(), origin);
  });
  assert.equal(await verifyPassword(password), true);
  assert.equal(await verifyPassword("incorrect"), false);
  assert.equal(await verifyPassword("x".repeat(1025)), false);
  console.log("PASS scrypt password verification and input bound"); cases++;
  const now = Date.now();
  const token = createSession(now);
  const request = (path = "/", method = "GET", cookie = token, requestOrigin = origin) =>
    new Request(origin + path, {
      method,
      headers: { Cookie: `${sessionCookieName()}=${cookie}`, Origin: requestOrigin }
    });
  check("session integrity, expiry, future issue time and password rotation", () => {
    assert.equal(verifySession(token, now), true);
    assert.equal(verifySession(token, now + 8 * 60 * 60 * 1000), false);
    assert.equal(verifySession(token, now - 1000), false);
    assert.equal(verifySession(`${token}x`, now), false);
    assert.equal(verifySession("invalid"), false);
    process.env.AUTH_PASSWORD_HASH = hash.replace(salt, randomBytes(16).toString("hex"));
    assert.equal(verifySession(token, now), false);
    process.env.AUTH_PASSWORD_HASH = hash;
    assert.match(sessionCookie(token), /^__Host-pathfinder-session=.*Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/);
  });
  check("API authentication and cross-origin mutation rejection", () => {
    assert.equal(hasAppAccess(request()), true);
    assert.equal(requireAppAccess(request("/api/usage", "POST")), null);
    assert.equal(requireAppAccess(request("/api/usage", "POST", token, "https://attacker.example"))?.status, 403);
    assert.equal(requireAppAccess(request("/api/tiebreak", "GET", ""))?.status, 401);
    assert.equal(requireAppAccess(request("/api/usage", "POST", token, ""))?.status, 403);
  });
  check("password mode ignores forged identity headers and cannot grant admin", () => {
    process.env.ADMIN_EMAILS = "operator@example.test";
    const forged = new Headers({
      "x-ms-client-principal-name": "operator@example.test",
      "x-ms-client-principal": Buffer.from(JSON.stringify({ name: "operator@example.test" })).toString("base64")
    });
    assert.equal(isAdminRequest(forged), false);
    assert.equal(hasAppAccess(new Request(origin, { headers: forged })), false);
  });
  check("return paths cannot redirect to another origin", () => {
    for (const target of ["//attacker.example", "/\\attacker.example", "https://attacker.example", "/\nattack"]) {
      assert.equal(safeReturnPath(target), "/");
    }
    assert.equal(safeReturnPath("/?resume=1"), "/?resume=1");
  });
  check("bounded account-wide login limiter", () => {
    const allow = createLoginLimiter();
    for (let index = 0; index < 20; index++) assert.equal(allow(1000), true);
    assert.equal(allow(1001), false);
    assert.equal(allow(901001), true);
  });
  const loginRequest = (value: string, next = "/") => new Request(origin + "/api/auth/login", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: value, next })
  });
  const rejected = await login(loginRequest("wrong"));
  assert.equal(rejected.status, 303);
  assert.match(rejected.headers.get("location") ?? "", /error=invalid/);
  assert.equal(rejected.headers.get("set-cookie"), null);
  const accepted = await login(loginRequest(password, "//attacker.example"));
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), origin + "/");
  assert.match(accepted.headers.get("set-cookie") ?? "", /HttpOnly.*Secure/);
  assert.equal((await login(new Request(origin + "/api/auth/login", {
    method: "POST", headers: { Origin: "https://attacker.example" }
  }))).status, 403);
  assert.equal((await login(loginRequest("x".repeat(5000)))).status, 413);
  console.log("PASS real login handler rejects bad credentials, cross-origin and oversized forms"); cases++;
  const signedOut = await logout(request("/api/auth/logout", "POST"));
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await health()).status, 200);
  console.log("PASS logout and readiness handlers"); cases++;
  check("production has no unauthenticated fallback", () => {
    process.env.AUTH_MODE = "none";
    assert.throws(authMode, /production/);
    assert.equal(requireAppAccess(request())?.status, 503);
    delete process.env.AUTH_MODE;
    assert.throws(authMode, /production/);
    process.env.AUTH_MODE = "password";
  });
  check("Entra requires platform authentication, configured tenant and assigned admin", () => {
    Object.assign(process.env, {
      AUTH_MODE: "entra",
      AUTH_ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
      AUTH_ENTRA_CLIENT_ID: "22222222-2222-2222-2222-222222222222"
    });
    delete process.env.WEBSITE_AUTH_ENABLED;
    assert.equal(requireAppAccess(request())?.status, 503);
    process.env.WEBSITE_AUTH_ENABLED = "True";
    const principal = (tenant: string) => Buffer.from(JSON.stringify({
      auth_typ: "aad", claims: [
        { typ: "tid", val: tenant }, { typ: "oid", val: "user-id" },
        { typ: "preferred_username", val: "operator@example.test" }
      ]
    })).toString("base64");
    const headers = new Headers({ "x-ms-client-principal": principal(process.env.AUTH_ENTRA_TENANT_ID!) });
    assert.equal(hasAppAccess(new Request(origin, { headers })), true);
    assert.equal(isAdminRequest(headers), true);
    headers.set("x-ms-client-principal", principal("33333333-3333-3333-3333-333333333333"));
    assert.equal(hasAppAccess(new Request(origin, { headers })), false);
    headers.set("x-ms-client-principal", "invalid");
    assert.equal(hasAppAccess(new Request(origin, { headers })), false);
  });
  console.log(`Authentication boundary: ${cases} groups passed; synthetic credentials only, no network.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
