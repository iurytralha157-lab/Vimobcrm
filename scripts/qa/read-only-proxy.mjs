#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

export const PROXY_KIND = Object.freeze({
  API: "api",
  SUPABASE: "supabase",
});

const LOOPBACK_HOST = "127.0.0.1";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const KNOWN_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "CONNECT",
  "TRACE",
]);
const AUTH_TOKEN_PATH = "/auth/v1/token";
const AUTH_TOKEN_GRANTS = new Set(["password", "refresh_token"]);
const BLOCKED_AUDIT_REASONS = new Set([
  "malformed_url",
  "websocket_upgrade_blocked",
  "auth_token_path_mismatch",
  "auth_grant_not_allowed",
  "method_not_allowed",
  "origin_not_allowed",
]);
const LIFECYCLE_EVENTS = new Set([
  "started",
  "upstream_response_blocked",
  "upstream_request_failed",
  "request_body_blocked",
  "startup_failed",
]);
const LIFECYCLE_AUDIT_REASONS = new Set([
  "cross_origin_redirect",
  "connection_or_timeout",
  "body_too_large",
  "invalid_configuration_or_listener_error",
]);
const MAX_AUTH_BODY_BYTES = 64 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function normalizeMethod(method) {
  return String(method || "GET").toUpperCase();
}

function auditMethod(method) {
  const normalized = normalizeMethod(method);
  return KNOWN_METHODS.has(normalized) ? normalized : "OTHER";
}

function parseRequestUrl(requestUrl) {
  return new URL(String(requestUrl || "/"), "http://qa-proxy.invalid");
}

function authGrantIsAllowed(url) {
  const grantValues = url.searchParams.getAll("grant_type");
  const queryKeys = [...url.searchParams.keys()];

  return (
    grantValues.length === 1 &&
    queryKeys.length === 1 &&
    queryKeys[0] === "grant_type" &&
    AUTH_TOKEN_GRANTS.has(grantValues[0])
  );
}

function auditRoute(proxy, pathname) {
  if (proxy === PROXY_KIND.SUPABASE && pathname === AUTH_TOKEN_PATH) {
    return "supabase_auth_token";
  }

  return "redacted";
}

/**
 * Pure fail-closed policy used both by the server and its unit tests.
 * Raw URLs are deliberately absent from the returned decision so they cannot
 * accidentally enter the security audit log.
 */
export function evaluateProxyRequest({ proxy, method, requestUrl, isUpgrade = false }) {
  if (proxy !== PROXY_KIND.API && proxy !== PROXY_KIND.SUPABASE) {
    throw new TypeError("Unknown proxy kind");
  }

  const normalizedMethod = normalizeMethod(method);
  let url;

  try {
    url = parseRequestUrl(requestUrl);
  } catch {
    return Object.freeze({
      allowed: false,
      reason: "malformed_url",
      auditRoute: "redacted",
    });
  }

  const route = auditRoute(proxy, url.pathname);

  if (isUpgrade) {
    return Object.freeze({
      allowed: false,
      reason: "websocket_upgrade_blocked",
      auditRoute: route,
    });
  }

  if (READ_METHODS.has(normalizedMethod)) {
    return Object.freeze({ allowed: true, reason: "read_allowed", auditRoute: route });
  }

  if (proxy === PROXY_KIND.SUPABASE && normalizedMethod === "POST") {
    if (url.pathname !== AUTH_TOKEN_PATH) {
      return Object.freeze({
        allowed: false,
        reason: "auth_token_path_mismatch",
        auditRoute: route,
      });
    }

    if (!authGrantIsAllowed(url)) {
      return Object.freeze({
        allowed: false,
        reason: "auth_grant_not_allowed",
        auditRoute: route,
      });
    }

    return Object.freeze({
      allowed: true,
      reason: "auth_token_exchange_allowed",
      auditRoute: route,
    });
  }

  return Object.freeze({
    allowed: false,
    reason: "method_not_allowed",
    auditRoute: route,
  });
}

function normalizeLocalOrigin(rawOrigin) {
  const origin = new URL(rawOrigin);
  const hostname = origin.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

  if (origin.protocol !== "http:" || !isLoopback || origin.username || origin.password) {
    throw new Error(`QA browser origin must be an HTTP loopback origin: ${rawOrigin}`);
  }

  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(`QA browser origin must not contain a path, query, or fragment: ${rawOrigin}`);
  }

  return origin.origin;
}

export function normalizeAllowedOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new Error("At least one --web-origin is required");
  }

  return Object.freeze([...new Set(origins.map(normalizeLocalOrigin))]);
}

export function browserOriginIsAllowed(origin, allowedOrigins) {
  if (!origin) return true;

  try {
    return allowedOrigins.includes(new URL(origin).origin) && new URL(origin).origin === origin;
  } catch {
    return false;
  }
}

function normalizeUpstreamTarget(rawTarget, label) {
  const target = new URL(rawTarget);

  if (target.protocol !== "https:") {
    throw new Error(`${label} target must use HTTPS`);
  }

  if (target.username || target.password) {
    throw new Error(`${label} target must not contain credentials`);
  }

  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error(`${label} target must be an origin without path, query, or fragment`);
  }

  return target;
}

function parsePort(rawPort, label) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

function safeEventMethod(method) {
  return auditMethod(method);
}

function safeEventProxy(proxy) {
  return proxy === PROXY_KIND.API || proxy === PROXY_KIND.SUPABASE ? proxy : "unknown";
}

function safeBlockedReason(reason) {
  return BLOCKED_AUDIT_REASONS.has(reason) ? reason : "policy_blocked";
}

/** Fixed-schema event: no request URL, query, headers, body, or token values. */
export function createBlockedRequestAuditEvent({
  proxy,
  method,
  decision,
}) {
  return Object.freeze({
    timestamp: new Date().toISOString(),
    event: "blocked_request",
    proxy: safeEventProxy(proxy),
    method: safeEventMethod(method),
    route: decision.auditRoute === "supabase_auth_token" ? "supabase_auth_token" : "redacted",
    reason: safeBlockedReason(decision.reason),
  });
}

export function serializeAuditEvent(event) {
  const parsedTimestamp = new Date(event?.timestamp || "");
  const timestamp = Number.isNaN(parsedTimestamp.getTime())
    ? new Date().toISOString()
    : parsedTimestamp.toISOString();

  if (event?.event === "blocked_request") {
    const safeEvent = {
      timestamp,
      event: "blocked_request",
      proxy: safeEventProxy(event.proxy),
      method: safeEventMethod(event.method),
      route: event.route === "supabase_auth_token" ? "supabase_auth_token" : "redacted",
      reason: safeBlockedReason(event.reason),
    };
    return `${JSON.stringify(safeEvent)}\n`;
  }

  const safeEvent = {
    timestamp,
    event: LIFECYCLE_EVENTS.has(event?.event) ? event.event : "internal_event",
    proxy:
      event?.proxy === "harness" ? "harness" : safeEventProxy(event?.proxy),
  };

  if (Number.isInteger(event?.port) && event.port >= 1 && event.port <= 65_535) {
    safeEvent.port = event.port;
  }
  if (event?.reason) {
    safeEvent.reason = LIFECYCLE_AUDIT_REASONS.has(event.reason)
      ? event.reason
      : "internal_failure";
  }

  return `${JSON.stringify(safeEvent)}\n`;
}

function createLifecycleAuditEvent({ event, proxy, port, reason }) {
  const auditEvent = {
    timestamp: new Date().toISOString(),
    event,
    proxy,
  };

  if (Number.isInteger(port)) auditEvent.port = port;
  if (reason) auditEvent.reason = reason;

  return Object.freeze(auditEvent);
}

function filterRequestHeaders(headers) {
  const filtered = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "host" || HOP_BY_HOP_HEADERS.has(normalizedName)) continue;
    if (value !== undefined) filtered[name] = value;
  }
  return filtered;
}

function copyResponseHeaders(upstreamHeaders, response) {
  for (const [name, value] of Object.entries(upstreamHeaders)) {
    const normalizedName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || normalizedName.startsWith("access-control-")) {
      continue;
    }
    if (value !== undefined) response.setHeader(name, value);
  }
}

function corsMethods(proxy, requestUrl) {
  if (proxy === PROXY_KIND.SUPABASE) {
    const decision = evaluateProxyRequest({
      proxy,
      method: "POST",
      requestUrl,
    });
    if (decision.allowed) return "GET, HEAD, OPTIONS, POST";
  }

  return "GET, HEAD, OPTIONS";
}

function applyCorsHeaders({ request, response, allowedOrigins, proxy }) {
  const origin = request.headers.origin;
  if (!origin || !browserOriginIsAllowed(origin, allowedOrigins)) return;

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("access-control-allow-methods", corsMethods(proxy, request.url));
  response.setHeader("access-control-expose-headers", "content-range, range, x-supabase-api-version");
  response.setHeader("vary", "Origin");

  const requestedHeaders = request.headers["access-control-request-headers"];
  if (requestedHeaders) {
    response.setHeader("access-control-allow-headers", requestedHeaders);
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

async function readBoundedBody(request, maxBytes) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume();
    throw new Error("request_body_too_large");
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error("request_body_too_large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function rewriteSameOriginLocation({ location, upstreamOrigin, localPort }) {
  if (!location) return { allowed: true, location: null };

  let resolved;
  try {
    resolved = new URL(location, upstreamOrigin);
  } catch {
    return { allowed: false, location: null };
  }

  if (resolved.origin !== upstreamOrigin) {
    return { allowed: false, location: null };
  }

  return {
    allowed: true,
    location: `http://${LOOPBACK_HOST}:${localPort}${resolved.pathname}${resolved.search}${resolved.hash}`,
  };
}

function proxyUpstream({
  request,
  response,
  requestBody,
  proxy,
  target,
  localPort,
  allowedOrigins,
  upstreamTimeoutMs,
  writeAuditEvent,
}) {
  const requestUrl = parseRequestUrl(request.url);
  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, target.origin);
  const headers = filterRequestHeaders(request.headers);

  if (requestBody) {
    headers["content-length"] = String(requestBody.length);
  }

  const upstreamRequest = https.request(
    upstreamUrl,
    {
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      const redirect = rewriteSameOriginLocation({
        location: upstreamResponse.headers.location,
        upstreamOrigin: target.origin,
        localPort,
      });

      if (!redirect.allowed) {
        upstreamResponse.resume();
        writeAuditEvent(
          createLifecycleAuditEvent({
            event: "upstream_response_blocked",
            proxy,
            reason: "cross_origin_redirect",
          }),
        );
        applyCorsHeaders({ request, response, allowedOrigins, proxy });
        sendJson(response, 502, { error: "Cross-origin upstream redirect blocked by QA proxy" });
        return;
      }

      response.statusCode = upstreamResponse.statusCode || 502;
      copyResponseHeaders(upstreamResponse.headers, response);
      if (redirect.location) response.setHeader("location", redirect.location);
      applyCorsHeaders({ request, response, allowedOrigins, proxy });
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
    upstreamRequest.destroy(new Error("upstream_timeout"));
  });

  upstreamRequest.on("error", () => {
    writeAuditEvent(
      createLifecycleAuditEvent({
        event: "upstream_request_failed",
        proxy,
        reason: "connection_or_timeout",
      }),
    );

    if (!response.headersSent) {
      applyCorsHeaders({ request, response, allowedOrigins, proxy });
      sendJson(response, 502, { error: "Upstream request failed" });
    } else {
      response.destroy();
    }
  });

  if (requestBody) upstreamRequest.end(requestBody);
  else upstreamRequest.end();
}

export function createReadOnlyProxyServer({
  proxy,
  target,
  localPort,
  allowedOrigins,
  upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  writeAuditEvent,
}) {
  const server = http.createServer(async (request, response) => {
    const decision = evaluateProxyRequest({
      proxy,
      method: request.method,
      requestUrl: request.url,
    });

    if (!browserOriginIsAllowed(request.headers.origin, allowedOrigins)) {
      request.resume();
      writeAuditEvent(
        createBlockedRequestAuditEvent({
          proxy,
          method: request.method,
          decision: {
            allowed: false,
            reason: "origin_not_allowed",
            auditRoute: decision.auditRoute,
          },
        }),
      );
      sendJson(response, 403, { error: "Browser origin is not allowed" });
      return;
    }

    if (!decision.allowed) {
      request.resume();
      writeAuditEvent(
        createBlockedRequestAuditEvent({
          proxy,
          method: request.method,
          decision,
        }),
      );
      applyCorsHeaders({ request, response, allowedOrigins, proxy });
      response.setHeader("allow", corsMethods(proxy, request.url));
      sendJson(response, 405, { error: "Request blocked by read-only QA policy" });
      return;
    }

    if (normalizeMethod(request.method) === "OPTIONS") {
      request.resume();
      applyCorsHeaders({ request, response, allowedOrigins, proxy });
      response.statusCode = 204;
      response.end();
      return;
    }

    let requestBody;
    if (normalizeMethod(request.method) === "POST") {
      try {
        requestBody = await readBoundedBody(request, MAX_AUTH_BODY_BYTES);
      } catch {
        writeAuditEvent(
          createLifecycleAuditEvent({
            event: "request_body_blocked",
            proxy,
            reason: "body_too_large",
          }),
        );
        applyCorsHeaders({ request, response, allowedOrigins, proxy });
        sendJson(response, 413, { error: "Auth request body exceeds QA proxy limit" });
        return;
      }
    }

    proxyUpstream({
      request,
      response,
      requestBody,
      proxy,
      target,
      localPort,
      allowedOrigins,
      upstreamTimeoutMs,
      writeAuditEvent,
    });
  });

  server.on("upgrade", (request, socket) => {
    const decision = evaluateProxyRequest({
      proxy,
      method: request.method,
      requestUrl: request.url,
      isUpgrade: true,
    });
    writeAuditEvent(
      createBlockedRequestAuditEvent({
        proxy,
        method: request.method,
        decision,
      }),
    );
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
  });

  return server;
}

function usage() {
  return `Usage:
  node scripts/qa/read-only-proxy.mjs \\
    --api-target https://api.example.invalid \\
    --supabase-target https://project-ref.supabase.co \\
    --web-origin http://localhost:3000 \\
    --acknowledge-upstream-read-risk

Options:
  --api-target URL                    Required HTTPS Vimob API origin
  --supabase-target URL               Required HTTPS Supabase origin
  --web-origin URL                    Allowed HTTP loopback origin; repeatable
  --api-port PORT                     Loopback API proxy port (default: 8081)
  --supabase-port PORT                Loopback Supabase proxy port (default: 8082)
  --log-file PATH                     Optional NDJSON audit log
  --acknowledge-upstream-read-risk    Required explicit safety acknowledgement
  --help                              Show this help without starting servers
`;
}

export function parseCommandLine(argv) {
  const options = {
    apiPort: 8081,
    supabasePort: 8082,
    webOrigins: [],
    acknowledgeUpstreamReadRisk: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      index += 1;
      return value;
    };

    switch (argument) {
      case "--api-target":
        options.apiTarget = nextValue();
        break;
      case "--supabase-target":
        options.supabaseTarget = nextValue();
        break;
      case "--web-origin":
        options.webOrigins.push(nextValue());
        break;
      case "--api-port":
        options.apiPort = nextValue();
        break;
      case "--supabase-port":
        options.supabasePort = nextValue();
        break;
      case "--log-file":
        options.logFile = nextValue();
        break;
      case "--acknowledge-upstream-read-risk":
        options.acknowledgeUpstreamReadRisk = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function buildRuntimeConfig(options) {
  if (!options.acknowledgeUpstreamReadRisk) {
    throw new Error("Refusing to start without --acknowledge-upstream-read-risk");
  }
  if (!options.apiTarget || !options.supabaseTarget) {
    throw new Error("Both --api-target and --supabase-target are required");
  }

  const apiPort = parsePort(options.apiPort, "API port");
  const supabasePort = parsePort(options.supabasePort, "Supabase port");
  if (apiPort === supabasePort) throw new Error("API and Supabase proxy ports must differ");

  return Object.freeze({
    apiTarget: normalizeUpstreamTarget(options.apiTarget, "API"),
    supabaseTarget: normalizeUpstreamTarget(options.supabaseTarget, "Supabase"),
    apiPort,
    supabasePort,
    allowedOrigins: normalizeAllowedOrigins(options.webOrigins),
    logFile: options.logFile,
  });
}

function createAuditWriter(logFile) {
  if (!logFile) {
    return {
      write(event) {
        process.stderr.write(serializeAuditEvent(event));
      },
      close() {},
    };
  }

  const stream = createWriteStream(logFile, { flags: "a", encoding: "utf8", mode: 0o600 });
  return {
    write(event) {
      stream.write(serializeAuditEvent(event));
    },
    close() {
      stream.end();
    },
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

export async function startHarness(config) {
  const auditWriter = createAuditWriter(config.logFile);
  const writeAuditEvent = (event) => auditWriter.write(event);
  const apiServer = createReadOnlyProxyServer({
    proxy: PROXY_KIND.API,
    target: config.apiTarget,
    localPort: config.apiPort,
    allowedOrigins: config.allowedOrigins,
    writeAuditEvent,
  });
  const supabaseServer = createReadOnlyProxyServer({
    proxy: PROXY_KIND.SUPABASE,
    target: config.supabaseTarget,
    localPort: config.supabasePort,
    allowedOrigins: config.allowedOrigins,
    writeAuditEvent,
  });

  try {
    await listen(apiServer, config.apiPort);
    writeAuditEvent(
      createLifecycleAuditEvent({ event: "started", proxy: PROXY_KIND.API, port: config.apiPort }),
    );
    await listen(supabaseServer, config.supabasePort);
    writeAuditEvent(
      createLifecycleAuditEvent({
        event: "started",
        proxy: PROXY_KIND.SUPABASE,
        port: config.supabasePort,
      }),
    );
  } catch (error) {
    await Promise.all([closeServer(apiServer), closeServer(supabaseServer)]);
    auditWriter.close();
    throw error;
  }

  return {
    async close() {
      await Promise.all([closeServer(apiServer), closeServer(supabaseServer)]);
      auditWriter.close();
    },
  };
}

async function main() {
  const options = parseCommandLine(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const config = buildRuntimeConfig(options);
  const harness = await startHarness(config);
  let closing = false;

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await harness.close();
    process.exitCode = 0;
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch(() => {
    process.stderr.write(
      serializeAuditEvent(
        createLifecycleAuditEvent({
          event: "startup_failed",
          proxy: "harness",
          reason: "invalid_configuration_or_listener_error",
        }),
      ),
    );
    process.exitCode = 1;
  });
}
