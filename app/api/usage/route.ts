import { NextResponse } from "next/server";
import { recordUsageEvent } from "@/lib/usage-store";
import { requireAppAccess } from "@/lib/app-auth";

export async function POST(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const result = await recordUsageEvent(body, req.headers);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[/api/usage] error:", err?.message ?? err);
    return NextResponse.json({ recorded: false, error: "Usage event was not recorded." }, { status: 500 });
  }
}
