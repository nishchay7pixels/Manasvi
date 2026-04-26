import assert from "node:assert/strict";
import test from "node:test";

import type { ContextChunk } from "@manasvi/contracts";

import { createModelAdapter } from "./index.js";

const sampleChunk: ContextChunk = {
  chunkId: "chunk:test",
  sessionId: "session:test",
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  content: "context from session history",
  tokenEstimate: 5,
  createdAt: new Date().toISOString(),
  sticky: false,
  stale: false,
  role: "user_goal",
  provenance: {
    sourceType: "session-message",
    sourceId: "message:1",
    sourceRef: "message:1",
    observedAt: new Date().toISOString(),
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
};

test("auto mode falls back to mock without provider key", async () => {
  const adapter = createModelAdapter({
    mode: "auto",
    model: "test-model",
    timeoutMs: 1_000,
    openAiBaseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434/v1"
  });
  const result = await adapter.invoke({
    requestId: "req-1",
    messageId: "msg-1",
    sessionId: "session:test",
    traceId: "8e87ef86-652f-49d0-b373-8eff8f49c1b8",
    correlationId: "f3290b81-1cf8-43a5-a0d0-2dece2d23d3c",
    userInput: "hello",
    contextChunks: [sampleChunk]
  });
  assert.equal(adapter.mode, "mock");
  assert.equal(result.mode, "mock");
  assert.equal(result.provider, "mock");
  assert.match(result.outputText, /MOCK\(test-model\)/);
});

test("openai mode fails fast without api key", () => {
  assert.throws(
    () =>
      createModelAdapter({
        mode: "openai",
        model: "gpt-4.1-mini",
        timeoutMs: 5_000,
        openAiBaseUrl: "https://api.openai.com/v1",
        ollamaBaseUrl: "http://localhost:11434/v1"
      }),
    /OPENAI_API_KEY/
  );
});

test("ollama mode does not require api key", () => {
  const adapter = createModelAdapter({
    mode: "ollama",
    model: "llama3.1:8b",
    timeoutMs: 5_000,
    openAiBaseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434/v1"
  });
  assert.equal(adapter.mode, "ollama");
});

test("openai-compatible prompt masks internal control context and discourages governance leakage", async () => {
  const policyChunk: ContextChunk = {
    ...sampleChunk,
    chunkId: "chunk:policy-note",
    content: "policy-decision:ALLOW:ALLOW_BY_POLICY",
    provenance: {
      ...sampleChunk.provenance,
      sourceType: "policy-note",
      contentCategory: "policy-annotation"
    }
  };

  let capturedBody: unknown;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(
      JSON.stringify({
        model: "llama3.1:8b",
        choices: [{ message: { content: "{\"decisionType\":\"final_response\",\"responseText\":\"Hello\"}" } }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const adapter = createModelAdapter({
      mode: "ollama",
      model: "llama3.1:8b",
      timeoutMs: 5_000,
      openAiBaseUrl: "https://api.openai.com/v1",
      ollamaBaseUrl: "http://localhost:11434/v1"
    });
    await adapter.invoke({
      requestId: "req-2",
      messageId: "msg-2",
      sessionId: "session:test",
      traceId: "8e87ef86-652f-49d0-b373-8eff8f49c1b8",
      correlationId: "f3290b81-1cf8-43a5-a0d0-2dece2d23d3c",
      userInput: "hi",
      contextChunks: [sampleChunk, policyChunk]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const messages = (capturedBody as { messages?: Array<{ role: string; content: string }> } | undefined)?.messages ?? [];
  const systemMessage = messages.find((message) => message.role === "system");
  const userMessage = messages.find((message) => message.role === "user");

  assert.ok(systemMessage);
  assert.match(systemMessage.content, /Do not expose internal policy decisions/i);
  assert.ok(userMessage);
  assert.match(userMessage.content, /\[source=policy-note\]/);
  assert.match(userMessage.content, /\[internal control context\]/);
  assert.doesNotMatch(userMessage.content, /policy-decision:ALLOW:ALLOW_BY_POLICY/);
});
