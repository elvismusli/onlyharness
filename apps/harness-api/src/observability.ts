import { randomUUID } from "node:crypto";

import type { FastifyError, FastifyInstance, FastifyRequest, FastifyServerOptions } from "fastify";

export const TRUSTED_PROXY_RANGES = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "::1",
  "fd00::/8"
] as const;

export const LOG_REDACTION_PATHS = [
  "authorization",
  "cookie",
  "body",
  "query",
  "email",
  "password",
  "payer",
  "token",
  "proof",
  "binding",
  "access_token",
  "refresh_token",
  "device_proof",
  "browser_proof",
  "browser_url",
  "verification_uri",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.authorization",
  "*.cookie",
  "*.body",
  "*.query",
  "*.email",
  "*.password",
  "*.payer",
  "*.token",
  "*.proof",
  "*.binding",
  "*.access_token",
  "*.refresh_token",
  "*.device_proof",
  "*.browser_proof",
  "*.browser_url",
  "*.verification_uri"
] as const;

type ApiServerOptionsInput = {
  environment?: string;
  logLevel?: string;
  release?: string;
  stream?: { write(message: string): void };
};

export function apiServerOptions(input: ApiServerOptionsInput = {}): FastifyServerOptions {
  const environment = safeLabel(input.environment ?? process.env.NODE_ENV, "development");
  const release = safeLabel(input.release ?? process.env.SUPERSKILL_RELEASE, "development");
  const stream = input.stream;
  return {
    disableRequestLogging: true,
    genReqId: () => randomUUID(),
    logger: {
      level: safeLogLevel(input.logLevel ?? process.env.HARNESS_LOG_LEVEL),
      base: { service: "superskill-api", environment, release },
      redact: { paths: [...LOG_REDACTION_PATHS], censor: "[REDACTED]" },
      serializers: {
        req: serializeRequest,
        res: (reply) => ({ status_code: reply.statusCode }),
        err: serializeError
      },
      ...(stream ? { stream } : {})
    },
    requestIdHeader: false,
    requestIdLogLabel: "request_id",
    trustProxy: [...TRUSTED_PROXY_RANGES]
  };
}

export function registerApiObservability(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("X-Request-ID", request.id);
    request.log.info({
      event: "http_request_started",
      http: { method: request.method, route: safeRoute(request) }
    }, "HTTP request started");
    done();
  });

  app.addHook("onError", (request, reply, error, done) => {
    request.log.error({
      event: "http_request_failed",
      error_code: safeErrorCode(error),
      err: error,
      http: requestSummary(request, reply.statusCode, reply.elapsedTime)
    }, "HTTP request failed");
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const statusCode = reply.statusCode;
    const fields = {
      event: "http_request_completed",
      http: requestSummary(request, statusCode, reply.elapsedTime)
    };
    if (statusCode >= 500) request.log.error(fields, "HTTP request completed");
    else if (statusCode >= 400) request.log.warn(fields, "HTTP request completed");
    else request.log.info(fields, "HTTP request completed");
    done();
  });
}

function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    route: safeRoute(request)
  };
}

function serializeError(error: FastifyError) {
  const message = redactSensitiveText(error.message || "Internal error");
  const stack = redactSensitiveText(error.stack || `${error.name || "Error"}: ${message}`);
  return {
    type: safeLabel(error.name, "Error"),
    message,
    stack,
    code: safeErrorCode(error)
  };
}

function requestSummary(request: FastifyRequest, statusCode: number, elapsedTime: number) {
  return {
    method: request.method,
    route: safeRoute(request),
    status_code: statusCode,
    duration_ms: Number(elapsedTime.toFixed(2))
  };
}

function safeRoute(request: FastifyRequest): string {
  const route = request.routeOptions?.url;
  return typeof route === "string" && route.startsWith("/") && route.length <= 256
    ? route.split("?", 1)[0]
    : "unmatched";
}

function safeLogLevel(value: string | undefined): string {
  return value && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(value)
    ? value
    : "info";
}

function safeErrorCode(error: { code?: unknown }): string {
  return typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)
    ? error.code
    : "UNHANDLED_ERROR";
}

function safeLabel(value: string | undefined, fallback: string): string {
  return value && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : fallback;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\boh[a-z]{2,8}_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/([?&](?:proof|token|code|request|request_id|provider_ref|subject|q)=)[^&#\s]+/gi, "$1[REDACTED]");
}
