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
    ollamaBaseUrl: "http://localhost:11434/v1",
    anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
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
        ollamaBaseUrl: "http://localhost:11434/v1",
        anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
      }),
    /OPENAI_API_KEY/
  );
});

test("deepseek mode fails fast without api key", () => {
  assert.throws(
    () =>
      createModelAdapter({
        mode: "deepseek",
        model: "deepseek-v4-flash",
        timeoutMs: 5_000,
        openAiBaseUrl: "https://api.openai.com/v1",
        ollamaBaseUrl: "http://localhost:11434/v1",
        anthropicBaseUrl: "https://api.anthropic.com",
        deepseekBaseUrl: "https://api.deepseek.com"
      }),
    /DEEPSEEK_API_KEY|DeepSeek API key is missing/
  );
});

test("ollama mode does not require api key", () => {
  const adapter = createModelAdapter({
    mode: "ollama",
    model: "llama3.1:8b",
    timeoutMs: 5_000,
    openAiBaseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434/v1",
    anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
  });
  assert.equal(adapter.mode, "ollama");
});

test("claude mode fails fast without api key", () => {
  assert.throws(
    () =>
      createModelAdapter({
        mode: "claude",
        model: "claude-3-5-sonnet-latest",
        timeoutMs: 5_000,
        openAiBaseUrl: "https://api.openai.com/v1",
        ollamaBaseUrl: "http://localhost:11434/v1",
        anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
      }),
    /ANTHROPIC_API_KEY/
  );
});

test("auto mode selects claude when anthropic key is set and openai key is absent", () => {
  const adapter = createModelAdapter({
    mode: "auto",
    model: "claude-3-5-sonnet-latest",
    timeoutMs: 5_000,
    anthropicApiKey: "test-anthropic-key",
    openAiBaseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434/v1",
    anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
  });
  assert.equal(adapter.mode, "claude");
});

test("auto mode selects deepseek when deepseek key is set", () => {
  const adapter = createModelAdapter({
    mode: "auto",
    model: "deepseek-v4-flash",
    timeoutMs: 5_000,
    deepseekApiKey: "test-deepseek-key",
    openAiBaseUrl: "https://api.openai.com/v1",
    ollamaBaseUrl: "http://localhost:11434/v1",
    anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
  });
  assert.equal(adapter.mode, "deepseek");
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
      ollamaBaseUrl: "http://localhost:11434/v1",
      anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
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

test("claude mapping sends anthropic messages payload and parses text output", async () => {
  let capturedBody: unknown;
  let capturedHeaders: HeadersInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers;
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(
      JSON.stringify({
        id: "msg_123",
        model: "claude-3-5-sonnet-latest",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello from Claude" }],
        usage: { input_tokens: 15, output_tokens: 4 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const adapter = createModelAdapter({
      mode: "claude",
      model: "claude-3-5-sonnet-latest",
      timeoutMs: 5_000,
      anthropicApiKey: "test-anthropic-key",
      openAiBaseUrl: "https://api.openai.com/v1",
      ollamaBaseUrl: "http://localhost:11434/v1",
      anthropicBaseUrl: "https://api.anthropic.com",
    deepseekBaseUrl: "https://api.deepseek.com"
    });
    const result = await adapter.invoke({
      requestId: "req-claude",
      messageId: "msg-claude",
      sessionId: "session:test",
      traceId: "8e87ef86-652f-49d0-b373-8eff8f49c1b8",
      correlationId: "f3290b81-1cf8-43a5-a0d0-2dece2d23d3c",
      userInput: "hi",
      contextChunks: [sampleChunk]
    });

    assert.equal(result.mode, "claude");
    assert.equal(result.provider, "claude");
    assert.equal(result.outputText, "Hello from Claude");
    assert.equal(result.usage?.inputTokens, 15);
    assert.equal(result.usage?.outputTokens, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get("x-api-key"), "test-anthropic-key");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");

  const body = capturedBody as {
    model?: string;
    system?: string;
    messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  };
  assert.equal(body.model, "claude-3-5-sonnet-latest");
  assert.match(body.system ?? "", /You are Manasvi/);
  assert.ok(body.messages?.[0]?.content?.[0]?.text.includes("User input:"));
});
