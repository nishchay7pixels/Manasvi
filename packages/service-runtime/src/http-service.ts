import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  CONTRACT_SCHEMA_VERSION,
  type ErrorResponse,
  type HealthResponse,
  type ReadinessCheckResult,
  type ReadinessResponse,
  type ServiceMetadata
} from "@manasvi/contracts";
import { createLogger, type Logger } from "@manasvi/logging";
import {
  extractTraceContext,
  getTraceContext,
  withTraceContext,
  type TraceContext
} from "@manasvi/tracing";

import type { BaseServiceConfig } from "./config.js";

type MaybePromise<T> = T | Promise<T>;

export interface HttpRequestContext<TConfig extends BaseServiceConfig> {
  req: IncomingMessage;
  res: ServerResponse;
  config: TConfig;
  logger: Logger;
  trace: TraceContext;
}

export interface ReadinessCheck<TConfig extends BaseServiceConfig> {
  name: string;
  check: (ctx: { config: TConfig; logger: Logger }) => MaybePromise<{ ok: boolean; detail?: string }>;
}

export interface HttpServiceOptions<TConfig extends BaseServiceConfig> {
  config: TConfig;
  serviceName: TConfig["serviceName"];
  serviceVersion: string;
  handleRequest: (ctx: HttpRequestContext<TConfig>) => MaybePromise<boolean>;
  readinessChecks?: ReadinessCheck<TConfig>[];
}

export interface RunningService {
  close(): Promise<void>;
}

export async function startHttpService<TConfig extends BaseServiceConfig>(
  options: HttpServiceOptions<TConfig>
): Promise<RunningService> {
  const startedAt = new Date().toISOString();
  let bootstrapComplete = true;

  const logger = createLogger({
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
    environment: options.config.environment,
    level: options.config.logLevel,
    humanReadable: options.config.humanReadableLogs,
    getTraceContext
  });

  const metadata: ServiceMetadata = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
    environment: options.config.environment,
    startedAt
  };

  const server = createServer((req, res) => {
    const trace = extractTraceContext(req.headers);
    res.setHeader("x-trace-id", trace.traceId);
    res.setHeader("x-correlation-id", trace.correlationId);
    withTraceContext(trace, async () => {
      const requestLogger = logger.child({
        method: req.method,
        path: req.url,
        traceId: trace.traceId,
        correlationId: trace.correlationId
      });

      try {
        if (req.url === "/health" && req.method === "GET") {
          respondJson<HealthResponse>(
            res,
            200,
            {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              status: "ok",
              metadata,
              trace,
              timestamp: new Date().toISOString()
            }
          );
          return;
        }

        if (req.url === "/ready" && req.method === "GET") {
          const checks: ReadinessCheckResult[] = [];
          for (const check of options.readinessChecks ?? []) {
            const result = await check.check({ config: options.config, logger: requestLogger });
            checks.push({
              name: check.name,
              status: result.ok ? "ready" : "not_ready",
              ...(result.detail ? { detail: result.detail } : {})
            });
          }
          checks.push({
            name: "bootstrap_initialized",
            status: bootstrapComplete ? "ready" : "not_ready"
          });
          const allReady = checks.every((check) => check.status === "ready");
          respondJson<ReadinessResponse>(
            res,
            allReady ? 200 : 503,
            {
              schemaVersion: CONTRACT_SCHEMA_VERSION,
              status: allReady ? "ready" : "not_ready",
              metadata,
              checks,
              trace,
              timestamp: new Date().toISOString()
            }
          );
          return;
        }

        const handled = await options.handleRequest({
          req,
          res,
          config: options.config,
          logger: requestLogger,
          trace
        });

        if (!handled) {
          respondJson<ErrorResponse>(res, 404, {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            error: {
              code: "NOT_FOUND",
              message: "Route not found.",
              retryable: false
            },
            trace,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        requestLogger.error("Unhandled request error", {
          error: error instanceof Error ? error.message : "unknown"
        });
        respondJson<ErrorResponse>(res, 500, {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error.",
            retryable: true
          },
          trace,
          timestamp: new Date().toISOString()
        });
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.config.port, options.config.host, () => {
      logger.info("Service started", {
        host: options.config.host,
        port: options.config.port,
        environment: options.config.environment,
        serviceVersion: options.serviceVersion
      });
      resolve();
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    bootstrapComplete = false;
    logger.warn("Received shutdown signal", { signal });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    logger.info("Service shutdown complete");
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  return {
    async close(): Promise<void> {
      await shutdown("manual");
    }
  };
}

export function respondJson<T>(res: ServerResponse, statusCode: number, payload: T): void {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    throw new Error("Request body is empty.");
  }
  const payload = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(payload) as T;
}
