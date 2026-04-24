import { createHash } from "node:crypto";

import { redactionMetadataSchema, type AuditEvent } from "@manasvi/contracts";

const DEFAULT_SENSITIVE_KEYS = [
  "authorization",
  "token",
  "secret",
  "password",
  "apiKey",
  "signingSecret",
  "nodeCredentialToken",
  "scopedExecutionToken",
  "accessToken",
  "refreshToken",
  "cookie"
];

export interface RedactionResult {
  payload: Record<string, unknown>;
  redactedFields: string[];
}

function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16);
}

function redactValue(path: string, value: unknown, redactedFields: string[]): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(`${path}[${index}]`, item, redactedFields));
  }
  if (typeof value !== "object") {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const fullPath = path ? `${path}.${key}` : key;
    const shouldRedact = DEFAULT_SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()));
    if (shouldRedact) {
      redactedFields.push(fullPath);
      const marker = typeof child === "string" ? hashString(child) : "masked";
      next[key] = `[REDACTED:${marker}]`;
      continue;
    }
    next[key] = redactValue(fullPath, child, redactedFields);
  }
  return next;
}

export function applyAuditRedaction(event: AuditEvent): AuditEvent {
  const redactedFields: string[] = [];
  const payload = redactValue("", event.payload, redactedFields) as Record<string, unknown>;
  const redaction = redactionMetadataSchema.parse({
    applied: redactedFields.length > 0,
    redactedFields,
    ...(redactedFields.length > 0 ? { reason: "sensitive_field_masking" } : {})
  });
  return {
    ...event,
    payload,
    redaction
  };
}

