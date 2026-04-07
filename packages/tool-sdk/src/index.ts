import { z } from "zod";

import {
  createToolExecutionContract,
  createToolInvocationRequest,
  toolManifestSchema,
  toolResultSchema,
  type ToolExecutionContract,
  type ToolInvocationRequest,
  type ToolManifest,
  type ToolResult
} from "@manasvi/contracts";

const fileReadInputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]).default("utf8")
});
const fileReadOutputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  bytes: z.number().int().nonnegative()
});

const httpFetchInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET"]).default("GET"),
  headers: z.record(z.string()).default({})
});
const httpFetchOutputSchema = z.object({
  url: z.string().url(),
  status: z.number().int(),
  preview: z.string(),
  contentType: z.string().optional()
});

const shellCommandInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string().min(1)).default(["echo", "pwd", "ls"]),
  timeoutMs: z.number().int().positive().max(120000).default(5000)
});
const shellCommandOutputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string()
});

const webSearchInputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(10).default(5)
});
const webSearchOutputSchema = z.object({
  query: z.string().min(1),
  results: z.array(
    z.object({
      title: z.string().min(1),
      url: z.string().url(),
      snippet: z.string().min(1)
    })
  )
});

const memoryWriteInputSchema = z.object({
  namespace: z.string().min(1),
  note: z.string().min(1),
  trustClassification: z.enum([
    "USER_OWNED",
    "EXTERNAL_UNTRUSTED",
    "CONTROL_TRUSTED",
    "MODEL_GENERATED_UNTRUSTED"
  ]),
  metadata: z.record(z.unknown()).default({})
});
const memoryWriteOutputSchema = z.object({
  namespace: z.string().min(1),
  noteId: z.string().min(1),
  persisted: z.boolean()
});

const approvalRequestInputSchema = z.object({
  intentId: z.string().min(1),
  summary: z.string().min(1),
  reason: z.string().min(1).optional()
});
const approvalRequestOutputSchema = z.object({
  intentId: z.string().min(1),
  approvalRequestCreated: z.boolean(),
  approvalRequestId: z.string().min(1)
});

export type BuiltInToolId =
  | "tool.local-file-read"
  | "tool.http-fetch"
  | "tool.shell-command"
  | "tool.web-search"
  | "tool.memory-note-write"
  | "tool.approval-request";

export interface BuiltInToolSpec {
  manifest: ToolManifest;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
}

function now(): string {
  return new Date().toISOString();
}

function jsonSchemaObject(required: string[], properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    required,
    properties,
    additionalProperties: false
  };
}

export const BUILTIN_TOOL_SPECS: Record<BuiltInToolId, BuiltInToolSpec> = {
  "tool.local-file-read": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.local-file-read",
      name: "Local File Read Tool",
      version: "1.0.0",
      description: "Reads a local file through sandboxed executor paths.",
      owner: "manasvi-platform",
      provider: "manasvi-core",
      type: "built_in",
      actionClass: "read",
      sideEffectClass: "read_only",
      mutability: "read_only",
      capabilities: [
        {
          capabilityId: "filesystem.read",
          required: true,
          scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
          constraints: {}
        }
      ],
      resourceClassesTouched: ["filesystem-zone"],
      inputSchema: jsonSchemaObject(["path"], {
        path: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"] }
      }),
      outputSchema: jsonSchemaObject(["path", "encoding", "content", "bytes"], {
        path: { type: "string" },
        encoding: { type: "string" },
        content: { type: "string" },
        bytes: { type: "number" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 8000,
        defaultSandboxMode: "read_only_local",
        egressProfiles: [],
        filesystemProfile: "read_only_inputs",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: false
      },
      runtimeBinding: {
        toolRef: "tool:file-read",
        operation: "file_read"
      },
      policyBinding: {
        policyActionClass: "read",
        resource: {
          resourceClass: "filesystem-zone",
          resourceId: "filesystem:workspace"
        },
        requiresExplicitPolicy: true,
        approvalHint: "none"
      },
      trustNotes: ["Reads local workspace content; output remains untrusted user/tool data."],
      tags: ["filesystem", "read-only"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: fileReadInputSchema,
    outputSchema: fileReadOutputSchema
  },
  "tool.http-fetch": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.http-fetch",
      name: "HTTP Fetch Tool",
      version: "1.0.0",
      description: "Fetches remote content under egress-controlled runtime policy.",
      owner: "manasvi-platform",
      provider: "manasvi-core",
      type: "built_in",
      actionClass: "fetch",
      sideEffectClass: "external_side_effect",
      mutability: "read_only",
      capabilities: [
        {
          capabilityId: "network.fetch",
          required: true,
          scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "network-zone" },
          constraints: {}
        }
      ],
      resourceClassesTouched: ["network-zone"],
      inputSchema: jsonSchemaObject(["url"], {
        url: { type: "string" },
        method: { type: "string", enum: ["GET"] },
        headers: { type: "object" }
      }),
      outputSchema: jsonSchemaObject(["url", "status", "preview"], {
        url: { type: "string" },
        status: { type: "number" },
        preview: { type: "string" },
        contentType: { type: "string" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 15000,
        defaultSandboxMode: "restricted_remote",
        egressProfiles: ["default-allowlist"],
        filesystemProfile: "none",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: false
      },
      runtimeBinding: {
        toolRef: "tool:http-get",
        operation: "http_fetch"
      },
      policyBinding: {
        policyActionClass: "access-network",
        resource: {
          resourceClass: "network-zone",
          resourceId: "network:egress"
        },
        requiresExplicitPolicy: true,
        approvalHint: "may_require"
      },
      trustNotes: ["Remote content is external and untrusted by default."],
      tags: ["network", "fetch", "external"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: httpFetchInputSchema,
    outputSchema: httpFetchOutputSchema
  },
  "tool.shell-command": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.shell-command",
      name: "Shell Command Tool",
      version: "1.0.0",
      description: "Executes bounded shell commands under sandbox controls.",
      owner: "manasvi-platform",
      provider: "manasvi-core",
      type: "built_in",
      actionClass: "execute",
      sideEffectClass: "privileged",
      mutability: "mutating",
      capabilities: [
        {
          capabilityId: "shell.execute",
          required: true,
          scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
          constraints: {}
        }
      ],
      resourceClassesTouched: ["filesystem-zone", "network-zone"],
      inputSchema: jsonSchemaObject(["command"], {
        command: { type: "string" },
        args: { type: "array" },
        allowedCommands: { type: "array" },
        timeoutMs: { type: "number" }
      }),
      outputSchema: jsonSchemaObject(["command", "args", "exitCode", "stdout", "stderr"], {
        command: { type: "string" },
        args: { type: "array" },
        exitCode: { type: "number" },
        stdout: { type: "string" },
        stderr: { type: "string" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 10000,
        defaultSandboxMode: "no_network_compute",
        egressProfiles: [],
        filesystemProfile: "scratch_write",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: true
      },
      runtimeBinding: {
        toolRef: "tool:shell-command",
        operation: "shell_command"
      },
      policyBinding: {
        policyActionClass: "execute",
        resource: {
          resourceClass: "tool-endpoint",
          resourceId: "tool:shell-command"
        },
        requiresExplicitPolicy: true,
        approvalHint: "must_require"
      },
      trustNotes: ["High-risk execution surface; command allowlist and sandboxing required."],
      tags: ["shell", "execute", "privileged"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: shellCommandInputSchema,
    outputSchema: shellCommandOutputSchema
  },
  "tool.web-search": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.web-search",
      name: "Web Search Adapter",
      version: "1.0.0",
      description: "Performs a policy-governed web search adapter call.",
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
      inputSchema: jsonSchemaObject(["query"], {
        query: { type: "string" },
        maxResults: { type: "number" }
      }),
      outputSchema: jsonSchemaObject(["query", "results"], {
        query: { type: "string" },
        results: { type: "array" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 18000,
        defaultSandboxMode: "restricted_remote",
        egressProfiles: ["default-allowlist"],
        filesystemProfile: "none",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: false
      },
      runtimeBinding: {
        toolRef: "tool:web-search",
        operation: "web_search"
      },
      policyBinding: {
        policyActionClass: "access-network",
        resource: {
          resourceClass: "network-zone",
          resourceId: "network:web-search"
        },
        requiresExplicitPolicy: true,
        approvalHint: "may_require"
      },
      trustNotes: ["Search output is external and untrusted content."],
      tags: ["search", "network", "adapter"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: webSearchInputSchema,
    outputSchema: webSearchOutputSchema
  },
  "tool.memory-note-write": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.memory-note-write",
      name: "Note Memory Write Tool",
      version: "1.0.0",
      description: "Writes a note into memory namespace via governed runtime contract.",
      owner: "manasvi-platform",
      provider: "manasvi-core",
      type: "built_in",
      actionClass: "mutate-memory",
      sideEffectClass: "mutating",
      mutability: "mutating",
      capabilities: [
        {
          capabilityId: "memory.write",
          required: true,
          scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "memory-namespace" },
          constraints: {}
        }
      ],
      resourceClassesTouched: ["memory-namespace"],
      inputSchema: jsonSchemaObject(["namespace", "note", "trustClassification"], {
        namespace: { type: "string" },
        note: { type: "string" },
        trustClassification: { type: "string" },
        metadata: { type: "object" }
      }),
      outputSchema: jsonSchemaObject(["namespace", "noteId", "persisted"], {
        namespace: { type: "string" },
        noteId: { type: "string" },
        persisted: { type: "boolean" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 8000,
        defaultSandboxMode: "read_only_local",
        egressProfiles: [],
        filesystemProfile: "scratch_write",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: false
      },
      runtimeBinding: {
        toolRef: "tool:memory-write",
        operation: "memory_note_write"
      },
      policyBinding: {
        policyActionClass: "mutate-memory",
        resource: {
          resourceClass: "memory-namespace",
          resourceId: "memory:notes"
        },
        requiresExplicitPolicy: true,
        approvalHint: "may_require"
      },
      trustNotes: ["Memory writes preserve caller-provided trust classification."],
      tags: ["memory", "write"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: memoryWriteInputSchema,
    outputSchema: memoryWriteOutputSchema
  },
  "tool.approval-request": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.approval-request",
      name: "Approval Request Tool",
      version: "1.0.0",
      description: "Creates an approval request linkage for an execution intent.",
      owner: "manasvi-platform",
      provider: "manasvi-core",
      type: "workflow",
      actionClass: "approve",
      sideEffectClass: "approval_sensitive",
      mutability: "mutating",
      capabilities: [
        {
          capabilityId: "approval.request",
          required: true,
          scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "approval-authority" },
          constraints: {}
        }
      ],
      resourceClassesTouched: ["approval-authority", "service-endpoint"],
      inputSchema: jsonSchemaObject(["intentId", "summary"], {
        intentId: { type: "string" },
        summary: { type: "string" },
        reason: { type: "string" }
      }),
      outputSchema: jsonSchemaObject(["intentId", "approvalRequestCreated", "approvalRequestId"], {
        intentId: { type: "string" },
        approvalRequestCreated: { type: "boolean" },
        approvalRequestId: { type: "string" }
      }),
      runtimeHints: {
        defaultTimeoutMs: 10000,
        defaultSandboxMode: "read_only_local",
        egressProfiles: [],
        filesystemProfile: "none",
        declaredSecretRefs: [],
        requireExecutorPath: true,
        approvalSensitive: true
      },
      runtimeBinding: {
        toolRef: "tool:approval-request",
        operation: "approval_request"
      },
      policyBinding: {
        policyActionClass: "approve",
        resource: {
          resourceClass: "approval-authority",
          resourceId: "approval:default"
        },
        requiresExplicitPolicy: true,
        approvalHint: "must_require"
      },
      trustNotes: ["Approval requests are workflow-sensitive security artifacts."],
      tags: ["approval", "workflow"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: approvalRequestInputSchema,
    outputSchema: approvalRequestOutputSchema
  }
};

export const BUILTIN_TOOL_MANIFESTS: ToolManifest[] = Object.values(BUILTIN_TOOL_SPECS).map((s) => s.manifest);

export function getBuiltInToolSpec(toolId: string): BuiltInToolSpec | undefined {
  return Object.values(BUILTIN_TOOL_SPECS).find((tool) => tool.manifest.toolId === toolId);
}

export function validateToolManifest(input: unknown): ToolManifest {
  return toolManifestSchema.parse(input);
}

export function validateToolInput(toolId: string, input: unknown): Record<string, unknown> {
  const spec = getBuiltInToolSpec(toolId);
  if (!spec) {
    throw new Error(`No tool input validator registered for ${toolId}`);
  }
  return spec.inputSchema.parse(input);
}

export function validateToolOutput(toolId: string, output: unknown): Record<string, unknown> {
  const spec = getBuiltInToolSpec(toolId);
  if (!spec) {
    throw new Error(`No tool output validator registered for ${toolId}`);
  }
  return spec.outputSchema.parse(output);
}

export function createGovernedToolInvocation(input: Omit<ToolInvocationRequest, "schemaVersion" | "invocationId">): ToolInvocationRequest {
  return createToolInvocationRequest(input);
}

export function buildGovernedToolExecutionContract(input: {
  manifest: ToolManifest;
  invocation: ToolInvocationRequest;
  intent: ToolExecutionContract["intent"];
  artifact: ToolExecutionContract["artifact"];
  trace: ToolExecutionContract["trace"];
}): ToolExecutionContract {
  if (input.invocation.toolId !== input.manifest.toolId) {
    throw new Error("Tool invocation toolId does not match manifest toolId");
  }
  if (
    input.invocation.requestedSecretRefs.some(
      (secretRef) => !input.manifest.runtimeHints.declaredSecretRefs.includes(secretRef)
    )
  ) {
    throw new Error("Tool invocation requested undeclared secret references");
  }
  return createToolExecutionContract({
    invocation: input.invocation,
    manifest: input.manifest,
    intent: input.intent,
    artifact: input.artifact,
    trace: input.trace
  });
}

export function createToolResult(input: Omit<ToolResult, "schemaVersion">): ToolResult {
  return toolResultSchema.parse({
    schemaVersion: "1.0",
    ...input
  });
}
