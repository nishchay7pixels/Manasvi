import { getGoogleCapability, type GoogleBackend } from "./google-capabilities.js";
import type { GoogleIntegrationConfig } from "./google-config.js";
import { normalizeGoogleIntegrationConfig } from "./google-config.js";
import type {
  GoogleCapabilityExecutionRequest,
  GoogleCapabilityExecutionResult,
  GoogleProvider
} from "./google-provider.js";

export interface GoogleCapabilityRouterContext {
  config: GoogleIntegrationConfig;
  providers: {
    gog: GoogleProvider;
    native: GoogleProvider;
  };
}

function blocked<TResult>(
  request: GoogleCapabilityExecutionRequest<unknown>,
  provider: GoogleBackend,
  errors: string[],
  audit: Record<string, unknown>,
  status: GoogleCapabilityExecutionResult<TResult>["status"] = "blocked"
): GoogleCapabilityExecutionResult<TResult> {
  return {
    ok: false,
    capabilityId: request.capabilityId,
    provider,
    status,
    warnings: [],
    errors,
    audit: {
      ...audit,
      executed: false
    }
  };
}

export function resolveGoogleCapabilityBackend(
  capabilityId: string,
  config: GoogleIntegrationConfig
): { ok: true; backend: GoogleBackend } | { ok: false; status: "blocked" | "not_supported"; errors: string[]; backend: GoogleBackend } {
  const normalized = normalizeGoogleIntegrationConfig(config);
  const capability = getGoogleCapability(capabilityId);
  const fallbackBackend = normalized.defaultBackend;

  if (!capability) {
    return {
      ok: false,
      status: "not_supported",
      backend: fallbackBackend,
      errors: [`Unknown Google capability: ${capabilityId}`]
    };
  }

  if (!normalized.enabled) {
    return {
      ok: false,
      status: "blocked",
      backend: fallbackBackend,
      errors: ["Google integration is disabled."]
    };
  }

  const serviceConfig = normalized.services[capability.service];
  if (!serviceConfig?.enabled) {
    return {
      ok: false,
      status: "blocked",
      backend: serviceConfig?.backend ?? fallbackBackend,
      errors: [`Google service ${capability.service} is disabled.`]
    };
  }

  const backend = serviceConfig.backend ?? normalized.defaultBackend;
  if (!capability.supportedBackends.includes(backend)) {
    return {
      ok: false,
      status: "not_supported",
      backend,
      errors: [
        `Capability ${capabilityId} does not support backend ${backend}.`,
        "Backend fallback is disabled; choose a supported backend explicitly."
      ]
    };
  }

  return { ok: true, backend };
}

export async function executeGoogleCapability<TInput = unknown, TResult = unknown>(
  request: GoogleCapabilityExecutionRequest<TInput>,
  context: GoogleCapabilityRouterContext
): Promise<GoogleCapabilityExecutionResult<TResult>> {
  const normalized = normalizeGoogleIntegrationConfig(context.config);
  const capability = getGoogleCapability(request.capabilityId);
  const resolved = resolveGoogleCapabilityBackend(request.capabilityId, normalized);
  const auditBase = {
    correlationId: request.correlationId,
    principal: request.principal,
    capability: request.capabilityId,
    service: capability?.service,
    action: capability?.action,
    effect: capability?.effect,
    sensitivity: capability?.sensitivity,
    requiresApproval: capability?.requiresApproval ?? false,
    approval: request.approval ? {
      approved: request.approval.approved,
      approvalId: request.approval.approvalId
    } : undefined,
    mode: normalized.mode,
    backend: resolved.backend,
    policyHook: "placeholder",
    approvalHook: "placeholder",
    auditHook: "placeholder",
    directAgentAccess: false
  };

  if (!resolved.ok) {
    return blocked(request, resolved.backend, resolved.errors, auditBase, resolved.status);
  }

  if (!capability) {
    return blocked(request, resolved.backend, [`Unknown Google capability: ${request.capabilityId}`], auditBase, "not_supported");
  }

  const provider = context.providers[resolved.backend];
  if (provider.id !== resolved.backend) {
    return blocked(
      request,
      resolved.backend,
      [
        `Configured provider slot ${resolved.backend} is backed by provider ${provider.id}.`,
        "Backend fallback is disabled; no alternate provider was attempted."
      ],
      auditBase,
      "not_supported"
    );
  }

  if (!provider.supports(request.capabilityId)) {
    return blocked(
      request,
      resolved.backend,
      [
        `Provider ${resolved.backend} does not support capability ${request.capabilityId}.`,
        "Backend fallback is disabled; no alternate provider was attempted."
      ],
      auditBase,
      "not_supported"
    );
  }

  if (capability.requiresApproval && request.approval?.approved !== true) {
    return blocked(
      request,
      resolved.backend,
      [`Capability ${request.capabilityId} requires approval before execution.`],
      auditBase,
      "blocked"
    );
  }

  // G1 only wires the mandatory control point. Real provider execution in G2/G3
  // must keep policy, approval, and audit metadata on this route.
  const result = await provider.execute<TInput, TResult>(request);
  const providerAudit = result.audit ?? {};
  return {
    ...result,
    audit: {
      ...auditBase,
      account: typeof providerAudit.account === "string" ? providerAudit.account : undefined,
      requiredScopes: providerAudit.requiredScopes,
      grantedScopesChecked: providerAudit.grantedScopesChecked,
      command: providerAudit.command,
      argsRedacted: providerAudit.argsRedacted,
      executed: providerAudit.executed ?? result.ok,
      status: result.status,
      blockedReason: providerAudit.blockedReason,
      durationMs: providerAudit.durationMs,
      providerAudit
    }
  };
}
