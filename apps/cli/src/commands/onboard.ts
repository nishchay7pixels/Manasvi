/**
 * manasvi onboard
 *
 * Guided interactive setup for model provider, channels, and preferences.
 * Safe to re-run — preserves existing configuration unless changed.
 */

import {
  banner, section, success, warn, info, hint, step, nextSteps, checkRow
} from "../lib/ui.js";
import { select, confirm, input, secret } from "../lib/prompt.js";
import {
  loadConfig, saveConfig, requireConfig, defaultConfig,
  type ManasviConfig, type ModelProvider
} from "../lib/config.js";
import {
  envFilePath, findProjectRoot, mergeEnvFile, readEnvFile
} from "../lib/env.js";
import { checkOllama, checkOpenAI } from "../lib/health.js";

export interface OnboardOptions {
  yes?: boolean;      // non-interactive: accept all defaults
  provider?: string;  // pre-select model provider
}

export async function runOnboard(opts: OnboardOptions = {}): Promise<void> {
  banner("onboard");

  let config = await loadConfig();
  if (!config?.initialized) {
    warn("Run `pnpm manasvi init` first to initialize Manasvi.");
    process.exit(1);
  }

  const projectRoot = config.projectPath;
  const envPath = envFilePath(projectRoot);

  // ── Model Provider ───────────────────────────────────────────────────────────

  section("Model Provider");
  info("Manasvi needs an AI model to power the agent.");

  let provider: ModelProvider = config.model.provider;

  if (!opts.yes) {
    const providerChoice = await select(
      "Which model provider do you want to use?",
      [
        { value: "ollama", label: "Ollama (local)", description: "Run models on your own machine — no API key needed" },
        { value: "openai", label: "OpenAI (cloud)", description: "Use GPT models via OpenAI API key" },
        { value: "mock", label: "Mock (testing only)", description: "Simulated responses — useful for testing the system" }
      ],
      provider === "ollama" ? 0 : provider === "openai" ? 1 : 2
    );
    provider = providerChoice as ModelProvider;
  } else if (opts.provider) {
    provider = opts.provider as ModelProvider;
  }

  const envUpdates: Record<string, string> = {};

  if (provider === "ollama") {
    const ollamaUrl = config.model.ollamaBaseUrl;
    let ollamaOk = await checkOllama(ollamaUrl);

    if (!ollamaOk) {
      warn("Ollama is not running at " + ollamaUrl);
      hint("Start Ollama with: ollama serve");
      hint("Then install a model: ollama pull llama3.2");

      if (!opts.yes) {
        const proceed = await confirm("Proceed anyway (configure now, start Ollama later)?", true);
        if (!proceed) {
          info("Switching to mock mode for now. Re-run onboard when Ollama is ready.");
          provider = "mock";
        }
      }
    } else {
      success("Ollama is running at " + ollamaUrl);
    }

    if (provider === "ollama") {
      let modelName = config.model.ollamaModel;
      if (!opts.yes) {
        modelName = await input("Which Ollama model?", modelName);
      }
      config = {
        ...config,
        model: { ...config.model, provider: "ollama", ollamaModel: modelName }
      };
      envUpdates.MODEL_ADAPTER_MODE = "ollama";
      envUpdates.OLLAMA_BASE_URL = ollamaUrl;
      success(`Model: Ollama / ${modelName}`);
    }
  }

  if (provider === "openai") {
    const existingEnv = await readEnvFile(envPath);
    const existingKey = existingEnv.OPENAI_API_KEY;

    let apiKey = existingKey ?? "";
    if (!apiKey && !opts.yes) {
      apiKey = await secret("Enter your OpenAI API key");
    }

    if (apiKey) {
      const modelName = await (opts.yes
        ? Promise.resolve(config.model.openaiModel)
        : input("Which OpenAI model?", config.model.openaiModel));

      const checking = apiKey !== existingKey;
      if (checking) {
        const ok = await checkOpenAI(config.model.openaiBaseUrl, apiKey);
        if (ok) {
          success("OpenAI API key validated");
        } else {
          warn("Could not validate OpenAI API key — proceeding anyway");
        }
        envUpdates.OPENAI_API_KEY = apiKey;
      }

      config = {
        ...config,
        model: { ...config.model, provider: "openai", openaiModel: modelName }
      };
      envUpdates.MODEL_ADAPTER_MODE = "openai";
      success(`Model: OpenAI / ${modelName}`);
    } else {
      warn("No API key provided — falling back to mock mode");
      provider = "mock";
    }
  }

  if (provider === "mock") {
    config = { ...config, model: { ...config.model, provider: "mock" } };
    envUpdates.MODEL_ADAPTER_MODE = "mock";
    info("Using mock model mode (simulated responses)");
  }

  // ── Telegram Channel ─────────────────────────────────────────────────────────

  section("Channels");
  info("Channels are how users interact with Manasvi.");

  let telegramEnabled = config.channels.telegram?.enabled ?? false;
  if (!opts.yes) {
    telegramEnabled = await confirm("Connect a Telegram bot?", telegramEnabled);
  }

  if (telegramEnabled) {
    const existingEnv = await readEnvFile(envPath);
    const existingToken = existingEnv.TELEGRAM_BOT_TOKEN ?? "";

    let botToken = existingToken;
    if (!botToken && !opts.yes) {
      info("Get a bot token from @BotFather on Telegram.");
      botToken = await secret("Enter your Telegram bot token");
    }

    if (botToken) {
      config = {
        ...config,
        channels: { ...config.channels, telegram: { enabled: true } }
      };
      if (botToken !== existingToken) {
        envUpdates.TELEGRAM_BOT_TOKEN = botToken;
      }
      success("Telegram channel configured");
      hint("The ingress service will use polling to receive updates.");
    } else {
      warn("No token provided — Telegram not configured");
      telegramEnabled = false;
    }
  } else {
    config = { ...config, channels: { ...config.channels, telegram: { enabled: false } } };
    info("Telegram not configured (can add later with: pnpm manasvi channels add telegram)");
  }

  // ── Web UI / Docs ─────────────────────────────────────────────────────────────

  section("Web UI & Docs");

  let docsEnabled = config.ui.docsEnabled;
  if (!opts.yes) {
    docsEnabled = await confirm("Enable the documentation web UI?", true);
  }

  config = { ...config, ui: { ...config.ui, docsEnabled } };
  if (docsEnabled) {
    success(`Docs UI will be available at http://localhost:${config.ui.docsPort}`);
  }

  // ── Save everything ───────────────────────────────────────────────────────────

  section("Saving configuration");

  config.onboarded = true;
  await saveConfig(config);
  success("CLI config saved");

  if (Object.keys(envUpdates).length > 0) {
    await mergeEnvFile(envPath, envUpdates, {
      section: "Manasvi onboard settings",
      force: Object.keys(envUpdates)
    });
    success(`.env.local updated (${Object.keys(envUpdates).length} values)`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  section("Setup Summary");
  step("Model provider", provider);
  step("Telegram", telegramEnabled ? "enabled" : "not configured");
  step("Web UI", docsEnabled ? `http://localhost:${config.ui.docsPort}` : "disabled");

  nextSteps([
    "`pnpm manasvi start` — start all services",
    "`pnpm manasvi status` — check health",
    "`pnpm manasvi doctor` — diagnose any issues",
    telegramEnabled ? "`pnpm manasvi channels status` — verify Telegram" : "`pnpm manasvi channels add telegram` — add Telegram later"
  ]);
}
