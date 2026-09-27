import { NextResponse } from "next/server";
import { azureOpenAIStatus } from "@/lib/azure-openai";
import { eliminateOptions } from "@/lib/wizard-filter";
import { applicableQuestions } from "@/lib/decision-engine";
import { requireAppAccess } from "@/lib/app-auth";

export const maxDuration = 180;

export async function GET(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  return NextResponse.json(azureOpenAIStatus());
}

export async function POST(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const input = body?.input;
    const questionId = body?.questionId as string;
    if (!input || !questionId) {
      return NextResponse.json(
        { error: "Missing input or questionId." },
        { status: 400 }
      );
    }
    const all = applicableQuestions(input);
    const question = all.find((q) => q.id === questionId);
    if (!question) {
      return NextResponse.json({ eliminate: [], note: "" });
    }
    const result = await eliminateOptions(input, question, req.signal);
    return NextResponse.json(result);
  } catch (err: any) {
    const cause = err?.cause?.message ?? err?.cause?.code ?? "";
    const msg = err?.message ?? "Wizard filter failed.";
    console.error("[/api/wizard-filter] error:", msg, cause);
    return NextResponse.json(
      { error: cause ? `${msg} (cause: ${cause})` : msg, eliminate: [] },
      { status: 500 }
    );
  }
}
