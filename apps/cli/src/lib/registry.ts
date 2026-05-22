/**
 * Central command registry.
 * Defines every command's metadata for help, validation, and discoverability.
 */

export type CommandStatus = "stable" | "experimental" | "scaffolded" | "operator-only" | "dev-only";
export type CommandGroup =
  | "getting-started"
  | "lifecycle"
  | "configuration"
  | "governance"
  | "integrations"
  | "advanced"
  | "docs";

export interface FlagDef {
  flag: string;
  alias?: string;
  type: "boolean" | "string";
  description: string;
  default?: string;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  group: CommandGroup;
  status: CommandStatus;
  description: string;
  syntax: string;
  examples: string[];
  flags?: FlagDef[];
  subcommands?: SubcommandDef[];
  mutatesState?: boolean;
  secretSensitive?: boolean;
  requiresInit?: boolean;
  notes?: string;
}

export interface SubcommandDef {
  name: string;
  description: string;
  syntax: string;
  examples?: string[];
  flags?: FlagDef[];
  status?: CommandStatus;
  notes?: string;
}

// ── Global flags (apply to all commands) ──────────────────────────────────────

export const GLOBAL_FLAGS: FlagDef[] = [
  { flag: "--help", alias: "-h", type: "boolean", description: "Show help for this command" },
  { flag: "--verbose", alias: "-v", type: "boolean", description: "Verbose output" },
  { flag: "--yes", alias: "-y", type: "boolean", description: "Non-interactive mode (accept safe defaults)" },
  { flag: "--force", type: "boolean", description: "Force re-run or bypass already-done checks" },
  { flag: "--json", type: "boolean", description: "Output machine-readable JSON" },
  { flag: "--no-color", type: "boolean", description: "Disable ANSI color codes" }
];

// ── Command registry ───────────────────────────────────────────────────────────

export const COMMAND_REGISTRY: CommandDef[] = [
  // ── Getting started ──────────────────────────────────────────────────────────
  {
    name: "setup",
    group: "getting-started",
    status: "stable",
    description: "Guided first-run setup — runs init, configures model and channels, runs doctor",
    syntax: "pnpm manasvi setup [--profile <demo|dev|telegram|google>] [--yes]",
    examples: [
      "pnpm manasvi setup",
      "pnpm manasvi setup --profile demo",
      "pnpm manasvi setup --profile telegram --yes"
    ],
    flags: [
      { flag: "--profile", type: "string", description: "Setup profile: demo | dev | telegram | google | advanced" },
      { flag: "--yes", alias: "-y", type: "boolean", description: "Non-interactive mode" }
    ],
    mutatesState: true,
    requiresInit: false,
    notes: "Composes init + onboard internally. Safe to re-run."
  },
  {
    name: "init",
    group: "getting-started",
    status: "stable",
    description: "Initialize Manasvi locally — creates ~/.manasvi/ and generates secrets into .env.local",
    syntax: "pnpm manasvi init [--force] [--project <path>] [--workspace <path>]",
    examples: [
      "pnpm manasvi init",
      "pnpm manasvi init --force",
      "pnpm manasvi init --workspace /tmp/manasvi-workspace"
    ],
    flags: [
      { flag: "--force", type: "boolean", description: "Reinitialize even if already initialized" },
      { flag: "--project", type: "string", description: "Override project root directory" },
      { flag: "--workspace", type: "string", description: "Override workspace root for filesystem tools" }
    ],
    mutatesState: true,
    secretSensitive: true
  },
  {
    name: "onboard",
    group: "getting-started",
    status: "stable",
    description: "Guided setup for model provider, channels, and preferences",
    syntax: "pnpm manasvi onboard [--yes] [--provider <name>]",
    examples: [
      "pnpm manasvi onboard",
      "pnpm manasvi onboard --yes",
      "pnpm manasvi onboard --provider ollama"
    ],
    flags: [
      { flag: "--yes", alias: "-y", type: "boolean", description: "Non-interactive (accept current defaults)" },
      { flag: "--provider", type: "string", description: "Pre-select model provider: deepseek | ollama | openai | claude | mock" }
    ],
    mutatesState: true,
    secretSensitive: true,
    requiresInit: true
  },

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  {
    name: "start",
    group: "lifecycle",
    status: "stable",
    description: "Start all services (or a specific service) in dependency order",
    syntax: "pnpm manasvi start [<service>]",
    examples: [
      "pnpm manasvi start",
      "pnpm manasvi start orchestrator-service",
      "pnpm manasvi start policy-service"
    ],
    mutatesState: true,
    requiresInit: true
  },
  {
    name: "stop",
    group: "lifecycle",
    status: "stable",
    description: "Stop all running services (or a specific service)",
    syntax: "pnpm manasvi stop [<service>] [--force]",
    examples: [
      "pnpm manasvi stop",
      "pnpm manasvi stop orchestrator-service",
      "pnpm manasvi stop --force"
    ],
    flags: [
      { flag: "--force", type: "boolean", description: "Send SIGKILL after grace period instead of leaving timed-out processes" }
    ],
    mutatesState: true
  },
  {
    name: "restart",
    group: "lifecycle",
    status: "stable",
    description: "Restart all services (stop then start)",
    syntax: "pnpm manasvi restart [--force]",
    examples: ["pnpm manasvi restart", "pnpm manasvi restart --force"],
    flags: [
      { flag: "--force", type: "boolean", description: "Force-kill on stop phase" }
    ],
    mutatesState: true,
    requiresInit: true
  },
  {
    name: "status",
    group: "lifecycle",
    status: "stable",
    description: "Show service health and active configuration",
    syntax: "pnpm manasvi status [<service>] [--verbose] [--json]",
    examples: [
      "pnpm manasvi status",
      "pnpm manasvi status -v",
      "pnpm manasvi status --json",
      "pnpm manasvi status orchestrator-service"
    ],
    flags: [
      { flag: "--verbose", alias: "-v", type: "boolean", description: "Include model backend connectivity checks and PIDs" },
      { flag: "--json", type: "boolean", description: "Output JSON" }
    ]
  },
  {
    name: "doctor",
    group: "lifecycle",
    status: "stable",
    description: "Diagnose setup issues with actionable fix commands",
    syntax: "pnpm manasvi doctor [--fix] [--category <name>] [--json]",
    examples: [
      "pnpm manasvi doctor",
      "pnpm manasvi doctor --fix",
      "pnpm manasvi doctor --category models",
      "pnpm manasvi doctor --json"
    ],
    flags: [
      { flag: "--fix", type: "boolean", description: "Run safe automatic fixes (create dirs, repair pid file)" },
      { flag: "--category", type: "string", description: "Filter checks: system | config | secrets | models | channels | services | security" },
      { flag: "--json", type: "boolean", description: "Output JSON" }
    ]
  },
  {
    name: "logs",
    group: "lifecycle",
    status: "stable",
    description: "View service logs",
    syntax: "pnpm manasvi logs [<service>] [--tail <n>] [--follow]",
    examples: [
      "pnpm manasvi logs",
      "pnpm manasvi logs orchestrator-service",
      "pnpm manasvi logs api-gateway --tail 100",
      "pnpm manasvi logs --follow"
    ],
    flags: [
      { flag: "--tail", type: "string", description: "Number of lines to show (default: 50)" },
      { flag: "--follow", type: "boolean", description: "Stream new log lines as they arrive" }
    ]
  },

  // ── Configuration ────────────────────────────────────────────────────────────
  {
    name: "config",
    group: "configuration",
    status: "stable",
    description: "Inspect, validate, and edit configuration",
    syntax: "pnpm manasvi config <show|validate|path|edit|explain>",
    examples: [
      "pnpm manasvi config show",
      "pnpm manasvi config show --secrets",
      "pnpm manasvi config validate",
      "pnpm manasvi config path",
      "pnpm manasvi config edit",
      "pnpm manasvi config explain MODEL_ADAPTER_MODE"
    ],
    subcommands: [
      { name: "show", description: "Show current configuration (secrets masked by default)", syntax: "config show [--secrets] [--json]",
        flags: [
          { flag: "--secrets", type: "boolean", description: "Show unmasked secret values (requires confirmation)" },
          { flag: "--json", type: "boolean", description: "Output JSON" }
        ]
      },
      { name: "validate", description: "Validate config and required env vars", syntax: "config validate [--json]",
        flags: [{ flag: "--json", type: "boolean", description: "Output JSON" }]
      },
      { name: "path", description: "Print path to config file", syntax: "config path" },
      { name: "edit", description: "Open config in $EDITOR", syntax: "config edit", notes: "Uses $EDITOR or nano fallback" },
      { name: "explain", description: "Explain a configuration variable", syntax: "config explain [<VAR_NAME>]",
        examples: ["config explain MODEL_ADAPTER_MODE", "config explain TELEGRAM_ADAPTER_MODE"]
      }
    ]
  },
  {
    name: "models",
    group: "configuration",
    status: "stable",
    description: "Configure and test model providers",
    syntax: "pnpm manasvi models <list|add|test|use>",
    examples: [
      "pnpm manasvi models list",
      "pnpm manasvi models add deepseek",
      "pnpm manasvi models test",
      "pnpm manasvi models use ollama",
      "pnpm manasvi models list --json"
    ],
    subcommands: [
      { name: "list", description: "List configured model providers", syntax: "models list [--json]" },
      { name: "add", description: "Configure a model provider", syntax: "models add [deepseek|ollama|openai|claude]", mutatesState: true, secretSensitive: true } as SubcommandDef,
      { name: "test", description: "Test active provider connectivity", syntax: "models test" },
      { name: "use", description: "Set the active model provider", syntax: "models use <deepseek|ollama|openai|claude|mock>", mutatesState: true } as SubcommandDef
    ],
    mutatesState: true,
    secretSensitive: true,
    requiresInit: true
  },
  {
    name: "channels",
    group: "configuration",
    status: "stable",
    description: "Configure and manage messaging channels",
    syntax: "pnpm manasvi channels <list|add|status|remove|logs>",
    examples: [
      "pnpm manasvi channels list",
      "pnpm manasvi channels add telegram",
      "pnpm manasvi channels status",
      "pnpm manasvi channels remove telegram",
      "pnpm manasvi channels logs ingress-service"
    ],
    subcommands: [
      { name: "list", description: "List configured channels", syntax: "channels list" },
      { name: "add", description: "Add or reconfigure a channel", syntax: "channels add [telegram|slack]", mutatesState: true, secretSensitive: true } as SubcommandDef,
      { name: "login", description: "Alias for channels add", syntax: "channels login [telegram|slack]" },
      { name: "status", description: "Show channel health status", syntax: "channels status [--json]" },
      { name: "remove", description: "Remove a channel configuration", syntax: "channels remove [telegram|slack]", mutatesState: true } as SubcommandDef,
      { name: "logs", description: "Tail channel service logs", syntax: "channels logs [service]" }
    ],
    mutatesState: true,
    requiresInit: true
  },

  // ── Governance ────────────────────────────────────────────────────────────────
  {
    name: "tools",
    group: "governance",
    status: "stable",
    description: "Inspect tool governance: risk, policy bindings, capabilities",
    syntax: "pnpm manasvi tools <list|inspect|sets>",
    examples: [
      "pnpm manasvi tools list",
      "pnpm manasvi tools list --enabled",
      "pnpm manasvi tools inspect tool.local-file-read",
      "pnpm manasvi tools sets"
    ],
    subcommands: [
      { name: "list", description: "List all tools with risk and governance status", syntax: "tools list [--enabled|--disabled] [--json]",
        flags: [
          { flag: "--enabled", type: "boolean", description: "Show only enabled tools" },
          { flag: "--disabled", type: "boolean", description: "Show only disabled tools" },
          { flag: "--json", type: "boolean", description: "Output JSON" }
        ]
      },
      { name: "inspect", description: "Full governance details for a specific tool", syntax: "tools inspect <tool-id>" },
      { name: "sets", description: "List default tool sets (starter, notes, governed-action)", syntax: "tools sets" }
    ]
  },
  {
    name: "governance",
    group: "governance",
    status: "stable",
    description: "View governance summary, tool bindings, and policy overview",
    syntax: "pnpm manasvi governance <summary|tools|policies|risks>",
    examples: [
      "pnpm manasvi governance summary",
      "pnpm manasvi governance tools",
      "pnpm manasvi governance policies",
      "pnpm manasvi governance risks"
    ],
    subcommands: [
      { name: "summary", description: "Overall governance posture summary", syntax: "governance summary" },
      { name: "tools", description: "Tool governance status (composes tools list)", syntax: "governance tools" },
      { name: "policies", description: "Policy set and binding overview", syntax: "governance policies" },
      { name: "risks", description: "Risk profile overview for active tools and channels", syntax: "governance risks" }
    ]
  },
  {
    name: "approvals",
    group: "governance",
    status: "experimental",
    description: "Approval queue management (requires backend support)",
    syntax: "pnpm manasvi approvals <list|inspect|approve|reject>",
    examples: [
      "pnpm manasvi approvals list",
      "pnpm manasvi approvals inspect <approvalId>",
      "pnpm manasvi approvals approve <approvalId>",
      "pnpm manasvi approvals reject <approvalId>"
    ],
    notes: "Approval queue CLI requires backend approval REST API. Currently scaffolded."
  },

  // ── Integrations ─────────────────────────────────────────────────────────────
  {
    name: "integrations",
    group: "integrations",
    status: "stable",
    description: "Manage Google integrations (Gmail, Calendar)",
    syntax: "pnpm manasvi integrations <subcommand>",
    examples: [
      "pnpm manasvi integrations list",
      "pnpm manasvi integrations add google",
      "pnpm manasvi integrations add google write",
      "pnpm manasvi integrations google status",
      "pnpm manasvi integrations google check",
      "pnpm manasvi integrations google switch-mode native",
      "pnpm manasvi integrations google set-backend gmail native",
      "pnpm manasvi integrations google oauth start",
      "pnpm manasvi integrations status",
      "pnpm manasvi integrations gmail-health",
      "pnpm manasvi integrations calendar-today"
    ],
    subcommands: [
      { name: "list", description: "List connected integrations", syntax: "integrations list" },
      { name: "add", description: "Connect a provider (Google OAuth flow)", syntax: "integrations add google [read-only|write|calendar|calendar-write|full]", mutatesState: true } as SubcommandDef,
      { name: "status", description: "Show integration status", syntax: "integrations status [--json]" },
      { name: "check", description: "Evaluate policy/scopes for an action", syntax: "integrations check <action-id>" },
      { name: "google", description: "Show and configure Google gog/native/mixed backends", syntax: "integrations google <status|check|switch-mode|set-backend|oauth> [--json]" },
      { name: "gmail-health", description: "Gmail connector health and readiness", syntax: "integrations gmail-health" },
      { name: "gmail-attention", description: "Summarize inbox items needing attention", syntax: "integrations gmail-attention" },
      { name: "gmail-write-status", description: "Gmail write capability readiness", syntax: "integrations gmail-write-status" },
      { name: "calendar-health", description: "Calendar connector health and readiness", syntax: "integrations calendar-health" },
      { name: "calendar-today", description: "Show today's calendar events", syntax: "integrations calendar-today [timezone]" },
      { name: "calendar-upcoming", description: "Show upcoming calendar events", syntax: "integrations calendar-upcoming [maxResults]" },
      { name: "calendar-write-status", description: "Calendar write capability readiness", syntax: "integrations calendar-write-status" },
      { name: "remove", description: "Disconnect an integration", syntax: "integrations remove google", mutatesState: true } as SubcommandDef
    ],
    mutatesState: true,
    requiresInit: true
  },
  {
    name: "connect",
    group: "integrations",
    status: "stable",
    description: "Shortcut to connect a model, channel, or external integration",
    syntax: "pnpm manasvi connect <model|telegram|slack|google> [service] [--mode <gog|native|mixed>]",
    examples: [
      "pnpm manasvi connect model",
      "pnpm manasvi connect telegram",
      "pnpm manasvi connect google",
      "pnpm manasvi connect google --mode gog",
      "pnpm manasvi connect google --mode native",
      "pnpm manasvi connect google --mode mixed",
      "pnpm manasvi connect google gmail --mode native"
    ],
    flags: [
      { flag: "--mode", type: "string", description: "Google foundation mode: gog | native | mixed" }
    ],
    mutatesState: true,
    requiresInit: true
  },
  {
    name: "connections",
    group: "integrations",
    status: "stable",
    description: "Show unified status of all configured connections",
    syntax: "pnpm manasvi connections [--json]",
    examples: [
      "pnpm manasvi connections",
      "pnpm manasvi connections --json"
    ],
    flags: [
      { flag: "--json", type: "boolean", description: "Output JSON" }
    ]
  },

  // ── Advanced ─────────────────────────────────────────────────────────────────
  {
    name: "plugins",
    group: "advanced",
    status: "scaffolded",
    description: "Plugin (extension plane) management — currently shows installation status",
    syntax: "pnpm manasvi plugins <list|inspect|status>",
    examples: [
      "pnpm manasvi plugins list",
      "pnpm manasvi plugins status"
    ],
    subcommands: [
      { name: "list", description: "List installed plugins", syntax: "plugins list" },
      { name: "inspect", description: "Inspect a specific plugin", syntax: "plugins inspect <pluginId>", status: "scaffolded" },
      { name: "status", description: "Plugin runtime status", syntax: "plugins status" }
    ],
    notes: "Plugin management is scaffolded. Full plugin install/remove requires extension runtime API."
  },
  {
    name: "nodes",
    group: "advanced",
    status: "operator-only",
    description: "Remote execution node management",
    syntax: "pnpm manasvi nodes <list|status|pair>",
    examples: [
      "pnpm manasvi nodes list",
      "pnpm manasvi nodes status",
      "pnpm manasvi nodes pair"
    ],
    subcommands: [
      { name: "list", description: "List registered remote nodes", syntax: "nodes list" },
      { name: "status", description: "Node manager health and node status", syntax: "nodes status" },
      { name: "pair", description: "Guided node pairing instructions", syntax: "nodes pair", status: "scaffolded" }
    ],
    notes: "nodes pair is instructional only. Transactional pairing requires backend API support."
  },

  // ── Docs ─────────────────────────────────────────────────────────────────────
  {
    name: "ui",
    group: "docs",
    status: "stable",
    description: "Open or show the documentation UI",
    syntax: "pnpm manasvi ui [--open]",
    examples: ["pnpm manasvi ui", "pnpm manasvi ui --open"],
    flags: [
      { flag: "--open", type: "boolean", description: "Open in browser and start docs server if not running" }
    ]
  },
  {
    name: "docs",
    group: "docs",
    status: "stable",
    description: "Alias for ui --open",
    aliases: ["docs"],
    syntax: "pnpm manasvi docs",
    examples: ["pnpm manasvi docs"]
  },
  {
    name: "version",
    group: "docs",
    status: "stable",
    description: "Print CLI version",
    syntax: "pnpm manasvi version",
    examples: ["pnpm manasvi version"]
  }
];

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function findCommand(name: string): CommandDef | undefined {
  return COMMAND_REGISTRY.find(
    (c) => c.name === name || (c.aliases ?? []).includes(name)
  );
}

export function getCommandsByGroup(): Map<CommandGroup, CommandDef[]> {
  const groups = new Map<CommandGroup, CommandDef[]>();
  for (const cmd of COMMAND_REGISTRY) {
    const list = groups.get(cmd.group) ?? [];
    list.push(cmd);
    groups.set(cmd.group, list);
  }
  return groups;
}

// ── Levenshtein suggestion ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export function suggestCommand(input: string): string[] {
  const names = COMMAND_REGISTRY.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  return names
    .map((n) => ({ name: n, dist: levenshtein(input.toLowerCase(), n.toLowerCase()) }))
    .filter((x) => x.dist <= 3)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map((x) => x.name);
}
