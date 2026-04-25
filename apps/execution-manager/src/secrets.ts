import { secretReferenceStringSchema } from "@manasvi/contracts";

export function parseSecretErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "SECRET_RESOLUTION_FAILED";
  const [code] = message.split(":");
  return code && code.length > 0 ? code : "SECRET_RESOLUTION_FAILED";
}

export function sanitizeIncomingSecretValues(
  input: Record<string, string>,
  allowedSecretRefs: string[]
): Record<string, string> {
  const allowed = new Set(allowedSecretRefs);
  const sanitized: Record<string, string> = {};
  for (const [reference, value] of Object.entries(input)) {
    secretReferenceStringSchema.parse(reference);
    if (!allowed.has(reference)) {
      throw new Error(`SECRET_REFERENCE_NOT_ALLOWED:${reference}`);
    }
    sanitized[reference] = value;
  }
  return sanitized;
}
