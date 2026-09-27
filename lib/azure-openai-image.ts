import { loadEnvExampleFallback } from "./azure-openai";
import { displayPatternName } from "./pathfinder-category";
import type { ArchitectureDecision } from "./types";
import {
  imageGenerationBody,
  pathfinderApimEnabled,
  pathfinderApimStatus,
  pathfinderConfig,
  pathfinderPostJson
} from "./pathfinder-apim";

export function azureOpenAIImageEnabled(): boolean {
  loadEnvExampleFallback();
  return pathfinderApimEnabled("image");
}

export function azureOpenAIImageStatus() {
  loadEnvExampleFallback();
  const config = pathfinderConfig();
  const status = pathfinderApimStatus();
  return {
    enabled: azureOpenAIImageEnabled(),
    deployment: config.imageDeploymentName,
    imageGenerationsPath: config.imageGenerationsPath,
    imageEditsPath: config.imageEditsPath,
    authMode: status.present.authMode
  };
}

/**
 * Build a tightly-scoped prompt that nudges the model to produce a
 * Microsoft Azure Architecture Center style diagram with official Azure
 * service icons, left-to-right flow and clear labelled boxes.
 */
export function buildArchitectureImagePrompt(
  decision: ArchitectureDecision
): string {
  const lines: string[] = [];
  lines.push(
    "Create a clean, professional Microsoft Azure architecture diagram in the style of the Microsoft Azure Architecture Center (azure.microsoft.com/architecture)."
  );
  lines.push(
    "Use official Azure / Microsoft 365 service icons (hexagon-style flat icons with rounded corners, Microsoft Fluent design)."
  );
  lines.push(
    "Layout: left-to-right flow. Group related components inside light grey rounded rectangles labelled by tier (Users, Channels, Runtime, Models, Knowledge & Data, Identity, Security, Network, Observability)."
  );
  lines.push(
    "Use thin grey arrows for the main data flow and dashed grey arrows for cross-cutting concerns (identity, security, networking, observability)."
  );
  lines.push(
    "White background, high contrast, vector look, no photos, no 3D, no logos other than Microsoft/Azure service icons, no decorative elements."
  );
  lines.push(
    "Title at the top: 'Recommended Architecture — " + displayPatternName(decision) + "'."
  );
  lines.push("");
  lines.push("Include only these components and group them as indicated:");
  for (const l of decision.architectureLayers) {
    const items = l.selections.filter(
      (s) => s && s !== "Not required for this use case"
    );
    if (items.length === 0) continue;
    lines.push(`- ${l.layer}: ${items.join(", ")}`);
  }
  if (decision.overlays.length > 0) {
    lines.push("");
    lines.push(
      "Apply these overlays as additional groups or annotations: " +
        decision.overlays.map((o) => o.name).join(", ") +
        "."
    );
  }
  lines.push("");
  lines.push(
    "Do NOT include any component listed below; they are explicitly out of scope:"
  );
  const blocked = [
    ...decision.blockedComponents,
    ...decision.forbiddenUnlessConfirmed
  ];
  if (blocked.length) lines.push("- " + blocked.join("\n- "));
  else lines.push("- (none)");
  lines.push("");
  lines.push(
    "Render labels in dark grey (#333). Use Microsoft blue (#0078D4) only for accent strokes."
  );
  return lines.join("\n");
}

export type ImageGenerationResult = {
  base64: string;
  mimeType: "image/png";
  revisedPrompt?: string;
};

export async function generateArchitectureImage(
  decision: ArchitectureDecision
): Promise<ImageGenerationResult> {
  if (!azureOpenAIImageEnabled()) {
    throw new Error(
      "Pathfinder APIM image generation is not configured."
    );
  }
  const config = pathfinderConfig();
  const prompt = buildArchitectureImagePrompt(decision);

  const body: Record<string, unknown> = {
    prompt,
    n: 1,
    size: "1536x1024"
  };
  body.output_format = "png";

  const result = await pathfinderPostJson(config.imageGenerationsPath, imageGenerationBody(body));
  const json = result.json;
  const first = json?.data?.[0];
  const base64: string | undefined = first?.b64_json;
  if (!base64) {
    throw new Error(
      "Azure OpenAI image response did not contain b64_json content."
    );
  }
  return {
    base64,
    mimeType: "image/png",
    revisedPrompt: first?.revised_prompt
  };
}
