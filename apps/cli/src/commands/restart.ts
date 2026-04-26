/**
 * manasvi restart
 * Stops all services then starts them again.
 */

import { banner, section, info } from "../lib/ui.js";
import { runStop } from "./stop.js";
import { runStart } from "./start.js";

export async function runRestart(opts: { force?: boolean } = {}): Promise<void> {
  banner("restart");
  await runStop({ force: opts.force });
  console.log();
  info("Restarting…");
  console.log();
  await runStart();
}
