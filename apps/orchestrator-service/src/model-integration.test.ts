import assert from "node:assert/strict";
import test from "node:test";

import type { AssembledContext, ResolvedPrincipalContext } from "@manasvi/contracts";

import { buildHarnessEventResultRecord, buildModelInvocationRequest } from "./model-integration.js";

function sampleAssembledContext(): AssembledContext {
  const now = new Date().toISOString();
  return {
    session: {
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      sessionId: "session:test",
      sessionType: "user_interaction",
      isolationMode: "per_user_isolated",
      status: "active",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      owner: { principalType: "human_user", principalId: "user:alice" },
      createdBy: { principalType: "service", principalId: "service:orchestrator-service" },
      participants: [],
      contextPolicyHints: {},
      tags: [],
      createdAt: now,
      lastActivityAt: now,
      riskProfile: {
        level: "low",
        factors: [],
        unsafeRequestCount: 0,
        untrustedContentRatio: 0,
        secretWorkflow: false,
        privilegedExecution: false,
        pluginInvolved: false,
        remoteNodeInvolved: false,
        approvalSensitive: false
      }
    },
    chunks: [
      {
        chunkId: "chunk:1",
        sessionId: "session:test",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        content: "user asked about deployment status",
        tokenEstimate: 8,
        createdAt: now,
        sticky: false,
        stale: false,
        role: "user_goal",
        provenance: {
          sourceType: "session-message",
          sourceId: "msg:1",
          sourceRef: "msg:1",
          observedAt: now,
          trustClassification: "USER_OWNED",
          authority: "informational",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          sessionId: "session:test",
          contentCategory: "user-input",
          transformation: {
            transformed: false,
            derivedFromChunkIds: [],
            derivedFromSourceRefs: []
          }
        },
        metadata: {}
      }
    ],
    trace: {
      traceId: "ctx-trace:test",
      messageId: "msg:1",
      sessionId: "session:test",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      resolvedBy: "context-assembler",
      resolvedAt: now,
      isolationMode: "per_user_isolated",
      riskProfile: {
        level: "low",
        factors: [],
        unsafeRequestCount: 0,
        untrustedContentRatio: 0,
        secretWorkflow: false,
        privilegedExecution: false,
        pluginInvolved: false,
        remoteNodeInvolved: false,
        approvalSensitive: false
      },
      consideredSources: ["session-message"],
      entries: [],
      includedChunkIds: ["chunk:1"],
      excludedChunkIds: [],
      tokenBudget: 2048,
      tokenUsed: 8,
      trace: {
        traceId: "f52f5cd9-8583-4c89-9cc9-0f9b0a341f85",
        correlationId: "8ac8f20d-658f-438d-88ca-c9b50b8f5f33"
      }
    }
  };
}

const principalContext: ResolvedPrincipalContext = {
  caller: { principalType: "service", principalId: "service:orchestrator-service" },
  actor: { principalType: "human_user", principalId: "user:alice" },
  authenticated: true,
  authnStrength: "strong",
  scopes: [],
  tenantId: "tenant-a",
  workspaceId: "workspace-a"
};

test("buildModelInvocationRequest includes session and chunks", () => {
  const assembled = sampleAssembledContext();
  const request = buildModelInvocationRequest({
    messageId: "event:1",
    traceId: "f52f5cd9-8583-4c89-9cc9-0f9b0a341f85",
    correlationId: "8ac8f20d-658f-438d-88ca-c9b50b8f5f33",
    userInput: "What is deployment status?",
    assembledContext: assembled,
    maxContextChunks: 10
  });
  assert.equal(request.sessionId, "session:test");
  assert.equal(request.contextChunks.length, 1);
});

test("buildHarnessEventResultRecord captures context and principal metadata", () => {
  const assembled = sampleAssembledContext();
  const record = buildHarnessEventResultRecord({
    eventId: "event:1",
    assembledContext: assembled,
    principalContext,
    traceId: "f52f5cd9-8583-4c89-9cc9-0f9b0a341f85",
    correlationId: "8ac8f20d-658f-438d-88ca-c9b50b8f5f33",
    policyDecision: "ALLOW",
    policyReasonCodes: ["RULE_MATCH"],
    modelResponse: {
      requestId: "req-1",
      outputText: "mock output",
      mode: "mock",
      provider: "mock",
      model: "test",
      latencyMs: 5
    }
  });
  assert.equal(record.status, "completed");
  assert.equal(record.sessionId, "session:test");
  assert.equal(record.principal.actorPrincipalId, "user:alice");
  assert.equal(record.context.includedChunkCount, 1);
  assert.equal(record.context.includedChunks[0]?.role, "user_goal");
});
