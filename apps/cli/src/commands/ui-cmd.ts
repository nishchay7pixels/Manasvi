/**
 * manasvi ui
 * Opens or prints the Manasvi docs/control UI URL.
 */

import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import { banner, info, success, warn, hint, step, code } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
  } catch {
    // Silently fail — we'll print the URL anyway
  }
}

export async function runUi(opts: { open?: boolean } = {}): Promise<void> {
  banner("ui");

  const config = await loadConfig();
  const docsPort = config?.ui.docsPort ?? 3002;
  const docsUrl = `http://localhost:${docsPort}`;

  const isRunning = await isPortInUse(docsPort);

  if (isRunning) {
    success(`Docs UI is running at ${docsUrl}`);
    if (opts.open) {
      openBrowser(docsUrl);
      info("Opening in browser…");
    } else {
      hint("Open in browser with: pnpm manasvi ui --open");
    }
    return;
  }

  warn(`Docs UI is not running on port ${docsPort}`);
  info("Start the docs site with:");
  code(`cd apps/docs-web && pnpm start`);

  hint("Or pass --open to auto-start and open");

  if (opts.open && config?.projectPath) {
    info("Starting docs server…");
    const proc = spawn("pnpm", ["start"], {
      cwd: join(config.projectPath, "apps", "docs-web"),
      detached: true,
      stdio: "ignore"
    });
    proc.unref();

    // Wait a moment for startup
    await new Promise((r) => setTimeout(r, 3000));
    const up = await isPortInUse(docsPort);
    if (up) {
      success(`Docs UI started at ${docsUrl}`);
      openBrowser(docsUrl);
    } else {
      warn("Docs server may still be starting. Try:");
      hint(docsUrl);
    }
  }
}
