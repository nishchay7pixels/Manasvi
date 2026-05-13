/**
 * manasvi governance <summary|tools|policies|risks>
 * Read-oriented governance visibility commands.
 * Composes tool/service data from existing CLI internals.
 */

import { banner, section, info, success, warn, hint, style, checkRow } from "../lib/ui.js";
import { loadConfig } from "../lib/config.js";
import { fileExists, envFilePath, readEnvFile } from "../lib/env.js";
import { isPortInUse } from "../lib/health.js";
import { runToolsList } from "./tools.js";
import { printJson, jsonOk, jsonFail } from "../lib/json.js";

export interface GovernanceOptions {
  json?: boolean;
}

// ── Tool risk data (mirrors tools.ts static manifest) ────────────────────────

const TOOL_RISKS = [
  { id: "tool.local-file-read", label: "Local File Read", risk: "low", mutating: false, approval: false },
  { id: "tool.http-fetch", label: "HTTP Fetch", risk: "medium", mutating: false, approval: false },
  { id: "tool.web-search", label: "Web Search", risk: "medium", mutating: false, approval: false },
  { id: "tool.memory-note-write", label: "Memory Note Write", risk: "medium", mutating: true, approval: false },
  { id: "tool.approval-request", label: "Approval Request", risk: "high", mutating: true, approval: true },
  { id: "tool.shell-command", label: "Shell Command", risk: "high", mutating: true, approval: true }
];

// ── Summary ───────────────────────────────────────────────────────────────────

async function runGovernanceSummary(opts: GovernanceOptions): Promise<void> {
  const config = await loadConfig();
  const envPath = config ? envFilePath(config.projectPath) : null;
  const env = envPath && await fileExists(envPath) ? await readEnvFile(envPath) : {};

  const policyServiceRunning = config ? await isPortInUse(config.services.policyPort) : false;
  const approvalServiceRunning = config ? await isPortInUse(config.services.approvalPort) : false;

  const fsWritesEnabled = (env.MANASVI_FS_WRITES_ENABLED ?? "false").toLowerCase() === "true";
  const fsWritesRequireApproval = (env.MANASVI_FS_WRITES_REQUIRE_APPROVAL ?? "true").toLowerCase() === "true";

  const highRiskTools = TOOL_RISKS.filter((t) => t.risk === "high");
  const mutatingTools = TOOL_RISKS.filter((t) => t.mutating);
  const approvalGatedTools = TOOL_RISKS.filter((t) => t.approval);

  if (opts.json) {
    printJson(jsonOk("governance summary", {
      policyServiceRunning,
      approvalServiceRunning,
      filesystemWrites: { enabled: fsWritesEnabled, requireApproval: fsWritesRequireApproval },
      tools: {
        total: TOOL_RISKS.length,
        highRisk: highRiskTools.length,
        mutating: mutatingTools.length,
        approvalGated: approvalGatedTools.length
      }
    }));
    return;
  }

  banner("governance");

  section("Governance Posture");

  checkRow("Policy service", policyServiceRunning ? "pass" : "warn",
    policyServiceRunning ? `running (port ${config?.services.policyPort})` : "not running — policies inactive");
  checkRow("Approval service", approvalServiceRunning ? "pass" : "warn",
    approvalServiceRunning ? `running (port ${config?.services.approvalPort})` : "not running — approvals inactive");
  checkRow("Filesystem writes", fsWritesEnabled ? "warn" : "pass",
    fsWritesEnabled ? "enabled" : "disabled (safe default)");
  checkRow("FS writes require approval", fsWritesRequireApproval ? "pass" : "fail",
    fsWritesRequireApproval ? "true (safe)" : "false — UNSAFE: writes can execute without approval");

  section("Tool Risk Summary");

  console.log(`  ${style.dim("Total tools:".padEnd(22))}  ${TOOL_RISKS.length}`);
  console.log(`  ${style.dim("High-risk tools:".padEnd(22))}  ${highRiskTools.length}  ${style.dim(`(${highRiskTools.map((t) => t.label).join(", ")})`)}` );
  console.log(`  ${style.dim("Mutating tools:".padEnd(22))}  ${mutatingTools.length}`);
  console.log(`  ${style.dim("Approval-gated:".padEnd(22))}  ${approvalGatedTools.length}`);

  console.log();
  hint("Details: pnpm manasvi governance tools");
  hint("Risks:   pnpm manasvi governance risks");
  hint("Policy:  pnpm manasvi governance policies");
  console.log();
}

// ── Tools ─────────────────────────────────────────────────────────────────────

async function runGovernanceTools(opts: GovernanceOptions): Promise<void> {
  // Delegate to existing tools list command
  await runToolsList([...(opts.json ? ["--json"] : [])]);
}

// ── Policies ──────────────────────────────────────────────────────────────────

async function runGovernancePolicies(opts: GovernanceOptions): Promise<void> {
  const config = await loadConfig();
  const envPath = config ? envFilePath(config.projectPath) : null;
  const env = envPath && await fileExists(envPath) ? await readEnvFile(envPath) : {};

  const policySetPath = env.POLICY_SET_PATH ?? "configs/policies/default-policy-set.json";
  const orchestratorPort = config?.services.orchestratorPort ?? 4102;
  const orchestratorRunning = await isPortInUse(orchestratorPort);

  if (opts.json) {
    printJson(jsonOk("governance policies", {
      policySetPath,
      orchestratorRunning,
      approvalTtlSeconds: env.APPROVAL_REQUEST_TTL_SECONDS ?? "3600",
      approvedArtifactTtlSeconds: env.APPROVED_ARTIFACT_TTL_SECONDS ?? "900",
      sandboxProfile: env.SANDBOX_PROFILE_DEFAULT ?? "read_only",
      sessionIsolationMode: env.SESSION_DEFAULT_ISOLATION_MODE ?? "per_user_isolated",
      agentLoopMaxIterations: env.AGENT_LOOP_MAX_ITERATIONS ?? "6"
    }));
    return;
  }

  banner("governance policies");

  section("Policy Configuration");

  console.log(`  ${style.dim("Policy set path:".padEnd(32))}  ${policySetPath}`);
  console.log(`  ${style.dim("Orchestrator:".padEnd(32))}  ${orchestratorRunning ? style.green("running") : style.yellow("stopped")}`);

  section("Approval Settings");
  console.log(`  ${style.dim("Request TTL:".padEnd(32))}  ${env.APPROVAL_REQUEST_TTL_SECONDS ?? "3600"}s`);
  console.log(`  ${style.dim("Artifact TTL:".padEnd(32))}  ${env.APPROVED_ARTIFACT_TTL_SECONDS ?? "900"}s`);

  section("Runtime Constraints");
  console.log(`  ${style.dim("Sandbox profile:".padEnd(32))}  ${env.SANDBOX_PROFILE_DEFAULT ?? "read_only"}`);
  console.log(`  ${style.dim("Session isolation:".padEnd(32))}  ${env.SESSION_DEFAULT_ISOLATION_MODE ?? "per_user_isolated"}`);
  console.log(`  ${style.dim("Agent loop max iterations:".padEnd(32))}  ${env.AGENT_LOOP_MAX_ITERATIONS ?? "6"}`);
  console.log(`  ${style.dim("Context token budget:".padEnd(32))}  ${env.SESSION_CONTEXT_TOKEN_BUDGET ?? "2048"} tokens`);

  console.log();
  hint(`Edit policy set: ${policySetPath}`);
  hint("Inspect tools:   pnpm manasvi tools inspect <tool-id>");
  console.log();
}

// ── Risks ─────────────────────────────────────────────────────────────────────

async function runGovernanceRisks(opts: GovernanceOptions): Promise<void> {
  const config = await loadConfig();
  const envPath = config ? envFilePath(config.projectPath) : null;
  const env = envPath && await fileExists(envPath) ? await readEnvFile(envPath) : {};

  const fsWritesEnabled = (env.MANASVI_FS_WRITES_ENABLED ?? "false").toLowerCase() === "true";
  const fsWritesRequireApproval = (env.MANASVI_FS_WRITES_REQUIRE_APPROVAL ?? "true").toLowerCase() === "true";

  type RiskItem = { risk: string; severity: "high" | "medium" | "low"; mitigation: string };
  const risks: RiskItem[] = [];

  // Tool risks
  for (const tool of TOOL_RISKS) {
    risks.push({
      risk: `Tool: ${tool.label}`,
      severity: tool.risk as "high" | "medium" | "low",
      mitigation: tool.approval
        ? "Requires approval before execution"
        : tool.mutating
          ? "Mutating — review policy binding in policy set"
          : "Read-only — low risk"
    });
  }

  // Config risks
  if (fsWritesEnabled && !fsWritesRequireApproval) {
    risks.push({
      risk: "Filesystem writes enabled without approval",
      severity: "high",
      mitigation: "Set MANASVI_FS_WRITES_REQUIRE_APPROVAL=true in .env.local"
    });
  }

  const telegramEnabled = config?.channels.telegram?.enabled ?? false;
  if (telegramEnabled) {
    risks.push({
      risk: "Telegram channel active — external message ingress",
      severity: "medium",
      mitigation: "Rate limiting and ingress anti-spam active by default"
    });
  }

  if (opts.json) {
    printJson(jsonOk("governance risks", { risks }));
    return;
  }

  banner("governance risks");

  section("Risk Profile");

  const byLevel = (level: "high" | "medium" | "low") =>
    risks.filter((r) => r.severity === level);

  const highRisks = byLevel("high");
  const medRisks = byLevel("medium");
  const lowRisks = byLevel("low");

  if (highRisks.length > 0) {
    console.log(`\n${style.boldRed("High risk:")}`);
    for (const r of highRisks) {
      console.log(`  ${style.red("✗")} ${r.risk}`);
      console.log(`    ${style.dim(r.mitigation)}`);
    }
  }

  if (medRisks.length > 0) {
    console.log(`\n${style.boldYellow("Medium risk:")}`);
    for (const r of medRisks) {
      console.log(`  ${style.yellow("⚠")} ${r.risk}`);
      console.log(`    ${style.dim(r.mitigation)}`);
    }
  }

  if (lowRisks.length > 0) {
    console.log(`\n${style.bold("Low risk:")}`);
    for (const r of lowRisks) {
      console.log(`  ${style.green("✓")} ${r.risk}`);
      console.log(`    ${style.dim(r.mitigation)}`);
    }
  }

  console.log();
  if (highRisks.length === 0) {
    success("No high-risk misconfigurations detected.");
  } else {
    warn(`${highRisks.length} high-risk issue(s) require attention.`);
  }
  console.log();
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function runGovernance(sub?: string, opts: GovernanceOptions = {}): Promise<void> {
  switch (sub ?? "summary") {
    case "summary":
    case undefined:
      await runGovernanceSummary(opts);
      break;
    case "tools":
      await runGovernanceTools(opts);
      break;
    case "policies":
      await runGovernancePolicies(opts);
      break;
    case "risks":
      await runGovernanceRisks(opts);
      break;
    default: {
      if (opts.json) {
        printJson(jsonFail("governance", [{
          code: "governance.unknown_sub",
          message: `Unknown subcommand: governance ${sub}`,
          fix: "Valid: summary, tools, policies, risks"
        }]));
      } else {
        warn(`Unknown subcommand: governance ${sub}`);
        hint("Valid subcommands: summary, tools, policies, risks");
      }
      process.exit(1);
    }
  }
}
