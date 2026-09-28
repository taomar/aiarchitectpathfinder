import { z } from "zod";

type ModelJsonSchema =
  | { type: "string"; enum?: string[] }
  | { type: "boolean" }
  | { type: "array"; items: ModelJsonSchema }
  | { type: "object"; properties: Record<string, ModelJsonSchema>; required: string[]; additionalProperties: false };

export type ModelOutputSchema = { name: string; strict: true; schema: ModelJsonSchema };

export function modelOutputSchema(name: string, source: z.ZodTypeAny): ModelOutputSchema {
  const convert = (schema: z.ZodTypeAny): ModelJsonSchema => {
    if (schema instanceof z.ZodEffects) return convert(schema.innerType());
    if (schema instanceof z.ZodObject) {
      const properties = Object.fromEntries(
        Object.entries<z.ZodTypeAny>(schema.shape).map(([key, value]) => [key, convert(value)])
      );
      return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
    }
    if (schema instanceof z.ZodArray) return { type: "array", items: convert(schema.element) };
    if (schema instanceof z.ZodEnum) return { type: "string", enum: [...schema.options] };
    if (schema instanceof z.ZodString) return { type: "string" };
    if (schema instanceof z.ZodBoolean) return { type: "boolean" };
    throw new Error(`Unsupported model-output schema: ${schema.constructor.name}`);
  };
  const schema = convert(source);
  if (schema.type !== "object") throw new Error("A model-output schema must have an object root.");
  // Azure's supported subset excludes string/array bounds and custom refinements.
  // The original Zod schema still enforces those after decoding.
  return { name, strict: true, schema };
}
