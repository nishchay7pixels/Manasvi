import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PolicyEvaluationResponse } from "@manasvi/contracts";

import { buildExecutionIntentFromPolicy } from "./intent-planner.js";

const baseDecision: PolicyEvaluationResponse = {
  schemaVersion: "1.0",
  decisionId: "decision:test",
  decision: "ALLOW",
  reasonCodes: ["ALLOW_BY_POLICY"],
  approvalRequired: false,
  conditions: [],
  risk: {
    score: 40,
    level: "medium",
    factors: []
  },
  policySetVersion: "set-1",
  policySourceRef: "configs/policies/default-policy-set.json",
  ttlSeconds: 300,
  auditRecordId: "audit:test",
  trace: {
    traceId: randomUUID(),
    correlationId: randomUUID()
  }
};

test("planner creates pending approval intent when policy requires approval", () => {
  const intent = buildExecutionIntentFromPolicy({
    decision: {
      ...baseDecision,
      decision: "REQUIRE_APPROVAL",
      approvalRequired: true,
      reasonCodes: ["RULE_REQUIRES_APPROVAL"]
    },
    principalContext: {
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      actor: { principalType: "human_user", principalId: "user:alice" },
      authenticated: true,
      authnStrength: "strong",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      scopes: []
    },
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
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
    ttlSeconds: 900,
    signing: { keyId: "test-k1", secret: "test-signing-secret" }
  });
  assert.equal(intent.approval.state, "pending");
  assert.equal(intent.lifecycle, "pending_approval");
});

test("planner creates denied intent when policy denies", () => {
  const intent = buildExecutionIntentFromPolicy({
    decision: {
      ...baseDecision,
      decision: "DENY",
      approvalRequired: false,
      reasonCodes: ["NO_MATCHING_POLICY_DENY_BY_DEFAULT"]
    },
    principalContext: {
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      actor: { principalType: "human_user", principalId: "user:alice" },
      authenticated: true,
      authnStrength: "strong",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      scopes: []
    },
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    trace: { traceId: randomUUID(), correlationId: randomUUID() },
    action: {
      actionId: "tool.read",
      actionClass: "read",
      operation: "read",
      parameters: {}
    },
    target: {
      resourceClass: "tool-endpoint",
      resourceId: "tool:web-search",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requiredCapabilities: ["tool.read"],
    ttlSeconds: 900,
    signing: { keyId: "test-k1", secret: "test-signing-secret" }
  });
  assert.equal(intent.lifecycle, "denied");
});
