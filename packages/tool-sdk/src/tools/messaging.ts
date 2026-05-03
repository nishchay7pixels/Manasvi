import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── message ────────────────────────────────────────────────────────────────────

const messageInputSchema = z.object({
  channel: z.string().min(1),
  content: z.string().min(1),
  format: z.enum(["text", "markdown", "json"]).default("text"),
  recipient: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.unknown()).default({})
});

const messageOutputSchema = z.object({
  channel: z.string(),
  messageId: z.string(),
  status: z.enum(["sent", "queued", "rejected"]),
  sentAt: z.string().optional(),
  threadId: z.string().optional()
});

const messageSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.message",
    name: "Message",
    version: "1.0.0",
    description:
      "Sends a message to an operator-configured channel (Telegram, Slack, webhook, etc). " +
      "Only channels registered by the operator are reachable. " +
      "Messages are routed through the channel adapter layer and are audited. " +
      "Policy governs which channels a principal can write to.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "send-message",
    sideEffectClass: "external_side_effect",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "messaging.send",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "channel-surface" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["channel-surface"],
    inputSchema: jsonSchemaObject(
      ["channel", "content"],
      {
        channel: prop("Target channel ID (operator-registered channel name or ID).", "string"),
        content: prop("Message content.", "string"),
        format: prop("Content format: text, markdown, or json.", "string", { enum: ["text", "markdown", "json"] }),
        recipient: prop("Optional recipient identifier within the channel.", "string"),
        threadId: prop("Optional thread ID to send a reply into.", "string"),
        metadata: prop("Optional metadata for the message record.", "object")
      },
      "Input for the Message tool."
    ),
    outputSchema: jsonSchemaObject(
      ["channel", "messageId", "status"],
      {
        channel: prop("The channel the message was sent to.", "string"),
        messageId: prop("Unique ID of the sent message.", "string"),
        status: prop("Send status: sent, queued, or rejected.", "string", { enum: ["sent", "queued", "rejected"] }),
        sentAt: prop("ISO-8601 timestamp when the message was sent.", "string"),
        threadId: prop("Thread ID if the message was sent to a thread.", "string")
      },
      "Output from the Message tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:message", operation: "message_send" },
    policyBinding: {
      policyActionClass: "external-side-effect",
      resource: { resourceClass: "channel-surface", resourceId: "channel:messaging" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "Only operator-registered channels are reachable.",
      "All outgoing messages are logged in the audit trail.",
      "Sensitive content must not be sent without operator policy explicitly allowing it."
    ],
    tags: ["messaging", "send", "channel", "external"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: messageInputSchema,
  outputSchema: messageOutputSchema,
  examples: [
    {
      description: "Send a markdown notification to a Telegram channel",
      input: { channel: "telegram:ops-alerts", content: "**Deployment complete.** Version `1.4.2` deployed at 00:05 UTC.", format: "markdown" },
      output: { channel: "telegram:ops-alerts", messageId: "msg:tg-abc123", status: "sent", sentAt: "2026-05-04T00:05:30.000Z" }
    },
    {
      description: "Send a JSON payload to a webhook channel",
      input: { channel: "webhook:incident-hook", content: '{"severity":"low","title":"High CPU on worker-03","value":87}', format: "json" },
      output: { channel: "webhook:incident-hook", messageId: "msg:wh-xyz789", status: "sent", sentAt: "2026-05-04T00:06:00.000Z" }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const MESSAGING_TOOL_SPECS = {
  "tool.message": messageSpec
} as const;

export type MessagingToolId = keyof typeof MESSAGING_TOOL_SPECS;
