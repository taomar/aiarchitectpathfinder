import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { getUsageSummary } from "@/lib/usage-store";
import { requireAppAccess } from "@/lib/app-auth";

export async function GET(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  if (!isAdminRequest(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || 30);
  const summary = await getUsageSummary(Number.isFinite(days) ? days : 30);
  return NextResponse.json(summary);
}
