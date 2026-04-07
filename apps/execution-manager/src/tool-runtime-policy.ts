import { runtimePolicySchema, toolExecutionContractSchema, type RuntimePolicy, type ToolExecutionContract } from "@manasvi/contracts";

function toFilesystemMode(profile: "none" | "read_only_inputs" | "scratch_write" | "privileged_bounded") {
  return profile;
}

export function mergeRuntimePolicyWithToolHints(input: {
  baseRuntimePolicy: RuntimePolicy;
  toolContract: ToolExecutionContract;
}): RuntimePolicy {
  const baseRuntimePolicy = runtimePolicySchema.parse(input.baseRuntimePolicy);
  const toolContract = toolExecutionContractSchema.parse(input.toolContract);
  const requestedSecretRefs = toolContract.invocation.requestedSecretRefs;
  const declaredSecretRefs = toolContract.manifest.runtimeHints.declaredSecretRefs;
  const allowedSecretRefs = requestedSecretRefs.filter((ref) => declaredSecretRefs.includes(ref));
  const timeoutMs = Math.min(baseRuntimePolicy.timeoutMs, toolContract.manifest.runtimeHints.defaultTimeoutMs);
  const merged = {
    ...baseRuntimePolicy,
    timeoutMs,
    sandboxMode: toolContract.manifest.runtimeHints.defaultSandboxMode,
    filesystem: {
      ...baseRuntimePolicy.filesystem,
      mode: toFilesystemMode(toolContract.manifest.runtimeHints.filesystemProfile)
    },
    secrets: {
      ...baseRuntimePolicy.secrets,
      allowedSecretRefs,
      injectedSecretEnvNames: allowedSecretRefs.map(
        (ref) => `MANASVI_SECRET_${ref.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`
      )
    }
  };
  if (toolContract.manifest.runtimeHints.egressProfiles.length === 0) {
    return runtimePolicySchema.parse({
      ...merged,
      network: {
        mode: "none",
        egressAllowlist: []
      }
    });
  }
  return runtimePolicySchema.parse(merged);
}
