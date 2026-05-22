import type { GoogleService } from "../../google-capabilities.js";
import { GOOGLE_SERVICES } from "../../google-capabilities.js";
import type { GogProcessResult } from "./gog-process-runner.js";
import { runGogProcess } from "./gog-process-runner.js";

export type GogBinaryStatus =
  | "found"
  | "not_found"
  | "not_executable"
  | "version_unreadable";

export interface GogBinaryCheck {
  ok: boolean;
  status: GogBinaryStatus;
  binaryPath?: string;
  version?: string;
  errors: string[];
  warnings: string[];
  nextSteps: string[];
}

export interface GogAuthServiceStatus {
  service: GoogleService;
  authorized: boolean;
  reason?: string;
}

export interface GogAuthCheck {
  ok: boolean;
  account?: string;
  services: Record<GoogleService, GogAuthServiceStatus>;
  raw?: {
    stdoutPreview?: string;
  };
  warnings: string[];
  errors: string[];
  nextSteps: string[];
}

const INSTALL_NEXT_STEPS = [
  "Install gog and ensure it is available on PATH.",
  "Then run: gog auth credentials /path/to/client_secret.json",
  "Then run: gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets"
];

function preview(value: string): string {
  return value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>").slice(0, 300);
}

function servicesRecord(authorized: Set<GoogleService>, reason = "not listed by gog auth"): Record<GoogleService, GogAuthServiceStatus> {
  return Object.fromEntries(
    GOOGLE_SERVICES.map((service) => [
      service,
      {
        service,
        authorized: authorized.has(service),
        ...(authorized.has(service) ? {} : { reason })
      }
    ])
  ) as Record<GoogleService, GogAuthServiceStatus>;
}

function versionFromOutput(result: GogProcessResult): string | undefined {
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (!text) return undefined;
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
  return firstLine?.trim();
}

export async function checkGogBinary(options: {
  binaryPath?: string;
  runner?: typeof runGogProcess;
} = {}): Promise<GogBinaryCheck> {
  const processRequest = {
    ...(options.binaryPath ? { binaryPath: options.binaryPath } : {}),
    args: ["--version"],
    timeoutMs: 5000,
    maxStdoutBytes: 8192,
    maxStderrBytes: 8192
  };
  const result = await (options.runner ?? runGogProcess)({
    ...processRequest
  });

  if (result.ok) {
    const version = versionFromOutput(result);
    return {
      ok: true,
      status: "found",
      binaryPath: options.binaryPath ?? "gog",
      ...(version ? { version } : {}),
      errors: [],
      warnings: [],
      nextSteps: []
    };
  }

  const errorText = `${result.error ?? ""}\n${result.stderr}`.toLowerCase();
  if (errorText.includes("enoent") || errorText.includes("not found")) {
    return {
      ok: false,
      status: "not_found",
      binaryPath: options.binaryPath ?? "gog",
      errors: ["gog binary not found."],
      warnings: [],
      nextSteps: INSTALL_NEXT_STEPS
    };
  }
  if (errorText.includes("eacces") || errorText.includes("permission")) {
    return {
      ok: false,
      status: "not_executable",
      binaryPath: options.binaryPath ?? "gog",
      errors: ["gog binary is not executable."],
      warnings: [],
      nextSteps: ["Check gog file permissions and PATH."]
    };
  }
  return {
    ok: false,
    status: "version_unreadable",
    binaryPath: options.binaryPath ?? "gog",
    errors: [`Could not read gog version${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ""}.`],
    warnings: [],
    nextSteps: ["Run gog --version locally and verify the CLI works."]
  };
}

function tryParseJsonAuth(stdout: string): { account?: string; services: Set<GoogleService> } | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const accounts = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { accounts?: unknown }).accounts)
        ? (parsed as { accounts: unknown[] }).accounts
        : [];
    const first = accounts.find((item) => typeof item === "object" && item !== null) as Record<string, unknown> | undefined;
    if (!first) return null;
    const account = typeof first.email === "string" ? first.email : typeof first.account === "string" ? first.account : undefined;
    const serviceValues = Array.isArray(first.services) ? first.services : Array.isArray(first.authorizedServices) ? first.authorizedServices : [];
    const services = new Set<GoogleService>();
    for (const service of serviceValues) {
      if (typeof service === "string" && (GOOGLE_SERVICES as readonly string[]).includes(service.toLowerCase())) {
        services.add(service.toLowerCase() as GoogleService);
      }
    }
    return { ...(account ? { account } : {}), services };
  } catch {
    return null;
  }
}

function parseTextAuth(stdout: string): { account?: string; services: Set<GoogleService>; uncertain: boolean } {
  const lower = stdout.toLowerCase();
  const services = new Set<GoogleService>();
  for (const service of GOOGLE_SERVICES) {
    if (new RegExp(`\\b${service}\\b`, "i").test(stdout)) services.add(service);
  }
  const account = stdout.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  const negative = /\b(no accounts|not authenticated|not connected|unauthorized|missing)\b/i.test(stdout);
  return {
    ...(account ? { account } : {}),
    services: negative ? new Set<GoogleService>() : services,
    uncertain: services.size === 0 || (!account && lower.trim().length > 0)
  };
}

export async function checkGogAuth(options: {
  binaryPath?: string;
  runner?: typeof runGogProcess;
} = {}): Promise<GogAuthCheck> {
  const result = await (options.runner ?? runGogProcess)({
    ...(options.binaryPath ? { binaryPath: options.binaryPath } : {}),
    args: ["auth", "list"],
    timeoutMs: 5000,
    maxStdoutBytes: 65536,
    maxStderrBytes: 16384
  });

  if (!result.ok) {
    return {
      ok: false,
      services: servicesRecord(new Set(), "gog auth list failed"),
      raw: { stdoutPreview: preview(result.stdout) },
      warnings: [],
      errors: ["gog auth is not connected or could not be read."],
      nextSteps: ["Run: gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets"]
    };
  }

  const json = tryParseJsonAuth(result.stdout);
  if (json) {
    return {
      ok: json.services.size > 0,
      ...(json.account ? { account: json.account } : {}),
      services: servicesRecord(json.services),
      raw: { stdoutPreview: preview(result.stdout) },
      warnings: json.services.size === 0 ? ["gog auth list returned JSON but no authorized services were found."] : [],
      errors: [],
      nextSteps: json.services.size === 0 ? ["Run: gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets"] : []
    };
  }

  const text = parseTextAuth(result.stdout);
  return {
    ok: text.services.size > 0 && !text.uncertain,
    ...(text.account ? { account: text.account } : {}),
    services: servicesRecord(text.services, text.uncertain ? "authorization unknown from gog auth output" : "not listed by gog auth"),
    raw: { stdoutPreview: preview(result.stdout) },
    warnings: text.uncertain ? ["Could not confidently parse gog auth list output."] : [],
    errors: [],
    nextSteps: text.services.size === 0 ? ["Run: gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets"] : []
  };
}
