import { AuthConfigurationError, validateAuthConfiguration } from "@/lib/app-auth";

export async function GET() {
  try {
    validateAuthConfiguration();
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof AuthConfigurationError)) throw error;
    console.error("[health] Authentication configuration rejected:", error.message);
    return Response.json({ status: "not-ready" }, { status: 503 });
  }
}
