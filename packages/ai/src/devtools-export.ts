/**
 * DevTools subpath export.
 *
 * Tree-shakable entry for debugging + observability: debug timeline plugin,
 * DevTools WebSocket server, and health monitor.
 *
 * @example
 * ```typescript
 * import { createDevToolsServer, createDebugTimeline } from "@directive-run/ai/devtools";
 * ```
 */

// Debug Timeline
export {
  createDebugTimeline,
  createDebugTimelinePlugin,
  type DebugTimeline,
  type DebugTimelineOptions,
  type DebugTimelineListener,
} from "./debug-timeline.js";

// DevTools Server
export {
  createDevToolsServer,
  createWsTransport,
  connectDevTools,
  type DevToolsServer,
  type DevToolsServerConfig,
  type DevToolsClient,
  type DevToolsTransport,
  type DevToolsServerMessage,
  type DevToolsClientMessage,
  type DevToolsSnapshot,
  type WsTransportConfig,
  type ConnectDevToolsOptions,
  type DevToolsCompatibleOrchestrator,
} from "./devtools-server.js";

// Health Monitor
export {
  createHealthMonitor,
  type HealthMonitor,
  type AgentHealthMetrics,
  /** @see CircuitState — core circuit breaker state */
  type HealthCircuitState,
} from "./health-monitor.js";
