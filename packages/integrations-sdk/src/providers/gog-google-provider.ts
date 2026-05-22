import { getGoogleCapability } from "../google-capabilities.js";
import type { GogGoogleBackendConfig } from "../google-config.js";
import {
  GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS,
  serviceAuthError
} from "../google-capability-inputs.js";
import type {
  GoogleCapabilityExecutionRequest,
  GoogleCapabilityExecutionResult,
  GoogleProvider,
  GoogleProviderHealth
} from "../google-provider.js";
import { buildGogCommand, GogCommandBuilderError } from "./gog/gog-command-builder.js";
import { checkGogAuth, checkGogBinary, type GogAuthCheck, type GogBinaryCheck } from "./gog/gog-health-check.js";
import { parseGogOutput } from "./gog/gog-output-parsers.js";
import { runGogProcess, type GogProcessRequest, type GogProcessResult } from "./gog/gog-process-runner.js";

export interface GogGoogleProviderOptions {
  config?: GogGoogleBackendConfig;
  runner?: (request: GogProcessRequest) => Promise<GogProcessResult>;
  binaryCheck?: (options?: { binaryPath?: string; runner?: typeof runGogProcess }) => Promise<GogBinaryCheck>;
  authCheck?: (options?: { binaryPath?: string; runner?: typeof runGogProcess }) => Promise<GogAuthCheck>;
}

function stderrPreview(stderr: string): string {
  return stderr
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "<redacted-token>")
    .slice(0, 500);
}

function statusFromBuilder(error: GogCommandBuilderError): GoogleCapabilityExecutionResult["status"] {
  return error.status === "blocked" ? "blocked" : "not_supported";
}

export class GogGoogleProvider implements GoogleProvider {
  readonly id = "gog" as const;

  private readonly config: GogGoogleBackendConfig;
  private readonly runner: (request: GogProcessRequest) => Promise<GogProcessResult>;
  private readonly binaryCheck: NonNullable<GogGoogleProviderOptions["binaryCheck"]>;
  private readonly authCheck: NonNullable<GogGoogleProviderOptions["authCheck"]>;

  constructor(options: GogGoogleProviderOptions = {}) {
    this.config = {
      binaryPath: "gog",
      timeoutMs: 10000,
      maxStdoutBytes: 1048576,
      maxStderrBytes: 131072,
      ...(options.config ?? {})
    };
    this.runner = options.runner ?? ((request) => runGogProcess(request));
    this.binaryCheck = options.binaryCheck ?? checkGogBinary;
    this.authCheck = options.authCheck ?? checkGogAuth;
  }

  supports(capabilityId: string): boolean {
    return getGoogleCapability(capabilityId)?.supportedBackends.includes(this.id) ?? false;
  }

  async healthCheck(): Promise<GoogleProviderHealth> {
    const binary = await this.binaryCheck({
      ...(this.config.binaryPath ? { binaryPath: this.config.binaryPath } : {}),
      runner: runGogProcess
    });
    const auth = binary.ok
      ? await this.authCheck({ ...(this.config.binaryPath ? { binaryPath: this.config.binaryPath } : {}), runner: runGogProcess })
      : undefined;

    const services = auth?.services
      ? Object.fromEntries(Object.entries(auth.services).map(([service, status]) => [
        service,
        {
          enabled: true,
          connected: status.authorized,
          ...(status.reason ? { reason: status.reason } : {})
        }
      ]))
      : {};

    return {
      provider: this.id,
      ok: Boolean(binary.ok && auth?.ok),
      status: !binary.ok ? "unavailable" : auth?.ok ? "available" : "not_connected",
      ...(auth?.account ? { account: auth.account } : {}),
      services,
      warnings: [
        ...binary.warnings,
        ...(auth?.warnings ?? []),
        "gog is an execution backend, not an agent-facing shell tool."
      ],
      errors: [...binary.errors, ...(auth?.errors ?? [])],
      nextSteps: [...binary.nextSteps, ...(auth?.nextSteps ?? [])]
    };
  }

  async execute<TInput = unknown, TResult = unknown>(
    request: GoogleCapabilityExecutionRequest<TInput>
  ): Promise<GoogleCapabilityExecutionResult<TResult>> {
    const capability = getGoogleCapability(request.capabilityId);
    const auditBase = {
      correlationId: request.correlationId,
      principal: request.principal,
      capability: request.capabilityId,
      backend: "gog",
      service: capability?.service,
      action: capability?.action,
      effect: capability?.effect,
      sensitivity: capability?.sensitivity,
      requiresApproval: capability?.requiresApproval ?? false,
      approvalId: request.approval?.approvalId,
      directShellAccess: false
    };

    if (!capability) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "not_supported",
        warnings: [],
        errors: [`Unknown Google capability: ${request.capabilityId}`],
        audit: { ...auditBase, executed: false, status: "not_supported" }
      };
    }

    if (!this.supports(request.capabilityId)) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "not_supported",
        warnings: [],
        errors: [`Capability ${request.capabilityId} is not supported by gog.`],
        audit: { ...auditBase, executed: false, status: "not_supported" }
      };
    }

    if ((GOOGLE_G2_WRITE_BLOCKED_CAPABILITY_IDS as readonly string[]).includes(request.capabilityId)) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "blocked",
        warnings: [],
        errors: [`Capability ${request.capabilityId} requires policy and approval before gog execution.`],
        audit: { ...auditBase, executed: false, status: "blocked" }
      };
    }

    let commandSpec;
    try {
      commandSpec = buildGogCommand(request.capabilityId, request.input);
    } catch (error) {
      if (error instanceof GogCommandBuilderError) {
        return {
          ok: false,
          capabilityId: request.capabilityId,
          provider: this.id,
          status: statusFromBuilder(error),
          warnings: [],
          errors: [error.message],
          audit: { ...auditBase, executed: false, status: error.status }
        };
      }
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "failed",
        warnings: [],
        errors: [error instanceof Error ? error.message : "Could not build gog command."],
        audit: { ...auditBase, executed: false, status: "failed" }
      };
    }

    const binary = await this.binaryCheck({ ...(this.config.binaryPath ? { binaryPath: this.config.binaryPath } : {}), runner: runGogProcess });
    if (!binary.ok) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "not_connected",
        warnings: binary.warnings,
        errors: binary.errors,
        audit: { ...auditBase, executed: false, status: "not_connected", binaryStatus: binary.status }
      };
    }

    const auth = await this.authCheck({ ...(this.config.binaryPath ? { binaryPath: this.config.binaryPath } : {}), runner: runGogProcess });
    const serviceStatus = auth.services[commandSpec.service];
    if (!auth.ok || !serviceStatus?.authorized) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "not_connected",
        warnings: auth.warnings,
        errors: [serviceAuthError(commandSpec.service)],
        audit: {
          ...auditBase,
          executed: false,
          status: "not_connected",
          authKnown: auth.ok,
          accountConfigured: Boolean(auth.account)
        }
      };
    }

    if (request.dryRun) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "blocked",
        warnings: ["Dry run requested; gog command was built but not executed."],
        errors: [],
        audit: {
          ...auditBase,
          command: "gog",
          argsRedacted: commandSpec.redaction?.redactArgs
            ? commandSpec.args.map((arg) => commandSpec.redaction?.redactArgs?.includes(arg) ? "<redacted>" : arg)
            : commandSpec.args,
          executed: false,
          status: "blocked"
        }
      };
    }

    const processResult = await this.runner({
      ...(this.config.binaryPath ? { binaryPath: this.config.binaryPath } : {}),
      args: commandSpec.args,
      ...((commandSpec.timeoutMs ?? this.config.timeoutMs) ? { timeoutMs: commandSpec.timeoutMs ?? this.config.timeoutMs } : {}),
      ...((commandSpec.maxStdoutBytes ?? this.config.maxStdoutBytes) ? { maxStdoutBytes: commandSpec.maxStdoutBytes ?? this.config.maxStdoutBytes } : {}),
      ...(this.config.maxStderrBytes ? { maxStderrBytes: this.config.maxStderrBytes } : {}),
      ...(commandSpec.redaction?.redactArgs ? { redactArgs: commandSpec.redaction.redactArgs } : {}),
      ...(request.correlationId ? { correlationId: request.correlationId } : {})
    });

    const commandAudit = {
      ...auditBase,
      command: "gog",
      argsRedacted: processResult.redactedArgs,
      exitCode: processResult.exitCode,
      durationMs: processResult.durationMs,
      stdoutTruncated: processResult.truncated.stdout,
      stderrTruncated: processResult.truncated.stderr,
      executed: true
    };

    if (!processResult.ok) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "failed",
        warnings: [],
        errors: [
          processResult.timedOut
            ? `gog command timed out after ${commandSpec.timeoutMs ?? this.config.timeoutMs ?? 10000}ms.`
            : `gog command failed${processResult.exitCode !== null ? ` with exit code ${processResult.exitCode}` : ""}.`
        ],
        audit: {
          ...commandAudit,
          status: "failed",
          stderrPreview: stderrPreview(processResult.stderr),
          processError: processResult.error
        }
      };
    }

    const parsed = parseGogOutput(commandSpec.parser, processResult.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        capabilityId: request.capabilityId,
        provider: this.id,
        status: "parser_error",
        warnings: parsed.warnings,
        errors: parsed.errors.length > 0 ? parsed.errors : [`Could not parse gog output for ${request.capabilityId}.`],
        audit: {
          ...commandAudit,
          parser: commandSpec.parser,
          parserStatus: parsed.parserStatus,
          status: "parser_error"
        }
      };
    }

    return {
      ok: true,
      capabilityId: request.capabilityId,
      provider: this.id,
      status: "completed",
      data: parsed.data as TResult,
      warnings: parsed.warnings,
      errors: [],
      audit: {
        ...commandAudit,
        parser: commandSpec.parser,
        parserStatus: parsed.parserStatus,
        status: "completed"
      }
    };
  }
}
