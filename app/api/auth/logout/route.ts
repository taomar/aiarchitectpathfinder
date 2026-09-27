import { appOrigin, authMode, requireAppAccess, sessionCookie } from "@/lib/app-auth";

export async function POST(request: Request) {
  const denied = requireAppAccess(request);
  if (denied) return denied;
  const destination = authMode() === "entra"
    ? "/.auth/logout"
    : "/login";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(destination, appOrigin()).toString(),
      "Set-Cookie": sessionCookie("", true),
      "Cache-Control": "no-store"
    }
  });
}
