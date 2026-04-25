import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  ContextAssembler,
  InMemorySessionStore
} from "../../../../packages/session-sdk/src/index.js";

import { assertNoCrossSessionLeak } from "./oracles.js";

function trace() {
  return { traceId: randomUUID(), correlationId: randomUUID() };
}

function sessionResolve(ownerId: string, conversation: string) {
  return {
    tenantId: "tenant-local",
    workspaceId: "workspace-local",
    isolationMode: "per_channel_thread" as const,
    sessionType: "channel_thread" as const,
    owner: { principalId: ownerId, principalType: "human_user" as const },
    createdBy: { principalId: "service:orchestrator-service", principalType: "service" as const },
    participants: [{ principalId: "channel:telegram", principalType: "channel" as const }],
    channelBinding: {
      channelPrincipal: { principalId: "channel:telegram", principalType: "channel" as const },
      externalConversationId: conversation
    }
  };
}

test("[TB-SESSION-001][session] context assembly does not leak chunks across strict sessions", async () => {
  const store = new InMemorySessionStore();
  const assembler = new ContextAssembler(store, { recentMessageLimit: 10 });

  const a = await assembler.assembleForMessage({
    message: {
      messageId: "msg:a1",
      text: "session A private context",
      sender: { principalId: "user:alice", principalType: "human_user" },
      trustClassification: "USER_OWNED",
      sourceRef: "test:session-a"
    },
    sessionResolve: sessionResolve("user:alice", "chat-a"),
    trace: trace()
  });
  const b = await assembler.assembleForMessage({
    message: {
      messageId: "msg:b1",
      text: "session B private context",
      sender: { principalId: "user:bob", principalType: "human_user" },
      trustClassification: "USER_OWNED",
      sourceRef: "test:session-b"
    },
    sessionResolve: sessionResolve("user:bob", "chat-b"),
    trace: trace()
  });
  const followUpA = await assembler.assembleForMessage({
    message: {
      messageId: "msg:a2",
      text: "follow up in session A",
      sender: { principalId: "user:alice", principalType: "human_user" },
      trustClassification: "USER_OWNED",
      sourceRef: "test:session-a"
    },
    sessionResolve: sessionResolve("user:alice", "chat-a"),
    trace: trace()
  });

  const chunkSessionIds = followUpA.chunks.map((chunk) => chunk.sessionId);
  assertNoCrossSessionLeak({
    sessionId: followUpA.session.sessionId,
    forbiddenSessionId: b.session.sessionId,
    chunkSessionIds
  });
  assert.equal(followUpA.session.sessionId, a.session.sessionId);
});

test("[TB-SESSION-001][session][control] follow-up in same conversation reuses the same session", async () => {
  const store = new InMemorySessionStore();
  const assembler = new ContextAssembler(store);
  const first = await assembler.assembleForMessage({
    message: {
      messageId: "msg:c1",
      text: "first",
      sender: { principalId: "user:carol", principalType: "human_user" },
      trustClassification: "USER_OWNED",
      sourceRef: "test:session-c"
    },
    sessionResolve: sessionResolve("user:carol", "chat-c"),
    trace: trace()
  });
  const second = await assembler.assembleForMessage({
    message: {
      messageId: "msg:c2",
      text: "second",
      sender: { principalId: "user:carol", principalType: "human_user" },
      trustClassification: "USER_OWNED",
      sourceRef: "test:session-c"
    },
    sessionResolve: sessionResolve("user:carol", "chat-c"),
    trace: trace()
  });
  assert.equal(second.session.sessionId, first.session.sessionId);
});
