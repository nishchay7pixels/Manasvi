import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildGoogleFoundationSnapshot } from "../commands/integrations.js";
import { findCommand } from "../lib/registry.js";

describe("Google foundation CLI snapshot", () => {
  test("status data includes mode, backend, and disabled services", () => {
    const snapshot = buildGoogleFoundationSnapshot();
    assert.equal(snapshot.integration, "google");
    assert.equal(snapshot.mode, "native");
    assert.equal(snapshot.defaultBackend, "native");
    assert.equal(snapshot.services.gmail?.enabled, false);
    assert.equal(snapshot.services.gmail?.backend, "native");
  });

  test("does not claim real connection or execution", () => {
    const snapshot = buildGoogleFoundationSnapshot({ enabled: true, mode: "gog", defaultBackend: "gog" });
    assert.equal(snapshot.status, "not_connected");
    assert.equal(snapshot.backends.gog.status, "unknown");
    assert.equal(snapshot.backends.native.status, "unknown");
  });

  test("security flags expose router and approval boundaries", () => {
    const snapshot = buildGoogleFoundationSnapshot();
    assert.equal(snapshot.security.capabilityRegistryLoaded, true);
    assert.equal(snapshot.security.routerEnabled, true);
    assert.equal(snapshot.security.directAgentAccessDisabled, true);
    assert.equal(snapshot.security.writeActionsRequireApproval, true);
  });
});

describe("Google foundation command registry", () => {
  test("integrations command documents google status/check", () => {
    const integrations = findCommand("integrations");
    assert.ok(integrations?.subcommands?.some((subcommand) => subcommand.name === "google"));
    assert.ok(integrations?.examples.some((example) => example.includes("switch-mode native")));
    assert.ok(integrations?.examples.some((example) => example.includes("oauth start")));
  });

  test("connect command documents --mode", () => {
    const connect = findCommand("connect");
    assert.ok(connect?.flags?.some((flag) => flag.flag === "--mode"));
  });
});
