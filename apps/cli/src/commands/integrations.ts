import { banner, hint, info, section, success, table, warn } from "../lib/ui.js";
import { defaultConfig, loadConfig, saveConfig } from "../lib/config.js";
import { jsonFail, jsonOk, printJson } from "../lib/json.js";
import {
  createGoogleIntegrationConfigForMode,
  defaultGoogleOAuthStateStorePath,
  defaultGoogleTokenStorePath,
  FileGoogleOAuthStateStore,
  defaultGoogleIntegrationConfig,
  generateGoogleOAuthState,
  GogGoogleProvider,
  GOOGLE_G2_READ_CAPABILITY_IDS,
  GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS,
  GOOGLE_SERVICE_LABELS,
  GOOGLE_SERVICES,
  googleOAuthConfigFromEnv,
  GoogleOAuthService,
  listDefaultNativeGoogleScopes,
  listScopesByService,
  LocalEncryptedGoogleTokenStore,
  listGoogleCapabilities,
  NativeGoogleProvider,
  normalizeGoogleIntegrationConfig,
  requiresGoogleApproval,
  redactGoogleTokenRecord,
  type GoogleIntegrationConfig,
  type GoogleIntegrationMode,
  type GoogleService
} from "@manasvi/integrations-sdk";

interface IntegrationAccount {
  providerId: string;
  status: string;
  scopesGranted: string[];
  lastAuthAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

export interface GoogleFoundationCliSnapshot {
  ok: true;
  integration: "google";
  status: "not_connected";
  enabled: boolean;
  mode: GoogleIntegrationMode;
  defaultBackend: "gog" | "native";
  account: string | null;
  backends: {
    gog: { status: string };
    native: { status: string };
  };
  services: Record<string, {
    enabled: boolean;
    backend: "gog" | "native";
    read: boolean;
    write: boolean;
  }>;
  security: {
    capabilityRegistryLoaded: boolean;
    providerInterfaceLoaded: boolean;
    routerEnabled: boolean;
    directAgentAccessDisabled: boolean;
    writeActionsRequireApproval: boolean;
  };
  capabilities: {
    total: number;
    approvalRequired: number;
    readSensitive: number;
  };
  nextSteps: string[];
}

async function getGatewayPort(): Promise<number> {
  const cfg = await loadConfig();
  return cfg?.services.gatewayPort ?? 4100;
}

function getCliGoogleConfig(input?: Partial<GoogleIntegrationConfig> | null): GoogleIntegrationConfig {
  return normalizeGoogleIntegrationConfig(input ?? defaultGoogleIntegrationConfig);
}

export function buildGoogleFoundationSnapshot(input?: Partial<GoogleIntegrationConfig> | null): GoogleFoundationCliSnapshot {
  const config = getCliGoogleConfig(input);
  const capabilities = listGoogleCapabilities();
  return {
    ok: true,
    integration: "google",
    status: "not_connected",
    enabled: config.enabled,
    mode: config.mode,
    defaultBackend: config.defaultBackend,
    account: config.account ?? null,
    backends: {
      gog: { status: "unknown" },
      native: { status: "unknown" }
    },
    services: Object.fromEntries(
      GOOGLE_SERVICES.map((service) => {
        const serviceConfig = config.services[service];
        return [
          service,
          {
            enabled: serviceConfig?.enabled ?? false,
            backend: serviceConfig?.backend ?? config.defaultBackend,
            read: serviceConfig?.read ?? false,
            write: serviceConfig?.write ?? false
          }
        ];
      })
    ),
    security: {
      capabilityRegistryLoaded: capabilities.length > 0,
      providerInterfaceLoaded: true,
      routerEnabled: true,
      directAgentAccessDisabled: true,
      writeActionsRequireApproval: listGoogleCapabilities()
        .filter((capability) => capability.effect === "external_write" || capability.effect === "destructive")
        .every((capability) => requiresGoogleApproval(capability.id))
    },
    capabilities: {
      total: capabilities.length,
      approvalRequired: capabilities.filter((capability) => capability.requiresApproval).length,
      readSensitive: capabilities.filter((capability) => capability.effect === "read_sensitive").length
    },
    nextSteps: [
      "Install and authenticate gog for read-only gog backend execution",
      "Connect native Google APIs with: pnpm manasvi connect google --mode native"
    ]
  };
}

export async function runIntegrationsGoogleStatus(opts: { json?: boolean } = {}): Promise<void> {
  const cfg = await loadConfig();
  const snapshot = buildGoogleFoundationSnapshot(cfg?.integrations.google);
  const googleConfig = getCliGoogleConfig(cfg?.integrations.google);
  const gog = new GogGoogleProvider({ config: googleConfig.backends?.gog });
  const native = new NativeGoogleProvider({ config: googleConfig.backends?.native });
  const [gogHealth, nativeHealth, nativeToken] = await Promise.all([gog.healthCheck(), native.healthCheck(), native.tokenStatus()]);
  snapshot.backends.gog.status = gogHealth.status;
  snapshot.backends.native.status = nativeHealth.status;

  if (opts.json) {
    printJson(jsonOk("integrations google status", {
      ...snapshot,
      backends: {
        gog: {
          status: gogHealth.status,
          account: gogHealth.account ?? null,
          services: gogHealth.services,
          warnings: gogHealth.warnings,
          errors: gogHealth.errors,
          nextSteps: gogHealth.nextSteps
        },
        native: {
          status: nativeHealth.status,
          account: nativeHealth.account ?? null,
          services: nativeHealth.services,
          token: nativeToken,
          warnings: nativeHealth.warnings,
          errors: nativeHealth.errors,
          nextSteps: nativeHealth.nextSteps
        }
      },
      supportedReadCapabilities: GOOGLE_G2_READ_CAPABILITY_IDS,
      blockedWriteCapabilities: GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS
    }, {
      warnings: gogHealth.warnings.map((message) => ({ code: "google.gog.warning", message })),
      nextSteps: gogHealth.nextSteps
    }));
    return;
  }

  banner("integrations google status");
  section("Google Workspace");
  table([
    { label: "Status", value: "not connected", status: "warn" },
    { label: "Enabled", value: snapshot.enabled ? "yes" : "no", status: snapshot.enabled ? "ok" : "dim" },
    { label: "Mode", value: snapshot.mode },
    { label: "Default backend", value: snapshot.defaultBackend },
    { label: "Account", value: snapshot.account ?? "not configured", status: "dim" }
  ]);

  section("gog Backend");
  table([
    { label: "Binary/Auth", value: gogHealth.status, status: gogHealth.ok ? "ok" : "warn" },
    { label: "Account", value: gogHealth.account ?? "not configured", status: gogHealth.account ? "ok" : "dim" }
  ]);
  if (gogHealth.errors.length > 0) {
    for (const error of gogHealth.errors) warn(error);
  }

  section("gog Services");
  table(GOOGLE_SERVICES.map((service) => {
    const serviceHealth = gogHealth.services[service];
    return {
      label: GOOGLE_SERVICE_LABELS[service],
      value: serviceHealth?.connected ? "authorized" : serviceHealth?.reason ? `missing (${serviceHealth.reason})` : "unknown",
      status: serviceHealth?.connected ? "ok" : "warn"
    };
  }));

  section("Backends");
  table([
    { label: "gog", value: gogHealth.status, status: gogHealth.ok ? "ok" : "warn" },
    { label: "native", value: nativeHealth.status, status: nativeHealth.ok ? "ok" : "warn" }
  ]);

  section("Native OAuth");
  table([
    { label: "Client configured", value: nativeHealth.status === "not_configured" ? "no" : "yes", status: nativeHealth.status === "not_configured" ? "warn" : "ok" },
    { label: "Token stored safely", value: nativeToken ? "yes" : "no", status: nativeToken ? "ok" : "warn" },
    { label: "Refresh token available", value: nativeToken?.hasRefreshToken ? "yes" : "no", status: nativeToken?.hasRefreshToken ? "ok" : "warn" },
    { label: "Access token expiry", value: nativeToken?.expiryDate ?? "not configured", status: nativeToken?.expiryDate ? "ok" : "dim" }
  ]);

  section("Native Scopes");
  for (const service of ["gmail", "calendar"] as GoogleService[]) {
    const serviceHealth = nativeHealth.services[service];
    hint(`${GOOGLE_SERVICE_LABELS[service]} granted: ${serviceHealth?.grantedScopes?.length ? serviceHealth.grantedScopes.join(", ") : "none"}`);
    hint(`${GOOGLE_SERVICE_LABELS[service]} missing: ${serviceHealth?.missingScopes?.length ? serviceHealth.missingScopes.join(", ") : "none"}`);
  }

  section("Services");
  table(GOOGLE_SERVICES.map((service) => {
    const state = snapshot.services[service]!;
    return {
      label: GOOGLE_SERVICE_LABELS[service],
      value: `${state.backend}   ${state.enabled ? "enabled" : "disabled"}`,
      status: state.enabled ? "ok" : "dim"
    };
  }));

  section("Security");
  table([
    { label: "Capability registry loaded", value: snapshot.security.capabilityRegistryLoaded ? "yes" : "no", status: snapshot.security.capabilityRegistryLoaded ? "ok" : "error" },
    { label: "Provider interface loaded", value: snapshot.security.providerInterfaceLoaded ? "yes" : "no", status: snapshot.security.providerInterfaceLoaded ? "ok" : "error" },
    { label: "Capability router enabled", value: snapshot.security.routerEnabled ? "yes" : "no", status: snapshot.security.routerEnabled ? "ok" : "error" },
    { label: "Direct agent access disabled", value: snapshot.security.directAgentAccessDisabled ? "yes" : "no", status: snapshot.security.directAgentAccessDisabled ? "ok" : "error" },
    { label: "Safe process execution", value: "yes", status: "ok" },
    { label: "No shell interpolation", value: "yes", status: "ok" },
    { label: "Raw Google API access disabled", value: "yes", status: "ok" },
    { label: "Tokens redacted", value: "yes", status: "ok" },
    { label: "Write actions require approval", value: snapshot.security.writeActionsRequireApproval ? "yes" : "no", status: snapshot.security.writeActionsRequireApproval ? "ok" : "error" }
  ]);

  section("Capabilities");
  hint(`Available through gog: ${GOOGLE_G2_READ_CAPABILITY_IDS.join(", ")}`);
  hint(`Blocked until approval support: ${GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS.join(", ")}`);

  section("Next steps");
  for (const step of gogHealth.nextSteps.length > 0 ? gogHealth.nextSteps : snapshot.nextSteps) hint(step);
}

export async function runIntegrationsGoogleCheck(opts: { json?: boolean; backend?: string } = {}): Promise<void> {
  const cfg = await loadConfig();
  const snapshot = buildGoogleFoundationSnapshot(cfg?.integrations.google);
  const googleConfig = getCliGoogleConfig(cfg?.integrations.google);
  const gog = new GogGoogleProvider({ config: googleConfig.backends?.gog });
  const native = new NativeGoogleProvider({ config: googleConfig.backends?.native });
  const [gogHealth, nativeHealth] = await Promise.all([gog.healthCheck(), native.healthCheck()]);
  const selectedBackend = opts.backend ?? "all";
  const data = {
    ...snapshot,
    selectedBackend,
    checks: {
      gogProvider: gogHealth.status,
      nativeProvider: nativeHealth.status,
      realExecutionAvailable: gogHealth.ok,
      realOAuthAvailableInRouter: nativeHealth.ok
    }
  };

  if (opts.json) {
    printJson(jsonOk("integrations google check", data, { warnings: [
      ...(nativeHealth.ok ? [] : [{ code: "google.native.not_connected", message: "Native Google OAuth is not configured or not connected." }]),
      ...(gogHealth.ok ? [] : [{ code: "google.gog.not_connected", message: "gog is missing or not authenticated." }])
    ], nextSteps: snapshot.nextSteps }));
    return;
  }

  banner("integrations google check");
  section("Foundation checks");
  table([
    { label: "Capability registry", value: snapshot.security.capabilityRegistryLoaded ? "loaded" : "missing", status: snapshot.security.capabilityRegistryLoaded ? "ok" : "error" },
    { label: "Router", value: snapshot.security.routerEnabled ? "enabled" : "disabled", status: snapshot.security.routerEnabled ? "ok" : "error" },
    { label: "Selected backend", value: selectedBackend },
    { label: "gog provider", value: gogHealth.status, status: gogHealth.ok ? "ok" : "warn" },
    { label: "native provider", value: nativeHealth.status, status: nativeHealth.ok ? "ok" : "warn" },
    { label: "Read-only gog execution", value: gogHealth.ok ? "available" : "not connected", status: gogHealth.ok ? "ok" : "warn" },
    { label: "Native Gmail/Calendar execution", value: nativeHealth.ok ? "available" : "not connected", status: nativeHealth.ok ? "ok" : "warn" },
    { label: "Approval-required writes", value: snapshot.security.writeActionsRequireApproval ? "enforced" : "not enforced", status: snapshot.security.writeActionsRequireApproval ? "ok" : "error" },
    { label: "Silent fallback", value: "disabled", status: "ok" }
  ]);
  hint("No Gmail or Calendar data request was executed. Checks inspect gog status and local native OAuth/token metadata only.");
}

function isGoogleIntegrationMode(value: string): value is GoogleIntegrationMode {
  return value === "gog" || value === "native" || value === "mixed";
}

function isGoogleService(value: string): value is GoogleService {
  return (GOOGLE_SERVICES as readonly string[]).includes(value);
}

export async function runIntegrationsGoogleModeSelect(
  mode: GoogleIntegrationMode,
  opts: { json?: boolean } = {}
): Promise<void> {
  if (!isGoogleIntegrationMode(mode)) {
    warn(`Unsupported Google integration mode: ${mode}`);
    hint("Valid modes: gog, native, mixed");
    return;
  }

  const existing = await loadConfig();
  const cfg = existing ?? defaultConfig(process.cwd());
  const previous = normalizeGoogleIntegrationConfig(cfg.integrations.google);
  const nextFoundation = createGoogleIntegrationConfigForMode(mode);
  const mergedGoogle = {
    ...previous,
    ...nextFoundation,
    scopes: cfg.integrations.google?.scopes ?? []
  };
  cfg.integrations.google = mergedGoogle;
  await saveConfig(cfg);

  const data = {
    integration: "google",
    mode,
    enabled: true,
    defaultBackend: nextFoundation.defaultBackend,
    updated: {
      "integrations.google.enabled": true,
      "integrations.google.mode": mode,
      "integrations.google.defaultBackend": nextFoundation.defaultBackend
    },
    realExecutionAvailable: mode === "gog",
    next: "pnpm manasvi integrations google status"
  };

  if (opts.json) {
    printJson(jsonOk("connect google", data, {
      warnings: [{ code: "google.g3.mode_selected", message: "Mode selection does not grant scopes or delete existing backend credentials." }],
      nextSteps: [data.next]
    }));
    return;
  }

  banner("connect google");
  if (mode === "mixed") {
    info("Mixed mode selected.");
    console.log();
    section("Default backend");
    hint(nextFoundation.defaultBackend);
    section("Service backend overrides");
    table(GOOGLE_SERVICES.map((service) => ({
      label: GOOGLE_SERVICE_LABELS[service],
      value: nextFoundation.services[service]?.backend ?? nextFoundation.defaultBackend
    })));
  } else {
    info(`Google integration mode selected: ${mode}`);
  }

  console.log();
  info("This configures the Google integration backend mode.");
  hint(mode === "gog"
    ? "Read-only gog execution is available through the capability router after gog is installed and authenticated."
    : mode === "native"
      ? "Native Gmail and Calendar execution is available after OAuth is configured and completed."
      : "Mixed mode lets each Google service choose gog or native without silent fallback.");

  section("Updated");
  table([
    { label: "integrations.google.enabled", value: "true", status: "ok" },
    { label: "integrations.google.mode", value: mode },
    { label: "integrations.google.defaultBackend", value: nextFoundation.defaultBackend }
  ]);

  section("Next");
  hint(mode === "native" ? "pnpm manasvi integrations google oauth start" : "pnpm manasvi integrations google status");
}

export async function runIntegrationsGoogleSwitchMode(
  mode: string | undefined,
  opts: { json?: boolean; yes?: boolean } = {}
): Promise<void> {
  if (!mode || !isGoogleIntegrationMode(mode)) {
    warn(`Unsupported Google integration mode: ${mode ?? "(missing)"}`);
    hint("Valid modes: gog, native, mixed");
    return;
  }
  const existing = await loadConfig();
  const cfg = existing ?? defaultConfig(process.cwd());
  const previous = normalizeGoogleIntegrationConfig(cfg.integrations.google);
  const defaultBackend = mode === "gog" ? "gog" : "native";
  const services = Object.fromEntries(GOOGLE_SERVICES.map((service) => [
    service,
    {
      ...(previous.services[service] ?? { enabled: false, read: false, write: false }),
      backend: mode === "mixed" ? previous.services[service]?.backend ?? previous.defaultBackend : defaultBackend
    }
  ])) as GoogleIntegrationConfig["services"];
  const next = normalizeGoogleIntegrationConfig({
    ...previous,
    enabled: true,
    mode,
    defaultBackend,
    services
  });
  cfg.integrations.google = { ...next, scopes: cfg.integrations.google?.scopes ?? [] };
  await saveConfig(cfg);
  const data = { previous: { mode: previous.mode, defaultBackend: previous.defaultBackend }, current: { mode: next.mode, defaultBackend: next.defaultBackend, services: next.services } };
  if (opts.json) {
    printJson(jsonOk("integrations google switch-mode", data, { nextSteps: ["pnpm manasvi integrations google status"] }));
    return;
  }
  banner("integrations google switch-mode");
  section("Previous");
  table([
    { label: "mode", value: previous.mode },
    { label: "default backend", value: previous.defaultBackend }
  ]);
  section("Current");
  table([
    { label: "mode", value: next.mode },
    { label: "default backend", value: next.defaultBackend }
  ]);
  section("Services");
  table(GOOGLE_SERVICES.map((service) => ({ label: GOOGLE_SERVICE_LABELS[service], value: next.services[service]?.backend ?? next.defaultBackend })));
  section("Next");
  hint("pnpm manasvi integrations google status");
}

export async function runIntegrationsGoogleSetBackend(
  service: string | undefined,
  backend: string | undefined,
  opts: { json?: boolean } = {}
): Promise<void> {
  if (!service || !isGoogleService(service) || (backend !== "gog" && backend !== "native")) {
    warn("Usage: pnpm manasvi integrations google set-backend <gmail|calendar|drive|docs|sheets|contacts> <gog|native>");
    return;
  }
  const existing = await loadConfig();
  const cfg = existing ?? defaultConfig(process.cwd());
  const previous = normalizeGoogleIntegrationConfig(cfg.integrations.google);
  const next = normalizeGoogleIntegrationConfig({
    ...previous,
    enabled: true,
    mode: previous.mode === "mixed" ? "mixed" : previous.mode,
    services: {
      ...previous.services,
      [service]: {
        ...(previous.services[service] ?? { enabled: false, read: false, write: false }),
        backend
      }
    }
  });
  cfg.integrations.google = { ...next, scopes: cfg.integrations.google?.scopes ?? [] };
  await saveConfig(cfg);
  const data = { service, backend, mode: next.mode, services: next.services };
  if (opts.json) {
    printJson(jsonOk("integrations google set-backend", data, { nextSteps: ["pnpm manasvi integrations google status"] }));
    return;
  }
  banner("integrations google set-backend");
  success(`${GOOGLE_SERVICE_LABELS[service]} backend set to ${backend}`);
  hint("Backend fallback remains disabled; unsupported capabilities will block instead of switching providers.");
}

export async function runIntegrationsGoogleOAuthStart(opts: { json?: boolean; accountHint?: string } = {}): Promise<void> {
  const config = googleOAuthConfigFromEnv();
  if (!config) {
    if (opts.json) {
      printJson(jsonFail("integrations google oauth start", [{
        code: "google.native.oauth_not_configured",
        message: "Google OAuth client is not configured.",
        fix: "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
      }]));
      return;
    }
    warn("Google OAuth client is not configured.");
    hint("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
    return;
  }
  const requestedScopes = listDefaultNativeGoogleScopes();
  const tokenStore = new LocalEncryptedGoogleTokenStore();
  const service = new GoogleOAuthService(config, new FileGoogleOAuthStateStore(defaultGoogleOAuthStateStorePath()), tokenStore);
  const started = await service.start({
    state: generateGoogleOAuthState(),
    requestedScopes,
    ...(opts.accountHint ? { accountHint: opts.accountHint } : {})
  });
  if (opts.json) {
    printJson(jsonOk("integrations google oauth start", started));
    return;
  }
  banner("Google Native API Setup");
  section("Requested scopes");
  for (const scope of requestedScopes) hint(scope);
  section("Open this URL");
  console.log(started.authorizationUrl);
  section("Complete");
  hint("pnpm manasvi integrations google oauth complete --code <code> --state <state>");
  hint(`State expires at: ${started.expiresAt ?? "unknown"}`);
}

export async function runIntegrationsGoogleOAuthComplete(opts: { json?: boolean; code?: string; state?: string } = {}): Promise<void> {
  if (!opts.code || !opts.state) {
    if (opts.json) {
      printJson(jsonFail("integrations google oauth complete", [{
        code: "google.native.oauth_missing_code_or_state",
        message: "OAuth completion requires --code and --state.",
        fix: "pnpm manasvi integrations google oauth complete --code <code> --state <state>"
      }]));
      return;
    }
    warn("OAuth completion requires --code and --state.");
    hint("pnpm manasvi integrations google oauth complete --code <code> --state <state>");
    return;
  }
  const config = googleOAuthConfigFromEnv();
  if (!config) {
    if (opts.json) {
      printJson(jsonFail("integrations google oauth complete", [{
        code: "google.native.oauth_not_configured",
        message: "Google OAuth client is not configured.",
        fix: "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
      }]));
      return;
    }
    warn("Google OAuth client is not configured.");
    hint("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
    return;
  }
  const service = new GoogleOAuthService(
    config,
    new FileGoogleOAuthStateStore(defaultGoogleOAuthStateStorePath()),
    new LocalEncryptedGoogleTokenStore()
  );
  const result = await service.complete({ code: opts.code, state: opts.state });
  if (opts.json) {
    printJson(jsonOk("integrations google oauth complete", result));
    return;
  }
  banner("integrations google oauth complete");
  success("Google native OAuth completed.");
  table([
    { label: "Account", value: result.account ?? "not reported by token", status: result.account ? "ok" : "dim" },
    { label: "Granted scopes", value: result.grantedScopes.join(", ") }
  ]);
}

export async function runIntegrationsGoogleOAuthStatus(opts: { json?: boolean } = {}): Promise<void> {
  const token = await new LocalEncryptedGoogleTokenStore().getDefault();
  const safe = token ? redactGoogleTokenRecord(token) : null;
  if (opts.json) {
    printJson(jsonOk("integrations google oauth status", { token: safe, tokenStorePath: defaultGoogleTokenStorePath() }));
    return;
  }
  banner("integrations google oauth status");
  table([
    { label: "Token store", value: defaultGoogleTokenStorePath() },
    { label: "Token stored safely", value: safe ? "yes" : "no", status: safe ? "ok" : "warn" },
    { label: "Account", value: safe?.account ?? "not configured", status: safe?.account ? "ok" : "dim" },
    { label: "Refresh token", value: safe?.hasRefreshToken ? "available" : "missing", status: safe?.hasRefreshToken ? "ok" : "warn" },
    { label: "Expiry", value: safe?.expiryDate ?? "unknown", status: safe?.expiryDate ? "ok" : "dim" }
  ]);
}

export async function runIntegrationsList(): Promise<void> {
  banner("integrations list");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/accounts`);
    if (!res.ok) {
      warn("API gateway did not return integration accounts");
      return;
    }
    const body = (await res.json()) as { accounts: IntegrationAccount[] };
    section("Integration accounts");
    if (body.accounts.length === 0) {
      info("No connected integrations yet.");
      hint("Connect Google: pnpm manasvi integrations add google");
      return;
    }
    for (const account of body.accounts) {
      console.log(`- ${account.providerId}: ${account.status}`);
      console.log(`  scopes: ${account.scopesGranted.join(", ") || "-"}`);
      console.log(`  last auth: ${account.lastAuthAt ?? "-"}`);
      console.log(`  last refresh: ${account.lastRefreshAt ?? "-"}`);
      console.log(`  error: ${account.lastError ?? "-"}`);
    }
  } catch {
    warn("Failed to connect to API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsStatus(): Promise<void> {
  banner("integrations status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration status");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        status: string;
        normalizedScopes: string[];
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    section("Google");
    if (!body.authorization.connected) {
      info("Status: not_connected");
      hint("Connect Google: pnpm manasvi integrations add google");
      return;
    }
    const auth = body.authorization;
    table([
      { label: "status", value: auth.status },
      { label: "normalized scopes", value: auth.normalizedScopes.join(", ") || "-" },
      { label: "capabilities", value: auth.availableCapabilities.map((item) => item.capabilityId).join(", ") || "-" }
    ]);
    console.log();
    section("Action authorization snapshot");
    for (const action of auth.actions) {
      console.log(
        `- ${action.actionId}: canAttempt=${action.canAttempt ? "yes" : "no"}, approval=${action.approvalSensitivity}, missing=${action.missingCapabilities.join(", ") || "-"}`
      );
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCheck(actionId?: string): Promise<void> {
  banner("integrations check");
  if (!actionId) {
    warn("Usage: pnpm manasvi integrations check <google-action-id>");
    return;
  }
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/permissions/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId })
    });
    const body = (await res.json()) as {
      permission?: {
        decision: string;
        reasonCodes: string[];
        action: { actionId: string; serviceFamily: string; class: string; approvalSensitivity: string };
        requiredCapabilities: string[];
        availableCapabilities: string[];
        missingCapabilities: string[];
      };
      error?: string;
    };
    if (!res.ok || !body.permission) {
      warn(body.error ?? "Permission check failed");
      return;
    }
    const permission = body.permission;
    section(`Google action: ${permission.action.actionId}`);
    table([
      { label: "decision", value: permission.decision },
      { label: "service family", value: permission.action.serviceFamily },
      { label: "class", value: permission.action.class },
      { label: "approval sensitivity", value: permission.action.approvalSensitivity },
      { label: "required capabilities", value: permission.requiredCapabilities.join(", ") || "-" },
      { label: "available capabilities", value: permission.availableCapabilities.join(", ") || "-" },
      { label: "missing capabilities", value: permission.missingCapabilities.join(", ") || "-" },
      { label: "reason codes", value: permission.reasonCodes.join(", ") || "-" }
    ]);
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsGmailHealth(): Promise<void> {
  banner("integrations gmail health");
  const port = await getGatewayPort();
  const res = await fetch(`http://127.0.0.1:${port}/integrations/google/gmail/health`);
  if (!res.ok) {
    warn("Failed to fetch Gmail health");
    return;
  }
  const body = (await res.json()) as {
    health: {
      status: string;
      connected: boolean;
      gmailReadAuthorized: boolean;
      availableCapabilities: string[];
      missingCapabilities: string[];
      tokenPresent: boolean;
      lastSuccessfulReadAt: string | null;
      lastError: string | null;
    };
  };
  const h = body.health;
  table([
    { label: "status", value: h.status },
    { label: "connected", value: h.connected ? "yes" : "no" },
    { label: "gmail read authorized", value: h.gmailReadAuthorized ? "yes" : "no" },
    { label: "token present", value: h.tokenPresent ? "yes" : "no" },
    { label: "available capabilities", value: h.availableCapabilities.join(", ") || "-" },
    { label: "missing capabilities", value: h.missingCapabilities.join(", ") || "-" },
    { label: "last successful read", value: h.lastSuccessfulReadAt ?? "-" },
    { label: "last error", value: h.lastError ?? "-" }
  ]);
}

export async function runIntegrationsGmailAttention(): Promise<void> {
  banner("integrations gmail attention");
  const port = await getGatewayPort();
  const res = await fetch(`http://127.0.0.1:${port}/integrations/google/gmail/attention`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maxResults: 10 })
  });
  if (!res.ok) {
    warn("Failed to fetch Gmail attention summary");
    return;
  }
  const body = (await res.json()) as {
    summary: { total: number; unreadCount: number; importantCount: number };
    items: Array<{ subject: string; from: string; unread: boolean; important: boolean; snippet: string }>;
  };
  table([
    { label: "total", value: String(body.summary.total) },
    { label: "unread", value: String(body.summary.unreadCount) },
    { label: "important", value: String(body.summary.importantCount) }
  ]);
  console.log();
  for (const item of body.items) {
    console.log(`- ${item.subject || "(no subject)"} | from=${item.from || "-"} | unread=${item.unread ? "yes" : "no"} | important=${item.important ? "yes" : "no"}`);
    console.log(`  ${item.snippet}`);
  }
}

export async function runIntegrationsCalendarHealth(): Promise<void> {
  banner("integrations calendar health");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/health`);
    if (!res.ok) {
      warn("Failed to fetch Calendar health");
      return;
    }
    const body = (await res.json()) as {
      health: {
        status: string;
        connected: boolean;
        calendarReadAuthorized: boolean;
        availableCapabilities: string[];
        missingCapabilities: string[];
        tokenPresent: boolean;
        lastSuccessfulReadAt: string | null;
        lastError: string | null;
      };
    };
    const h = body.health;
    table([
      { label: "status", value: h.status },
      { label: "connected", value: h.connected ? "yes" : "no" },
      { label: "calendar read authorized", value: h.calendarReadAuthorized ? "yes" : "no" },
      { label: "token present", value: h.tokenPresent ? "yes" : "no" },
      { label: "available capabilities", value: h.availableCapabilities.join(", ") || "-" },
      { label: "missing capabilities", value: h.missingCapabilities.join(", ") || "-" },
      { label: "last successful read", value: h.lastSuccessfulReadAt ?? "-" },
      { label: "last error", value: h.lastError ?? "-" }
    ]);
    if (!h.calendarReadAuthorized) {
      hint("To enable Calendar read, reconnect Google with the calendar.readonly scope:");
      hint("  pnpm manasvi integrations add google calendar");
    }
  } catch {
    warn("Failed to reach API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsCalendarToday(timezone?: string): Promise<void> {
  banner("integrations calendar today");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/events/today`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(timezone ? { timezone } : {}) })
    });
    if (!res.ok) {
      warn("Failed to fetch today's calendar events");
      return;
    }
    const body = (await res.json()) as {
      result: {
        events: Array<{
          title: string;
          startIso: string;
          endIso: string;
          allDay: boolean;
          location: string | null;
          hasAttendees: boolean;
          attendeeCount: number;
          hasMeetingLink: boolean;
        }>;
        timeZone: string | null;
        calendarId: string;
      };
    };
    const r = body.result;
    section(`Today's calendar (${r.calendarId}) — ${r.timeZone ?? "UTC"}`);
    if (r.events.length === 0) {
      info("No events scheduled today.");
      return;
    }
    for (const ev of r.events) {
      const time = ev.allDay
        ? "all-day"
        : `${new Date(ev.startIso).toLocaleTimeString()} – ${new Date(ev.endIso).toLocaleTimeString()}`;
      console.log(`- ${ev.title} | ${time}`);
      if (ev.location) console.log(`  location: ${ev.location}`);
      if (ev.hasAttendees) console.log(`  attendees: ${ev.attendeeCount}`);
      if (ev.hasMeetingLink) console.log(`  [meeting link available]`);
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCalendarUpcoming(maxResults?: string): Promise<void> {
  banner("integrations calendar upcoming");
  const port = await getGatewayPort();
  const n = Math.min(20, Math.max(1, parseInt(maxResults ?? "10", 10) || 10));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/calendar/events/upcoming`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxResults: n })
    });
    if (!res.ok) {
      warn("Failed to fetch upcoming calendar events");
      return;
    }
    const body = (await res.json()) as {
      result: {
        events: Array<{
          title: string;
          startIso: string;
          endIso: string;
          allDay: boolean;
          location: string | null;
          hasAttendees: boolean;
          attendeeCount: number;
          hasMeetingLink: boolean;
          isRecurring: boolean;
        }>;
        totalCount: number;
        hasMore: boolean;
        timezone: string | null;
      };
    };
    const r = body.result;
    section(`Upcoming events (next ${n})`);
    if (r.events.length === 0) {
      info("No upcoming events found.");
      return;
    }
    for (const ev of r.events) {
      const start = ev.allDay ? ev.startIso.slice(0, 10) : new Date(ev.startIso).toLocaleString();
      console.log(`- ${ev.title}`);
      console.log(`  when: ${start}${ev.isRecurring ? " (recurring)" : ""}`);
      if (ev.location) console.log(`  location: ${ev.location}`);
      if (ev.hasAttendees) console.log(`  attendees: ${ev.attendeeCount}`);
      if (ev.hasMeetingLink) console.log(`  [meeting link]`);
    }
    if (r.hasMore) hint(`Showing ${r.totalCount} of more events. Use maxResults to fetch more.`);
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsAdd(provider?: string, mode?: string): Promise<void> {
  banner("integrations add");
  if (provider !== "google") {
    warn("Currently supported provider: google");
    return;
  }
  const port = await getGatewayPort();

  // mode: "read-only" | "write" (G4) | "calendar" (G5) | "calendar-write" (G6) | "full" (all)
  const isWrite = mode === "write" || mode === "full";
  const isCalendar = mode === "calendar" || mode === "full";
  const isCalendarWrite = mode === "calendar-write" || mode === "full";

  const baseScopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"];
  const writeScopes = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify"
  ];
  const calendarReadScopes = ["https://www.googleapis.com/auth/calendar.readonly"];
  const calendarWriteScopes = ["https://www.googleapis.com/auth/calendar"];

  const scopes = [
    ...baseScopes,
    ...(isWrite ? writeScopes : []),
    // calendar write scope supersedes read-only scope
    ...(isCalendarWrite ? calendarWriteScopes : isCalendar ? calendarReadScopes : [])
  ];

  if (isWrite) {
    info("Requesting Gmail write scopes (compose, send, modify).");
    hint("This allows Manasvi to draft, send, archive, and label Gmail messages.");
    hint("Send actions always require explicit approval before execution.");
  }
  if (isCalendarWrite) {
    info("Requesting Calendar write scope (calendar — full access).");
    hint("This allows Manasvi to create, update, and delete calendar events.");
    hint("Attendee-facing actions and event deletions always require explicit approval before execution.");
  } else if (isCalendar) {
    info("Requesting Calendar read scope (calendar.readonly).");
    hint("This allows Manasvi to read calendar events, check availability, and summarize meetings.");
    hint("Calendar read is a safe read-only scope — no events will be created or modified.");
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/connect/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopes })
    });
    if (!res.ok) {
      warn("Failed to start Google OAuth flow");
      return;
    }
    const body = (await res.json()) as { authorizeUrl: string };
    info("Open this URL to connect Google:");
    console.log(body.authorizeUrl);
    hint("After approval, Google redirects to the configured callback URI and Manasvi finalizes the connection.");

    const cfg = await loadConfig();
    if (cfg) {
      cfg.integrations.google = { enabled: true, scopes };
      await saveConfig(cfg);
    }
  } catch {
    warn("Failed to reach API gateway. Start services first: pnpm manasvi start");
  }
}

export async function runIntegrationsGmailWriteStatus(): Promise<void> {
  banner("integrations gmail write status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration authorization");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    if (!body.authorization.connected) {
      info("Google not connected.");
      hint("Connect with write scopes: pnpm manasvi integrations add google write");
      return;
    }
    const auth = body.authorization;
    const writeActions = auth.actions.filter((action) =>
      ["gmail.draft.create", "gmail.draft.reply", "gmail.message.send", "gmail.message.archive", "gmail.message.label"].includes(action.actionId)
    );
    section("Gmail Write Capability Status");
    for (const action of writeActions) {
      const status = action.canAttempt ? "AVAILABLE" : "MISSING SCOPE";
      const approval = action.approvalSensitivity === "required" ? " [APPROVAL REQUIRED]" : action.approvalSensitivity === "policy" ? " [APPROVAL MAY BE REQUIRED]" : "";
      console.log(`  ${action.actionId}: ${status}${approval}`);
      if (!action.canAttempt && action.missingCapabilities.length > 0) {
        console.log(`    missing: ${action.missingCapabilities.join(", ")}`);
      }
    }
    console.log();
    const hasCompose = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.compose");
    const hasSend = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.send");
    const hasModify = auth.availableCapabilities.some((c) => c.capabilityId === "gmail.modify");
    if (!hasCompose || !hasSend || !hasModify) {
      hint("To enable full Gmail write access, reconnect with write scopes:");
      hint("  pnpm manasvi integrations add google write");
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsCalendarWriteStatus(): Promise<void> {
  banner("integrations calendar write status");
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/authorization`);
    if (!res.ok) {
      warn("Could not fetch Google integration authorization");
      return;
    }
    const body = (await res.json()) as {
      authorization: {
        connected: boolean;
        availableCapabilities: Array<{ capabilityId: string; class: string; approvalSensitivity: string }>;
        actions: Array<{ actionId: string; canAttempt: boolean; approvalSensitivity: string; missingCapabilities: string[] }>;
      };
    };
    if (!body.authorization.connected) {
      info("Google not connected.");
      hint("Connect with calendar write scope: pnpm manasvi integrations add google calendar-write");
      return;
    }
    const auth = body.authorization;
    const writeActionIds = [
      "calendar.event.create",
      "calendar.event.create_with_attendees",
      "calendar.event.update",
      "calendar.event.update_attendees",
      "calendar.event.delete"
    ];
    const writeActions = auth.actions.filter((action) => writeActionIds.includes(action.actionId));
    section("Calendar Write Capability Status");
    for (const action of writeActions) {
      const status = action.canAttempt ? "AVAILABLE" : "MISSING SCOPE";
      const approval = action.approvalSensitivity === "required" ? " [APPROVAL REQUIRED]" : action.approvalSensitivity === "policy" ? " [APPROVAL MAY BE REQUIRED]" : "";
      console.log(`  ${action.actionId}: ${status}${approval}`);
      if (!action.canAttempt && action.missingCapabilities.length > 0) {
        console.log(`    missing: ${action.missingCapabilities.join(", ")}`);
      }
    }
    console.log();
    const hasCreate = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.create_event");
    const hasUpdate = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.update_event");
    const hasInvite = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.invite_attendees");
    const hasDelete = auth.availableCapabilities.some((c) => c.capabilityId === "calendar.delete_event");
    if (!hasCreate || !hasUpdate || !hasInvite || !hasDelete) {
      hint("To enable full Calendar write access, reconnect with the calendar write scope:");
      hint("  pnpm manasvi integrations add google calendar-write");
    }
  } catch {
    warn("Failed to reach API gateway.");
  }
}

export async function runIntegrationsRemove(provider?: string): Promise<void> {
  banner("integrations remove");
  if (provider !== "google") {
    warn("Currently supported provider in G1: google");
    return;
  }
  const port = await getGatewayPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/integrations/google/disconnect`, { method: "POST" });
    if (!res.ok) {
      warn("Failed to disconnect Google integration");
      return;
    }
    success("Google integration disconnected");
  } catch {
    warn("Failed to reach API gateway.");
  }
}
