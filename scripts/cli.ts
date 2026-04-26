#!/usr/bin/env tsx
/**
 * Manasvi Terminal CLI
 *
 * Interactive REPL for talking to Manasvi from the terminal.
 * Requires all services to be running (pnpm dev).
 *
 * Usage:
 *   pnpm cli
 *   pnpm cli --actor user:alice
 *   GATEWAY_URL=http://localhost:4100 pnpm cli
 */

import * as readline from "node:readline";
import { randomUUID } from "node:crypto";

// ── Config ─────────────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4100";
const TENANT_ID = process.env.CLI_TENANT_ID ?? "tenant-local";
const WORKSPACE_ID = process.env.CLI_WORKSPACE_ID ?? "workspace-local";
const _actorFlagIdx = process.argv.indexOf("--actor");
const ACTOR_ARG = process.argv.find((a) => a.startsWith("--actor="))?.split("=")[1]
  ?? (_actorFlagIdx !== -1 ? process.argv[_actorFlagIdx + 1] : undefined);
const ACTOR_PRINCIPAL_ID = ACTOR_ARG ?? process.env.CLI_ACTOR ?? "user:terminal";

// ── State ──────────────────────────────────────────────────────────────────────

let sessionId: string | undefined = undefined;
let turnCount = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractResponseText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;

  if (typeof r.responseText === "string" && r.responseText.trim()) {
    return r.responseText.trim();
  }
  const outcome = r.outcome as Record<string, unknown> | undefined;
  if (outcome && typeof outcome.responseText === "string" && outcome.responseText.trim()) {
    return outcome.responseText.trim();
  }
  return "";
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

async function sendMessage(text: string): Promise<{
  responseText: string;
  sessionId?: string;
  elapsedMs: number;
  eventId?: string;
}> {
  const start = Date.now();
  const channelMessageId = `cli:${randomUUID()}`;

  const body: Record<string, unknown> = {
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    actorPrincipalId: ACTOR_PRINCIPAL_ID,
    actorPrincipalType: "human_user",
    channelPrincipalId: "channel:terminal",
    channelMessageId,
    message: text,
    ...(sessionId ? { sessionId } : {})
  };

  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/test-harness/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot reach gateway at ${GATEWAY_URL}: ${msg}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const elapsedMs = Date.now() - start;

  if (!res.ok) {
    const detail = (json.detail as string) ?? (json.error as string) ?? JSON.stringify(json);
    throw new Error(`Gateway error (${res.status}): ${detail}`);
  }

  const result = json.result as Record<string, unknown> | undefined;
  const responseText = extractResponseText(result ?? json);
  const returnedSessionId = (result?.sessionId ?? json.sessionId) as string | undefined;

  return {
    responseText: responseText || "(no response text)",
    sessionId: returnedSessionId,
    elapsedMs,
    eventId: json.eventId as string | undefined
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function banner(): void {
  console.log(`\n${BOLD}${CYAN}Manasvi${RESET} ${DIM}terminal${RESET}`);
  console.log(`${DIM}Gateway  ${RESET}${GATEWAY_URL}`);
  console.log(`${DIM}Actor    ${RESET}${ACTOR_PRINCIPAL_ID}`);
  console.log(`${DIM}Tenant   ${RESET}${TENANT_ID} / ${WORKSPACE_ID}`);
  console.log(`${DIM}─────────────────────────────────────────────${RESET}`);
  console.log(`${DIM}Type a message and press Enter. Ctrl+C to exit.${RESET}\n`);
}

function printResponse(text: string, meta: { elapsedMs: number; sessionId?: string; turn: number }): void {
  const lines = text.split("\n");
  console.log(`\n${BOLD}${GREEN}Manasvi${RESET}`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log(
    `\n${DIM}  turn ${meta.turn} · ${formatMs(meta.elapsedMs)}` +
    (meta.sessionId ? ` · session ${meta.sessionId.slice(0, 12)}…` : "") +
    RESET
  );
  console.log();
}

function printError(msg: string): void {
  console.error(`\n${RED}Error:${RESET} ${msg}\n`);
}

function printSpinner(text: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stdout.write(`\r${DIM}${frames[i]} ${text}${RESET}`);
  const interval = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${DIM}${frames[i]} ${text}${RESET}`);
  }, 80);
  return () => {
    clearInterval(interval);
    process.stdout.write("\r\x1b[K"); // clear line
  };
}

// ── Commands ───────────────────────────────────────────────────────────────────

function handleCommand(input: string): boolean {
  const cmd = input.trim().toLowerCase();

  if (cmd === "/help" || cmd === "/h") {
    console.log(`
${BOLD}Commands:${RESET}
  ${CYAN}/help${RESET}       Show this help
  ${CYAN}/session${RESET}    Show current session ID
  ${CYAN}/new${RESET}        Start a new session (clears context)
  ${CYAN}/actor${RESET}      Show current actor principal ID
  ${CYAN}/exit${RESET}       Exit the CLI
`);
    return true;
  }

  if (cmd === "/session" || cmd === "/s") {
    if (sessionId) {
      console.log(`${DIM}Session: ${RESET}${sessionId}`);
    } else {
      console.log(`${DIM}No session started yet.${RESET}`);
    }
    console.log();
    return true;
  }

  if (cmd === "/new") {
    sessionId = undefined;
    turnCount = 0;
    console.log(`${YELLOW}Started new session.${RESET}\n`);
    return true;
  }

  if (cmd === "/actor") {
    console.log(`${DIM}Actor: ${RESET}${ACTOR_PRINCIPAL_ID}\n`);
    return true;
  }

  if (cmd === "/exit" || cmd === "/quit" || cmd === "/q") {
    console.log(`\n${DIM}Goodbye.${RESET}\n`);
    process.exit(0);
  }

  if (cmd.startsWith("/")) {
    console.log(`${YELLOW}Unknown command: ${cmd}. Type /help for a list.${RESET}\n`);
    return true;
  }

  return false;
}

// ── Main REPL ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BOLD}${MAGENTA}You${RESET}  `
  });

  rl.prompt();

  rl.on("line", async (raw) => {
    const input = raw.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (handleCommand(input)) {
      rl.prompt();
      return;
    }

    const stopSpinner = printSpinner("thinking…");

    try {
      turnCount++;
      const response = await sendMessage(input);

      if (response.sessionId) {
        sessionId = response.sessionId;
      }

      stopSpinner();
      printResponse(response.responseText, {
        elapsedMs: response.elapsedMs,
        sessionId,
        turn: turnCount
      });
    } catch (err) {
      stopSpinner();
      printError(err instanceof Error ? err.message : String(err));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n${DIM}Goodbye.${RESET}\n`);
    process.exit(0);
  });
}

void main();
