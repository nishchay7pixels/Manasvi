#!/usr/bin/env tsx
/**
 * Manasvi CLI — primary operator interface
 *
 * Usage:
 *   pnpm manasvi <command> [subcommand] [options]
 *
 * Run `pnpm manasvi help` or `pnpm manasvi --help` for the full command list.
 * Run `pnpm manasvi help <command>` for command-specific help.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { style, banner, hint, info, error as printError } from "./lib/ui.js";
import {
  COMMAND_REGISTRY,
  GLOBAL_FLAGS,
  findCommand,
  getCommandsByGroup,
  suggestCommand,
  type CommandGroup
} from "./lib/registry.js";

// ── Command implementations ────────────────────────────────────────────────────

import { runInit } from "./commands/init.js";
import { runOnboard } from "./commands/onboard.js";
import { runStart } from "./commands/start.js";
import { runStop } from "./commands/stop.js";
import { runRestart } from "./commands/restart.js";
import { runStatus } from "./commands/status.js";
import { runDoctor } from "./commands/doctor.js";
import { runUi } from "./commands/ui-cmd.js";
import { runSetup } from "./commands/setup.js";
import { runLogs } from "./commands/logs.js";
import { runConnect } from "./commands/connect.js";
import { runConnections } from "./commands/connections.js";
import { runGovernance } from "./commands/governance.js";
import { runApprovals } from "./commands/approvals.js";
import {
  runConfigShow,
  runConfigValidate,
  runConfigPath,
  runConfigEdit,
  runConfigExplain
} from "./commands/config-cmd.js";
import {
  runModelsList,
  runModelsAdd,
  runModelsTest,
  runModelsUse
} from "./commands/models.js";
import {
  runChannelsList,
  runChannelsAdd,
  runChannelsStatus,
  runChannelsRemove,
  runChannelsLogs
} from "./commands/channels.js";
import { runToolsList, runToolsInspect, runToolsSets } from "./commands/tools.js";
import { runPluginsList, runPluginsInspect, runPluginsStatus } from "./commands/plugins.js";
import { runNodesList, runNodesStatus, runNodesPair } from "./commands/nodes.js";
import {
  runIntegrationsAdd,
  runIntegrationsCheck,
  runIntegrationsGmailAttention,
  runIntegrationsGmailHealth,
  runIntegrationsGmailWriteStatus,
  runIntegrationsCalendarHealth,
  runIntegrationsCalendarToday,
  runIntegrationsCalendarUpcoming,
  runIntegrationsCalendarWriteStatus,
  runIntegrationsList,
  runIntegrationsRemove,
  runIntegrationsStatus
} from "./commands/integrations.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

export function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}

export function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1]!.startsWith("-")) {
    return args[idx + 1];
  }
  const prefixed = args.find((a) => a.startsWith(flag + "="));
  return prefixed?.split("=").slice(1).join("=");
}

function cliVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

// ── Help ───────────────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<CommandGroup, string> = {
  "getting-started": "Getting started",
  "lifecycle": "Lifecycle",
  "configuration": "Configuration",
  "governance": "Governance",
  "integrations": "Integrations",
  "advanced": "Advanced",
  "docs": "Docs & info"
};

const GROUP_ORDER: CommandGroup[] = [
  "getting-started",
  "lifecycle",
  "configuration",
  "governance",
  "integrations",
  "advanced",
  "docs"
];

function statusTag(status: string | undefined): string {
  if (!status || status === "stable") return "";
  const tags: Record<string, string> = {
    experimental: style.yellow(" [experimental]"),
    scaffolded: style.dim(" [scaffolded]"),
    "operator-only": style.dim(" [operator]"),
    "dev-only": style.dim(" [dev]")
  };
  return tags[status] ?? "";
}

function printHelp(): void {
  console.log(`
${style.boldCyan("Manasvi")} ${style.dim("— governed AI agent runtime")}

${style.bold("Usage:")}
  pnpm manasvi <command> [subcommand] [options]
  pnpm manasvi help <command>
  pnpm manasvi <command> --help
`);

  const byGroup = getCommandsByGroup();

  for (const group of GROUP_ORDER) {
    const cmds = byGroup.get(group);
    if (!cmds?.length) continue;
    console.log(style.bold(GROUP_LABELS[group] + ":"));
    for (const cmd of cmds) {
      const tag = statusTag(cmd.status);
      console.log(`  ${style.cyan(cmd.name.padEnd(14))}  ${cmd.description}${tag}`);
    }
    console.log();
  }

  console.log(style.bold("Global options:"));
  for (const f of GLOBAL_FLAGS) {
    const alias = f.alias ? `, ${f.alias}` : "";
    const flag = `${f.flag}${alias}`;
    console.log(`  ${style.dim(flag.padEnd(20))}  ${f.description}`);
  }

  console.log(`
${style.bold("Quick start:")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi setup")}        ${style.dim("# guided first-run")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi start")}        ${style.dim("# start all services")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi status")}       ${style.dim("# check health")}
  ${style.dim("$")} ${style.cyan("pnpm manasvi doctor --fix")} ${style.dim("# diagnose and repair")}

${style.dim("Run `pnpm manasvi help <command>` for detailed help on any command.")}
`);
}

function printCommandHelp(cmdName: string): void {
  const cmd = findCommand(cmdName);
  if (!cmd) {
    printError(`No help found for: ${cmdName}`);
    const suggestions = suggestCommand(cmdName);
    if (suggestions.length > 0) {
      hint(`Did you mean: ${suggestions.join(", ")}?`);
    }
    process.exit(1);
  }

  const tag = statusTag(cmd.status);
  console.log(`
${style.boldCyan(cmd.name)}${tag}  ${style.dim(cmd.description)}

${style.bold("Syntax:")}
  ${cmd.syntax}
`);

  if (cmd.subcommands?.length) {
    console.log(style.bold("Subcommands:"));
    for (const sub of cmd.subcommands) {
      const stag = statusTag(sub.status);
      console.log(`  ${style.cyan(sub.name.padEnd(22))}  ${sub.description}${stag}`);
    }
    console.log();
  }

  if (cmd.flags?.length) {
    console.log(style.bold("Options:"));
    for (const f of cmd.flags) {
      const alias = f.alias ? `, ${f.alias}` : "";
      const flag = `${f.flag}${alias}`;
      const def = f.default ? ` ${style.dim(`[${f.default}]`)}` : "";
      console.log(`  ${style.dim(flag.padEnd(22))}  ${f.description}${def}`);
    }
    console.log();
  }

  if (cmd.examples.length > 0) {
    console.log(style.bold("Examples:"));
    for (const ex of cmd.examples) {
      console.log(`  ${style.dim("$")} ${style.cyan(ex)}`);
    }
    console.log();
  }

  if (cmd.mutatesState) {
    console.log(`  ${style.yellow("⚠")} ${style.dim("This command modifies state.")}`);
  }
  if (cmd.secretSensitive) {
    console.log(`  ${style.yellow("⚠")} ${style.dim("This command may handle sensitive credentials.")}`);
  }
  if (cmd.notes) {
    console.log(`\n  ${style.dim(cmd.notes)}`);
  }
  console.log();
}

function printSubcommandHelp(cmdName: string, subName: string): void {
  const cmd = findCommand(cmdName);
  const sub = cmd?.subcommands?.find((s) => s.name === subName);
  if (!cmd || !sub) {
    printCommandHelp(cmdName);
    return;
  }

  const stag = statusTag(sub.status);
  console.log(`
${style.boldCyan(`${cmdName} ${subName}`)}${stag}  ${style.dim(sub.description)}

${style.bold("Syntax:")}
  ${sub.syntax}
`);

  if (sub.flags?.length) {
    console.log(style.bold("Options:"));
    for (const f of sub.flags) {
      const alias = f.alias ? `, ${f.alias}` : "";
      const flag = `${f.flag}${alias}`;
      console.log(`  ${style.dim(flag.padEnd(22))}  ${f.description}`);
    }
    console.log();
  }

  if (sub.examples?.length) {
    console.log(style.bold("Examples:"));
    for (const ex of sub.examples) {
      console.log(`  ${style.dim("$")} ${style.cyan(ex)}`);
    }
    console.log();
  }
}

// ── Router ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [cmd, sub, ...rest] = args;

  // Apply --no-color early (ui.ts reads NO_COLOR env at module load, but we can set it here)
  if (hasFlag(args, "--no-color")) {
    process.env.NO_COLOR = "1";
  }

  const verbose = hasFlag(args, "--verbose", "-v");
  const yes = hasFlag(args, "--yes", "-y");
  const force = hasFlag(args, "--force");
  const open = hasFlag(args, "--open");
  const json = hasFlag(args, "--json");

  // No command or global --help
  if (!cmd || (cmd === "--help" || cmd === "-h")) {
    if (!cmd) {
      banner();
      hint("Run `pnpm manasvi setup` for guided first-run, or `pnpm manasvi --help` for all commands.");
      console.log();
    }
    printHelp();
    return;
  }

  // `help` command
  if (cmd === "help") {
    if (sub) {
      // help <command> [subcommand]
      if (rest[0]) {
        printSubcommandHelp(sub, rest[0]);
      } else {
        printCommandHelp(sub);
      }
    } else {
      printHelp();
    }
    return;
  }

  // Per-command --help / -h
  if (hasFlag(args, "--help", "-h")) {
    if (sub && !sub.startsWith("-") && cmd !== "help") {
      printSubcommandHelp(cmd, sub);
    } else {
      printCommandHelp(cmd);
    }
    return;
  }

  if (cmd === "version") {
    console.log(cliVersion());
    return;
  }

  if (cmd === "docs") {
    await runUi({ open: true });
    return;
  }

  try {
    switch (cmd) {
      // ── Getting started ──────────────────────────────────────────────────────
      case "setup":
        await runSetup({
          yes,
          profile: flagValue(args, "--profile"),
          json
        });
        break;

      case "init":
        await runInit({
          force,
          projectPath: flagValue(args, "--project"),
          workspacePath: flagValue(args, "--workspace")
        });
        break;

      case "onboard":
        await runOnboard({ yes, provider: flagValue(args, "--provider") });
        break;

      // ── Lifecycle ────────────────────────────────────────────────────────────
      case "start": {
        // sub is optional service name (may be a service name or a flag)
        const targetService = sub && !sub.startsWith("-") ? sub : undefined;
        await runStart({ service: targetService });
        break;
      }

      case "stop": {
        const targetService = sub && !sub.startsWith("-") ? sub : undefined;
        await runStop({ force, service: targetService });
        break;
      }

      case "restart":
        await runRestart({ force });
        break;

      case "status": {
        const targetService = sub && !sub.startsWith("-") ? sub : undefined;
        await runStatus({ verbose, json, service: targetService });
        break;
      }

      case "doctor":
        await runDoctor({
          fix: hasFlag(args, "--fix"),
          category: flagValue(args, "--category"),
          json
        });
        break;

      case "logs": {
        const targetService = sub && !sub.startsWith("-") ? sub : undefined;
        const tailStr = flagValue(args, "--tail");
        const tail = tailStr ? parseInt(tailStr, 10) : 50;
        const follow = hasFlag(args, "--follow");
        await runLogs({ service: targetService, tail, follow });
        break;
      }

      // ── Configuration ────────────────────────────────────────────────────────
      case "config":
        switch (sub) {
          case "show":
          case undefined:
            await runConfigShow({
              json,
              showSecrets: hasFlag(args, "--secrets"),
              yes
            });
            break;
          case "validate": await runConfigValidate({ json }); break;
          case "path": await runConfigPath(); break;
          case "edit": await runConfigEdit(); break;
          case "explain": await runConfigExplain(rest[0]); break;
          default:
            printError(`Unknown subcommand: config ${sub}`);
            hint("Valid subcommands: show, validate, path, edit, explain");
            process.exit(1);
        }
        break;

      case "models":
        switch (sub) {
          case "list":
          case undefined:
            await runModelsList({ json });
            break;
          case "add": await runModelsAdd(rest[0]); break;
          case "test": await runModelsTest(); break;
          case "use": await runModelsUse(rest[0] ?? sub); break;
          default:
            printError(`Unknown subcommand: models ${sub}`);
            hint("Valid subcommands: list, add, test, use");
            process.exit(1);
        }
        break;

      case "channels":
        switch (sub) {
          case "list":
          case undefined:
            await runChannelsList();
            break;
          case "add": await runChannelsAdd(rest[0]); break;
          case "login": await runChannelsAdd(rest[0]); break;
          case "status": await runChannelsStatus({ json }); break;
          case "remove": await runChannelsRemove(rest[0]); break;
          case "logs": await runChannelsLogs(rest[0]); break;
          default:
            printError(`Unknown subcommand: channels ${sub}`);
            hint("Valid subcommands: list, add, login, status, remove, logs");
            process.exit(1);
        }
        break;

      // ── Governance ────────────────────────────────────────────────────────────
      case "tools":
        switch (sub) {
          case "list":
          case undefined:
            await runToolsList([...rest, ...(sub ? [] : args.slice(1))]);
            break;
          case "inspect": await runToolsInspect(rest[0], rest.slice(1)); break;
          case "sets": await runToolsSets(); break;
          default:
            printError(`Unknown subcommand: tools ${sub}`);
            hint("Valid subcommands: list, inspect, sets");
            process.exit(1);
        }
        break;

      case "governance":
        await runGovernance(sub, { json });
        break;

      case "approvals":
        await runApprovals(sub, rest[0], { json });
        break;

      // ── Integrations ─────────────────────────────────────────────────────────
      case "integrations":
        switch (sub) {
          case "list":
          case undefined:
            await runIntegrationsList();
            break;
          case "add": await runIntegrationsAdd(rest[0], rest[1]); break;
          case "status": await runIntegrationsStatus(); break;
          case "check": await runIntegrationsCheck(rest[0]); break;
          case "gmail-health": await runIntegrationsGmailHealth(); break;
          case "gmail-attention": await runIntegrationsGmailAttention(); break;
          case "gmail-write-status": await runIntegrationsGmailWriteStatus(); break;
          case "calendar-health": await runIntegrationsCalendarHealth(); break;
          case "calendar-today": await runIntegrationsCalendarToday(rest[0]); break;
          case "calendar-upcoming": await runIntegrationsCalendarUpcoming(rest[0]); break;
          case "calendar-write-status": await runIntegrationsCalendarWriteStatus(); break;
          case "remove": await runIntegrationsRemove(rest[0]); break;
          default:
            printError(`Unknown subcommand: integrations ${sub}`);
            hint("Run `pnpm manasvi help integrations` for a list of subcommands");
            process.exit(1);
        }
        break;

      case "connect":
        await runConnect(sub, { json });
        break;

      case "connections":
        await runConnections({ json });
        break;

      // ── Advanced ─────────────────────────────────────────────────────────────
      case "plugins":
        switch (sub) {
          case "list":
          case undefined:
            await runPluginsList();
            break;
          case "inspect": await runPluginsInspect(rest[0]); break;
          case "status": await runPluginsStatus(); break;
          default:
            printError(`Unknown subcommand: plugins ${sub}`);
            hint("Valid subcommands: list, inspect, status");
            process.exit(1);
        }
        break;

      case "nodes":
        switch (sub) {
          case "list":
          case undefined:
            await runNodesList();
            break;
          case "status": await runNodesStatus(); break;
          case "pair": await runNodesPair(); break;
          default:
            printError(`Unknown subcommand: nodes ${sub}`);
            hint("Valid subcommands: list, status, pair");
            process.exit(1);
        }
        break;

      // ── Docs ─────────────────────────────────────────────────────────────────
      case "ui":
        await runUi({ open });
        break;

      default: {
        printError(`Unknown command: ${style.bold(cmd)}`);
        const suggestions = suggestCommand(cmd);
        if (suggestions.length > 0) {
          hint(`Did you mean: ${suggestions.map((s) => style.cyan(s)).join(", ")}?`);
        }
        hint("Run `pnpm manasvi --help` for available commands");
        process.exit(1);
      }
    }
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    if (verbose) console.error(err);
    process.exit(1);
  }
}

void main();
