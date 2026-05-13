/**
 * Readline-based interactive prompts.
 * No external dependencies — clean numbered-choice UX.
 */

import * as readline from "node:readline";
import { style } from "./ui.js";

function rl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const iface = rl();
    iface.question(question, (answer) => {
      iface.close();
      resolve(answer.trim());
    });
  });
}

// ── Text input ─────────────────────────────────────────────────────────────────

export async function input(label: string, defaultValue?: string): Promise<string> {
  const def = defaultValue !== undefined ? ` ${style.dim(`[${defaultValue}]`)}` : "";
  const answer = await ask(`  ${style.cyan("?")} ${label}${def}: `);
  return answer || defaultValue || "";
}

// ── Yes/No ─────────────────────────────────────────────────────────────────────

export async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? style.dim("Y/n") : style.dim("y/N");
  const answer = await ask(`  ${style.cyan("?")} ${label} ${hint}: `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

// ── Single choice ──────────────────────────────────────────────────────────────

export interface Choice {
  label: string;
  description?: string;
  value: string;
}

export async function select(label: string, choices: Choice[], defaultIndex = 0): Promise<string> {
  console.log(`  ${style.cyan("?")} ${label}`);
  choices.forEach((c, i) => {
    const num = style.dim(`${i + 1}.`);
    const desc = c.description ? ` ${style.dim(c.description)}` : "";
    const marker = i === defaultIndex ? style.cyan(" ←") : "";
    console.log(`     ${num} ${c.label}${desc}${marker}`);
  });

  while (true) {
    const answer = await ask(
      `  ${style.dim("Enter choice")} ${style.dim(`[${defaultIndex + 1}]`)}: `
    );
    const num = answer === "" ? defaultIndex + 1 : parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= choices.length) {
      const chosen = choices[num - 1];
      if (chosen) return chosen.value;
    }
    console.log(`  ${style.yellow(`Please enter a number between 1 and ${choices.length}`)}`);
  }
}

// ── Password / secret input ────────────────────────────────────────────────────

export async function secret(label: string): Promise<string> {
  // Use raw mode to hide input if running in a TTY
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return readHidden(`  ${style.cyan("?")} ${label}: `);
  }
  // Non-TTY fallback (pipes, CI): read line normally but warn
  const answer = await ask(`  ${style.cyan("?")} ${label} ${style.dim("(input visible — non-TTY)")}: `);
  return answer.trim();
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let value = "";

    const onData = (char: string) => {
      if (char === "\r" || char === "\n") {
        // Enter — done
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (char === "") {
        // Ctrl-C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        process.exit(130);
      } else if (char === "" || char === "\b") {
        // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        value += char;
        process.stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}
