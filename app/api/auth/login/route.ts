import {
  appOrigin, authMode, AuthConfigurationError, createLoginLimiter, createSession,
  isSameOrigin, safeReturnPath, sessionCookie, validateAuthConfiguration, verifyPassword
} from "@/lib/app-auth";

const allowAttempt = createLoginLimiter();

export async function POST(request: Request) {
  try {
    validateAuthConfiguration();
    if (authMode() !== "password") return new Response(null, { status: 404 });
    if (!isSameOrigin(request)) return new Response("Origin not allowed.", { status: 403 });
    if (!allowAttempt()) {
      console.warn("[auth] Login rate limit reached.");
      return new Response("Too many sign-in attempts. Try again in 15 minutes.", {
        status: 429, headers: { "Retry-After": "900", "Cache-Control": "no-store" }
      });
    }
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
      return new Response("Unsupported content type.", { status: 415 });
    }
    const reader = request.body?.getReader();
    if (!reader) return new Response("Missing form.", { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return new Response("Form is too large.", { status: 413 });
      }
      chunks.push(value);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const returnPath = safeReturnPath(form.get("next"));
    if (!await verifyPassword(form.get("password") ?? "")) {
      console.warn("[auth] Sign-in rejected.");
      const login = new URL("/login", appOrigin());
      login.searchParams.set("error", "invalid");
      login.searchParams.set("next", returnPath);
      return new Response(null, { status: 303, headers: { Location: login.toString(), "Cache-Control": "no-store" } });
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(returnPath, appOrigin()).toString(),
        "Set-Cookie": sessionCookie(createSession()),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    console.error("[auth] Login configuration rejected:", error.message);
    return new Response("Authentication is not configured.", { status: 503 });
  }
}
