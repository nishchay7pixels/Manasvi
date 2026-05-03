import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── agents-list ────────────────────────────────────────────────────────────────

const agentsListInputSchema = z.object({
  tenantId: z.string().optional(),
  workspaceId: z.string().optional(),
  status: z.enum(["active", "inactive", "deprecated"]).optional(),
  capabilityFilter: z.array(z.string()).default([]),
  limit: z.number().int().positive().max(100).default(20)
});

const agentsListOutputSchema = z.object({
  agents: z.array(
    z.object({
      agentDefinitionId: z.string(),
      name: z.string(),
      description: z.string(),
      version: z.string(),
      status: z.string(),
      capabilities: z.array(z.string()),
      toolIds: z.array(z.string()),
      owner: z.string(),
      createdAt: z.string()
    })
  ),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().default(false)
});

const agentsListSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.agents-list",
    name: "Agents List",
    version: "1.0.0",
    description:
      "Lists available agent definitions visible to the calling principal. " +
      "Returns agent metadata including capabilities, available tools, and lifecycle status. " +
      "Used for agent discovery before spawning subagents or routing tasks. " +
      "Read-only. Scoped to the caller's tenant/workspace.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "list-agents",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "agent.list",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "agent-definition" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["agent-definition"],
    inputSchema: jsonSchemaObject(
      [],
      {
        tenantId: prop("Filter by tenant ID (operator use). Defaults to caller's tenant.", "string"),
        workspaceId: prop("Filter by workspace ID. Defaults to caller's workspace.", "string"),
        status: prop("Filter by agent lifecycle status.", "string", { enum: ["active", "inactive", "deprecated"] }),
        capabilityFilter: prop("Filter agents that have all listed capabilities.", "array"),
        limit: prop("Maximum results to return. Max 100.", "number")
      },
      "Input for the Agents List tool."
    ),
    outputSchema: jsonSchemaObject(
      ["agents", "total", "truncated"],
      {
        agents: prop("Array of agent definition records.", "array"),
        total: prop("Total matching agents (before limit).", "number"),
        truncated: prop("True if results were capped at limit.", "boolean")
      },
      "Output from the Agents List tool."
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
    runtimeBinding: { toolRef: "tool:agents-list", operation: "agents_list" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "agent-definition", resourceId: "agent:catalogue" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Read-only — returns metadata only, does not spawn agents.",
      "Scoped to caller's tenant/workspace.",
      "Use tool.subagents to spawn an agent from a definition."
    ],
    tags: ["agents", "list", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: agentsListInputSchema,
  outputSchema: agentsListOutputSchema,
  examples: [
    {
      description: "List all active agent definitions in the workspace",
      input: { status: "active", limit: 10 },
      output: {
        agents: [
          { agentDefinitionId: "agent-def:summariser", name: "Summariser", description: "Summarises documents and web content.", version: "1.0.0", status: "active", capabilities: ["web.search", "memory.write"], toolIds: ["tool.web-search", "tool.http-fetch", "tool.memory-note-write"], owner: "operator:default", createdAt: "2026-04-01T00:00:00.000Z" }
        ],
        total: 1,
        truncated: false
      }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const AGENTS_TOOL_SPECS = {
  "tool.agents-list": agentsListSpec
} as const;

export type AgentsToolId = keyof typeof AGENTS_TOOL_SPECS;
