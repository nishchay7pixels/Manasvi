/**
 * manasvi models <list|add|remove|test|use>
 */

import { banner, section, info, success, warn, hint, table, step, style } from "../lib/ui.js";
import { select, input, secret, confirm } from "../lib/prompt.js";
import { loadConfig, saveConfig, type ModelProvider } from "../lib/config.js";
import { envFilePath, mergeEnvFile, readEnvFile } from "../lib/env.js";
import { checkOllama, checkOpenAI } from "../lib/health.js";

export async function runModelsList(): Promise<void> {
  banner("models");

  const config = await loadConfig();
  if (!config?.initialized) {
    warn("Run `pnpm manasvi init` first");
    return;
  }

  section("Configured providers");

  const rows = [
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
  hint("Change with: pnpm manasvi models use <ollama|openai|mock>");
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
      { value: "ollama", label: "Ollama", description: "local model runner" },
      { value: "openai", label: "OpenAI", description: "cloud API" }
    ]);
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

  console.log();
}

export async function runModelsTest(): Promise<void> {
  banner("models test");

  const config = await loadConfig();
  if (!config?.initialized) { warn("Run `pnpm manasvi init` first"); return; }

  const provider = config.model.provider;
  info(`Testing ${provider}…`);

  if (provider === "ollama") {
    const ok = await checkOllama(config.model.ollamaBaseUrl);
    ok ? success("Ollama is reachable") : warn("Ollama is not reachable at " + config.model.ollamaBaseUrl);
  } else if (provider === "openai") {
    const env = await readEnvFile(envFilePath(config.projectPath));
    const key = env.OPENAI_API_KEY ?? "";
    if (!key) { warn("OPENAI_API_KEY not set"); return; }
    const ok = await checkOpenAI(config.model.openaiBaseUrl, key);
    ok ? success("OpenAI API key is valid") : warn("OpenAI API key validation failed");
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
      { value: "ollama", label: "Ollama (local)" },
      { value: "openai", label: "OpenAI (cloud)" },
      { value: "mock", label: "Mock (testing)" }
    ]);
  }

  const validProviders = ["ollama", "openai", "mock"];
  if (!validProviders.includes(provider)) {
    warn(`Unknown provider: ${provider}. Valid: ollama, openai, mock`);
    return;
  }

  config.model.provider = provider as ModelProvider;
  await saveConfig(config);

  const envPath = envFilePath(config.projectPath);
  await mergeEnvFile(envPath, { MODEL_ADAPTER_MODE: provider }, { force: ["MODEL_ADAPTER_MODE"] });

  success(`Active model provider: ${provider}`);
  hint("Restart services to apply: pnpm manasvi restart");
  console.log();
}
