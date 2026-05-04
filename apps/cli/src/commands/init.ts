/**
 * manasvi init
 *
 * Initializes a local Manasvi environment:
 * - Creates ~/.manasvi/ config directory
 * - Generates all required secrets into .env.local
 * - Writes default config
 * - Validates prerequisites
 */

import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  banner,
  section,
  success,
  warn,
  error,
  info,
  hint,
  step,
  nextSteps,
  checkRow
} from "../lib/ui.js";
import {
  cliHomePath,
  logsDir,
  loadConfig,
  saveConfig,
  defaultConfig
} from "../lib/config.js";
import {
  fileExists,
  envFilePath,
  mergeEnvFile,
  findProjectRoot
} from "../lib/env.js";
import { generateLocalSecrets } from "../lib/secrets.js";

function checkNode(): { ok: boolean; version: string } {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);
  return { ok: major >= 20, version };
}

function checkPnpm(): boolean {
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkTsx(): boolean {
  try {
    execSync("node_modules/.bin/tsx --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isManasviRepo(projectRoot: string): boolean {
  try {
    statSync(join(projectRoot, "apps", "orchestrator-service"));
    return true;
  } catch {
    return false;
  }
}

export async function runInit(args: { force?: boolean; projectPath?: string; workspacePath?: string }): Promise<void> {
  banner("init");

  const projectRoot = findProjectRoot(args.projectPath);

  section("Checking prerequisites");

  const node = checkNode();
  checkRow("Node.js", node.ok ? "pass" : "fail", node.version + (node.ok ? "" : " (need ≥20)"));

  const hasPnpm = checkPnpm();
  checkRow("pnpm", hasPnpm ? "pass" : "warn", hasPnpm ? "" : "not found — install with: corepack enable");

  const hasTsx = checkTsx();
  checkRow("tsx", hasTsx ? "pass" : "warn", hasTsx ? "" : "run pnpm install first");

  const isRepo = isManasviRepo(projectRoot);
  checkRow(
    "Manasvi project",
    isRepo ? "pass" : "warn",
    isRepo ? projectRoot : "not detected at " + projectRoot
  );

  if (!node.ok) {
    error("Node.js 20+ is required. Please upgrade Node.js first.");
    process.exit(1);
  }

  section("Setting up CLI home");

  // Create ~/.manasvi/ directories
  const homeDir = cliHomePath();
  const logDir = logsDir();
  await mkdir(homeDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  success(`CLI home: ${homeDir}`);

  // Check existing config
  const existing = await loadConfig();
  if (existing?.initialized && !args.force) {
    warn("Manasvi is already initialized.");
    hint("Run with --force to reinitialize.");
    hint(`Config: ${homeDir}/config.json`);
    hint(`Env: ${projectRoot}/.env.local`);
    return;
  }

  // Write config
  const config = defaultConfig(projectRoot);
  const workspaceRoot = resolve(args.workspacePath ?? join(projectRoot, "workspace"));
  await mkdir(workspaceRoot, { recursive: true });
  config.workspacePath = workspaceRoot;
  config.initialized = true;
  await saveConfig(config);
  success("Config file written");

  section("Generating secrets");

  const envPath = envFilePath(projectRoot);
  const alreadyExists = await fileExists(envPath);

  if (alreadyExists && !args.force) {
    warn(".env.local already exists — preserving existing values");
    hint("Secrets that are missing will be added. Existing secrets are not overwritten.");
  }

  const secrets = generateLocalSecrets();

  // Base shared env vars (non-secrets)
  const baseEnv: Record<string, string> = {
    MANASVI_ENV: "local",
    LOG_LEVEL: "info",
    HUMAN_LOGS: "true",
    SECRET_PROVIDER: "env",
    SERVICE_VERSION: "0.1.0",
    EVENT_BUS_TARGET_URLS: "http://localhost:4102/internal/events",
    MAX_EVENT_HANDLER_ATTEMPTS: "5",
    INTERNAL_AUTH_ISSUER: "manasvi.internal.auth",
    INTERNAL_AUTH_AUDIENCE: "manasvi.internal.services",
    INTERNAL_AUTH_TOKEN_TTL_SECONDS: "120",
    POLICY_SERVICE_BASE_URL: "http://localhost:4103",
    APPROVAL_SERVICE_BASE_URL: "http://localhost:4108",
    EXECUTION_MANAGER_BASE_URL: "http://localhost:4104",
    MEMORY_SERVICE_BASE_URL: "http://localhost:4105",
    ORCHESTRATOR_BASE_URL: "http://localhost:4102",
    APPROVAL_REQUEST_TTL_SECONDS: "3600",
    APPROVED_ARTIFACT_TTL_SECONDS: "900",
    APPROVAL_AUDIT_BUFFER_SIZE: "1000",
    EXECUTION_INTENT_TTL_SECONDS: "900",
    EXECUTION_TOKEN_TTL_SECONDS: "90",
    SANDBOX_ROOT_DIR: "/tmp/manasvi-runs",
    SANDBOX_MAX_OUTPUT_BYTES: "65536",
    SANDBOX_PROFILE_DEFAULT: "read_only",
    POLICY_SET_PATH: "configs/policies/default-policy-set.json",
    SESSION_DEFAULT_ISOLATION_MODE: "per_user_isolated",
    SESSION_CONTEXT_TOKEN_BUDGET: "2048",
    SESSION_RECENT_MESSAGE_LIMIT: "20",
    AGENT_LOOP_MAX_ITERATIONS: "6",
    AGENT_LOOP_MAX_CONSECUTIVE_FAILURES: "2",
    AGENT_LOOP_STRICT_PLANNER_PARSING: "true",
    MEMORY_EPHEMERAL_TTL_SECONDS: "3600",
    MEMORY_UNTRUSTED_TTL_SECONDS: "7200",
    MEMORY_RETENTION_PRUNE_INTERVAL_SECONDS: "300",
    MEMORY_ENCRYPTION_KEY_REF: "memory-key:local",
    WEBUI_ADAPTER_REQUIRE_AUTH: "true",
    INGRESS_RATE_LIMIT_WINDOW_MS: "60000",
    INGRESS_RATE_LIMIT_MAX_PER_SOURCE: "60",
    INGRESS_ANTI_SPAM_DUPLICATE_TTL_MS: "10000",
    MODEL_ADAPTER_MODE: "deepseek",
    MANASVI_MODEL_PROVIDER: "deepseek",
    MANASVI_MODEL: "deepseek-v4-flash",
    PLANNER_MODEL: "deepseek-v4-flash",
    MODEL_ADAPTER_TIMEOUT_MS: "60000",
    MODEL_ADAPTER_MAX_CONTEXT_CHUNKS: "24",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    OLLAMA_BASE_URL: "http://localhost:11434/v1",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    DEEPSEEK_TIMEOUT_MS: "60000",
    TELEGRAM_API_BASE_URL: "https://api.telegram.org",
    REPLY_POLL_TIMEOUT_MS: "12000",
    REPLY_POLL_INTERVAL_MS: "300",
    HARNESS_POLL_TIMEOUT_MS: "12000",
    HARNESS_POLL_INTERVAL_MS: "250",
    HARNESS_EVENT_RESULT_TTL_SECONDS: "900",
    AUDIT_APPEND_ONLY_MODE: "true",
    AUDIT_STORAGE_FILE_PATH: "/tmp/manasvi/audit/audit-events.jsonl",
    AUDIT_DEFAULT_RISK_WINDOW_MINUTES: "60",
    AUDIT_DECISION_AUDIT_BUFFER_SIZE: "500",
    NODE_PAIRING_TTL_SECONDS: "600",
    NODE_CREDENTIAL_TTL_SECONDS: "300",
    NODE_HEARTBEAT_STALE_SECONDS: "90",
    NODE_DISPATCH_TIMEOUT_MS: "20000",
    NODE_CREDENTIAL_ISSUER: "manasvi.node-manager",
    NODE_CREDENTIAL_AUDIENCE: "manasvi.node-agent",
    NODE_MANAGER_BASE_URL: "http://localhost:4106",
    NODE_ID: "node:local-agent",
    NODE_CLASS: "restricted_utility_node",
    EXECUTION_EGRESS_WHITELIST_POLICY_JSON:
      '{"schemaVersion":"1.0","policyId":"egress:local-default-deny","description":"Default deny egress policy for local runtime","rules":[]}',
    MANASVI_WORKSPACE_ROOT: workspaceRoot
  };

  await mergeEnvFile(envPath, { ...baseEnv, ...secrets }, {
    section: "Generated by manasvi init"
  });

  const secretCount = Object.keys(secrets).length;
  success(`Generated ${secretCount} secrets → .env.local`);

  section("Done");
  success("Manasvi initialized successfully");
  info(`Workspace root: ${workspaceRoot}`);

  nextSteps([
    `Run ${"`pnpm manasvi onboard`"} to configure your model provider and channels`,
    `Or run ${"`pnpm manasvi start`"} to start with defaults (DeepSeek model mode)`
  ]);
}
