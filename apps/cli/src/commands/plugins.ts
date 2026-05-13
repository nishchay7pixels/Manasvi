/**
 * manasvi plugins <list|inspect|status>
 * Plugin management commands (extension plane).
 * Currently scaffolded — shows honest state and planned capabilities.
 */

import { banner, section, info, warn, hint, style, checkRow } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { isPortInUse } from "../lib/health.js";

const PLUGIN_STATUS_NOTE =
  "Plugin install/remove/list requires the extension runtime API. " +
  "The extension plane (apps/extension-runtime) exists but does not yet expose a REST management API for CLI use.";

export async function runPluginsList(): Promise<void> {
  banner("plugins");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  // Check if extension runtime is available
  // Extension runtime doesn't have a dedicated port in config — probe orchestrator for plugin registry
  const orchestratorRunning = await isPortInUse(config.services.orchestratorPort);

  section("Plugin status");

  checkRow("Extension plane", "skip", "no management API available yet");
  checkRow("Orchestrator (plugin registry)", orchestratorRunning ? "pass" : "warn",
    orchestratorRunning ? `running on :${config.services.orchestratorPort}` : "not running");

  console.log();

  section("Installed plugins");
  console.log(`  ${style.dim("○")} No plugins currently installed`);
  console.log();

  info("Plugins extend Manasvi with new tools and integrations.");
  hint("Each plugin runs in its own isolated process with declared capabilities.");
  console.log();

  section("Plugin lifecycle (planned)");
  console.log(`  ${style.dim("1.")} Create a plugin manifest declaring required capabilities`);
  console.log(`  ${style.dim("2.")} Submit the manifest — capabilities require operator approval`);
  console.log(`  ${style.dim("3.")} Once approved, the plugin process is launched by the extension runtime`);
  console.log(`  ${style.dim("4.")} Plugin tools appear in the tool registry automatically`);
  console.log(`  ${style.dim("5.")} Inspect with: pnpm manasvi plugins inspect <pluginId>`);
  console.log();

  section("Current state");
  warn(PLUGIN_STATUS_NOTE);
  console.log();
  hint("See extension runtime docs: pnpm manasvi ui");
  hint("Inspect tool governance: pnpm manasvi tools list");
  console.log();
}

export async function runPluginsInspect(pluginId?: string): Promise<void> {
  banner("plugins inspect");

  if (!pluginId) {
    warn("No plugin ID specified.");
    hint("Usage: pnpm manasvi plugins inspect <pluginId>");
    hint("Run `pnpm manasvi plugins list` to see installed plugins.");
    return;
  }

  info(`Plugin: ${pluginId}`);
  console.log();
  warn("Plugin inspection is not yet available.");
  console.log();
  info(PLUGIN_STATUS_NOTE);
  console.log();
  hint("Plugin management CLI is planned in the next extension-runtime milestone.");
  console.log();
}

export async function runPluginsStatus(): Promise<void> {
  banner("plugins status");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const orchestratorRunning = await isPortInUse(config.services.orchestratorPort);

  section("Extension plane status");

  checkRow("Orchestrator", orchestratorRunning ? "pass" : "warn",
    orchestratorRunning ? `running (plugin registry accessible)` : "stopped — start with pnpm manasvi start");

  console.log();

  if (orchestratorRunning) {
    // Try to fetch tools from orchestrator — plugins register tools there
    try {
      const res = await fetch(
        `http://localhost:${config.services.orchestratorPort}/admin/tools`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { tools?: Array<{ id: string; source?: string }> };
        const pluginTools = (data.tools ?? []).filter((t) => t.source === "plugin");
        if (pluginTools.length > 0) {
          section("Plugin-registered tools");
          for (const t of pluginTools) {
            console.log(`  ${style.green("●")} ${t.id}`);
          }
        } else {
          info("No plugin-registered tools found in the tool registry.");
        }
      }
    } catch {
      info("Could not query tool registry from orchestrator.");
    }
  }

  console.log();
  warn(PLUGIN_STATUS_NOTE);
  console.log();
}
