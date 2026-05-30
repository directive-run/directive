# @directive-run/vite-plugin-api-proxy

Vite dev-server proxy for AI providers – handles CORS preflight, keeps API keys off the client, and forwards request bodies to upstream services like OpenAI, Anthropic, Ollama, and Gemini.

[![npm](https://img.shields.io/npm/v/@directive-run/vite-plugin-api-proxy)](https://www.npmjs.com/package/@directive-run/vite-plugin-api-proxy)

## Why this exists

Browsers can't talk to most AI providers directly:

- **CORS** – OpenAI / Anthropic / Gemini don't ship permissive `Access-Control-Allow-Origin` headers.
- **Secrets** – embedding `OPENAI_API_KEY` in client code ships your billing to GitHub.

In dev, you need a thin proxy that injects the key server-side and forwards the body. This plugin is that proxy, wired into Vite's middleware so you don't run a second process.

## Install

```bash
npm install -D @directive-run/vite-plugin-api-proxy
```

## Vite config

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
          envKey: "OPENAI_API_KEY",      // loaded from .env via Vite loadEnv
          headerKey: "Authorization",     // sent as "Bearer ${key}" upstream
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

Client code now points at `/api/openai` instead of the upstream – the plugin injects the secret and forwards.

## Response header allowlist

The proxy forwards a **narrow allowlist** of upstream response headers to the dev-server client:

- `content-type`, `content-length`, `content-encoding`, `content-language`
- `cache-control`, `etag`, `last-modified`, `expires`, `pragma`, `vary`

Everything else – including `set-cookie`, `authorization`, `x-api-key`, vendor-specific tracking headers, and any `x-internal-*` header – is **dropped before reaching the browser**. This prevents accidentally leaking provider session cookies or rate-limit identifiers into client storage.

Re-exported as `RESPONSE_HEADER_ALLOWLIST` for tests and for security-aware consumers who want to assert the surface stays narrow.

## Body size cap

Request bodies are capped at **10 MB** (`MAX_BODY_BYTES`). Larger uploads are rejected with `413 Payload Too Large` and the connection is destroyed – a small DoS guard against runaway upload loops in dev. Idle requests are aborted after 30 seconds (`REQUEST_TIMEOUT_MS`) as a slowloris defense.

## Production note

**This is a dev-only plugin.** It runs inside Vite's middleware and is not bundled into your client build. In production, use a real reverse proxy – Cloudflare Workers, a Node server, Nginx with auth headers, or a managed gateway – that you can monitor, rate-limit, and lock down per-route. Never ship a bundled API key.

## License

[MIT OR Apache-2.0](../../LICENSE)
