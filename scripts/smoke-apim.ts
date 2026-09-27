import {
  chatBody,
  imageGenerationBody,
  loadPathfinderEnv,
  pathfinderConfig,
  pathfinderPostJson
} from "../lib/pathfinder-apim";

async function runSmoke() {
  loadPathfinderEnv();
  const config = pathfinderConfig();
  const results: Array<Record<string, unknown>> = [];

  try {
    const chat = await pathfinderPostJson(config.chatPath, chatBody({
      messages: [
        { role: "user", content: "Return exactly: APIM text smoke test ok." }
      ],
      temperature: 0,
      max_completion_tokens: 64
    }));
    results.push({
      test: "chat",
      status: chat.status,
      correlationId: chat.correlationId,
      choices: Array.isArray(chat.json?.choices) ? chat.json.choices.length : 0,
      hasContent: !!chat.json?.choices?.[0]?.message?.content
    });
  } catch (err: any) {
    results.push({ test: "chat", error: err?.message ?? "failed" });
  }

  try {
    const image = await pathfinderPostJson(config.imageGenerationsPath, imageGenerationBody({
      prompt: "A simple blue square icon on a plain white background",
      n: 1,
      size: "1024x1024"
    }));
    const first = image.json?.data?.[0];
    results.push({
      test: "image-generation",
      status: image.status,
      correlationId: image.correlationId,
      itemCount: Array.isArray(image.json?.data) ? image.json.data.length : 0,
      hasImagePayload: !!(first?.b64_json || first?.url)
    });
  } catch (err: any) {
    results.push({ test: "image-generation", error: err?.message ?? "failed" });
  }

  console.log(JSON.stringify({
    baseUrlConfigured: !!config.baseUrl,
    tokenConfigured: !!config.tokenScope,
    results
  }, null, 2));
}

runSmoke().catch((err) => {
  console.error(JSON.stringify({ error: err?.message ?? "Smoke test failed" }));
  process.exit(1);
});
