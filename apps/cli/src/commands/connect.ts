/**
 * manasvi connect <model|telegram|slack|google>
 * Shortcut to connect a model provider, channel, or external integration.
 * Delegates to the respective existing command internals.
 */

import { banner, info, warn, hint, style } from "../lib/ui.js";
import { runModelsAdd } from "./models.js";
import { runChannelsAdd } from "./channels.js";
import { runIntegrationsAdd, runIntegrationsGoogleModeSelect, runIntegrationsGoogleSetBackend } from "./integrations.js";
import { printJson, jsonFail } from "../lib/json.js";
import type { GoogleIntegrationMode } from "@manasvi/integrations-sdk";

const CONNECT_TARGETS = ["model", "telegram", "slack", "google"] as const;
type ConnectTarget = (typeof CONNECT_TARGETS)[number];

export interface ConnectOptions {
  json?: boolean;
  mode?: string;
  service?: string;
}

export async function runConnect(target?: string, opts: ConnectOptions = {}): Promise<void> {
  if (!target || target.startsWith("-")) {
    // No target — show usage
    if (opts.json) {
      printJson(jsonFail("connect", [{
        code: "connect.no_target",
        message: "No target specified",
        fix: "pnpm manasvi connect <model|telegram|slack|google>"
      }]));
      process.exit(1);
    }

    banner("connect");
    info("Connect a model provider, channel, or integration.");
    console.log();

    const targets = [
      { target: "model", description: "Configure an AI model provider (DeepSeek, Ollama, OpenAI, Claude)" },
      { target: "telegram", description: "Connect a Telegram bot (polling or webhook mode)" },
      { target: "slack", description: "Connect a Slack workspace" },
      { target: "google", description: "Connect Google account (Gmail, Calendar)" }
    ];

    for (const t of targets) {
      console.log(`  ${style.cyan(("pnpm manasvi connect " + t.target).padEnd(32))}  ${style.dim(t.description)}`);
    }
    console.log();
    hint("Example: pnpm manasvi connect telegram");
    return;
  }

  switch (target.toLowerCase() as ConnectTarget) {
    case "model":
      await runModelsAdd(undefined);
      break;

    case "telegram":
      await runChannelsAdd("telegram");
      break;

    case "slack":
      await runChannelsAdd("slack");
      break;

    case "google":
      if (opts.mode && opts.service) {
        await runIntegrationsGoogleSetBackend(opts.service, opts.mode, { json: opts.json });
      } else if (opts.mode) {
        await runIntegrationsGoogleModeSelect(opts.mode as GoogleIntegrationMode, { json: opts.json });
      } else {
        await runIntegrationsAdd("google", undefined);
      }
      break;

    default: {
      const msg = `Unknown connect target: ${target}`;
      if (opts.json) {
        printJson(jsonFail("connect", [{
          code: "connect.unknown_target",
          message: msg,
          fix: `Valid targets: ${CONNECT_TARGETS.join(", ")}`
        }]));
        process.exit(1);
      }
      warn(msg);
      hint(`Valid targets: ${CONNECT_TARGETS.join(", ")}`);
      hint("Example: pnpm manasvi connect telegram");
      process.exit(1);
    }
  }
}
