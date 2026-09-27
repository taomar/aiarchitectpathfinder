import { createHmac, scrypt, timingSafeEqual } from "node:crypto";

export type AuthMode = "none" | "password" | "entra";
export type EntraUser = { id: string; email: string; name?: string };

const SESSION_SECONDS = 8 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthConfigurationError extends Error {}

export function authMode(): AuthMode {
  const mode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === "production" ? "" : "none");
  if (mode === "password" || mode === "entra") return mode;
  if (mode === "none" && process.env.NODE_ENV !== "production") return mode;
  throw new AuthConfigurationError("Set AUTH_MODE=password or AUTH_MODE=entra for production.");
}

export function appOrigin(): string {
  const value = process.env.APP_ORIGIN;
  if (!value && process.env.NODE_ENV !== "production") return "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new AuthConfigurationError("APP_ORIGIN must be the application's public origin.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:"))) {
    throw new AuthConfigurationError("APP_ORIGIN must be an HTTPS origin without a path or credentials.");
  }
  return url.origin;
}

function passwordSettings() {
  const hash = process.env.AUTH_PASSWORD_HASH ?? "";
  const secret = process.env.AUTH_SESSION_SECRET ?? "";
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) {
    throw new AuthConfigurationError("AUTH_PASSWORD_HASH must be generated with the password setup command.");
  }
  if (Buffer.byteLength(secret) < 32) {
    throw new AuthConfigurationError("AUTH_SESSION_SECRET must contain at least 32 bytes of random material.");
  }
  return { hash, secret };
}

export function validateAuthConfiguration() {
  const mode = authMode();
  if (mode === "none") return;
  appOrigin();
  if (mode === "password") {
    passwordSettings();
  } else {
    if (!UUID.test(process.env.AUTH_ENTRA_TENANT_ID ?? "") ||
        !UUID.test(process.env.AUTH_ENTRA_CLIENT_ID ?? "")) {
      throw new AuthConfigurationError("Entra mode requires AUTH_ENTRA_TENANT_ID and AUTH_ENTRA_CLIENT_ID.");
    }
    if (process.env.WEBSITE_AUTH_ENABLED?.toLowerCase() !== "true") {
      throw new AuthConfigurationError("Entra mode requires enabled App Service authentication.");
    }
  }
}

export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-pathfinder-session" : "pathfinder-session";
}

function signature(payload: string) {
  const { hash, secret } = passwordSettings();
  // Including the password hash invalidates existing sessions when the password changes.
  return createHmac("sha256", secret).update(`${hash}:${payload}`).digest();
}

export async function verifyPassword(password: string): Promise<boolean> {
  const { hash } = passwordSettings();
  if (!password || Buffer.byteLength(password) > 1024) return false;
  const [, salt, expected] = hash.split("$");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, result) => error ? reject(error) : resolve(result));
  });
  return timingSafeEqual(derived, Buffer.from(expected, "hex"));
}

export function createSession(now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issued, exp: issued + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  const expected = signature(parts[0]);
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!claims || typeof claims !== "object") return false;
  const { v, iat, exp } = claims as Record<string, unknown>;
  const time = Math.floor(now / 1000);
  return v === 1 && typeof iat === "number" && Number.isInteger(iat) &&
    typeof exp === "number" && Number.isInteger(exp) && iat <= time &&
    exp > time && exp - iat === SESSION_SECONDS;
}

export function sessionCookie(token: string, clear = false) {
  return `${sessionCookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "");
}

function cookieValue(headers: Headers) {
  const prefix = `${sessionCookieName()}=`;
  return (headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

export function safeReturnPath(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(value) ? value : "/";
}

export function isSameOrigin(request: Request) {
  return request.headers.get("origin") === appOrigin();
}

export function entraUser(headers: Headers): EntraUser | null {
  if (authMode() !== "entra") return null;
  // These headers are authoritative only behind App Service's enabled EasyAuth module.
  validateAuthConfiguration();
  const encoded = headers.get("x-ms-client-principal");
  if (!encoded || encoded.length > 32768) return null;
  let principal: unknown;
  try {
    principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!principal || typeof principal !== "object") return null;
  const value = principal as Record<string, unknown>;
  if (value.auth_typ !== "aad" || !Array.isArray(value.claims)) return null;
  const claims = value.claims.filter((claim): claim is { typ: string; val: string } =>
    !!claim && typeof claim === "object" && typeof claim.typ === "string" && typeof claim.val === "string"
  );
  const claimValue = (pattern: RegExp) => claims.find((claim) => pattern.test(claim.typ))?.val;
  const tenant = claimValue(/^(tid|http:\/\/schemas\.microsoft\.com\/identity\/claims\/tenantid)$/);
  const id = claimValue(/^(oid|http:\/\/schemas\.microsoft\.com\/identity\/claims\/objectidentifier)$/);
  if (!id || tenant?.toLowerCase() !== process.env.AUTH_ENTRA_TENANT_ID?.toLowerCase()) return null;
  const email = claimValue(/emailaddress|\/email$|^email$|upn|preferred_username/i) ?? "";
  return { id, email: email.trim().toLowerCase(), name: claimValue(/^name$|\/name$/) };
}

export function hasAppAccess(request: Request) {
  validateAuthConfiguration();
  switch (authMode()) {
    case "none":
      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
    case "password":
      return verifySession(cookieValue(request.headers));
    case "entra":
      return entraUser(request.headers) !== null;
  }
}

export function requireAppAccess(request: Request): Response | null {
  try {
    if (!hasAppAccess(request)) {
      return Response.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if (authMode() !== "none" && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request)) {
      return Response.json({ error: "Origin not allowed." }, { status: 403 });
    }
    return null;
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    console.error("[auth] Configuration rejected:", error.message);
    return Response.json({ error: "Authentication is not configured." }, { status: 503 });
  }
}

export function createLoginLimiter() {
  let attempts: number[] = [];
  return (now = Date.now()) => {
    attempts = attempts.filter((time) => time > now - 15 * 60 * 1000);
    if (attempts.length >= 20) return false;
    attempts.push(now);
    return true;
  };
}
