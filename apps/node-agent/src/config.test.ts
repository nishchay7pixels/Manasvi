import assert from "node:assert/strict";
import test from "node:test";

import { nodeAgentConfigSchema } from "./config.js";

test("node agent config schema validates required distributed execution settings", () => {
  const parsed = nodeAgentConfigSchema.parse({
    serviceName: "node-agent",
    serviceVersion: "0.1.0",
    environment: "local",
    host: "127.0.0.1",
    port: 4110,
    logLevel: "info",
    humanReadableLogs: false,
    nodeId: "node:local-agent",
    nodeClass: "restricted_utility_node",
    nodeManagerBaseUrl: "http://localhost:4106",
    nodeDispatchIssuer: "manasvi.node-manager",
    nodeDispatchAudience: "manasvi.node-agent",
    nodeDispatchVerificationKeys: { "local-k1": "secret" },
    runtimeTokenKeyId: "local-k1",
    runtimeTokenSigningSecret: "secret",
    runtimeTokenVerificationKeys: { "local-k1": "secret" },
    sandboxRootDir: "/tmp/manasvi-node-agent-runs",
    sandboxMaxOutputBytes: 65536
  });
  assert.equal(parsed.nodeClass, "restricted_utility_node");
});
