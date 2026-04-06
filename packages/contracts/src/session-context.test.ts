import assert from "node:assert/strict";
import test from "node:test";

import {
  contextChunkSchema,
  messageContextTraceSchema,
  sessionEntitySchema
} from "./session-context.js";

test("session entity schema validates ownership and isolation metadata", () => {
  const now = new Date().toISOString();
  const session = sessionEntitySchema.parse({
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
  });
  assert.equal(session.owner.principalId, "user:alice");
});

test("context chunk schema preserves provenance trust labels", () => {
  const now = new Date().toISOString();
  const chunk = contextChunkSchema.parse({
    chunkId: "chunk:test",
    sessionId: "session:test",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    content: "hello",
    tokenEstimate: 2,
    createdAt: now,
    sticky: false,
    stale: false,
    provenance: {
      sourceType: "retrieved-web-content",
      sourceId: "web:1",
      sourceRef: "https://example.com",
      observedAt: now,
      trustClassification: "EXTERNAL_UNTRUSTED",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      sessionId: "session:test",
      contentCategory: "retrieval-snippet",
      transformation: {
        transformed: false,
        derivedFromChunkIds: [],
        derivedFromSourceRefs: []
      }
    },
    metadata: {}
  });
  assert.equal(chunk.provenance.trustClassification, "EXTERNAL_UNTRUSTED");
});

test("context trace schema captures include/exclude decisions", () => {
  const trace = messageContextTraceSchema.parse({
    traceId: "ctx-trace:test",
    messageId: "msg:test",
    sessionId: "session:test",
    tenantId: "tenant-a",
    workspaceId: "workspace-a",
    resolvedBy: "context-assembler",
    resolvedAt: new Date().toISOString(),
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
    consideredSources: ["session-message", "system-instruction"],
    entries: [
      {
        chunkId: "chunk:1",
        sourceRef: "message:1",
        sourceType: "session-message",
        trustClassification: "USER_OWNED",
        outcome: "included",
        reasonCode: "INCLUDED_RECENT_SESSION_MESSAGE"
      },
      {
        chunkId: "chunk:2",
        sourceRef: "message:2",
        sourceType: "session-message",
        trustClassification: "USER_OWNED",
        outcome: "excluded",
        reasonCode: "EXCLUDED_TOKEN_BUDGET"
      }
    ],
    includedChunkIds: ["chunk:1"],
    excludedChunkIds: ["chunk:2"],
    tokenBudget: 100,
    tokenUsed: 40,
    trace: {
      traceId: "012f7ea5-c9ee-47f3-bba4-fc719f6ddb4f",
      correlationId: "0d593f9d-36e4-4f39-99cb-968024062438"
    }
  });
  assert.equal(trace.entries.length, 2);
});
