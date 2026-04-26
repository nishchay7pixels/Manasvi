#!/usr/bin/env tsx
/**
 * Manasvi CLI — primary operator interface
 *
 * Usage:
 *   pnpm manasvi <command> [subcommand] [options]
 *
 * Core:
 *   init            Initialize Manasvi locally
 *   onboard         Guided setup (model, channels, prefs)
 *   start           Start all services
 *   stop            Stop all services
 *   restart         Restart all services
 *   status          Show service health and config
 *   doctor          Diagnose setup issues
 *   ui              Open or show the docs UI URL
 *   version         Show CLI version
 *
 * Config:
 *   config show     Show current configuration
 *   config validate Validate config and environment
 *   config path     Print config file path
 *   config edit     Open config in $EDITOR
 *
 * Models:
 *   models list     List model providers
 *   models add      Configure a model provider
 *   models test     Test model connectivity
 *   models use      Set active model provider
 *
 * Channels:
 *   channels list   List configured channels
 *   channels add    Add/configure a channel
 *   channels status Show channel status
 *   channels remove Remove a channel
 *   channels logs   Tail channel service logs
 *
 * Tools:
 *   tools list      List available tools
 *   tools inspect   Inspect a specific tool
 *
 * Plugins:
 *   plugins list    List installed plugins
 *   plugins inspect Inspect a plugin
 *
 * Nodes:
 *   nodes list      List registered nodes
 *   nodes status    Node manager status
 *   nodes pair      Start node pairing flow
 */

import { style, banner, hint, info, error as printError } from "./lib/ui.js";

// ── Command implementations ────────────────────────────────────────────────────

import { runInit } from "./commands/init.js";
import { runOnboard } from "./commands/onboard.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runRestart } from "./commands/restart.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runUi } from "./commands/ui-cmd.js";
import { runConfigShow, runConfigValidate, runConfigPath, runConfigEdit } from "./commands/config-cmd.js";
import { runModelsList, runModelsAdd, runModelsTest, runModelsUse } from "./commands/models.js";
import { runChannelsList, runChannelsAdd, runChannelsStatus, runChannelsRemove, runChannelsLogs } from "./commands/channels.js";
import { runToolsList, runToolsInspect } from "./commands/tools.js";
import { runPluginsList, runPluginsInspect } from "./commands/plugins.js";
import { runNodesList, runNodesStatus, runNodesPair } from "./commands/nodes.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const prefixed = args.find((a) => a.startsWith(flag + "="));
  return prefixed?.split("=").slice(1).join("=");
}

// ── Help ───────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${style.boldCyan("Manasvi")} ${style.dim("— governed AI agent runtime")}

${style.bold("Usage:")}
  pnpm manasvi <command> [subcommand] [options]

${style.bold("Core commands:")}
  ${style.cyan("init")}               Initialize Manasvi locally (run first)
  ${style.cyan("onboard")}            Guided setup — model, channels, preferences
  ${style.cyan("start")}              Start all services
  ${style.cyan("stop")}               Stop all services
  ${style.cyan("restart")}            Restart all services
  ${style.cyan("status")}             Show service health and configuration
  ${style.cyan("doctor")}             Diagnose setup issues with actionable fixes
  ${style.cyan("ui")}                 Open the documentation UI
  ${style.cyan("version")}            Show version

${style.bold("Configuration:")}
  ${style.cyan("config show")}        Show current config
  ${style.cyan("config validate")}    Validate config and environment
  ${style.cyan("config path")}        Print config file path
  ${style.cyan("config edit")}        Edit config in $EDITOR

${style.bold("Model providers:")}
  ${style.cyan("models list")}        List configured providers
  ${style.cyan("models add")}         Configure a provider (ollama, openai, claude)
  ${style.cyan("models test")}        Test model connectivity
  ${style.cyan("models use")}         Set active provider

${style.bold("Channels:")}
  ${style.cyan("channels list")}      List configured channels
  ${style.cyan("channels add")}       Add a channel (telegram, slack)
  ${style.cyan("channels status")}    Show channel health
  ${style.cyan("channels remove")}    Remove a channel
  ${style.cyan("channels logs")}      Tail channel service logs

${style.bold("Tools:")}
  ${style.cyan("tools list")}         List available tools and action classes
  ${style.cyan("tools inspect")}      Inspect a specific tool

${style.bold("Plugins:")}
  ${style.cyan("plugins list")}       List installed plugins

${style.bold("Nodes:")}
  ${style.cyan("nodes list")}         List registered remote nodes
  ${style.cyan("nodes status")}       Node manager status
  ${style.cyan("nodes pair")}         Start node pairing flow

${style.bold("Options:")}
  ${style.dim("--help, -h")}         Show this help
  ${style.dim("--verbose, -v")}      Verbose output
  ${style.dim("--yes, -y")}          Non-interactive mode (accept defaults)
  ${style.dim("--force")}            Force re-run (bypasses already-done checks)

${style.bold("Quick start:")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi init")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi onboard")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi start")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi status")}
`);
}

// ── Router ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [cmd, sub, ...rest] = args;

  const verbose = hasFlag(args, "--verbose", "-v");
  const yes = hasFlag(args, "--yes", "-y");
  const force = hasFlag(args, "--force");
  const open = hasFlag(args, "--open");

  if (!cmd || hasFlag(args, "--help", "-h")) {
    if (!cmd) {
      banner();
      hint("Run `pnpm manasvi --help` for usage or `pnpm manasvi init` to get started.");
      console.log();
    }
    printHelp();
    return;
  }

  if (cmd === "version") {
    console.log("0.1.0");
    return;
  }

  if (cmd === "docs") {
    await runUi({ open: true });
    return;
  }

  try {
    switch (cmd) {
      case "init":
        await runInit({ force, projectPath: flagValue(args, "--project") });
        break;

      case "onboard":
        await runOnboard({ yes, provider: flagValue(args, "--provider") });
        break;

      case "start":
        await runStart();
        break;

      case "stop":
        await runStop({ force });
        break;

      case "restart":
        await runRestart({ force });
        break;

      case "status":
        await runStatus({ verbose });
        break;

      case "doctor":
        await runDoctor();
        break;

      case "ui":
        await runUi({ open });
        break;

      case "config":
        switch (sub) {
          case "show": case undefined: await runConfigShow(); break;
          case "validate": await runConfigValidate(); break;
          case "path": await runConfigPath(); break;
          case "edit": await runConfigEdit(); break;
          default: printError(`Unknown subcommand: config ${sub}`); process.exit(1);
        }
        break;

      case "models":
        switch (sub) {
          case "list": case undefined: await runModelsList(); break;
          case "add": await runModelsAdd(rest[0]); break;
          case "test": await runModelsTest(); break;
          case "use": await runModelsUse(rest[0] ?? sub); break;
          default: printError(`Unknown subcommand: models ${sub}`); process.exit(1);
        }
        break;

      case "channels":
        switch (sub) {
          case "list": case undefined: await runChannelsList(); break;
          case "add": await runChannelsAdd(rest[0]); break;
          case "login": await runChannelsAdd(rest[0]); break;
          case "status": await runChannelsStatus(); break;
          case "remove": await runChannelsRemove(rest[0]); break;
          case "logs": await runChannelsLogs(rest[0]); break;
          default: printError(`Unknown subcommand: channels ${sub}`); process.exit(1);
        }
        break;

      case "tools":
        switch (sub) {
          case "list": case undefined: await runToolsList(); break;
          case "inspect": await runToolsInspect(rest[0]); break;
          default: printError(`Unknown subcommand: tools ${sub}`); process.exit(1);
        }
        break;

      case "plugins":
        switch (sub) {
          case "list": case undefined: await runPluginsList(); break;
          case "inspect": await runPluginsInspect(rest[0]); break;
          default: printError(`Unknown subcommand: plugins ${sub}`); process.exit(1);
        }
        break;

      case "nodes":
        switch (sub) {
          case "list": case undefined: await runNodesList(); break;
          case "status": await runNodesStatus(); break;
          case "pair": await runNodesPair(); break;
          default: printError(`Unknown subcommand: nodes ${sub}`); process.exit(1);
        }
        break;

      default:
        printError(`Unknown command: ${cmd}`);
        hint("Run `pnpm manasvi --help` for usage");
        process.exit(1);
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    if (verbose) console.error(err);
    process.exit(1);
  }
}

void main();
