/**
 * manasvi models <list|add|remove|test|use>
 */

import { banner, section, info, success, warn, hint, style } from "../lib/ui.js";
import { select, input, secret } from "../lib/prompt.js";
import { loadConfig, saveConfig, type ModelProvider } from "../lib/config.js";
import { envFilePath, mergeEnvFile, readEnvFile } from "../lib/env.js";
import { checkAnthropic, checkDeepSeek, checkOllama, checkOpenAI, listAnthropicModels } from "../lib/health.js";
import { printJson, jsonOk, jsonFail } from "../lib/json.js";

export async function runModelsList(opts: { json?: boolean } = {}): Promise<void> {
  const config = await loadConfig();

  if (opts.json) {
    if (!config?.initialized) {
      printJson(jsonFail("models list", [{ code: "not_initialized", message: "Run pnpm manasvi init first" }]));
      process.exit(1);
    }
    printJson(jsonOk("models list", {
      activeProvider: config.model.provider,
      providers: {
        deepseek: { model: config.model.deepseekModel, baseUrl: config.model.deepseekBaseUrl, active: config.model.provider === "deepseek" },
        ollama: { model: config.model.ollamaModel, baseUrl: config.model.ollamaBaseUrl, active: config.model.provider === "ollama" },
        openai: { model: config.model.openaiModel, baseUrl: config.model.openaiBaseUrl, active: config.model.provider === "openai" },
        claude: { model: config.model.claudeModel, baseUrl: config.model.claudeBaseUrl, active: config.model.provider === "claude" },
        mock: { model: "mock", baseUrl: null, active: config.model.provider === "mock" }
      }
    }, { nextSteps: ["pnpm manasvi models test", "pnpm manasvi models use <provider>"] }));
    return;
  }

  banner("models");

  if (!config?.initialized) {
    warn("Run `pnpm manasvi init` first");
    return;
  }

  section("Configured providers");

  const rows = [
    {
      label: "DeepSeek (cloud)",
      value: `${config.model.deepseekModel} @ ${config.model.deepseekBaseUrl}`,
      status: config.model.provider === "deepseek" ? "ok" : "dim"
    },
    {
      label: "Ollama (local)",
      value: `${config.model.ollamaModel} @ ${config.model.ollamaBaseUrl}`,
      status: config.model.provider === "ollama" ? "ok" : "dim"
    },
    {
      label: "OpenAI (cloud)",
      value: config.model.openaiModel + " @ " + config.model.openaiBaseUrl,
      status: config.model.provider === "openai" ? "ok" : "dim"
    },
    {
      label: "Claude (Anthropic)",
      value: config.model.claudeModel + " @ " + config.model.claudeBaseUrl,
      status: config.model.provider === "claude" ? "ok" : "dim"
    },
    {
      label: "Mock (testing)",
      value: "simulated responses",
      status: config.model.provider === "mock" ? "ok" : "dim"
    }
  ] as const;

  for (const row of rows) {
    const marker = row.status === "ok" ? ` ${style.green("← active")}` : "";
    console.log(`  ${style.dim(row.label.padEnd(18))}  ${row.value}${marker}`);
  }

  console.log();
  info(`Active: ${config.model.provider}`);
  hint("Change with: pnpm manasvi models use <deepseek|ollama|openai|claude|mock>");
  console.log();
}

export async function runModelsAdd(provider?: string): Promise<void> {
  banner("models add");

  const config = await loadConfig();
  if (!config?.initialized) {
    warn("Run `pnpm manasvi init` first");
    return;
  }

  const envPath = envFilePath(config.projectPath);

  if (!provider) {
    provider = await select("Which provider to configure?", [
      { value: "deepseek", label: "DeepSeek", description: "cloud API" },
      { value: "ollama", label: "Ollama", description: "local model runner" },
      { value: "openai", label: "OpenAI", description: "cloud API" },
      { value: "claude", label: "Claude", description: "Anthropic cloud API" }
    ]);
  }

  if (provider === "deepseek") {
    const existingEnv = await readEnvFile(envPath);
    const existing = existingEnv.DEEPSEEK_API_KEY ?? "";
    const apiKey = existing || (await secret("DeepSeek API key"));
    const baseUrl = await input("DeepSeek base URL", config.model.deepseekBaseUrl);
    const modelName = await input("Model name", config.model.deepseekModel);

    const ok = await checkDeepSeek(baseUrl, apiKey);
    if (ok) {
      success("DeepSeek API key validated");
    } else {
      warn("Could not validate API key — check the key and try again");
    }

    config.model.deepseekBaseUrl = baseUrl;
    config.model.deepseekModel = modelName;
    await saveConfig(config);
    await mergeEnvFile(
      envPath,
      { DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: baseUrl },
      { force: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"] }
    );

    success(`DeepSeek configured: ${modelName}`);
    hint("Set as active: pnpm manasvi models use deepseek");
  }

  if (provider === "ollama") {
    const ollamaUrl = await input("Ollama base URL", config.model.ollamaBaseUrl);
    const modelName = await input("Model name", config.model.ollamaModel);

    const ok = await checkOllama(ollamaUrl);
    if (ok) {
      success("Ollama is reachable");
    } else {
      warn("Ollama not reachable at " + ollamaUrl);
      hint("Start with: ollama serve");
    }

    config.model.ollamaBaseUrl = ollamaUrl;
    config.model.ollamaModel = modelName;
    await saveConfig(config);
    await mergeEnvFile(envPath, { OLLAMA_BASE_URL: ollamaUrl }, { force: ["OLLAMA_BASE_URL"] });

    success(`Ollama configured: ${modelName} @ ${ollamaUrl}`);
    hint("Set as active: pnpm manasvi models use ollama");
  }

  if (provider === "openai") {
    const existingEnv = await readEnvFile(envPath);
    const existing = existingEnv.OPENAI_API_KEY ?? "";
    const apiKey = existing || (await secret("OpenAI API key"));
    const baseUrl = await input("OpenAI base URL", config.model.openaiBaseUrl);
    const modelName = await input("Model name", config.model.openaiModel);

    const ok = await checkOpenAI(baseUrl, apiKey);
    if (ok) {
      success("OpenAI API key validated");
    } else {
      warn("Could not validate API key — check the key and try again");
    }

    config.model.openaiBaseUrl = baseUrl;
    config.model.openaiModel = modelName;
    await saveConfig(config);
    await mergeEnvFile(
      envPath,
      { OPENAI_API_KEY: apiKey, OPENAI_BASE_URL: baseUrl },
      { force: ["OPENAI_API_KEY", "OPENAI_BASE_URL"] }
    );

    success(`OpenAI configured: ${modelName}`);
    hint("Set as active: pnpm manasvi models use openai");
  }

  if (provider === "claude") {
    const existingEnv = await readEnvFile(envPath);
    const existing = existingEnv.ANTHROPIC_API_KEY ?? "";
    const apiKey = existing || (await secret("Anthropic API key"));
    const baseUrl = await input("Anthropic base URL", config.model.claudeBaseUrl);
    let modelName = config.model.claudeModel;

    const modelIds = apiKey ? await listAnthropicModels(baseUrl, apiKey) : [];
    if (modelIds.length > 0) {
      info(`Discovered ${modelIds.length} Claude model(s)`);
      hint(`Examples: ${modelIds.slice(0, 5).join(", ")}`);
    } else {
      hint("Could not list models from Anthropic API — using manual model entry");
    }
    modelName = await input("Model name", modelName);

    const ok = await checkAnthropic(baseUrl, apiKey);
    if (ok) {
      success("Anthropic API key validated");
    } else {
      warn("Could not validate Anthropic key — check key/model/base URL and try again");
    }

    config.model.claudeBaseUrl = baseUrl;
    config.model.claudeModel = modelName;
    await saveConfig(config);
    await mergeEnvFile(
      envPath,
      { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl },
      { force: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] }
    );

    success(`Claude configured: ${modelName}`);
    hint("Set as active: pnpm manasvi models use claude");
  }

  console.log();
}

export async function runModelsTest(): Promise<void> {
  banner("models test");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const provider = config.model.provider;
  info(`Testing ${provider}…`);

  if (provider === "deepseek") {
    const env = await readEnvFile(envFilePath(config.projectPath));
    const key = env.DEEPSEEK_API_KEY ?? "";
    if (!key) { warn("DEEPSEEK_API_KEY not set"); return; }
    const ok = await checkDeepSeek(config.model.deepseekBaseUrl, key);
    ok ? success("DeepSeek API key is valid") : warn("DeepSeek API key validation failed");
  } else if (provider === "ollama") {
    const ok = await checkOllama(config.model.ollamaBaseUrl);
    ok ? success("Ollama is reachable") : warn("Ollama is not reachable at " + config.model.ollamaBaseUrl);
  } else if (provider === "openai") {
    const env = await readEnvFile(envFilePath(config.projectPath));
    const key = env.OPENAI_API_KEY ?? "";
    if (!key) { warn("OPENAI_API_KEY not set"); return; }
    const ok = await checkOpenAI(config.model.openaiBaseUrl, key);
    ok ? success("OpenAI API key is valid") : warn("OpenAI API key validation failed");
  } else if (provider === "claude") {
    const env = await readEnvFile(envFilePath(config.projectPath));
    const key = env.ANTHROPIC_API_KEY ?? "";
    if (!key) { warn("ANTHROPIC_API_KEY not set"); return; }
    const ok = await checkAnthropic(config.model.claudeBaseUrl, key);
    ok ? success("Anthropic API key is valid") : warn("Anthropic API key validation failed");
  } else {
    success("Mock provider — no connectivity needed");
  }

  console.log();
}

export async function runModelsUse(provider?: string): Promise<void> {
  banner("models use");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  if (!provider) {
    provider = await select("Select active model provider:", [
      { value: "deepseek", label: "DeepSeek (cloud)" },
      { value: "ollama", label: "Ollama (local)" },
      { value: "openai", label: "OpenAI (cloud)" },
      { value: "claude", label: "Claude (Anthropic)" },
      { value: "mock", label: "Mock (testing)" }
    ]);
  }

  const validProviders = ["deepseek", "ollama", "openai", "claude", "mock"];
  if (!validProviders.includes(provider)) {
    warn(`Unknown provider: ${provider}. Valid: deepseek, ollama, openai, claude, mock`);
    return;
  }

  config.model.provider = provider as ModelProvider;
  await saveConfig(config);

  const envPath = envFilePath(config.projectPath);
  const envUpdates: Record<string, string> = {
    MODEL_ADAPTER_MODE: provider,
    MANASVI_MODEL_PROVIDER: provider
  };

  if (provider === "deepseek") {
    envUpdates.PLANNER_MODEL = config.model.deepseekModel;
    envUpdates.MANASVI_MODEL = config.model.deepseekModel;
    envUpdates.DEEPSEEK_BASE_URL = config.model.deepseekBaseUrl;
  }
  if (provider === "ollama") {
    envUpdates.PLANNER_MODEL = config.model.ollamaModel;
    envUpdates.MANASVI_MODEL = config.model.ollamaModel;
    envUpdates.OLLAMA_BASE_URL = config.model.ollamaBaseUrl;
  }
  if (provider === "openai") {
    envUpdates.PLANNER_MODEL = config.model.openaiModel;
    envUpdates.MANASVI_MODEL = config.model.openaiModel;
    envUpdates.OPENAI_BASE_URL = config.model.openaiBaseUrl;
  }
  if (provider === "claude") {
    envUpdates.PLANNER_MODEL = config.model.claudeModel;
    envUpdates.MANASVI_MODEL = config.model.claudeModel;
    envUpdates.ANTHROPIC_BASE_URL = config.model.claudeBaseUrl;
  }

  await mergeEnvFile(envPath, envUpdates, { force: Object.keys(envUpdates) });

  success(`Active model provider: ${provider}`);
  hint("Restart services to apply: pnpm manasvi restart");
  console.log();
}
