/**
 * Tests for command registry — lookup, groups, and status labels.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_REGISTRY, getCommandsByGroup, findCommand } from "../lib/registry.js";

describe("COMMAND_REGISTRY", () => {
  test("contains all expected commands", () => {
    const names = COMMAND_REGISTRY.map((c) => c.name);
    const required = [
      "setup", "init", "onboard",
      "start", "stop", "restart", "status", "doctor", "logs",
      "config", "models", "channels",
      "tools", "governance", "approvals",
      "integrations", "connect", "connections",
      "plugins", "nodes",
      "ui", "docs", "version"
    ];
    for (const name of required) {
      assert.ok(names.includes(name), `Missing command: ${name}`);
    }
  });

  test("all commands have required fields", () => {
    for (const cmd of COMMAND_REGISTRY) {
      assert.ok(cmd.name.length > 0, `Command missing name`);
      assert.ok(cmd.description.length > 0, `${cmd.name} missing description`);
      assert.ok(cmd.syntax.length > 0, `${cmd.name} missing syntax`);
      assert.ok(Array.isArray(cmd.examples), `${cmd.name} examples should be array`);
      assert.ok(cmd.group.length > 0, `${cmd.name} missing group`);
    }
  });

  test("no duplicate command names", () => {
    const names = COMMAND_REGISTRY.map((c) => c.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, "Duplicate command names found");
  });
});

describe("getCommandsByGroup", () => {
  test("returns all groups", () => {
    const groups = getCommandsByGroup();
    const expectedGroups = [
      "getting-started",
      "lifecycle",
      "configuration",
      "governance",
      "integrations",
      "advanced",
      "docs"
    ];
    for (const g of expectedGroups) {
      assert.ok(groups.has(g as ReturnType<typeof getCommandsByGroup> extends Map<infer K, unknown> ? K : never),
        `Missing group: ${g}`);
    }
  });

  test("getting-started group has setup, init, onboard", () => {
    const groups = getCommandsByGroup();
    const gsNames = groups.get("getting-started")?.map((c) => c.name) ?? [];
    assert.ok(gsNames.includes("setup"));
    assert.ok(gsNames.includes("init"));
    assert.ok(gsNames.includes("onboard"));
  });

  test("lifecycle group has logs", () => {
    const groups = getCommandsByGroup();
    const lcNames = groups.get("lifecycle")?.map((c) => c.name) ?? [];
    assert.ok(lcNames.includes("logs"), "logs should be in lifecycle group");
  });
});

describe("findCommand", () => {
  test("finds setup as stable", () => {
    const cmd = findCommand("setup");
    assert.equal(cmd?.status, "stable");
  });

  test("finds approvals as experimental", () => {
    const cmd = findCommand("approvals");
    assert.equal(cmd?.status, "experimental");
  });

  test("finds plugins as scaffolded", () => {
    const cmd = findCommand("plugins");
    assert.equal(cmd?.status, "scaffolded");
  });

  test("doctor has --fix flag defined", () => {
    const cmd = findCommand("doctor");
    const flags = cmd?.flags ?? [];
    assert.ok(flags.some((f) => f.flag === "--fix"));
  });

  test("logs has --tail and --follow flags", () => {
    const cmd = findCommand("logs");
    const flags = cmd?.flags ?? [];
    assert.ok(flags.some((f) => f.flag === "--tail"));
    assert.ok(flags.some((f) => f.flag === "--follow"));
  });

  test("config has explain subcommand", () => {
    const cmd = findCommand("config");
    const subs = cmd?.subcommands ?? [];
    assert.ok(subs.some((s) => s.name === "explain"));
  });
});
