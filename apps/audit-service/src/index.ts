import { randomUUID } from "node:crypto";

import { auditEventSchema, auditQuerySchema, type AuditEvent } from "@manasvi/contracts";
import { readJsonBody, respondJson, startHttpService } from "@manasvi/service-runtime";

import { AnomalyHookEngine, createDefaultAnomalyDetectors } from "./anomaly-hooks.js";
import { loadAuditServiceConfig } from "./config.js";
import { AuditEventStore } from "./event-store.js";

function toQueryObject(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "limit" || key === "offset") {
      out[key] = Number(value);
      continue;
    }
    if (key === "includeRedacted") {
      out[key] = value === "true";
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function main(): Promise<void> {
  const config = await loadAuditServiceConfig();
  const anomalyEngine = new AnomalyHookEngine();
  for (const detector of createDefaultAnomalyDetectors()) {
    anomalyEngine.register(detector);
  }
  const store = new AuditEventStore({
    appendOnlyMode: config.appendOnlyMode,
    storageFilePath: config.storageFilePath,
    ...(config.auditIntegrityKey ? { integrityKey: config.auditIntegrityKey } : {}),
    anomalyEngine
  });

  await startHttpService({
    config,
    serviceName: "audit-service",
    serviceVersion: config.serviceVersion,
    readinessChecks: [{ name: "audit_writer_initialized", check: async () => ({ ok: true }) }],
    handleRequest: async ({ req, res, trace, logger }) => {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && req.url === "/") {
        respondJson(res, 200, {
          schemaVersion: "1.0.0",
          service: config.serviceName,
          plane: "observability",
          trace
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/audit/events") {
        const body = (await readJsonBody(req)) as { event?: AuditEvent } | AuditEvent;
        const event = auditEventSchema.parse("event" in body ? body.event : body);
        const result = store.append(event);
        logger.info("Audit event appended", {
          auditId: result.event.auditId,
          eventType: result.event.eventType,
          sequenceNumber: result.event.integrity?.sequenceNumber,
          traceId: result.event.traceId
        });
        respondJson(res, 201, {
          schemaVersion: "1.0",
          accepted: true
        });
        return true;
      }
      if (req.method === "POST" && req.url === "/audit/events/batch") {
        const body = (await readJsonBody(req)) as { events: AuditEvent[] };
        const events = (body.events ?? []).map((event) => auditEventSchema.parse(event));
        const results = store.appendBatch(events);
        respondJson(res, 201, {
          schemaVersion: "1.0",
          accepted: true,
          appended: results.length,
          auditIds: results.map((result) => result.event.auditId)
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/events") {
        const query = auditQuerySchema.parse(toQueryObject(requestUrl));
        const events = store.query(query);
        respondJson(res, 200, {
          schemaVersion: "1.0",
          events,
          count: events.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/timeline") {
        const query = auditQuerySchema.parse(toQueryObject(requestUrl));
        const timeline = store.timeline(query);
        respondJson(res, 200, {
          schemaVersion: "1.0",
          timeline,
          count: timeline.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname.startsWith("/audit/trace/")) {
        const traceId = requestUrl.pathname.slice("/audit/trace/".length);
        const result = store.trace(traceId);
        if (!result) {
          respondJson(res, 404, {
            schemaVersion: "1.0",
            error: "TRACE_NOT_FOUND"
          });
          return true;
        }
        respondJson(res, 200, {
          schemaVersion: "1.0",
          trace: result
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/decisions") {
        const records = store.listDecisionRecords();
        respondJson(res, 200, {
          schemaVersion: "1.0",
          records,
          count: records.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/approvals") {
        const records = store.listApprovalRecords();
        respondJson(res, 200, {
          schemaVersion: "1.0",
          records,
          count: records.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/executions") {
        const records = store.listExecutionRecords();
        respondJson(res, 200, {
          schemaVersion: "1.0",
          records,
          count: records.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/risk/summary") {
        const now = Date.now();
        const end = requestUrl.searchParams.get("toTimestamp") ?? new Date(now).toISOString();
        const start =
          requestUrl.searchParams.get("fromTimestamp") ??
          new Date(now - config.defaultRiskWindowMinutes * 60_000).toISOString();
        const summary = store.riskSummary(start, end);
        respondJson(res, 200, {
          schemaVersion: "1.0",
          summary
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/anomalies") {
        const signals = store.anomalySignals();
        respondJson(res, 200, {
          schemaVersion: "1.0",
          signals,
          count: signals.length
        });
        return true;
      }
      if (req.method === "GET" && requestUrl.pathname === "/audit/integrity/verify") {
        const issues = store.verifyIntegrity();
        respondJson(res, 200, {
          schemaVersion: "1.0",
          ok: issues.length === 0,
          issues
        });
        return true;
      }
      if (req.method === "POST" && requestUrl.pathname === "/audit/system/missing-telemetry") {
        const event = auditEventSchema.parse({
          schemaVersion: "1.0",
          contractVersion: "1.0.0",
          auditId: `audit:${randomUUID()}`,
          eventType: "audit.event.append_failed",
          timestamp: new Date().toISOString(),
          producingService: "audit-service",
          traceId: trace.traceId,
          correlationId: trace.correlationId,
          severity: "warn",
          redaction: {
            applied: false,
            redactedFields: []
          },
          reasonCodes: ["MISSING_OBSERVABILITY_DATA"],
          payload: await readJsonBody(req)
        });
        store.append(event);
        respondJson(res, 202, {
          schemaVersion: "1.0",
          accepted: true
        });
        return true;
      }
      return false;
    }
  });
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "audit-service",
      message: "Service bootstrap failed",
      error: error instanceof Error ? error.message : "unknown"
    })
  );
  process.exit(1);
});
