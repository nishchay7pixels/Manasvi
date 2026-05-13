/**
 * Tests for CLI argument parser helpers and command suggestion.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hasFlag, flagValue } from "../index.js";
import { suggestCommand, findCommand } from "../lib/registry.js";

describe("hasFlag", () => {
  test("detects short flag", () => {
    assert.equal(hasFlag(["-v", "status"], "-v"), true);
  });

  test("detects long flag", () => {
    assert.equal(hasFlag(["--verbose", "status"], "--verbose"), true);
  });

  test("returns false when flag absent", () => {
    assert.equal(hasFlag(["status", "--json"], "--verbose"), false);
  });

  test("detects multiple flag aliases", () => {
    assert.equal(hasFlag(["-y"], "--yes", "-y"), true);
  });
});

describe("flagValue", () => {
  test("extracts value after flag", () => {
    assert.equal(flagValue(["--category", "models"], "--category"), "models");
  });

  test("extracts value from flag=value form", () => {
    assert.equal(flagValue(["--profile=demo"], "--profile"), "demo");
  });

  test("returns undefined when flag absent", () => {
    assert.equal(flagValue(["--json"], "--category"), undefined);
  });

  test("does not return next flag as value", () => {
    assert.equal(flagValue(["--fix", "--json"], "--fix"), undefined);
  });
});

describe("suggestCommand", () => {
  test("suggests status for ststus", () => {
    const suggestions = suggestCommand("ststus");
    assert.ok(suggestions.includes("status"), `Expected 'status' in ${suggestions.join(", ")}`);
  });

  test("suggests doctor for docter", () => {
    const suggestions = suggestCommand("docter");
    assert.ok(suggestions.includes("doctor"), `Expected 'doctor' in ${suggestions.join(", ")}`);
  });

  test("returns empty for very different input", () => {
    const suggestions = suggestCommand("xxxxxxxxxx");
    assert.equal(suggestions.length, 0);
  });

  test("does not suggest for exact match garbage", () => {
    const suggestions = suggestCommand("zzzzzzzzzz");
    assert.equal(suggestions.length, 0);
  });
});

describe("findCommand", () => {
  test("finds by name", () => {
    const cmd = findCommand("status");
    assert.ok(cmd !== undefined);
    assert.equal(cmd!.name, "status");
  });

  test("returns undefined for unknown command", () => {
    assert.equal(findCommand("xxxxxxxx"), undefined);
  });

  test("finds setup command", () => {
    const cmd = findCommand("setup");
    assert.ok(cmd !== undefined);
    assert.equal(cmd!.group, "getting-started");
  });

  test("finds logs command", () => {
    const cmd = findCommand("logs");
    assert.ok(cmd !== undefined);
    assert.equal(cmd!.group, "lifecycle");
  });

  test("finds connect command", () => {
    const cmd = findCommand("connect");
    assert.ok(cmd !== undefined);
  });

  test("finds governance command", () => {
    const cmd = findCommand("governance");
    assert.ok(cmd !== undefined);
    assert.equal(cmd!.group, "governance");
  });
});
