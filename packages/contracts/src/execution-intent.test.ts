import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  computeExecutionIntentPayloadHash,
  createExecutionIntent,
  executionIntentSchema
} from "./execution-intent.js";

test("execution intent payload hash changes when snapshot changes", () => {
  const base = {
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    actor: { principalType: "human_user" as const, principalId: "user:alice" },
    caller: { principalType: "service" as const, principalId: "service:orchestrator-service" },
    trace: { traceId: randomUUID(), correlationId: randomUUID() },
    action: {
      actionId: "tool.run",
      actionClass: "external-side-effect" as const,
      operation: "run",
      parameters: { command: "echo hello" }
    },
    target: {
      resourceClass: "tool-endpoint" as const,
      resourceId: "tool:shell",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requiredCapabilities: ["tool.invoke"],
    risk: { score: 70, level: "high" as const, reasons: ["external_side_effect"] },
    policy: {
      decisionId: "decision:test",
      decision: "REQUIRE_APPROVAL" as const,
      approvalRequired: true,
      reasonCodes: ["RULE_REQUIRES_APPROVAL"],
      policySetVersion: "test",
      policySourceRef: "test",
      auditRecordId: "audit:test"
    },
    createdByService: "orchestrator-service",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: "idem-1"
  };

  const hash1 = computeExecutionIntentPayloadHash(base);
  const hash2 = computeExecutionIntentPayloadHash({
    ...base,
    action: {
      ...base.action,
      parameters: { command: "echo changed" }
    }
  });
  assert.notEqual(hash1, hash2);
});

test("create execution intent produces valid schema-compliant artifact", () => {
  const intent = createExecutionIntent({
    snapshot: {
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      actor: { principalType: "human_user", principalId: "user:alice" },
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      originSessionId: "session:1",
      trace: { traceId: randomUUID(), correlationId: randomUUID() },
      action: {
        actionId: "tool.run",
        actionClass: "external-side-effect",
        operation: "run",
        parameters: {}
      },
      target: {
        resourceClass: "tool-endpoint",
        resourceId: "tool:shell",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        attributes: {}
      },
      requiredCapabilities: ["tool.invoke"],
      risk: { score: 70, level: "high", reasons: ["external_side_effect"] },
      policy: {
        decisionId: "decision:test",
        decision: "REQUIRE_APPROVAL",
        approvalRequired: true,
        reasonCodes: ["RULE_REQUIRES_APPROVAL"],
        policySetVersion: "test",
        policySourceRef: "test",
        auditRecordId: "audit:test"
      },
      createdByService: "orchestrator-service",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "idem-2"
    },
    approval: {
      state: "pending",
      required: true,
      requirementReason: "policy_requires_approval"
    },
    lifecycle: "pending_approval"
  });
  executionIntentSchema.parse(intent);
  assert.ok(intent.intentId.startsWith("intent:"));
  assert.equal(intent.approval.state, "pending");
});
