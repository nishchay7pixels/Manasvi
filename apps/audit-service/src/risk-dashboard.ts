import { riskSummarySchema, type AuditEvent, type RiskSummary } from "@manasvi/contracts";

function countBy<T extends string>(values: T[]): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function buildRiskSummary(events: AuditEvent[], windowStart: string, windowEnd: string): RiskSummary {
  const from = Date.parse(windowStart);
  const to = Date.parse(windowEnd);
  const scoped = events.filter((event) => {
    const ts = Date.parse(event.timestamp);
    return ts >= from && ts <= to;
  });
  const deniedPrincipals = scoped
    .filter((event) => event.decisionOutcome === "deny")
    .map((event) => event.actor?.principalId ?? event.caller?.principalId)
    .filter((value): value is string => Boolean(value));
  const deniedResources = scoped
    .filter((event) => event.decisionOutcome === "deny")
    .map((event) => event.resource?.resourceId)
    .filter((value): value is string => Boolean(value));
  return riskSummarySchema.parse({
    windowStart,
    windowEnd,
    totalEvents: scoped.length,
    policyDenials: scoped.filter((event) => event.eventType === "policy.decision.deny").length,
    approvalDenials: scoped.filter((event) => event.eventType === "approval.denied").length,
    executionFailures: scoped.filter((event) =>
      ["execution.failed", "execution.timeout", "execution.quota_exceeded"].includes(event.eventType)
    ).length,
    pluginCapabilityDenials: scoped.filter((event) => event.eventType === "plugin.capability_denied").length,
    nodeQuarantineEvents: scoped.filter((event) => event.eventType === "node.quarantined").length,
    authFailures: scoped.filter((event) =>
      ["ingress.auth.failed", "identity.token.invalid", "identity.token.expired"].includes(event.eventType)
    ).length,
    anomaliesDetected: scoped.filter((event) => event.eventType.startsWith("anomaly.")).length,
    highSeverityEvents: scoped.filter((event) => event.severity === "high").length,
    criticalSeverityEvents: scoped.filter((event) => event.severity === "critical").length,
    topDeniedPrincipals: countBy(deniedPrincipals)
      .slice(0, 5)
      .map((item) => ({ principalId: item.key, count: item.count })),
    topDeniedResources: countBy(deniedResources)
      .slice(0, 5)
      .map((item) => ({ resourceId: item.key, count: item.count }))
  });
}

