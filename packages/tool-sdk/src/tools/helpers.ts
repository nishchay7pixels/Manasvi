import { z } from "zod";
import { toolManifestSchema, type ToolManifest } from "@manasvi/contracts";

export function now(): string {
  return new Date().toISOString();
}

export function prop(description: string, type: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type, description, ...extra };
}

export function jsonSchemaObject(
  required: string[],
  properties: Record<string, unknown>,
  schemaDescription?: string
): Record<string, unknown> {
  return {
    type: "object",
    ...(schemaDescription ? { description: schemaDescription } : {}),
    required,
    properties,
    additionalProperties: false
  };
}

export function parseManifest(input: Parameters<typeof toolManifestSchema.parse>[0]): ToolManifest {
  return toolManifestSchema.parse(input);
}

export type { ToolManifest };

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface BuiltInToolSpec {
  manifest: ToolManifest;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  examples: ToolExample[];
}
