import { loadEnv, type Plugin } from "vite";
import https from "node:https";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

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

function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
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

        server.middlewares.use(path, (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== method) {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

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

          collectBody(req).then((body) => {
            const reqHeaders: Record<string, string> = {
              "content-type": req.headers["content-type"] ?? "application/json",
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
                for (const [key, value] of Object.entries(proxyRes.headers)) {
                  if (value) res.setHeader(key, value);
                }
                proxyRes.pipe(res);
              },
            );

            proxyReq.on("error", (err) => {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: err.message }));
            });

            proxyReq.write(body);
            proxyReq.end();
          });
        });
      }
    },
  };
}
