/**
 * Public API for `@directive-run/knowledge-mcp`.
 *
 * Most users invoke this package as a CLI (`directive-knowledge-mcp`
 * for stdio, `--sse --port <port>` for HTTP SSE). The programmatic
 * exports below are for embedding the server inside a host process —
 * the docs site, a custom MCP gateway, or a test harness.
 */

export { createDirectiveKnowledgeServer } from "./server.js";
export { startSseServer, type SseServerOptions } from "./sse.js";
