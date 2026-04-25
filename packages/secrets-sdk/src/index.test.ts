import assert from "node:assert/strict";
import test from "node:test";

import {
  policyEvaluationResponseSchema,
  type PolicyEvaluationRequest,
  type PolicyEvaluationResponse,
  type ResolvedPrincipalContext
} from "@manasvi/contracts";
import { type PolicyClient } from "@manasvi/policy-sdk";

import { EnvMapSecretProvider, SecretBroker, parseSecretReferenceMapping, redactSecretsInObject } from "./index.js";

class StubPolicyClient implements PolicyClient {
  constructor(private readonly mode: "allow" | "deny") {}
  async evaluate(_request: PolicyEvaluationRequest): Promise<PolicyEvaluationResponse> {
    const nowTrace = {
      traceId: "830bc3d7-45d3-4844-bb17-f92fcc1c66d7",
      correlationId: "edf77890-a1e2-40ad-ba5f-3485ccbf8f9f"
    };
    if (this.mode === "deny") {
      return policyEvaluationResponseSchema.parse({
        schemaVersion: "1.0",
        decisionId: "decision:deny",
        decision: "DENY",
        reasonCodes: ["policy_denied"],
        approvalRequired: false,
        conditions: [],
        risk: { score: 70, level: "high", factors: ["test_deny"] },
        policySetVersion: "local",
        policySourceRef: "test",
        ttlSeconds: 120,
        auditRecordId: "audit:deny",
        trace: nowTrace
      });
    }
    return policyEvaluationResponseSchema.parse({
      schemaVersion: "1.0",
      decisionId: "decision:allow",
      decision: "ALLOW",
      reasonCodes: ["policy_allow"],
      approvalRequired: false,
      conditions: [],
      risk: { score: 10, level: "low", factors: ["test_allow"] },
      policySetVersion: "local",
      policySourceRef: "test",
      ttlSeconds: 120,
      auditRecordId: "audit:allow",
      trace: nowTrace
    });
  }
}

function principalContext(): ResolvedPrincipalContext {
  return {
    caller: { principalId: "service:execution-manager", principalType: "service" },
    actor: { principalId: "user:alice", principalType: "human_user" },
    authenticated: true,
    authnStrength: "strong",
    scopes: []
  };
}

test("env provider resolves metadata and value from mapped key", async () => {
  const provider = new EnvMapSecretProvider(
    { TELEGRAM_TOKEN_ENV: "demo-token-value" },
    { "secret://tenant/acme/telegram/bot-token": "TELEGRAM_TOKEN_ENV" }
  );
  const metadata = await provider.resolveMetadata("secret://tenant/acme/telegram/bot-token");
  const value = await provider.getSecretValue("secret://tenant/acme/telegram/bot-token");
  assert.equal(metadata?.provider, "env-map");
  assert.equal(value, "demo-token-value");
});

test("secret broker denies unauthorized access", async () => {
  const provider = new EnvMapSecretProvider({ MANASVI_SECRET_REF_SECRET_DEMO: "secret-value" });
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("deny"),
    requestingService: { principalId: "service:execution-manager", principalType: "service" }
  });
  await assert.rejects(
    () =>
      broker.resolveForRuntime({
        principalContext: principalContext(),
        trace: {
          traceId: "ce4de5f3-68ae-4ffd-a8b8-22f8ad68463e",
          correlationId: "4d25fd5d-b08d-4735-bbe9-6f0429a83f03"
        },
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        consumerType: "tool-runtime",
        consumerId: "tool:http_fetch",
        purpose: "runtime_execution",
        references: ["secret:demo"]
      }),
    /SECRET_ACCESS_DENIED/
  );
});

test("secret broker allows authorized runtime and returns just-in-time secret map", async () => {
  const provider = new EnvMapSecretProvider({ MANASVI_SECRET_REF_SECRET_DEMO: "secret-value" });
  const usage: string[] = [];
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("allow"),
    requestingService: { principalId: "service:execution-manager", principalType: "service" },
    onUsageRecord: (record) => {
      usage.push(record.eventType);
    }
  });
  const result = await broker.resolveForRuntime({
    principalContext: principalContext(),
    trace: {
      traceId: "55709f74-c52f-4372-89fc-d44f0362230c",
      correlationId: "e0d8c646-d8f8-4d5d-bf32-d4416316bc56"
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    consumerType: "tool-runtime",
    consumerId: "tool:http_fetch",
    purpose: "runtime_execution",
    references: ["secret:demo"]
  });
  assert.equal(result.secretValuesByRef["secret:demo"], "secret-value");
  assert.equal(usage.includes("secret.injected"), true);
});

test("plugin/orchestrator raw exposure is blocked by default", async () => {
  const provider = new EnvMapSecretProvider({ MANASVI_SECRET_REF_SECRET_DEMO: "secret-value" });
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("allow"),
    requestingService: { principalId: "service:extension-runtime", principalType: "service" }
  });
  await assert.rejects(
    () =>
      broker.resolveForRuntime({
        principalContext: principalContext(),
        trace: {
          traceId: "178e7d05-a3ca-48ca-a095-8240428eaf2f",
          correlationId: "18f2a2e4-94ba-4220-ac50-3ef6f43406ca"
        },
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        consumerType: "plugin-runtime",
        consumerId: "plugin:demo",
        purpose: "plugin_launch",
        references: ["secret:demo"],
        requestRawExposure: true,
        allowRawExposureForConsumer: false
      }),
    /RAW_SECRET_EXPOSURE_DISABLED_FOR_CONSUMER/
  );
});

test("plugin raw exposure can be allowed only when explicitly enabled", async () => {
  const provider = new EnvMapSecretProvider({ MANASVI_SECRET_REF_SECRET_DEMO: "secret-value" });
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("allow"),
    requestingService: { principalId: "service:extension-runtime", principalType: "service" }
  });
  const result = await broker.resolveForRuntime({
    principalContext: principalContext(),
    trace: {
      traceId: "9ccb8d8a-e9f8-4f73-a07b-834f4f6e86b0",
      correlationId: "7fcbc1af-bf2c-4f8f-a51e-cf0df390d982"
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    consumerType: "plugin-runtime",
    consumerId: "plugin:demo",
    purpose: "plugin_launch",
    references: ["secret:demo"],
    requestRawExposure: true,
    allowRawExposureForConsumer: true
  });
  assert.equal(result.grants.length, 1);
  assert.equal(result.grants[0]?.rawValueExposureAllowed, true);
  assert.equal(result.secretValuesByRef["secret:demo"], "secret-value");
});

test("orchestrator raw exposure is blocked by default", async () => {
  const provider = new EnvMapSecretProvider({ MANASVI_SECRET_REF_SECRET_DEMO: "secret-value" });
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("allow"),
    requestingService: { principalId: "service:orchestrator-service", principalType: "service" }
  });
  await assert.rejects(
    () =>
      broker.resolveForRuntime({
        principalContext: principalContext(),
        trace: {
          traceId: "2f67d435-53ad-40c9-bc72-d357db95bd50",
          correlationId: "6f411ed6-b1fb-435f-bf7f-d709650f7975"
        },
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        consumerType: "orchestrator",
        consumerId: "service:orchestrator-service",
        purpose: "direct_raw_access_attempt",
        references: ["secret:demo"],
        requestRawExposure: true,
        allowRawExposureForConsumer: false
      }),
    /RAW_SECRET_EXPOSURE_DISABLED_FOR_CONSUMER/
  );
});

test("provider lookup failure is fail-closed", async () => {
  const provider = new EnvMapSecretProvider({});
  const broker = new SecretBroker({
    provider,
    policyClient: new StubPolicyClient("allow"),
    requestingService: { principalId: "service:execution-manager", principalType: "service" }
  });
  await assert.rejects(
    () =>
      broker.resolveForRuntime({
        principalContext: principalContext(),
        trace: {
          traceId: "38149a68-8cb9-406f-906f-5b2b369f0064",
          correlationId: "8b7ab8d2-50b6-4f49-b655-d0246f520371"
        },
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        consumerType: "tool-runtime",
        consumerId: "tool:http_fetch",
        purpose: "runtime_execution",
        references: ["secret:missing"]
      }),
    /SECRET_REFERENCE_NOT_FOUND|SECRET_VALUE_UNAVAILABLE/
  );
});

test("mapping parser and redaction helper work", () => {
  const mapping = parseSecretReferenceMapping(
    JSON.stringify({
      "secret:demo": "MANASVI_SECRET_REF_SECRET_DEMO"
    })
  );
  assert.equal(mapping["secret:demo"], "MANASVI_SECRET_REF_SECRET_DEMO");

  const redacted = redactSecretsInObject({
    token: "abc",
    nested: { apiKey: "xyz", safe: "ok" }
  });
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal((redacted.nested as { apiKey: string }).apiKey, "[REDACTED]");
  assert.equal((redacted.nested as { safe: string }).safe, "ok");
});
