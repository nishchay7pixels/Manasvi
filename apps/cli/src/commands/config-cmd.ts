/**
 * manasvi config <show|validate|path|edit|explain>
 */

import { execSync } from "node:child_process";
import { banner, section, info, success, warn, hint, table, style } from "../lib/ui.js";
import { loadConfig, configFilePath, cliHomePath } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";
import { confirm } from "../lib/prompt.js";
import {
  printJson, jsonOk, jsonFail, isSensitiveKey, maskValue, maskEnvMap,
  type CliError
} from "../lib/json.js";

// ── show ──────────────────────────────────────────────────────────────────────

export async function runConfigShow(opts: {
  json?: boolean;
  showSecrets?: boolean;
  yes?: boolean;
} = {}): Promise<void> {
  const config = await loadConfig();

  if (opts.json) {
    if (!config) {
      printJson(jsonFail("config show", [{ code: "config.missing", message: "No config found", fix: "pnpm manasvi init" }]));
      process.exit(1);
    }
    // Mask sensitive model settings
    const safeConfig = {
      ...config,
      model: { ...config.model }
    };
    printJson(jsonOk("config show", safeConfig));
    return;
  }

  banner("config");

  if (!config) {
    warn("No config found. Run: pnpm manasvi init");
    return;
  }

  // If user wants raw secrets, require confirmation unless --yes
  if (opts.showSecrets && !opts.yes) {
    const ok = await confirm(
      "Show unmasked secret values? This will print credentials to your terminal.",
      false
    );
    if (!ok) {
      info("Cancelled. Showing masked output instead.");
      opts.showSecrets = false;
    }
  }

  section("CLI Config");
  table([
    { label: "Profile", value: config.profile },
    { label: "Project", value: config.projectPath },
    { label: "Workspace", value: config.workspacePath },
    { label: "Initialized", value: config.initialized ? "yes" : "no", status: config.initialized ? "ok" : "error" },
    { label: "Onboarded", value: config.onboarded ? "yes" : "no", status: config.onboarded ? "ok" : "warn" }
  ]);

  section("Model");
  table([
    { label: "Provider", value: config.model.provider },
    { label: "Ollama URL", value: config.model.ollamaBaseUrl },
    { label: "Ollama model", value: config.model.ollamaModel },
    { label: "OpenAI model", value: config.model.openaiModel },
    { label: "Claude URL", value: config.model.claudeBaseUrl },
    { label: "Claude model", value: config.model.claudeModel }
  ]);

  section("Channels");
  const telegramStatus = config.channels.telegram?.enabled ? "enabled" : "disabled";
  const slackStatus = config.channels.slack?.enabled ? "enabled" : "disabled";
  table([
    { label: "Telegram", value: telegramStatus, status: config.channels.telegram?.enabled ? "ok" : "dim" },
    { label: "Slack", value: slackStatus, status: config.channels.slack?.enabled ? "ok" : "dim" }
  ]);

  section("Service Ports");
  const s = config.services;
  table([
    { label: "API Gateway", value: String(s.gatewayPort) },
    { label: "Ingress", value: String(s.ingressPort) },
    { label: "Orchestrator", value: String(s.orchestratorPort) },
    { label: "Policy", value: String(s.policyPort) },
    { label: "Execution Manager", value: String(s.executionPort) },
    { label: "Memory", value: String(s.memoryPort) },
    { label: "Node Manager", value: String(s.nodeManagerPort) },
    { label: "Audit", value: String(s.auditPort) },
    { label: "Approval", value: String(s.approvalPort) }
  ]);

  // Show env summary with masked secrets
  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);
  if (envExists) {
    const env = await readEnvFile(envPath);
    const sensitiveKeys = Object.keys(env).filter(isSensitiveKey);

    section("Environment (.env.local)");
    const envRows = Object.entries(env)
      .filter(([k]) => !k.startsWith("#"))
      .slice(0, 12) // show a limited preview
      .map(([k, v]) => {
        const show = opts.showSecrets ? v : (isSensitiveKey(k) ? maskValue(v) : v);
        return { label: k, value: show };
      });
    table(envRows);

    if (sensitiveKeys.length > 0 && !opts.showSecrets) {
      console.log();
      hint(`${sensitiveKeys.length} secret(s) masked. Run \`config show --secrets\` to view.`);
    }
    if (Object.keys(env).length > 12) {
      hint(`...and ${Object.keys(env).length - 12} more variables. Edit directly: ${envPath}`);
    }
  }

  section("Files");
  hint(`Config: ${configFilePath()}`);
  hint(`Env:    ${envPath}`);
  console.log();
}

// ── path ──────────────────────────────────────────────────────────────────────

export async function runConfigPath(): Promise<void> {
  console.log(configFilePath());
}

// ── validate ──────────────────────────────────────────────────────────────────

export async function runConfigValidate(opts: { json?: boolean } = {}): Promise<void> {
  const errors: CliError[] = [];
  const config = await loadConfig();

  if (!config) {
    const err: CliError = { code: "config.missing", message: "No config found", fix: "pnpm manasvi init" };
    if (opts.json) {
      printJson(jsonFail("config validate", [err]));
      process.exit(1);
    }
    warn("No config found. Run: pnpm manasvi init");
    process.exit(1);
  }

  if (!opts.json) {
    banner("config validate");
    section("Config file");
    success("Config file is valid JSON");
    section("Environment");
  }

  const envPath = envFilePath(config.projectPath);
  const envExists = await fileExists(envPath);

  if (!envExists) {
    errors.push({ code: "env.missing", message: `.env.local not found at ${envPath}`, fix: "pnpm manasvi init" });
    if (!opts.json) {
      warn(".env.local not found at " + envPath);
      hint("Run: pnpm manasvi init");
    }
  } else {
    if (!opts.json) success(".env.local exists");
    const env = await readEnvFile(envPath);

    const required = [
      "INTERNAL_AUTH_KEY_ID",
      "INTERNAL_AUTH_SIGNING_SECRET",
      "APPROVAL_SIGNING_KEYS",
      "APPROVAL_VERIFICATION_KEYS",
      "EVENT_SIGNING_KEYS"
    ];

    for (const key of required) {
      if (!env[key] || env[key] === "replace-me") {
        errors.push({ code: "env.missing_key", message: `${key} is not set`, fix: "pnpm manasvi init --force" });
        if (!opts.json) warn(`${key} is not set`);
      } else {
        if (!opts.json) success(`${key} is set`);
      }
    }
  }

  if (opts.json) {
    if (errors.length > 0) {
      printJson(jsonFail("config validate", errors, null, {
        nextSteps: ["pnpm manasvi init", "pnpm manasvi doctor"]
      }));
      process.exit(1);
    } else {
      printJson(jsonOk("config validate", { valid: true }));
    }
    return;
  }

  console.log();
  if (errors.length === 0) {
    success("Configuration is valid");
  } else {
    warn("Configuration has issues — run `pnpm manasvi doctor` for more detail");
    process.exit(1);
  }
}

// ── edit ──────────────────────────────────────────────────────────────────────

export async function runConfigEdit(): Promise<void> {
  const path = configFilePath();
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nano";
  info(`Opening ${path} in ${editor}`);
  try {
    execSync(`${editor} "${path}"`, { stdio: "inherit" });
  } catch {
    warn("Editor exited with error. Config may not have been saved.");
    hint(`Edit manually: ${path}`);
  }
}

// ── explain ───────────────────────────────────────────────────────────────────

interface EnvVarDoc {
  description: string;
  sensitive: boolean;
  storedIn: string;
  validValues?: string;
  configuredBy?: string;
}

const ENV_DOCS: Record<string, EnvVarDoc> = {
  MODEL_ADAPTER_MODE: {
    description: "Which AI model provider Manasvi uses for planning and generating responses.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "deepseek | ollama | openai | claude | mock",
    configuredBy: "pnpm manasvi models use <provider>  or  pnpm manasvi onboard"
  },
  MANASVI_MODEL_PROVIDER: {
    description: "Alias for MODEL_ADAPTER_MODE kept for backwards compatibility.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "deepseek | ollama | openai | claude | mock",
    configuredBy: "pnpm manasvi models use <provider>"
  },
  PLANNER_MODEL: {
    description: "Model name/ID passed to the active provider for the planner agent.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "e.g. deepseek-v4-flash, llama3.2, gpt-4o-mini, claude-3-5-sonnet-latest",
    configuredBy: "pnpm manasvi models add <provider>  or  pnpm manasvi onboard"
  },
  TELEGRAM_ADAPTER_MODE: {
    description: "How Manasvi receives Telegram messages. Polling is recommended for local dev (no public URL needed). Webhook requires a public HTTPS endpoint.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "polling | webhook",
    configuredBy: "pnpm manasvi channels add telegram"
  },
  TELEGRAM_BOT_TOKEN: {
    description: "The authentication token for your Telegram bot, obtained from @BotFather.",
    sensitive: true,
    storedIn: ".env.local",
    validValues: "Format: <numeric-id>:<random-string>",
    configuredBy: "pnpm manasvi channels add telegram"
  },
  DEEPSEEK_API_KEY: {
    description: "API key for DeepSeek AI cloud model service.",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi models add deepseek"
  },
  OPENAI_API_KEY: {
    description: "API key for OpenAI API (GPT models).",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi models add openai"
  },
  ANTHROPIC_API_KEY: {
    description: "API key for Anthropic API (Claude models).",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi models add claude"
  },
  MANASVI_FS_WRITES_ENABLED: {
    description: "Whether the filesystem write tool is enabled. When true, the agent can write files to the workspace. Requires approval by default.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "true | false (default: false)",
    configuredBy: "Edit .env.local directly"
  },
  MANASVI_FS_WRITES_REQUIRE_APPROVAL: {
    description: "Whether filesystem write actions must be approved before execution. Set to true (default) for safe local operation.",
    sensitive: false,
    storedIn: ".env.local",
    validValues: "true | false (default: true)",
    configuredBy: "Edit .env.local directly"
  },
  MANASVI_HOME: {
    description: "Override for the Manasvi CLI home directory (default: ~/.manasvi). Change this to use a different location for config and logs.",
    sensitive: false,
    storedIn: "Environment variable (shell/profile)",
    validValues: "Absolute path",
    configuredBy: "Set in shell environment: export MANASVI_HOME=/path/to/dir"
  },
  MANASVI_PROJECT: {
    description: "Override for the Manasvi project root (default: current working directory).",
    sensitive: false,
    storedIn: "Environment variable (shell/profile)",
    validValues: "Absolute path",
    configuredBy: "Set in shell environment: export MANASVI_PROJECT=/path/to/repo"
  },
  INTERNAL_AUTH_SIGNING_SECRET: {
    description: "Cryptographic signing secret for internal service-to-service authentication JWTs. Auto-generated by init.",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi init (auto-generated)"
  },
  APPROVAL_SIGNING_KEYS: {
    description: "JSON array of signing key objects for the approval service. Auto-generated by init.",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi init (auto-generated)"
  },
  MEMORY_ENCRYPTION_KEY: {
    description: "Key used to encrypt memory entries in the memory service. Auto-generated by init.",
    sensitive: true,
    storedIn: ".env.local",
    configuredBy: "pnpm manasvi init (auto-generated)"
  }
};

export async function runConfigExplain(varName?: string): Promise<void> {
  if (!varName) {
    // List all documented variables
    banner("config explain");
    info("Documented environment variables:");
    console.log();
    const groups = [
      { title: "Model", keys: ["MODEL_ADAPTER_MODE", "MANASVI_MODEL_PROVIDER", "PLANNER_MODEL", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] },
      { title: "Channels", keys: ["TELEGRAM_ADAPTER_MODE", "TELEGRAM_BOT_TOKEN"] },
      { title: "Security", keys: ["MANASVI_FS_WRITES_ENABLED", "MANASVI_FS_WRITES_REQUIRE_APPROVAL", "INTERNAL_AUTH_SIGNING_SECRET", "APPROVAL_SIGNING_KEYS", "MEMORY_ENCRYPTION_KEY"] },
      { title: "Paths", keys: ["MANASVI_HOME", "MANASVI_PROJECT"] }
    ];

    for (const g of groups) {
      console.log(style.bold(`${g.title}:`));
      for (const key of g.keys) {
        const doc = ENV_DOCS[key];
        const sens = doc?.sensitive ? style.yellow(" [secret]") : "";
        console.log(`  ${style.cyan(key.padEnd(38))}${sens}`);
        if (doc) console.log(`    ${style.dim(doc.description)}`);
      }
      console.log();
    }

    hint("Run `pnpm manasvi config explain <VAR_NAME>` for full details on a variable.");
    return;
  }

  const key = varName.toUpperCase();
  const doc = ENV_DOCS[key];

  if (!doc) {
    warn(`No documentation found for: ${key}`);
    hint("Run `pnpm manasvi config explain` to list all documented variables.");
    return;
  }

  console.log(`
${style.boldCyan(key)}${doc.sensitive ? style.yellow("  [sensitive]") : ""}

  ${doc.description}

${style.bold("  Stored in:")}   ${doc.storedIn}
${doc.validValues ? `${style.bold("  Valid values:")} ${doc.validValues}\n` : ""}${doc.configuredBy ? `${style.bold("  Configure:")}   ${doc.configuredBy}\n` : ""}
`);
}
