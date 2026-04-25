import assert from "node:assert/strict";
import test from "node:test";

import { allowPluginRawSecretExposure, pluginSecretEnvName } from "./plugin-secrets.js";

test("plugin raw secret exposure is denied by default", () => {
  assert.equal(
    allowPluginRawSecretExposure({
      runtimeFlagEnabled: false,
      requestFlagEnabled: true
    }),
    false
  );
  assert.equal(
    allowPluginRawSecretExposure({
      runtimeFlagEnabled: true,
      requestFlagEnabled: false
    }),
    false
  );
});

test("plugin raw secret exposure requires explicit runtime + request enablement", () => {
  assert.equal(
    allowPluginRawSecretExposure({
      runtimeFlagEnabled: true,
      requestFlagEnabled: true
    }),
    true
  );
});

test("plugin secret env names are deterministic and sanitized", () => {
  assert.equal(
    pluginSecretEnvName("secret://tenant/local/plugin/api-token"),
    "MANASVI_PLUGIN_SECRET_SECRET___TENANT_LOCAL_PLUGIN_API_TOKEN"
  );
});
