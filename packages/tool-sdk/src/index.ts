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

import { RUNTIME_TOOL_SPECS, type RuntimeToolId } from "./tools/runtime.js";
import { FILESYSTEM_TOOL_SPECS, type FilesystemToolId } from "./tools/filesystem.js";
import { SESSION_TOOL_SPECS, type SessionToolId } from "./tools/sessions.js";
import { MEMORY_TOOL_SPECS, type MemoryToolId } from "./tools/memory.js";
import { WEB_TOOL_SPECS, type WebToolId } from "./tools/web.js";
import { UI_TOOL_SPECS, type UiToolId } from "./tools/ui.js";
import { AUTOMATION_TOOL_SPECS, type AutomationToolId } from "./tools/automation.js";
import { MESSAGING_TOOL_SPECS, type MessagingToolId } from "./tools/messaging.js";
import { NODES_TOOL_SPECS, type NodesToolId } from "./tools/nodes.js";
import { AGENTS_TOOL_SPECS, type AgentsToolId } from "./tools/agents.js";

// ── Zod input/output validators ────────────────────────────────────────────────

const fileReadInputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  maxBytes: z.number().int().positive().max(10 * 1024 * 1024).optional()
});
const fileReadOutputSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
  truncated: z.boolean().default(false),
  provenance: z.object({
    source: z.literal("filesystem"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED")
  }).optional()
});

const httpFetchInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET"]).default("GET"),
  headers: z.record(z.string()).default({}),
  timeoutMs: z.number().int().positive().max(30000).default(12000)
});
const httpFetchOutputSchema = z.object({
  url: z.string().url(),
  status: z.number().int(),
  preview: z.string(),
  contentType: z.string().optional(),
  truncated: z.boolean().default(false),
  provenance: z.object({
    source: z.literal("remote-http"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED")
  }).optional()
});

const shellCommandInputSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string().min(1)).default(["echo", "pwd", "ls", "node"]),
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
  maxResults: z.number().int().positive().max(10).default(5),
  safeMode: z.boolean().default(true)
});
const webSearchOutputSchema = z.object({
  query: z.string().min(1),
  results: z.array(
    z.object({
      title: z.string().min(1),
      url: z.string().url(),
      snippet: z.string()
    })
  ),
  provenance: z.object({
    source: z.literal("web-search"),
    trustClassification: z.literal("EXTERNAL_UNTRUSTED"),
    searchEngineRef: z.string().optional()
  }).optional()
});

const memoryWriteInputSchema = z.object({
  namespace: z.string().min(1),
  note: z.string().min(1),
  noteType: z.enum(["fact", "summary", "instruction", "reference", "session-note"]).default("fact"),
  trustClassification: z.enum([
    "USER_OWNED",
    "EXTERNAL_UNTRUSTED",
    "CONTROL_TRUSTED",
    "MODEL_GENERATED_UNTRUSTED"
  ]),
  metadata: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([])
});
const memoryWriteOutputSchema = z.object({
  namespace: z.string().min(1),
  noteId: z.string().min(1),
  noteType: z.string(),
  persisted: z.boolean(),
  trustClassification: z.string(),
  createdAt: z.string().optional(),
  provenance: z.object({
    source: z.literal("memory-write-tool"),
    namespace: z.string()
  }).optional()
});

const approvalRequestInputSchema = z.object({
  intentId: z.string().min(1),
  summary: z.string().min(1),
  reason: z.string().min(1).optional(),
  urgency: z.enum(["low", "normal", "high"]).default("normal")
});
const approvalRequestOutputSchema = z.object({
  intentId: z.string().min(1),
  approvalRequestCreated: z.boolean(),
  approvalRequestId: z.string().min(1),
  state: z.enum(["pending", "approved", "rejected", "expired"]).default("pending"),
  createdAt: z.string().optional()
});

// ── Types ──────────────────────────────────────────────────────────────────────

export type CoreBuiltInToolId =
  | "tool.local-file-read"
  | "tool.http-fetch"
  | "tool.shell-command"
  | "tool.web-search"
  | "tool.memory-note-write"
  | "tool.approval-request";

export type BuiltInToolId =
  | CoreBuiltInToolId
  | RuntimeToolId
  | FilesystemToolId
  | SessionToolId
  | MemoryToolId
  | WebToolId
  | UiToolId
  | AutomationToolId
  | MessagingToolId
  | NodesToolId
  | AgentsToolId;

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface BuiltInToolSpec {
  manifest: ToolManifest;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  examples: ToolExample[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function prop(description: string, type: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type, description, ...extra };
}

function jsonSchemaObject(
  required: string[],
  properties: Record<string, unknown>,
  schemaDescription?: string
): Record<string, unknown> {
  return {
    type: "object",
    ...(schemaDescription ? { description: schemaDescription } : {}),
    required,
    properties,
    additionalProperties: false
  };
}

// ── Built-in tool specifications ───────────────────────────────────────────────

export const BUILTIN_TOOL_SPECS: Record<BuiltInToolId, BuiltInToolSpec> = {
  ...RUNTIME_TOOL_SPECS,
  ...FILESYSTEM_TOOL_SPECS,
  ...SESSION_TOOL_SPECS,
  ...MEMORY_TOOL_SPECS,
  ...WEB_TOOL_SPECS,
  ...UI_TOOL_SPECS,
  ...AUTOMATION_TOOL_SPECS,
  ...MESSAGING_TOOL_SPECS,
  ...NODES_TOOL_SPECS,
  ...AGENTS_TOOL_SPECS,

  // ── File Read Tool ─────────────────────────────────────────────────────────

  "tool.local-file-read": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.local-file-read",
      name: "Local File Read",
      version: "1.0.0",
      description:
        "Reads a local file within the sandboxed workspace and returns its content. " +
        "Access is strictly scoped to filesystem-zone paths allowed by policy. " +
        "Read-only: no modifications are possible through this tool. " +
        "File content is returned as untrusted output and must not be promoted to control-trusted status.",
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
      inputSchema: jsonSchemaObject(
        ["path"],
        {
          path: prop("Absolute or workspace-relative path to the file to read.", "string"),
          encoding: prop("Character encoding for the file content. Use base64 for binary files.", "string", {
            enum: ["utf8", "base64"],
            default: "utf8"
          }),
          maxBytes: prop("Maximum bytes to read. Defaults to the sandbox limit (~512 KB).", "number")
        },
        "Input for the Local File Read tool."
      ),
      outputSchema: jsonSchemaObject(
        ["path", "encoding", "content", "bytes", "truncated"],
        {
          path: prop("The path that was read.", "string"),
          encoding: prop("Encoding used to decode the content.", "string"),
          content: prop("File content as a string. External and untrusted.", "string"),
          bytes: prop("Number of bytes read before encoding.", "number"),
          truncated: prop("True if the file was larger than the read limit and content was truncated.", "boolean"),
          provenance: prop(
            "Provenance metadata indicating the content is from the local filesystem and is EXTERNAL_UNTRUSTED.",
            "object"
          )
        },
        "Output from the Local File Read tool."
      ),
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
      trustNotes: [
        "File content is treated as EXTERNAL_UNTRUSTED by default.",
        "Path traversal outside sandbox-allowed zones is blocked by the runtime.",
        "Read-only sandbox mode: no writes permitted through this tool."
      ],
      tags: ["filesystem", "read-only", "safe-default"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: fileReadInputSchema,
    outputSchema: fileReadOutputSchema,
    examples: [
      {
        description: "Read a UTF-8 text file and return its content",
        input: { path: "/workspace/notes/meeting.txt", encoding: "utf8" },
        output: {
          path: "/workspace/notes/meeting.txt",
          encoding: "utf8",
          content: "Meeting notes — 2026-04-27\n\nAction items:\n1. Review proposal\n2. Send follow-up",
          bytes: 72,
          truncated: false,
          provenance: { source: "filesystem", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      },
      {
        description: "Read a binary file as base64",
        input: { path: "/workspace/data/logo.png", encoding: "base64" },
        output: {
          path: "/workspace/data/logo.png",
          encoding: "base64",
          content: "iVBORw0KGgoAAAANSUhEUgAA...",
          bytes: 4096,
          truncated: false,
          provenance: { source: "filesystem", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      },
      {
        description: "Read a large file with a byte cap (truncated result)",
        input: { path: "/workspace/logs/app.log", encoding: "utf8", maxBytes: 2048 },
        output: {
          path: "/workspace/logs/app.log",
          encoding: "utf8",
          content: "[2026-04-27T10:00:00Z] INFO service started\n[2026-04-27T10:00:01Z] INFO...",
          bytes: 2048,
          truncated: true,
          provenance: { source: "filesystem", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      }
    ]
  },

  // ── HTTP Fetch Tool ────────────────────────────────────────────────────────

  "tool.http-fetch": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.http-fetch",
      name: "HTTP Fetch",
      version: "1.0.0",
      description:
        "Fetches content from a remote HTTP/HTTPS URL under egress-controlled runtime policy. " +
        "Network egress is restricted to the operator-configured allowlist. " +
        "Only GET requests are permitted. Response content is returned as untrusted external data. " +
        "Response bodies are truncated at the sandbox output limit for safety.",
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
      inputSchema: jsonSchemaObject(
        ["url"],
        {
          url: prop("Fully-qualified HTTPS or HTTP URL to fetch. Must match the egress allowlist.", "string"),
          method: prop("HTTP method. Only GET is permitted.", "string", { enum: ["GET"], default: "GET" }),
          headers: prop(
            "Additional request headers. Sensitive headers (Authorization, Cookie) are filtered by policy.",
            "object"
          ),
          timeoutMs: prop("Request timeout in milliseconds. Maximum 30 000 ms.", "number")
        },
        "Input for the HTTP Fetch tool."
      ),
      outputSchema: jsonSchemaObject(
        ["url", "status", "preview", "truncated"],
        {
          url: prop("The URL that was fetched.", "string"),
          status: prop("HTTP response status code.", "number"),
          preview: prop("First ~800 characters of the response body as plain text. External and untrusted.", "string"),
          contentType: prop("Content-Type header from the response, if present.", "string"),
          truncated: prop("True if the response body exceeded the sandbox output limit.", "boolean"),
          provenance: prop(
            "Provenance metadata indicating the content is from a remote HTTP source and is EXTERNAL_UNTRUSTED.",
            "object"
          )
        },
        "Output from the HTTP Fetch tool."
      ),
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
      trustNotes: [
        "Remote content is EXTERNAL_UNTRUSTED and must not be used to influence control-plane decisions.",
        "Egress is restricted to the operator-configured allowlist; blocked destinations fail with NETWORK_EGRESS_BLOCKED.",
        "Only GET requests allowed. POST or mutation methods are not supported."
      ],
      tags: ["network", "fetch", "external", "safe-default"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: httpFetchInputSchema,
    outputSchema: httpFetchOutputSchema,
    examples: [
      {
        description: "Fetch a JSON API endpoint",
        input: { url: "https://api.example.com/v1/status", method: "GET" },
        output: {
          url: "https://api.example.com/v1/status",
          status: 200,
          preview: '{"status":"ok","version":"1.4.2","uptime":98234}',
          contentType: "application/json",
          truncated: false,
          provenance: { source: "remote-http", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      },
      {
        description: "Fetch a web page (response truncated at sandbox limit)",
        input: { url: "https://example.com/report", method: "GET", timeoutMs: 10000 },
        output: {
          url: "https://example.com/report",
          status: 200,
          preview: "<!DOCTYPE html><html><head><title>Q1 Report</title></head><body><h1>Quarterly Summary</h1><p>Revenue grew 14% year-on-year...",
          contentType: "text/html; charset=utf-8",
          truncated: true,
          provenance: { source: "remote-http", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      },
      {
        description: "Fetch that returns a non-200 status",
        input: { url: "https://api.example.com/v1/missing-resource" },
        output: {
          url: "https://api.example.com/v1/missing-resource",
          status: 404,
          preview: '{"error":"not_found","message":"Resource does not exist"}',
          contentType: "application/json",
          truncated: false,
          provenance: { source: "remote-http", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      }
    ]
  },

  // ── Shell Command Tool ─────────────────────────────────────────────────────

  "tool.shell-command": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.shell-command",
      name: "Shell Command",
      version: "1.0.0",
      description:
        "Executes bounded shell commands within a no-network sandbox. " +
        "Only commands explicitly listed in the allowedCommands parameter are permitted. " +
        "Requires approval by default due to execution risk. " +
        "Operators must configure policy rules to enable this tool.",
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
      inputSchema: jsonSchemaObject(
        ["command"],
        {
          command: prop("The command to execute. Must be in allowedCommands.", "string"),
          args: prop("Positional arguments to pass to the command.", "array"),
          allowedCommands: prop(
            "Explicit allowlist of permitted commands. Defaults to [echo, pwd, ls, node]. Expand with care.",
            "array"
          ),
          timeoutMs: prop("Execution timeout in milliseconds. Maximum 120 000 ms.", "number")
        },
        "Input for the Shell Command tool."
      ),
      outputSchema: jsonSchemaObject(
        ["command", "args", "exitCode", "stdout", "stderr"],
        {
          command: prop("The command that was executed.", "string"),
          args: prop("Arguments passed to the command.", "array"),
          exitCode: prop("Exit code returned by the command process.", "number"),
          stdout: prop("Standard output captured from the command.", "string"),
          stderr: prop("Standard error captured from the command.", "string")
        },
        "Output from the Shell Command tool."
      ),
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
      trustNotes: [
        "High-risk execution surface. Approval is required by default.",
        "Command allowlist is enforced by the sandbox runtime.",
        "Network access is blocked in no_network_compute sandbox mode."
      ],
      tags: ["shell", "execute", "privileged", "approval-required"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: shellCommandInputSchema,
    outputSchema: shellCommandOutputSchema,
    examples: [
      {
        description: "List files in the current directory",
        input: { command: "ls", args: ["-la"], allowedCommands: ["ls"] },
        output: {
          command: "ls",
          args: ["-la"],
          exitCode: 0,
          stdout: "total 32\ndrwxr-xr-x  4 user user 4096 Apr 27 10:00 .\ndrwxr-xr-x 12 user user 4096 Apr 27 09:55 ..\n-rw-r--r--  1 user user 1234 Apr 27 10:00 README.md\n",
          stderr: ""
        }
      },
      {
        description: "Print working directory",
        input: { command: "pwd", args: [], allowedCommands: ["pwd"] },
        output: {
          command: "pwd",
          args: [],
          exitCode: 0,
          stdout: "/tmp/manasvi-runs/run:abc123/scratch\n",
          stderr: ""
        }
      },
      {
        description: "Command not in allowlist — blocked by sandbox",
        input: { command: "curl", args: ["https://example.com"], allowedCommands: ["ls", "pwd"] },
        output: {
          command: "curl",
          args: ["https://example.com"],
          exitCode: 1,
          stdout: "",
          stderr: "COMMAND_NOT_ALLOWED:curl"
        }
      }
    ]
  },

  // ── Web Search Tool ────────────────────────────────────────────────────────

  "tool.web-search": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.web-search",
      name: "Web Search",
      version: "1.0.0",
      description:
        "Performs a governed web search and returns structured results with provenance. " +
        "Results are clearly marked as EXTERNAL_UNTRUSTED. " +
        "The operator configures which search adapter is used. " +
        "Supports optional safe mode to filter explicit content.",
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
          query: prop("Natural language search query.", "string"),
          maxResults: prop("Maximum number of search results to return. Between 1 and 10.", "number"),
          safeMode: prop("Enable safe search filtering. Default true.", "boolean")
        },
        "Input for the Web Search tool."
      ),
      outputSchema: jsonSchemaObject(
        ["query", "results"],
        {
          query: prop("The search query that was executed.", "string"),
          results: prop(
            "Structured search result list. Each result has title, url, and snippet. Content is EXTERNAL_UNTRUSTED.",
            "array"
          ),
          provenance: prop(
            "Provenance metadata indicating results are from a web search engine and are EXTERNAL_UNTRUSTED.",
            "object"
          )
        },
        "Output from the Web Search tool."
      ),
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
      trustNotes: [
        "Search results are EXTERNAL_UNTRUSTED. Do not act on them without operator review.",
        "Egress is restricted to the operator allowlist; blocked destinations fail safely.",
        "No credentials or private data are sent to the search engine."
      ],
      tags: ["search", "network", "external", "safe-default"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: webSearchInputSchema,
    outputSchema: webSearchOutputSchema,
    examples: [
      {
        description: "Search for a factual topic",
        input: { query: "TypeScript 5.5 new features", maxResults: 3 },
        output: {
          query: "TypeScript 5.5 new features",
          results: [
            {
              title: "TypeScript 5.5 Release Notes",
              url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/",
              snippet: "TypeScript 5.5 introduces inferred type predicates, control flow narrowing for constant indexed accesses, and JSDoc @import tags..."
            },
            {
              title: "What's new in TypeScript 5.5",
              url: "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html",
              snippet: "This release focuses on type inference improvements and developer experience enhancements..."
            },
            {
              title: "TypeScript 5.5 Beta",
              url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-5-beta/",
              snippet: "The TypeScript 5.5 beta brings performance improvements and several new strictness options..."
            }
          ],
          provenance: { source: "web-search", trustClassification: "EXTERNAL_UNTRUSTED", searchEngineRef: "duckduckgo-instant-answer" }
        }
      },
      {
        description: "Search returns a single strong match (abstract result)",
        input: { query: "capital of France", maxResults: 5 },
        output: {
          query: "capital of France",
          results: [
            {
              title: "Paris",
              url: "https://en.wikipedia.org/wiki/Paris",
              snippet: "Paris is the capital and most populous city of France, with an official estimated population of 2,102,650 residents as of 2023."
            }
          ],
          provenance: { source: "web-search", trustClassification: "EXTERNAL_UNTRUSTED", searchEngineRef: "duckduckgo-instant-answer" }
        }
      },
      {
        description: "Search with safe mode enabled (default)",
        input: { query: "machine learning fundamentals", maxResults: 2, safeMode: true },
        output: {
          query: "machine learning fundamentals",
          results: [
            {
              title: "Machine Learning",
              url: "https://en.wikipedia.org/wiki/Machine_learning",
              snippet: "Machine learning (ML) is a subset of artificial intelligence focused on building systems that learn from data to improve their performance over time."
            },
            {
              title: "Introduction to Machine Learning",
              url: "https://developers.google.com/machine-learning/intro-to-ml",
              snippet: "Machine learning gives computers the ability to learn without being explicitly programmed..."
            }
          ],
          provenance: { source: "web-search", trustClassification: "EXTERNAL_UNTRUSTED" }
        }
      }
    ]
  },

  // ── Memory Note Write Tool ─────────────────────────────────────────────────

  "tool.memory-note-write": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.memory-note-write",
      name: "Note Write",
      version: "1.0.0",
      description:
        "Writes a note or memory entry into a policy-governed memory namespace. " +
        "Preserves the caller-provided trust classification and provenance. " +
        "Will not silently upgrade trust: a note written with EXTERNAL_UNTRUSTED stays EXTERNAL_UNTRUSTED. " +
        "Namespace isolation ensures notes do not cross tenant/workspace boundaries.",
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
      inputSchema: jsonSchemaObject(
        ["namespace", "note", "trustClassification"],
        {
          namespace: prop(
            "Target memory namespace. Must be within the caller's tenant/workspace scope.",
            "string"
          ),
          note: prop("Note content as a UTF-8 string.", "string"),
          noteType: prop(
            "Semantic type of the note: fact, summary, instruction, reference, or session-note.",
            "string",
            { enum: ["fact", "summary", "instruction", "reference", "session-note"] }
          ),
          trustClassification: prop(
            "Trust class for this note. Must not be higher than what the caller is authorised to write. " +
            "CONTROL_TRUSTED requires explicit operator policy.",
            "string",
            { enum: ["USER_OWNED", "EXTERNAL_UNTRUSTED", "CONTROL_TRUSTED", "MODEL_GENERATED_UNTRUSTED"] }
          ),
          metadata: prop("Arbitrary key/value metadata attached to the note record.", "object"),
          tags: prop("String tags for filtering and retrieval.", "array")
        },
        "Input for the Note Write tool."
      ),
      outputSchema: jsonSchemaObject(
        ["namespace", "noteId", "persisted", "trustClassification"],
        {
          namespace: prop("The namespace the note was written into.", "string"),
          noteId: prop("Unique identifier of the created note record.", "string"),
          noteType: prop("The note type as persisted.", "string"),
          persisted: prop("True if the note was successfully written to the memory store.", "boolean"),
          trustClassification: prop("Trust class assigned to the persisted note.", "string"),
          createdAt: prop("ISO-8601 timestamp when the note was created.", "string"),
          provenance: prop("Provenance metadata for the persisted note.", "object")
        },
        "Output from the Note Write tool."
      ),
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
      trustNotes: [
        "Trust classification is preserved as supplied by the caller; no silent upgrade.",
        "CONTROL_TRUSTED writes require explicit policy allowance.",
        "Namespace scoping prevents cross-tenant or cross-workspace contamination."
      ],
      tags: ["memory", "write", "notes"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: memoryWriteInputSchema,
    outputSchema: memoryWriteOutputSchema,
    examples: [
      {
        description: "Save a user-confirmed fact to the notes namespace",
        input: {
          namespace: "tenant-local/workspace-local/notes/user-alice",
          note: "Project deadline is March 15th. Confirmed by Alice in the 2026-04-27 meeting.",
          noteType: "fact",
          trustClassification: "USER_OWNED",
          tags: ["deadline", "project"]
        },
        output: {
          namespace: "tenant-local/workspace-local/notes/user-alice",
          noteId: "note:1k3xab",
          noteType: "fact",
          persisted: true,
          trustClassification: "USER_OWNED",
          createdAt: "2026-04-27T12:34:56.789Z",
          provenance: { source: "memory-write-tool", namespace: "tenant-local/workspace-local/notes/user-alice" }
        }
      },
      {
        description: "Save an AI-generated summary with untrusted classification",
        input: {
          namespace: "tenant-local/workspace-local/summaries/session-abc",
          note: "The user asked about TypeScript 5.5. Key topics discussed: inferred type predicates, JSDoc imports.",
          noteType: "summary",
          trustClassification: "MODEL_GENERATED_UNTRUSTED",
          tags: ["typescript", "session-summary"]
        },
        output: {
          namespace: "tenant-local/workspace-local/summaries/session-abc",
          noteId: "note:2m7ycd",
          noteType: "summary",
          persisted: true,
          trustClassification: "MODEL_GENERATED_UNTRUSTED",
          createdAt: "2026-04-27T12:35:10.000Z",
          provenance: { source: "memory-write-tool", namespace: "tenant-local/workspace-local/summaries/session-abc" }
        }
      },
      {
        description: "Save a reference to an external source with EXTERNAL_UNTRUSTED",
        input: {
          namespace: "tenant-local/workspace-local/references",
          note: "TypeScript 5.5 release blog: https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/",
          noteType: "reference",
          trustClassification: "EXTERNAL_UNTRUSTED",
          metadata: { sourceUrl: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-5/" },
          tags: ["typescript", "link"]
        },
        output: {
          namespace: "tenant-local/workspace-local/references",
          noteId: "note:3p9zef",
          noteType: "reference",
          persisted: true,
          trustClassification: "EXTERNAL_UNTRUSTED",
          createdAt: "2026-04-27T12:36:00.000Z",
          provenance: { source: "memory-write-tool", namespace: "tenant-local/workspace-local/references" }
        }
      }
    ]
  },

  // ── Approval Request Tool ──────────────────────────────────────────────────

  "tool.approval-request": {
    manifest: toolManifestSchema.parse({
      schemaVersion: "1.0",
      contractVersion: "1.0.0",
      toolId: "tool.approval-request",
      name: "Approval Request",
      version: "1.0.0",
      description:
        "Creates a cryptographically-bound approval request for a specific execution intent. " +
        "Routes the request to a human reviewer through the approval service. " +
        "The approval artifact, once issued, is required for execution of the pending intent. " +
        "Approval state (pending/approved/rejected/expired) is visible in the admin dashboard. " +
        "This tool is a first-class product expression of Manasvi's human-in-the-loop governance.",
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
      inputSchema: jsonSchemaObject(
        ["intentId", "summary"],
        {
          intentId: prop(
            "The execution intent ID that requires approval. Must match an active intent in the orchestrator.",
            "string"
          ),
          summary: prop(
            "Human-readable summary of what will happen if this intent is approved. " +
            "Shown verbatim to the reviewer.",
            "string"
          ),
          reason: prop(
            "Optional additional context explaining why this action requires approval.",
            "string"
          ),
          urgency: prop(
            "Urgency hint for the reviewer queue: low, normal, or high.",
            "string",
            { enum: ["low", "normal", "high"] }
          )
        },
        "Input for the Approval Request tool."
      ),
      outputSchema: jsonSchemaObject(
        ["intentId", "approvalRequestCreated", "approvalRequestId", "state"],
        {
          intentId: prop("The intent ID the approval request is bound to.", "string"),
          approvalRequestCreated: prop("True if the approval request was successfully created.", "boolean"),
          approvalRequestId: prop("Unique identifier of the created approval request.", "string"),
          state: prop(
            "Current approval state: pending (awaiting review), approved, rejected, or expired.",
            "string",
            { enum: ["pending", "approved", "rejected", "expired"] }
          ),
          createdAt: prop("ISO-8601 timestamp when the approval request was created.", "string")
        },
        "Output from the Approval Request tool."
      ),
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
      trustNotes: [
        "Approval artifacts are cryptographically signed and bound to the specific intent payload hash.",
        "A rejected or expired approval does not allow execution to proceed.",
        "Approval requests are visible in the admin dashboard and audit trail."
      ],
      tags: ["approval", "workflow", "governance"],
      status: "enabled",
      createdAt: now(),
      updatedAt: now()
    }),
    inputSchema: approvalRequestInputSchema,
    outputSchema: approvalRequestOutputSchema,
    examples: [
      {
        description: "Request approval before executing a shell command",
        input: {
          intentId: "intent:del456abc",
          summary: "Execute shell command: rm -rf /tmp/session-data (remove temp files for session session-abc)",
          reason: "User requested cleanup of temporary session files",
          urgency: "normal"
        },
        output: {
          intentId: "intent:del456abc",
          approvalRequestCreated: true,
          approvalRequestId: "approval:req789xyz",
          state: "pending",
          createdAt: "2026-04-27T12:40:00.000Z"
        }
      },
      {
        description: "Request urgent approval for a network action",
        input: {
          intentId: "intent:net123def",
          summary: "Fetch remote endpoint https://internal.corp/api/config and return its contents",
          reason: "Agent needs current config to complete the task; URL is on the internal network",
          urgency: "high"
        },
        output: {
          intentId: "intent:net123def",
          approvalRequestCreated: true,
          approvalRequestId: "approval:req456uvw",
          state: "pending",
          createdAt: "2026-04-27T12:41:30.000Z"
        }
      },
      {
        description: "Approval already decided — shows approved state",
        input: {
          intentId: "intent:write789ghi",
          summary: "Write CONTROL_TRUSTED note to system namespace memory:system/config",
          urgency: "low"
        },
        output: {
          intentId: "intent:write789ghi",
          approvalRequestCreated: true,
          approvalRequestId: "approval:req012rst",
          state: "approved",
          createdAt: "2026-04-27T12:38:00.000Z"
        }
      }
    ]
  }
};

// ── Derived exports ────────────────────────────────────────────────────────────

export const BUILTIN_TOOL_MANIFESTS: ToolManifest[] = Object.values(BUILTIN_TOOL_SPECS).map((s) => s.manifest);

export function getBuiltInToolSpec(toolId: string): BuiltInToolSpec | undefined {
  return Object.values(BUILTIN_TOOL_SPECS).find((tool) => tool.manifest.toolId === toolId);
}

export function getBuiltInToolExamples(toolId: string): ToolExample[] {
  return getBuiltInToolSpec(toolId)?.examples ?? [];
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
