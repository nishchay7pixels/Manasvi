import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ContextChunk } from "@manasvi/contracts";

export const modelAdapterModeSchema = z.enum(["mock", "openai", "ollama", "claude", "auto"]);
export type ModelAdapterMode = z.infer<typeof modelAdapterModeSchema>;

export interface ModelAdapterConfig {
  mode: ModelAdapterMode;
  model: string;
  timeoutMs: number;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  openAiBaseUrl: string;
  ollamaBaseUrl: string;
  anthropicBaseUrl: string;
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
  mode: "mock" | "openai" | "ollama" | "claude";
  provider: "mock" | "openai" | "ollama" | "claude";
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ModelAdapter {
  mode: "mock" | "openai" | "ollama" | "claude";
  invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult>;
}

export function createModelAdapter(config: ModelAdapterConfig): ModelAdapter {
  const normalizedMode = resolveMode(config.mode, config.openAiApiKey, config.anthropicApiKey);
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
  if (normalizedMode === "claude") {
    if (!config.anthropicApiKey || config.anthropicApiKey.length === 0) {
      throw new Error("MODEL_ADAPTER_MODE=claude requires ANTHROPIC_API_KEY");
    }
    return new AnthropicModelAdapter({
      model: config.model,
      timeoutMs: config.timeoutMs,
      apiKey: config.anthropicApiKey,
      baseUrl: config.anthropicBaseUrl
    });
  }
  return new MockModelAdapter({
    model: config.model
  });
}

function resolveMode(
  mode: ModelAdapterMode,
  openAiApiKey?: string,
  anthropicApiKey?: string
): "mock" | "openai" | "ollama" | "claude" {
  if (mode === "mock" || mode === "openai" || mode === "ollama" || mode === "claude") {
    return mode;
  }
  if (openAiApiKey && openAiApiKey.length > 0) {
    return "openai";
  }
  if (anthropicApiKey && anthropicApiKey.length > 0) {
    return "claude";
  }
  return "mock";
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

class AnthropicModelAdapter implements ModelAdapter {
  readonly mode = "claude" as const;
  private readonly client: Anthropic;

  constructor(
    private readonly config: {
      model: string;
      timeoutMs: number;
      apiKey: string;
      baseUrl: string;
    }
  ) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ""),
      timeout: config.timeoutMs,
      maxRetries: 0
    });
  }

  async invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult> {
    const started = Date.now();
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 1024,
        temperature: 0.2,
        system: buildSystemInstruction(),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildUserPrompt(input)
              }
            ]
          }
        ]
      });

      const textBlocks: string[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
        }
      }
      const outputText = textBlocks.join("\n").trim();
      if (!outputText) {
        throw new Error("claude response did not include assistant text content");
      }

      return {
        requestId: input.requestId || randomUUID(),
        outputText,
        mode: "claude",
        provider: "claude",
        model: response.model,
        latencyMs: Date.now() - started,
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens
              }
            }
          : {})
      };
    } catch (error) {
      throw normalizeAnthropicError(error);
    }
  }
}

function buildOpenAiMessages(input: ModelInvocationRequest): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: buildSystemInstruction()
    },
    {
      role: "user",
      content: buildUserPrompt(input)
    }
  ];
}

function buildSystemInstruction(): string {
  return [
    "You are Manasvi, a secure assistant.",
    "Return a direct, user-facing answer.",
    "Do not expose internal policy decisions, trust labels, provenance/session metadata, trace IDs, or control-plane details unless the user explicitly asks for them.",
    "Do not include analysis preambles like 'Based on the provided context'.",
    "Never claim hidden tool execution."
  ].join(" ");
}

function buildUserPrompt(input: ModelInvocationRequest): string {
  const contextSnippet = input.contextChunks
    .slice(-24)
    .map((chunk) => {
      const isInternalControlChunk =
        chunk.provenance.sourceType === "policy-note" ||
        chunk.provenance.sourceType === "session-metadata" ||
        chunk.provenance.sourceType === "risk-annotation";
      const content = isInternalControlChunk ? "[internal control context]" : chunk.content;
      const line = [
        `[source=${chunk.provenance.sourceType}]`,
        `[trust=${chunk.provenance.trustClassification}]`,
        content
      ].join(" ");
      return truncateForEcho(line, 240);
    })
    .join("\n");
  return `User input:\n${input.userInput}\n\nContext:\n${contextSnippet}`;
}

function normalizeAnthropicError(error: unknown): Error {
  if (error instanceof Error) {
    const errorRecord = error as unknown as Record<string, unknown>;
    const statusCode =
      "status" in errorRecord && typeof errorRecord.status === "number"
        ? errorRecord.status as number
        : undefined;
    if (statusCode) {
      return new Error(`claude request failed: ${statusCode} ${error.message}`);
    }
    return new Error(`claude request failed: ${error.message}`);
  }
  return new Error("claude request failed: unknown error");
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
