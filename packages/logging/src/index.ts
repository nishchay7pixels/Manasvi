import type { EnvironmentProfile, ServiceName } from "@manasvi/contracts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export interface LoggerOptions {
  serviceName: ServiceName;
  serviceVersion: string;
  environment: EnvironmentProfile;
  level?: LogLevel;
  humanReadable?: boolean;
  redactPaths?: string[];
  getTraceContext?: () => {
    traceId: string;
    correlationId: string;
    parentTraceId?: string;
  };
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(defaultFields: LogFields): Logger;
}

function redactObject(
  source: unknown,
  redactPaths: Set<string>,
  parentPath = ""
): unknown {
  if (source === null || source === undefined) {
    return source;
  }
  if (typeof source !== "object") {
    return source;
  }
  if (Array.isArray(source)) {
    return source.map((item, index) =>
      redactObject(item, redactPaths, `${parentPath}[${index}]`)
    );
  }

  const target: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const path = parentPath ? `${parentPath}.${key}` : key;
    if (redactPaths.has(path) || /secret|token|password|key/i.test(key)) {
      target[key] = "[REDACTED]";
      continue;
    }
    target[key] = redactObject(value, redactPaths, path);
  }
  return target;
}

export function createLogger(options: LoggerOptions, defaultFields: LogFields = {}): Logger {
  const minLevel = options.level ?? "info";
  const redactPaths = new Set(options.redactPaths ?? []);
  const humanReadable = options.humanReadable ?? false;

  const log = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (levelOrder[level] < levelOrder[minLevel]) {
      return;
    }
    const traceContext = options.getTraceContext?.();
    const payload = redactObject(
      {
        timestamp: new Date().toISOString(),
        level,
        service: options.serviceName,
        version: options.serviceVersion,
        environment: options.environment,
        traceId: traceContext?.traceId,
        correlationId: traceContext?.correlationId,
        parentTraceId: traceContext?.parentTraceId,
        message,
        ...defaultFields,
        ...fields
      },
      redactPaths
    );

    if (humanReadable) {
      const { timestamp, ...rest } = payload as Record<string, unknown>;
      console.log(`[${timestamp}] [${level}] ${message}`, rest);
      return;
    }
    console.log(JSON.stringify(payload));
  };

  return {
    debug(message, fields) {
      log("debug", message, fields);
    },
    info(message, fields) {
      log("info", message, fields);
    },
    warn(message, fields) {
      log("warn", message, fields);
    },
    error(message, fields) {
      log("error", message, fields);
    },
    child(childDefaults) {
      return createLogger(options, { ...defaultFields, ...childDefaults });
    }
  };
}
