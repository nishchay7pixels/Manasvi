import { auditQuerySchema, type AuditEvent, type AuditQuery } from "@manasvi/contracts";

function eventHasPrincipal(event: AuditEvent, principalId: string): boolean {
  return event.actor?.principalId === principalId || event.caller?.principalId === principalId;
}

function betweenTimestamps(event: AuditEvent, query: AuditQuery): boolean {
  const ts = Date.parse(event.timestamp);
  if (query.fromTimestamp && ts < Date.parse(query.fromTimestamp)) {
    return false;
  }
  if (query.toTimestamp && ts > Date.parse(query.toTimestamp)) {
    return false;
  }
  return true;
}

function matches(event: AuditEvent, query: AuditQuery): boolean {
  if (query.traceId && event.traceId !== query.traceId) return false;
  if (query.sessionId && event.sessionId !== query.sessionId) return false;
  if (query.intentId && event.intentId !== query.intentId) return false;
  if (query.approvalId && event.approvalId !== query.approvalId) return false;
  if (query.executionRunId && event.executionRunId !== query.executionRunId) return false;
  if (query.nodeId && event.nodeId !== query.nodeId) return false;
  if (query.pluginId && event.pluginId !== query.pluginId) return false;
  if (query.principalId && !eventHasPrincipal(event, query.principalId)) return false;
  if (query.resourceId && event.resource?.resourceId !== query.resourceId) return false;
  if (query.eventType && event.eventType !== query.eventType) return false;
  if (query.severity && event.severity !== query.severity) return false;
  if (query.producingService && event.producingService !== query.producingService) return false;
  if (!betweenTimestamps(event, query)) return false;
  if (!query.includeRedacted && event.redaction.applied) return false;
  return true;
}

export function queryAuditEvents(events: AuditEvent[], input: unknown): AuditEvent[] {
  const query = auditQuerySchema.parse(input);
  const filtered = events.filter((event) => matches(event, query));
  const ordered = filtered.sort((a, b) => {
    const seqA = a.integrity?.sequenceNumber ?? 0;
    const seqB = b.integrity?.sequenceNumber ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });
  return ordered.slice(query.offset, query.offset + query.limit);
}

