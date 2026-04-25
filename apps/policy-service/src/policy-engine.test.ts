import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPolicyEvaluationRequest,
  policySetSchema,
  type PolicyEvaluationRequest,
  type PolicySet,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";

import { evaluatePolicy } from "./policy-engine.js";

async function loadPolicySet(): Promise<PolicySet> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../configs/policies/default-policy-set.json");
  const raw = await readFile(path, "utf8");
  return policySetSchema.parse(JSON.parse(raw));
}

function context(overrides?: Partial<ResolvedPrincipalContext>): ResolvedPrincipalContext {
  return {
    caller: { principalType: "service", principalId: "service:orchestrator-service" },
    actor: { principalType: "human_user", principalId: "user:alice" },
    service: { principalType: "service", principalId: "service:orchestrator-service" },
    sessionOwner: { principalType: "human_user", principalId: "user:alice" },
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    scopes: ["agent.invoke"],
    authnStrength: "strong",
    authenticated: true,
    ...overrides
  };
}

function request(
  input: Partial<PolicyEvaluationRequest> & {
    actionClass: PolicyEvaluationRequest["action"]["actionClass"];
    resourceClass: PolicyEvaluationRequest["resource"]["resourceClass"];
    resourceId: string;
  }
): PolicyEvaluationRequest {
  return createPolicyEvaluationRequest({
    requestingService: { principalType: "service", principalId: "service:orchestrator-service" },
    principalContext: input.principalContext ?? context(),
    action: {
      actionClass: input.actionClass,
      actionId: input.action?.actionId ?? "test.action",
      attributes: {}
    },
    resource: {
      resourceClass: input.resourceClass,
      resourceId: input.resourceId,
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      attributes: {}
    },
    requestedCapabilities: input.requestedCapabilities ?? [
      {
        capabilityId: "agent.invoke",
        scope: {
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          resourceClass: input.resourceClass
        },
        constraints: {}
      }
    ],
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    approval: {
      approvalPresent: false,
      skipApprovalRequested: false
    },
    risk: {
      declaredLevel: "medium",
      flags: [],
      requireExplicitRiskPolicy: true
    },
    environment: {
      attributes: {}
    },
    trace: {
      traceId: randomUUID(),
      correlationId: randomUUID()
    }
  });
}

test("allow decision success for orchestrator invoking agent", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "invoke",
      resourceClass: "agent-definition",
      resourceId: "agent:default-planner"
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "ALLOW");
  assert.equal(result.response.policySetVersion, policySet.policySetVersion);
  assert.ok(result.response.matchedPolicyId);
});

test("deny by default for sensitive action with no matching policy", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "mutate-memory",
      resourceClass: "memory-namespace",
      resourceId: "memory:unknown"
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "DENY");
  assert.equal(result.response.reasonCodes.length > 0, true);
});

test("explicit deny precedence for skip-approval", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "skip-approval",
      resourceClass: "approval-authority",
      resourceId: "approval:global"
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "DENY");
  assert.ok(result.response.reasonCodes.includes("EXPLICIT_DENY_POLICY"));
});

test("approval required path", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      principalContext: context({
        actor: { principalType: "agent", principalId: "agent:planner" }
      }),
      actionClass: "access-network",
      resourceClass: "tool-endpoint",
      resourceId: "tool:web-search",
      requestedCapabilities: [
        {
          capabilityId: "tool.invoke",
          scope: {
            tenantId: "tenant-a",
            workspaceId: "workspace-a",
            resourceClass: "tool-endpoint"
          },
          constraints: {}
        }
      ]
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "REQUIRE_APPROVAL");
  assert.equal(result.response.approvalRequired, true);
});

test("external side effect intent requires approval", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "external-side-effect",
      resourceClass: "tool-endpoint",
      resourceId: "tool:shell",
      requestedCapabilities: [
        {
          capabilityId: "tool.invoke",
          scope: {
            tenantId: "tenant-a",
            workspaceId: "workspace-a",
            resourceClass: "tool-endpoint"
          },
          constraints: {}
        }
      ]
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "REQUIRE_APPROVAL");
  assert.equal(result.response.approvalRequired, true);
});

test("low-risk read intent can be allowed without approval", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "read",
      resourceClass: "tool-endpoint",
      resourceId: "tool:web-search",
      requestedCapabilities: [
        {
          capabilityId: "tool.read",
          scope: {
            tenantId: "tenant-a",
            workspaceId: "workspace-a",
            resourceClass: "tool-endpoint"
          },
          constraints: {}
        }
      ]
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "ALLOW");
  assert.equal(result.response.approvalRequired, false);
});

test("missing principal context authentication is rejected", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      principalContext: context({ authenticated: false }),
      actionClass: "invoke",
      resourceClass: "agent-definition",
      resourceId: "agent:default-planner"
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "DENY");
  assert.ok(result.response.reasonCodes.includes("UNAUTHENTICATED_PRINCIPAL_CONTEXT"));
});

test("capability-based failure", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "invoke",
      resourceClass: "agent-definition",
      resourceId: "agent:default-planner",
      requestedCapabilities: []
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "DENY");
  assert.ok(result.response.reasonCodes.includes("MISSING_REQUIRED_CAPABILITY"));
});

test("high-risk action requires explicit high-risk policy coverage", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    createPolicyEvaluationRequest({
      requestingService: { principalType: "service", principalId: "service:orchestrator-service" },
      principalContext: context(),
      action: {
        actionClass: "read",
        actionId: "memory.read.high-risk",
        attributes: {}
      },
      resource: {
        resourceClass: "memory-namespace",
        resourceId: "memory:session",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        attributes: {}
      },
      requestedCapabilities: [
        {
          capabilityId: "memory.read",
          scope: {
            tenantId: "tenant-a",
            workspaceId: "workspace-a",
            resourceClass: "memory-namespace"
          },
          constraints: {}
        }
      ],
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      approval: {
        approvalPresent: false,
        skipApprovalRequested: false
      },
      risk: {
        declaredLevel: "critical",
        flags: ["cross-tenant"],
        requireExplicitRiskPolicy: true
      },
      environment: {
        attributes: {}
      },
      trace: {
        traceId: randomUUID(),
        correlationId: randomUUID()
      }
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.response.decision, "DENY");
  assert.ok(
    result.response.reasonCodes.includes("HIGH_RISK_REQUIRES_EXPLICIT_POLICY_COVERAGE")
  );
});

test("decision audit record emission", async () => {
  const policySet = await loadPolicySet();
  const result = evaluatePolicy(
    policySet,
    request({
      actionClass: "invoke",
      resourceClass: "agent-definition",
      resourceId: "agent:default-planner"
    }),
    { defaultDecisionTtlSeconds: 300 }
  );
  assert.equal(result.auditRecord.decisionId, result.response.decisionId);
  assert.equal(result.auditRecord.actionClass, "invoke");
  assert.equal(result.auditRecord.resourceClass, "agent-definition");
});
