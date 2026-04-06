import {
  egressAllowlistRuleSchema,
  runtimePolicySchema,
  type ApprovedIntentArtifact,
  type EgressAllowlistRule,
  type EgressWhitelistPolicy,
  type ExecutionIntent,
  type PolicyEvaluationResponse,
  type RuntimePolicy,
  type SandboxMode
} from "@manasvi/contracts";

type SandboxProfileDefault = "read_only" | "bounded_egress" | "mutation_limited" | "privileged_reviewed";

export interface DeriveRuntimePolicyInput {
  intent: ExecutionIntent;
  artifact: ApprovedIntentArtifact;
  policyDecision: PolicyEvaluationResponse;
  sandboxProfileDefault: SandboxProfileDefault;
  egressWhitelistPolicy: EgressWhitelistPolicy;
}

function resolveSandboxMode(input: DeriveRuntimePolicyInput): SandboxMode {
  if (
    input.sandboxProfileDefault === "privileged_reviewed" ||
    input.intent.snapshot.risk.level === "critical" ||
    input.intent.snapshot.action.actionClass === "destructive-action" ||
    input.intent.snapshot.action.actionClass === "administer-policy"
  ) {
    return "privileged_operator_approved";
  }
  if (
    input.sandboxProfileDefault === "bounded_egress" ||
    input.intent.snapshot.action.actionClass === "access-network" ||
    input.intent.snapshot.action.actionClass === "external-side-effect"
  ) {
    return "restricted_remote";
  }
  if (input.sandboxProfileDefault === "mutation_limited") {
    return "no_network_compute";
  }
  return "read_only_local";
}

function inferSecretRefs(intent: ExecutionIntent): string[] {
  const refs = new Set<string>();
  if (intent.snapshot.target.resourceClass === "secret-reference") {
    refs.add(intent.snapshot.target.resourceId);
  }
  for (const capability of intent.snapshot.requiredCapabilities) {
    if (capability.startsWith("secret:")) {
      refs.add(capability.slice("secret:".length));
    }
  }
  return Array.from(refs);
}

function buildFilesystemPolicy(mode: SandboxMode) {
  switch (mode) {
    case "read_only_local":
      return {
        mode: "read_only_inputs" as const,
        readPaths: [],
        writePaths: []
      };
    case "no_network_compute":
      return {
        mode: "scratch_write" as const,
        readPaths: [],
        writePaths: []
      };
    case "restricted_remote":
      return {
        mode: "scratch_write" as const,
        readPaths: [],
        writePaths: []
      };
    case "privileged_operator_approved":
      return {
        mode: "privileged_bounded" as const,
        readPaths: [],
        writePaths: []
      };
  }
}

function buildNetworkPolicy(mode: SandboxMode, egressPolicy: EgressWhitelistPolicy) {
  if (mode === "no_network_compute" || mode === "read_only_local") {
    return {
      mode: "none" as const,
      egressAllowlist: []
    };
  }
  if (mode === "restricted_remote") {
    return {
      mode: "allowlist_only" as const,
      egressAllowlist: egressPolicy.rules.map((rule) => egressAllowlistRuleSchema.parse(rule))
    };
  }
  return {
    mode: "operator_approved" as const,
    egressAllowlist: egressPolicy.rules.map((rule: EgressAllowlistRule) => egressAllowlistRuleSchema.parse(rule))
  };
}

function buildTimeoutMs(mode: SandboxMode): number {
  switch (mode) {
    case "read_only_local":
      return 12_000;
    case "no_network_compute":
      return 20_000;
    case "restricted_remote":
      return 30_000;
    case "privileged_operator_approved":
      return 45_000;
  }
}

function buildCpuLimitSeconds(mode: SandboxMode): number {
  switch (mode) {
    case "read_only_local":
      return 6;
    case "no_network_compute":
      return 12;
    case "restricted_remote":
      return 15;
    case "privileged_operator_approved":
      return 20;
  }
}

function buildMemoryLimitMb(mode: SandboxMode): number {
  switch (mode) {
    case "read_only_local":
      return 128;
    case "no_network_compute":
      return 256;
    case "restricted_remote":
      return 256;
    case "privileged_operator_approved":
      return 384;
  }
}

export function deriveRuntimePolicy(input: DeriveRuntimePolicyInput): RuntimePolicy {
  const mode = resolveSandboxMode(input);
  const secretRefs = inferSecretRefs(input.intent);
  return runtimePolicySchema.parse({
    schemaVersion: "1.0",
    policyId: `runtime-policy:${input.policyDecision.decisionId}:${input.artifact.artifactId}`,
    sandboxMode: mode,
    timeoutMs: buildTimeoutMs(mode),
    cpuTimeLimitSeconds: buildCpuLimitSeconds(mode),
    memoryLimitMb: buildMemoryLimitMb(mode),
    filesystem: buildFilesystemPolicy(mode),
    network: buildNetworkPolicy(mode, input.egressWhitelistPolicy),
    secrets: {
      allowedSecretRefs: secretRefs,
      injectedSecretEnvNames: secretRefs.map(
        (ref) => `MANASVI_SECRET_${ref.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`
      )
    },
    cleanup: {
      removeWorkspaceAfterRun: true
    },
    derivedFrom: {
      actionClass: input.intent.snapshot.action.actionClass,
      target: input.intent.snapshot.target
    }
  });
}
