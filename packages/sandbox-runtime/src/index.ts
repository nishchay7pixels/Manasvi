import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
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
const crypto = require("node:crypto");

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
  const isGmailTool = typeof payload.toolRef === "string" && payload.toolRef.startsWith("tool:gmail-");
  const isLoopbackGateway =
    (protocol === "http" || protocol === "tcp") &&
    Number(port) === 4100 &&
    (host === "127.0.0.1" || host === "localhost");
  if (isGmailTool && isLoopbackGateway) return true;

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

// ── FS1 safe read-only filesystem sandbox ──────────────────────────────────────
// Milestone FS1: workspace-sandboxed, deny-pattern-filtered, size-limited reads.
// The filesystem is a governed runtime capability, not a model capability.

const fsConfig = {
  workspaceRoot: payload.fsConfig && payload.fsConfig.workspaceRoot
    ? String(payload.fsConfig.workspaceRoot)
    : path.resolve("./workspace"),
  maxReadBytes: payload.fsConfig && payload.fsConfig.maxReadBytes
    ? Number(payload.fsConfig.maxReadBytes)
    : 200000,
  maxDirectoryEntries: payload.fsConfig && payload.fsConfig.maxDirectoryEntries
    ? Number(payload.fsConfig.maxDirectoryEntries)
    : 500,
  maxSearchResults: payload.fsConfig && payload.fsConfig.maxSearchResults
    ? Number(payload.fsConfig.maxSearchResults)
    : 50,
  maxSearchFileBytes: payload.fsConfig && payload.fsConfig.maxSearchFileBytes
    ? Number(payload.fsConfig.maxSearchFileBytes)
    : 200000
};
const fsWriteConfig = {
  writesEnabled: payload.fsConfig && payload.fsConfig.writesEnabled !== undefined
    ? Boolean(payload.fsConfig.writesEnabled)
    : false,
  requireApproval: payload.fsConfig && payload.fsConfig.requireApproval !== undefined
    ? Boolean(payload.fsConfig.requireApproval)
    : true,
  maxWriteBytes: payload.fsConfig && payload.fsConfig.maxWriteBytes
    ? Number(payload.fsConfig.maxWriteBytes)
    : 500000,
  maxPatchBytes: payload.fsConfig && payload.fsConfig.maxPatchBytes
    ? Number(payload.fsConfig.maxPatchBytes)
    : 200000,
  maxDiffBytes: payload.fsConfig && payload.fsConfig.maxDiffBytes
    ? Number(payload.fsConfig.maxDiffBytes)
    : 100000
};

// Filenames and extensions that are always denied
const FS1_DENY_FILENAMES = [".env", "id_rsa", "id_ed25519"];
const FS1_DENY_EXTENSIONS = [".pem", ".key", ".crt"];
// Path components (directory names) that are always denied
const FS1_DENY_DIRECTORIES = [
  ".ssh", ".aws", ".gcp", ".azure", ".git",
  "node_modules", "dist", "build", "coverage",
  ".next", ".turbo", ".cache"
];

const isDenied = (relativePath) => {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts[parts.length - 1] || "";

  // Block denied directory components anywhere in the path
  for (const part of parts.slice(0, -1)) {
    if (FS1_DENY_DIRECTORIES.includes(part)) return true;
  }
  // Also block if the target itself is a denied directory name
  if (FS1_DENY_DIRECTORIES.includes(filename)) return true;

  // Block denied exact filenames
  if (FS1_DENY_FILENAMES.includes(filename)) return true;

  // Block .env.* pattern (any file starting with .env)
  if (filename.startsWith(".env")) return true;

  // Block denied extensions
  for (const ext of FS1_DENY_EXTENSIONS) {
    if (filename.endsWith(ext)) return true;
  }

  return false;
};

// Resolve a user-provided path to an absolute path inside the workspace root.
// Throws a structured error if the path escapes the workspace.
const resolveWorkspacePath = async (userPath) => {
  const workspaceRoot = fsConfig.workspaceRoot;
  const realRoot = path.resolve(workspaceRoot);

  // Reject empty path
  if (!userPath || String(userPath).trim() === "") {
    const err = new Error("INVALID_PATH: path must not be empty");
    err.code = "INVALID_PATH";
    throw err;
  }

  const userPathStr = String(userPath).trim();

  // Reject absolute paths that are not within the workspace root
  if (path.isAbsolute(userPathStr)) {
    const normalized = path.normalize(userPathStr);
    if (normalized !== realRoot && !normalized.startsWith(realRoot + path.sep)) {
      const err = new Error("PATH_OUTSIDE_WORKSPACE: absolute path outside workspace root");
      err.code = "PATH_OUTSIDE_WORKSPACE";
      throw err;
    }
    const relativePath = path.relative(realRoot, normalized);
    return { resolvedPath: normalized, relativePath, realRoot };
  }

  // Resolve relative to workspace root
  const candidate = path.resolve(realRoot, userPathStr);

  // Check candidate is inside workspace root
  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
    const err = new Error("PATH_OUTSIDE_WORKSPACE: path traversal outside workspace root");
    err.code = "PATH_OUTSIDE_WORKSPACE";
    throw err;
  }

  // Symlink escape check: verify realpath of existing path or nearest existing parent
  try {
    const realCandidate = await fs.promises.realpath(candidate);
    if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + path.sep)) {
      const err = new Error("PATH_OUTSIDE_WORKSPACE: symlink target outside workspace root");
      err.code = "PATH_OUTSIDE_WORKSPACE";
      throw err;
    }
  } catch (symlinkErr) {
    if (symlinkErr.code === "PATH_OUTSIDE_WORKSPACE") throw symlinkErr;
    // Path may not exist — check nearest existing parent
    if (symlinkErr.code === "ENOENT" || symlinkErr.code === "ENOTDIR") {
      let parent = path.dirname(candidate);
      while (parent !== realRoot && parent.startsWith(realRoot)) {
        try {
          const realParent = await fs.promises.realpath(parent);
          if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
            const err = new Error("PATH_OUTSIDE_WORKSPACE: parent symlink target outside workspace root");
            err.code = "PATH_OUTSIDE_WORKSPACE";
            throw err;
          }
          break;
        } catch (parentErr) {
          if (parentErr.code === "PATH_OUTSIDE_WORKSPACE") throw parentErr;
          parent = path.dirname(parent);
        }
      }
    }
  }

  const relativePath = path.relative(realRoot, candidate);
  return { resolvedPath: candidate, relativePath, realRoot };
};

// Detect binary files by checking for null bytes or non-printable control chars
const isBinaryBuffer = (buf) => {
  const sample = buf.slice(0, Math.min(8000, buf.length));
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte === 0) return true;
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return true;
  }
  return false;
};

// Create a structured safe error (no stack traces exposed to model)
const fsSafeErr = (code, message) => {
  const err = new Error(code + ": " + message);
  err.code = code;
  err.safeMessage = message;
  return err;
};

const toSha256 = (value) => "sha256:" + crypto.createHash("sha256").update(value).digest("hex");

const truncateUtf8 = (value, maxBytes) => {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return { text: value, truncated: false };
  let out = value;
  while (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, Math.max(1, Math.floor(out.length * 0.9)));
  }
  return { text: out, truncated: true };
};

const buildUnifiedDiff = (relativePath, beforeText, afterText) => {
  const beforeLines = beforeText.split("\n");
  const afterLines = afterText.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const lines = ["--- a/" + relativePath, "+++ b/" + relativePath, "@@ -1,0 +1,0 @@"];
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) {
      if (b !== undefined) lines.push(" " + b);
      continue;
    }
    if (b !== undefined) lines.push("-" + b);
    if (a !== undefined) lines.push("+" + a);
  }
  return truncateUtf8(lines.join("\n"), fsWriteConfig.maxDiffBytes);
};

const applySingleFileUnifiedPatch = (beforeText, patchText) => {
  const lines = patchText.split("\n");
  const plusHeader = lines.find((line) => line.startsWith("+++ "));
  if (!plusHeader) throw fsSafeErr("PATCH_APPLY_FAILED", "Missing +++ header");
  const oldLines = beforeText.split("\n");
  const output = [];
  let srcIdx = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith(" ")) {
      const expected = line.slice(1);
      if (oldLines[srcIdx] !== expected) throw fsSafeErr("PATCH_APPLY_FAILED", "Patch context mismatch");
      output.push(expected);
      srcIdx += 1;
      continue;
    }
    if (line.startsWith("-")) {
      const expected = line.slice(1);
      if (oldLines[srcIdx] !== expected) throw fsSafeErr("PATCH_APPLY_FAILED", "Patch removal mismatch");
      srcIdx += 1;
      continue;
    }
    if (line.startsWith("+")) {
      output.push(line.slice(1));
      continue;
    }
  }
  while (srcIdx < oldLines.length) {
    output.push(oldLines[srcIdx]);
    srcIdx += 1;
  }
  return output.join("\n");
};

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

  // ── FS1 safe read-only tools ────────────────────────────────────────────────

  "tool:fs-read-file": async (parameters) => {
    const userPath = String(parameters.path || "");
    if (!userPath) throw fsSafeErr("INVALID_PATH", "path must not be empty");

    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);

    if (isDenied(relativePath)) {
      throw fsSafeErr("PATH_DENIED", "Access to this path is denied by workspace policy");
    }

    let stats;
    try {
      stats = await fs.promises.stat(resolvedPath);
    } catch (statErr) {
      if (statErr.code === "ENOENT" || statErr.code === "ENOTDIR") {
        throw fsSafeErr("FILE_NOT_FOUND", "File not found: " + relativePath);
      }
      throw fsSafeErr("FILE_NOT_FOUND", "Cannot access path: " + relativePath);
    }

    if (!stats.isFile()) {
      throw fsSafeErr("INVALID_PATH", "Path is a directory, not a file: " + relativePath);
    }

    if (stats.size > fsConfig.maxReadBytes) {
      throw fsSafeErr(
        "FILE_TOO_LARGE",
        "File size " + stats.size + " bytes exceeds maxReadBytes " + fsConfig.maxReadBytes +
        ". Use a smaller file or request chunked reading (FS2)."
      );
    }

    const buf = await fs.promises.readFile(resolvedPath);

    if (isBinaryBuffer(buf)) {
      throw fsSafeErr(
        "BINARY_FILE_NOT_SUPPORTED",
        "Binary files are not supported in FS1. Use a text file."
      );
    }

    return {
      path: relativePath,
      sizeBytes: stats.size,
      content: buf.toString("utf8"),
      truncated: false
    };
  },

  "tool:fs-list-directory": async (parameters) => {
    const userPath = String(parameters.path || ".");
    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);

    if (isDenied(relativePath)) {
      throw fsSafeErr("PATH_DENIED", "Access to this directory is denied by workspace policy");
    }

    let dirEntries;
    try {
      dirEntries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    } catch (readdirErr) {
      if (readdirErr.code === "ENOENT") {
        throw fsSafeErr("FILE_NOT_FOUND", "Directory not found: " + (relativePath || "."));
      }
      if (readdirErr.code === "ENOTDIR") {
        throw fsSafeErr("INVALID_PATH", "Path is a file, not a directory: " + (relativePath || "."));
      }
      throw fsSafeErr("FILE_NOT_FOUND", "Cannot list directory: " + (relativePath || "."));
    }

    const entries = [];
    let hitLimit = false;

    for (const entry of dirEntries) {
      const entryRelPath = relativePath ? relativePath + "/" + entry.name : entry.name;

      // Silently skip denied entries
      if (isDenied(entryRelPath)) continue;

      let sizeBytes;
      try {
        const entryStat = await fs.promises.stat(path.join(resolvedPath, entry.name));
        if (entryStat.isFile()) sizeBytes = entryStat.size;
      } catch {
        // Skip unreadable entries
        continue;
      }

      const entryInfo = {
        name: entry.name,
        path: entryRelPath,
        type: entry.isDirectory() ? "directory" : "file"
      };
      if (sizeBytes !== undefined) entryInfo.sizeBytes = sizeBytes;
      entries.push(entryInfo);

      if (entries.length >= fsConfig.maxDirectoryEntries) {
        hitLimit = true;
        break;
      }
    }

    return {
      path: relativePath || ".",
      entries,
      truncated: hitLimit
    };
  },

  "tool:fs-stat": async (parameters) => {
    const userPath = String(parameters.path || "");
    if (!userPath) throw fsSafeErr("INVALID_PATH", "path must not be empty");

    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);

    if (isDenied(relativePath)) {
      throw fsSafeErr("PATH_DENIED", "Access to this path is denied by workspace policy");
    }

    let stats;
    try {
      stats = await fs.promises.stat(resolvedPath);
    } catch (statErr) {
      if (statErr.code === "ENOENT" || statErr.code === "ENOTDIR") {
        throw fsSafeErr("FILE_NOT_FOUND", "Path not found: " + relativePath);
      }
      throw fsSafeErr("FILE_NOT_FOUND", "Cannot access path: " + relativePath);
    }

    return {
      path: relativePath,
      type: stats.isDirectory() ? "directory" : "file",
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  },

  "tool:fs-search-files": async (parameters) => {
    const query = String(parameters.query || "").trim();
    if (!query) throw fsSafeErr("INVALID_PATH", "query must not be empty");

    const userPath = String(parameters.path || ".");
    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);

    if (isDenied(relativePath)) {
      throw fsSafeErr("PATH_DENIED", "Search path is denied by workspace policy");
    }

    const results = [];
    let truncated = false;

    const walkDir = async (dir, relDir) => {
      if (truncated) return;

      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (truncated) break;

        const entryRelPath = relDir ? relDir + "/" + entry.name : entry.name;

        // Silently skip denied paths
        if (isDenied(entryRelPath)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath, entryRelPath);
        } else if (entry.isFile()) {
          let fileStat;
          try {
            fileStat = await fs.promises.stat(fullPath);
          } catch {
            continue;
          }

          // Skip files exceeding search size limit
          if (fileStat.size > fsConfig.maxSearchFileBytes) continue;

          let buf;
          try {
            buf = await fs.promises.readFile(fullPath);
          } catch {
            continue;
          }

          // Skip binary files
          if (isBinaryBuffer(buf)) continue;

          const text = buf.toString("utf8");
          const lines = text.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              results.push({
                path: entryRelPath,
                line: i + 1,
                snippet: lines[i].slice(0, 200).trim()
              });
              if (results.length >= fsConfig.maxSearchResults) {
                truncated = true;
                break;
              }
            }
          }
        }
      }
    };

    await walkDir(resolvedPath, relativePath);

    return {
      query,
      searchPath: relativePath || ".",
      results,
      truncated
    };
  },
  "tool:fs-write-file": async (parameters) => {
    if (!fsWriteConfig.writesEnabled) throw fsSafeErr("TOOL_NOT_AVAILABLE", "Filesystem writes are disabled");

    const userPath = String(parameters.path || "");
    const content = String(parameters.content ?? "");
    const dryRun = Boolean(parameters.dryRun);
    if (!userPath) throw fsSafeErr("INVALID_PATH", "path must not be empty");

    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > fsWriteConfig.maxWriteBytes) throw fsSafeErr("WRITE_TOO_LARGE", "Write content exceeds maxWriteBytes");

    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);
    if (isDenied(relativePath)) throw fsSafeErr("PATH_DENIED", "Writes to this path are blocked by filesystem policy.");

    let before = "";
    let exists = true;
    try {
      before = (await fs.promises.readFile(resolvedPath)).toString("utf8");
    } catch {
      exists = false;
    }

    const diffOut = buildUnifiedDiff(relativePath, before, content);
    if (!dryRun) {
      await fs.promises.writeFile(resolvedPath, content, "utf8");
    }

    return {
      path: relativePath,
      operation: "write",
      dryRun,
      wouldChange: before !== content,
      changed: dryRun ? false : before !== content,
      approved: true,
      diff: diffOut.text,
      truncated: diffOut.truncated,
      hashBefore: exists ? toSha256(before) : null,
      hashAfter: toSha256(content),
      sizeBefore: Buffer.byteLength(before, "utf8"),
      sizeAfter: contentBytes
    };
  },
  "tool:fs-append-file": async (parameters) => {
    if (!fsWriteConfig.writesEnabled) throw fsSafeErr("TOOL_NOT_AVAILABLE", "Filesystem writes are disabled");

    const userPath = String(parameters.path || "");
    const content = String(parameters.content ?? "");
    const dryRun = Boolean(parameters.dryRun);
    if (!userPath) throw fsSafeErr("INVALID_PATH", "path must not be empty");

    const appendBytes = Buffer.byteLength(content, "utf8");
    if (appendBytes > fsWriteConfig.maxWriteBytes) throw fsSafeErr("WRITE_TOO_LARGE", "Append content exceeds maxWriteBytes");

    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);
    if (isDenied(relativePath)) throw fsSafeErr("PATH_DENIED", "Writes to this path are blocked by filesystem policy.");

    let before = "";
    let exists = true;
    try {
      before = (await fs.promises.readFile(resolvedPath)).toString("utf8");
    } catch {
      exists = false;
    }
    const after = before + content;
    const afterBytes = Buffer.byteLength(after, "utf8");
    if (afterBytes > fsWriteConfig.maxWriteBytes) throw fsSafeErr("WRITE_TOO_LARGE", "Resulting file exceeds maxWriteBytes");

    const diffOut = buildUnifiedDiff(relativePath, before, after);
    if (!dryRun) {
      await fs.promises.appendFile(resolvedPath, content, "utf8");
    }

    return {
      path: relativePath,
      operation: "append",
      dryRun,
      wouldChange: content.length > 0,
      changed: dryRun ? false : content.length > 0,
      approved: true,
      diff: diffOut.text,
      truncated: diffOut.truncated,
      hashBefore: exists ? toSha256(before) : null,
      hashAfter: toSha256(after),
      sizeBefore: Buffer.byteLength(before, "utf8"),
      sizeAfter: afterBytes
    };
  },
  "tool:fs-apply-patch": async (parameters) => {
    if (!fsWriteConfig.writesEnabled) throw fsSafeErr("TOOL_NOT_AVAILABLE", "Filesystem writes are disabled");

    const userPath = String(parameters.path || "");
    const patchText = String(parameters.patch ?? "");
    const dryRun = Boolean(parameters.dryRun);
    if (!userPath) throw fsSafeErr("INVALID_PATH", "path must not be empty");
    if (!patchText.trim()) throw fsSafeErr("PATCH_APPLY_FAILED", "patch must not be empty");
    if (Buffer.byteLength(patchText, "utf8") > fsWriteConfig.maxPatchBytes) {
      throw fsSafeErr("PATCH_TOO_LARGE", "Patch size exceeds maxPatchBytes");
    }

    const { resolvedPath, relativePath } = await resolveWorkspacePath(userPath);
    if (isDenied(relativePath)) throw fsSafeErr("PATH_DENIED", "Writes to this path are blocked by filesystem policy.");

    let before = "";
    try {
      before = (await fs.promises.readFile(resolvedPath)).toString("utf8");
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        throw fsSafeErr("FILE_NOT_FOUND", "File not found: " + relativePath);
      }
      throw fsSafeErr("FILE_NOT_FOUND", "Cannot access path: " + relativePath);
    }

    const after = applySingleFileUnifiedPatch(before, patchText);
    const afterBytes = Buffer.byteLength(after, "utf8");
    if (afterBytes > fsWriteConfig.maxWriteBytes) throw fsSafeErr("WRITE_TOO_LARGE", "Resulting file exceeds maxWriteBytes");

    const diffOut = buildUnifiedDiff(relativePath, before, after);
    if (!dryRun) {
      await fs.promises.writeFile(resolvedPath, after, "utf8");
    }
    return {
      path: relativePath,
      operation: "patch",
      dryRun,
      wouldChange: before !== after,
      changed: dryRun ? false : before !== after,
      approved: true,
      diff: diffOut.text,
      truncated: diffOut.truncated,
      hashBefore: toSha256(before),
      hashAfter: toSha256(after),
      sizeBefore: Buffer.byteLength(before, "utf8"),
      sizeAfter: afterBytes
    };
  },
  "tool:fs-rename-file": async (parameters) => {
    if (!fsWriteConfig.writesEnabled) throw fsSafeErr("TOOL_NOT_AVAILABLE", "Filesystem writes are disabled");
    const fromUserPath = String(parameters.fromPath || "");
    const toUserPath = String(parameters.toPath || "");
    const dryRun = Boolean(parameters.dryRun);
    if (!fromUserPath || !toUserPath) throw fsSafeErr("INVALID_PATH", "fromPath and toPath must not be empty");

    const fromResolved = await resolveWorkspacePath(fromUserPath);
    const toResolved = await resolveWorkspacePath(toUserPath);
    if (isDenied(fromResolved.relativePath) || isDenied(toResolved.relativePath)) {
      throw fsSafeErr("PATH_DENIED", "Writes to this path are blocked by filesystem policy.");
    }
    if (fromResolved.relativePath === toResolved.relativePath) {
      return {
        fromPath: fromResolved.relativePath,
        toPath: toResolved.relativePath,
        operation: "rename",
        dryRun,
        wouldChange: false,
        changed: false,
        approved: true
      };
    }

    try {
      const stat = await fs.promises.stat(fromResolved.resolvedPath);
      if (!stat.isFile()) throw fsSafeErr("INVALID_PATH", "Source path is not a file");
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        throw fsSafeErr("FILE_NOT_FOUND", "Source file not found: " + fromResolved.relativePath);
      }
      if (err && typeof err === "object" && "safeMessage" in err) throw err;
      throw fsSafeErr("FILE_NOT_FOUND", "Cannot access source path: " + fromResolved.relativePath);
    }

    if (!dryRun) {
      try {
        await fs.promises.rename(fromResolved.resolvedPath, toResolved.resolvedPath);
      } catch (err) {
        if (err && typeof err === "object" && "code" in err) {
          if (err.code === "ENOENT" || err.code === "ENOTDIR") {
            throw fsSafeErr("FILE_NOT_FOUND", "Source file or destination directory not found");
          }
          if (err.code === "EXDEV") {
            throw fsSafeErr("UNSUPPORTED_OPERATION", "Cross-device rename is not supported");
          }
          if (err.code === "EACCES" || err.code === "EPERM") {
            throw fsSafeErr("PATH_DENIED", "Writes to this path are blocked by filesystem policy.");
          }
        }
        throw fsSafeErr("UNSUPPORTED_OPERATION", "Rename failed");
      }
    }
    return {
      fromPath: fromResolved.relativePath,
      toPath: toResolved.relativePath,
      operation: "rename",
      dryRun,
      wouldChange: true,
      changed: !dryRun,
      approved: true
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
  "tool:gmail-list-messages": async (parameters) => {
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    if (payload.actorPrincipalType === "user") {
      payload.actorPrincipalType = "human_user";
    }
    const response = await fetch(baseUrl + "/integrations/google/gmail/messages/list", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_LIST_FAILED:" + response.status);
      err.code = "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-search-messages": async (parameters) => {
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    if (payload.actorPrincipalType === "user") {
      payload.actorPrincipalType = "human_user";
    }
    const response = await fetch(baseUrl + "/integrations/google/gmail/messages/search", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_SEARCH_FAILED:" + response.status);
      err.code = "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-get-message": async (parameters) => {
    const messageId = String(parameters.messageId || "").trim();
    if (!messageId) {
      const err = new Error("messageId is required");
      err.code = "INVALID_INPUT";
      throw err;
    }
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const response = await fetch(
      baseUrl + "/integrations/google/gmail/messages/" + encodeURIComponent(messageId)
    );
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_GET_MESSAGE_FAILED:" + response.status);
      err.code = "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-get-thread": async (parameters) => {
    const threadId = String(parameters.threadId || "").trim();
    if (!threadId) {
      const err = new Error("threadId is required");
      err.code = "INVALID_INPUT";
      throw err;
    }
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const response = await fetch(
      baseUrl + "/integrations/google/gmail/threads/" + encodeURIComponent(threadId)
    );
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_GET_THREAD_FAILED:" + response.status);
      err.code = "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-create-draft": async (parameters) => {
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    if (payload.actorPrincipalType === "user") payload.actorPrincipalType = "human_user";
    const response = await fetch(baseUrl + "/integrations/google/gmail/drafts/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_CREATE_DRAFT_FAILED:" + response.status);
      err.code = response.status === 202 ? "GMAIL_APPROVAL_REQUIRED" : "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-create-reply-draft": async (parameters) => {
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    if (payload.actorPrincipalType === "user") payload.actorPrincipalType = "human_user";
    const response = await fetch(baseUrl + "/integrations/google/gmail/drafts/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_CREATE_REPLY_DRAFT_FAILED:" + response.status);
      err.code = response.status === 202 ? "GMAIL_APPROVAL_REQUIRED" : "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-send-message": async (parameters) => {
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    if (payload.actorPrincipalType === "user") payload.actorPrincipalType = "human_user";
    const response = await fetch(baseUrl + "/integrations/google/gmail/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      // 202 means approval required — surface this explicitly so the caller knows to request approval
      const err = new Error("GMAIL_SEND_FAILED:" + response.status);
      err.code = response.status === 202 ? "GMAIL_SEND_APPROVAL_REQUIRED" : "TOOL_UPSTREAM_ERROR";
      err.details = body;
      err.approvalRequired = response.status === 202;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-archive-message": async (parameters) => {
    const messageId = String(parameters.messageId || "").trim();
    if (!messageId) {
      const err = new Error("messageId is required");
      err.code = "INVALID_INPUT";
      throw err;
    }
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    delete payload.messageId;
    if (payload.actorPrincipalType === "user") payload.actorPrincipalType = "human_user";
    const response = await fetch(
      baseUrl + "/integrations/google/gmail/messages/" + encodeURIComponent(messageId) + "/archive",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_ARCHIVE_FAILED:" + response.status);
      err.code = response.status === 202 ? "GMAIL_APPROVAL_REQUIRED" : "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
  },
  "tool:gmail-label-message": async (parameters) => {
    const messageId = String(parameters.messageId || "").trim();
    if (!messageId) {
      const err = new Error("messageId is required");
      err.code = "INVALID_INPUT";
      throw err;
    }
    const baseUrl = String(process.env.MANASVI_GATEWAY_URL || process.env.GATEWAY_URL || "http://127.0.0.1:4100");
    const payload = { ...(parameters || {}) };
    delete payload.messageId;
    if (payload.actorPrincipalType === "user") payload.actorPrincipalType = "human_user";
    const response = await fetch(
      baseUrl + "/integrations/google/gmail/messages/" + encodeURIComponent(messageId) + "/labels",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    const body = await response.json();
    if (!response.ok) {
      const err = new Error("GMAIL_LABEL_FAILED:" + response.status);
      err.code = response.status === 202 ? "GMAIL_APPROVAL_REQUIRED" : "TOOL_UPSTREAM_ERROR";
      err.details = body;
      throw err;
    }
    return body?.result ?? body;
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

  // Resolve workspace root for FS1 tools — realpath canonicalises macOS /tmp → /private/tmp
  const rawWorkspaceRoot = process.env.MANASVI_WORKSPACE_ROOT ?? "./workspace";
  const absWorkspaceRoot = rawWorkspaceRoot.startsWith("/")
    ? rawWorkspaceRoot
    : join(process.cwd(), rawWorkspaceRoot);
  const fs1WorkspaceRoot = await realpath(absWorkspaceRoot).catch(() => absWorkspaceRoot);
  const isFsTool = request.toolRef.startsWith("tool:fs-");

  const workerPayload = {
    toolRef: request.toolRef,
    operation: request.operation,
    parameters: request.parameters,
    runtimePolicy: {
      network: request.runtimePolicy.network,
      filesystem: {
        ...request.runtimePolicy.filesystem,
        readPaths: [
          ...request.runtimePolicy.filesystem.readPaths,
          inputDir,
          outputDir,
          scratchDir,
          runRoot,
          // FS1 tools need access to the workspace root for reads
          ...(isFsTool ? [fs1WorkspaceRoot] : [])
        ],
        writePaths: [
          ...request.runtimePolicy.filesystem.writePaths,
          outputDir,
          scratchDir,
          ...(isFsTool ? [fs1WorkspaceRoot] : [])
        ]
      }
    },
    injectedSecretRefs: injectedSecrets,
    // FS1 filesystem sandbox config — passed explicitly so worker does not rely on env vars
    fsConfig: {
      workspaceRoot: fs1WorkspaceRoot,
      maxReadBytes: parseInt(process.env.MANASVI_FS_MAX_READ_BYTES ?? "200000", 10),
      maxDirectoryEntries: parseInt(process.env.MANASVI_FS_MAX_DIRECTORY_ENTRIES ?? "500", 10),
      maxSearchResults: parseInt(process.env.MANASVI_FS_MAX_SEARCH_RESULTS ?? "50", 10),
      maxSearchFileBytes: parseInt(process.env.MANASVI_FS_MAX_SEARCH_FILE_BYTES ?? "200000", 10),
      writesEnabled: (process.env.MANASVI_FS_WRITES_ENABLED ?? "false").toLowerCase() === "true",
      requireApproval: (process.env.MANASVI_FS_WRITES_REQUIRE_APPROVAL ?? "true").toLowerCase() === "true",
      maxWriteBytes: parseInt(process.env.MANASVI_FS_MAX_WRITE_BYTES ?? "500000", 10),
      maxPatchBytes: parseInt(process.env.MANASVI_FS_MAX_PATCH_BYTES ?? "200000", 10),
      maxDiffBytes: parseInt(process.env.MANASVI_FS_MAX_DIFF_BYTES ?? "100000", 10)
    }
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
