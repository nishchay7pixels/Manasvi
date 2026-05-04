/**
 * FS1 filesystem tool spec tests.
 *
 * Covers:
 * - All four FS1 tool manifests validate against the contract schema
 * - Tool IDs are correct
 * - All FS1 tools are read_only with sideEffectClass read_only
 * - All FS1 tools are not approval-sensitive
 * - All FS1 tools have the filesystem.read capability
 * - Write tools (file-write, file-edit, file-apply-patch) are present in registry
 * - FS1_SAFE_READ_SET contains only FS1 read tools
 * - Input/output schemas accept valid payloads
 * - Input schemas reject invalid payloads
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateToolManifest } from "../index.js";
import { FILESYSTEM_TOOL_SPECS } from "./filesystem.js";
import { FS1_SAFE_READ_SET } from "../default-sets.js";

const FS1_TOOL_IDS = [
  "tool.fs-read-file",
  "tool.fs-list-directory",
  "tool.fs-stat",
  "tool.fs-search-files"
] as const;

const WRITE_TOOL_IDS = [
  "tool.file-write",
  "tool.file-edit",
  "tool.file-apply-patch"
] as const;

const FS2_WRITE_TOOL_IDS = [
  "tool.fs-write-file",
  "tool.fs-append-file",
  "tool.fs-apply-patch",
  "tool.fs-rename-file"
] as const;

// ── Manifest validation ───────────────────────────────────────────────────────

test("all filesystem tool manifests validate against schema", () => {
  for (const [toolId, spec] of Object.entries(FILESYSTEM_TOOL_SPECS)) {
    const parsed = validateToolManifest(spec.manifest);
    assert.equal(parsed.toolId, toolId, `toolId mismatch for ${toolId}`);
  }
});

test("FS1 tool IDs are present in FILESYSTEM_TOOL_SPECS", () => {
  for (const toolId of FS1_TOOL_IDS) {
    assert.ok(toolId in FILESYSTEM_TOOL_SPECS, `Missing FS1 tool: ${toolId}`);
  }
});

test("write tool IDs are present in FILESYSTEM_TOOL_SPECS", () => {
  for (const toolId of WRITE_TOOL_IDS) {
    assert.ok(toolId in FILESYSTEM_TOOL_SPECS, `Missing write tool: ${toolId}`);
  }
});

test("FS2 write tool IDs are present in FILESYSTEM_TOOL_SPECS", () => {
  for (const toolId of FS2_WRITE_TOOL_IDS) {
    assert.ok(toolId in FILESYSTEM_TOOL_SPECS, `Missing FS2 write tool: ${toolId}`);
  }
});

// ── FS1 safety properties ─────────────────────────────────────────────────────

test("all FS1 tools are read_only mutability", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.mutability,
      "read_only",
      `${toolId} must be read_only mutability`
    );
  }
});

test("all FS1 tools have sideEffectClass read_only", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.sideEffectClass,
      "read_only",
      `${toolId} must have sideEffectClass read_only`
    );
  }
});

test("all FS1 tools are not approval-sensitive", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.runtimeHints.approvalSensitive,
      false,
      `${toolId} must not be approvalSensitive`
    );
  }
});

test("all FS1 tools have approvalHint none", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.policyBinding.approvalHint,
      "none",
      `${toolId} must have approvalHint none`
    );
  }
});

test("all FS1 tools require filesystem.read capability", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    const cap = spec.manifest.capabilities.find((c) => c.capabilityId === "filesystem.read");
    assert.ok(cap, `${toolId} must require filesystem.read capability`);
    assert.equal(cap.required, true, `${toolId}: filesystem.read must be required`);
  }
});

test("all FS1 tools have actionClass read", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.actionClass,
      "read",
      `${toolId} must have actionClass read`
    );
  }
});

test("all FS1 tools target filesystem:workspace resource", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.policyBinding.resource.resourceId,
      "filesystem:workspace",
      `${toolId} must target filesystem:workspace`
    );
  }
});

test("all FS1 tools are tagged fs1", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.ok(
      spec.manifest.tags.includes("fs1"),
      `${toolId} must include fs1 tag`
    );
  }
});

test("all FS1 tools have read_only_local sandbox mode", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.runtimeHints.defaultSandboxMode,
      "read_only_local",
      `${toolId} must use read_only_local sandbox mode`
    );
  }
});

// ── Write tool safety properties ──────────────────────────────────────────────

test("write tools are mutating (not read_only)", () => {
  for (const toolId of [...WRITE_TOOL_IDS, ...FS2_WRITE_TOOL_IDS]) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(
      spec.manifest.mutability,
      "mutating",
      `${toolId} must be mutating`
    );
  }
});

test("FS2 write tools are approval-sensitive and must_require", () => {
  for (const toolId of FS2_WRITE_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.equal(spec.manifest.runtimeHints.approvalSensitive, true, `${toolId} must be approvalSensitive`);
    assert.equal(spec.manifest.policyBinding.approvalHint, "must_require", `${toolId} must have must_require approvalHint`);
    assert.equal(spec.manifest.actionClass, "write", `${toolId} must be actionClass write`);
  }
});

// ── FS1_SAFE_READ_SET ─────────────────────────────────────────────────────────

test("FS1_SAFE_READ_SET contains exactly the four FS1 read tools", () => {
  const setIds = new Set(FS1_SAFE_READ_SET.toolIds);
  for (const toolId of FS1_TOOL_IDS) {
    assert.ok(setIds.has(toolId), `FS1_SAFE_READ_SET must include ${toolId}`);
  }
  for (const toolId of WRITE_TOOL_IDS) {
    assert.ok(!setIds.has(toolId), `FS1_SAFE_READ_SET must not include ${toolId}`);
  }
});

test("FS1_SAFE_READ_SET is low risk", () => {
  assert.equal(FS1_SAFE_READ_SET.riskLevel, "low");
});

test("FS1_SAFE_READ_SET does not contain approval-sensitive tools", () => {
  assert.equal(FS1_SAFE_READ_SET.containsApprovalSensitiveTools, false);
});

// ── Input schema validation ───────────────────────────────────────────────────

test("tool.fs-read-file input schema accepts valid path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-read-file"];
  const result = spec.inputSchema.safeParse({ path: "docs/README.md" });
  assert.ok(result.success);
});

test("tool.fs-read-file input schema rejects empty path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-read-file"];
  const result = spec.inputSchema.safeParse({ path: "" });
  assert.ok(!result.success);
});

test("tool.fs-read-file input schema rejects missing path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-read-file"];
  const result = spec.inputSchema.safeParse({});
  assert.ok(!result.success);
});

test("tool.fs-list-directory input schema defaults path to '.'", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-list-directory"];
  const result = spec.inputSchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.path, ".");
});

test("tool.fs-list-directory input schema accepts a path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-list-directory"];
  const result = spec.inputSchema.safeParse({ path: "docs" });
  assert.ok(result.success);
  assert.equal(result.data.path, "docs");
});

test("tool.fs-stat input schema accepts valid path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-stat"];
  const result = spec.inputSchema.safeParse({ path: "docs/README.md" });
  assert.ok(result.success);
});

test("tool.fs-stat input schema rejects empty path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-stat"];
  const result = spec.inputSchema.safeParse({ path: "" });
  assert.ok(!result.success);
});

test("tool.fs-search-files input schema accepts query only", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-search-files"];
  const result = spec.inputSchema.safeParse({ query: "MANASVI_MODEL" });
  assert.ok(result.success);
  assert.equal(result.data.path, ".");
});

test("tool.fs-search-files input schema rejects empty query", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-search-files"];
  const result = spec.inputSchema.safeParse({ query: "" });
  assert.ok(!result.success);
});

test("tool.fs-search-files input schema accepts query and path", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-search-files"];
  const result = spec.inputSchema.safeParse({ query: "hello", path: "src" });
  assert.ok(result.success);
  assert.equal(result.data.query, "hello");
  assert.equal(result.data.path, "src");
});

test("tool.fs-rename-file input schema accepts canonical fields", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-rename-file"];
  const result = spec.inputSchema.safeParse({ fromPath: "hello.txt", toPath: "hellow.txt" });
  assert.ok(result.success);
  assert.equal(result.data.fromPath, "hello.txt");
  assert.equal(result.data.toPath, "hellow.txt");
});

test("tool.fs-rename-file input schema accepts path/newPath aliases", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-rename-file"];
  const result = spec.inputSchema.safeParse({ path: "hello.txt", newPath: "hellow.txt" });
  assert.ok(result.success);
  assert.equal(result.data.fromPath, "hello.txt");
  assert.equal(result.data.toPath, "hellow.txt");
});

// ── Output schema validation ──────────────────────────────────────────────────

test("tool.fs-read-file output schema validates correct output", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-read-file"];
  const result = spec.outputSchema.safeParse({
    path: "docs/README.md",
    sizeBytes: 1024,
    content: "# Hello",
    truncated: false
  });
  assert.ok(result.success);
});

test("tool.fs-list-directory output schema validates correct output", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-list-directory"];
  const result = spec.outputSchema.safeParse({
    path: ".",
    entries: [
      { name: "README.md", path: "README.md", type: "file", sizeBytes: 1024 },
      { name: "docs", path: "docs", type: "directory" }
    ],
    truncated: false
  });
  assert.ok(result.success);
});

test("tool.fs-stat output schema validates correct output", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-stat"];
  const result = spec.outputSchema.safeParse({
    path: "docs/README.md",
    type: "file",
    sizeBytes: 2048,
    modifiedAt: "2026-05-04T10:00:00.000Z"
  });
  assert.ok(result.success);
});

test("tool.fs-search-files output schema validates correct output", () => {
  const spec = FILESYSTEM_TOOL_SPECS["tool.fs-search-files"];
  const result = spec.outputSchema.safeParse({
    query: "hello",
    searchPath: ".",
    results: [
      { path: "src/main.ts", line: 42, snippet: "const hello = 'world';" }
    ],
    truncated: false
  });
  assert.ok(result.success);
});

// ── Runtime binding ───────────────────────────────────────────────────────────

test("FS1 tools have correct toolRef prefix", () => {
  for (const toolId of FS1_TOOL_IDS) {
    const spec = FILESYSTEM_TOOL_SPECS[toolId];
    assert.ok(
      spec.manifest.runtimeBinding.toolRef.startsWith("tool:fs-"),
      `${toolId} toolRef must start with tool:fs-`
    );
  }
});
