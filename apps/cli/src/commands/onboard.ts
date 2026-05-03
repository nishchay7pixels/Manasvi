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
import { checkAnthropic, checkDeepSeek, checkOllama, checkOpenAI, listAnthropicModels } from "../lib/health.js";

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
  const envUpdates: Record<string, string> = {};

  // ── Model Provider ───────────────────────────────────────────────────────────

  section("Model Provider");
  info("Manasvi needs an AI model to generate responses and plan actions.");
  info("DeepSeek is the default provider for cloud setup.");

  let provider: ModelProvider = config.model.provider;

  if (!opts.yes) {
    const providerChoice = await select(
      "Which model provider do you want to use?",
      [
        { value: "ollama", label: "Ollama (local)", description: "Run models on your own machine — no API key needed" },
        { value: "deepseek", label: "DeepSeek (cloud)", description: "Use DeepSeek via API key" },
        { value: "openai", label: "OpenAI (cloud)", description: "Use GPT models via OpenAI API key" },
        { value: "claude", label: "Claude (Anthropic cloud)", description: "Use Claude models via Anthropic API key" },
        { value: "mock", label: "Mock (testing only)", description: "Simulated responses — useful for testing the system" }
      ],
      provider === "deepseek" ? 0 : provider === "ollama" ? 1 : provider === "openai" ? 2 : provider === "claude" ? 3 : 4
    );
    provider = providerChoice as ModelProvider;
  } else if (opts.provider) {
    provider = opts.provider as ModelProvider;
  }

  if (provider === "deepseek") {
    const existingEnv = await readEnvFile(envPath);
    const existingKey = existingEnv.DEEPSEEK_API_KEY;
    let apiKey = existingKey ?? "";
    if (!apiKey && !opts.yes) {
      info("You can get an API key from DeepSeek.");
      apiKey = await secret("Enter your DeepSeek API key");
    }

    if (apiKey) {
      const modelName = await (opts.yes
        ? Promise.resolve(config.model.deepseekModel)
        : input("Which DeepSeek model?", config.model.deepseekModel));
      if (apiKey !== existingKey) {
        const ok = await checkDeepSeek(config.model.deepseekBaseUrl, apiKey);
        if (ok) {
          success("DeepSeek API key validated");
        } else {
          warn("Could not validate DeepSeek API key — proceeding anyway");
        }
        envUpdates.DEEPSEEK_API_KEY = apiKey;
      }
      config = {
        ...config,
        model: { ...config.model, provider: "deepseek", deepseekModel: modelName }
      };
      envUpdates.MODEL_ADAPTER_MODE = "deepseek";
      envUpdates.MANASVI_MODEL_PROVIDER = "deepseek";
      envUpdates.MANASVI_MODEL = modelName;
      envUpdates.PLANNER_MODEL = modelName;
      envUpdates.DEEPSEEK_BASE_URL = config.model.deepseekBaseUrl;
      success(`Model: DeepSeek / ${modelName}`);
    } else {
      warn("No API key provided — falling back to mock mode");
      provider = "mock";
    }
  }

  if (provider === "ollama") {
    const ollamaUrl = config.model.ollamaBaseUrl;
    let ollamaOk = await checkOllama(ollamaUrl);

    if (!ollamaOk) {
      warn("Ollama is not running at " + ollamaUrl);
      hint("Start Ollama with: ollama serve");
      hint("Then install a model: ollama pull llama3.2");
      hint("See: https://ollama.com for installation instructions");

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
        hint("Suggested models: llama3.2, mistral, qwen2.5");
        modelName = await input("Which Ollama model?", modelName);
      }
      config = {
        ...config,
        model: { ...config.model, provider: "ollama", ollamaModel: modelName }
      };
      envUpdates.MODEL_ADAPTER_MODE = "ollama";
      envUpdates.MANASVI_MODEL_PROVIDER = "ollama";
      envUpdates.MANASVI_MODEL = modelName;
      envUpdates.OLLAMA_BASE_URL = ollamaUrl;
      envUpdates.PLANNER_MODEL = modelName;
      success(`Model: Ollama / ${modelName}`);
    }
  }

  if (provider === "openai") {
    const existingEnv = await readEnvFile(envPath);
    const existingKey = existingEnv.OPENAI_API_KEY;

    let apiKey = existingKey ?? "";
    if (!apiKey && !opts.yes) {
      info("You can get an API key at platform.openai.com");
      apiKey = await secret("Enter your OpenAI API key (sk-...)");
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
      envUpdates.MANASVI_MODEL_PROVIDER = "openai";
      envUpdates.MANASVI_MODEL = modelName;
      envUpdates.PLANNER_MODEL = modelName;
      success(`Model: OpenAI / ${modelName}`);
    } else {
      warn("No API key provided — falling back to mock mode");
      provider = "mock";
    }
  }

  if (provider === "claude") {
    const existingEnv = await readEnvFile(envPath);
    const existingKey = existingEnv.ANTHROPIC_API_KEY;

    let apiKey = existingKey ?? "";
    if (!apiKey && !opts.yes) {
      info("You can get an API key at console.anthropic.com");
      apiKey = await secret("Enter your Anthropic API key (sk-ant-...)");
    }

    if (apiKey) {
      let modelName = config.model.claudeModel;
      const discoveredModels = await listAnthropicModels(config.model.claudeBaseUrl, apiKey);
      if (!opts.yes && discoveredModels.length > 0) {
        hint(`Detected Claude models: ${discoveredModels.slice(0, 5).join(", ")}`);
      }
      if (!opts.yes) {
        modelName = await input("Which Claude model?", modelName);
      }

      const checking = apiKey !== existingKey;
      if (checking) {
        const ok = await checkAnthropic(config.model.claudeBaseUrl, apiKey);
        if (ok) {
          success("Anthropic API key validated");
        } else {
          warn("Could not validate Anthropic API key — proceeding anyway");
        }
        envUpdates.ANTHROPIC_API_KEY = apiKey;
      }

      config = {
        ...config,
        model: { ...config.model, provider: "claude", claudeModel: modelName }
      };
      envUpdates.MODEL_ADAPTER_MODE = "claude";
      envUpdates.MANASVI_MODEL_PROVIDER = "claude";
      envUpdates.MANASVI_MODEL = modelName;
      envUpdates.PLANNER_MODEL = modelName;
      envUpdates.ANTHROPIC_BASE_URL = config.model.claudeBaseUrl;
      success(`Model: Claude / ${modelName}`);
    } else {
      warn("No API key provided — falling back to mock mode");
      provider = "mock";
    }
  }

  if (provider === "mock") {
    config = { ...config, model: { ...config.model, provider: "mock" } };
    envUpdates.MODEL_ADAPTER_MODE = "mock";
    envUpdates.MANASVI_MODEL_PROVIDER = "mock";
    info("Using mock model mode (simulated responses, good for testing the pipeline)");
  }

  // ── Channels ─────────────────────────────────────────────────────────────────

  section("Channels");
  info("Channels are how users send messages to Manasvi.");
  info("You can also use the terminal (pnpm cli) without setting up a channel.");

  // ── Telegram ─────────────────────────────────────────────────────────────────

  let telegramEnabled = config.channels.telegram?.enabled ?? false;
  if (!opts.yes) {
    info("Telegram is the easiest channel to start with.");
    info("In polling mode, Manasvi checks Telegram for messages — no public URL needed.");
    telegramEnabled = await confirm("Connect a Telegram bot?", telegramEnabled);
  }

  if (telegramEnabled) {
    const existingEnv = await readEnvFile(envPath);
    const existingToken = existingEnv.TELEGRAM_BOT_TOKEN ?? "";

    let botToken = existingToken;
    if (!botToken && !opts.yes) {
      info("To get a bot token: open Telegram → search @BotFather → /newbot");
      hint("BotFather will give you a token that looks like: 7123456789:AAEOm3xyz...");
      botToken = await secret("Enter your Telegram bot token");
    }

    if (botToken) {
      // Mode selection
      const existingMode = config.channels.telegram?.mode ?? "polling";
      let mode: "polling" | "webhook" = existingMode;

      if (!opts.yes) {
        const modeChoice = await select(
          "How should Manasvi receive Telegram messages?",
          [
            {
              value: "polling",
              label: "Polling mode (recommended for local)",
              description: "Manasvi checks Telegram for new messages — no public URL needed"
            },
            {
              value: "webhook",
              label: "Webhook mode (for public servers)",
              description: "Telegram pushes messages to your server — requires a public HTTPS URL"
            }
          ],
          existingMode === "polling" ? 0 : 1
        );
        mode = modeChoice as "polling" | "webhook";
      }

      let webhookUrl: string | undefined;

      if (mode === "webhook" && !opts.yes) {
        const existingWebhookUrl = existingEnv.TELEGRAM_WEBHOOK_URL ?? config.channels.telegram?.webhookUrl ?? "";
        webhookUrl = await input("Public HTTPS base URL (e.g., https://abc123.ngrok-free.app)", existingWebhookUrl);
        if (!webhookUrl) {
          warn("No webhook URL provided — falling back to polling mode");
          mode = "polling";
        } else {
          envUpdates.TELEGRAM_WEBHOOK_URL = webhookUrl;
        }
      }

      if (botToken !== existingToken) envUpdates.TELEGRAM_BOT_TOKEN = botToken;
      envUpdates.TELEGRAM_ADAPTER_MODE = mode;

      config = {
        ...config,
        channels: {
          ...config.channels,
          telegram: {
            enabled: true,
            mode,
            ...(webhookUrl ? { webhookUrl } : {})
          }
        }
      };

      success(`Telegram channel configured (${mode} mode)`);
      if (mode === "polling") {
        hint("Polling starts automatically when you run: pnpm manasvi start");
      } else {
        hint("After starting, register the webhook: pnpm manasvi channels add telegram");
      }
    } else {
      warn("No token provided — Telegram not configured");
      telegramEnabled = false;
    }
  } else {
    config = { ...config, channels: { ...config.channels, telegram: { enabled: false, mode: "polling" } } };
    if (!telegramEnabled) {
      info("Telegram not configured (add later: pnpm manasvi channels add telegram)");
    }
  }

  // ── Slack ─────────────────────────────────────────────────────────────────────

  let slackEnabled = config.channels.slack?.enabled ?? false;
  if (!opts.yes) {
    slackEnabled = await confirm("Connect a Slack workspace?", slackEnabled);
  }

  if (slackEnabled) {
    const existingEnv = await readEnvFile(envPath);
    const existingBotToken = existingEnv.SLACK_BOT_TOKEN ?? "";
    const existingSigningSecret = existingEnv.SLACK_SIGNING_SECRET ?? "";

    let botToken = existingBotToken;
    let signingSecret = existingSigningSecret;

    if (!botToken && !opts.yes) {
      info("Create a Slack app at api.slack.com/apps and add the Bot Token Scopes.");
      hint("You need: app_mentions:read, chat:write, im:history, im:read");
      botToken = await secret("Enter your Slack bot token (xoxb-...)");
    }

    if (!signingSecret && !opts.yes) {
      hint("Find the Signing Secret under App Credentials in your Slack app settings.");
      signingSecret = await secret("Enter your Slack signing secret");
    }

    if (botToken && signingSecret) {
      config = {
        ...config,
        channels: { ...config.channels, slack: { enabled: true } }
      };
      if (botToken !== existingBotToken) {
        envUpdates.SLACK_BOT_TOKEN = botToken;
      }
      if (signingSecret !== existingSigningSecret) {
        envUpdates.SLACK_SIGNING_SECRET = signingSecret;
      }
      success("Slack channel configured");
      hint("Slack requires a public URL for event delivery. See: pnpm manasvi channels status");
    } else {
      warn("Missing credentials — Slack not configured");
      slackEnabled = false;
    }
  } else {
    config = { ...config, channels: { ...config.channels, slack: { enabled: false } } };
    if (!slackEnabled) {
      info("Slack not configured (add later: pnpm manasvi channels add slack)");
    }
  }

  // ── Web UI / Docs ─────────────────────────────────────────────────────────────

  section("Web UI & Docs");
  info("The docs web UI is a local copy of the Manasvi documentation.");

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
  step("Model", provider === "ollama"
    ? `Ollama / ${config.model.ollamaModel}`
    : provider === "openai"
      ? `OpenAI / ${config.model.openaiModel}`
      : provider === "claude"
        ? `Claude / ${config.model.claudeModel}`
      : "Mock (testing)");
  step("Telegram", telegramEnabled
    ? `enabled (${config.channels.telegram?.mode ?? "polling"} mode)`
    : "not configured");
  step("Slack", slackEnabled ? "enabled" : "not configured");
  step("Web UI", docsEnabled ? `http://localhost:${config.ui.docsPort}` : "disabled");

  const steps: string[] = [
    "`pnpm manasvi start` — start all services",
    "`pnpm cli` — chat with Manasvi in the terminal",
    "`pnpm manasvi status` — check service health"
  ];
  if (!telegramEnabled && !slackEnabled) {
    steps.push("`pnpm manasvi channels add telegram` — add Telegram later");
  }
  if (telegramEnabled || slackEnabled) {
    steps.push("`pnpm manasvi channels status` — verify channel connectivity");
  }

  nextSteps(steps);
}
