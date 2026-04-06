import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PolicyClient } from "@manasvi/policy-sdk";

import { queryPolicyForExecution } from "./policy-integration.js";

test("execution manager policy query integration returns deny for simulated policy response", async () => {
  const client: PolicyClient = {
    async evaluate(request) {
      return {
        schemaVersion: "1.0",
        decisionId: "decision:test",
        decision: "DENY",
        reasonCodes: ["NO_MATCHING_POLICY_DENY_BY_DEFAULT"],
        approvalRequired: false,
        conditions: [],
        risk: {
          score: 70,
          level: "high",
          factors: ["sensitive_action:execute"]
        },
        policySetVersion: "2026-04-06.m4.1",
        policySourceRef: "configs/policies/default-policy-set.json",
        ttlSeconds: 300,
        auditRecordId: "audit:test",
        trace: request.trace
      };
    }
  };

  const decision = await queryPolicyForExecution(client, {
    principalContext: {
      caller: { principalType: "service", principalId: "service:execution-manager" },
      actor: { principalType: "agent", principalId: "agent:planner" },
      service: { principalType: "service", principalId: "service:execution-manager" },
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      scopes: ["node.execute"],
      authnStrength: "strong",
      authenticated: true
    },
    actionClass: "execute",
    actionId: "execution.dispatch",
    resource: {
      resourceClass: "execution-node",
      resourceId: "node:remote-1",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requestedCapabilities: ["node.execute"],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    }
  });

  assert.equal(decision.decision, "DENY");
  assert.ok(decision.reasonCodes.includes("NO_MATCHING_POLICY_DENY_BY_DEFAULT"));
});
