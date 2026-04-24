import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  auditEventSchema,
  type AuditApprovalRecord,
  type AuditEvent,
  type DecisionRecord,
  type ToolExecutionRecord
} from "@manasvi/contracts";

import { AnomalyHookEngine } from "./anomaly-hooks.js";
import { toApprovalRecord, toDecisionRecord, toToolExecutionRecord } from "./governance-records.js";
import { buildIntegrityMetadata, verifyAuditChain, type IntegrityIssue } from "./integrity.js";
import { queryAuditEvents } from "./query-engine.js";
import { applyAuditRedaction } from "./redaction.js";
import { buildRiskSummary } from "./risk-dashboard.js";
import { buildTimeline } from "./timeline.js";
import { exploreTrace } from "./trace-explorer.js";

export interface AuditEventStoreOptions {
  appendOnlyMode: boolean;
  storageFilePath?: string;
  integrityKey?: string;
  anomalyEngine: AnomalyHookEngine;
}

export interface AppendResult {
  event: AuditEvent;
  derivedDecisionRecord?: DecisionRecord;
  derivedApprovalRecord?: AuditApprovalRecord;
  derivedExecutionRecord?: ToolExecutionRecord;
}

export class AuditEventStore {
  private readonly appendOnlyMode: boolean;
  private readonly storageFilePath: string | undefined;
  private readonly integrityKey: string | undefined;
  private readonly anomalyEngine: AnomalyHookEngine;

  private readonly events: AuditEvent[] = [];
  private readonly decisionRecords: DecisionRecord[] = [];
  private readonly approvalRecords: AuditApprovalRecord[] = [];
  private readonly executionRecords: ToolExecutionRecord[] = [];

  constructor(options: AuditEventStoreOptions) {
    this.appendOnlyMode = options.appendOnlyMode;
    this.storageFilePath = options.storageFilePath;
    this.integrityKey = options.integrityKey;
    this.anomalyEngine = options.anomalyEngine;
    this.bootstrapFromDisk();
  }

  append(event: AuditEvent): AppendResult {
    const parsed = auditEventSchema.parse(event);
    const redacted = applyAuditRedaction(parsed);
    const sequenceNumber = this.events.length + 1;
    const previousEventHash = this.events[this.events.length - 1]?.integrity?.contentHash;
    const integrity = buildIntegrityMetadata({
      event: redacted,
      ...(previousEventHash ? { previousEventHash } : {}),
      sequenceNumber,
      ...(this.integrityKey ? { integrityKey: this.integrityKey } : {})
    });
    const stored = auditEventSchema.parse({
      ...redacted,
      integrity
    });
    this.events.push(stored);
    this.persistEvent(stored);

    const derivedDecisionRecord = toDecisionRecord(stored);
    if (derivedDecisionRecord) {
      this.decisionRecords.push(derivedDecisionRecord);
    }
    const derivedApprovalRecord = toApprovalRecord(stored);
    if (derivedApprovalRecord) {
      this.approvalRecords.push(derivedApprovalRecord);
    }
    const derivedExecutionRecord = toToolExecutionRecord(stored);
    if (derivedExecutionRecord) {
      this.executionRecords.push(derivedExecutionRecord);
    }

    const signals = this.anomalyEngine.evaluate(stored, this.events);
    if (signals.length > 0) {
      for (const signal of signals) {
        const anomalyEvent = auditEventSchema.parse({
          ...stored,
          auditId: `${stored.auditId}:anomaly:${signal.signalId}`,
          eventType: signal.eventType,
          severity: signal.severity,
          reasonCodes: [...stored.reasonCodes, signal.description],
          payload: {
            ...stored.payload,
            anomalySignal: signal
          }
        });
        const nestedSequence = this.events.length + 1;
        const nestedPrevious = this.events[this.events.length - 1]?.integrity?.contentHash;
        const nestedIntegrity = buildIntegrityMetadata({
          event: anomalyEvent,
          ...(nestedPrevious ? { previousEventHash: nestedPrevious } : {}),
          sequenceNumber: nestedSequence,
          ...(this.integrityKey ? { integrityKey: this.integrityKey } : {})
        });
        const storedAnomaly = auditEventSchema.parse({
          ...anomalyEvent,
          integrity: nestedIntegrity
        });
        this.events.push(storedAnomaly);
        this.persistEvent(storedAnomaly);
      }
    }

    return {
      event: stored,
      ...(derivedDecisionRecord ? { derivedDecisionRecord } : {}),
      ...(derivedApprovalRecord ? { derivedApprovalRecord } : {}),
      ...(derivedExecutionRecord ? { derivedExecutionRecord } : {})
    };
  }

  appendBatch(events: AuditEvent[]): AppendResult[] {
    return events.map((event) => this.append(event));
  }

  listEvents(): AuditEvent[] {
    return [...this.events];
  }

  query(input: unknown): AuditEvent[] {
    return queryAuditEvents(this.events, input);
  }

  timeline(input: unknown) {
    return buildTimeline(this.query(input));
  }

  trace(traceId: string) {
    return exploreTrace(this.events, traceId);
  }

  listDecisionRecords(): DecisionRecord[] {
    return [...this.decisionRecords];
  }

  listApprovalRecords(): AuditApprovalRecord[] {
    return [...this.approvalRecords];
  }

  listExecutionRecords(): ToolExecutionRecord[] {
    return [...this.executionRecords];
  }

  riskSummary(windowStart: string, windowEnd: string) {
    return buildRiskSummary(this.events, windowStart, windowEnd);
  }

  anomalySignals() {
    return this.anomalyEngine.listSignals();
  }

  verifyIntegrity(): IntegrityIssue[] {
    return verifyAuditChain(this.events, this.integrityKey);
  }

  private persistEvent(event: AuditEvent): void {
    if (!this.storageFilePath) {
      return;
    }
    mkdirSync(dirname(this.storageFilePath), { recursive: true });
    appendFileSync(this.storageFilePath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  }

  private bootstrapFromDisk(): void {
    if (!this.storageFilePath || !existsSync(this.storageFilePath)) {
      return;
    }
    const raw = readFileSync(this.storageFilePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = auditEventSchema.parse(JSON.parse(trimmed));
      this.events.push(event);
      const decision = toDecisionRecord(event);
      if (decision) this.decisionRecords.push(decision);
      const approval = toApprovalRecord(event);
      if (approval) this.approvalRecords.push(approval);
      const execution = toToolExecutionRecord(event);
      if (execution) this.executionRecords.push(execution);
    }
  }

  /**
   * Explicitly unsupported operation: prevents accidental mutation semantics.
   */
  replace(_auditId: string, _event: AuditEvent): never {
    if (!this.appendOnlyMode) {
      throw new Error("replace operation is disabled by design for governance consistency");
    }
    throw new Error("APPEND_ONLY_STREAM_VIOLATION");
  }
}
