/**
 * manasvi approvals <list|inspect|approve|reject>
 *
 * Approval queue management.
 * NOTE: Backend approval REST API is not yet implemented.
 * These commands are scaffolded with honest messaging about what is missing.
 */

import { banner, section, info, warn, hint, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";
import { printJson, jsonFail } from "../lib/json.js";

const BACKEND_NOTE = "Approval queue CLI requires a REST API on the approval-service (/approvals). This API is not yet implemented.";

export interface ApprovalsOptions {
  json?: boolean;
}

function scaffoldedResponse(command: string, sub: string, opts: ApprovalsOptions): void {
  if (opts.json) {
    printJson(jsonFail(`approvals ${sub}`, [{
      code: "approvals.not_implemented",
      message: BACKEND_NOTE,
      fix: "Monitor the Manasvi changelog for approval queue CLI support"
    }]));
    return;
  }

  banner(`approvals ${sub}`);

  warn("Approval queue CLI is not yet implemented.");
  console.log();
  info(BACKEND_NOTE);
  console.log();

  section("What's needed");
  console.log(`  ${style.dim("→")} Approval service must expose a REST API for queue management`);
  console.log(`  ${style.dim("→")} Endpoints needed: GET /approvals, GET /approvals/:id, POST /approvals/:id/decision`);
  console.log(`  ${style.dim("→")} Authentication: internal JWT required`);
  console.log();

  section("Planned CLI flow");
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi approvals list")}              ${style.dim("# List pending approvals")}`);
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi approvals inspect <id>")}      ${style.dim("# Full details for one approval")}`);
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi approvals approve <id>")}      ${style.dim("# Approve (requires confirmation)")}`);
  console.log(`  ${style.dim("$")} ${style.cyan("pnpm manasvi approvals reject <id>")}       ${style.dim("# Reject with reason")}`);
  console.log();
  hint("Approvals can be managed via the Telegram channel in the meantime.");
  hint("Run `pnpm manasvi channels status` to verify Telegram is active.");
  console.log();
}

export async function runApprovals(
  sub?: string,
  target?: string,
  opts: ApprovalsOptions = {}
): Promise<void> {
  const config = await loadConfig();
  const approvalRunning = config ? await isPortInUse(config.services.approvalPort) : false;

  switch (sub ?? "list") {
    case "list":
    case "inspect":
    case "approve":
    case "reject":
      scaffoldedResponse("approvals", sub ?? "list", opts);
      break;

    default:
      if (opts.json) {
        printJson(jsonFail("approvals", [{
          code: "approvals.unknown_sub",
          message: `Unknown subcommand: approvals ${sub}`,
          fix: "Valid: list, inspect, approve, reject"
        }]));
      } else {
        warn(`Unknown subcommand: approvals ${sub}`);
        hint("Valid subcommands: list, inspect, approve, reject");
      }
      process.exit(1);
  }
}
