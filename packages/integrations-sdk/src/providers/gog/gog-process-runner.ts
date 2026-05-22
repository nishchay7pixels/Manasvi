import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface GogProcessRequest {
  binaryPath?: string;
  args: string[];
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  cwd?: string;
  env?: Record<string, string>;
  redactArgs?: string[];
  correlationId?: string;
}

export interface GogProcessResult {
  ok: boolean;
  command: "gog";
  args: string[];
  redactedArgs: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: {
    stdout: boolean;
    stderr: boolean;
  };
  error?: string;
}

export type GogSpawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: ["ignore", "pipe", "pipe"];
  }
) => ChildProcessWithoutNullStreams;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 128 * 1024;

function minimalEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.XDG_CACHE_HOME ? { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME } : {}),
    ...(extra ?? {})
  };
}

export function redactGogArgs(args: string[], redactArgs: string[] = []): string[] {
  const redacted = new Set(redactArgs);
  return args.map((arg) => (redacted.has(arg) ? "<redacted>" : arg));
}

function appendLimited(
  current: Buffer,
  chunk: Buffer,
  maxBytes: number
): { buffer: Buffer; truncated: boolean } {
  if (current.length >= maxBytes) return { buffer: current, truncated: true };
  const remaining = maxBytes - current.length;
  if (chunk.length <= remaining) {
    return { buffer: Buffer.concat([current, chunk]), truncated: false };
  }
  return { buffer: Buffer.concat([current, chunk.subarray(0, remaining)]), truncated: true };
}

export async function runGogProcess(
  request: GogProcessRequest,
  spawnImpl: GogSpawn = spawn as GogSpawn
): Promise<GogProcessResult> {
  const started = Date.now();
  const command = request.binaryPath ?? "gog";
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdoutBytes = request.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = request.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  const redactedArgs = redactGogArgs(request.args, request.redactArgs);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(command, request.args, {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      env: minimalEnv(request.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return {
      ok: false,
      command: "gog",
      args: request.args,
      redactedArgs,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - started,
      timedOut: false,
      truncated: { stdout: false, stderr: false },
      error: error instanceof Error ? error.message : "Failed to start gog process."
    };
  }

  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 250).unref?.();
  }, timeoutMs);
  timeout.unref?.();

  child.stdout.on("data", (chunk: Buffer) => {
    const next = appendLimited(stdout, chunk, maxStdoutBytes);
    stdout = next.buffer;
    stdoutTruncated = stdoutTruncated || next.truncated;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const next = appendLimited(stderr, chunk, maxStderrBytes);
    stderr = next.buffer;
    stderrTruncated = stderrTruncated || next.truncated;
  });

  return new Promise((resolve) => {
    let spawnError: string | undefined;
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - started;
      const stdoutText = stdoutDecoder.write(stdout) + stdoutDecoder.end();
      const stderrText = stderrDecoder.write(stderr) + stderrDecoder.end();
      resolve({
        ok: exitCode === 0 && !timedOut && !spawnError,
        command: "gog",
        args: request.args,
        redactedArgs,
        exitCode,
        stdout: stdoutText,
        stderr: stderrText,
        durationMs,
        timedOut,
        truncated: {
          stdout: stdoutTruncated,
          stderr: stderrTruncated
        },
        ...(spawnError ? { error: spawnError } : {}),
        ...(timedOut ? { error: `gog command timed out after ${timeoutMs}ms.` } : {})
      });
    });
  });
}
