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

## Global options

| Flag | Alias | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help for the current command |
| `--verbose` | `-v` | Show extra detail (PIDs, full error traces) |
| `--yes` | `-y` | Non-interactive mode — accept all defaults |
| `--force` | | Bypass "already done" checks and re-run |

---

## Core commands

### `init`

Initialize Manasvi on this machine.

```bash
pnpm manasvi init [--force] [--project <path>]
```

- Creates `~/.manasvi/` directory
- Generates all required cryptographic secrets into `.env.local`
- Writes default config to `~/.manasvi/config.json`
- Checks Node.js version, pnpm, and tsx prerequisites

Safe to re-run — existing secrets in `.env.local` are preserved unless `--force` is passed.

**Options:**

| Flag | Description |
|------|-------------|
| `--force` | Regenerate all secrets and overwrite config |
| `--project <path>` | Path to Manasvi project root (auto-detected by default) |

---

### `onboard`

Guided interactive setup — choose a model provider, configure channels, and set preferences.

```bash
pnpm manasvi onboard [--yes] [--provider <name>]
```

Walks through:
1. Model provider selection (mock / ollama / openai)
2. Channel setup (telegram / slack)
3. Docs UI preferences

**Options:**

| Flag | Description |
|------|-------------|
| `--yes` / `-y` | Accept all defaults, skip prompts |
| `--provider <name>` | Pre-select model provider (`mock`, `ollama`, `openai`) |

---

### `start`

Start all Manasvi services.

```bash
pnpm manasvi start
```

Services are started in dependency order. The CLI waits for each service's `/health` endpoint before proceeding to the next. Service logs are written to `~/.manasvi/logs/<service>.log`.

---

### `stop`

Stop all running Manasvi services.

```bash
pnpm manasvi stop
```

Sends SIGTERM to all processes tracked in `~/.manasvi/pids.json`.

---

### `restart`

Stop all services and start them again.

```bash
pnpm manasvi restart
```

---

### `status`

Show health of all services and current configuration.

```bash
pnpm manasvi status [--verbose]
```

Displays:
- Health status and latency for each service
- Active model provider
- Enabled channels
- Docs UI URL

**Options:**

| Flag | Description |
|------|-------------|
| `--verbose` / `-v` | Show PIDs alongside each service |

---

### `doctor`

Diagnose setup issues with actionable fixes.

```bash
pnpm manasvi doctor
```

Checks:
- Node.js version (≥20 required)
- pnpm availability
- Config file presence and validity
- Required secrets in `.env.local`
- Port availability for all nine services
- Service health (if running)
- Model backend connectivity (Ollama or OpenAI reachability)

Each check is labeled pass / warn / fail with a suggested fix.

---

### `ui`

Open or print the URL for the documentation UI.

```bash
pnpm manasvi ui [--open]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--open` | Open the URL in your default browser |

---

### `version`

Print the CLI version.

```bash
pnpm manasvi version
```

---

## Configuration commands

### `config show`

Print the full current configuration.

```bash
pnpm manasvi config show
```

### `config validate`

Validate the config file and check that required environment variables are present.

```bash
pnpm manasvi config validate
```

### `config path`

Print the path to the config file.

```bash
pnpm manasvi config path
```

### `config edit`

Open the config file in `$EDITOR`.

```bash
pnpm manasvi config edit
```

---

## Model commands

### `models list`

List all configured model providers and show which one is active.

```bash
pnpm manasvi models list
```

### `models add`

Configure a model provider interactively.

```bash
pnpm manasvi models add [provider]
```

**provider:** `ollama` or `openai`. Prompts if omitted.

### `models test`

Test connectivity to the active model provider.

```bash
pnpm manasvi models test
```

Sends a minimal request and reports success or the specific error.

### `models use`

Switch the active model provider.

```bash
pnpm manasvi models use <provider>
```

**provider:** `mock`, `ollama`, or `openai`.

---

## Channel commands

### `channels list`

List all configured channels and their status.

```bash
pnpm manasvi channels list
```

### `channels add`

Configure a channel interactively.

```bash
pnpm manasvi channels add [channel]
```

**channel:** `telegram` or `slack`. Prompts if omitted.

### `channels status`

Show health and activity for all configured channels.

```bash
pnpm manasvi channels status
```

### `channels remove`

Remove a channel's configuration.

```bash
pnpm manasvi channels remove <channel>
```

Removes the channel's token from `.env.local` and marks it disabled in config.

### `channels logs`

Tail the ingress service log, filtered to a specific channel.

```bash
pnpm manasvi channels logs [channel]
```

---

## Tool commands

### `tools list`

List all available tools and their action classes.

```bash
pnpm manasvi tools list
```

Fetches live data from the orchestrator if it is running. Falls back to the built-in tool registry if not.

### `tools inspect`

Show full detail for a specific tool — description, parameters, policy class, sandbox profile.

```bash
pnpm manasvi tools inspect <tool-name>
```

---

## Plugin commands

### `plugins list`

List installed out-of-process plugins.

```bash
pnpm manasvi plugins list
```

### `plugins inspect`

Show details for a specific plugin.

```bash
pnpm manasvi plugins inspect <plugin-name>
```

---

## Node commands

### `nodes list`

List all registered remote nodes.

```bash
pnpm manasvi nodes list
```

### `nodes status`

Show node manager health and active node count.

```bash
pnpm manasvi nodes status
```

### `nodes pair`

Start the interactive node pairing flow to register a new remote node.

```bash
pnpm manasvi nodes pair
```

---

## Files and directories

| Path | Contents |
|------|----------|
| `~/.manasvi/config.json` | CLI configuration (model, channels, preferences) |
| `~/.manasvi/pids.json` | PIDs of running service processes |
| `~/.manasvi/logs/` | Per-service log files |
| `.env.local` | All secrets and environment variables (project root) |

---

## Quick start

```bash
pnpm manasvi init        # First-time setup — generates secrets, checks prereqs
pnpm manasvi onboard     # Choose model and channels interactively
pnpm manasvi start       # Start all services
pnpm manasvi status      # Verify everything is healthy
pnpm cli                 # Open interactive terminal chat
```
