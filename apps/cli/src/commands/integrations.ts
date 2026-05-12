import { banner, hint, info, section, success, table, warn } from "../lib/ui.js";
import { loadConfig, saveConfig } from "../lib/config.js";

interface IntegrationAccount {
  providerId: string;
  status: string;
  scopesGranted: string[];
  lastAuthAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

async function getGatewayPort(): Promise<number> {
  const cfg = await loadConfig();
  return cfg?.services.gatewayPort ?? 4100;
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

export async function runIntegrationsAdd(provider?: string): Promise<void> {
  banner("integrations add");
  if (provider !== "google") {
    warn("Currently supported provider in G1: google");
    return;
  }
  const port = await getGatewayPort();
  const scopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"];
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
