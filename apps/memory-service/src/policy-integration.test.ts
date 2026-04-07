import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PolicyClient } from "@manasvi/policy-sdk";

import { queryPolicyForMemory } from "./policy-integration.js";

test("memory policy query builds evaluable request", async () => {
  let capturedNamespace: string | undefined;
  const client: PolicyClient = {
    async evaluate(request) {
      capturedNamespace = request.resource.resourceId;
      return {
        schemaVersion: "1.0",
        decisionId: "decision:test",
        decision: "ALLOW",
        reasonCodes: ["ALLOW_BY_POLICY"],
        approvalRequired: false,
        conditions: [],
        risk: {
          score: 35,
          level: "medium",
          factors: []
        },
        policySetVersion: "test",
        policySourceRef: "test",
        ttlSeconds: 300,
        auditRecordId: "audit:test",
        trace: request.trace
      };
    }
  };
  const decision = await queryPolicyForMemory(client, {
    principalContext: {
      caller: { principalId: "service:orchestrator-service", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      service: { principalId: "service:orchestrator-service", principalType: "service" },
      tenantId: "tenant-local",
      workspaceId: "workspace-local",
      authnStrength: "strong",
      authenticated: true,
      scopes: ["memory.read"]
    },
    actionClass: "read",
    actionId: "memory.query",
    namespace: "user/user:alice/profile",
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    requestedCapabilities: ["memory.read"],
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    }
  });
  assert.equal(decision.decision, "ALLOW");
  assert.equal(capturedNamespace, "user/user:alice/profile");
});
