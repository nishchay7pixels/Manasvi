import assert from "node:assert/strict";
import test from "node:test";

import {
  auditApprovalRecordSchema,
  auditEventSchema,
  computeAuditEventContentHash,
  createAuditEvent,
  decisionRecordSchema,
  toolExecutionRecordSchema
} from "./audit.js";

test("audit event schema supports redaction and integrity metadata", () => {
  const event = createAuditEvent({
    eventType: "ingress.message.received",
    producingService: "ingress-service",
    traceId: "trace-1",
    correlationId: "corr-1",
    severity: "info",
    payload: { text: "hello" }
  });
  const parsed = auditEventSchema.parse({
    ...event,
    integrity: {
      contentHash: "a".repeat(64),
      previousEventHash: "0".repeat(64),
      sequenceNumber: 1,
      signature: "b".repeat(64)
    }
  });
  assert.equal(parsed.integrity?.sequenceNumber, 1);
});

test("computeAuditEventContentHash is stable for identical event content", () => {
  const event = createAuditEvent({
    eventType: "policy.decision.deny",
    producingService: "policy-service",
    traceId: "trace-2",
    correlationId: "corr-2",
    severity: "warn",
    payload: { actionClass: "execute" }
  });
  const one = computeAuditEventContentHash(event);
  const two = computeAuditEventContentHash(event);
  assert.equal(one, two);
});

test("decision, approval, and tool execution records validate", () => {
  const decision = decisionRecordSchema.parse({
    schemaVersion: "1.0",
    decisionId: "decision:1",
    auditId: "audit:1",
    decisionType: "policy",
    timestamp: new Date().toISOString(),
    producingService: "policy-service",
    trace: {
      traceId: "4a9d86e2-f622-40ca-b8d5-b4828123f528",
      correlationId: "79fabd11-f5f1-4587-a2ca-007d98f7f4f8"
    },
    actionClass: "execute",
    resourceClass: "tool",
    resourceId: "tool:shell",
    outcome: "deny",
    reasonCodes: ["policy_deny"],
    approvalRequired: false
  });
  assert.equal(decision.outcome, "deny");

  const approval = auditApprovalRecordSchema.parse({
    schemaVersion: "1.0",
    approvalRecordId: "approval-record:1",
    approvalId: "approval:1",
    linkedIntentId: "intent:1",
    timestamp: new Date().toISOString(),
    producingService: "approval-service",
    trace: {
      traceId: "ca2b75a4-7a67-43a4-a98a-cd46ce4f7cc6",
      correlationId: "11f7e45d-3cc2-4917-9ce7-b0c35c32fa4f"
    },
    state: "granted",
    reasonCodes: [],
    context: {}
  });
  assert.equal(approval.state, "granted");

  const execution = toolExecutionRecordSchema.parse({
    schemaVersion: "1.0",
    executionRecordId: "execution-record:1",
    timestamp: new Date().toISOString(),
    producingService: "execution-manager",
    trace: {
      traceId: "9f0acdf5-9da2-4f59-9ef6-1fef4f50a2e6",
      correlationId: "95d08fa7-4f31-4720-9868-307ba84e17c9"
    },
    runId: "run:1",
    toolId: "tool:http_fetch",
    sandboxMode: "restricted_remote",
    runtimePolicySummary: {},
    status: "completed"
  });
  assert.equal(execution.status, "completed");
});
