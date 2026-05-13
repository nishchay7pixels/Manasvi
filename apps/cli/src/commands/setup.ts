/**
 * manasvi setup
 *
 * Guided first-run wrapper. Composes init + onboard + doctor.
 * Safe to re-run.
 */

import {
  banner, section, success, warn, info, hint, step, nextSteps, checkRow
} from "../lib/ui.js";
import { select, confirm } from "../lib/prompt.js";
import { loadConfig, cliHomePath } from "../lib/config.js";
import { fileExists, envFilePath } from "../lib/env.js";
import { runInit } from "./init.js";
import { runOnboard } from "./onboard.js";
import { runDoctor } from "./doctor.js";
import { printJson, jsonOk, jsonFail, type CliError } from "../lib/json.js";

type SetupProfile = "demo" | "dev" | "telegram" | "google" | "advanced";

export interface SetupOptions {
  yes?: boolean;
  profile?: string;
  json?: boolean;
}

const PROFILE_DESCRIPTIONS: Record<SetupProfile, string> = {
  demo: "Quick local demo — mock model, no channels",
  dev: "Local development — configure model provider interactively",
  telegram: "Telegram-connected assistant — model + Telegram bot",
  google: "Google integration — model + Gmail/Calendar access",
  advanced: "Manual/advanced — full interactive onboard"
};

export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const isJson = opts.json ?? false;

  if (!isJson) {
    banner("setup");
    info("Manasvi setup — configures everything you need to get started.");
    console.log();
  }

  const errors: CliError[] = [];
  const warnings: string[] = [];
  const nextStepsList: string[] = [];

  try {
    // ── Step 1: Detect init state ─────────────────────────────────────────────

    if (!isJson) section("Checking initialization");

    const config = await loadConfig();
    const homeExists = await fileExists(cliHomePath());
    const isInitialized = config?.initialized ?? false;

    if (!isJson) {
      checkRow("CLI home (~/.manasvi)", homeExists ? "pass" : "fail",
        homeExists ? cliHomePath() : "not found");
      checkRow("Initialized", isInitialized ? "pass" : "fail",
        isInitialized ? "yes" : "run init first");
    }

    if (!isInitialized) {
      if (!isJson) {
        console.log();
        info("Manasvi is not initialized. Running init first...");
        console.log();
      }
      await runInit({ force: false });
    } else if (!isJson) {
      success("Already initialized");
    }

    // ── Step 2: Detect .env.local ─────────────────────────────────────────────

    const currentConfig = await loadConfig();
    const projectRoot = currentConfig?.projectPath ?? process.cwd();
    const envPath = envFilePath(projectRoot);
    const envExists = await fileExists(envPath);

    if (!isJson) {
      checkRow(".env.local", envExists ? "pass" : "warn",
        envExists ? envPath : "will be created by init");
    }

    // ── Step 3: Detect current model provider ────────────────────────────────

    const currentProvider = currentConfig?.model?.provider;
    const isOnboarded = currentConfig?.onboarded ?? false;

    if (!isJson && currentProvider) {
      checkRow("Model provider", "pass", currentProvider);
    }

    // ── Step 4: Choose setup profile ─────────────────────────────────────────

    let profile: SetupProfile = (opts.profile as SetupProfile) ?? "dev";

    if (!opts.yes && !opts.profile && !isJson) {
      console.log();
      section("Setup mode");
      info("Choose how you want to set up Manasvi:");
      console.log();

      const profileChoice = await select(
        "Which setup mode?",
        [
          { value: "demo", label: "Quick local demo", description: PROFILE_DESCRIPTIONS.demo },
          { value: "dev", label: "Local development", description: PROFILE_DESCRIPTIONS.dev },
          { value: "telegram", label: "Telegram-connected assistant", description: PROFILE_DESCRIPTIONS.telegram },
          { value: "google", label: "Google integration setup", description: PROFILE_DESCRIPTIONS.google },
          { value: "advanced", label: "Advanced / manual", description: PROFILE_DESCRIPTIONS.advanced }
        ],
        1
      );
      profile = profileChoice as SetupProfile;
    }

    if (!isJson) {
      console.log();
      section(`Configuring — profile: ${profile}`);
      info(PROFILE_DESCRIPTIONS[profile]);
      console.log();
    }

    // ── Step 5: Run onboard based on profile ─────────────────────────────────

    if (!isOnboarded || !opts.yes) {
      if (profile === "demo") {
        // Demo: use mock model, no channels
        await runOnboard({ yes: true, provider: "mock" });

      } else if (profile === "dev") {
        // Dev: interactive model selection
        await runOnboard({ yes: opts.yes });

      } else if (profile === "telegram") {
        // Telegram: interactive, but hint telegram focus
        if (!isJson) {
          info("This profile configures your model and connects a Telegram bot.");
          hint("You will need: a model API key or local Ollama, and a Telegram bot token from @BotFather.");
          console.log();
        }
        await runOnboard({ yes: opts.yes });

      } else if (profile === "google") {
        // Google: configure model first, then show Google integration steps
        await runOnboard({ yes: opts.yes });
        if (!isJson) {
          console.log();
          section("Google Integration");
          info("To connect Google, your services must be running first.");
          step("After starting services, run:", "pnpm manasvi integrations add google");
          step("Then check:", "pnpm manasvi integrations status");
          nextStepsList.push("pnpm manasvi start");
          nextStepsList.push("pnpm manasvi integrations add google");
          nextStepsList.push("pnpm manasvi integrations status");
        }

      } else {
        // Advanced: full interactive onboard
        await runOnboard({ yes: opts.yes });
      }
    } else if (!isJson) {
      info("Already onboarded — skipping model/channel setup.");
      hint("Run `pnpm manasvi onboard` to reconfigure, or `pnpm manasvi onboard --force` to restart.");
    }

    // ── Step 6: Run doctor ───────────────────────────────────────────────────

    if (!isJson) {
      console.log();
      section("Health check");
    }

    await runDoctor({ json: false });

    // ── Step 7: Print next steps ─────────────────────────────────────────────

    if (!isJson) {
      // Build next steps by profile
      if (nextStepsList.length === 0) {
        nextStepsList.push("pnpm manasvi start");
        nextStepsList.push("pnpm manasvi status");
        if (profile === "telegram") {
          nextStepsList.push("Open Telegram and message your bot");
        }
        if (profile === "google") {
          nextStepsList.push("pnpm manasvi integrations add google");
        }
        nextStepsList.push("pnpm manasvi doctor    # re-check any issues");
      }

      nextSteps(nextStepsList);
    } else {
      const finalConfig = await loadConfig();
      printJson(jsonOk("setup", {
        profile,
        initialized: true,
        onboarded: true,
        modelProvider: finalConfig?.model?.provider,
        channels: Object.entries(finalConfig?.channels ?? {})
          .filter(([, v]) => v?.enabled)
          .map(([k]) => k)
      }, {
        warnings: warnings.map((w) => ({ code: "setup.warn", message: w })),
        nextSteps: nextStepsList.length > 0 ? nextStepsList : [
          "pnpm manasvi start",
          "pnpm manasvi status"
        ]
      }));
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({ code: "setup.error", message, fix: "pnpm manasvi doctor" });

    if (isJson) {
      printJson(jsonFail("setup", errors, null, {
        nextSteps: ["pnpm manasvi doctor", "pnpm manasvi init"]
      }));
    } else {
      throw err;
    }
    process.exit(1);
  }
}
