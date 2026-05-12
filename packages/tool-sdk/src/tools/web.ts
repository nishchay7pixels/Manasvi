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

// ── gmail write tools ─────────────────────────────────────────────────────────

const gmailRecipientPropSchema = z.object({
  email: z.string().email(),
  name: z.string().optional()
});

const gmailCreateDraftInputSchema = z.object({
  to: z.array(gmailRecipientPropSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientPropSchema).optional(),
  bcc: z.array(gmailRecipientPropSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional(),
  actorPrincipalId: z.string().optional(),
  actorPrincipalType: z.string().optional(),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional()
});

const gmailDraftOutputSchema = z.object({
  draftId: z.string(),
  messageId: z.string(),
  threadId: z.string(),
  createdAt: z.string(),
  action: z.enum(["draft_created", "reply_draft_created"])
});

const gmailReplyDraftInputSchema = z.object({
  threadId: z.string().min(1),
  inReplyToMessageId: z.string().min(1),
  inReplyToMessageIdHeader: z.string().min(1),
  to: z.array(gmailRecipientPropSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientPropSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional(),
  actorPrincipalId: z.string().optional(),
  actorPrincipalType: z.string().optional(),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional()
});

const gmailSendInputSchema = z.object({
  to: z.array(gmailRecipientPropSchema).min(1),
  subject: z.string().min(1).max(998),
  body: z.string(),
  cc: z.array(gmailRecipientPropSchema).optional(),
  bcc: z.array(gmailRecipientPropSchema).optional(),
  contentType: z.enum(["text/plain", "text/html"]).optional(),
  threadId: z.string().optional(),
  inReplyToMessageIdHeader: z.string().optional(),
  actorPrincipalId: z.string().optional(),
  actorPrincipalType: z.string().optional(),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional()
});

const gmailSendOutputSchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  sentAt: z.string(),
  action: z.literal("message_sent"),
  labelIds: z.array(z.string())
});

const gmailArchiveInputSchema = z.object({
  messageId: z.string().min(1),
  actorPrincipalId: z.string().optional(),
  actorPrincipalType: z.string().optional(),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional()
});

const gmailModifyOutputSchema = z.object({
  messageId: z.string(),
  labelIds: z.array(z.string()),
  addedLabels: z.array(z.string()),
  removedLabels: z.array(z.string()),
  action: z.enum(["labels_modified", "message_archived"]),
  modifiedAt: z.string()
});

const gmailLabelInputSchema = z.object({
  messageId: z.string().min(1),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
  actorPrincipalId: z.string().optional(),
  actorPrincipalType: z.string().optional(),
  tenantId: z.string().optional(),
  workspaceId: z.string().optional()
});

const gmailWriteCapabilities = [
  { capabilityId: "integration.google.capability.gmail.compose", required: true, scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" }, constraints: {} }
];
const gmailSendCapabilities = [
  { capabilityId: "integration.google.capability.gmail.send", required: true, scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" }, constraints: {} }
];
const gmailModifyCapabilities = [
  { capabilityId: "integration.google.capability.gmail.modify", required: true, scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" }, constraints: {} }
];

const gmailCreateDraftSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.gmail-create-draft",
    name: "Gmail Create Draft",
    version: "1.0.0",
    description:
      "Creates a new Gmail draft message. This is a write operation that creates a draft in the mailbox " +
      "but does NOT send email. Drafts may be reviewed and sent separately. Requires gmail.compose scope.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "adapter",
    actionClass: "write",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: gmailWriteCapabilities,
    resourceClassesTouched: ["service-endpoint"],
    inputSchema: jsonSchemaObject(["to", "subject", "body"], {
      to: prop("Array of recipients (email, optional name).", "array"),
      subject: prop("Email subject line.", "string"),
      body: prop("Email body text or HTML.", "string"),
      cc: prop("Optional CC recipients.", "array"),
      bcc: prop("Optional BCC recipients.", "array"),
      contentType: prop("Body content type: text/plain (default) or text/html.", "string")
    }),
    outputSchema: jsonSchemaObject(["draftId", "messageId", "threadId", "createdAt", "action"], {
      draftId: prop("Gmail draft ID.", "string"),
      messageId: prop("Gmail message ID of the draft.", "string"),
      threadId: prop("Gmail thread ID.", "string"),
      createdAt: prop("ISO timestamp of draft creation.", "string"),
      action: prop("Action performed: draft_created.", "string")
    }),
    runtimeHints: { defaultTimeoutMs: 20000, defaultSandboxMode: "restricted_remote", egressProfiles: ["default-allowlist"], filesystemProfile: "none", declaredSecretRefs: [], requireExecutorPath: true, approvalSensitive: false },
    runtimeBinding: { toolRef: "tool:gmail-create-draft", operation: "gmail_create_draft" },
    policyBinding: {
      policyActionClass: "write",
      resource: { resourceClass: "service-endpoint", resourceId: "integration:google:gmail" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: ["Drafting does not send email. Drafts are stored in the mailbox draft folder.", "Requires gmail.compose scope."],
    tags: ["gmail", "google", "write", "draft", "integration"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: gmailCreateDraftInputSchema,
  outputSchema: gmailDraftOutputSchema,
  examples: []
};

const gmailCreateReplyDraftSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...gmailCreateDraftSpec.manifest,
    toolId: "tool.gmail-create-reply-draft",
    name: "Gmail Create Reply Draft",
    description:
      "Creates a reply draft in Gmail tied to an existing thread. The draft is NOT sent. " +
      "Preserves thread context via In-Reply-To and References headers. " +
      "Use this to implement 'summarize and draft reply' workflows. Requires gmail.compose scope.",
    inputSchema: jsonSchemaObject(["threadId", "inReplyToMessageId", "inReplyToMessageIdHeader", "to", "subject", "body"], {
      threadId: prop("Gmail thread ID to reply within.", "string"),
      inReplyToMessageId: prop("Gmail message ID being replied to.", "string"),
      inReplyToMessageIdHeader: prop("RFC 2822 Message-ID header value of the message being replied to.", "string"),
      to: prop("Reply recipients.", "array"),
      subject: prop("Reply subject (Re: prefix added automatically if missing).", "string"),
      body: prop("Reply body.", "string"),
      cc: prop("Optional CC recipients.", "array"),
      contentType: prop("Body content type: text/plain (default) or text/html.", "string")
    }),
    runtimeBinding: { toolRef: "tool:gmail-create-reply-draft", operation: "gmail_create_reply_draft" }
  }),
  inputSchema: gmailReplyDraftInputSchema,
  outputSchema: gmailDraftOutputSchema,
  examples: []
};

const gmailSendMessageSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.gmail-send-message",
    name: "Gmail Send Message",
    version: "1.0.0",
    description:
      "Sends an email via Gmail. THIS IS A HIGH-RISK EXTERNAL SIDE EFFECT. " +
      "Sending email cannot be undone and reaches real recipients. " +
      "This action requires approval before execution. Requires gmail.send scope.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "adapter",
    actionClass: "execute",
    sideEffectClass: "external_side_effect",
    mutability: "mutating",
    capabilities: gmailSendCapabilities,
    resourceClassesTouched: ["service-endpoint"],
    inputSchema: jsonSchemaObject(["to", "subject", "body"], {
      to: prop("Recipients.", "array"),
      subject: prop("Subject line.", "string"),
      body: prop("Email body.", "string"),
      cc: prop("CC recipients.", "array"),
      bcc: prop("BCC recipients.", "array"),
      contentType: prop("Content type: text/plain or text/html.", "string"),
      threadId: prop("Optional thread ID if sending as part of a thread.", "string"),
      inReplyToMessageIdHeader: prop("Optional In-Reply-To header value for threading.", "string")
    }),
    outputSchema: jsonSchemaObject(["messageId", "threadId", "sentAt", "action", "labelIds"], {
      messageId: prop("Sent message ID.", "string"),
      threadId: prop("Thread ID.", "string"),
      sentAt: prop("ISO timestamp of send.", "string"),
      action: prop("Action performed: message_sent.", "string"),
      labelIds: prop("Labels applied to sent message.", "array")
    }),
    runtimeHints: { defaultTimeoutMs: 20000, defaultSandboxMode: "restricted_remote", egressProfiles: ["default-allowlist"], filesystemProfile: "none", declaredSecretRefs: [], requireExecutorPath: true, approvalSensitive: true },
    runtimeBinding: { toolRef: "tool:gmail-send-message", operation: "gmail_send_message" },
    policyBinding: {
      policyActionClass: "external-side-effect",
      resource: { resourceClass: "service-endpoint", resourceId: "integration:google:gmail" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: ["Sending email is irreversible and reaches real people.", "Always requires approval. Never auto-send.", "Requires gmail.send scope."],
    tags: ["gmail", "google", "write", "send", "integration", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: gmailSendInputSchema,
  outputSchema: gmailSendOutputSchema,
  examples: []
};

const gmailArchiveMessageSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.gmail-archive-message",
    name: "Gmail Archive Message",
    version: "1.0.0",
    description:
      "Archives a Gmail message by removing it from the INBOX label. " +
      "The message is NOT deleted — it remains accessible via All Mail. " +
      "This is a mailbox mutation action. Requires gmail.modify scope.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "adapter",
    actionClass: "write",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: gmailModifyCapabilities,
    resourceClassesTouched: ["service-endpoint"],
    inputSchema: jsonSchemaObject(["messageId"], {
      messageId: prop("Gmail message ID to archive.", "string")
    }),
    outputSchema: jsonSchemaObject(["messageId", "labelIds", "addedLabels", "removedLabels", "action", "modifiedAt"], {
      messageId: prop("Message ID.", "string"),
      labelIds: prop("Remaining label IDs after modification.", "array"),
      addedLabels: prop("Labels added.", "array"),
      removedLabels: prop("Labels removed (INBOX).", "array"),
      action: prop("Action performed: message_archived.", "string"),
      modifiedAt: prop("ISO timestamp.", "string")
    }),
    runtimeHints: { defaultTimeoutMs: 15000, defaultSandboxMode: "restricted_remote", egressProfiles: ["default-allowlist"], filesystemProfile: "none", declaredSecretRefs: [], requireExecutorPath: true, approvalSensitive: false },
    runtimeBinding: { toolRef: "tool:gmail-archive-message", operation: "gmail_archive_message" },
    policyBinding: {
      policyActionClass: "write",
      resource: { resourceClass: "service-endpoint", resourceId: "integration:google:gmail" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: ["Archive removes INBOX label only. Message is not deleted.", "Requires gmail.modify scope."],
    tags: ["gmail", "google", "write", "archive", "integration"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: gmailArchiveInputSchema,
  outputSchema: gmailModifyOutputSchema,
  examples: []
};

const gmailLabelMessageSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...gmailArchiveMessageSpec.manifest,
    toolId: "tool.gmail-label-message",
    name: "Gmail Label Message",
    description:
      "Applies or removes labels on a Gmail message. " +
      "Labels are Gmail's organizational mechanism. This is a mailbox mutation action. " +
      "Requires gmail.modify scope.",
    inputSchema: jsonSchemaObject(["messageId"], {
      messageId: prop("Gmail message ID.", "string"),
      addLabelIds: prop("Label IDs to add.", "array"),
      removeLabelIds: prop("Label IDs to remove.", "array")
    }),
    runtimeBinding: { toolRef: "tool:gmail-label-message", operation: "gmail_label_message" }
  }),
  inputSchema: gmailLabelInputSchema,
  outputSchema: gmailModifyOutputSchema,
  examples: []
};

// ── calendar read tools ───────────────────────────────────────────────────────

const calendarReadCapabilities = [
  {
    capabilityId: "integration.google.capability.calendar.read_events",
    required: true,
    scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "service-endpoint" },
    constraints: {}
  }
];

const calendarReadBaseManifest = {
  schemaVersion: "1.0",
  contractVersion: "1.0.0",
  version: "1.0.0",
  owner: "manasvi-platform",
  provider: "manasvi-core",
  type: "adapter",
  actionClass: "read",
  sideEffectClass: "read_only",
  mutability: "read_only",
  capabilities: calendarReadCapabilities,
  resourceClassesTouched: ["service-endpoint"],
  runtimeHints: {
    defaultTimeoutMs: 15000,
    defaultSandboxMode: "restricted_remote",
    egressProfiles: ["default-allowlist"],
    filesystemProfile: "none",
    declaredSecretRefs: [],
    requireExecutorPath: true,
    approvalSensitive: false
  },
  policyBinding: {
    policyActionClass: "read",
    resource: { resourceClass: "service-endpoint", resourceId: "integration:google:calendar" },
    requiresExplicitPolicy: true,
    approvalHint: "may_require"
  },
  trustNotes: [
    "Calendar event content is EXTERNAL_UNTRUSTED. Events may contain user-controlled text.",
    "Read-only operation. This tool never creates, modifies, or deletes calendar events."
  ],
  tags: ["calendar", "google", "read-only", "integration"],
  status: "enabled",
  createdAt: now(),
  updatedAt: now()
} as const;

// tool.calendar-list-calendars

const calendarListCalendarsInputSchema = z.object({
  pageToken: z.string().optional()
});

const calendarListCalendarsOutputSchema = z.object({
  calendars: z.array(
    z.object({
      calendarId: z.string(),
      displayName: z.string(),
      isPrimary: z.boolean(),
      accessRole: z.string().nullable(),
      timezone: z.string().nullable(),
      selected: z.boolean(),
      hidden: z.boolean()
    })
  ),
  nextPageToken: z.string().nullable()
});

const calendarListCalendarsSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...calendarReadBaseManifest,
    toolId: "tool.calendar-list-calendars",
    name: "Calendar List Calendars",
    description:
      "Lists all Google Calendars accessible to the connected Google account. " +
      "Returns normalized calendar metadata including ID, display name, timezone, and access role. " +
      "Use this to discover which calendars are available before querying events.",
    inputSchema: jsonSchemaObject([], {
      pageToken: prop("Pagination token from a previous response.", "string")
    }),
    outputSchema: jsonSchemaObject(["calendars", "nextPageToken"], {
      calendars: prop("Normalized calendar summaries.", "array"),
      nextPageToken: prop("Pagination token for next page.", "string")
    }),
    runtimeBinding: { toolRef: "tool:calendar-list-calendars", operation: "calendar_list_calendars" }
  }),
  inputSchema: calendarListCalendarsInputSchema,
  outputSchema: calendarListCalendarsOutputSchema,
  examples: []
};

// tool.calendar-list-events

const calendarListEventsInputSchema = z.object({
  calendarId: z.string().default("primary"),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  maxResults: z.number().int().positive().max(100).default(25),
  pageToken: z.string().optional(),
  query: z.string().optional(),
  singleEvents: z.boolean().default(true),
  orderBy: z.enum(["startTime", "updated"]).default("startTime")
});

const calendarEventSummarySchema = z.object({
  eventId: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startIso: z.string(),
  endIso: z.string(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  status: z.string().nullable(),
  attendeeCount: z.number().int().nonnegative(),
  hasAttendees: z.boolean(),
  organizerEmail: z.string().nullable(),
  hasMeetingLink: z.boolean(),
  isRecurring: z.boolean()
});

const calendarListEventsOutputSchema = z.object({
  events: z.array(calendarEventSummarySchema),
  nextPageToken: z.string().nullable(),
  timeZone: z.string().nullable(),
  calendarId: z.string()
});

const calendarListEventsSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...calendarReadBaseManifest,
    toolId: "tool.calendar-list-events",
    name: "Calendar List Events",
    description:
      "Lists events from a Google Calendar within an optional time window. " +
      "Supports time-bounded queries (timeMin/timeMax), full-text search, and pagination. " +
      "Events are normalized with timezone-correct start/end ISO timestamps. " +
      "Content is EXTERNAL_UNTRUSTED and provenance-linked.",
    inputSchema: jsonSchemaObject([], {
      calendarId: prop("Calendar ID to query. Defaults to 'primary'.", "string"),
      timeMin: prop("ISO-8601 lower bound for event start (inclusive).", "string"),
      timeMax: prop("ISO-8601 upper bound for event start (exclusive).", "string"),
      maxResults: prop("Max events to return (<=100). Default 25.", "number"),
      pageToken: prop("Pagination token from previous response.", "string"),
      query: prop("Free-text search query over event fields.", "string"),
      singleEvents: prop("Expand recurring events into instances. Default true.", "boolean"),
      orderBy: prop("Sort order: startTime (default) or updated.", "string")
    }),
    outputSchema: jsonSchemaObject(["events", "nextPageToken", "timeZone", "calendarId"], {
      events: prop("Normalized calendar event summaries.", "array"),
      nextPageToken: prop("Pagination token for next page.", "string"),
      timeZone: prop("Calendar timezone.", "string"),
      calendarId: prop("The calendar that was queried.", "string")
    }),
    runtimeBinding: { toolRef: "tool:calendar-list-events", operation: "calendar_list_events" }
  }),
  inputSchema: calendarListEventsInputSchema,
  outputSchema: calendarListEventsOutputSchema,
  examples: []
};

// tool.calendar-get-today-events

const calendarTodayEventsInputSchema = z.object({
  calendarId: z.string().default("primary"),
  timezone: z.string().optional()
});

const calendarTodayEventsSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...calendarReadBaseManifest,
    toolId: "tool.calendar-get-today-events",
    name: "Calendar Get Today Events",
    description:
      "Returns all events on the primary (or specified) Google Calendar for today. " +
      "Timezone-aware: the 'today' window is computed in the given timezone (defaults to UTC). " +
      "Use this to answer 'What's on my calendar today?' or 'What meetings do I have today?'",
    inputSchema: jsonSchemaObject([], {
      calendarId: prop("Calendar ID to query. Defaults to 'primary'.", "string"),
      timezone: prop("IANA timezone name for today's window (e.g. 'America/New_York'). Defaults to UTC.", "string")
    }),
    outputSchema: jsonSchemaObject(["events", "nextPageToken", "timeZone", "calendarId"], {
      events: prop("Events scheduled for today.", "array"),
      nextPageToken: prop("Pagination token if truncated.", "string"),
      timeZone: prop("Calendar timezone.", "string"),
      calendarId: prop("Calendar ID queried.", "string")
    }),
    runtimeBinding: { toolRef: "tool:calendar-get-today-events", operation: "calendar_get_today_events" }
  }),
  inputSchema: calendarTodayEventsInputSchema,
  outputSchema: calendarListEventsOutputSchema,
  examples: []
};

// tool.calendar-get-upcoming-events

const calendarUpcomingEventsInputSchema = z.object({
  calendarId: z.string().default("primary"),
  maxResults: z.number().int().positive().max(50).default(10)
});

const calendarUpcomingOutputSchema = z.object({
  calendarId: z.string(),
  fetchedAt: z.string(),
  timezone: z.string().nullable(),
  events: z.array(calendarEventSummarySchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean()
});

const calendarUpcomingEventsSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...calendarReadBaseManifest,
    toolId: "tool.calendar-get-upcoming-events",
    name: "Calendar Get Upcoming Events",
    description:
      "Returns the next N upcoming events from a Google Calendar starting from now. " +
      "Use this to answer 'What's next on my schedule?', 'What are my upcoming meetings?', " +
      "or 'Summarize my upcoming calendar.'",
    inputSchema: jsonSchemaObject([], {
      calendarId: prop("Calendar ID to query. Defaults to 'primary'.", "string"),
      maxResults: prop("Max upcoming events to return (<=50). Default 10.", "number")
    }),
    outputSchema: jsonSchemaObject(["calendarId", "fetchedAt", "timezone", "events", "totalCount", "hasMore"], {
      calendarId: prop("Calendar ID queried.", "string"),
      fetchedAt: prop("ISO timestamp when query was executed.", "string"),
      timezone: prop("Calendar timezone.", "string"),
      events: prop("Upcoming event summaries in start-time order.", "array"),
      totalCount: prop("Number of events returned.", "number"),
      hasMore: prop("True if more events exist beyond this page.", "boolean")
    }),
    runtimeBinding: { toolRef: "tool:calendar-get-upcoming-events", operation: "calendar_get_upcoming_events" }
  }),
  inputSchema: calendarUpcomingEventsInputSchema,
  outputSchema: calendarUpcomingOutputSchema,
  examples: []
};

// tool.calendar-check-availability

const calendarCheckAvailabilityInputSchema = z.object({
  calendarId: z.string().default("primary"),
  timeMin: z.string().min(1),
  timeMax: z.string().min(1),
  checkTimeIso: z.string().optional()
});

const calendarAvailabilityOutputSchema = z.object({
  calendarId: z.string(),
  timeMin: z.string(),
  timeMax: z.string(),
  timezone: z.string().nullable(),
  busyBlocks: z.array(z.object({ start: z.string(), end: z.string() })),
  freeSlots: z.array(z.object({ start: z.string(), end: z.string(), durationMinutes: z.number().int().nonnegative() })),
  isFreeAt: z.boolean().nullable(),
  totalBusyMinutes: z.number().int().nonnegative(),
  totalFreeMinutes: z.number().int().nonnegative()
});

const calendarCheckAvailabilitySpec: BuiltInToolSpec = {
  manifest: parseManifest({
    ...calendarReadBaseManifest,
    toolId: "tool.calendar-check-availability",
    name: "Calendar Check Availability",
    description:
      "Checks free/busy status for a Google Calendar within a given time window. " +
      "Returns busy blocks, free slots (>=15 min), and total free/busy minutes. " +
      "Optionally checks whether a specific time is free. " +
      "Use to answer 'Am I free tomorrow from 2-4pm?' or 'Find open slots this morning.' " +
      "This is a read-only analysis — no events are created.",
    inputSchema: jsonSchemaObject(["timeMin", "timeMax"], {
      calendarId: prop("Calendar ID to check. Defaults to 'primary'.", "string"),
      timeMin: prop("ISO-8601 start of the availability window.", "string"),
      timeMax: prop("ISO-8601 end of the availability window.", "string"),
      checkTimeIso: prop("Optional ISO-8601 datetime to check if specifically free at that moment.", "string")
    }),
    outputSchema: jsonSchemaObject(["calendarId", "timeMin", "timeMax", "busyBlocks", "freeSlots", "isFreeAt", "totalBusyMinutes", "totalFreeMinutes"], {
      calendarId: prop("Calendar ID checked.", "string"),
      timeMin: prop("Window start.", "string"),
      timeMax: prop("Window end.", "string"),
      timezone: prop("Calendar timezone.", "string"),
      busyBlocks: prop("Time blocks with confirmed events.", "array"),
      freeSlots: prop("Open time slots of at least 15 minutes.", "array"),
      isFreeAt: prop("Whether checkTimeIso is free (null if not provided).", "boolean"),
      totalBusyMinutes: prop("Total busy minutes in window.", "number"),
      totalFreeMinutes: prop("Total free minutes in window.", "number")
    }),
    runtimeBinding: { toolRef: "tool:calendar-check-availability", operation: "calendar_check_availability" }
  }),
  inputSchema: calendarCheckAvailabilityInputSchema,
  outputSchema: calendarAvailabilityOutputSchema,
  examples: []
};

// ── exports ────────────────────────────────────────────────────────────────────

export const WEB_TOOL_SPECS = {
  "tool.x-search": xSearchSpec,
  "tool.gmail-list-messages": gmailListSpec,
  "tool.gmail-search-messages": gmailSearchSpec,
  "tool.gmail-get-message": gmailGetMessageSpec,
  "tool.gmail-get-thread": gmailGetThreadSpec,
  "tool.gmail-create-draft": gmailCreateDraftSpec,
  "tool.gmail-create-reply-draft": gmailCreateReplyDraftSpec,
  "tool.gmail-send-message": gmailSendMessageSpec,
  "tool.gmail-archive-message": gmailArchiveMessageSpec,
  "tool.gmail-label-message": gmailLabelMessageSpec,
  "tool.calendar-list-calendars": calendarListCalendarsSpec,
  "tool.calendar-list-events": calendarListEventsSpec,
  "tool.calendar-get-today-events": calendarTodayEventsSpec,
  "tool.calendar-get-upcoming-events": calendarUpcomingEventsSpec,
  "tool.calendar-check-availability": calendarCheckAvailabilitySpec
} as const;

export type WebToolId = keyof typeof WEB_TOOL_SPECS;
