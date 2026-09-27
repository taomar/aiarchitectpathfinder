import { NextRequest, NextResponse } from "next/server";
import { appOrigin, authMode, AuthConfigurationError, requireAppAccess, validateAuthConfiguration } from "@/lib/app-auth";
import { isAdminRequest } from "@/lib/admin-auth";

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/api/health") return NextResponse.next();
  try {
    validateAuthConfiguration();
    const mode = authMode();
    if (mode === "password" && (path === "/login" || path === "/api/auth/login")) return NextResponse.next();
    const denied = requireAppAccess(req);
    if (denied) {
      if (denied.status !== 401 || path.startsWith("/api/")) return denied;
      const login = new URL(mode === "entra" ? "/.auth/login/aad" : "/login", appOrigin());
      login.searchParams.set(mode === "entra" ? "post_login_redirect_uri" : "next", path + req.nextUrl.search);
      return NextResponse.redirect(login);
    }
    if ((path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) &&
        !isAdminRequest(req.headers)) {
      return path.startsWith("/api/")
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : new NextResponse("Admin access only", { status: 403 });
    }
    return NextResponse.next();
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    console.error("[auth] Request configuration rejected:", error.message);
    return new NextResponse("Authentication is not configured.", { status: 503 });
  }
}

export const config = {
  matcher: ["/((?!_next/static/|ms-icons/|favicon.ico$).*)"]
};