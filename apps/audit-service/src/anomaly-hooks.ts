import { randomUUID } from "node:crypto";

import { anomalySignalSchema, type AnomalySignal, type AuditEvent } from "@manasvi/contracts";

export interface AnomalyDetectorContext {
  recentEvents: AuditEvent[];
}

export interface AnomalyDetector {
  readonly name: string;
  readonly enabled: boolean;
  evaluate(event: AuditEvent, context: AnomalyDetectorContext): AnomalySignal[];
}

function createSignal(input: Omit<AnomalySignal, "signalId">): AnomalySignal {
  return anomalySignalSchema.parse({
    signalId: `anomaly:${randomUUID()}`,
    ...input
  });
}

export class AnomalyHookEngine {
  private readonly detectors: AnomalyDetector[] = [];
  private readonly signals: AnomalySignal[] = [];

  register(detector: AnomalyDetector): void {
    this.detectors.push(detector);
  }

  evaluate(event: AuditEvent, recentEvents: AuditEvent[]): AnomalySignal[] {
    if (event.eventType.startsWith("anomaly.")) {
      return [];
    }
    const context: AnomalyDetectorContext = { recentEvents };
    const produced = this.detectors
      .filter((detector) => detector.enabled)
      .flatMap((detector) => detector.evaluate(event, context));
    this.signals.push(...produced);
    return produced;
  }

  listSignals(): AnomalySignal[] {
    return [...this.signals].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
  }
}

const WINDOW_MS = 5 * 60 * 1000;

export function createDefaultAnomalyDetectors(): AnomalyDetector[] {
  return [
    {
      name: "repeated-auth-failure",
      enabled: true,
      evaluate(event, context) {
        if (!["ingress.auth.failed", "identity.token.invalid", "identity.token.expired"].includes(event.eventType)) {
          return [];
        }
        const now = Date.parse(event.timestamp);
        const failures = context.recentEvents.filter((candidate) => {
          if (!["ingress.auth.failed", "identity.token.invalid", "identity.token.expired"].includes(candidate.eventType)) {
            return false;
          }
          return Date.parse(candidate.timestamp) >= now - WINDOW_MS;
        });
        if (failures.length < 3) {
          return [];
        }
        return [
          createSignal({
            eventType: "anomaly.repeated_auth_failure",
            traceId: event.traceId,
            detectedAt: event.timestamp,
            description: `Repeated auth failures detected (${failures.length} in 5m)`,
            severity: "high",
            affectedPrincipalId: event.actor?.principalId ?? event.caller?.principalId,
            triggeringAuditIds: failures.map((item) => item.auditId),
            context: { detector: "repeated-auth-failure", windowMs: WINDOW_MS, count: failures.length }
          })
        ];
      }
    },
    {
      name: "policy-denial-spike",
      enabled: true,
      evaluate(event, context) {
        if (event.eventType !== "policy.decision.deny") {
          return [];
        }
        const now = Date.parse(event.timestamp);
        const denials = context.recentEvents.filter((candidate) => {
          if (candidate.eventType !== "policy.decision.deny") return false;
          return Date.parse(candidate.timestamp) >= now - WINDOW_MS;
        });
        if (denials.length < 5) {
          return [];
        }
        return [
          createSignal({
            eventType: "anomaly.policy_denial_spike",
            traceId: event.traceId,
            detectedAt: event.timestamp,
            description: `Policy denial spike detected (${denials.length} in 5m)`,
            severity: "high",
            affectedPrincipalId: event.actor?.principalId ?? event.caller?.principalId,
            triggeringAuditIds: denials.map((item) => item.auditId),
            context: { detector: "policy-denial-spike", windowMs: WINDOW_MS, count: denials.length }
          })
        ];
      }
    },
    {
      name: "repeated-execution-failure",
      enabled: true,
      evaluate(event, context) {
        if (!["execution.failed", "execution.timeout", "execution.quota_exceeded"].includes(event.eventType)) {
          return [];
        }
        const now = Date.parse(event.timestamp);
        const failures = context.recentEvents.filter((candidate) => {
          if (!["execution.failed", "execution.timeout", "execution.quota_exceeded"].includes(candidate.eventType)) {
            return false;
          }
          if (candidate.toolId !== event.toolId) return false;
          return Date.parse(candidate.timestamp) >= now - WINDOW_MS;
        });
        if (failures.length < 3) {
          return [];
        }
        return [
          createSignal({
            eventType: "anomaly.repeated_execution_failure",
            traceId: event.traceId,
            detectedAt: event.timestamp,
            description: `Repeated execution failures for tool ${event.toolId ?? "unknown"}`,
            severity: "high",
            affectedResourceId: event.toolId,
            triggeringAuditIds: failures.map((item) => item.auditId),
            context: { detector: "repeated-execution-failure", windowMs: WINDOW_MS, count: failures.length }
          })
        ];
      }
    },
    {
      name: "approval-bypass-attempt",
      enabled: true,
      evaluate(event) {
        const hasBypass = event.reasonCodes.some((reason) => reason.toLowerCase().includes("bypass"));
        if (!hasBypass) {
          return [];
        }
        return [
          createSignal({
            eventType: "anomaly.approval_bypass_attempt",
            traceId: event.traceId,
            detectedAt: event.timestamp,
            description: "Approval bypass attempt reason code detected",
            severity: "critical",
            affectedPrincipalId: event.actor?.principalId ?? event.caller?.principalId,
            affectedResourceId: event.resource?.resourceId,
            triggeringAuditIds: [event.auditId],
            context: { detector: "approval-bypass-attempt", reasonCodes: event.reasonCodes }
          })
        ];
      }
    }
  ];
}

