/**
 * CLI configuration — persisted in ~/.manasvi/config.json
 * Tracks model provider, channels, UI prefs, and project path.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileExists } from "./env.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ModelProvider = "deepseek" | "ollama" | "openai" | "claude" | "mock";
export type ChannelMode = "polling" | "webhook";

export interface ManasviConfig {
  version: "1";
  profile: "local" | "staging" | "production";
  projectPath: string;
  workspacePath: string;
  initialized: boolean;
  onboarded: boolean;
  model: {
    provider: ModelProvider;
    deepseekBaseUrl: string;
    deepseekModel: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    openaiBaseUrl: string;
    openaiModel: string;
    claudeBaseUrl: string;
    claudeModel: string;
  };
  channels: {
    telegram?: {
      enabled: boolean;
      /** "polling" = Manasvi polls Telegram (default, no public URL needed). "webhook" = Telegram pushes updates. */
      mode: "polling" | "webhook";
      /** Required only in webhook mode. The public HTTPS base URL where Telegram will deliver updates. */
      webhookUrl?: string;
    };
    slack?: { enabled: boolean };
  };
  integrations: {
    google?: {
      enabled: boolean;
      scopes: string[];
    };
  };
  ui: {
    docsEnabled: boolean;
    docsPort: number;
  };
  services: {
    gatewayPort: number;
    ingressPort: number;
    orchestratorPort: number;
    policyPort: number;
    executionPort: number;
    memoryPort: number;
    nodeManagerPort: number;
    auditPort: number;
    approvalPort: number;
  };
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export function defaultConfig(projectPath: string): ManasviConfig {
  const resolvedProject = resolve(projectPath);
  return {
    version: "1",
    profile: "local",
    projectPath: resolvedProject,
    workspacePath: resolve(resolvedProject, "workspace"),
    initialized: false,
    onboarded: false,
    model: {
      provider: "deepseek",
      deepseekBaseUrl: "https://api.deepseek.com",
      deepseekModel: "deepseek-v4-flash",
      ollamaBaseUrl: "http://localhost:11434/v1",
      ollamaModel: "llama3.2",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-mini",
      claudeBaseUrl: "https://api.anthropic.com",
      claudeModel: "claude-3-5-sonnet-latest"
    },
    channels: {},
    integrations: {},
    ui: {
      docsEnabled: true,
      docsPort: 3002
    },
    services: {
      gatewayPort: 4100,
      ingressPort: 4101,
      orchestratorPort: 4102,
      policyPort: 4103,
      executionPort: 4104,
      memoryPort: 4105,
      nodeManagerPort: 4106,
      auditPort: 4107,
      approvalPort: 4108
    }
  };
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function cliHomePath(): string {
  return process.env.MANASVI_HOME ?? join(homedir(), ".manasvi");
}

export function configFilePath(): string {
  return join(cliHomePath(), "config.json");
}

export function pidFilePath(): string {
  return join(cliHomePath(), "pids.json");
}

export function logsDir(): string {
  return join(cliHomePath(), "logs");
}

// ── Read/write ────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<ManasviConfig | null> {
  const path = configFilePath();
  if (!(await fileExists(path))) return null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ManasviConfig>;
    const projectPath = parsed.projectPath ?? process.cwd();
    const defaults = defaultConfig(projectPath);
    return {
      ...defaults,
      ...parsed,
      model: {
        ...defaults.model,
        ...(parsed.model ?? {})
      },
      channels: {
        ...defaults.channels,
        ...(parsed.channels ?? {})
      },
      integrations: {
        ...defaults.integrations,
        ...(parsed.integrations ?? {})
      },
      ui: {
        ...defaults.ui,
        ...(parsed.ui ?? {})
      },
      services: {
        ...defaults.services,
        ...(parsed.services ?? {})
      }
    };
  } catch {
    return null;
  }
}

export async function saveConfig(config: ManasviConfig): Promise<void> {
  const dir = cliHomePath();
  await mkdir(dir, { recursive: true });
  await writeFile(configFilePath(), JSON.stringify(config, null, 2), "utf8");
}

export async function updateConfig(patch: Partial<ManasviConfig>): Promise<ManasviConfig> {
  const existing = await loadConfig();
  const projectPath = existing?.projectPath ?? process.cwd();
  const merged: ManasviConfig = {
    ...(existing ?? defaultConfig(projectPath)),
    ...patch
  };
  await saveConfig(merged);
  return merged;
}

export async function requireConfig(): Promise<ManasviConfig> {
  const config = await loadConfig();
  if (!config?.initialized) {
    console.error(
      "\nManasvi is not initialized. Run:\n\n  pnpm manasvi init\n"
    );
    process.exit(1);
  }
  return config;
}

// ── PID tracking ──────────────────────────────────────────────────────────────

export interface PidMap {
  [serviceName: string]: number;
}

export async function loadPids(): Promise<PidMap> {
  const path = pidFilePath();
  if (!(await fileExists(path))) return {};
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as PidMap;
  } catch {
    return {};
  }
}

export async function savePids(pids: PidMap): Promise<void> {
  const dir = cliHomePath();
  await mkdir(dir, { recursive: true });
  await writeFile(pidFilePath(), JSON.stringify(pids, null, 2), "utf8");
}
