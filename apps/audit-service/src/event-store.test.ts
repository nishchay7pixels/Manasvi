import assert from "node:assert/strict";
import test from "node:test";

import { createAuditEvent, type AuditEvent } from "@manasvi/contracts";

import { AnomalyHookEngine, createDefaultAnomalyDetectors } from "./anomaly-hooks.js";
import { AuditEventStore } from "./event-store.js";
import { verifyAuditChain } from "./integrity.js";

function createStore(): AuditEventStore {
  const anomalyEngine = new AnomalyHookEngine();
  for (const detector of createDefaultAnomalyDetectors()) {
    anomalyEngine.register(detector);
  }
  return new AuditEventStore({
    appendOnlyMode: true,
    anomalyEngine
  });
}

function baseEvent(
  input: Partial<Parameters<typeof createAuditEvent>[0]> & Pick<Parameters<typeof createAuditEvent>[0], "eventType">
): AuditEvent {
  return createAuditEvent({
    producingService: "orchestrator-service",
    traceId: "d0bcf2cc-5b5d-4798-83eb-5b2ff8ad8be4",
    correlationId: "58c1ea87-9cf6-4242-bcdc-84d8eef4d35d",
    severity: "info",
    payload: {},
    ...input
  });
}

test("audit event append success and append-only semantics", () => {
  const store = createStore();
  const appended = store.append(baseEvent({ eventType: "ingress.message.received" }));
  assert.equal(appended.event.integrity?.sequenceNumber, 1);
  assert.equal(store.listEvents().length, 1);
  assert.throws(() => store.replace(appended.event.auditId, appended.event), /APPEND_ONLY_STREAM_VIOLATION/);
});

test("policy decision, approval, and execution records are created", () => {
  const store = createStore();
  store.append(
    baseEvent({
      eventType: "policy.decision.deny",
      decisionOutcome: "deny",
      resource: { resourceClass: "tool", resourceId: "tool:http_fetch" },
      payload: { actionClass: "fetch", matchedPolicyId: "p-1", matchedRuleId: "r-1", riskLevel: "high", riskScore: 88 }
    })
  );
  store.append(
    baseEvent({
      eventType: "approval.granted",
      approvalId: "approval:1",
      intentId: "intent:1",
      decisionOutcome: "approved",
      payload: { payloadHash: "abc", approvedArtifactId: "artifact:1" }
    })
  );
  store.append(
    baseEvent({
      eventType: "execution.completed",
      executionRunId: "run:1",
      intentId: "intent:1",
      approvalId: "approval:1",
      toolId: "tool:http_fetch",
      payload: { sandboxMode: "restricted_remote", resultArtifactId: "result:1", durationMs: 120 }
    })
  );
  assert.equal(store.listDecisionRecords().length >= 2, true);
  assert.equal(store.listApprovalRecords().length, 1);
  assert.equal(store.listExecutionRecords().length, 1);
});

test("timeline reconstruction and trace explorer retain trace chain", () => {
  const store = createStore();
  const traceId = "70fe312d-f4e8-4f69-9492-a1b0f7d845f0";
  const correlationId = "9a66db1c-d8d0-42bb-a1ae-14f6622667f1";
  const events = [
    createAuditEvent({
      eventType: "ingress.message.received",
      producingService: "ingress-service",
      traceId,
      correlationId,
      severity: "info",
      sessionId: "session:1",
      payload: {}
    }),
    createAuditEvent({
      eventType: "policy.decision.allow",
      producingService: "policy-service",
      traceId,
      correlationId,
      severity: "info",
      decisionOutcome: "allow",
      sessionId: "session:1",
      intentId: "intent:1",
      payload: {}
    }),
    createAuditEvent({
      eventType: "execution.completed",
      producingService: "execution-manager",
      traceId,
      correlationId,
      severity: "info",
      sessionId: "session:1",
      intentId: "intent:1",
      executionRunId: "run:1",
      toolId: "tool:http_fetch",
      payload: { sandboxMode: "restricted_remote" }
    })
  ];
  store.appendBatch(events);
  const timeline = store.timeline({ traceId, sessionId: "session:1", includeRedacted: true, limit: 20, offset: 0 });
  assert.equal(timeline.length >= 3, true);
  const trace = store.trace(traceId);
  assert.ok(trace);
  assert.equal(trace?.services.includes("ingress-service"), true);
  assert.equal(trace?.services.includes("policy-service"), true);
  assert.equal(trace?.services.includes("execution-manager"), true);
});

test("redaction masks sensitive fields", () => {
  const store = createStore();
  const appended = store.append(
    baseEvent({
      eventType: "tool.invoked",
      payload: {
        authorization: "Bearer top-secret-token",
        nested: { apiKey: "secret-key-value" },
        safe: "visible"
      }
    })
  );
  assert.equal(appended.event.redaction.applied, true);
  assert.equal(String(appended.event.payload.authorization).startsWith("[REDACTED:"), true);
  assert.equal(
    String((appended.event.payload.nested as { apiKey: string }).apiKey).startsWith("[REDACTED:"),
    true
  );
  assert.equal(appended.event.payload.safe, "visible");
});

test("integrity chain tamper detection works", () => {
  const store = createStore();
  store.append(baseEvent({ eventType: "ingress.message.received" }));
  store.append(baseEvent({ eventType: "session.resolved" }));
  const events = store.listEvents();
  const tampered = events.map((event) => ({ ...event }));
  tampered[1] = {
    ...tampered[1]!,
    payload: { tampered: true },
    integrity: {
      ...tampered[1]!.integrity!,
      contentHash: "f".repeat(64)
    }
  };
  const issues = verifyAuditChain(tampered);
  assert.equal(issues.length > 0, true);
});

test("anomaly hook trigger path records anomalies", () => {
  const store = createStore();
  for (let i = 0; i < 3; i += 1) {
    store.append(
      baseEvent({
        eventType: "ingress.auth.failed",
        severity: "warn",
        actor: { principalId: "user:alice", principalType: "human_user" },
        payload: { reason: "bad_signature" }
      })
    );
  }
  const signals = store.anomalySignals();
  assert.equal(signals.length >= 1, true);
  assert.equal(signals.some((signal) => signal.eventType === "anomaly.repeated_auth_failure"), true);
});

test("operator queryability across ingress->policy->approval->execution->memory->node", () => {
  const store = createStore();
  const traceId = "eb7002db-b87a-4d95-b9cf-427f6fb5ea1b";
  const correlationId = "d50af3e8-fdf8-4881-95da-b93c7ec877b8";
  const chain: AuditEvent[] = [
    createAuditEvent({
      eventType: "ingress.message.received",
      producingService: "ingress-service",
      traceId,
      correlationId,
      severity: "info",
      sessionId: "session:chain",
      payload: {}
    }),
    createAuditEvent({
      eventType: "policy.decision.require_approval",
      producingService: "policy-service",
      traceId,
      correlationId,
      severity: "warn",
      decisionOutcome: "require_approval",
      intentId: "intent:chain",
      payload: { actionClass: "execute" }
    }),
    createAuditEvent({
      eventType: "approval.granted",
      producingService: "approval-service",
      traceId,
      correlationId,
      severity: "info",
      decisionOutcome: "approved",
      approvalId: "approval:chain",
      intentId: "intent:chain",
      payload: { payloadHash: "h1" }
    }),
    createAuditEvent({
      eventType: "execution.completed",
      producingService: "execution-manager",
      traceId,
      correlationId,
      severity: "info",
      executionRunId: "run:chain",
      intentId: "intent:chain",
      approvalId: "approval:chain",
      toolId: "tool:http_fetch",
      payload: { sandboxMode: "restricted_remote", resultArtifactId: "result:chain" }
    }),
    createAuditEvent({
      eventType: "memory.promoted",
      producingService: "memory-service",
      traceId,
      correlationId,
      severity: "warn",
      intentId: "intent:chain",
      payload: { sourceClass: "untrusted_external", targetClass: "user_memory" }
    }),
    createAuditEvent({
      eventType: "node.dispatched",
      producingService: "node-manager",
      traceId,
      correlationId,
      severity: "info",
      nodeId: "node:restricted-1",
      intentId: "intent:chain",
      payload: {}
    })
  ];
  store.appendBatch(chain);
  const queried = store.query({
    traceId,
    includeRedacted: true,
    limit: 50,
    offset: 0
  });
  assert.equal(queried.length >= 6, true);
  const timeline = store.timeline({
    traceId,
    includeRedacted: true,
    limit: 50,
    offset: 0
  });
  assert.equal(timeline.some((item) => item.summary.includes("Approval granted")), true);
  const decisions = store.listDecisionRecords();
  assert.equal(decisions.some((record) => record.decisionType === "policy"), true);
});
