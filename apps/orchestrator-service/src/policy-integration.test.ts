import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PolicyClient } from "@manasvi/policy-sdk";

import { queryPolicyForOrchestration } from "./policy-integration.js";

test("orchestrator policy query integration builds evaluable request", async () => {
  let capturedRequestId: string | undefined;
  const client: PolicyClient = {
    async evaluate(request) {
      capturedRequestId = request.requestId;
      return {
        schemaVersion: "1.0",
        decisionId: "decision:test",
        decision: "ALLOW",
        reasonCodes: ["ALLOW_BY_POLICY"],
        approvalRequired: false,
        conditions: [],
        risk: {
          score: 25,
          level: "low",
          factors: []
        },
        matchedPolicyId: "orchestration-runtime-policy",
        matchedPolicyVersion: "1.0.0",
        matchedRuleId: "allow-orchestrator-invoke-agent",
        policySetVersion: "2026-04-06.m4.1",
        policySourceRef: "configs/policies/default-policy-set.json",
        ttlSeconds: 300,
        auditRecordId: "audit:test",
        trace: request.trace
      };
    }
  };

  const decision = await queryPolicyForOrchestration(client, {
    principalContext: {
      caller: { principalType: "service", principalId: "service:orchestrator-service" },
      actor: { principalType: "human_user", principalId: "user:alice" },
      service: { principalType: "service", principalId: "service:orchestrator-service" },
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      scopes: ["agent.invoke"],
      authnStrength: "strong",
      authenticated: true
    },
    actionClass: "invoke",
    actionId: "orchestration.plan.invoke-agent",
    resource: {
      resourceClass: "agent-definition",
      resourceId: "agent:default-planner",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requestedCapabilities: ["agent.invoke"],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    }
  });

  assert.equal(decision.decision, "ALLOW");
  assert.ok(capturedRequestId);
});
