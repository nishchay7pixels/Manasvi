/**
 * Machine-readable JSON output for automation-friendly CLI usage.
 * All JSON responses use a stable envelope so scripts can rely on shape.
 */

export interface CliWarning {
  code: string;
  message: string;
}

export interface CliError {
  code: string;
  message: string;
  fix?: string;
}

export interface CliJsonResponse<T = unknown> {
  ok: boolean;
  command: string;
  timestamp: string;
  data: T;
  warnings: CliWarning[];
  errors: CliError[];
  nextSteps: string[];
}

// ── Builders ───────────────────────────────────────────────────────────────────

export function jsonOk<T>(
  command: string,
  data: T,
  opts: { warnings?: CliWarning[]; nextSteps?: string[] } = {}
): CliJsonResponse<T> {
  return {
    ok: true,
    command,
    timestamp: new Date().toISOString(),
    data,
    warnings: opts.warnings ?? [],
    errors: [],
    nextSteps: opts.nextSteps ?? []
  };
}

export function jsonFail<T = null>(
  command: string,
  errors: CliError[],
  data: T = null as unknown as T,
  opts: { warnings?: CliWarning[]; nextSteps?: string[] } = {}
): CliJsonResponse<T> {
  return {
    ok: false,
    command,
    timestamp: new Date().toISOString(),
    data,
    warnings: opts.warnings ?? [],
    errors,
    nextSteps: opts.nextSteps ?? []
  };
}

// ── Output ─────────────────────────────────────────────────────────────────────

export function printJson(response: CliJsonResponse<unknown>): void {
  console.log(JSON.stringify(response, null, 2));
}

// ── Secret masking ─────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "INTERNAL_AUTH_SIGNING_SECRET",
  "INTERNAL_AUTH_VERIFICATION_KEYS",
  "EVENT_SIGNING_KEYS",
  "INGRESS_SIGNING_KEY_ID",
  "INGRESS_SIGNING_SECRET",
  "APPROVAL_SIGNING_KEYS",
  "APPROVAL_SIGNING_KEY_ID",
  "APPROVAL_VERIFICATION_KEYS",
  "INTENT_SIGNING_KEY_ID",
  "INTENT_SIGNING_SECRET",
  "NODE_CREDENTIAL_KEY_ID",
  "NODE_CREDENTIAL_SIGNING_SECRET",
  "NODE_CREDENTIAL_VERIFICATION_KEYS",
  "MEMORY_ENCRYPTION_KEY",
  "AUDIT_INTEGRITY_KEY",
  "API_GATEWAY_AUTH_TOKEN",
  "GENERIC_WEBHOOK_SHARED_SECRET",
  "TELEGRAM_WEBHOOK_SECRET"
]);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

export function maskValue(value: string): string {
  if (!value || value.length <= 4) return "••••••••";
  const tail = value.slice(-4);
  return `••••••••••••${tail}`;
}

export function maskEnvMap(
  env: Record<string, string>,
  showSecrets = false
): Record<string, string> {
  if (showSecrets) return env;
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    masked[k] = isSensitiveKey(k) ? maskValue(v) : v;
  }
  return masked;
}
