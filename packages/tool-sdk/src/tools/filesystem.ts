import { z } from "zod";
import { now, prop, jsonSchemaObject, parseManifest, type BuiltInToolSpec } from "./helpers.js";

// ── file-write ─────────────────────────────────────────────────────────────────

const fileWriteInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  overwrite: z.boolean().default(false),
  createDirectories: z.boolean().default(false)
});

const fileWriteOutputSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().int().nonnegative(),
  overwritten: z.boolean(),
  createdAt: z.string()
});

const fileWriteSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.file-write",
    name: "File Write",
    version: "1.0.0",
    description:
      "Creates or overwrites a file within the operator-configured filesystem write zone. " +
      "Path traversal outside the workspace write zone is rejected by the runtime. " +
      "Overwrite must be explicitly set to true; safe-write (create-only) is the default. " +
      "All writes are recorded in the audit trail.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "write",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "filesystem.write",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["path", "content"],
      {
        path: prop("Workspace-relative or absolute path within the write zone.", "string"),
        content: prop("File content as a string. Use encoding=base64 for binary.", "string"),
        encoding: prop("Content encoding: utf8 or base64.", "string", { enum: ["utf8", "base64"], default: "utf8" }),
        overwrite: prop("Allow overwriting an existing file. Default false (safe-write mode).", "boolean"),
        createDirectories: prop("Create parent directories if they do not exist.", "boolean")
      },
      "Input for the File Write tool."
    ),
    outputSchema: jsonSchemaObject(
      ["path", "bytesWritten", "overwritten", "createdAt"],
      {
        path: prop("The path that was written.", "string"),
        bytesWritten: prop("Number of bytes written.", "number"),
        overwritten: prop("True if an existing file was replaced.", "boolean"),
        createdAt: prop("ISO-8601 timestamp of the write operation.", "string")
      },
      "Output from the File Write tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:file-write", operation: "file_write" },
    policyBinding: {
      policyActionClass: "access-filesystem",
      resource: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace-write" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "Write zone is bounded by operator-configured policy.",
      "Path traversal outside the write zone is blocked at the runtime boundary.",
      "Overwrite=false is the safe default — prevents accidental file destruction."
    ],
    tags: ["filesystem", "write", "mutating"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: fileWriteInputSchema,
  outputSchema: fileWriteOutputSchema,
  examples: [
    {
      description: "Create a new text file",
      input: { path: "/workspace/output/report.txt", content: "Analysis complete.\nTotal records: 142.\n", encoding: "utf8" },
      output: { path: "/workspace/output/report.txt", bytesWritten: 38, overwritten: false, createdAt: "2026-05-04T00:00:00.000Z" }
    },
    {
      description: "Overwrite an existing JSON config",
      input: { path: "/workspace/config/settings.json", content: '{"debug":true,"level":"info"}', encoding: "utf8", overwrite: true },
      output: { path: "/workspace/config/settings.json", bytesWritten: 28, overwritten: true, createdAt: "2026-05-04T00:01:00.000Z" }
    }
  ]
};

// ── file-edit ──────────────────────────────────────────────────────────────────

const fileEditInputSchema = z.object({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
  replaceAll: z.boolean().default(false)
});

const fileEditOutputSchema = z.object({
  path: z.string(),
  replacements: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative(),
  updatedAt: z.string()
});

const fileEditSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.file-edit",
    name: "File Edit",
    version: "1.0.0",
    description:
      "Performs a targeted string replacement in an existing file. " +
      "oldString must match exactly once (unless replaceAll is true). " +
      "Fails if the file does not exist or the string is not found. " +
      "Scoped to the operator-configured write zone. All edits are audited.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "write",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "filesystem.write",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["path", "oldString", "newString"],
      {
        path: prop("Path to the file to edit. Must be within the write zone.", "string"),
        oldString: prop("Exact string to find and replace. Must be unique in the file unless replaceAll is true.", "string"),
        newString: prop("Replacement string. Can be empty to delete the match.", "string"),
        replaceAll: prop("Replace every occurrence of oldString. Default false.", "boolean")
      },
      "Input for the File Edit tool."
    ),
    outputSchema: jsonSchemaObject(
      ["path", "replacements", "bytesWritten", "updatedAt"],
      {
        path: prop("The file that was edited.", "string"),
        replacements: prop("Number of replacements made.", "number"),
        bytesWritten: prop("Total bytes in the updated file.", "number"),
        updatedAt: prop("ISO-8601 timestamp of the edit.", "string")
      },
      "Output from the File Edit tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 10000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "scratch_write",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: false
    },
    runtimeBinding: { toolRef: "tool:file-edit", operation: "file_edit" },
    policyBinding: {
      policyActionClass: "access-filesystem",
      resource: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace-write" },
      requiresExplicitPolicy: true,
      approvalHint: "may_require"
    },
    trustNotes: [
      "oldString must be unique in the file by default — prevents unintended bulk replacements.",
      "Operates only on files within the write zone.",
      "Edit is atomic: file is written as a whole after the replacement."
    ],
    tags: ["filesystem", "write", "edit", "mutating"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: fileEditInputSchema,
  outputSchema: fileEditOutputSchema,
  examples: [
    {
      description: "Replace a specific line in a config file",
      input: { path: "/workspace/config/app.conf", oldString: "debug=false", newString: "debug=true" },
      output: { path: "/workspace/config/app.conf", replacements: 1, bytesWritten: 512, updatedAt: "2026-05-04T00:02:00.000Z" }
    }
  ]
};

// ── file-apply-patch ───────────────────────────────────────────────────────────

const fileApplyPatchInputSchema = z.object({
  patch: z.string().min(1),
  baseDir: z.string().default("/workspace"),
  dryRun: z.boolean().default(false)
});

const fileApplyPatchOutputSchema = z.object({
  baseDir: z.string(),
  filesPatched: z.array(z.string()),
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
  dryRun: z.boolean(),
  success: z.boolean(),
  rejectFile: z.string().optional()
});

const fileApplyPatchSpec: BuiltInToolSpec = {
  manifest: parseManifest({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    toolId: "tool.file-apply-patch",
    name: "File Apply Patch",
    version: "1.0.0",
    description:
      "Applies a unified-diff patch to one or more files within the workspace write zone. " +
      "Supports dry-run mode to preview changes before committing. " +
      "Approval-sensitive: a patch can make sweeping changes across multiple files. " +
      "All patched files are within the operator-configured write zone.",
    owner: "manasvi-platform",
    provider: "manasvi-core",
    type: "built_in",
    actionClass: "write",
    sideEffectClass: "mutating",
    mutability: "mutating",
    capabilities: [
      {
        capabilityId: "filesystem.write",
        required: true,
        scope: { tenantScoped: true, workspaceScoped: true, resourceClass: "filesystem-zone" },
        constraints: {}
      }
    ],
    resourceClassesTouched: ["filesystem-zone"],
    inputSchema: jsonSchemaObject(
      ["patch"],
      {
        patch: prop("Unified-diff patch text (git diff / patch -p1 format).", "string"),
        baseDir: prop("Base directory for resolving patch paths. Default /workspace.", "string"),
        dryRun: prop("Preview changes without writing to disk. Default false.", "boolean")
      },
      "Input for the File Apply Patch tool."
    ),
    outputSchema: jsonSchemaObject(
      ["baseDir", "filesPatched", "linesAdded", "linesRemoved", "dryRun", "success"],
      {
        baseDir: prop("Base directory used.", "string"),
        filesPatched: prop("List of file paths that were (or would be, in dryRun) modified.", "array"),
        linesAdded: prop("Total lines added.", "number"),
        linesRemoved: prop("Total lines removed.", "number"),
        dryRun: prop("True if this was a dry-run (no files modified).", "boolean"),
        success: prop("True if the patch applied cleanly.", "boolean"),
        rejectFile: prop("Path to the .rej file if some hunks failed to apply.", "string")
      },
      "Output from the File Apply Patch tool."
    ),
    runtimeHints: {
      defaultTimeoutMs: 15000,
      defaultSandboxMode: "no_network_compute",
      egressProfiles: [],
      filesystemProfile: "privileged_bounded",
      declaredSecretRefs: [],
      requireExecutorPath: true,
      approvalSensitive: true
    },
    runtimeBinding: { toolRef: "tool:file-apply-patch", operation: "file_apply_patch" },
    policyBinding: {
      policyActionClass: "access-filesystem",
      resource: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace-write" },
      requiresExplicitPolicy: true,
      approvalHint: "must_require"
    },
    trustNotes: [
      "Approval required: a patch can modify multiple files simultaneously.",
      "dryRun=true is recommended for reviewing changes before commitment.",
      "All target paths must resolve within the write zone."
    ],
    tags: ["filesystem", "write", "patch", "mutating", "approval-required"],
    status: "enabled",
    createdAt: now(),
    updatedAt: now()
  }),
  inputSchema: fileApplyPatchInputSchema,
  outputSchema: fileApplyPatchOutputSchema,
  examples: [
    {
      description: "Apply a bug-fix patch in dry-run mode",
      input: { patch: "--- a/src/handler.ts\n+++ b/src/handler.ts\n@@ -10,7 +10,7 @@\n-  return null;\n+  return undefined;\n", dryRun: true },
      output: { baseDir: "/workspace", filesPatched: ["src/handler.ts"], linesAdded: 1, linesRemoved: 1, dryRun: true, success: true }
    },
    {
      description: "Apply a patch for real",
      input: { patch: "--- a/src/handler.ts\n+++ b/src/handler.ts\n@@ -10,7 +10,7 @@\n-  return null;\n+  return undefined;\n", dryRun: false },
      output: { baseDir: "/workspace", filesPatched: ["src/handler.ts"], linesAdded: 1, linesRemoved: 1, dryRun: false, success: true }
    }
  ]
};

// ── exports ────────────────────────────────────────────────────────────────────

export const FILESYSTEM_TOOL_SPECS = {
  "tool.file-write": fileWriteSpec,
  "tool.file-edit": fileEditSpec,
  "tool.file-apply-patch": fileApplyPatchSpec
} as const;

export type FilesystemToolId = keyof typeof FILESYSTEM_TOOL_SPECS;
