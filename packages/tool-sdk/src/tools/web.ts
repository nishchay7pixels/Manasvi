import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── x-search ───────────────────────────────────────────────────────────────────

const xSearchInputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(20).default(10),
  sinceDate: z.string().optional(),
  untilDate: z.string().optional(),
  language: z.string().default("en"),
  includeReplies: z.boolean().default(false)
});

const xSearchOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      postId: z.string(),
      author: z.string(),
      content: z.string(),
      postedAt: z.string(),
      url: z.string().optional(),
      metrics: z.object({
        replies: z.number().int().optional(),
        reposts: z.number().int().optional(),
        likes: z.number().int().optional()
      }).optional()
    })
  ),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().default(false),
  provenance: z.object({
    source: z.literal("x-social-search"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED"),
    searchEngineRef: z.string().optional()
  })
});

const xSearchSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.x-search",
    name: "X Search",
    version: "1.0.0",
    description:
      "Searches the X (Twitter) social platform via the configured X API adapter. " +
      "Results are always EXTERNAL_UNTRUSTED — social media content should never be treated as authoritative. " +
      "Requires an X API key configured in the secrets service (secret:x-api-key). " +
      "Operator must configure the x-search adapter in the execution-manager config.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "adapter",
    actionClass: "search",
    sideEffectClass: "external_side_effect",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "web.search",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "network-zone" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["network-zone", "channel-surface"],
    inputSchema: jsonSchemaObject(
      ["query"],
      {
        query: prop("Search query string. Supports X/Twitter advanced search operators.", "string"),
        maxResults: prop("Maximum posts to return. Max 20.", "number"),
        sinceDate: prop("ISO-8601 date. Only return posts after this date.", "string"),
        untilDate: prop("ISO-8601 date. Only return posts before this date.", "string"),
        language: prop("Language filter (ISO 639-1 code). Default en.", "string"),
        includeReplies: prop("Include reply posts in results. Default false.", "boolean")
      },
      "Input for the X Search tool."
    ),
    outputSchema: jsonSchemaObject(
      ["query", "results", "total", "truncated", "provenance"],
      {
        query: prop("The search query executed.", "string"),
        results: prop("Array of post records.", "array"),
        total: prop("Total results (before limit).", "number"),
        truncated: prop("True if results were capped.", "boolean"),
        provenance: prop("Source provenance. Always EXTERNAL_UNTRUSTED.", "object")
      },
      "Output from the X Search tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 15000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: ["default-allowlist"],
      filesystemProfile: "none",
      declaredSecretRefs: ["secret:x-api-key"],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:x-search", operation: "x_search" },
    policyBinding: {
      policyActionClass: "access-network",
      resource: { resourceClass: "network-zone", resourceId: "network:x-api" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "All X/social content is EXTERNAL_UNTRUSTED. Do not act on it without critical review.",
      "Requires secret:x-api-key configured in the secrets service.",
      "Rate limits enforced by the X API adapter."
    ],
    tags: ["search", "social", "x", "network", "external"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: xSearchInputSchema,
  outputSchema: xSearchOutputSchema,
  examples: [
    {
      description: "Search for posts about a topic",
      input: { query: "TypeScript 5.5 release", maxResults: 5, language: "en" },
      output: {
        query: "TypeScript 5.5 release",
        results: [
          { postId: "x:1234567890", author: "@typescript", content: "TypeScript 5.5 is now available! ✨ Check out the release notes...", postedAt: "2024-06-20T14:00:00.000Z", url: "https://x.com/typescript/status/1234567890", metrics: { replies: 120, reposts: 840, likes: 3200 } }
        ],
        total: 1,
        truncated: false,
        provenance: { source: "x-social-search", trustClassification: "EXTERNAL_UNTRUSTED", searchEngineRef: "x-api-v2" }
      }
    }
  ]
};

// ── gmail read tools ──────────────────────────────────────────────────────────

const gmailListInputSchema = z.object({
  query: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().max(50).default(20),
  pageToken: z.string().optional()
});

const gmailListOutputSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.string(),
      threadId: z.string(),
      subject: z.string(),
      from: z.string(),
      timestamp: z.string(),
      unread: z.boolean(),
      important: z.boolean(),
      snippet: z.string(),
      hasAttachments: z.boolean(),
      attachmentCount: z.number().int().nonnegative()
    })
  ),
  nextPageToken: z.string().nullable(),
  resultSizeEstimate: z.number().int().nonnegative()
});

const gmailGetMessageInputSchema = z.object({
  messageId: z.string().min(1)
});

const gmailGetMessageOutputSchema = z.object({
  message: z.object({
    messageId: z.string(),
    threadId: z.string(),
    subject: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    timestamp: z.string(),
    labels: z.array(z.string()),
    snippet: z.string(),
    bodyText: z.string(),
    attachments: z.array(
      z.object({
        attachmentId: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative()
      })
    )
  })
});

const gmailGetThreadInputSchema = z.object({
  threadId: z.string().min(1)
});

const gmailGetThreadOutputSchema = z.object({
  thread: z.object({
    threadId: z.string(),
    messageCount: z.number().int().nonnegative(),
    latestMessageId: z.string().nullable(),
    participants: z.array(z.string())
  })
});

const gmailListSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.gmail-list-messages",
    name: "Gmail List Messages",
    version: "1.0.0",
    description:
      "Lists Gmail messages in read-only mode through the Google integration connector. " +
      "This tool never mutates mailbox state. Content is EXTERNAL_UNTRUSTED and provenance-linked.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "adapter",
    actionClass: "read",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      { capabilityId: "integration.google.capability.gmail.read_threads", required: true, scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" }, constraints: {} }
    ],
    resourceClassesTouched: ["service-endpoint"],
    inputSchema: jsonSchemaObject(["maxResults"], {
      query: prop("Optional Gmail search query.", "string"),
      labelIds: prop("Optional Gmail label filters.", "array"),
      maxResults: prop("Max messages to return (<=50).", "number"),
      pageToken: prop("Pagination token from previous response.", "string")
    }),
    outputSchema: jsonSchemaObject(["messages", "nextPageToken", "resultSizeEstimate"], {
      messages: prop("Normalized Gmail message summaries.", "array"),
      nextPageToken: prop("Pagination token for next page.", "string"),
      resultSizeEstimate: prop("Provider-reported result estimate.", "number")
    }),
    runtimeHints: { defaultTimeoutMs: 15000, defaultSandboxMode: "restricted_remote", egressProfiles: ["default-allowlist"], filesystemProfile: "none", declaredSecretRefs: [], requireExecutorPath: true, approvalSensitive: false },
    runtimeBinding: { toolRef: "tool:gmail-list-messages", operation: "gmail_list_messages" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "service-endpoint", resourceId: "integration:google:gmail" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: ["Gmail message content is EXTERNAL_UNTRUSTED.", "Read-only operation only."],
    tags: ["gmail", "google", "read-only", "integration"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: gmailListInputSchema,
  outputSchema: gmailListOutputSchema,
  examples: []
};

const gmailSearchSpec: BuiltInToolSpec = {
  ...gmailListSpec,
  manifest: parseManifest({
    ...gmailListSpec.manifest,
    toolId: "tool.gmail-search-messages",
    name: "Gmail Search Messages",
    runtimeBinding: { toolRef: "tool:gmail-search-messages", operation: "gmail_search_messages" }
  })
};

const gmailGetMessageSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...gmailListSpec.manifest,
    toolId: "tool.gmail-get-message",
    name: "Gmail Get Message",
    inputSchema: jsonSchemaObject(["messageId"], { messageId: prop("Gmail message id.", "string") }),
    outputSchema: jsonSchemaObject(["message"], { message: prop("Normalized Gmail message detail.", "object") }),
    runtimeBinding: { toolRef: "tool:gmail-get-message", operation: "gmail_get_message" }
  }),
  inputSchema: gmailGetMessageInputSchema,
  outputSchema: gmailGetMessageOutputSchema,
  examples: []
};

const gmailGetThreadSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...gmailListSpec.manifest,
    toolId: "tool.gmail-get-thread",
    name: "Gmail Get Thread",
    inputSchema: jsonSchemaObject(["threadId"], { threadId: prop("Gmail thread id.", "string") }),
    outputSchema: jsonSchemaObject(["thread"], { thread: prop("Normalized Gmail thread detail.", "object") }),
    runtimeBinding: { toolRef: "tool:gmail-get-thread", operation: "gmail_get_thread" }
  }),
  inputSchema: gmailGetThreadInputSchema,
  outputSchema: gmailGetThreadOutputSchema,
  examples: []
};

// ── exports ────────────────────────────────────────────────────────────────────

export const WEB_TOOL_SPECS = {
  "tool.x-search": xSearchSpec,
  "tool.gmail-list-messages": gmailListSpec,
  "tool.gmail-search-messages": gmailSearchSpec,
  "tool.gmail-get-message": gmailGetMessageSpec,
  "tool.gmail-get-thread": gmailGetThreadSpec
} as const;

export type WebToolId = keyof typeof WEB_TOOL_SPECS;
