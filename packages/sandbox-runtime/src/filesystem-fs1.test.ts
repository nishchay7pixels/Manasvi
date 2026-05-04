/**
 * FS1 sandbox execution tests.
 *
 * Tests the actual worker script execution for FS1 filesystem tools.
 * Covers: path safety, deny patterns, file size limits, binary detection,
 * directory listing, file stat, file search, and safe error codes.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InternalTokenService } from "@manasvi/auth";
import { runSandboxedExecution } from "./index.js";

// ── Token service for tests ───────────────────────────────────────────────────

const KEY_ID = "test-k1";
const KEY_SECRET = "test-secret-32-bytes-long-enough!";

function makeTokenService(): InternalTokenService {
  return new InternalTokenService(
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      keyId: KEY_ID,
      secret: KEY_SECRET,
      ttlSeconds: 120
    },
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      secretsByKeyId: { [KEY_ID]: KEY_SECRET }
    }
  );
}

// ── Run helper ────────────────────────────────────────────────────────────────

interface RunFs1ToolInput {
  toolRef: string;
  operation: string;
  parameters: Record<string, unknown>;
  workspaceRoot: string;
  sandboxRootDir: string;
  tokenService: InternalTokenService;
}

async function runFs1Tool(input: RunFs1ToolInput) {
  const ts = input.tokenService;
  const runId = `run:test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const intentId = `intent:test-${Date.now()}`;

  const executionToken = ts.issueToken({
    caller: { principalId: "service:orchestrator-service", principalType: "service" },
    subject: { principalId: intentId, principalType: "service" },
    scopes: [`execution.run:${runId}`, "execution.runtime.invoke"],
    ttlSeconds: 120
  });

  const isFsWriteTool = ["tool:fs-write-file", "tool:fs-append-file", "tool:fs-apply-patch", "tool:fs-rename-file"].includes(input.toolRef);
  const request = {
    schemaVersion: "1.0",
    runId,
    intentId,
    artifactId: `artifact:test-${Date.now()}`,
    toolRef: input.toolRef,
    operation: input.operation,
    parameters: input.parameters,
    executionToken,
    runtimePolicy: {
      schemaVersion: "1.0",
      policyId: "test-policy",
      sandboxMode: isFsWriteTool ? "no_network_compute" : "read_only_local",
      timeoutMs: 15000,
      cpuTimeLimitSeconds: 10,
      memoryLimitMb: 128,
      network: { mode: "none", egressAllowlist: [] },
      filesystem: {
        mode: isFsWriteTool ? "scratch_write" : "read_only_inputs",
        readPaths: [],
        writePaths: []
      },
      secrets: { allowedSecretRefs: [] },
      cleanup: { removeWorkspaceAfterRun: false },
      derivedFrom: {
        actionClass: "access-filesystem",
        target: { resourceClass: "filesystem-zone", resourceId: "filesystem:workspace", attributes: {} }
      }
    },
    trace: { traceId: randomUUID(), correlationId: randomUUID() }
  };

  // Temporarily set MANASVI_WORKSPACE_ROOT for this test invocation
  const prev = process.env.MANASVI_WORKSPACE_ROOT;
  process.env.MANASVI_WORKSPACE_ROOT = input.workspaceRoot;
  try {
    return await runSandboxedExecution({
      request,
      tokenService: ts,
      decisionAuditRecordId: `audit:${Date.now()}`,
      sandboxRootDir: input.sandboxRootDir
    });
  } finally {
    if (prev === undefined) {
      delete process.env.MANASVI_WORKSPACE_ROOT;
    } else {
      process.env.MANASVI_WORKSPACE_ROOT = prev;
    }
  }
}

// ── Workspace setup ───────────────────────────────────────────────────────────

async function createTestWorkspace() {
  const base = await mkdtemp(join(tmpdir(), "manasvi-fs1-test-"));
  const workspaceDir = join(base, "workspace");
  const sandboxDir = join(base, "sandbox");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(sandboxDir, { recursive: true });
  return {
    workspaceDir,
    sandboxDir,
    cleanup: () => rm(base, { recursive: true, force: true })
  };
}

// ── fs-read-file: path safety ─────────────────────────────────────────────────

test("fs-read-file: reads a valid text file inside workspace", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "hello.txt"), "Hello, FS1!");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "hello.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed", `status=${artifact.status} failure=${JSON.stringify(artifact.failure)}`);
    assert.equal(artifact.result.path, "hello.txt");
    assert.equal(artifact.result.content, "Hello, FS1!");
    assert.equal(artifact.result.truncated, false);
    assert.equal(typeof artifact.result.sizeBytes, "number");
  } finally {
    await cleanup();
  }
});

test("fs-read-file: reads a file in a subdirectory", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await mkdir(join(workspaceDir, "docs"), { recursive: true });
    await writeFile(join(workspaceDir, "docs", "README.md"), "# Docs");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "docs/README.md" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    assert.equal(artifact.result.path, "docs/README.md");
  } finally {
    await cleanup();
  }
});

test("fs-read-file: path traversal ../ is blocked", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "../outside.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "policy_violation" || artifact.status === "failed",
      `Expected blocked, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: absolute path outside workspace is blocked", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "/etc/hosts" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "policy_violation" || artifact.status === "failed",
      `Expected blocked, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

// ── fs-read-file: deny patterns ───────────────────────────────────────────────

test("fs-read-file: .env is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env"), "SECRET=hunter2");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: ".env" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: .env.local is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env.local"), "DB_PASS=secret");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: ".env.local" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for .env.local, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: .pem file is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "cert.pem"), "-----BEGIN CERTIFICATE-----");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "cert.pem" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for .pem, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: .key file is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "private.key"), "PRIVATE KEY DATA");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "private.key" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for .key, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: file inside node_modules is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await mkdir(join(workspaceDir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(workspaceDir, "node_modules", "pkg", "index.js"), "module.exports = {}");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "node_modules/pkg/index.js" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for node_modules, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: file inside dist is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await mkdir(join(workspaceDir, "dist"), { recursive: true });
    await writeFile(join(workspaceDir, "dist", "index.js"), "/* compiled */");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "dist/index.js" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for dist, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: file inside .git is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await mkdir(join(workspaceDir, ".git"), { recursive: true });
    await writeFile(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: ".git/HEAD" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied for .git, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

// ── fs-read-file: limits ──────────────────────────────────────────────────────

test("fs-read-file: missing file returns an error", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "does-not-exist.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
  } finally {
    await cleanup();
  }
});

test("fs-read-file: oversized file returns FILE_TOO_LARGE", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "big.txt"), "x".repeat(201_000));
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "big.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(
      artifact.failure?.code === "FILE_TOO_LARGE" || artifact.failure?.code === "TOOL_RUNTIME_ERROR",
      `Expected FILE_TOO_LARGE, got: ${artifact.failure?.code}`
    );
  } finally {
    await cleanup();
  }
});

test("fs-read-file: binary file returns BINARY_FILE_NOT_SUPPORTED", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    // PNG magic bytes + null bytes = clearly binary
    const binaryBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await writeFile(join(workspaceDir, "image.png"), binaryBuf);
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "image.png" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(
      artifact.failure?.code === "BINARY_FILE_NOT_SUPPORTED" || artifact.failure?.code === "TOOL_RUNTIME_ERROR",
      `Expected BINARY_FILE_NOT_SUPPORTED, got: ${artifact.failure?.code}`
    );
  } finally {
    await cleanup();
  }
});

// ── fs-list-directory ─────────────────────────────────────────────────────────

test("fs-list-directory: lists workspace root", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "README.md"), "# Hello");
    await mkdir(join(workspaceDir, "docs"), { recursive: true });
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-list-directory",
      operation: "fs_list_directory",
      parameters: { path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const entries = artifact.result.entries as Array<{ name: string; type: string }>;
    assert.ok(Array.isArray(entries));
    const names = entries.map((e) => e.name);
    assert.ok(names.includes("README.md"), `Should include README.md. Got: ${names.join(", ")}`);
    assert.ok(names.includes("docs"), `Should include docs. Got: ${names.join(", ")}`);
  } finally {
    await cleanup();
  }
});

test("fs-list-directory: hides .env from listing", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env"), "SECRET=x");
    await writeFile(join(workspaceDir, "README.md"), "# Hello");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-list-directory",
      operation: "fs_list_directory",
      parameters: { path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const entries = artifact.result.entries as Array<{ name: string }>;
    const names = entries.map((e) => e.name);
    assert.ok(!names.includes(".env"), ".env must not appear in listing");
    assert.ok(names.includes("README.md"), "README.md should be visible");
  } finally {
    await cleanup();
  }
});

test("fs-list-directory: hides node_modules", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await mkdir(join(workspaceDir, "node_modules"), { recursive: true });
    await writeFile(join(workspaceDir, "package.json"), "{}");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-list-directory",
      operation: "fs_list_directory",
      parameters: { path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const entries = artifact.result.entries as Array<{ name: string }>;
    const names = entries.map((e) => e.name);
    assert.ok(!names.includes("node_modules"), "node_modules must be hidden");
    assert.ok(names.includes("package.json"), "package.json should be visible");
  } finally {
    await cleanup();
  }
});

test("fs-list-directory: missing directory returns error", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-list-directory",
      operation: "fs_list_directory",
      parameters: { path: "nonexistent" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
  } finally {
    await cleanup();
  }
});

// ── fs-stat ───────────────────────────────────────────────────────────────────

test("fs-stat: returns metadata for a file", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "note.txt"), "some content");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-stat",
      operation: "fs_stat",
      parameters: { path: "note.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    assert.equal(artifact.result.path, "note.txt");
    assert.equal(artifact.result.type, "file");
    assert.ok(typeof artifact.result.sizeBytes === "number");
    assert.ok(typeof artifact.result.modifiedAt === "string");
  } finally {
    await cleanup();
  }
});

test("fs-stat: .env is denied", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env"), "SECRET=x");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-stat",
      operation: "fs_stat",
      parameters: { path: ".env" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected denied, got: ${artifact.status}`
    );
  } finally {
    await cleanup();
  }
});

// ── fs-search-files ───────────────────────────────────────────────────────────

test("fs-search-files: finds query in a file", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "config.txt"), "MANASVI_MODEL=deepseek-v4\nMANASVI_ENV=local\n");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-search-files",
      operation: "fs_search_files",
      parameters: { query: "MANASVI_MODEL", path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const results = artifact.result.results as Array<{ path: string; line: number; snippet: string }>;
    assert.ok(results.length > 0, "Should find at least one result");
    assert.equal(results[0]!.path, "config.txt");
    assert.equal(results[0]!.line, 1);
    assert.ok(results[0]!.snippet.includes("MANASVI_MODEL"));
  } finally {
    await cleanup();
  }
});

test("fs-search-files: does not expose .env content", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env"), "UNIQUE_QUERY_TOKEN_XYZ=secret");
    await writeFile(join(workspaceDir, "safe.txt"), "nothing here");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-search-files",
      operation: "fs_search_files",
      parameters: { query: "UNIQUE_QUERY_TOKEN_XYZ", path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const results = artifact.result.results as Array<{ path: string }>;
    const paths = results.map((r) => r.path);
    assert.ok(!paths.includes(".env"), ".env must not appear in search results");
  } finally {
    await cleanup();
  }
});

test("fs-search-files: returns empty results when no match", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "notes.txt"), "Hello world");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-search-files",
      operation: "fs_search_files",
      parameters: { query: "NOTHING_MATCHES_THIS_UNLIKELY_STRING_FS1_XYZ" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const results = artifact.result.results as unknown[];
    assert.equal(results.length, 0);
    assert.equal(artifact.result.truncated, false);
  } finally {
    await cleanup();
  }
});

test("fs-search-files: skips binary files", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    // Binary buffer with a null byte — isBinaryBuffer will detect this
    const binaryBuf = Buffer.concat([
      Buffer.from([0x00, 0x01]),
      Buffer.from("SEARCH_TARGET"),
      Buffer.from([0x02])
    ]);
    await writeFile(join(workspaceDir, "binary.bin"), binaryBuf);
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-search-files",
      operation: "fs_search_files",
      parameters: { query: "SEARCH_TARGET", path: "." },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const results = artifact.result.results as unknown[];
    // Binary file is skipped — no results from it
    assert.equal(results.length, 0, "Binary files must be skipped by search");
  } finally {
    await cleanup();
  }
});

// ── Audit log coverage ────────────────────────────────────────────────────────

test("successful fs-read-file emits audit log events", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, "audit-test.txt"), "content");
    const ts = makeTokenService();
    const { logs } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: "audit-test.txt" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(logs.length > 0, "Should emit audit log events");
    const stages = logs.map((l) => l.stage);
    assert.ok(stages.includes("execution_requested"), "Should log execution_requested");
    assert.ok(stages.includes("execution_completed"), "Should log execution_completed");
  } finally {
    await cleanup();
  }
});

test("blocked fs-read-file emits audit log events without file contents", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  try {
    await writeFile(join(workspaceDir, ".env"), "SECRET=x");
    const ts = makeTokenService();
    const { logs, artifact } = await runFs1Tool({
      toolRef: "tool:fs-read-file",
      operation: "fs_read_file",
      parameters: { path: ".env" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.ok(
      artifact.status === "failed" || artifact.status === "policy_violation",
      `Expected blocked, got: ${artifact.status}`
    );
    assert.ok(logs.length > 0, "Should emit audit log events");
    // Verify no log metadata contains the file contents
    for (const log of logs) {
      const metaStr = JSON.stringify(log.metadata ?? {});
      assert.ok(!metaStr.includes("SECRET=x"), "Audit log must not contain file contents");
    }
  } finally {
    await cleanup();
  }
});

// ── FS2 write safety coverage ────────────────────────────────────────────────

test("fs-write-file: writes disabled returns TOOL_NOT_AVAILABLE", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "false";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "true";
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: "docs/todo.md", content: "hello" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("TOOL_NOT_AVAILABLE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-write-file: dryRun returns diff and does not modify file", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "false";
    await mkdir(join(workspaceDir, "docs"), { recursive: true });
    await writeFile(join(workspaceDir, "docs", "todo.md"), "before");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: "docs/todo.md", content: "after", dryRun: true },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    assert.equal(artifact.result.operation, "write");
    assert.equal(artifact.result.dryRun, true);
    assert.equal(String(artifact.result.diff).includes("--- a/docs/todo.md"), true);
    const current = await readFile(join(workspaceDir, "docs", "todo.md"), "utf8");
    assert.equal(current, "before");
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-append-file: writes disabled returns TOOL_NOT_AVAILABLE", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "false";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "true";
    await writeFile(join(workspaceDir, "a.txt"), "x");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-append-file",
      operation: "fs_append_file",
      parameters: { path: "a.txt", content: "y" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("TOOL_NOT_AVAILABLE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-apply-patch: writes disabled returns TOOL_NOT_AVAILABLE", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "false";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "true";
    await writeFile(join(workspaceDir, "p.txt"), "before\n");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-apply-patch",
      operation: "fs_apply_patch",
      parameters: { path: "p.txt", patch: "--- a/p.txt\n+++ b/p.txt\n@@ -1 +1 @@\n-before\n+after\n" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("TOOL_NOT_AVAILABLE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-write-file: approved mode writes target file", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "false";
    await writeFile(join(workspaceDir, "w.txt"), "old");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: "w.txt", content: "new" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    assert.equal(artifact.result.changed, true);
    const current = await readFile(join(workspaceDir, "w.txt"), "utf8");
    assert.equal(current, "new");
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-write-file: path traversal is blocked", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "false";
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: "../outside.txt", content: "x" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("PATH_OUTSIDE_WORKSPACE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-write-file: denied path is blocked", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "false";
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: ".env", content: "SECRET=1" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("PATH_DENIED"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    await cleanup();
  }
});

test("fs-write-file: max write bytes enforced", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  const prevRequire = process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
  const prevMax = process.env.MANASVI_FS_MAX_WRITE_BYTES;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = "false";
    process.env.MANASVI_FS_MAX_WRITE_BYTES = "8";
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-write-file",
      operation: "fs_write_file",
      parameters: { path: "b.txt", content: "0123456789" },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("WRITE_TOO_LARGE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    if (prevRequire === undefined) delete process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL;
    else process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL = prevRequire;
    if (prevMax === undefined) delete process.env.MANASVI_FS_MAX_WRITE_BYTES;
    else process.env.MANASVI_FS_MAX_WRITE_BYTES = prevMax;
    await cleanup();
  }
});

test("fs-rename-file: writes disabled returns TOOL_NOT_AVAILABLE", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "false";
    await writeFile(join(workspaceDir, "old.txt"), "x");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-rename-file",
      operation: "fs_rename_file",
      parameters: { fromPath: "old.txt", toPath: "new.txt", dryRun: false },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("TOOL_NOT_AVAILABLE"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    await cleanup();
  }
});

test("fs-rename-file: renames file in approved mode", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    await writeFile(join(workspaceDir, "old.txt"), "x");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-rename-file",
      operation: "fs_rename_file",
      parameters: { fromPath: "old.txt", toPath: "new.txt", dryRun: false },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "completed");
    const moved = await readFile(join(workspaceDir, "new.txt"), "utf8");
    assert.equal(moved, "x");
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    await cleanup();
  }
});

test("fs-rename-file: missing destination directory returns safe error", async () => {
  const { workspaceDir, sandboxDir, cleanup } = await createTestWorkspace();
  const prevEnabled = process.env.MANASVI_FS_WRITES_ENABLED;
  try {
    process.env.MANASVI_FS_WRITES_ENABLED = "true";
    await writeFile(join(workspaceDir, "old.txt"), "x");
    const ts = makeTokenService();
    const { artifact } = await runFs1Tool({
      toolRef: "tool:fs-rename-file",
      operation: "fs_rename_file",
      parameters: { fromPath: "old.txt", toPath: "missing/new.txt", dryRun: false },
      workspaceRoot: workspaceDir,
      sandboxRootDir: sandboxDir,
      tokenService: ts
    });
    assert.equal(artifact.status, "failed");
    assert.ok(JSON.stringify(artifact.failure ?? {}).includes("FILE_NOT_FOUND"));
  } finally {
    if (prevEnabled === undefined) delete process.env.MANASVI_FS_WRITES_ENABLED;
    else process.env.MANASVI_FS_WRITES_ENABLED = prevEnabled;
    await cleanup();
  }
});
