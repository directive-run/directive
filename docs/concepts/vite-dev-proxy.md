# `@directive-run/vite-plugin-api-proxy` – dev-server proxy for AI providers

> A thin Vite middleware that handles CORS preflight, injects API keys
> from `.env` server-side, and forwards request bodies to OpenAI,
> Anthropic, Ollama, Gemini, and anywhere else your dev client wants to
> reach. **Dev-only.** Not for production.

## Threat model

The plugin runs inside Vite's middleware stack on your dev machine. Its
job is to make `localhost:5173` look, to your client code, like it can
talk to `api.openai.com` – which the browser cannot do directly because
of two real constraints:

- **CORS.** OpenAI / Anthropic / Gemini do not ship permissive
  `Access-Control-Allow-Origin` headers. Direct browser calls are
  blocked at preflight.
- **Secrets.** Embedding `OPENAI_API_KEY` in client code ships your
  billing key to GitHub the moment someone runs `git push`.

The plugin closes both gaps by becoming a same-origin endpoint
(`/api/openai`) that injects the key from `process.env` and forwards
the body. The threat model it accepts:

- **Untrusted request body.** Capped at 10 MB (`MAX_BODY_BYTES`). Larger
  uploads are rejected with `413 Payload Too Large` and remaining
  attacker bytes are drained without buffering, so the connection
  cannot snowball into an unbounded buffer.
- **Slowloris.** Idle requests aborted after 30 seconds
  (`REQUEST_TIMEOUT_MS`).
- **Upstream header leaks.** Only a narrow allowlist of upstream
  response headers reaches the browser –
  `content-type`, `content-length`, `content-encoding`,
  `content-language`, `cache-control`, `etag`, `last-modified`,
  `expires`, `pragma`, `vary`. Everything else –
  `set-cookie`, `authorization`, `x-api-key`, every
  `x-internal-*` header – is dropped explicitly so provider session
  cookies and rate-limit identifiers never reach client storage.
- **NOT a production gateway.** The plugin runs in Vite's dev process
  only. It does not bundle into your client build. In production, use a
  real reverse proxy you can monitor, rate-limit, and lock down
  per-route.

## Setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { apiProxy } from "@directive-run/vite-plugin-api-proxy";

export default defineConfig({
  plugins: [
    apiProxy({
      routes: {
        "/api/openai": {
          target: "https://api.openai.com/v1/chat/completions",
          envKey: "OPENAI_API_KEY",  // loaded via Vite loadEnv
          headerKey: "Authorization", // sent as "Bearer ${key}" upstream
        },
        "/api/anthropic": {
          target: "https://api.anthropic.com/v1/messages",
          envKey: "ANTHROPIC_API_KEY",
          headerKey: "x-api-key",
          headers: { "anthropic-version": "2023-06-01" },
        },
      },
    }),
  ],
});
```

Client code now points at `/api/openai` instead of upstream – the
plugin injects the secret and forwards.

```ts
// client – no API key in this file
const res = await fetch("/api/openai", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "gpt-4o", messages }),
});
// → upstream sees Authorization: Bearer sk-...
```

## Options

### `ApiProxyOptions`

| Field | Type | What |
| --- | --- | --- |
| `routes` | `Record<string, ProxyRoute>` | Path-to-route map. Key is the local path your client hits. |

### `ProxyRoute`

| Field | Type | Default | What |
| --- | --- | --- | --- |
| `target` | `string` | – | Upstream URL to forward to (full URL with path). |
| `method` | `string` | `"POST"` | Single HTTP method the route accepts. Others get `405`. |
| `headers` | `Record<string, string>` | – | Extra headers forwarded upstream (e.g. `anthropic-version`). |
| `envKey` | `string` | – | `.env` var name loaded via Vite `loadEnv`. |
| `headerKey` | `string` | – | Upstream header that carries the key (e.g. `Authorization`, `x-api-key`). Also read from the *client* request – the request header wins over the env var if both are present. |
| `envPrefix` | `string` | derived from `envKey` | `loadEnv` prefix filter. Derived as `envKey.split("_")[0]` if omitted. |

### Constants (re-exported)

| Symbol | Value | What |
| --- | --- | --- |
| `MAX_BODY_BYTES` | `10 * 1024 * 1024` | Body cap – `413` past this. |
| `REQUEST_TIMEOUT_MS` | `30_000` | Slowloris timeout – `408` past this. |
| `RESPONSE_HEADER_ALLOWLIST` | `Set<string>` | Forwardable upstream response headers. Anything else is dropped. Re-exported for tests + security-aware consumers who want to assert the surface stays narrow. |

## Examples

### Multiple providers in one config

```ts
apiProxy({
  routes: {
    "/api/openai": {
      target: "https://api.openai.com/v1/chat/completions",
      envKey: "OPENAI_API_KEY",
      headerKey: "Authorization",
    },
    "/api/anthropic": {
      target: "https://api.anthropic.com/v1/messages",
      envKey: "ANTHROPIC_API_KEY",
      headerKey: "x-api-key",
      headers: { "anthropic-version": "2023-06-01" },
    },
    "/api/ollama": {
      target: "http://localhost:11434/api/chat",
      // No envKey/headerKey – local Ollama doesn't need auth
    },
  },
}),
// → three same-origin endpoints, three different auth schemes
```

### Client-supplied key (BYOK)

When `headerKey` is set, the proxy reads the key from the *client*
request first, falling back to `envKey` only if absent. That lets you
ship a dev UI where the user pastes their own key for testing:

```ts
const res = await fetch("/api/openai", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    Authorization: userPastedKey, // ← overrides .env for this request
  },
  body: JSON.stringify(...),
});
// → upstream gets the user-pasted key
```

If neither the request header nor `envKey` resolves a key and `envKey`
was configured, the proxy returns `401`. If `envKey` was not configured
at all, no key is injected and the upstream sees whatever the client
sent.

### Edge case – body too large

```ts
// 11 MB payload from a buggy script
const huge = new ArrayBuffer(11 * 1024 * 1024);
await fetch("/api/openai", { method: "POST", body: huge });
// → { error: "Payload too large" } with status 413
```

The proxy rejects with `413` *as soon as* the running total exceeds
`MAX_BODY_BYTES`, drains remaining attacker bytes (without buffering),
and avoids tearing down the socket – so the `413` response is actually
readable by the client. No silent OOM under sustained abuse.

## Security model – what stays narrow

- ✅ Per-route method allowlist (`405` for anything else).
- ✅ Per-route env var resolution via Vite `loadEnv` (server-side only).
- ✅ Response-header allowlist (`RESPONSE_HEADER_ALLOWLIST`).
- ✅ Explicit deny on `set-cookie`, `authorization`, `x-api-key`, and `x-internal-*`.
- ✅ Body cap (`10 MB`) with proper drain-on-reject.
- ✅ Idle timeout (`30 s`) with proper `408`.
- ❌ No rate limiting – dev process, single user.
- ❌ No request-body validation – upstream owns its schema.
- ❌ No retry / backoff – your client handles transport errors.

## What it does NOT do

- ✅ Solves dev-time CORS for AI provider APIs.
- ✅ Keeps API keys off the client bundle.
- ✅ Drops cookies + auth headers from upstream responses.
- ✅ Caps body size and idle time as DoS guards.
- ❌ Not a production proxy – runs in Vite's dev server only.
- ❌ Not a managed gateway – no rate limiting, no per-user quotas, no telemetry.
- ❌ Not a generic reverse proxy – one route, one method, one upstream URL.
- ❌ Not a streaming-aware client – body is collected in full before forwarding (the upstream response *does* stream back via `proxyRes.pipe(res)`).
- ❌ Not bundled into your client build – the plugin lives in `vite.config.ts` only.

## Production note

Use a real reverse proxy in production – Cloudflare Workers, a Node
server, Nginx with auth headers, or a managed gateway. Things you want
that this plugin does not give you: per-user rate limits, per-key
quotas, structured logging, request schema validation, retry/backoff,
circuit breaking, observability hooks. **Never ship a bundled API key.**

## See also

- [Package README on GitHub](https://github.com/directive-run/directive/tree/main/packages/vite-plugin-api-proxy)
- [`@directive-run/ai`](https://docs.directive.run/ai) – the agent layer that wants this proxy in dev
- [Vite middleware docs](https://vitejs.dev/guide/api-plugin#configureserver) – how `configureServer` works under the hood
