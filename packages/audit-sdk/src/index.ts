/**
 * @manasvi/audit-sdk
 *
 * Client SDK for Manasvi services to emit audit events to the Audit Service.
 *
 * Design:
 * - fire-and-forget by default: audit emission should never block the critical path
 * - buffered batching: events are buffered and flushed periodically or on threshold
 * - fail-open on emit errors: audit unavailability does not cause service failures
 * - fail events are themselves logged so missing observability is never silent
 *
 * Usage:
 *   const client = new AuditClient({ auditServiceUrl, serviceName });
 *   await client.emit({ eventType: "policy.decision.deny", ... });
 */

import { createLogger, type Logger } from "@manasvi/logging";
import {
  createAuditEvent,
  type AuditEvent,
  type AuditEventType,
  type AuditSeverity,
  type AuditResourceRef,
  type DecisionOutcome,
  type CreateAuditEventInput
} from "@manasvi/contracts";

export type { AuditEvent, AuditEventType, AuditSeverity, AuditResourceRef, DecisionOutcome, CreateAuditEventInput };
export { createAuditEvent };

// ─── Client options ───────────────────────────────────────────────────────────

export interface AuditClientOptions {
  auditServiceUrl: string;
  serviceName: AuditEvent["producingService"];
  /** Maximum number of events to buffer before forcing a flush. Default: 50 */
  bufferSize?: number;
  /** Flush interval in ms. Default: 2000 */
  flushIntervalMs?: number;
  /** Request timeout for audit service calls. Default: 3000 */
  timeoutMs?: number;
  logger?: Logger;
}

// ─── Audit client ─────────────────────────────────────────────────────────────

export class AuditClient {
  private readonly auditServiceUrl: string;
  private readonly serviceName: AuditEvent["producingService"];
  private readonly bufferSize: number;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AuditClientOptions) {
    this.auditServiceUrl = options.auditServiceUrl;
    this.serviceName = options.serviceName;
    this.bufferSize = options.bufferSize ?? 50;
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.logger = options.logger ?? createLogger({
      serviceName: options.serviceName,
      serviceVersion: "0.1.0",
      environment: "local",
      level: "warn",
      humanReadable: false
    });

    const flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, flushIntervalMs);
    // Don't block process exit on this timer
    this.flushTimer.unref?.();
  }

  // ── Emit API ─────────────────────────────────────────────────────────────────

  /**
   * Emit an audit event. Fire-and-forget: never throws.
   * If the buffer is full, triggers an immediate flush.
   */
  emit(input: CreateAuditEventInput): void {
    try {
      const event = createAuditEvent(input);
      this.buffer.push(event);
      if (this.buffer.length >= this.bufferSize) {
        void this.flush();
      }
    } catch (error) {
      this.logger.warn("Failed to create audit event", {
        eventType: input.eventType,
        error: error instanceof Error ? error.message : "unknown"
      });
    }
  }

  /**
   * Emit multiple events at once. Never throws.
   */
  emitBatch(inputs: CreateAuditEventInput[]): void {
    for (const input of inputs) {
      this.emit(input);
    }
  }

  /**
   * Flush buffered events to the audit service immediately.
   * Safe to call manually; also called on timer and buffer threshold.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(`${this.auditServiceUrl}/audit/events/batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn("Audit service returned error on batch flush", {
          status: response.status,
          batchSize: batch.length
        });
        // Re-buffer events on non-5xx failures (avoid re-buffering on 4xx — likely schema issues)
        if (response.status >= 500) {
          this.buffer.unshift(...batch);
        }
      }
    } catch (error) {
      this.logger.warn("Audit service unreachable — events lost", {
        batchSize: batch.length,
        error: error instanceof Error ? error.message : "unknown"
      });
      // Fail-open: events are lost but the service continues
      // This is intentional: audit unavailability must not block operations
    }
  }

  /**
   * Flush all buffered events and stop the background flush timer.
   * Call during graceful shutdown.
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

// ─── Convenience builder ──────────────────────────────────────────────────────

/**
 * Build a typed audit event emitter scoped to a specific trace context.
 * Useful for creating a per-request emitter with pre-filled trace fields.
 */
export function createScopedEmitter(
  client: AuditClient,
  defaults: Pick<CreateAuditEventInput, "producingService" | "traceId" | "correlationId"> &
    Partial<Pick<CreateAuditEventInput, "tenantId" | "workspaceId" | "sessionId" | "actor" | "caller">>
) {
  return {
    emit: (overrides: Omit<CreateAuditEventInput, "producingService" | "traceId" | "correlationId">): void => {
      client.emit({ ...defaults, ...overrides });
    }
  };
}
