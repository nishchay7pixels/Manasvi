import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ContextChunk } from "@manasvi/contracts";

export const modelAdapterModeSchema = z.enum(["mock", "openai", "ollama", "claude", "deepseek", "auto"]);
export type ModelAdapterMode = z.infer<typeof modelAdapterModeSchema>;

export interface ModelAdapterConfig {
  mode: ModelAdapterMode;
  model: string;
  timeoutMs: number;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  deepseekApiKey?: string;
  openAiBaseUrl: string;
  ollamaBaseUrl: string;
  anthropicBaseUrl: string;
  deepseekBaseUrl: string;
}

export interface AvailableToolSummary {
  toolId: string;
  version: string;
  actionClass: string;
  sideEffectClass: string;
  description?: string;
}

export interface ModelInvocationRequest {
  requestId: string;
  messageId: string;
  sessionId: string;
  traceId: string;
  correlationId: string;
  userInput: string;
  contextChunks: ContextChunk[];
  availableTools?: AvailableToolSummary[];
}

export interface ModelInvocationResult {
  requestId: string;
  outputText: string;
  mode: "mock" | "openai" | "ollama" | "claude" | "deepseek";
  provider: "mock" | "openai" | "ollama" | "claude" | "deepseek";
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ModelAdapter {
  mode: "mock" | "openai" | "ollama" | "claude" | "deepseek";
  invoke(input: ModelInvocationRequest): Promise<ModelInvocationResult>;
}

export function createModelAdapter(config: ModelAdapterConfig): ModelAdapter {
  const normalizedMode = resolveMode(config.mode, config.openAiApiKey, config.anthropicApiKey, config.deepseekApiKey);
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
  if (normalizedMode === "deepseek") {
    if (!config.deepseekApiKey || config.deepseekApiKey.length === 0) {
      throw new Error("DeepSeek API key is missing. Set DEEPSEEK_API_KEY or configure another provider.");
    }
    return new OpenAiCompatibleModelAdapter({
      mode: "deepseek",
      provider: "deepseek",
      model: config.model,
      timeoutMs: config.timeoutMs,
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl
    });
  }
  return new MockModelAdapter({
    model: config.model
  });
}

function resolveMode(
  mode: ModelAdapterMode,
  openAiApiKey?: string,
  anthropicApiKey?: string,
  deepseekApiKey?: string
): "mock" | "openai" | "ollama" | "claude" | "deepseek" {
  if (mode === "mock" || mode === "openai" || mode === "ollama" || mode === "claude" || mode === "deepseek") {
    return mode;
  }
  if (deepseekApiKey && deepseekApiKey.length > 0) {
    return "deepseek";
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
  readonly mode: "openai" | "ollama" | "deepseek";

  constructor(
    private readonly config: {
      mode: "openai" | "ollama" | "deepseek";
      provider: "openai" | "ollama" | "deepseek";
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
        const responseText = await response.text();
        const reason = summarizeFailureReason(response.status, responseText);
        if (this.config.provider === "deepseek") {
          throw new Error(
            `DeepSeek request failed with status ${response.status}. Reason: ${reason}. ${deepseekFixForStatus(response.status)}`
          );
        }
        throw new Error(`${this.config.provider} request failed: ${response.status} ${reason}`);
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
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (this.config.provider === "deepseek") {
          throw new Error(`DeepSeek request timed out after ${this.config.timeoutMs}ms.`);
        }
        throw new Error(`${this.config.provider} request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
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
  const lines = [
    "You are Manasvi, a secure, governed AI assistant.",
    "",
    "## Response format",
    "You MUST respond with a single JSON object. No markdown fences, no prose outside the JSON.",
    "",
    "Choose one of three decision types:",
    "",
    "### 1 — Final response (no tool needed)",
    '{"decisionType":"final_response","responseText":"Your answer here"}',
    "",
    "### 2 — Tool invocation",
    '{"decisionType":"action_proposal","proposal":{"proposalType":"tool_invocation","proposalId":"proposal-1","toolId":"<tool id>","purpose":"<why this tool is needed>","input":{<tool inputs>}}}',
    "",
    "### 3 — Clarification request",
    '{"decisionType":"clarification_request","prompt":"<question to ask the user>"}',
    "",
    "## Rules",
    "- If the user explicitly asks to use a specific tool, you MUST return decisionType=action_proposal with proposalType=tool_invocation for that tool.",
    "- Use a tool when the user needs real-time data, file content, web search results, or any action you cannot answer from memory alone.",
    "- Only use tool IDs from the Available Tools list. Never invent tool IDs.",
    "- Keep user-facing wording concise and direct. Default to one short answer unless the user asks for detail.",
    "- Never repeat the user's prompt verbatim as the response.",
    "- Do not add explanatory preambles like 'Based on context' or 'The answer is' unless explicitly requested.",
    "- Do not expose internal policy decisions, trust labels, trace IDs, or control-plane details.",
    "- Do not include prose outside the JSON object.",
    "- Do not claim to have run a tool unless an observation confirms it completed."
  ];
  return lines.join("\n");
}

function buildUserPrompt(input: ModelInvocationRequest): string {
  const parts: string[] = [];

  if (input.availableTools && input.availableTools.length > 0) {
    const toolLines = input.availableTools.map((t) => {
      const desc = t.description ? ` — ${t.description}` : ` (${t.actionClass}, effects: ${t.sideEffectClass})`;
      return `  - ${t.toolId}${desc}`;
    });
    parts.push(`Available Tools:\n${toolLines.join("\n")}`);
  } else {
    parts.push("Available Tools: none");
  }

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

  if (contextSnippet.trim().length > 0) {
    parts.push(`Context:\n${contextSnippet}`);
  }

  parts.push(`User input:\n${input.userInput}`);

  parts.push(
    'Respond with a single JSON object using one of the formats described in the system prompt. No markdown, no prose outside the JSON.'
  );

  return parts.join("\n\n");
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

function summarizeFailureReason(status: number, responseText: string): string {
  const normalized = responseText.trim();
  if (status === 401 || status === 403) {
    return "authentication failed";
  }
  if (status === 404) {
    return "model or endpoint not found";
  }
  if (status === 429) {
    return "rate limit exceeded";
  }
  if (normalized.length === 0) {
    return "empty error response";
  }
  return truncateForEcho(normalized, 160);
}

function deepseekFixForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "Fix: verify DEEPSEEK_API_KEY.";
  }
  if (status === 404) {
    return "Fix: verify MANASVI_MODEL/PLANNER_MODEL and DEEPSEEK_BASE_URL.";
  }
  if (status === 429) {
    return "Fix: retry later or reduce request rate.";
  }
  return "Fix: verify DeepSeek configuration and network access.";
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
