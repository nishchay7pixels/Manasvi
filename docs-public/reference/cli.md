---
sidebar_position: 1
title: CLI Reference
description: Complete reference for all pnpm manasvi commands
---

# CLI Reference

Manasvi is operated through the `manasvi` CLI. All commands are run as:

```bash
pnpm manasvi <command> [subcommand] [options]
```

---

## Quick Start

```bash
# First-run guided setup (recommended)
pnpm manasvi setup

# Or step by step:
pnpm manasvi init
pnpm manasvi onboard
pnpm manasvi start
pnpm manasvi status
```

---

## Global Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help for the current command |
| `--verbose` | `-v` | Show extra detail (PIDs, full error traces) |
| `--yes` | `-y` | Non-interactive mode — accept all defaults |
| `--force` | | Command-specific force behaviour (see each command) |
| `--json` | | Machine-readable JSON output (no ANSI) |
| `--no-color` | | Disable ANSI color codes |

---

## Help System

```bash
pnpm manasvi help               # Top-level command list
pnpm manasvi help <command>     # Detailed help for a command
pnpm manasvi help config show   # Help for a subcommand
pnpm manasvi models --help      # Inline --help flag (works everywhere)
```

Unknown commands produce friendly suggestions:
```bash
pnpm manasvi ststus
# Unknown command: ststus
# Did you mean: status?
```

---

## Getting Started Commands

### `setup`

Guided first-run wrapper. Detects init state, configures model + channels, runs doctor.

```bash
pnpm manasvi setup                     # Interactive
pnpm manasvi setup --profile demo      # Quick local demo (mock model)
pnpm manasvi setup --profile dev       # Interactive model selection
pnpm manasvi setup --profile telegram  # Telegram-connected assistant
pnpm manasvi setup --profile google    # Google integration focus
pnpm manasvi setup --yes               # Non-interactive with safe defaults
```

### `init`

Initialize Manasvi on this machine.

```bash
pnpm manasvi init [--force] [--project <path>] [--workspace <path>]
```

- Creates `~/.manasvi/` directory
- Generates all required cryptographic secrets into `.env.local`
- Writes default config to `~/.manasvi/config.json`
- Checks Node.js version, pnpm, and tsx prerequisites

| Flag | Description |
|------|-------------|
| `--force` | Regenerate all secrets and overwrite config |
| `--project <path>` | Path to Manasvi project root |
| `--workspace <path>` | Workspace root for filesystem tools |

### `onboard`

Guided interactive setup for model provider, channels, and preferences.

```bash
pnpm manasvi onboard [--yes] [--provider <name>]
```

| Flag | Description |
|------|-------------|
| `--yes` / `-y` | Accept all defaults, skip prompts |
| `--provider <name>` | Pre-select provider: `deepseek`, `mock`, `ollama`, `openai`, `claude` |

---

## Lifecycle Commands

### `start`

Start all services (or a single service) in dependency order.

```bash
pnpm manasvi start                          # All services
pnpm manasvi start orchestrator-service     # Single service
```

### `stop`

Stop all running services (or a single service).

```bash
pnpm manasvi stop                      # Graceful (5s grace period)
pnpm manasvi stop --force              # SIGKILL after grace period
pnpm manasvi stop orchestrator-service  # Single service
```

### `restart`

Stop then start all services.

```bash
pnpm manasvi restart [--force]
```

### `status`

Show service health and configuration.

```bash
pnpm manasvi status                         # All services
pnpm manasvi status -v                      # With PIDs + backend checks
pnpm manasvi status --json                  # JSON output
pnpm manasvi status orchestrator-service    # Single service
```

### `doctor`

Diagnose setup issues with actionable fixes.

```bash
pnpm manasvi doctor                      # All checks
pnpm manasvi doctor --fix                # Apply safe automatic fixes
pnpm manasvi doctor --category models    # Specific category only
pnpm manasvi doctor --json               # JSON output
```

**Categories:** `system` | `config` | `secrets` | `models` | `channels` | `services` | `security`

### `logs`

View service log files from `~/.manasvi/logs/`.

```bash
pnpm manasvi logs                              # List all log files
pnpm manasvi logs orchestrator-service         # Last 50 lines
pnpm manasvi logs api-gateway --tail 100       # Last 100 lines
pnpm manasvi logs ingress-service --follow     # Stream new lines (Ctrl+C to stop)
```

---

## Configuration Commands

### `config show`

Show current configuration. Secrets are **masked by default**.

```bash
pnpm manasvi config show              # Masked output
pnpm manasvi config show --secrets    # Unmasked (requires confirmation)
pnpm manasvi config show --json       # JSON output
```

### `config validate`

Validate config and required env vars.

```bash
pnpm manasvi config validate
pnpm manasvi config validate --json
```

### `config explain`

Explain a configuration variable.

```bash
pnpm manasvi config explain                    # List all documented variables
pnpm manasvi config explain MODEL_ADAPTER_MODE
pnpm manasvi config explain TELEGRAM_ADAPTER_MODE
pnpm manasvi config explain MANASVI_FS_WRITES_ENABLED
```

### `config path` / `config edit`

```bash
pnpm manasvi config path    # Print config file path
pnpm manasvi config edit    # Open in $EDITOR
```

---

## Model Commands

```bash
pnpm manasvi models list              # List configured providers (shows active)
pnpm manasvi models list --json
pnpm manasvi models add deepseek      # Configure DeepSeek (asks for API key)
pnpm manasvi models add ollama        # Configure Ollama (local)
pnpm manasvi models add openai        # Configure OpenAI
pnpm manasvi models add claude        # Configure Claude/Anthropic
pnpm manasvi models test              # Test active provider connectivity
pnpm manasvi models use ollama        # Switch active provider
```

**Supported providers:** `deepseek`, `ollama`, `openai`, `claude`, `mock`

---

## Channel Commands

```bash
pnpm manasvi channels list                     # List configured channels
pnpm manasvi channels add telegram             # Configure Telegram bot
pnpm manasvi channels add slack                # Configure Slack workspace
pnpm manasvi channels login telegram           # Alias for channels add
pnpm manasvi channels status                   # Channel health
pnpm manasvi channels status --json
pnpm manasvi channels remove telegram          # Remove a channel
pnpm manasvi channels logs ingress-service     # Tail channel logs
```

---

## Governance Commands

### `tools`

Inspect built-in tool governance: risk levels, policy bindings, sandbox profiles.

```bash
pnpm manasvi tools list                          # All tools
pnpm manasvi tools list --enabled                # Only enabled
pnpm manasvi tools inspect tool.local-file-read  # Full detail
pnpm manasvi tools sets                          # Default tool sets
```

### `governance`

Read-only governance posture overview.

```bash
pnpm manasvi governance summary    # Overall posture: services, tool risks, config
pnpm manasvi governance tools      # Tool risk overview (delegates to tools list)
pnpm manasvi governance policies   # Policy set, approval TTL, runtime constraints
pnpm manasvi governance risks      # Risk profile: tools + active channels + config
```

All governance subcommands support `--json`.

### `approvals`

Approval queue management.

> **Note:** Approval queue CLI requires a backend REST API on the approval-service. Not yet implemented — commands display honest status and what is needed.

```bash
pnpm manasvi approvals list         # (shows what's missing)
pnpm manasvi approvals inspect <id>
pnpm manasvi approvals approve <id>
pnpm manasvi approvals reject <id>
```

---

## Integration Commands

### `integrations`

Manage Google integrations (Gmail, Calendar).

```bash
pnpm manasvi integrations list
pnpm manasvi integrations add google              # Read-only OAuth
pnpm manasvi integrations add google write        # Gmail write scopes
pnpm manasvi integrations add google calendar     # Calendar read
pnpm manasvi integrations add google calendar-write  # Calendar write
pnpm manasvi integrations add google full         # All scopes
pnpm manasvi integrations status
pnpm manasvi integrations google status           # gog/native/mixed backend status
pnpm manasvi integrations google status --json
pnpm manasvi integrations google check            # router/provider checks
pnpm manasvi integrations google check --backend gog
pnpm manasvi integrations google check --backend native
pnpm manasvi integrations google switch-mode native
pnpm manasvi integrations google set-backend gmail native
pnpm manasvi integrations google oauth start
pnpm manasvi integrations google oauth complete --code <code> --state <state>
pnpm manasvi integrations google oauth status
pnpm manasvi integrations check gmail.threads.read
pnpm manasvi integrations gmail-health
pnpm manasvi integrations gmail-attention
pnpm manasvi integrations gmail-write-status
pnpm manasvi integrations calendar-health
pnpm manasvi integrations calendar-today [timezone]
pnpm manasvi integrations calendar-upcoming [maxResults]
pnpm manasvi integrations calendar-write-status
pnpm manasvi integrations remove google
```

### `connect`

Shortcut to connect a model, channel, or integration.

```bash
pnpm manasvi connect model        # → models add (interactive)
pnpm manasvi connect telegram     # → channels add telegram
pnpm manasvi connect slack        # → channels add slack
pnpm manasvi connect google       # → integrations add google
pnpm manasvi connect google --mode gog     # configure G1 gog backend mode
pnpm manasvi connect google --mode native  # configure G1 native backend mode
pnpm manasvi connect google --mode mixed   # configure G1 mixed backend mode
```

### `connections`

Unified status of all configured connections.

```bash
pnpm manasvi connections
pnpm manasvi connections --json
```

Output shows: active model + reachability, Telegram/Slack channel status, Google integration scope status.

---

## Advanced Commands

### `plugins`

Plugin (extension plane) management.

```bash
pnpm manasvi plugins list     # Current state (scaffolded — management API pending)
pnpm manasvi plugins status   # Extension plane status
pnpm manasvi plugins inspect <pluginId>
```

### `nodes`

Remote execution node management.

```bash
pnpm manasvi nodes list      # Registered nodes (reads from node manager)
pnpm manasvi nodes status    # Node manager health + registered count
pnpm manasvi nodes pair      # Guided pairing instructions
```

> **Note:** `nodes pair` is instructional only. Transactional pairing requires backend API support.

---

## Docs & Info

```bash
pnpm manasvi ui               # Show docs UI URL
pnpm manasvi ui --open        # Open in browser
pnpm manasvi docs             # Alias for ui --open
pnpm manasvi version          # Print CLI version
```

---

## JSON Output

Core read commands support `--json` for automation and scripting:

```bash
pnpm manasvi status --json
pnpm manasvi doctor --json
pnpm manasvi config show --json
pnpm manasvi config validate --json
pnpm manasvi models list --json
pnpm manasvi channels status --json
pnpm manasvi connections --json
pnpm manasvi governance summary --json
pnpm manasvi governance risks --json
```

### JSON envelope

All JSON responses use a stable type:

```json
{
  "ok": true,
  "command": "status",
  "timestamp": "2026-05-14T00:00:00.000Z",
  "data": {},
  "warnings": [{ "code": "...", "message": "..." }],
  "errors": [{ "code": "...", "message": "...", "fix": "..." }],
  "nextSteps": ["pnpm manasvi start"]
}
```

- `ok: false` when `errors` is non-empty
- Exit code is non-zero on failure
- No ANSI codes in JSON output
- Sensitive values masked unless explicitly requested

---

## Security Notes

- **Secret input is hidden**: API keys and tokens are hidden (`*`) during entry in TTY environments.
- **Config masking**: `config show` masks all sensitive values by default.
- **Confirmations**: Destructive actions (remove, force-stop, show secrets) require explicit confirmation.
- **Governance visibility**: `doctor`, `governance risks`, and `tools list` surface unsafe misconfigurations.
- **Internal secrets**: Generated cryptographically on `init` — never hardcoded.

---

## Files and Directories

| Path | Contents |
|------|----------|
| `~/.manasvi/config.json` | CLI config (model, channels, ports) |
| `~/.manasvi/pids.json` | Running service PIDs |
| `~/.manasvi/logs/<service>.log` | Per-service log files |
| `<project>/.env.local` | Runtime secrets and settings |

Override CLI home:
```bash
export MANASVI_HOME=/path/to/.manasvi
```

---

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `MANASVI_HOME` | CLI home dir (default: `~/.manasvi`) |
| `MANASVI_PROJECT` | Project root (default: cwd) |
| `MODEL_ADAPTER_MODE` | Active model provider |
| `PLANNER_MODEL` | Model name for planner |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_ADAPTER_MODE` | `polling` or `webhook` |
| `NO_COLOR` | Disable ANSI colors (any value) |

Run `pnpm manasvi config explain <VAR>` for full documentation on any variable.
