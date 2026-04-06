import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

import type { ContextChunk } from "@manasvi/contracts";

export const modelAdapterModeSchema = z.enum(["mock", "openai", "ollama", "auto"]);
export type ModelAdapterMode = z.infer<typeof modelAdapterModeSchema>;

export interface ModelAdapterConfig {
  mode: ModelAdapterMode;
  model: string;
  timeoutMs: number;
  openAiApiKey?: string;
  openAiBaseUrl: string;
  ollamaBaseUrl: string;
}

export interface ModelInvocationRequest {
  requestId: string;
  messageId: string;
  sessionId: string;
  traceId: string;
  correlationId: string;
  userInput: string;
  contextChunks: ContextChunk[];
}

export interface ModelInvocationResult {
  requestId: string;
  outputText: string;
  mode: "mock" | "openai" | "ollama";
  provider: "mock" | "openai" | "ollama";
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ModelAdapter {
  mode: "mock" | "openai" | "ollama";
  invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult>;
}

export function createModelAdapter(config: ModelAdapterConfig): ModelAdapter {
  const normalizedMode = resolveMode(config.mode, config.openAiApiKey);
  if (normalizedMode === "openai") {
    if (!config.openAiApiKey || config.openAiApiKey.length === 0) {
      throw new Error("MODEL_ADAPTER_MODE=openai requires OPENAI_API_KEY");
    }
    return new OpenAiCompatibleModelAdapter({
      mode: "openai",
      provider: "openai",
      model: config.model,
      timeoutMs: config.timeoutMs,
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl
    });
  }
  if (normalizedMode === "ollama") {
    return new OpenAiCompatibleModelAdapter({
      mode: "ollama",
      provider: "ollama",
      model: config.model,
      timeoutMs: config.timeoutMs,
      baseUrl: config.ollamaBaseUrl
    });
  }
  return new MockModelAdapter({
    model: config.model
  });
}

function resolveMode(mode: ModelAdapterMode, apiKey?: string): "mock" | "openai" | "ollama" {
  if (mode === "mock" || mode === "openai" || mode === "ollama") {
    return mode;
  }
  return apiKey && apiKey.length > 0 ? "openai" : "mock";
}

class MockModelAdapter implements ModelAdapter {
  readonly mode = "mock" as const;

  constructor(private readonly config: { model: string }) {}

  async invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const started = Date.now();
    await delay(10);
    const latestContextSource = input.contextChunks[input.contextChunks.length - 1]?.provenance.sourceType ?? "none";
    return {
      requestId: input.requestId || randomUUID(),
      outputText: [
        `MOCK(${this.config.model})`,
        `session=${input.sessionId}`,
        `trace=${input.traceId}`,
        `chunks=${input.contextChunks.length}`,
        `lastSource=${latestContextSource}`,
        `echo=${truncateForEcho(input.userInput)}`
      ].join(" | "),
      mode: "mock",
      provider: "mock",
      model: this.config.model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: estimateTokens(input.userInput),
        outputTokens: 32
      }
    };
  }
}

class OpenAiCompatibleModelAdapter implements ModelAdapter {
  readonly mode: "openai" | "ollama";

  constructor(
    private readonly config: {
      mode: "openai" | "ollama";
      provider: "openai" | "ollama";
      model: string;
      timeoutMs: number;
      apiKey?: string;
      baseUrl: string;
    }
  ) {
    this.mode = config.mode;
  }

  async invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          messages: buildOpenAiMessages(input)
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${this.config.provider} request failed: ${response.status} ${body}`);
      }
      const payload = openAiCompletionSchema.parse(await response.json());
      const content = payload.choices[0]?.message.content;
      if (!content || content.length === 0) {
        throw new Error(`${this.config.provider} response did not include assistant content`);
      }
      return {
        requestId: input.requestId || randomUUID(),
        outputText: content,
        mode: this.config.mode,
        provider: this.config.provider,
        model: payload.model,
        latencyMs: Date.now() - started,
        ...(payload.usage
          ? {
              usage: {
                inputTokens: payload.usage.prompt_tokens,
                outputTokens: payload.usage.completion_tokens
              }
            }
          : {})
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildOpenAiMessages(input: ModelInvocationRequest): Array<{ role: "system" | "user"; content: string }> {
  const systemInstruction =
    "You are Manasvi test harness runtime. Use provided context faithfully and do not claim hidden tool execution.";
  const contextSnippet = input.contextChunks
    .slice(-24)
    .map((chunk) => {
      const line = [
        `[source=${chunk.provenance.sourceType}]`,
        `[trust=${chunk.provenance.trustClassification}]`,
        chunk.content
      ].join(" ");
      return truncateForEcho(line, 240);
    })
    .join("\n");
  return [
    {
      role: "system",
      content: systemInstruction
    },
    {
      role: "user",
      content: `User input:\n${input.userInput}\n\nContext:\n${contextSnippet}`
    }
  ];
}

function truncateForEcho(input: string, maxLength = 120): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength)}...`;
}

function estimateTokens(input: string): number {
  return Math.max(1, Math.ceil(input.length / 4));
}

const openAiCompletionSchema = z.object({
  model: z.string().min(1),
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().optional()
      })
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative()
    })
    .optional()
});
