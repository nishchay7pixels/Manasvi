import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── sessions-list ──────────────────────────────────────────────────────────────

const sessionsListInputSchema = z.object({
  tenantId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  status: z.enum(["active", "idle", "closed", "expired"]).optional(),
  limit: z.number().int().positive().max(100).default(20)
});

const sessionsListOutputSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      sessionType: z.string(),
      status: z.string(),
      owner: z.string(),
      createdAt: z.string(),
      updatedAt: z.string()
    })
  ),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().default(false)
});

const sessionsListSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.sessions-list",
    name: "Sessions List",
    version: "1.0.0",
    description:
      "Lists active and recent sessions visible to the calling principal. " +
      "Results are scoped to the caller's tenant and workspace by default. " +
      "Operators can inspect sessions across the workspace with explicit policy. " +
      "No session content is returned — only metadata.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "read-session",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "session.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session"],
    inputSchema: jsonSchemaObject(
      [],
      {
        tenantId: prop("Filter by tenant ID (operator use). Defaults to caller's tenant.", "string"),
        workspaceId: prop("Filter by workspace ID. Defaults to caller's workspace.", "string"),
        status: prop("Filter by session status.", "string", { enum: ["active", "idle", "closed", "expired"] }),
        limit: prop("Maximum number of sessions to return. Max 100.", "number")
      },
      "Input for the Sessions List tool."
    ),
    outputSchema: jsonSchemaObject(
      ["sessions", "total", "truncated"],
      {
        sessions: prop("Array of session metadata records.", "array"),
        total: prop("Total matching sessions (before limit).", "number"),
        truncated: prop("True if results were limited.", "boolean")
      },
      "Output from the Sessions List tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 8000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:sessions-list", operation: "sessions_list" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "session", resourceId: "session:list" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Returns session metadata only — no message content or tool results.",
      "Scoped to caller's tenant/workspace by default."
    ],
    tags: ["sessions", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionsListInputSchema,
  outputSchema: sessionsListOutputSchema,
  examples: [
    {
      description: "List active sessions in the current workspace",
      input: { status: "active", limit: 10 },
      output: {
        sessions: [
          { sessionId: "session:abc123", sessionType: "user_interaction", status: "active", owner: "user:alice", createdAt: "2026-05-04T00:00:00.000Z", updatedAt: "2026-05-04T00:05:00.000Z" }
        ],
        total: 1,
        truncated: false
      }
    }
  ]
};

// ── sessions-history ───────────────────────────────────────────────────────────

const sessionsHistoryInputSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
  includeToolResults: z.boolean().default(false)
});

const sessionsHistoryOutputSchema = z.object({
  sessionId: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      timestamp: z.string(),
      trustClassification: z.string()
    })
  ),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().default(false)
});

const sessionsHistorySpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.sessions-history",
    name: "Sessions History",
    version: "1.0.0",
    description:
      "Reads the message history of a session. " +
      "The calling principal must own or have read access to the session. " +
      "Trust classification of each message is preserved in the response. " +
      "Tool results are excluded by default — set includeToolResults=true for operator audit use.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "read-session",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "session.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session"],
    inputSchema: jsonSchemaObject(
      ["sessionId"],
      {
        sessionId: prop("The session ID to retrieve history for.", "string"),
        limit: prop("Maximum messages to return. Max 200.", "number"),
        offset: prop("Pagination offset.", "number"),
        includeToolResults: prop("Include tool invocation results in the history. Default false.", "boolean")
      },
      "Input for the Sessions History tool."
    ),
    outputSchema: jsonSchemaObject(
      ["sessionId", "messages", "total", "truncated"],
      {
        sessionId: prop("The session that was queried.", "string"),
        messages: prop("Array of message records with role, content, timestamp, and trust classification.", "array"),
        total: prop("Total messages in the session.", "number"),
        truncated: prop("True if results were paginated.", "boolean")
      },
      "Output from the Sessions History tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:sessions-history", operation: "sessions_history" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "session", resourceId: "session:history" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Each message carries its original trust classification.",
      "Caller must own or have explicit read access to the session.",
      "Cross-session or cross-tenant history access requires explicit policy."
    ],
    tags: ["sessions", "history", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionsHistoryInputSchema,
  outputSchema: sessionsHistoryOutputSchema,
  examples: [
    {
      description: "Retrieve the last 10 messages from a session",
      input: { sessionId: "session:abc123", limit: 10 },
      output: {
        sessionId: "session:abc123",
        messages: [
          { role: "user", content: "What is the status of the deployment?", timestamp: "2026-05-04T00:00:00.000Z", trustClassification: "USER_OWNED" },
          { role: "assistant", content: "The deployment completed successfully at 23:58 UTC.", timestamp: "2026-05-04T00:00:05.000Z", trustClassification: "MODEL_GENERATED_UNTRUSTED" }
        ],
        total: 2,
        truncated: false
      }
    }
  ]
};

// ── sessions-send ──────────────────────────────────────────────────────────────

const sessionsSendInputSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
  role: z.enum(["user", "system"]).default("user"),
  metadata: z.record(z.unknown()).default({})
});

const sessionsSendOutputSchema = z.object({
  sessionId: z.string(),
  messageId: z.string(),
  status: z.enum(["queued", "delivered", "rejected"]),
  deliveredAt: z.string().optional()
});

const sessionsSendSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.sessions-send",
    name: "Sessions Send",
    version: "1.0.0",
    description:
      "Sends a message into an active session, continuing the conversation context. " +
      "The calling principal must have write access to the target session. " +
      "Messages sent with role=system carry higher implicit weight — use with care. " +
      "Cross-session injection is blocked by default; requires explicit policy.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "mutate-session",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "session.write",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session"],
    inputSchema: jsonSchemaObject(
      ["sessionId", "message"],
      {
        sessionId: prop("Target session ID.", "string"),
        message: prop("Message content to send into the session.", "string"),
        role: prop("Message role: user or system.", "string", { enum: ["user", "system"], default: "user" }),
        metadata: prop("Optional metadata attached to the message record.", "object")
      },
      "Input for the Sessions Send tool."
    ),
    outputSchema: jsonSchemaObject(
      ["sessionId", "messageId", "status"],
      {
        sessionId: prop("The session the message was sent to.", "string"),
        messageId: prop("Unique ID of the delivered message.", "string"),
        status: prop("Delivery status: queued, delivered, or rejected.", "string", { enum: ["queued", "delivered", "rejected"] }),
        deliveredAt: prop("ISO-8601 timestamp when the message was delivered.", "string")
      },
      "Output from the Sessions Send tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:sessions-send", operation: "sessions_send" },
    policyBinding: {
      policyActionClass: "write",
      resource: { resourceClass: "session", resourceId: "session:send" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "System-role messages influence session context — use with explicit intent.",
      "Cross-session injection requires explicit policy allowance.",
      "Message content is not treated as CONTROL_TRUSTED unless explicitly elevated by policy."
    ],
    tags: ["sessions", "write", "send"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionsSendInputSchema,
  outputSchema: sessionsSendOutputSchema,
  examples: [
    {
      description: "Send a follow-up user message to an active session",
      input: { sessionId: "session:abc123", message: "Please also summarise the error logs.", role: "user" },
      output: { sessionId: "session:abc123", messageId: "msg:xyz789", status: "delivered", deliveredAt: "2026-05-04T00:10:00.000Z" }
    }
  ]
};

// ── sessions-spawn ─────────────────────────────────────────────────────────────

const sessionsSpawnInputSchema = z.object({
  sessionType: z.enum(["user_interaction", "agent_workflow", "channel_thread", "service_internal"]).default("agent_workflow"),
  isolationMode: z.enum(["per_user_isolated", "per_channel_thread", "shared_collaborative", "ephemeral_one_shot", "service_internal", "workspace_scoped_constrained"]).default("ephemeral_one_shot"),
  initialMessage: z.string().optional(),
  parentSessionId: z.string().optional(),
  ttlSeconds: z.number().int().positive().max(86400).default(3600),
  metadata: z.record(z.unknown()).default({})
});

const sessionsSpawnOutputSchema = z.object({
  sessionId: z.string(),
  sessionType: z.string(),
  isolationMode: z.string(),
  status: z.string(),
  parentSessionId: z.string().optional(),
  createdAt: z.string(),
  expiresAt: z.string()
});

const sessionsSpawnSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.sessions-spawn",
    name: "Sessions Spawn",
    version: "1.0.0",
    description:
      "Creates a new session or sub-session as a governed child of the current agent context. " +
      "Sub-sessions inherit tenant/workspace scoping and are subject to the same policy as the parent. " +
      "Ephemeral sessions are preferred for short-lived agent workflows. " +
      "Approval-sensitive: spawning sessions creates new execution contexts.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "mutate-session",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "session.create",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session", "execution-node"],
    inputSchema: jsonSchemaObject(
      [],
      {
        sessionType: prop("Type of session to create.", "string", { enum: ["user_interaction", "agent_workflow", "channel_thread", "service_internal"] }),
        isolationMode: prop("Session isolation mode.", "string"),
        initialMessage: prop("Optional initial message to seed the new session.", "string"),
        parentSessionId: prop("Parent session ID for sub-session creation.", "string"),
        ttlSeconds: prop("Session TTL in seconds. Max 86400 (24 h).", "number"),
        metadata: prop("Metadata attached to the new session.", "object")
      },
      "Input for the Sessions Spawn tool."
    ),
    outputSchema: jsonSchemaObject(
      ["sessionId", "sessionType", "isolationMode", "status", "createdAt", "expiresAt"],
      {
        sessionId: prop("Unique ID of the newly created session.", "string"),
        sessionType: prop("Session type as created.", "string"),
        isolationMode: prop("Isolation mode applied.", "string"),
        status: prop("Initial session status (active).", "string"),
        parentSessionId: prop("Parent session ID if this is a sub-session.", "string"),
        createdAt: prop("ISO-8601 creation timestamp.", "string"),
        expiresAt: prop("ISO-8601 expiry timestamp based on TTL.", "string")
      },
      "Output from the Sessions Spawn tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:sessions-spawn", operation: "sessions_spawn" },
    policyBinding: {
      policyActionClass: "write",
      resource: { resourceClass: "session", resourceId: "session:create" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Sub-sessions are bounded by the parent's tenant/workspace policy.",
      "Spawning ephemeral sessions is preferred over long-lived sessions for agent workflows.",
      "Approval required: new sessions create new execution surfaces."
    ],
    tags: ["sessions", "spawn", "subagent", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionsSpawnInputSchema,
  outputSchema: sessionsSpawnOutputSchema,
  examples: [
    {
      description: "Spawn an ephemeral agent workflow sub-session",
      input: { sessionType: "agent_workflow", isolationMode: "ephemeral_one_shot", ttlSeconds: 1800 },
      output: { sessionId: "session:child-xyz", sessionType: "agent_workflow", isolationMode: "ephemeral_one_shot", status: "active", createdAt: "2026-05-04T00:00:00.000Z", expiresAt: "2026-05-04T00:30:00.000Z" }
    }
  ]
};

// ── sessions-yield ─────────────────────────────────────────────────────────────

const sessionsYieldInputSchema = z.object({
  toSessionId: z.string().min(1),
  result: z.record(z.unknown()).default({}),
  reason: z.string().optional(),
  closeAfterYield: z.boolean().default(false)
});

const sessionsYieldOutputSchema = z.object({
  fromSessionId: z.string(),
  toSessionId: z.string(),
  yieldId: z.string(),
  status: z.enum(["delivered", "queued", "rejected"]),
  closedSession: z.boolean().default(false)
});

const sessionsYieldSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.sessions-yield",
    name: "Sessions Yield",
    version: "1.0.0",
    description:
      "Yields a result payload from the current session to a parent or peer session. " +
      "Used to hand off control or return a result from a sub-session workflow. " +
      "The result is delivered as an observation to the target session. " +
      "Optionally closes the current session after the yield.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "mutate-session",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "session.write",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session"],
    inputSchema: jsonSchemaObject(
      ["toSessionId"],
      {
        toSessionId: prop("Target session to yield the result to.", "string"),
        result: prop("Result payload delivered as an observation to the target session.", "object"),
        reason: prop("Optional human-readable reason for the yield.", "string"),
        closeAfterYield: prop("Close the current session after delivering the yield. Default false.", "boolean")
      },
      "Input for the Sessions Yield tool."
    ),
    outputSchema: jsonSchemaObject(
      ["fromSessionId", "toSessionId", "yieldId", "status"],
      {
        fromSessionId: prop("The session that yielded.", "string"),
        toSessionId: prop("The session that received the yield.", "string"),
        yieldId: prop("Unique ID of the yield event.", "string"),
        status: prop("Delivery status.", "string", { enum: ["delivered", "queued", "rejected"] }),
        closedSession: prop("True if the current session was closed after the yield.", "boolean")
      },
      "Output from the Sessions Yield tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:sessions-yield", operation: "sessions_yield" },
    policyBinding: {
      policyActionClass: "write",
      resource: { resourceClass: "session", resourceId: "session:yield" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "Result payload is treated as EXTERNAL_UNTRUSTED by the receiving session.",
      "Cross-tenant yield is blocked by default."
    ],
    tags: ["sessions", "yield", "workflow"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionsYieldInputSchema,
  outputSchema: sessionsYieldOutputSchema,
  examples: [
    {
      description: "Yield a sub-task result back to the parent session",
      input: { toSessionId: "session:parent-abc", result: { summary: "Task completed.", itemsProcessed: 42 }, closeAfterYield: true },
      output: { fromSessionId: "session:child-xyz", toSessionId: "session:parent-abc", yieldId: "yield:qrs456", status: "delivered", closedSession: true }
    }
  ]
};

// ── subagents ──────────────────────────────────────────────────────────────────

const subagentsInputSchema = z.object({
  operation: z.enum(["spawn", "list", "status", "terminate"]).default("list"),
  agentDefinitionId: z.string().optional(),
  subagentId: z.string().optional(),
  input: z.record(z.unknown()).default({}),
  parentSessionId: z.string().optional()
});

const subagentsOutputSchema = z.object({
  operation: z.string(),
  subagents: z.array(
    z.object({
      subagentId: z.string(),
      agentDefinitionId: z.string(),
      status: z.string(),
      createdAt: z.string()
    })
  ).optional(),
  subagentId: z.string().optional(),
  status: z.string().optional(),
  success: z.boolean()
});

const subagentsSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.subagents",
    name: "Subagents",
    version: "1.0.0",
    description:
      "Creates, lists, inspects, or terminates subordinate agents running under the current principal's authority. " +
      "Spawn operations create new agent instances from registered agent definitions. " +
      "Subagents inherit the parent's tenant/workspace policy constraints. " +
      "Approval required for spawn and terminate operations.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "spawn-subagent",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "agent.spawn",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "agent-definition" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["agent-definition", "execution-node", "session"],
    inputSchema: jsonSchemaObject(
      ["operation"],
      {
        operation: prop("Operation: spawn a new subagent, list running subagents, check status, or terminate.", "string", { enum: ["spawn", "list", "status", "terminate"] }),
        agentDefinitionId: prop("Agent definition ID (required for spawn).", "string"),
        subagentId: prop("Subagent instance ID (required for status/terminate).", "string"),
        input: prop("Input payload for the subagent (for spawn).", "object"),
        parentSessionId: prop("Parent session ID for the spawned subagent.", "string")
      },
      "Input for the Subagents tool."
    ),
    outputSchema: jsonSchemaObject(
      ["operation", "success"],
      {
        operation: prop("The operation performed.", "string"),
        subagents: prop("List of subagent records (for list operation).", "array"),
        subagentId: prop("ID of the spawned or targeted subagent.", "string"),
        status: prop("Subagent status (for status/terminate operations).", "string"),
        success: prop("Whether the operation completed successfully.", "boolean")
      },
      "Output from the Subagents tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 15000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:subagents", operation: "subagents_manage" },
    policyBinding: {
      policyActionClass: "execute",
      resource: { resourceClass: "agent-definition", resourceId: "agent:subagent" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Subagents run under the parent's policy constraints — they cannot escalate privileges.",
      "Spawn and terminate are approval-sensitive operations.",
      "Subagent inputs/outputs are EXTERNAL_UNTRUSTED by default."
    ],
    tags: ["sessions", "subagent", "spawn", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: subagentsInputSchema,
  outputSchema: subagentsOutputSchema,
  examples: [
    {
      description: "List running subagents",
      input: { operation: "list" },
      output: { operation: "list", subagents: [], success: true }
    },
    {
      description: "Spawn a summariser subagent",
      input: { operation: "spawn", agentDefinitionId: "agent-def:summariser", input: { document: "..." } },
      output: { operation: "spawn", subagentId: "subagent:sum-abc", success: true }
    }
  ]
};

// ── session-status ─────────────────────────────────────────────────────────────

const sessionStatusInputSchema = z.object({
  sessionId: z.string().min(1)
});

const sessionStatusOutputSchema = z.object({
  sessionId: z.string(),
  sessionType: z.string(),
  isolationMode: z.string(),
  status: z.string(),
  riskLevel: z.string(),
  iteration: z.number().int().nonnegative(),
  owner: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional()
});

const sessionStatusSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.session-status",
    name: "Session Status",
    version: "1.0.0",
    description:
      "Returns the current status and metadata of a specific session. " +
      "Includes risk profile, iteration count, and lifecycle timestamps. " +
      "Read-only. The caller must own or have read access to the session.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "read-session",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "session.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "session" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["session"],
    inputSchema: jsonSchemaObject(
      ["sessionId"],
      { sessionId: prop("The session ID to inspect.", "string") },
      "Input for the Session Status tool."
    ),
    outputSchema: jsonSchemaObject(
      ["sessionId", "sessionType", "isolationMode", "status", "riskLevel", "iteration", "owner", "createdAt", "updatedAt"],
      {
        sessionId: prop("The session ID.", "string"),
        sessionType: prop("Session type.", "string"),
        isolationMode: prop("Isolation mode.", "string"),
        status: prop("Current lifecycle status.", "string"),
        riskLevel: prop("Current risk level of the session.", "string"),
        iteration: prop("Number of agent iterations completed in this session.", "number"),
        owner: prop("Principal ID of the session owner.", "string"),
        createdAt: prop("Session creation timestamp.", "string"),
        updatedAt: prop("Last update timestamp.", "string"),
        expiresAt: prop("Expiry timestamp if applicable.", "string")
      },
      "Output from the Session Status tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 5000,
      defaultSandboxMode: "restricted_remote",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:session-status", operation: "session_status" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "session", resourceId: "session:status" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Read-only — no session state mutation.",
      "Risk level reflects current session behaviour patterns."
    ],
    tags: ["sessions", "status", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: sessionStatusInputSchema,
  outputSchema: sessionStatusOutputSchema,
  examples: [
    {
      description: "Check the status of an active session",
      input: { sessionId: "session:abc123" },
      output: { sessionId: "session:abc123", sessionType: "user_interaction", isolationMode: "per_user_isolated", status: "active", riskLevel: "low", iteration: 3, owner: "user:alice", createdAt: "2026-05-04T00:00:00.000Z", updatedAt: "2026-05-04T00:10:00.000Z" }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const SESSION_TOOL_SPECS = {
  "tool.sessions-list": sessionsListSpec,
  "tool.sessions-history": sessionsHistorySpec,
  "tool.sessions-send": sessionsSendSpec,
  "tool.sessions-spawn": sessionsSpawnSpec,
  "tool.sessions-yield": sessionsYieldSpec,
  "tool.subagents": subagentsSpec,
  "tool.session-status": sessionStatusSpec
} as const;

export type SessionToolId = keyof typeof SESSION_TOOL_SPECS;
