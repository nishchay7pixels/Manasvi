import assert from "node:assert/strict";

interface DeadLetterRecordLike {
  reasonCode?: string;
}

interface IntentValidationResultLike {
  ok: boolean;
  code?: string;
}

export function assertEventRejected(
  outcome: "acked" | "duplicate" | "dead-lettered",
  deadLetters: DeadLetterRecordLike[],
  expectedReason: string
): void {
  assert.equal(outcome, "dead-lettered", `expected dead-lettered outcome but got ${outcome}`);
  assert.ok(deadLetters.length > 0, "expected a dead-letter record");
  assert.equal(deadLetters[0]?.reasonCode, expectedReason);
}

export function assertApprovalBypassPrevented(
  result: IntentValidationResultLike,
  expectedCode: string
): void {
  assert.equal(result.ok, false, "expected approval bypass validation to fail");
  assert.equal(result.code, expectedCode);
}

export function assertNodeDispatchDenied(
  eligibility: { eligible: boolean; reasonCode?: string },
  expectedReasonCode: string
): void {
  assert.equal(eligibility.eligible, false, "expected node dispatch to be denied");
  assert.equal(eligibility.reasonCode, expectedReasonCode);
}

export function assertNoCrossSessionLeak(params: {
  sessionId: string;
  forbiddenSessionId: string;
  chunkSessionIds: string[];
}): void {
  const leaked = params.chunkSessionIds.some((candidate) => candidate === params.forbiddenSessionId);
  assert.equal(
    leaked,
    false,
    `context for ${params.sessionId} leaked forbidden session ${params.forbiddenSessionId}`
  );
}

export function assertUntrustedMemoryNotPromoted(error: unknown): void {
  assert.ok(error instanceof Error, "expected an error for silent trust promotion");
  const message = (error as Error).message;
  assert.ok(
    message.includes("SILENT_TRUST_PROMOTION_BLOCKED") ||
      message.includes("Untrusted content cannot be directly written into trusted durable memory") ||
      message.includes("not allowed for memory class"),
    `unexpected memory poisoning error: ${message}`
  );
}

export function renderSecurityFailureEvidence(input: {
  assumptionId: string;
  boundary: string;
  observed: Record<string, unknown>;
}): string {
  return JSON.stringify(
    {
      assumptionId: input.assumptionId,
      boundary: input.boundary,
      observed: input.observed
    },
    null,
    2
  );
}
