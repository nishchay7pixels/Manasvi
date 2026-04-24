import { timelineItemSchema, type AuditEvent, type TimelineItem } from "@manasvi/contracts";

const SUMMARY_BY_EVENT: Partial<Record<AuditEvent["eventType"], string>> = {
  "ingress.message.received": "Inbound message received",
  "identity.principal.resolved": "Principal resolved",
  "session.resolved": "Session resolved",
  "session.context.assembled": "Context assembled",
  "policy.decision.allow": "Policy decision: allow",
  "policy.decision.deny": "Policy decision: deny",
  "policy.decision.require_approval": "Policy decision: approval required",
  "approval.requested": "Approval requested",
  "approval.granted": "Approval granted",
  "approval.denied": "Approval denied",
  "execution.started": "Execution started",
  "execution.completed": "Execution completed",
  "execution.failed": "Execution failed",
  "memory.written": "Memory write completed",
  "memory.promoted": "Memory promoted",
  "node.dispatched": "Node dispatch issued",
  "node.dispatch_completed": "Node dispatch completed",
  "tool.invoked": "Tool invocation started",
  "tool.completed": "Tool invocation completed",
  "tool.failed": "Tool invocation failed"
};

function summarize(event: AuditEvent): string {
  const base = SUMMARY_BY_EVENT[event.eventType] ?? event.eventType;
  if (event.reasonCodes.length === 0) {
    return base;
  }
  return `${base} (${event.reasonCodes.join(",")})`;
}

export function buildTimeline(events: AuditEvent[]): TimelineItem[] {
  return events
    .slice()
    .sort((a, b) => {
      const seqA = a.integrity?.sequenceNumber ?? 0;
      const seqB = b.integrity?.sequenceNumber ?? 0;
      if (seqA !== seqB) return seqA - seqB;
      return Date.parse(a.timestamp) - Date.parse(b.timestamp);
    })
    .map((event) =>
      timelineItemSchema.parse({
        auditId: event.auditId,
        sequenceNumber: event.integrity?.sequenceNumber ?? 0,
        timestamp: event.timestamp,
        eventType: event.eventType,
        service: event.producingService,
        summary: summarize(event),
        severity: event.severity,
        ...(event.decisionOutcome ? { decisionOutcome: event.decisionOutcome } : {}),
        traceId: event.traceId,
        correlationId: event.correlationId,
        ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        ...(event.intentId ? { intentId: event.intentId } : {}),
        ...(event.actor ? { actor: event.actor } : {}),
        redacted: event.redaction.applied
      })
    );
}

