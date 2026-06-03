/**
 * SSE (Server-Sent Events) transport for the Directive MCP server.
 * Hosts the server over HTTP so remote clients can call tools at
 * retrieval time.
 *
 * AE Security review (P0 #4) hardened the public-facing surface:
 *
 * - **Token auth** is REQUIRED when the bind host is not loopback.
 *   `Authorization: Bearer <token>` must match `--token <value>` (or
 *   the `DIRECTIVE_MCP_TOKEN` env var). Loopback hosts may run
 *   unauthenticated for local dev.
 * - **Body cap** at 1 MB on `/messages` POSTs (`Content-Length`
 *   pre-check + streaming guard). Anything larger gets 413.
 * - **Session cap** at 64 concurrent SSE connections. Past the cap
 *   the next SSE GET returns 429.
 * - **Idle timeout** at 5 minutes per session. Idle transports are
 *   pruned at a 30-second sweep.
 * - **Origin allowlist** via `--allow-origin` (repeatable). When set,
 *   requests with an `Origin` header not in the list are rejected.
 *
 * Endpoints:
 *
 * - `GET /sse` — establish the SSE stream. One session per client.
 * - `POST /messages?sessionId=…` — client→server JSON-RPC messages.
 * - `GET /healthz` — liveness probe returning 200 + `ok`.
 */

import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createDirectiveServer, setServerInfo } from "./server.js";

const MESSAGES_PATH = "/messages";
const SSE_PATH = "/sse";
const HEALTHZ_PATH = "/healthz";

const DEFAULT_BODY_LIMIT_BYTES = 1_000_000;
const DEFAULT_MAX_SESSIONS = 64;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_SWEEP_INTERVAL_MS = 30_000;

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "0:0:0:0:0:0:0:1",
]);

export interface SseServerOptions {
  /** Port to listen on. Default: 3000. */
  port?: number;
  /** Host to bind to. Default: `127.0.0.1`. Use `0.0.0.0` for public deployments. */
  host?: string;
  /** Optional logger. Default: `console`. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /**
   * Bearer token required on every request to /sse and /messages.
   * MANDATORY when host is not loopback; rejected if both omitted.
   */
  token?: string;
  /** Allowed values for the request `Origin` header. Empty/undefined = no check. */
  allowOrigins?: string[];
  /** Max bytes accepted on a single /messages POST. Default: 1 MB. */
  bodyLimitBytes?: number;
  /** Max concurrent SSE sessions. Default: 64. */
  maxSessions?: number;
  /** Idle-timeout pruning threshold. Default: 5 minutes. */
  idleTimeoutMs?: number;
}

interface ActiveSession {
  transport: SSEServerTransport;
  lastActivity: number;
}

type Sessions = Map<string, ActiveSession>;
type Logger = Pick<Console, "log" | "warn" | "error">;

interface ResolvedConfig {
  port: number;
  host: string;
  logger: Logger;
  token?: string;
  allowOrigins: string[];
  bodyLimitBytes: number;
  maxSessions: number;
  idleTimeoutMs: number;
}

class SseConfigError extends Error {}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function resolveConfig(options: SseServerOptions): ResolvedConfig {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  const logger = options.logger ?? console;
  const token = options.token ?? process.env.DIRECTIVE_MCP_TOKEN ?? undefined;

  if (!isLoopback(host) && !token) {
    throw new SseConfigError(
      "Public hosts require a token. Pass --token <value> or set DIRECTIVE_MCP_TOKEN, or bind to 127.0.0.1 for local dev.",
    );
  }

  return {
    port,
    host,
    logger,
    token,
    allowOrigins: options.allowOrigins ?? [],
    bodyLimitBytes: options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
  };
}

function checkAuth(
  req: IncomingMessage,
  expected: string | undefined,
): boolean {
  if (!expected) {
    return true;
  }
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return false;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() === expected;
}

function checkOrigin(req: IncomingMessage, allow: string[]): boolean {
  if (allow.length === 0) {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin !== "string") {
    return false;
  }
  return allow.includes(origin);
}

function reject(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "text/plain", ...headers });
  res.end(message);
}

function updateSetServerInfo(sessions: Sessions, authEnabled: boolean): void {
  setServerInfo({
    transport: "sse",
    authEnabled,
    sessionCount: sessions.size,
  });
}

async function handleSseConnect(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Sessions,
  config: ResolvedConfig,
): Promise<void> {
  if (!checkAuth(req, config.token)) {
    reject(res, 401, "unauthorized");
    return;
  }
  if (!checkOrigin(req, config.allowOrigins)) {
    reject(res, 403, "origin not allowed");
    return;
  }
  if (sessions.size >= config.maxSessions) {
    reject(res, 429, "session cap reached", { "Retry-After": "60" });
    return;
  }

  const transport = new SSEServerTransport(MESSAGES_PATH, res);
  const server = createDirectiveServer();
  sessions.set(transport.sessionId, {
    transport,
    lastActivity: Date.now(),
  });
  updateSetServerInfo(sessions, Boolean(config.token));

  const cleanup = () => {
    sessions.delete(transport.sessionId);
    updateSetServerInfo(sessions, Boolean(config.token));
  };
  res.on("close", cleanup);
  transport.onclose = cleanup;

  await server.connect(transport);
  config.logger.log(
    `[directive-mcp] sse session opened: ${transport.sessionId}`,
  );
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  sessions: Sessions,
  config: ResolvedConfig,
): Promise<void> {
  if (!checkAuth(req, config.token)) {
    reject(res, 401, "unauthorized");
    return;
  }
  if (!checkOrigin(req, config.allowOrigins)) {
    reject(res, 403, "origin not allowed");
    return;
  }

  const declaredLength = Number(req.headers["content-length"] ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > config.bodyLimitBytes
  ) {
    reject(res, 413, `body exceeds ${config.bodyLimitBytes} bytes`);
    return;
  }

  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    reject(res, 400, "missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    reject(res, 404, `unknown session: ${sessionId}`);
    return;
  }
  session.lastActivity = Date.now();

  let bytesSeen = 0;
  let overflowed = false;
  req.on("data", (chunk: Buffer | string) => {
    bytesSeen += Buffer.byteLength(chunk);
    if (bytesSeen > config.bodyLimitBytes && !overflowed) {
      overflowed = true;
      reject(res, 413, `body exceeds ${config.bodyLimitBytes} bytes`);
      req.destroy();
    }
  });

  if (overflowed) {
    return;
  }

  await session.transport.handlePostMessage(req, res);
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Sessions,
  config: ResolvedConfig,
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? config.host}`,
  );

  if (req.method === "GET" && url.pathname === HEALTHZ_PATH) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && url.pathname === SSE_PATH) {
    await handleSseConnect(req, res, sessions, config);
    return;
  }

  if (req.method === "POST" && url.pathname === MESSAGES_PATH) {
    await handlePostMessage(req, res, url, sessions, config);
    return;
  }

  reject(res, 404, "not found");
}

function startIdleSweep(
  sessions: Sessions,
  config: ResolvedConfig,
): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > config.idleTimeoutMs) {
        sessions.delete(id);
        session.transport.close().catch(() => undefined);
        updateSetServerInfo(sessions, Boolean(config.token));
        config.logger.log(`[directive-mcp] pruned idle session: ${id}`);
      }
    }
  }, IDLE_SWEEP_INTERVAL_MS).unref();
}

/**
 * Start an HTTP server that hosts the Directive MCP server over SSE.
 * Returns the underlying Node `http.Server` so callers can `close()`
 * it on shutdown. Throws `SseConfigError` when a non-loopback host
 * is configured without a token.
 */
export async function startSseServer(
  options: SseServerOptions = {},
): Promise<Server> {
  const config = resolveConfig(options);
  const sessions: Sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, sessions, config);
    } catch (err) {
      config.logger.error("[directive-mcp] request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end("internal server error");
    }
  });

  const sweeper = startIdleSweep(sessions, config);
  httpServer.on("close", () => {
    clearInterval(sweeper);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, config.host, () => {
      config.logger.log(
        `[directive-mcp] sse server listening at http://${config.host}:${config.port}${SSE_PATH}${
          config.token
            ? " (auth: bearer-token)"
            : " (auth: none, loopback only)"
        }`,
      );
      resolve();
    });
  });

  return httpServer;
}

export { SseConfigError };
