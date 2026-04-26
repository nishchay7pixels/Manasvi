/**
 * manasvi plugins <list|inspect>
 * Plugin management commands (extension plane).
 */

import { banner, section, info, warn, hint, style } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";

export async function runPluginsList(): Promise<void> {
  banner("plugins");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  section("Installed plugins");

  // Extension plane is scaffolded — no plugins installed yet
  console.log(`  ${style.dim("○")} No plugins installed`);
  console.log();

  info("Plugins extend Manasvi with new tools and integrations.");
  hint("Plugin support is available in the extension plane (apps/extension-runtime).");
  hint("Each plugin runs in its own isolated process with declared capabilities.");
  console.log();

  section("How plugins work");
  console.log(`  ${style.dim("1.")} Create a plugin manifest declaring required capabilities`);
  console.log(`  ${style.dim("2.")} Submit the manifest — capabilities require operator approval`);
  console.log(`  ${style.dim("3.")} Once approved, the plugin process is launched`);
  console.log(`  ${style.dim("4.")} Plugin tools appear in the registry automatically`);
  console.log();

  hint("See docs: pnpm manasvi docs");
  console.log();
}

export async function runPluginsInspect(pluginId?: string): Promise<void> {
  banner("plugins inspect");
  info("No plugins are currently installed.");
  console.log();
}
