import { NextResponse } from "next/server";
import { requireAppAccess } from "@/lib/app-auth";
import {
  azureOpenAIImageEnabled,
  azureOpenAIImageStatus,
  generateArchitectureImage
} from "@/lib/azure-openai-image";

export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  return NextResponse.json(azureOpenAIImageStatus());
}

export async function POST(req: Request) {
  const denied = requireAppAccess(req);
  if (denied) return denied;
  if (!azureOpenAIImageEnabled()) {
    return NextResponse.json(
      { error: "Pathfinder APIM image generation is not configured." },
      { status: 400 }
    );
  }
  try {
    const body = await req.json();
    if (!body?.decision) {
      return NextResponse.json({ error: "Missing decision." }, { status: 400 });
    }
    const result = await generateArchitectureImage(body.decision);
    return NextResponse.json({
      dataUrl: `data:${result.mimeType};base64,${result.base64}`,
      revisedPrompt: result.revisedPrompt
    });
  } catch (err: any) {
    const cause = err?.cause?.message ?? err?.cause?.code ?? "";
    const raw = err?.message ?? "Image generation failed.";
    let msg = raw;
    let hint: string | undefined;
    if (/DeploymentNotFound|404/.test(raw)) {
      hint =
        "The APIM image route or deployment name was not found. Verify PATHFINDER_IMAGE_DEPLOYMENT_NAME=mai-image-25 and the APIM /image/generations path.";
    } else if (/content_policy|safety|moderation/i.test(raw)) {
      hint =
        "The prompt was blocked by content safety. Try regenerating after removing sensitive selections.";
    }
    console.error("[/api/architecture-image] error:", raw, cause);
    return NextResponse.json(
      {
        error: cause ? `${msg} (cause: ${cause})` : msg,
        hint
      },
      { status: 500 }
    );
  }
}
