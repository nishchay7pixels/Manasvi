import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryToolRegistry } from "./index.js";

test("registry preloads built-in tools", () => {
  const registry = new InMemoryToolRegistry();
  assert.equal(registry.count() >= 6, true);
  const localFileRead = registry.resolve("tool.local-file-read");
  assert.ok(localFileRead);
  assert.equal(localFileRead?.manifest.actionClass, "read");
});

test("registry enforces lifecycle state and explorer metadata", () => {
  const registry = new InMemoryToolRegistry();
  const tool = registry.resolve("tool.shell-command");
  assert.ok(tool);
  const disabled = registry.setStatus({
    toolId: tool!.toolId,
    version: tool!.version,
    status: "disabled"
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.manifest.status, "disabled");

  const explorer = registry.metadataExplorer({ status: "disabled" });
  assert.equal(explorer.some((record) => record.toolId === "tool.shell-command"), true);
});

test("registry can resolve latest and by explicit version", () => {
  const registry = new InMemoryToolRegistry();
  const latest = registry.resolve("tool.web-search");
  assert.ok(latest);
  const exact = registry.resolve("tool.web-search", latest!.version);
  assert.ok(exact);
  assert.equal(exact?.version, latest?.version);
});
