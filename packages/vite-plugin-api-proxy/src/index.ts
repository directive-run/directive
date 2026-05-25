import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import { type Plugin, loadEnv } from "vite";

export interface ProxyRoute {
  /** Upstream URL to forward requests to */
  target: string;
  /** HTTP method to accept (default: "POST") */
  method?: string;
  /** Extra headers forwarded upstream */
  headers?: Record<string, string>;
  /** Env var name for API key (loaded from .env via Vite loadEnv) */
  envKey?: string;
  /** Client request header that carries the API key */
  headerKey?: string;
  /** loadEnv prefix filter (default: derived from envKey) */
  envPrefix?: string;
}

export interface ApiProxyOptions {
  routes: Record<string, ProxyRoute>;
}

function deriveEnvPrefix(envKey: string): string {
  const idx = envKey.indexOf("_");
  return idx > 0 ? envKey.slice(0, idx) : envKey;
}

/** Hard cap on request body size to mitigate DoS. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Slowloris defense — abort idle requests after this many ms. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Headers safe to forward from upstream to the dev-server client.
 * Anything not in this allowlist (case-insensitive) is dropped,
 * including `set-cookie`, `authorization`, `x-api-key`, and any
 * `x-internal-*` header.
 */
export const RESPONSE_HEADER_ALLOWLIST = new Set<string>([
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "last-modified",
  "vary",
  "content-encoding",
  "content-language",
  "expires",
  "pragma",
]);

/** Sentinel returned by collectBody when the request body exceeds MAX_BODY_BYTES. */
class BodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds maximum size");
    this.name = "BodyTooLargeError";
  }
}

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        // Reject NOW so the caller can write the 413; resume + discard
        // remaining data so we don't keep buffering attacker bytes.
        reject(new BodyTooLargeError());
        // Drop further chunks on the floor instead of tearing down
        // the socket — tearing down kills the response before it's read.
        req.removeAllListeners("data");
        req.on("data", () => {
          // discard
        });

        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) {
        return;
      }
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", (err) => {
      if (aborted) {
        return;
      }
      reject(err);
    });
  });
}

export function apiProxy(options: ApiProxyOptions): Plugin {
  return {
    name: "api-proxy",
    configureServer(server) {
      for (const [path, route] of Object.entries(options.routes)) {
        const method = (route.method ?? "POST").toUpperCase();
        const url = new URL(route.target);
        const isHttps = url.protocol === "https:";
        const transport = isHttps ? https : http;

        // Resolve env-based API key once at server start
        let envApiKey: string | undefined;
        if (route.envKey) {
          const prefix = route.envPrefix ?? deriveEnvPrefix(route.envKey);
          const env = loadEnv("development", process.cwd(), prefix);
          envApiKey = env[route.envKey];
        }

        server.middlewares.use(
          path,
          (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== method) {
              res.statusCode = 405;
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            // Slowloris defense — abort idle connections
            req.setTimeout(REQUEST_TIMEOUT_MS, () => {
              if (!res.headersSent) {
                res.statusCode = 408;
                res.end(JSON.stringify({ error: "Request timeout" }));
              }
              req.destroy();
            });

            // API key: client header → env var → 401
            let apiKey: string | undefined;
            if (route.headerKey) {
              apiKey = req.headers[route.headerKey] as string | undefined;
            }
            if (!apiKey) apiKey = envApiKey;

            if (route.envKey && !apiKey) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: "No API key provided" }));
              return;
            }

            collectBody(req).then(
              (body) => {
                const reqHeaders: Record<string, string> = {
                  "content-type":
                    req.headers["content-type"] ?? "application/json",
                  ...route.headers,
                };

                // Inject API key as the headerKey on the upstream request
                if (apiKey && route.headerKey) {
                  reqHeaders[route.headerKey] = apiKey;
                }

                const proxyReq = transport.request(
                  {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    method,
                    headers: reqHeaders,
                  },
                  (proxyRes) => {
                    res.statusCode = proxyRes.statusCode ?? 500;
                    for (const [key, value] of Object.entries(
                      proxyRes.headers,
                    )) {
                      if (!value) {
                        continue;
                      }
                      const lower = key.toLowerCase();
                      // Explicit deny — never forward credentials or internal headers
                      if (
                        lower === "set-cookie" ||
                        lower === "authorization" ||
                        lower === "x-api-key" ||
                        lower.startsWith("x-internal-")
                      ) {
                        continue;
                      }
                      if (!RESPONSE_HEADER_ALLOWLIST.has(lower)) {
                        continue;
                      }
                      res.setHeader(key, value);
                    }
                    proxyRes.pipe(res);
                  },
                );

                proxyReq.on("error", (err) => {
                  if (!res.headersSent) {
                    res.statusCode = 502;
                    res.end(JSON.stringify({ error: err.message }));
                  }
                });

                proxyReq.write(body);
                proxyReq.end();
              },
              (err) => {
                if (res.headersSent) {
                  return;
                }
                if (err instanceof BodyTooLargeError) {
                  res.statusCode = 413;
                  res.end(JSON.stringify({ error: "Payload too large" }));

                  return;
                }
                res.statusCode = 400;
                res.end(
                  JSON.stringify({
                    error: err instanceof Error ? err.message : String(err),
                  }),
                );
              },
            );
          },
        );
      }
    },
  };
}
