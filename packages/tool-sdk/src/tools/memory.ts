import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── memory-search ──────────────────────────────────────────────────────────────

const memorySearchInputSchema = z.object({
  namespace: z.string().min(1),
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(50).default(10),
  trustFilter: z.array(
    z.enum(["USER_OWNED", "EXTERNAL_UNTRUSTED", "CONTROL_TRUSTED", "MODEL_GENERATED_UNTRUSTED"])
  ).default([]),
  noteTypeFilter: z.array(
    z.enum(["fact", "summary", "instruction", "reference", "session-note"])
  ).default([]),
  tags: z.array(z.string()).default([])
});

const memorySearchOutputSchema = z.object({
  namespace: z.string(),
  query: z.string(),
  results: z.array(
    z.object({
      noteId: z.string(),
      note: z.string(),
      noteType: z.string(),
      trustClassification: z.string(),
      tags: z.array(z.string()),
      createdAt: z.string(),
      score: z.number().optional()
    })
  ),
  total: z.number().int().nonnegative(),
  truncated: z.boolean().default(false)
});

const memorySearchSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.memory-search",
    name: "Memory Search",
    version: "1.0.0",
    description:
      "Searches a governed memory namespace for notes matching the query. " +
      "Trust classification of each result is preserved and returned with the record. " +
      "Results never mix trust levels without labeling — EXTERNAL_UNTRUSTED and CONTROL_TRUSTED records " +
      "are both visible but individually labeled. " +
      "Namespace is scoped to the caller's tenant/workspace.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "read-memory",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "memory.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "memory-namespace" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["memory-namespace"],
    inputSchema: jsonSchemaObject(
      ["namespace", "query"],
      {
        namespace: prop("Memory namespace to search. Must be within the caller's tenant/workspace scope.", "string"),
        query: prop("Natural language or keyword search query.", "string"),
        maxResults: prop("Maximum results to return. Max 50.", "number"),
        trustFilter: prop("Optionally limit results to specific trust classifications.", "array"),
        noteTypeFilter: prop("Optionally limit results to specific note types.", "array"),
        tags: prop("Optionally filter results by tags.", "array")
      },
      "Input for the Memory Search tool."
    ),
    outputSchema: jsonSchemaObject(
      ["namespace", "query", "results", "total", "truncated"],
      {
        namespace: prop("The namespace that was searched.", "string"),
        query: prop("The search query.", "string"),
        results: prop("Matching memory records with trust classification preserved.", "array"),
        total: prop("Total matching records (before limit).", "number"),
        truncated: prop("True if results were capped at maxResults.", "boolean")
      },
      "Output from the Memory Search tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 8000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:memory-search", operation: "memory_search" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "memory-namespace", resourceId: "memory:search" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Trust classification is preserved per-record. Never silently mixed or promoted.",
      "CONTROL_TRUSTED results must not be treated as user-editable.",
      "Namespace isolation prevents cross-tenant or cross-workspace leakage."
    ],
    tags: ["memory", "search", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: memorySearchInputSchema,
  outputSchema: memorySearchOutputSchema,
  examples: [
    {
      description: "Search for notes about a project deadline",
      input: { namespace: "tenant-local/workspace-local/notes/user-alice", query: "project deadline" },
      output: {
        namespace: "tenant-local/workspace-local/notes/user-alice",
        query: "project deadline",
        results: [
          { noteId: "note:1k3xab", note: "Project deadline is March 15th. Confirmed by Alice.", noteType: "fact", trustClassification: "USER_OWNED", tags: ["deadline", "project"], createdAt: "2026-04-27T12:34:56.789Z", score: 0.92 }
        ],
        total: 1,
        truncated: false
      }
    }
  ]
};

// ── memory-get ─────────────────────────────────────────────────────────────────

const memoryGetInputSchema = z.object({
  namespace: z.string().min(1),
  noteId: z.string().min(1)
});

const memoryGetOutputSchema = z.object({
  noteId: z.string(),
  namespace: z.string(),
  note: z.string(),
  noteType: z.string(),
  trustClassification: z.string(),
  metadata: z.record(z.unknown()),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  provenance: z.object({
    source: z.string(),
    namespace: z.string(),
    trustClassification: z.string()
  }).optional()
});

const memoryGetSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.memory-get",
    name: "Memory Get",
    version: "1.0.0",
    description:
      "Retrieves a specific memory record by note ID from a governed namespace. " +
      "The full record is returned including trust classification and provenance labels. " +
      "Trust is never silently promoted — EXTERNAL_UNTRUSTED content remains labeled as such. " +
      "Namespace scoping enforced: the namespace must be within the caller's tenant/workspace scope.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "read-memory",
    sideEffectClass: "read_only",
    mutability: "read_only",
    capabilities: [
      {
        capabilityId: "memory.read",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "memory-namespace" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["memory-namespace"],
    inputSchema: jsonSchemaObject(
      ["namespace", "noteId"],
      {
        namespace: prop("Memory namespace containing the note.", "string"),
        noteId: prop("Unique note ID to retrieve.", "string")
      },
      "Input for the Memory Get tool."
    ),
    outputSchema: jsonSchemaObject(
      ["noteId", "namespace", "note", "noteType", "trustClassification", "metadata", "tags", "createdAt"],
      {
        noteId: prop("The note ID retrieved.", "string"),
        namespace: prop("The namespace the note is stored in.", "string"),
        note: prop("Note content.", "string"),
        noteType: prop("Semantic type of the note.", "string"),
        trustClassification: prop("Trust class of the note. Preserved as written.", "string"),
        metadata: prop("Metadata attached to the note.", "object"),
        tags: prop("Tags attached to the note.", "array"),
        createdAt: prop("Creation timestamp.", "string"),
        updatedAt: prop("Last update timestamp, if applicable.", "string"),
        provenance: prop("Provenance record showing source and trust label.", "object")
      },
      "Output from the Memory Get tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 5000,
      defaultSandboxMode: "read_only_local",
      egressProfiles: [],
      filesystemProfile: "none",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:memory-get", operation: "memory_get" },
    policyBinding: {
      policyActionClass: "read",
      resource: { resourceClass: "memory-namespace", resourceId: "memory:get" },
      requiresExplicitPolicy: true,
      approvalHint: "none"
    },
    trustNotes: [
      "Trust classification is returned as-written. No silent promotion.",
      "CONTROL_TRUSTED notes require the caller to have read-control-memory policy.",
      "Out-of-namespace access is blocked at the runtime boundary."
    ],
    tags: ["memory", "get", "read-only", "safe-default"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: memoryGetInputSchema,
  outputSchema: memoryGetOutputSchema,
  examples: [
    {
      description: "Retrieve a specific fact note by ID",
      input: { namespace: "tenant-local/workspace-local/notes/user-alice", noteId: "note:1k3xab" },
      output: {
        noteId: "note:1k3xab",
        namespace: "tenant-local/workspace-local/notes/user-alice",
        note: "Project deadline is March 15th. Confirmed by Alice.",
        noteType: "fact",
        trustClassification: "USER_OWNED",
        metadata: {},
        tags: ["deadline", "project"],
        createdAt: "2026-04-27T12:34:56.789Z",
        provenance: { source: "memory-write-tool", namespace: "tenant-local/workspace-local/notes/user-alice", trustClassification: "USER_OWNED" }
      }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const MEMORY_TOOL_SPECS = {
  "tool.memory-search": memorySearchSpec,
  "tool.memory-get": memoryGetSpec
} as const;

export type MemoryToolId = keyof typeof MEMORY_TOOL_SPECS;
