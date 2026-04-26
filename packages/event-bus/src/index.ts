import {
  attachEventIntegrity,
  parseCanonicalEvent,
  type CanonicalEventEnvelope,
  type EventType,
  verifyEventIntegrity
} from "@manasvi/contracts";

export type DeadLetterReasonCode =
  | "INVALID_SCHEMA"
  | "UNSUPPORTED_VERSION"
  | "INTEGRITY_FAILURE"
  | "MAX_RETRIES_EXCEEDED"
  | "HANDLER_TERMINAL_ERROR"
  | "UNKNOWN_EVENT_TYPE"
  | "DUPLICATE_EVENT";

export interface DeadLetterRecord {
  reasonCode: DeadLetterReasonCode;
  event: unknown;
  eventId?: string;
  eventType?: string;
  traceId?: string;
  correlationId?: string;
  attempts: number;
  errorMessage?: string;
  failedAt: string;
}

export interface DeadLetterStore {
  add(record: DeadLetterRecord): Promise<void>;
}

export class InMemoryDeadLetterStore implements DeadLetterStore {
  readonly records: DeadLetterRecord[] = [];
  async add(record: DeadLetterRecord): Promise<void> {
    this.records.push(record);
  }
}

export interface IdempotencyStore {
  hasSeen(event: CanonicalEventEnvelope): Promise<boolean>;
  markSeen(event: CanonicalEventEnvelope): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();
  async hasSeen(event: CanonicalEventEnvelope): Promise<boolean> {
    return this.seen.has(event.eventId) || this.seen.has(`${event.tenantId}:${event.idempotency.key}`);
  }
  async markSeen(event: CanonicalEventEnvelope): Promise<void> {
    this.seen.add(event.eventId);
    this.seen.add(`${event.tenantId}:${event.idempotency.key}`);
  }
}

export interface EventTransport {
  publish(event: CanonicalEventEnvelope): Promise<void>;
}

export class InMemoryTransport implements EventTransport {
  private readonly consumers = new Set<(event: CanonicalEventEnvelope) => Promise<void>>();

  async publish(event: CanonicalEventEnvelope): Promise<void> {
    await Promise.all(Array.from(this.consumers).map((consumer) => consumer(event)));
  }

  registerConsumer(consumer: (event: CanonicalEventEnvelope) => Promise<void>): void {
    this.consumers.add(consumer);
  }
}

export class HttpTransport implements EventTransport {
  constructor(
    private readonly options: {
      targetUrls: string[];
      timeoutMs?: number;
      headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
    }
  ) {}

  async publish(event: CanonicalEventEnvelope): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    try {
      const dynamicHeaders =
        typeof this.options.headers === "function"
          ? await this.options.headers()
          : (this.options.headers ?? {});
      await Promise.all(
        this.options.targetUrls.map(async (url) => {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...dynamicHeaders
            },
            body: JSON.stringify(event),
            signal: controller.signal
          });
          if (!response.ok) {
            throw new Error(`Publish failed to ${url} with status ${response.status}`);
          }
        })
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface EventPublisherOptions {
  transport: EventTransport;
  signing?: { keyId: string; secret: string };
}

export class EventPublisher {
  constructor(private readonly options: EventPublisherOptions) {}

  async publish(event: Omit<CanonicalEventEnvelope, "integrity"> | CanonicalEventEnvelope): Promise<void> {
    const baseEvent = ("integrity" in event ? (({ integrity: _integrity, ...rest }) => rest)(event) : event) as Omit<
      CanonicalEventEnvelope,
      "integrity"
    >;

    // HMAC integrity is only valid for service-origin events.
    const shouldSignAsService = Boolean(this.options.signing && baseEvent.source.sourceType === "service");
    const signed = shouldSignAsService
      ? attachEventIntegrity(baseEvent, this.options.signing)
      : attachEventIntegrity(baseEvent);

    const parsed = parseCanonicalEvent(signed);
    await this.options.transport.publish(parsed);
  }
}

export class RetryableError extends Error {}
export class TerminalHandlerError extends Error {}

export interface EventHandlerContext {
  attempt: number;
}

export type EventHandler<TType extends EventType> = (
  event: CanonicalEventEnvelope & { eventType: TType },
  context: EventHandlerContext
) => Promise<void>;

type HandlerEntry = {
  eventType: EventType;
  handler: EventHandler<EventType>;
};

export interface EventConsumerOptions {
  deadLetterStore: DeadLetterStore;
  idempotencyStore?: IdempotencyStore;
  maxAttempts?: number;
  requireSignedInternalEvents?: boolean;
  signingSecretsByKeyId?: Record<string, string>;
}

export type ConsumeOutcome = "acked" | "duplicate" | "dead-lettered";

export class EventConsumer {
  private readonly handlers: HandlerEntry[] = [];
  private readonly maxAttempts: number;
  private readonly idempotencyStore: IdempotencyStore;

  constructor(private readonly options: EventConsumerOptions) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  }

  subscribe<TType extends EventType>(eventType: TType, handler: EventHandler<TType>): void {
    this.handlers.push({ eventType, handler: handler as EventHandler<EventType> });
  }

  async consumeRaw(input: unknown): Promise<ConsumeOutcome> {
    let event: CanonicalEventEnvelope;
    try {
      event = parseCanonicalEvent(input);
    } catch (error) {
      await this.options.deadLetterStore.add({
        reasonCode: "INVALID_SCHEMA",
        event: input,
        attempts: 1,
        errorMessage: error instanceof Error ? error.message : "invalid schema",
        failedAt: new Date().toISOString()
      });
      return "dead-lettered";
    }

    const integrity = verifyEventIntegrity(event, {
      requiredForInternal: this.options.requireSignedInternalEvents ?? true,
      ...(this.options.signingSecretsByKeyId
        ? { signingSecretsByKeyId: this.options.signingSecretsByKeyId }
        : {})
    });
    if (!integrity.ok) {
      await this.options.deadLetterStore.add({
        reasonCode: "INTEGRITY_FAILURE",
        event,
        eventId: event.eventId,
        eventType: event.eventType,
        traceId: event.trace.traceId,
        correlationId: event.trace.correlationId,
        attempts: event.delivery.attempt,
        errorMessage: integrity.reason,
        failedAt: new Date().toISOString()
      });
      return "dead-lettered";
    }

    if (await this.idempotencyStore.hasSeen(event)) {
      return "duplicate";
    }

    const handlers = this.handlers.filter((entry) => entry.eventType === event.eventType);
    if (handlers.length === 0) {
      await this.options.deadLetterStore.add({
        reasonCode: "UNKNOWN_EVENT_TYPE",
        event,
        eventId: event.eventId,
        eventType: event.eventType,
        traceId: event.trace.traceId,
        correlationId: event.trace.correlationId,
        attempts: event.delivery.attempt,
        failedAt: new Date().toISOString()
      });
      return "dead-lettered";
    }

    for (const entry of handlers) {
      let attempt = event.delivery.attempt;
      while (attempt <= this.maxAttempts) {
        try {
          await entry.handler(
            {
              ...event,
              delivery: {
                ...event.delivery,
                attempt,
                lastAttemptAt: new Date().toISOString()
              }
            } as CanonicalEventEnvelope & { eventType: EventType },
            { attempt }
          );
          break;
        } catch (error) {
          const isRetryable = error instanceof RetryableError;
          if (!isRetryable || attempt >= this.maxAttempts) {
            await this.options.deadLetterStore.add({
              reasonCode: !isRetryable ? "HANDLER_TERMINAL_ERROR" : "MAX_RETRIES_EXCEEDED",
              event,
              eventId: event.eventId,
              eventType: event.eventType,
              traceId: event.trace.traceId,
              correlationId: event.trace.correlationId,
              attempts: attempt,
              errorMessage: error instanceof Error ? error.message : "handler failure",
              failedAt: new Date().toISOString()
            });
            return "dead-lettered";
          }
          attempt += 1;
        }
      }
    }

    await this.idempotencyStore.markSeen(event);
    return "acked";
  }
}

export function connectInMemory(
  transport: InMemoryTransport,
  consumer: EventConsumer
): void {
  transport.registerConsumer(async (event) => {
    await consumer.consumeRaw(event);
  });
}
