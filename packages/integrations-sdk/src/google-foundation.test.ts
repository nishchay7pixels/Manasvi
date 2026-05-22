import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleIntegrationConfigForMode,
  executeGoogleCapability,
  getGoogleCapability,
  getSupportedGoogleBackends,
  GogGoogleProvider,
  isGoogleCapability,
  listGoogleCapabilities,
  listGoogleCapabilitiesByService,
  NativeGoogleProvider,
  normalizeGoogleIntegrationConfig,
  requiresGoogleApproval,
  type GoogleIntegrationConfig
} from "./index.js";

test("Google capability registry lists all initial capabilities", () => {
  const ids = listGoogleCapabilities().map((capability) => capability.id);
  assert.equal(ids.length, 17);
  assert.ok(ids.includes("google.gmail.search"));
  assert.ok(ids.includes("google.calendar.delete"));
  assert.ok(ids.includes("google.sheets.update"));
  assert.ok(ids.includes("google.contacts.search"));
});

test("Google capability registry returns definitions by id and service", () => {
  assert.equal(getGoogleCapability("google.gmail.read")?.service, "gmail");
  assert.equal(listGoogleCapabilitiesByService("calendar").length, 4);
  assert.equal(isGoogleCapability("google.drive.read"), true);
  assert.equal(isGoogleCapability("google.unknown.raw"), false);
});

test("Google capability registry marks write actions approval-required", () => {
  assert.equal(requiresGoogleApproval("google.gmail.send"), true);
  assert.equal(requiresGoogleApproval("google.calendar.create"), true);
  assert.equal(requiresGoogleApproval("google.gmail.read"), false);
  assert.deepEqual(getSupportedGoogleBackends("google.gmail.search"), ["gog", "native"]);
});

const authServices = {
  gmail: { service: "gmail" as const, authorized: true },
  calendar: { service: "calendar" as const, authorized: true },
  drive: { service: "drive" as const, authorized: true },
  docs: { service: "docs" as const, authorized: true },
  sheets: { service: "sheets" as const, authorized: false },
  contacts: { service: "contacts" as const, authorized: true }
};

function connectedGogProvider(stdout = JSON.stringify({ messages: [] })): GogGoogleProvider {
  return new GogGoogleProvider({
    binaryCheck: async () => ({ ok: true, status: "found", binaryPath: "gog", version: "gog test", errors: [], warnings: [], nextSteps: [] }),
    authCheck: async () => ({ ok: true, account: "user@example.com", services: authServices, warnings: [], errors: [], nextSteps: [] }),
    runner: async (request) => ({
      ok: true,
      command: "gog",
      args: request.args,
      redactedArgs: request.args,
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: 3,
      timedOut: false,
      truncated: { stdout: false, stderr: false }
    })
  });
}

test("providers support matching capabilities and native reports not configured until OAuth exists", async () => {
  const gog = connectedGogProvider();
  const native = new NativeGoogleProvider();

  assert.equal(gog.supports("google.gmail.search"), true);
  assert.equal(native.supports("google.gmail.search"), true);
  assert.equal(gog.supports("google.not.real"), false);

  const gogResult = await gog.execute({ capabilityId: "google.gmail.search", input: { query: "in:inbox" } });
  assert.equal(gogResult.ok, true);
  assert.equal(gogResult.status, "completed");

  const nativeResult = await native.execute({ capabilityId: "google.gmail.search", input: {} });
  assert.equal(nativeResult.ok, false);
  assert.equal(nativeResult.status, "not_configured");
});

function configFor(serviceBackend: "gog" | "native", mode: "gog" | "native" | "mixed" = serviceBackend): GoogleIntegrationConfig {
  const config = createGoogleIntegrationConfigForMode(mode);
  return normalizeGoogleIntegrationConfig({
    ...config,
    enabled: true,
    services: {
      ...config.services,
      gmail: {
        enabled: true,
        backend: serviceBackend,
        read: true,
        write: false
      }
    }
  });
}

test("router rejects unknown capability", async () => {
  const result = await executeGoogleCapability(
    { capabilityId: "google.raw.shell", input: {} },
    { config: configFor("native"), providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.status, "not_supported");
  assert.ok(result.errors[0]?.includes("Unknown Google capability"));
});

test("router rejects disabled service", async () => {
  const config = createGoogleIntegrationConfigForMode("native");
  config.enabled = true;
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: {} },
    { config, providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.status, "blocked");
  assert.ok(result.errors[0]?.includes("gmail is disabled"));
});

test("router resolves native backend in native mode", async () => {
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: {} },
    { config: configFor("native"), providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.provider, "native");
  assert.equal(result.status, "not_configured");
});

test("router resolves gog backend in gog mode", async () => {
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: { query: "in:inbox" } },
    { config: configFor("gog"), providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.provider, "gog");
  assert.equal(result.status, "completed");
});

test("router resolves service backend in mixed mode", async () => {
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: { query: "in:inbox" } },
    { config: configFor("gog", "mixed"), providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.provider, "gog");
  assert.equal(result.status, "completed");
});

test("router rejects unsupported backend without fallback", async () => {
  const config = configFor("gog");
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.search", input: {} },
    {
      config,
      providers: {
        gog: new NativeGoogleProvider(),
        native: new NativeGoogleProvider()
      }
    }
  );
  assert.equal(result.provider, "gog");
  assert.equal(result.status, "not_supported");
  assert.ok(result.errors.some((error) => error.includes("no alternate provider was attempted")));
});

test("router blocks approval-required capability without approval", async () => {
  const config = configFor("native");
  config.services.gmail = { enabled: true, backend: "native", read: true, write: true };
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.send", input: {} },
    { config, providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.status, "blocked");
  assert.ok(result.errors[0]?.includes("requires approval"));
});

test("router reaches native provider for approved write but provider blocks without OAuth", async () => {
  const config = configFor("native");
  config.services.gmail = { enabled: true, backend: "native", read: true, write: true };
  const result = await executeGoogleCapability(
    { capabilityId: "google.gmail.send", input: {}, approval: { approved: true, approvalId: "approval:test" } },
    { config, providers: { gog: connectedGogProvider(), native: new NativeGoogleProvider() } }
  );
  assert.equal(result.provider, "native");
  assert.equal(result.status, "not_configured");
});
