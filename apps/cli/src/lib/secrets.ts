/**
 * Secure secret generation for Manasvi setup.
 * All secrets are cryptographically random — never hardcoded defaults.
 */

import { randomBytes } from "node:crypto";

/** Generate a random hex string of `bytes` length (produces `bytes*2` hex chars). */
export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Generate a random base64url string (URL-safe, no padding). */
export function randomBase64(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Generate all required secrets for a fresh Manasvi local installation.
 * Returns a map of env-var-name → generated-value.
 */
export function generateLocalSecrets(): Record<string, string> {
  const internalAuthKeyId = "local-k1";
  const internalAuthSecret = randomHex(32);

  const eventSigningKeyId = "local-event-key";
  const eventSigningSecret = randomHex(32);

  const approvalKeyId = "local-k1";
  const approvalSecret = randomHex(32);

  const intentSigningKeyId = "local-intent-k1";
  const intentSigningSecret = randomHex(32);

  const nodeCredKeyId = "local-node-k1";
  const nodeCredSecret = randomHex(32);

  const memoryEncKey = randomHex(32);
  const auditIntegrityKey = randomHex(32);
  const apiGatewayToken = randomBase64(24);
  const genericWebhookSecret = randomBase64(16);

  return {
    // Internal auth
    INTERNAL_AUTH_KEY_ID: internalAuthKeyId,
    INTERNAL_AUTH_SIGNING_SECRET: internalAuthSecret,
    INTERNAL_AUTH_VERIFICATION_KEYS: `${internalAuthKeyId}:${internalAuthSecret}`,

    // Event signing
    EVENT_SIGNING_KEYS: `${eventSigningKeyId}:${eventSigningSecret}`,
    INGRESS_SIGNING_KEY_ID: eventSigningKeyId,
    REQUIRE_SIGNED_INTERNAL_EVENTS: "true",

    // Approval
    APPROVAL_SIGNING_KEYS: `${approvalKeyId}:${approvalSecret}`,
    APPROVAL_SIGNING_KEY_ID: approvalKeyId,
    APPROVAL_VERIFICATION_KEYS: `${approvalKeyId}:${approvalSecret}`,

    // Intent signing
    INTENT_SIGNING_KEY_ID: intentSigningKeyId,
    INTENT_SIGNING_SECRET: intentSigningSecret,

    // Node credentials
    NODE_CREDENTIAL_KEY_ID: nodeCredKeyId,
    NODE_CREDENTIAL_SIGNING_SECRET: nodeCredSecret,
    NODE_CREDENTIAL_VERIFICATION_KEYS: `${nodeCredKeyId}:${nodeCredSecret}`,

    // Memory encryption
    MEMORY_ENCRYPTION_KEY: memoryEncKey,

    // Audit
    AUDIT_INTEGRITY_KEY: auditIntegrityKey,

    // API gateway
    API_GATEWAY_AUTH_TOKEN: apiGatewayToken,

    // Webhook secret (optional generic webhook)
    GENERIC_WEBHOOK_SHARED_SECRET: genericWebhookSecret
  };
}
