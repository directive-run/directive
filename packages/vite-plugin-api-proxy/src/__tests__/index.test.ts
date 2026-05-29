/**
 * Tests for `@directive-run/vite-plugin-api-proxy`.
 *
 * Focus: R6 SECURITY fixes — body cap (413), header allowlist (no
 * credentials forwarded), and req.setTimeout slowloris defense.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, REQUEST_TIMEOUT_MS, apiProxy } from "../index.js";

// ----------------------------------------------------------------------------
// Helpers — minimal Vite-like server harness
// ----------------------------------------------------------------------------

interface Middleware {
  (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next: (err?: unknown) => void,
  ): void;
}

interface FakeServer {
  middlewares: {
    use: (path: string, fn: Middleware) => void;
    handlers: Array<{ path: string; fn: Middleware }>;
  };
}

function createFakeServer(): FakeServer {
  const handlers: Array<{ path: string; fn: Middleware }> = [];

  return {
    middlewares: {
      use(path: string, fn: Middleware) {
        handlers.push({ path, fn });
      },
      handlers,
    },
  };
}

/** Start an HTTP server that wraps the registered middleware. */
function startMiddlewareServer(
  handlers: Array<{ path: string; fn: Middleware }>,
) {
  const server = http.createServer((req, res) => {
    const match = handlers.find((h) => req.url?.startsWith(h.path));
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    match.fn(req, res, () => {
      if (!res.headersSent) {
        res.statusCode = 404;
        res.end();
      }
    });
  });

  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

/** Start an upstream HTTP server with a configurable handler. */
function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function postRaw(
  port: number,
  path: string,
  body: Buffer | string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: {
      status: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const fail = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          finish({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    // EPIPE / ECONNRESET happen when the server closes mid-stream after
    // sending the response (e.g. 413 path destroying the socket). If the
    // server already sent a response object, settle via the response
    // handler above; otherwise propagate the error.
    req.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPIPE" || code === "ECONNRESET") {
        // Allow the response handler a tick to fire; if it doesn't, swallow.
        setTimeout(() => {
          if (!settled) {
            finish({ status: 0, headers: {}, body: "" });
          }
        }, 50);
        return;
      }
      fail(err);
    });
    req.write(body, (err) => {
      // Ignore EPIPE on write — the server may have already responded + closed.
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EPIPE" && code !== "ECONNRESET") {
          fail(err);
        }
      }
    });
    req.end();
  });
}

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

let upstreamPort = 0;
let upstreamServer: http.Server;

/** Configurable upstream response per test. */
let upstreamHandler: (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void = (_req, res) => {
  res.statusCode = 200;
  res.end("{}");
};

beforeAll(async () => {
  const started = await startUpstream((req, res) => upstreamHandler(req, res));
  upstreamServer = started.server;
  upstreamPort = started.port;
});

afterAll(async () => {
  await closeServer(upstreamServer);
});

const proxyServers: http.Server[] = [];

afterEach(async () => {
  while (proxyServers.length > 0) {
    const s = proxyServers.pop();
    if (s) {
      await closeServer(s);
    }
  }
});

async function makeProxy(extraRoute?: {
  headers?: Record<string, string>;
}): Promise<number> {
  const plugin = apiProxy({
    routes: {
      "/api/proxy": {
        target: `http://127.0.0.1:${upstreamPort}/upstream`,
        method: "POST",
        headers: extraRoute?.headers,
      },
    },
  });

  const fake = createFakeServer();
  // The plugin's configureServer takes a Vite-like ServerContext;
  // we only need `middlewares.use`, which our fake provides.
  // biome-ignore lint/suspicious/noExplicitAny: minimal duck-typed server
  (plugin as any).configureServer(fake);

  const { server, port } = await startMiddlewareServer(
    fake.middlewares.handlers,
  );
  proxyServers.push(server);
  return port;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("apiProxy — security", () => {
  it("returns 413 when request body exceeds MAX_BODY_BYTES", async () => {
    upstreamHandler = (_req, res) => {
      res.statusCode = 200;
      res.end("{}");
    };

    const port = await makeProxy();
    // 11 MB > 10 MB cap
    const oversized = Buffer.alloc(MAX_BODY_BYTES + 1024 * 1024, "a");

    const result = await postRaw(port, "/api/proxy", oversized);
    expect(result.status).toBe(413);
    expect(result.body).toContain("Payload too large");
  }, 20_000);

  it("does NOT forward sensitive upstream headers to the client", async () => {
    upstreamHandler = (_req, res) => {
      res.setHeader("set-cookie", "session=abc123");
      res.setHeader("authorization", "Bearer secret");
      res.setHeader("x-api-key", "sk-1234");
      res.setHeader("x-internal-trace", "leak-me");
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end('{"ok":true}');
    };

    const port = await makeProxy();
    const result = await postRaw(port, "/api/proxy", "{}");

    expect(result.status).toBe(200);
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers.authorization).toBeUndefined();
    expect(result.headers["x-api-key"]).toBeUndefined();
    expect(result.headers["x-internal-trace"]).toBeUndefined();
  });

  it("forwards allowlisted upstream headers (content-type, cache-control)", async () => {
    upstreamHandler = (_req, res) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("etag", '"v1"');
      res.statusCode = 200;
      res.end('{"ok":true}');
    };

    const port = await makeProxy();
    const result = await postRaw(port, "/api/proxy", "{}");

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers.etag).toBe('"v1"');
  });

  it("configures req.setTimeout for slowloris defense", async () => {
    upstreamHandler = (_req, res) => {
      res.statusCode = 200;
      res.end("{}");
    };

    // Spy on setTimeout by inspecting the incoming request inside the middleware.
    // Simpler: send a normal request and assert the constant is what we expect.
    // The constant is the live value used inside the plugin.
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);

    // End-to-end check that setTimeout is actually applied: we patch
    // http.IncomingMessage.prototype.setTimeout for the duration of the test
    // to record the value passed by the middleware.
    const captured: number[] = [];
    const original = http.IncomingMessage.prototype.setTimeout;
    http.IncomingMessage.prototype.setTimeout = function (
      msecs: number,
      callback?: () => void,
    ): http.IncomingMessage {
      captured.push(msecs);
      return original.call(this, msecs, callback) as http.IncomingMessage;
    };

    try {
      const port = await makeProxy();
      await postRaw(port, "/api/proxy", "{}");
      expect(captured).toContain(REQUEST_TIMEOUT_MS);
    } finally {
      http.IncomingMessage.prototype.setTimeout = original;
    }
  });
});
