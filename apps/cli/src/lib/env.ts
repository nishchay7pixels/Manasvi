/**
 * .env file read/write utilities.
 * Preserves comments and existing values — only adds/updates what's needed.
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";

export type EnvMap = Record<string, string>;

/**
 * Parse a .env file into a key→value map. Ignores comments and blank lines.
 */
export function parseEnv(content: string): EnvMap {
  const result: EnvMap = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    const value =
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    result[key] = value;
  }
  return result;
}

/**
 * Read a .env file. Returns empty map if file doesn't exist.
 */
export async function readEnvFile(path: string): Promise<EnvMap> {
  try {
    const content = await readFile(path, "utf8");
    return parseEnv(content);
  } catch {
    return {};
  }
}

/**
 * Merge values into an existing .env file.
 * - Existing keys are NOT overwritten (safe to re-run).
 * - New keys are appended with an optional section header.
 * - Pass force=true to overwrite specific keys.
 */
export async function mergeEnvFile(
  path: string,
  additions: EnvMap,
  options: { section?: string; force?: string[] } = {}
): Promise<void> {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {
    // new file
  }

  const existing = parseEnv(content);
  const toAdd: EnvMap = {};
  const forceSet = new Set(options.force ?? []);

  for (const [key, value] of Object.entries(additions)) {
    if (!(key in existing) || forceSet.has(key)) {
      toAdd[key] = value;
    }
  }

  if (Object.keys(toAdd).length === 0) return;

  const lines: string[] = [];

  // Update existing lines for forced keys
  if (forceSet.size > 0) {
    const updatedLines = content.split("\n").map((line) => {
      const eq = line.indexOf("=");
      if (eq <= 0) return line;
      const key = line.slice(0, eq).trim();
      if (forceSet.has(key) && key in toAdd) {
        const val = toAdd[key] ?? "";
        delete toAdd[key];
        return `${key}=${val}`;
      }
      return line;
    });
    content = updatedLines.join("\n");
  }

  // Append new keys
  const appendLines: string[] = [];
  if (options.section) {
    appendLines.push(`\n# ${options.section}`);
  }
  for (const [key, value] of Object.entries(toAdd)) {
    appendLines.push(`${key}=${value}`);
  }

  const newContent =
    (content.endsWith("\n") ? content : content + "\n") + appendLines.join("\n") + "\n";

  await writeFile(path, newContent, "utf8");
}

/**
 * Write a complete .env file (overwrites).
 */
export async function writeEnvFile(path: string, values: EnvMap, header?: string): Promise<void> {
  const lines: string[] = [];
  if (header) {
    lines.push(`# ${header}`);
    lines.push("");
  }
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
  }
  await writeFile(path, lines.join("\n") + "\n", "utf8");
}

/**
 * Resolve project root — from env var, CLI config, or current directory.
 */
export function findProjectRoot(override?: string): string {
  return override ?? process.env.MANASVI_PROJECT ?? process.cwd();
}

/**
 * Path to the local .env file for the project.
 */
export function envFilePath(projectRoot: string): string {
  return join(projectRoot, ".env.local");
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
