/**
 * SSE (Server-Sent Events) transport for the Directive knowledge MCP
 * server. Hosts the server over HTTP so remote MCP clients
 * (production AI agents, the docs site, third-party tools) can query
 * it at retrieval time — borrowed pattern from zustand's
 * `docs.pmnd.rs/api/sse`.
 *
 * One SSE connection per client. Each connection gets its own
 * MCP server instance so per-session state (subscriptions, list
 * cursors) stays isolated.
 *
 * Endpoints:
 *
 * - `GET /sse` — establish the SSE stream. Server sends a session
 *   ID and the client connects `/messages?sessionId=…` for the
 *   POST half of the channel.
 * - `POST /messages?sessionId=…` — client→server JSON-RPC messages.
 * - `GET /healthz` — liveness probe returning 200 + `ok`.
 */

import { type IncomingMessage, type Server, createServer } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createDirectiveServer, setServerInfo } from "./server.js";

const MESSAGES_PATH = "/messages";
const SSE_PATH = "/sse";
const HEALTHZ_PATH = "/healthz";

export interface SseServerOptions {
  /** Port to listen on. Default: 3000. */
  port?: number;
  /** Host to bind to. Default: `127.0.0.1`. Use `0.0.0.0` for public deployments. */
  host?: string;
  /** Optional logger. Default: `console`. */
  logger?: Pick<Console, "log" | "warn" | "error">;
}

interface ActiveSession {
  transport: SSEServerTransport;
}

type Sessions = Map<string, ActiveSession>;
type Logger = Pick<Console, "log" | "warn" | "error">;

async function handleSseConnect(
  res: import("node:http").ServerResponse,
  sessions: Sessions,
  logger: Logger,
): Promise<void> {
  const transport = new SSEServerTransport(MESSAGES_PATH, res);
  const server = createDirectiveServer();
  sessions.set(transport.sessionId, { transport });
  setServerInfo({
    transport: "sse",
    authEnabled: false,
    sessionCount: sessions.size,
  });

  const cleanup = () => {
    sessions.delete(transport.sessionId);
    setServerInfo({
      transport: "sse",
      authEnabled: false,
      sessionCount: sessions.size,
    });
  };
  res.on("close", cleanup);
  transport.onclose = cleanup;

  await server.connect(transport);
  logger.log(`[directive-mcp] sse session opened: ${transport.sessionId}`);
}

async function handlePostMessage(
  req: IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  sessions: Sessions,
): Promise<void> {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`unknown session: ${sessionId}`);
    return;
  }

  await session.transport.handlePostMessage(req, res);
}

async function routeRequest(
  req: IncomingMessage,
  res: import("node:http").ServerResponse,
  sessions: Sessions,
  logger: Logger,
  host: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

  if (req.method === "GET" && url.pathname === HEALTHZ_PATH) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && url.pathname === SSE_PATH) {
    await handleSseConnect(res, sessions, logger);
    return;
  }

  if (req.method === "POST" && url.pathname === MESSAGES_PATH) {
    await handlePostMessage(req, res, url, sessions);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

/**
 * Start an HTTP server that hosts the Directive knowledge MCP server
 * over SSE. Returns the underlying Node `http.Server` so callers can
 * `close()` it on shutdown.
 */
export async function startSseServer(
  options: SseServerOptions = {},
): Promise<Server> {
  const port = options.port ?? 3000;
  const host = options.host ?? "127.0.0.1";
  const logger = options.logger ?? console;

  const sessions: Sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, sessions, logger, host);
    } catch (err) {
      logger.error("[directive-mcp] request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end("internal server error");
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      logger.log(
        `[directive-mcp] sse server listening at http://${host}:${port}${SSE_PATH}`,
      );
      resolve();
    });
  });

  return httpServer;
}
