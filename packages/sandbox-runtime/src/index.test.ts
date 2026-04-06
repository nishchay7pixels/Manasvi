import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InternalTokenService } from "@manasvi/auth";
import type { ExecutorApiRequest, RuntimePolicy } from "@manasvi/contracts";

import { runSandboxedExecution } from "./index.js";

function createTokenService(): InternalTokenService {
  return new InternalTokenService(
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      keyId: "local-k1",
      secret: "local-dev-secret",
      ttlSeconds: 120
    },
    {
      issuer: "manasvi.internal.auth",
      audience: "manasvi.internal.services",
      secretsByKeyId: {
        "local-k1": "local-dev-secret"
      }
    }
  );
}

function baseRuntimePolicy(overrides?: Partial<RuntimePolicy>): RuntimePolicy {
  return {
    schemaVersion: "1.0",
    policyId: "runtime-policy:test",
    sandboxMode: "no_network_compute",
    timeoutMs: 2_000,
    cpuTimeLimitSeconds: 5,
    memoryLimitMb: 128,
    filesystem: {
      mode: "scratch_write",
      readPaths: [],
      writePaths: []
    },
    network: {
      mode: "none",
      egressAllowlist: []
    },
    secrets: {
      allowedSecretRefs: [],
      injectedSecretEnvNames: []
    },
    cleanup: {
      removeWorkspaceAfterRun: true
    },
    derivedFrom: {
      actionClass: "execute",
      target: {
        resourceClass: "tool-endpoint",
        resourceId: "tool:echo",
        attributes: {}
      }
    },
    ...overrides
  };
}

function buildRequest(input: {
  runId: string;
  intentId: string;
  artifactId?: string;
  toolRef: string;
  parameters?: Record<string, unknown>;
  runtimePolicy?: RuntimePolicy;
  tokenService: InternalTokenService;
  invalidToken?: boolean;
}): ExecutorApiRequest {
  const artifactId = input.artifactId ?? `artifact:${randomUUID()}`;
  const token = input.invalidToken
    ? "invalid.token.value"
    : input.tokenService.issueToken({
        caller: { principalId: "service:execution-manager", principalType: "service" },
        subject: { principalId: input.intentId, principalType: "tool" },
        scopes: [`execution.run:${input.runId}`],
        tenantId: "tenant-local",
        workspaceId: "workspace-local",
        ttlSeconds: 30
      });
  return {
    schemaVersion: "1.0",
    runId: input.runId,
    intentId: input.intentId,
    artifactId,
    toolRef: input.toolRef,
    operation: "op",
    parameters: input.parameters ?? {},
    runtimePolicy: input.runtimePolicy ?? baseRuntimePolicy(),
    executionToken: token,
    trace: {
      traceId: "5f7f8f40-d0fb-4df8-8641-e3e8b2a2095e",
      correlationId: "69239e67-a1e2-4350-991f-bf530b7f65bb"
    }
  };
}

test("sandbox run succeeds for echo tool", async () => {
  const tokenService = createTokenService();
  const request = buildRequest({
    runId: `run:${randomUUID()}`,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:echo",
    parameters: { message: "hello" },
    tokenService
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test"
  });

  assert.equal(result.artifact.status, "completed");
  assert.equal(result.artifact.result.echoed, "hello");
  assert.ok(result.logs.some((log) => log.stage === "validation_passed"));
  assert.ok(result.logs.some((log) => log.stage === "result_artifact_generated"));
});

test("invalid execution token fails closed", async () => {
  const tokenService = createTokenService();
  const request = buildRequest({
    runId: `run:${randomUUID()}`,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:echo",
    tokenService,
    invalidToken: true
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test"
  });

  assert.equal(result.artifact.status, "validation_failed");
  assert.equal(result.artifact.failure?.code, "EXECUTION_TOKEN_INVALID");
});

test("no-network mode blocks egress", async () => {
  const tokenService = createTokenService();
  const request = buildRequest({
    runId: `run:${randomUUID()}`,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:http-get",
    parameters: { url: "https://example.com" },
    runtimePolicy: baseRuntimePolicy({
      network: {
        mode: "none",
        egressAllowlist: []
      }
    }),
    tokenService
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test"
  });

  assert.equal(result.artifact.status, "policy_violation");
  assert.match(result.artifact.failure?.message ?? "", /NETWORK_EGRESS_BLOCKED/);
});

test("read-only mode blocks writes", async () => {
  const tokenService = createTokenService();
  const request = buildRequest({
    runId: `run:${randomUUID()}`,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:file-write",
    parameters: { path: "/tmp/blocked-write.txt", content: "x" },
    runtimePolicy: baseRuntimePolicy({
      sandboxMode: "read_only_local",
      filesystem: {
        mode: "read_only_inputs",
        readPaths: [],
        writePaths: []
      }
    }),
    tokenService
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test"
  });

  assert.equal(result.artifact.status, "policy_violation");
  assert.equal(result.artifact.failure?.code, "FS_WRITE_BLOCKED");
});

test("timeout is enforced", async () => {
  const tokenService = createTokenService();
  const request = buildRequest({
    runId: `run:${randomUUID()}`,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:sleep",
    parameters: { ms: 3000 },
    runtimePolicy: baseRuntimePolicy({ timeoutMs: 200 }),
    tokenService
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test"
  });

  assert.equal(result.artifact.status, "timed_out");
  assert.equal(result.artifact.failure?.code, "EXECUTION_TIMEOUT");
});

test("secret injection is explicit and host secrets are not inherited", async () => {
  const tokenService = createTokenService();
  const runId = `run:${randomUUID()}`;
  const request = buildRequest({
    runId,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:env-dump",
    runtimePolicy: baseRuntimePolicy({
      secrets: {
        allowedSecretRefs: ["secret:demo"],
        injectedSecretEnvNames: ["MANASVI_SECRET_SECRET_DEMO"]
      }
    }),
    tokenService
  });
  const old = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_SECRET_ACCESS_KEY = "should-never-leak";

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test",
    secretValuesByRef: {
      "secret:demo": "demo-secret-value"
    }
  });
  process.env.AWS_SECRET_ACCESS_KEY = old;

  assert.equal(result.artifact.status, "completed");
  const envDump = (result.artifact.result.env ?? {}) as Record<string, string>;
  assert.equal(envDump.MANASVI_SECRET_SECRET_DEMO, "demo-secret-value");
  assert.equal("AWS_SECRET_ACCESS_KEY" in envDump, false);
});

test("workspace cleanup removes per-run directory", async () => {
  const tokenService = createTokenService();
  const root = join(tmpdir(), `manasvi-test-runs-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const runId = `run:${randomUUID()}`;
  const request = buildRequest({
    runId,
    intentId: `intent:${randomUUID()}`,
    toolRef: "tool:echo",
    parameters: { message: "cleanup" },
    tokenService
  });

  const result = await runSandboxedExecution({
    request,
    tokenService,
    decisionAuditRecordId: "audit:test",
    sandboxRootDir: root
  });
  assert.equal(result.artifact.status, "completed");
  await assert.rejects(async () => access(join(root, runId)));
});
