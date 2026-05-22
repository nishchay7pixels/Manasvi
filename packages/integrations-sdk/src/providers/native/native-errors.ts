export class NativeGoogleError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "not_connected"
      | "missing_scope"
      | "approval_required"
      | "approval_verification_unavailable"
      | "validation_error"
      | "api_error"
  ) {
    super(message);
    this.name = "NativeGoogleError";
  }
}

export function sanitizeNativeGoogleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "<redacted-token>")
    .replace(/"access_token"\s*:\s*"[^"]+"/g, "\"access_token\":\"<redacted>\"")
    .replace(/"refresh_token"\s*:\s*"[^"]+"/g, "\"refresh_token\":\"<redacted>\"")
    .slice(0, 500);
}
