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

test("orchestrator policy query passes tool capability/resource context", async () => {
  let captured: {
    actionClass?: string;
    resourceClass?: string;
    capabilityIds?: string[];
  } = {};
  const client: PolicyClient = {
    async evaluate(request) {
      captured = {
        actionClass: request.action.actionClass,
        resourceClass: request.resource.resourceClass,
        capabilityIds: request.requestedCapabilities.map((item) => item.capabilityId)
      };
      return {
        schemaVersion: "1.0",
        decisionId: "decision:test",
        decision: "DENY",
        reasonCodes: ["DENY_BY_POLICY"],
        approvalRequired: false,
        conditions: [],
        risk: {
          score: 70,
          level: "high",
          factors: ["tool_execution"]
        },
        policySetVersion: "test",
        policySourceRef: "test",
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
      scopes: ["tool.invoke"],
      authnStrength: "strong",
      authenticated: true
    },
    actionClass: "execute",
    actionId: "tool.invoke.tool.shell-command",
    resource: {
      resourceClass: "tool-endpoint",
      resourceId: "tool.shell-command",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requestedCapabilities: ["shell.execute"],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    },
    riskFlags: ["privileged_tool"]
  });

  assert.equal(decision.decision, "DENY");
  assert.equal(captured.actionClass, "execute");
  assert.equal(captured.resourceClass, "tool-endpoint");
  assert.deepEqual(captured.capabilityIds, ["shell.execute"]);
});
