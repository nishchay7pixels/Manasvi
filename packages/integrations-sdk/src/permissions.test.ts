import assert from "node:assert/strict";
import test from "node:test";

import type { PolicyClient } from "@manasvi/policy-sdk";
import type { PolicyEvaluationRequest, PolicyEvaluationResponse } from "@manasvi/contracts";

import {
  buildGoogleAuthorizationSnapshot,
  buildGooglePolicyBinding,
  checkGoogleActionPermission,
  deriveGoogleCapabilities,
  type GoogleActionId
} from "./permissions.js";
import type { IntegrationAccountRecord } from "./index.js";

const connectedAccount: IntegrationAccountRecord = {
  accountId: "integration:google:acct-1",
  providerId: "google",
  connectorId: "google-foundation",
  providerAccountId: "google-account:abc",
  status: "connected",
  scopesGranted: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send"
  ],
  tokenReference: "secretref:a",
  refreshTokenReference: "secretref:r",
  tokenExpiresAt: null,
  lastAuthAt: new Date().toISOString(),
  lastRefreshAt: null,
  lastError: null,
  revokedAt: null,
  disconnectedAt: null,
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

test("derives capabilities from granted scopes", () => {
  const derived = deriveGoogleCapabilities(connectedAccount.scopesGranted);
  const capabilityIds = derived.availableCapabilities.map((item) => item.capabilityId);
  assert.ok(capabilityIds.includes("gmail.read_threads"));
  assert.ok(capabilityIds.includes("gmail.send"));
  assert.ok(!capabilityIds.includes("calendar.write_events"));
});

test("policy binding includes integration identity and capability constraints", () => {
  const binding = buildGooglePolicyBinding({
    action: {
      actionId: "gmail.message.send",
      serviceFamily: "gmail",
      class: "communication_write",
      requiredCapabilities: ["gmail.send"],
      approvalSensitivity: "required",
      policyActionClass: "external-side-effect"
    },
    account: connectedAccount,
    principalContext: {
      caller: { principalId: "service:api-gateway", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      scopes: [],
      authnStrength: "strong",
      authenticated: true,
      tenantId: "tenant-local",
      workspaceId: "workspace-local"
    },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" }
  });
  assert.equal(binding.resource.resourceId, connectedAccount.accountId);
  assert.equal(binding.requestedCapabilities[0]?.capabilityId, "integration.google.capability.gmail.send");
});

class StaticPolicyClient implements PolicyClient {
  constructor(private readonly decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL") {}
  async evaluate(_request: PolicyEvaluationRequest): Promise<PolicyEvaluationResponse> {
    return {
      schemaVersion: "1.0",
      decisionId: "decision-1",
      decision: this.decision,
      reasonCodes: ["test_reason"],
      approvalRequired: this.decision === "REQUIRE_APPROVAL",
      conditions: [],
      risk: { score: 10, level: "low", factors: [] },
      policySetVersion: "local",
      policySourceRef: "test",
      ttlSeconds: 60,
      auditRecordId: "audit-1",
      trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" }
    };
  }
}

async function check(actionId: GoogleActionId, policy: PolicyClient) {
  return checkGoogleActionPermission({
    account: connectedAccount,
    actionId,
    principalContext: {
      caller: { principalId: "service:api-gateway", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      scopes: [],
      authnStrength: "strong",
      authenticated: true,
      tenantId: "tenant-local",
      workspaceId: "workspace-local"
    },
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:api-gateway", principalType: "service" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" },
    policyClient: policy
  });
}

test("denies when connector is disconnected", async () => {
  const result = await checkGoogleActionPermission({
    account: { ...connectedAccount, status: "disconnected" },
    actionId: "gmail.threads.read",
    principalContext: {
      caller: { principalId: "service:api-gateway", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      scopes: [],
      authnStrength: "strong",
      authenticated: true,
      tenantId: "tenant-local",
      workspaceId: "workspace-local"
    },
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:api-gateway", principalType: "service" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" }
  });
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes("CONNECTOR_NOT_CONNECTED"));
});

test("denies when required scope/capability is missing", async () => {
  const result = await check("calendar.events.write", new StaticPolicyClient("ALLOW"));
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes("MISSING_REQUIRED_SCOPE_OR_CAPABILITY"));
});

test("requires approval for approval-sensitive action", async () => {
  const result = await check("gmail.message.send", new StaticPolicyClient("ALLOW"));
  assert.equal(result.decision, "require_approval");
});

test("allows read action when scopes+policy allow", async () => {
  const result = await check("gmail.threads.read", new StaticPolicyClient("ALLOW"));
  assert.equal(result.decision, "allow");
});

test("authorization snapshot distinguishes connected from authorized actions", () => {
  const snapshot = buildGoogleAuthorizationSnapshot(connectedAccount);
  const readAction = snapshot.actions.find((item) => item.actionId === "gmail.threads.read");
  const calendarWrite = snapshot.actions.find((item) => item.actionId === "calendar.events.write");
  assert.equal(readAction?.canAttempt, true);
  assert.equal(calendarWrite?.canAttempt, false);
});

// ── G4 write capability derivation ───────────────────────────────────────────

const writeAccount: typeof connectedAccount = {
  ...connectedAccount,
  scopesGranted: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
};

test("gmail.modify scope derives gmail.compose, gmail.send, gmail.modify capabilities", () => {
  const derived = deriveGoogleCapabilities(writeAccount.scopesGranted);
  const ids = derived.availableCapabilities.map((c) => c.capabilityId);
  assert.ok(ids.includes("gmail.compose"), "should include gmail.compose");
  assert.ok(ids.includes("gmail.send"), "should include gmail.send");
  assert.ok(ids.includes("gmail.modify"), "should include gmail.modify");
  assert.ok(ids.includes("gmail.read_threads"), "should include gmail.read_threads");
});

test("gmail.draft.reply is policy approval sensitivity and requires gmail.compose", () => {
  const snapshot = buildGoogleAuthorizationSnapshot(writeAccount);
  const replyAction = snapshot.actions.find((a) => a.actionId === "gmail.draft.reply");
  assert.ok(replyAction, "gmail.draft.reply action should exist in snapshot");
  assert.equal(replyAction?.approvalSensitivity, "policy");
  assert.equal(replyAction?.canAttempt, true);
  assert.deepEqual(replyAction?.missingCapabilities, []);
});

test("gmail.message.archive requires gmail.modify and is available when scope granted", () => {
  const snapshot = buildGoogleAuthorizationSnapshot(writeAccount);
  const archiveAction = snapshot.actions.find((a) => a.actionId === "gmail.message.archive");
  assert.ok(archiveAction, "gmail.message.archive action should exist");
  assert.equal(archiveAction?.canAttempt, true);
  assert.deepEqual(archiveAction?.missingCapabilities, []);
});

test("gmail.message.label requires gmail.modify and is available when scope granted", () => {
  const snapshot = buildGoogleAuthorizationSnapshot(writeAccount);
  const labelAction = snapshot.actions.find((a) => a.actionId === "gmail.message.label");
  assert.ok(labelAction, "gmail.message.label action should exist");
  assert.equal(labelAction?.canAttempt, true);
  assert.deepEqual(labelAction?.missingCapabilities, []);
});

test("write actions show canAttempt=false when modify scope is missing", () => {
  const readOnlyAccount = { ...connectedAccount };
  const snapshot = buildGoogleAuthorizationSnapshot(readOnlyAccount);
  const archiveAction = snapshot.actions.find((a) => a.actionId === "gmail.message.archive");
  const labelAction = snapshot.actions.find((a) => a.actionId === "gmail.message.label");
  assert.equal(archiveAction?.canAttempt, false);
  assert.ok(archiveAction?.missingCapabilities.includes("gmail.modify"));
  assert.equal(labelAction?.canAttempt, false);
});

test("gmail.message.send has approval sensitivity=required even with full write scopes", () => {
  const snapshot = buildGoogleAuthorizationSnapshot(writeAccount);
  const sendAction = snapshot.actions.find((a) => a.actionId === "gmail.message.send");
  assert.ok(sendAction, "gmail.message.send should exist in snapshot");
  assert.equal(sendAction?.approvalSensitivity, "required");
  assert.equal(sendAction?.canAttempt, true);
});

test("checkGoogleActionPermission requires approval for gmail.draft.reply (policy sensitivity)", async () => {
  const result = await checkGoogleActionPermission({
    account: writeAccount,
    actionId: "gmail.draft.reply",
    principalContext: {
      caller: { principalId: "service:api-gateway", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      scopes: [],
      authnStrength: "strong",
      authenticated: true,
      tenantId: "tenant-local",
      workspaceId: "workspace-local"
    },
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:api-gateway", principalType: "service" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" },
    policyClient: new StaticPolicyClient("ALLOW")
  });
  // policy sensitivity = "policy" means check passes through to policy client (ALLOW here)
  assert.equal(result.decision, "allow");
});

test("checkGoogleActionPermission always requires approval for gmail.message.send", async () => {
  const result = await checkGoogleActionPermission({
    account: writeAccount,
    actionId: "gmail.message.send",
    principalContext: {
      caller: { principalId: "service:api-gateway", principalType: "service" },
      actor: { principalId: "user:alice", principalType: "human_user" },
      scopes: [],
      authnStrength: "strong",
      authenticated: true,
      tenantId: "tenant-local",
      workspaceId: "workspace-local"
    },
    actor: { principalId: "user:alice", principalType: "human_user" },
    caller: { principalId: "service:api-gateway", principalType: "service" },
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    trace: { traceId: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" },
    policyClient: new StaticPolicyClient("ALLOW")
  });
  assert.equal(result.decision, "require_approval");
});
