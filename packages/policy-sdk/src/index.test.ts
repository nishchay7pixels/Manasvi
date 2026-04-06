import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createPolicyEvaluationRequest } from "@manasvi/contracts";

import { HttpPolicyClient } from "./index.js";

test("http policy client validates request and parses response", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          schemaVersion: "1.0",
          decisionId: "decision:test",
          decision: "ALLOW",
          reasonCodes: ["ALLOW_BY_POLICY"],
          approvalRequired: false,
          conditions: [],
          risk: {
            score: 20,
            level: "low",
            factors: []
          },
          matchedPolicyId: "test-policy",
          matchedPolicyVersion: "1.0.0",
          matchedRuleId: "rule-1",
          policySetVersion: "2026-04-06.m4.1",
          policySourceRef: "test",
          ttlSeconds: 300,
          auditRecordId: "audit:test",
          trace: body.trace
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const client = new HttpPolicyClient({
      baseUrl: "http://policy-service:4103",
      getAuthToken: async () => "internal-token"
    });
    const response = await client.evaluate(
      createPolicyEvaluationRequest({
        requestingService: { principalType: "service", principalId: "service:test-client" },
        principalContext: {
          caller: { principalType: "service", principalId: "service:test-client" },
          actor: { principalType: "service", principalId: "service:test-client" },
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          scopes: [],
          authnStrength: "strong",
          authenticated: true
        },
        action: {
          actionClass: "invoke",
          actionId: "test.invoke",
          attributes: {}
        },
        resource: {
          resourceClass: "agent-definition",
          resourceId: "agent:test",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          attributes: {}
        },
        requestedCapabilities: [],
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        approval: {
          approvalPresent: false,
          skipApprovalRequested: false
        },
        risk: {
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
      })
    );

    assert.equal(response.decision, "ALLOW");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
