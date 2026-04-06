import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceContext {
  traceId: string;
  correlationId: string;
  parentTraceId?: string;
}

const TRACE_ID_HEADER = "x-trace-id";
const CORRELATION_ID_HEADER = "x-correlation-id";
const PARENT_TRACE_ID_HEADER = "x-parent-trace-id";

const store = new AsyncLocalStorage<TraceContext>();

export function generateTraceContext(partial?: Partial<TraceContext>): TraceContext {
  const parentTraceId = partial?.parentTraceId;
  return {
    traceId: partial?.traceId ?? randomUUID(),
    correlationId: partial?.correlationId ?? randomUUID(),
    ...(parentTraceId ? { parentTraceId } : {})
  };
}

export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>
): TraceContext {
  const readHeader = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };

  const traceId = readHeader(TRACE_ID_HEADER);
  const correlationId = readHeader(CORRELATION_ID_HEADER);
  const parentTraceId = readHeader(PARENT_TRACE_ID_HEADER);
  return generateTraceContext({
    ...(traceId ? { traceId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(parentTraceId ? { parentTraceId } : {})
  });
}

export function withTraceContext<T>(
  context: TraceContext,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return store.run(context, fn);
}

export function getTraceContext(): TraceContext {
  return store.getStore() ?? generateTraceContext();
}

export function injectTraceHeaders(context: TraceContext): Record<string, string> {
  return {
    [TRACE_ID_HEADER]: context.traceId,
    [CORRELATION_ID_HEADER]: context.correlationId,
    ...(context.parentTraceId ? { [PARENT_TRACE_ID_HEADER]: context.parentTraceId } : {})
  };
}

export function beginChildTrace(parent: TraceContext): TraceContext {
  return generateTraceContext({
    correlationId: parent.correlationId,
    parentTraceId: parent.traceId
  });
}
