/**
 * CLI output formatting utilities.
 * Single source of truth for colors, symbols, and layout.
 */

// ── ANSI codes ────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m"
} as const;

const noColor = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;

function c(code: string, text: string): string {
  return noColor ? text : `${code}${text}${C.reset}`;
}

export const style = {
  bold: (t: string) => c(C.bold, t),
  dim: (t: string) => c(C.dim, t),
  red: (t: string) => c(C.red, t),
  green: (t: string) => c(C.green, t),
  yellow: (t: string) => c(C.yellow, t),
  blue: (t: string) => c(C.blue, t),
  magenta: (t: string) => c(C.magenta, t),
  cyan: (t: string) => c(C.cyan, t),
  gray: (t: string) => c(C.gray, t),
  boldCyan: (t: string) => c(C.bold + C.cyan, t),
  boldGreen: (t: string) => c(C.bold + C.green, t),
  boldRed: (t: string) => c(C.bold + C.red, t),
  boldYellow: (t: string) => c(C.bold + C.yellow, t)
};

// ── Symbols ───────────────────────────────────────────────────────────────────

export const sym = {
  check: style.green("✓"),
  cross: style.red("✗"),
  warn: style.yellow("⚠"),
  info: style.cyan("ℹ"),
  arrow: style.gray("→"),
  bullet: style.gray("•"),
  dot: style.gray("·")
};

// ── Banner ─────────────────────────────────────────────────────────────────────

export function banner(subtitle?: string): void {
  const title = style.boldCyan("Manasvi");
  const tag = subtitle ? ` ${style.dim(subtitle)}` : "";
  console.log(`\n${title}${tag}\n`);
}

// ── Section header ─────────────────────────────────────────────────────────────

export function section(title: string): void {
  console.log(`\n${style.bold(title)}`);
  console.log(style.dim("─".repeat(Math.min(title.length + 2, 50))));
}

// ── Status line ────────────────────────────────────────────────────────────────

export function info(msg: string): void {
  console.log(`${sym.info} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${sym.check} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${sym.warn} ${style.yellow(msg)}`);
}

export function error(msg: string): void {
  console.error(`${sym.cross} ${style.red(msg)}`);
}

export function fatal(msg: string): never {
  error(msg);
  process.exit(1);
}

export function hint(msg: string): void {
  console.log(`  ${style.dim(msg)}`);
}

export function step(label: string, detail?: string): void {
  const d = detail ? ` ${style.dim(detail)}` : "";
  console.log(`  ${sym.arrow} ${label}${d}`);
}

// ── Next steps ─────────────────────────────────────────────────────────────────

export function nextSteps(steps: string[]): void {
  console.log(`\n${style.bold("Next steps:")}`);
  steps.forEach((s, i) => {
    console.log(`  ${style.dim(`${i + 1}.`)} ${s}`);
  });
  console.log();
}

// ── Table ──────────────────────────────────────────────────────────────────────

export function table(
  rows: Array<{ label: string; value: string; status?: "ok" | "warn" | "error" | "dim" }>
): void {
  const maxLabel = Math.max(...rows.map((r) => r.label.length));
  for (const row of rows) {
    const label = row.label.padEnd(maxLabel);
    let value = row.value;
    if (row.status === "ok") value = style.green(value);
    else if (row.status === "error") value = style.red(value);
    else if (row.status === "warn") value = style.yellow(value);
    else if (row.status === "dim") value = style.dim(value);
    console.log(`  ${style.dim(label)}  ${value}`);
  }
}

// ── Check result row ───────────────────────────────────────────────────────────

export function checkRow(
  label: string,
  status: "pass" | "warn" | "fail" | "skip",
  detail?: string
): void {
  const icons = { pass: sym.check, warn: sym.warn, fail: sym.cross, skip: sym.dot };
  const icon = icons[status];
  const d = detail ? `  ${style.dim(detail)}` : "";
  console.log(`  ${icon} ${label}${d}`);
}

// ── Spinner ────────────────────────────────────────────────────────────────────

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinner(text: string): () => void {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${text}…\n`);
    return () => {};
  }
  let i = 0;
  process.stdout.write(`\r${style.dim(spinnerFrames[0] ?? "·")} ${style.dim(text)}`);
  const interval = setInterval(() => {
    i = (i + 1) % spinnerFrames.length;
    process.stdout.write(`\r${style.dim(spinnerFrames[i] ?? "·")} ${style.dim(text)}`);
  }, 80);
  return () => {
    clearInterval(interval);
    process.stdout.write("\r\x1b[K");
  };
}

// ── Code block ─────────────────────────────────────────────────────────────────

export function code(text: string): void {
  console.log(`\n  ${style.dim("$")} ${style.cyan(text)}\n`);
}
