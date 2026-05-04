import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { InternalTokenService } from "@manasvi/auth";
import {
  executionLogEventSchema,
  executionResultArtifactSchema,
  executorApiRequestSchema,
  type ExecutionLogEvent,
  type ExecutionResultArtifact
} from "@manasvi/contracts";

const WORKER_RESULT_PREFIX = "__MANASVI_RESULT__=";

const WORKER_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");
const http = require("node:http");
const https = require("node:https");

const payload = JSON.parse(Buffer.from(process.env.MANASVI_TOOL_PAYLOAD || "", "base64").toString("utf8"));
const usage = {
  networkAccessed: false,
  networkDestinations: [],
  filesystemWritesAttempted: [],
  injectedSecrets: payload.injectedSecretRefs || []
};

const normalizeHost = (value) => (value || "").toLowerCase();
const wildcardMatch = (pattern, value) => {
  if (pattern === "*") return true;
  const escaped = pattern
    .replace(/[.+?^\${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$", "i").test(value);
};
const isEgressAllowed = (host, port, protocol) => {
  const mode = payload.runtimePolicy.network.mode;
  if (mode === "none") return false;
  const rules = payload.runtimePolicy.network.egressAllowlist || [];
  if (mode === "operator_approved") {
    if (rules.length === 0) return true;
  }
  return rules.some((rule) => {
    if (rule.protocol && rule.protocol !== protocol) return false;
    if (typeof rule.port === "number" && Number(rule.port) !== Number(port)) return false;
    return wildcardMatch(rule.hostPattern, host);
  });
};

const noteDestination = (host, port, protocol) => {
  usage.networkAccessed = true;
  const ref = protocol + "://" + host + ":" + port;
  if (!usage.networkDestinations.includes(ref)) {
    usage.networkDestinations.push(ref);
  }
};

const enforceNetwork = (host, port, protocol) => {
  const h = normalizeHost(host || "localhost");
  const p = Number(port || (protocol === "https" ? 443 : protocol === "http" ? 80 : 0));
  noteDestination(h, p, protocol);
  if (!isEgressAllowed(h, p, protocol)) {
    const err = new Error("NETWORK_EGRESS_BLOCKED:" + protocol + "://" + h + ":" + p);
    err.code = "NETWORK_EGRESS_BLOCKED";
    throw err;
  }
};

const resolveConnectArgs = (args) => {
  if (typeof args[0] === "object" && args[0] !== null) {
    return {
      host: args[0].host || args[0].hostname || "localhost",
      port: args[0].port || 0
    };
  }
  if (typeof args[0] === "number") {
    return {
      port: args[0],
      host: typeof args[1] === "string" ? args[1] : "localhost"
    };
  }
  if (typeof args[0] === "string") {
    return {
      host: args[0],
      port: typeof args[1] === "number" ? args[1] : 0
    };
  }
  return { host: "localhost", port: 0 };
};

const originalNetConnect = net.connect;
net.connect = function (...args) {
  const info = resolveConnectArgs(args);
  enforceNetwork(info.host, info.port || 0, "tcp");
  return originalNetConnect.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  const info = resolveConnectArgs(args);
  enforceNetwork(info.host, info.port || 443, "https");
  return originalTlsConnect.apply(this, args);
};

const wrapRequest = (module, protocol) => {
  const original = module.request;
  module.request = function (...args) {
    let host = "localhost";
    let port = protocol === "https" ? 443 : 80;
    if (typeof args[0] === "string") {
      const u = new URL(args[0]);
      host = u.hostname;
      port = Number(u.port || port);
    } else if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].hostname || args[0].host || host;
      port = Number(args[0].port || port);
    }
    enforceNetwork(host, port, protocol);
    return original.apply(this, args);
  };
};
wrapRequest(http, "http");
wrapRequest(https, "https");

if (typeof fetch === "function") {
  const originalFetch = fetch;
  global.fetch = async (...args) => {
    const u = new URL(typeof args[0] === "string" ? args[0] : args[0].url);
    enforceNetwork(u.hostname, Number(u.port || (u.protocol === "https:" ? 443 : 80)), u.protocol.replace(":", ""));
    return originalFetch(...args);
  };
}

const allowReadPaths = (payload.runtimePolicy.filesystem.readPaths || []).map((p) => path.resolve(p));
const allowWritePaths = (payload.runtimePolicy.filesystem.writePaths || []).map((p) => path.resolve(p));
const canReadPath = (target) => {
  const resolved = path.resolve(target);
  return allowReadPaths.some((base) => resolved === base || resolved.startsWith(base + path.sep));
};
const canWritePath = (target) => {
  const resolved = path.resolve(target);
  return allowWritePaths.some((base) => resolved === base || resolved.startsWith(base + path.sep));
};
const deny = (code, message) => {
  const err = new Error(message);
  err.code = code;
  throw err;
};
const guardRead = (target) => {
  if (!canReadPath(target)) {
    deny("FS_READ_BLOCKED", "Read outside sandbox-allowed paths: " + target);
  }
};
const guardWrite = (target) => {
  usage.filesystemWritesAttempted.push(String(target));
  if (!canWritePath(target)) {
    deny("FS_WRITE_BLOCKED", "Write outside sandbox-allowed paths: " + target);
  }
  if (payload.runtimePolicy.filesystem.mode === "read_only_inputs") {
    deny("FS_WRITE_BLOCKED", "Write blocked in read-only sandbox mode");
  }
};

const originalReadFile = fs.readFile;
fs.readFile = function (target, ...rest) {
  guardRead(target);
  return originalReadFile.call(this, target, ...rest);
};
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (target, ...rest) {
  guardRead(target);
  return originalReadFileSync.call(this, target, ...rest);
};
const originalWriteFile = fs.writeFile;
fs.writeFile = function (target, ...rest) {
  guardWrite(target);
  return originalWriteFile.call(this, target, ...rest);
};
const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (target, ...rest) {
  guardWrite(target);
  return originalWriteFileSync.call(this, target, ...rest);
};
const originalAppendFile = fs.appendFile;
fs.appendFile = function (target, ...rest) {
  guardWrite(target);
  return originalAppendFile.call(this, target, ...rest);
};
const originalMkdir = fs.mkdir;
fs.mkdir = function (target, ...rest) {
  guardWrite(target);
  return originalMkdir.call(this, target, ...rest);
};
const originalRm = fs.rm;
fs.rm = function (target, ...rest) {
  guardWrite(target);
  return originalRm.call(this, target, ...rest);
};
const originalUnlink = fs.unlink;
fs.unlink = function (target, ...rest) {
  guardWrite(target);
  return originalUnlink.call(this, target, ...rest);
};
const originalRename = fs.rename;
fs.rename = function (from, to, ...rest) {
  guardWrite(from);
  guardWrite(to);
  return originalRename.call(this, from, to, ...rest);
};
if (fs.promises) {
  const originalPromisesWriteFile = fs.promises.writeFile.bind(fs.promises);
  fs.promises.writeFile = async function (target, ...rest) {
    guardWrite(target);
    return originalPromisesWriteFile(target, ...rest);
  };
  const originalPromisesAppendFile = fs.promises.appendFile.bind(fs.promises);
  fs.promises.appendFile = async function (target, ...rest) {
    guardWrite(target);
    return originalPromisesAppendFile(target, ...rest);
  };
  const originalPromisesMkdir = fs.promises.mkdir.bind(fs.promises);
  fs.promises.mkdir = async function (target, ...rest) {
    guardWrite(target);
    return originalPromisesMkdir(target, ...rest);
  };
  const originalPromisesRm = fs.promises.rm.bind(fs.promises);
  fs.promises.rm = async function (target, ...rest) {
    guardWrite(target);
    return originalPromisesRm(target, ...rest);
  };
  const originalPromisesUnlink = fs.promises.unlink.bind(fs.promises);
  fs.promises.unlink = async function (target, ...rest) {
    guardWrite(target);
    return originalPromisesUnlink(target, ...rest);
  };
  const originalPromisesRename = fs.promises.rename.bind(fs.promises);
  fs.promises.rename = async function (from, to, ...rest) {
    guardWrite(from);
    guardWrite(to);
    return originalPromisesRename(from, to, ...rest);
  };
  const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
  fs.promises.readFile = async function (target, ...rest) {
    guardRead(target);
    return originalPromisesReadFile(target, ...rest);
  };
}

const handlers = {
  "tool:echo": async (parameters) => {
    const message = String(parameters.message || "");
    return { echoed: message };
  },
  "tool:sleep": async (parameters) => {
    const ms = Number(parameters.ms || 0);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { sleptMs: ms };
  },
  "tool:compute-sum": async (parameters) => {
    const values = Array.isArray(parameters.values) ? parameters.values.map(Number) : [];
    const sum = values.reduce((acc, value) => acc + value, 0);
    return { sum, count: values.length };
  },
  "tool:file-write": async (parameters) => {
    const target = String(parameters.path || "");
    const content = String(parameters.content || "");
    await fs.promises.writeFile(target, content, "utf8");
    return { wrote: target, bytes: Buffer.byteLength(content, "utf8") };
  },
  "tool:file-read": async (parameters) => {
    const target = String(parameters.path || "");
    const encoding = parameters.encoding === "base64" ? "base64" : "utf8";
    const value = await fs.promises.readFile(target);
    const content = encoding === "base64" ? value.toString("base64") : value.toString("utf8");
    return {
      path: target,
      encoding,
      content,
      bytes: value.byteLength
    };
  },
  "tool:http-get": async (parameters) => {
    const url = String(parameters.url || "");
    const response = await fetch(url);
    const text = await response.text();
    return {
      url,
      status: response.status,
      preview: text.slice(0, 800),
      contentType: response.headers.get("content-type") || undefined
    };
  },
  "tool:web-search": async (parameters) => {
    const query = String(parameters.query || "").trim();
    const maxResults = Math.max(1, Math.min(10, Number(parameters.maxResults || 5)));
    const endpoint =
      "https://duckduckgo.com/?q=" +
      encodeURIComponent(query) +
      "&format=json&pretty=0&no_html=1&no_redirect=1";
    const response = await fetch(endpoint);
    const data = await response.json();
    const abstractText = String(data.AbstractText || "").trim();
    const abstractUrl = String(data.AbstractURL || "").trim();
    const heading = String(data.Heading || query || "Result").trim();
    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    const parsedRelated = related
      .flatMap((item) => {
        if (item && typeof item === "object" && Array.isArray(item.Topics)) {
          return item.Topics;
        }
        return [item];
      })
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        title: String(item.Text || "Related result"),
        url: String(item.FirstURL || "https://duckduckgo.com"),
        snippet: String(item.Text || "").slice(0, 240)
      }))
      .slice(0, maxResults);
    const firstResult =
      abstractText.length > 0
        ? [
            {
              title: heading,
              url: abstractUrl || "https://duckduckgo.com",
              snippet: abstractText.slice(0, 240)
            }
          ]
        : [];
    let results = [...firstResult, ...parsedRelated].slice(0, maxResults);

    if (results.length === 0 && query.length > 0) {
      const htmlEndpoint = "https://duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const htmlResponse = await fetch(htmlEndpoint);
      const html = await htmlResponse.text();
      const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      const decodeHtml = (value: string): string => {
        let decoded = value;
        decoded = decoded.replace(/&amp;/g, "&");
        decoded = decoded.replace(/&quot;/g, '"');
        decoded = decoded.replace(/&#x27;/g, "'");
        decoded = decoded.replace(/&#39;/g, "'");
        decoded = decoded.replace(/&lt;/g, "<");
        decoded = decoded.replace(/&gt;/g, ">");
        return decoded;
      };
      results = matches.slice(0, maxResults).map((match) => {
        const rawUrl = decodeHtml(String(match[1] || "https://duckduckgo.com"));
        let url = rawUrl;
        if (rawUrl.startsWith("//")) {
          url = "https:" + rawUrl;
        } else if (rawUrl.startsWith("/")) {
          url = "https://duckduckgo.com" + rawUrl;
        }
        const titleRaw = String(match[2] || "Result");
        const title = titleRaw.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        return {
          title: title || "Result",
          url,
          snippet: title || query
        };
      });
    }

    return {
      query,
      results
    };
  },
  "tool:shell-command": async (parameters) => {
    const { spawn } = require("node:child_process");
    let command = String(parameters.command || "");
    let args = Array.isArray(parameters.args) ? parameters.args.map(String) : [];
    if (args.length === 0 && command.includes(" ")) {
      const parts = command.trim().split(/\s+/).filter((part: string) => part.length > 0);
      if (parts.length > 0) {
        command = parts[0]!;
        args = parts.slice(1);
      }
    }
    const allowedCommands = Array.isArray(parameters.allowedCommands)
      ? parameters.allowedCommands.map(String)
      : ["echo", "pwd", "ls", "node"];
    const timeoutMs = Math.max(1, Math.min(120000, Number(parameters.timeoutMs || 5000)));
    if (!allowedCommands.includes(command)) {
      const err = new Error("COMMAND_NOT_ALLOWED:" + command);
      err.code = "COMMAND_NOT_ALLOWED";
      throw err;
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        const err = new Error("COMMAND_TIMEOUT");
        err.code = "COMMAND_TIMEOUT";
        reject(err);
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          command,
          args,
          exitCode: Number(code ?? -1),
          stdout,
          stderr
        });
      });
    });
    return result;
  },
  "tool:memory-write": async (parameters) => {
    const namespace = String(parameters.namespace || "memory:default");
    const note = String(parameters.note || "");
    return {
      namespace,
      noteId: "note:" + Date.now().toString(36),
      persisted: note.length > 0
    };
  },
  "tool:approval-request": async (parameters) => {
    return {
      intentId: String(parameters.intentId || ""),
      approvalRequestCreated: true,
      approvalRequestId: "approval-request:" + Date.now().toString(36)
    };
  },
  "tool:env-dump": async (_parameters) => {
    const filtered = Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith("MANASVI_SECRET_") || k.startsWith("MANASVI_"))
        .slice(0, 50)
    );
    return { env: filtered };
  }
};

const main = async () => {
  const handler = handlers[payload.toolRef];
  if (!handler) {
    const err = new Error("Unknown toolRef " + payload.toolRef);
    err.code = "TOOL_NOT_ALLOWED";
    throw err;
  }
  const result = await handler(payload.parameters || {});
  process.stdout.write("__MANASVI_RESULT__=" + JSON.stringify({ ok: true, result, usage }) + "\n");
};

main().catch((error) => {
  process.stdout.write("__MANASVI_RESULT__=" + JSON.stringify({
    ok: false,
    errorCode: error.code || "TOOL_RUNTIME_ERROR",
    message: error.message || "Tool runtime error",
    usage
  }) + "\n");
  process.exitCode = 1;
});
`;

export interface SandboxRunInput {
  request: unknown;
  tokenService: InternalTokenService;
  decisionAuditRecordId: string;
  executionAuditEventId?: string;
  secretValuesByRef?: Record<string, string>;
  sandboxRootDir?: string;
  maxOutputBytes?: number;
}

export interface SandboxRunOutput {
  artifact: ExecutionResultArtifact;
  logs: ExecutionLogEvent[];
}

function truncateOutput(value: string, maxOutputBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxOutputBytes) {
    return { text: value, truncated: false };
  }
  let current = value;
  while (Buffer.byteLength(current, "utf8") > maxOutputBytes) {
    current = current.slice(0, Math.max(1, Math.floor(current.length * 0.9)));
  }
  return { text: current, truncated: true };
}

function safeEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passthrough = new Set(["PATH", "LANG", "LC_ALL", "TZ"]);
  const blockedPattern = /(secret|token|password|credential|aws_|gcp_|azure_|openai|ollama_key|api_key)/i;
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!value) {
      continue;
    }
    if (blockedPattern.test(key)) {
      continue;
    }
    if (passthrough.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runSandboxedExecution(input: SandboxRunInput): Promise<SandboxRunOutput> {
  const request = executorApiRequestSchema.parse(input.request);
  const logs: ExecutionLogEvent[] = [];
  const pushLog = (stage: ExecutionLogEvent["stage"], metadata: Record<string, unknown> = {}): void => {
    logs.push(
      executionLogEventSchema.parse({
        schemaVersion: "1.0",
        eventId: `exec-log:${randomUUID()}`,
        timestamp: nowIso(),
        runId: request.runId,
        intentId: request.intentId,
        toolRef: request.toolRef,
        stage,
        sandboxMode: request.runtimePolicy.sandboxMode,
        trace: request.trace,
        metadata
      })
    );
  };

  pushLog("execution_requested");

  const verification = input.tokenService.verifyToken(request.executionToken);
  if (!verification.ok) {
    pushLog("validation_failed", { errorCode: verification.error });
    const timestamp = nowIso();
    return {
      artifact: executionResultArtifactSchema.parse({
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        artifactId: `exec-artifact:${randomUUID()}`,
        runId: request.runId,
        intentId: request.intentId,
        approvedArtifactId: request.artifactId,
        toolRef: request.toolRef,
        operation: request.operation,
        sandboxMode: request.runtimePolicy.sandboxMode,
        runtimePolicyId: request.runtimePolicy.policyId,
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 0,
        status: "validation_failed",
        timeoutAppliedMs: request.runtimePolicy.timeoutMs,
        quotas: {
          cpuTimeLimitSeconds: request.runtimePolicy.cpuTimeLimitSeconds,
          memoryLimitMb: request.runtimePolicy.memoryLimitMb
        },
        io: {
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false
        },
        result: {},
        usage: {
          networkAccessed: false,
          networkDestinations: [],
          filesystemWritesAttempted: [],
          injectedSecrets: []
        },
        trace: request.trace,
        audit: {
          decisionAuditRecordId: input.decisionAuditRecordId,
          executionAuditEventId: input.executionAuditEventId ?? `exec-audit:${randomUUID()}`
        },
        failure: {
          code: "EXECUTION_TOKEN_INVALID",
          message: verification.error
        }
      }),
      logs
    };
  }
  const claims = verification.claims;
  const scope = `execution.run:${request.runId}`;
  if (!claims.scopes.includes(scope) || claims.subject?.principalId !== request.intentId) {
    pushLog("validation_failed", { errorCode: "EXECUTION_TOKEN_SCOPE_MISMATCH" });
    const timestamp = nowIso();
    return {
      artifact: executionResultArtifactSchema.parse({
        schemaVersion: "1.0",
        contractVersion: "1.0.0",
        artifactId: `exec-artifact:${randomUUID()}`,
        runId: request.runId,
        intentId: request.intentId,
        approvedArtifactId: request.artifactId,
        toolRef: request.toolRef,
        operation: request.operation,
        sandboxMode: request.runtimePolicy.sandboxMode,
        runtimePolicyId: request.runtimePolicy.policyId,
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 0,
        status: "validation_failed",
        timeoutAppliedMs: request.runtimePolicy.timeoutMs,
        quotas: {
          cpuTimeLimitSeconds: request.runtimePolicy.cpuTimeLimitSeconds,
          memoryLimitMb: request.runtimePolicy.memoryLimitMb
        },
        io: {
          stdout: "",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false
        },
        result: {},
        usage: {
          networkAccessed: false,
          networkDestinations: [],
          filesystemWritesAttempted: [],
          injectedSecrets: []
        },
        trace: request.trace,
        audit: {
          decisionAuditRecordId: input.decisionAuditRecordId,
          executionAuditEventId: input.executionAuditEventId ?? `exec-audit:${randomUUID()}`
        },
        failure: {
          code: "EXECUTION_TOKEN_SCOPE_MISMATCH",
          message: "Execution token does not match run scope"
        }
      }),
      logs
    };
  }
  pushLog("validation_passed");

  const sandboxRootDir = input.sandboxRootDir ?? join(tmpdir(), "manasvi-runs");
  const runRoot = join(sandboxRootDir, request.runId);
  const inputDir = join(runRoot, "input");
  const outputDir = join(runRoot, "output");
  const scratchDir = join(runRoot, "scratch");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(scratchDir, { recursive: true });

  const maxOutputBytes = input.maxOutputBytes ?? 64 * 1024;
  const baseEnv = safeEnv(process.env);
  baseEnv.HOME = runRoot;
  baseEnv.MANASVI_RUN_ID = request.runId;
  baseEnv.MANASVI_SANDBOX_MODE = request.runtimePolicy.sandboxMode;

  const injectedSecrets: string[] = [];
  for (const secretRef of request.runtimePolicy.secrets.allowedSecretRefs) {
    const value = input.secretValuesByRef?.[secretRef];
    if (!value) {
      continue;
    }
    const envName = `MANASVI_SECRET_${secretRef.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`;
    baseEnv[envName] = value;
    injectedSecrets.push(secretRef);
  }
  if (injectedSecrets.length > 0) {
    pushLog("secret_injection", { injectedSecrets });
  }

  const workerPayload = {
    toolRef: request.toolRef,
    operation: request.operation,
    parameters: request.parameters,
    runtimePolicy: {
      network: request.runtimePolicy.network,
      filesystem: {
        ...request.runtimePolicy.filesystem,
        readPaths: [...request.runtimePolicy.filesystem.readPaths, inputDir, outputDir, scratchDir, runRoot],
        writePaths: [...request.runtimePolicy.filesystem.writePaths, outputDir, scratchDir]
      }
    },
    injectedSecretRefs: injectedSecrets
  };
  baseEnv.MANASVI_TOOL_PAYLOAD = Buffer.from(JSON.stringify(workerPayload), "utf8").toString("base64");

  const launchCommand = process.execPath;
  const launchArgs = [
    `--max-old-space-size=${request.runtimePolicy.memoryLimitMb}`,
    "-e",
    WORKER_SCRIPT
  ];

  pushLog("runtime_policy_derived", {
    runtimePolicyId: request.runtimePolicy.policyId,
    timeoutMs: request.runtimePolicy.timeoutMs,
    cpuTimeLimitSeconds: request.runtimePolicy.cpuTimeLimitSeconds,
    memoryLimitMb: request.runtimePolicy.memoryLimitMb
  });
  pushLog("sandbox_launching", {
    runRoot,
    sandboxMode: request.runtimePolicy.sandboxMode
  });

  const startedAt = Date.now();
  const child = spawn(launchCommand, launchArgs, {
    cwd: scratchDir,
    env: baseEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  pushLog("sandbox_started", { pid: child.pid });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 500).unref();
  }, request.runtimePolicy.timeoutMs);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;

  const truncatedStdout = truncateOutput(stdout, maxOutputBytes);
  const truncatedStderr = truncateOutput(stderr, maxOutputBytes);

  let parsedWorker: {
    ok: boolean;
    result?: Record<string, unknown>;
    errorCode?: string;
    message?: string;
    usage?: {
      networkAccessed?: boolean;
      networkDestinations?: string[];
      filesystemWritesAttempted?: string[];
      injectedSecrets?: string[];
    };
  } = { ok: false, errorCode: "NO_WORKER_RESULT", message: "Worker did not produce structured result" };

  const markerLine = truncatedStdout.text
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith(WORKER_RESULT_PREFIX));
  if (markerLine) {
    try {
      parsedWorker = JSON.parse(markerLine.slice(WORKER_RESULT_PREFIX.length));
    } catch {
      parsedWorker = {
        ok: false,
        errorCode: "WORKER_RESULT_PARSE_ERROR",
        message: "Failed to parse worker result payload"
      };
    }
  }

  let status: ExecutionResultArtifact["status"] = "completed";
  let failure: ExecutionResultArtifact["failure"] | undefined;
  if (timedOut) {
    status = "timed_out";
    failure = {
      code: "EXECUTION_TIMEOUT",
      message: `Execution timed out after ${request.runtimePolicy.timeoutMs}ms`
    };
    pushLog("timeout", { timeoutMs: request.runtimePolicy.timeoutMs });
  } else if (!parsedWorker.ok || exit.code !== 0) {
    const code = parsedWorker.errorCode ?? "EXECUTION_FAILED";
    if (code === "NETWORK_EGRESS_BLOCKED" || code === "FS_WRITE_BLOCKED" || code === "FS_READ_BLOCKED") {
      status = "policy_violation";
    } else if (exit.signal === "SIGXCPU") {
      status = "quota_exceeded";
      pushLog("quota_exceeded", { quota: "cpu_time" });
    } else if (/heap out of memory/i.test(truncatedStderr.text)) {
      status = "quota_exceeded";
      pushLog("quota_exceeded", { quota: "memory" });
    } else {
      status = "failed";
    }
    failure = {
      code,
      message: parsedWorker.message ?? (truncatedStderr.text.slice(0, 400) || "Execution failed")
    };
  }

  if (status === "completed") {
    pushLog("execution_completed", { exitCode: exit.code ?? 0, durationMs });
  } else {
    pushLog("execution_failed", { status, failureCode: failure?.code, durationMs });
  }

  const artifact = executionResultArtifactSchema.parse({
    schemaVersion: "1.0",
    contractVersion: "1.0.0",
    artifactId: `exec-artifact:${randomUUID()}`,
    runId: request.runId,
    intentId: request.intentId,
    approvedArtifactId: request.artifactId,
    toolRef: request.toolRef,
    operation: request.operation,
    sandboxMode: request.runtimePolicy.sandboxMode,
    runtimePolicyId: request.runtimePolicy.policyId,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs,
    status,
    ...(exit.code !== null ? { exitCode: exit.code } : {}),
    ...(exit.signal ? { signal: exit.signal } : {}),
    timeoutAppliedMs: request.runtimePolicy.timeoutMs,
    quotas: {
      cpuTimeLimitSeconds: request.runtimePolicy.cpuTimeLimitSeconds,
      memoryLimitMb: request.runtimePolicy.memoryLimitMb
    },
    io: {
      stdout: truncatedStdout.text,
      stderr: truncatedStderr.text,
      stdoutTruncated: truncatedStdout.truncated,
      stderrTruncated: truncatedStderr.truncated
    },
    result: parsedWorker.ok ? (parsedWorker.result ?? {}) : {},
    usage: {
      networkAccessed: parsedWorker.usage?.networkAccessed ?? false,
      networkDestinations: parsedWorker.usage?.networkDestinations ?? [],
      filesystemWritesAttempted: parsedWorker.usage?.filesystemWritesAttempted ?? [],
      injectedSecrets: parsedWorker.usage?.injectedSecrets ?? injectedSecrets
    },
    trace: request.trace,
    audit: {
      decisionAuditRecordId: input.decisionAuditRecordId,
      executionAuditEventId: input.executionAuditEventId ?? `exec-audit:${randomUUID()}`
    },
    ...(failure ? { failure } : {})
  });

  pushLog("result_artifact_generated", { artifactId: artifact.artifactId, status: artifact.status });

  if (request.runtimePolicy.cleanup.removeWorkspaceAfterRun) {
    await rm(runRoot, { recursive: true, force: true });
    pushLog("cleanup_complete", { runRootRemoved: true });
  }

  return { artifact, logs };
}
