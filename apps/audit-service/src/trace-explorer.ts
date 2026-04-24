import { traceSpanSchema, type AuditEvent, type TraceSpan } from "@manasvi/contracts";

export interface TraceExplorerResult {
  traceId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  services: string[];
  spans: TraceSpan[];
  events: AuditEvent[];
  missingSpanIds: string[];
}

function buildSpanFromEvent(event: AuditEvent): TraceSpan {
  return traceSpanSchema.parse({
    spanId: event.spanId ?? `span:${event.auditId}`,
    traceId: event.traceId,
    service: event.producingService,
    operation: event.eventType,
    startedAt: event.timestamp,
    endedAt: event.timestamp,
    durationMs: 0,
    status: event.severity === "critical" ? "error" : "ok",
    linkedAuditIds: [event.auditId],
    attributes: {
      eventType: event.eventType
    }
  });
}

export function exploreTrace(events: AuditEvent[], traceId: string): TraceExplorerResult | undefined {
  const traceEvents = events
    .filter((event) => event.traceId === traceId)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (traceEvents.length === 0) {
    return undefined;
  }
  const spansById = new Map<string, TraceSpan>();
  for (const event of traceEvents) {
    const span = buildSpanFromEvent(event);
    const existing = spansById.get(span.spanId);
    if (!existing) {
      spansById.set(span.spanId, span);
      continue;
    }
    const linkedAuditIds = [...new Set([...existing.linkedAuditIds, event.auditId])];
    spansById.set(
      span.spanId,
      traceSpanSchema.parse({
        ...existing,
        linkedAuditIds,
        endedAt: event.timestamp,
        durationMs: Math.max(0, Date.parse(event.timestamp) - Date.parse(existing.startedAt))
      })
    );
  }
  const startedAt = traceEvents[0]!.timestamp;
  const endedAt = traceEvents[traceEvents.length - 1]!.timestamp;
  const services = [...new Set(traceEvents.map((event) => event.producingService))];
  const missingSpanIds = traceEvents
    .filter((event) => event.spanId && !spansById.has(event.spanId))
    .map((event) => event.spanId!)
    .filter((value, index, all) => all.indexOf(value) === index);
  return {
    traceId,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    services,
    spans: [...spansById.values()],
    events: traceEvents,
    missingSpanIds
  };
}

