/**
 * DevTools Server — WebSocket-based bridge between orchestrators and DevTools UI.
 *
 * Streams debug timeline events, health metrics, breakpoint state, and system
 * snapshots in real-time to connected DevTools clients. Accepts commands from
 * clients to resume/cancel breakpoints and request snapshots.
 *
 * Transport-agnostic: works with any WebSocket implementation (ws, Bun, Deno)
 * via the {@link DevToolsTransport} interface.
 *
 * @module
 */

import type { DebugTimeline } from "./debug-timeline.js";
import type { AgentHealthMetrics, HealthMonitor } from "./health-monitor.js";
import type { BreakpointState, DebugEvent } from "./types.js";

// ============================================================================
// Transport Interface (WebSocket abstraction)
// ============================================================================

/** A connected DevTools client */
export interface DevToolsClient {
  /** Send a JSON-serializable message to this client */
  send(data: string): void;
  /** Close the connection */
  close(): void;
}

/**
 * Transport layer for the DevTools server.
 *
 * Implement this interface to bridge any WebSocket library (ws, Bun.serve, Deno.serve).
 *
 * @example Node.js with `ws`:
 * ```typescript
 * import { WebSocketServer } from "ws";
 *
 * function createWsTransport(port: number): DevToolsTransport {
 *   const wss = new WebSocketServer({ port });
 *   let onConnect: ((client: DevToolsClient) => void) | null = null;
 *
 *   wss.on("connection", (ws) => {
 *     const client: DevToolsClient = {
 *       send: (data) => { if (ws.readyState === ws.OPEN) ws.send(data); },
 *       close: () => ws.close(),
 *     };
 *     ws.on("message", (raw) => {
 *       if (client._onMessage) client._onMessage(raw.toString());
 *     });
 *     ws.on("close", () => {
 *       if (client._onClose) client._onClose();
 *     });
 *     onConnect?.(client);
 *   });
 *
 *   return {
 *     onConnection(handler) { onConnect = handler; },
 *     close() { wss.close(); },
 *   };
 * }
 * ```
 */
export interface DevToolsTransport {
  /** Register a handler for new client connections */
  onConnection(
    handler: (
      client: DevToolsClient,
      onMessage: (handler: (data: string) => void) => void,
      onClose: (handler: () => void) => void,
    ) => void,
  ): void;
  /** Shut down the transport */
  close(): void;
}

// ============================================================================
// Protocol Messages
// ============================================================================

/** Messages sent FROM the server TO clients */
export type DevToolsServerMessage =
  | { type: "welcome"; version: number; sessionId: string; timestamp: number }
  | { type: "event"; event: DebugEvent }
  | { type: "event_batch"; events: DebugEvent[] }
  | { type: "snapshot"; data: DevToolsSnapshot }
  | { type: "health"; metrics: Record<string, AgentHealthMetrics> }
  | { type: "breakpoints"; state: BreakpointState }
  | { type: "pong"; timestamp: number }
  // Scratchpad & derived state
  | { type: "scratchpad_state"; data: Record<string, unknown> }
  | { type: "scratchpad_update"; key: string; value: unknown }
  | { type: "derived_state"; data: Record<string, unknown> }
  | { type: "derived_update"; id: string; value: unknown }
  // Fork
  | { type: "fork_complete"; eventId: number; newEventCount: number }
  // Token streaming
  | {
      type: "token_stream";
      agentId: string;
      tokens: string;
      tokenCount: number;
    }
  | { type: "stream_done"; agentId: string; totalTokens: number }
  | { type: "error"; code: string; message: string };

/** Messages sent FROM clients TO the server */
export type DevToolsClientMessage =
  | { type: "authenticate"; token: string }
  | { type: "request_snapshot" }
  | { type: "request_health" }
  | { type: "request_events"; since?: number }
  | { type: "request_breakpoints" }
  | {
      type: "resume_breakpoint";
      breakpointId: string;
      modifications?: { input?: string; skip?: boolean };
    }
  | { type: "cancel_breakpoint"; breakpointId: string; reason?: string }
  | { type: "export_session" }
  | { type: "import_session"; data: string }
  // Scratchpad & derived requests
  | { type: "request_scratchpad" }
  | { type: "request_derived" }
  // Fork
  | { type: "fork_from_snapshot"; eventId: number }
  | { type: "ping" };

/** System snapshot sent to clients on demand */
export interface DevToolsSnapshot {
  timestamp: number;
  agents: Record<
    string,
    {
      status: string;
      lastInput?: string;
      lastOutput?: unknown;
      totalTokens: number;
      runCount: number;
    }
  >;
  coordinator?: { globalTokens: number; status: string };
  derived?: Record<string, unknown>;
  eventCount: number;
}

// ============================================================================
// Server Configuration
// ============================================================================

/** Configuration for the DevTools server */
export interface DevToolsServerConfig {
  /** Transport to use for WebSocket connections */
  transport: DevToolsTransport;
  /** Debug timeline to subscribe to */
  timeline: DebugTimeline;
  /** Health monitor for metrics (optional) */
  healthMonitor?: HealthMonitor | null;
  /** Callback to get current agent states for snapshots */
  getSnapshot?: () => DevToolsSnapshot;
  /** Callback to get current breakpoint state */
  getBreakpointState?: () => BreakpointState;
  /** Callback to resume a breakpoint */
  onResumeBreakpoint?: (
    id: string,
    modifications?: { input?: string; skip?: boolean },
  ) => void;
  /** Callback to cancel a breakpoint */
  onCancelBreakpoint?: (id: string, reason?: string) => void;
  /** Callback to get current scratchpad state */
  getScratchpadState?: () => Record<string, unknown>;
  /** Callback to get current derived state */
  getDerivedState?: () => Record<string, unknown>;
  /** Callback to fork from a snapshot event */
  onForkFromSnapshot?: (eventId: number) => { newEventCount: number };
  /** Maximum events to batch before flushing. Default: 1 (no batching) */
  batchSize?: number;
  /** Flush interval for batched events (ms). Default: 50 */
  batchIntervalMs?: number;
  /** Health metrics push interval (ms). 0 = no auto-push. Default: 0 */
  healthPushIntervalMs?: number;
  /** Maximum connected clients. Default: 50 */
  maxClients?: number;
  /** Token authentication callback. When set, new connections must send an `authenticate` message before receiving data. */
  authenticate?: (token: string) => boolean | Promise<boolean>;
}

// ============================================================================
// Server Instance
// ============================================================================

/** DevTools server instance */
export interface DevToolsServer {
  /** Number of connected clients */
  readonly clientCount: number;
  /** Broadcast a message to all connected clients */
  broadcast(message: DevToolsServerMessage): void;
  /** Push current health metrics to all clients */
  pushHealth(): void;
  /** Push current breakpoint state to all clients */
  pushBreakpoints(): void;
  /** Push a scratchpad key update to all clients */
  pushScratchpadUpdate(key: string, value: unknown): void;
  /** Push a derived value update to all clients */
  pushDerivedUpdate(id: string, value: unknown): void;
  /** Push streaming tokens to all clients */
  pushTokenStream(agentId: string, tokens: string, tokenCount: number): void;
  /** Signal stream completion to all clients */
  pushStreamDone(agentId: string, totalTokens: number): void;
  /** Shut down the server and disconnect all clients */
  close(): void;
}

const PROTOCOL_VERSION = 1;

/**
 * Create a DevTools server that bridges orchestrator state to DevTools UI clients.
 *
 * @example
 * ```typescript
 * const server = createDevToolsServer({
 *   transport: createWsTransport(4040),
 *   timeline: orchestrator.timeline!,
 *   healthMonitor: orchestrator.healthMonitor,
 *   getSnapshot: () => buildSnapshot(orchestrator),
 *   getBreakpointState: () => orchestrator.getBreakpointState(),
 *   onResumeBreakpoint: (id, mods) => orchestrator.resumeBreakpoint(id, mods),
 *   onCancelBreakpoint: (id, reason) => orchestrator.cancelBreakpoint(id, reason),
 * });
 * ```
 */
export function createDevToolsServer(
  config: DevToolsServerConfig,
): DevToolsServer {
  const {
    transport,
    timeline,
    healthMonitor,
    getSnapshot,
    getBreakpointState,
    onResumeBreakpoint,
    onCancelBreakpoint,
    getScratchpadState,
    getDerivedState,
    onForkFromSnapshot,
    batchSize = 1,
    batchIntervalMs = 50,
    healthPushIntervalMs = 0,
    authenticate,
  } = config;
  const maxClients = config.maxClients ?? 50;

  const sessionId = `devtools_${crypto.randomUUID()}`;
  const clients = new Set<DevToolsClient>();
  const pendingAuthClients = new Set<DevToolsClient>();
  let batchBuffer: DebugEvent[] = [];
  let batchTimer: ReturnType<typeof setInterval> | null = null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function sendToClient(
    client: DevToolsClient,
    message: DevToolsServerMessage,
  ): void {
    try {
      client.send(JSON.stringify(message));
    } catch {
      // Client may have disconnected — remove silently
      clients.delete(client);
    }
  }

  function broadcastMessage(message: DevToolsServerMessage): void {
    const data = JSON.stringify(message);
    const snapshot = [...clients];
    for (const client of snapshot) {
      try {
        client.send(data);
      } catch {
        clients.delete(client);
      }
    }
  }

  function flushBatch(): void {
    if (batchBuffer.length === 0) {
      return;
    }

    if (batchBuffer.length === 1) {
      broadcastMessage({ type: "event", event: batchBuffer[0]! });
    } else {
      broadcastMessage({ type: "event_batch", events: batchBuffer });
    }

    batchBuffer = [];
  }

  // ------------------------------------------------------------------
  // Timeline subscription
  // ------------------------------------------------------------------

  const unsubscribeTimeline: () => void = timeline.subscribe(
    (event: DebugEvent) => {
      if (clients.size === 0) {
        return;
      }

      if (batchSize <= 1) {
        broadcastMessage({ type: "event", event });

        return;
      }

      batchBuffer.push(event);
      if (batchBuffer.length >= batchSize) {
        flushBatch();
      }
    },
  );

  // Start batch flush timer if batching enabled
  if (batchSize > 1 && batchIntervalMs > 0) {
    batchTimer = setInterval(flushBatch, batchIntervalMs);
  }

  // Start health push timer if configured
  if (healthPushIntervalMs > 0 && healthMonitor) {
    healthTimer = setInterval(() => {
      if (clients.size > 0) {
        broadcastMessage({
          type: "health",
          metrics: healthMonitor.getAllMetrics(),
        });
      }
    }, healthPushIntervalMs);
  }

  // ------------------------------------------------------------------
  // Client message handler
  // ------------------------------------------------------------------

  function handleClientMessage(client: DevToolsClient, raw: string): void {
    let msg: DevToolsClientMessage;
    try {
      msg = JSON.parse(raw) as DevToolsClientMessage;
    } catch {
      sendToClient(client, {
        type: "error",
        code: "INVALID_JSON",
        message: "Could not parse message",
      });

      return;
    }

    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
      sendToClient(client, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Missing type field",
      });

      return;
    }

    const now = Date.now();
    const last = clientLastMessage.get(client) ?? 0;
    if (now - last < MIN_MESSAGE_INTERVAL_MS) {
      sendToClient(client, {
        type: "error",
        code: "RATE_LIMITED",
        message: "Too many requests",
      });

      return;
    }
    clientLastMessage.set(client, now);

    // Handle authenticate message
    if (msg.type === "authenticate") {
      if (!authenticate) {
        // No auth configured — treat as unknown command
        sendToClient(client, {
          type: "error",
          code: "UNKNOWN_COMMAND",
          message: "Authentication not configured on this server",
        });

        return;
      }

      if (!pendingAuthClients.has(client)) {
        // Already authenticated
        sendToClient(client, {
          type: "error",
          code: "ALREADY_AUTHENTICATED",
          message: "Already authenticated",
        });

        return;
      }

      if (typeof msg.token !== "string") {
        sendToClient(client, {
          type: "error",
          code: "AUTH_FAILED",
          message: "Missing token",
        });
        client.close();
        pendingAuthClients.delete(client);

        return;
      }

      const result = authenticate(msg.token);
      const handleResult = (valid: boolean) => {
        if (valid) {
          pendingAuthClients.delete(client);
          clients.add(client);
          sendToClient(client, {
            type: "welcome",
            version: PROTOCOL_VERSION,
            sessionId,
            timestamp: Date.now(),
          });
        } else {
          sendToClient(client, {
            type: "error",
            code: "AUTH_FAILED",
            message: "Invalid token",
          });
          pendingAuthClients.delete(client);
          client.close();
        }
      };

      if (result instanceof Promise) {
        result.then(handleResult).catch(() => {
          sendToClient(client, {
            type: "error",
            code: "AUTH_FAILED",
            message: "Authentication error",
          });
          pendingAuthClients.delete(client);
          client.close();
        });
      } else {
        handleResult(result);
      }

      return;
    }

    // Reject commands from clients pending authentication
    if (pendingAuthClients.has(client)) {
      sendToClient(client, {
        type: "error",
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });

      return;
    }

    switch (msg.type) {
      case "ping":
        sendToClient(client, { type: "pong", timestamp: Date.now() });
        break;

      case "request_snapshot":
        if (getSnapshot) {
          sendToClient(client, { type: "snapshot", data: getSnapshot() });
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_SNAPSHOT",
            message: "Snapshot provider not configured",
          });
        }
        break;

      case "request_health":
        if (healthMonitor) {
          sendToClient(client, {
            type: "health",
            metrics: healthMonitor.getAllMetrics(),
          });
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_HEALTH",
            message: "Health monitor not configured",
          });
        }
        break;

      case "request_events": {
        const events = timeline.getEvents();
        const since = msg.since;
        const filtered =
          since != null ? events.filter((e) => e.id > since) : events;
        sendToClient(client, { type: "event_batch", events: filtered });
        break;
      }

      case "request_breakpoints":
        if (getBreakpointState) {
          sendToClient(client, {
            type: "breakpoints",
            state: getBreakpointState(),
          });
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_BREAKPOINTS",
            message: "Breakpoint provider not configured",
          });
        }
        break;

      case "resume_breakpoint":
        if (onResumeBreakpoint && typeof msg.breakpointId === "string") {
          // Sanitize: only extract known fields to prevent prototype pollution
          const mods = msg.modifications
            ? { input: msg.modifications.input, skip: msg.modifications.skip }
            : undefined;
          onResumeBreakpoint(msg.breakpointId, mods);
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_BREAKPOINTS",
            message: "Breakpoint resume not configured",
          });
        }
        break;

      case "cancel_breakpoint":
        if (onCancelBreakpoint && typeof msg.breakpointId === "string") {
          const safeReason =
            typeof msg.reason === "string" ? msg.reason : undefined;
          onCancelBreakpoint(msg.breakpointId, safeReason);
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_BREAKPOINTS",
            message: "Breakpoint cancel not configured",
          });
        }
        break;

      case "export_session":
        sendToClient(client, {
          type: "event_batch",
          events: timeline.getEvents(),
        });
        break;

      case "import_session": {
        const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // ~10M characters (string .length check, not byte size)
        if (typeof msg.data !== "string") {
          sendToClient(client, {
            type: "error",
            code: "INVALID_DATA",
            message: "Missing data field for import",
          });
        } else if (msg.data.length > MAX_IMPORT_SIZE) {
          sendToClient(client, {
            type: "error",
            code: "IMPORT_TOO_LARGE",
            message: `Import data exceeds ${MAX_IMPORT_SIZE / 1024 / 1024} MB limit`,
          });
        } else {
          try {
            timeline.import(msg.data);
            sendToClient(client, {
              type: "event_batch",
              events: timeline.getEvents(),
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendToClient(client, {
              type: "error",
              code: "IMPORT_FAILED",
              message: errMsg,
            });
          }
        }
        break;
      }

      case "request_scratchpad":
        if (getScratchpadState) {
          sendToClient(client, {
            type: "scratchpad_state",
            data: getScratchpadState(),
          });
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_SCRATCHPAD",
            message: "Scratchpad provider not configured",
          });
        }
        break;

      case "request_derived":
        if (getDerivedState) {
          sendToClient(client, {
            type: "derived_state",
            data: getDerivedState(),
          });
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_DERIVED",
            message: "Derived state provider not configured",
          });
        }
        break;

      case "fork_from_snapshot": {
        if (onForkFromSnapshot && typeof msg.eventId === "number") {
          try {
            const result = onForkFromSnapshot(msg.eventId);
            sendToClient(client, {
              type: "fork_complete",
              eventId: msg.eventId,
              newEventCount: result.newEventCount,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            sendToClient(client, {
              type: "error",
              code: "FORK_FAILED",
              message: errMsg,
            });
          }
        } else {
          sendToClient(client, {
            type: "error",
            code: "NO_FORK",
            message: "Fork provider not configured",
          });
        }
        break;
      }

      default:
        sendToClient(client, {
          type: "error",
          code: "UNKNOWN_COMMAND",
          message: `Unknown message type: ${String((msg as { type: string }).type).slice(0, 100)}`,
        });
    }
  }

  // ------------------------------------------------------------------
  // Rate limiting
  // ------------------------------------------------------------------

  const clientLastMessage = new Map<DevToolsClient, number>();
  const MIN_MESSAGE_INTERVAL_MS = 50;

  // ------------------------------------------------------------------
  // Connection handler
  // ------------------------------------------------------------------

  transport.onConnection((client, onMessage, onClose) => {
    if (clients.size + pendingAuthClients.size >= maxClients) {
      try {
        const msg: DevToolsServerMessage = {
          type: "error",
          code: "MAX_CLIENTS",
          message: "Connection limit reached",
        };
        client.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
      client.close();

      return;
    }

    if (authenticate) {
      // Hold in pending state until client sends authenticate message
      pendingAuthClients.add(client);
    } else {
      // No auth — add directly and send welcome
      clients.add(client);
      sendToClient(client, {
        type: "welcome",
        version: PROTOCOL_VERSION,
        sessionId,
        timestamp: Date.now(),
      });
    }

    onMessage((data) => handleClientMessage(client, data));
    onClose(() => {
      clients.delete(client);
      pendingAuthClients.delete(client);
      clientLastMessage.delete(client);
    });
  });

  // ------------------------------------------------------------------
  // Public interface
  // ------------------------------------------------------------------

  return {
    get clientCount(): number {
      return clients.size;
    },

    broadcast(message: DevToolsServerMessage): void {
      broadcastMessage(message);
    },

    pushHealth(): void {
      if (healthMonitor && clients.size > 0) {
        broadcastMessage({
          type: "health",
          metrics: healthMonitor.getAllMetrics(),
        });
      }
    },

    pushBreakpoints(): void {
      if (getBreakpointState && clients.size > 0) {
        broadcastMessage({ type: "breakpoints", state: getBreakpointState() });
      }
    },

    pushScratchpadUpdate(key: string, value: unknown): void {
      if (clients.size > 0) {
        broadcastMessage({ type: "scratchpad_update", key, value });
      }
    },

    pushDerivedUpdate(id: string, value: unknown): void {
      if (clients.size > 0) {
        broadcastMessage({ type: "derived_update", id, value });
      }
    },

    pushTokenStream(agentId: string, tokens: string, tokenCount: number): void {
      if (clients.size > 0) {
        broadcastMessage({ type: "token_stream", agentId, tokens, tokenCount });
      }
    },

    pushStreamDone(agentId: string, totalTokens: number): void {
      if (clients.size > 0) {
        broadcastMessage({ type: "stream_done", agentId, totalTokens });
      }
    },

    close(): void {
      unsubscribeTimeline();

      if (batchTimer) {
        clearInterval(batchTimer);
        batchTimer = null;
      }

      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }

      flushBatch();

      for (const client of clients) {
        try {
          client.close();
        } catch {
          // Ignore close errors
        }
      }
      for (const client of pendingAuthClients) {
        try {
          client.close();
        } catch {
          // Ignore close errors
        }
      }
      clients.clear();
      pendingAuthClients.clear();
      clientLastMessage.clear();

      transport.close();
    },
  };
}

// ============================================================================
// Orchestrator Connector
// ============================================================================

/** Options for connecting DevTools to an orchestrator */
export interface ConnectDevToolsOptions {
  /** Port for the WebSocket server. Default: 4040 */
  port?: number;
  /** Host to bind to. Default: "localhost" */
  host?: string;
  /** Health metrics push interval (ms). Default: 5000 */
  healthPushIntervalMs?: number;
  /** Event batching size. Default: 1 (no batching) */
  batchSize?: number;
  /** Token authentication callback. When set, clients must authenticate before receiving data. */
  authenticate?: (token: string) => boolean | Promise<boolean>;
}

/** Minimal orchestrator interface for DevTools connection */
export interface DevToolsCompatibleOrchestrator {
  timeline: {
    subscribe: (listener: (event: DebugEvent) => void) => () => void;
    getEvents: () => DebugEvent[];
    import: (json: string) => void;
    export: () => string;
    forkFrom?: (eventId: number) => void;
  } | null;
  healthMonitor?: {
    getAllMetrics: () => Record<string, AgentHealthMetrics>;
  } | null;
  getPendingBreakpoints?: () => Array<{
    id: string;
    type: string;
    agentId: string;
    input: string;
    label?: string;
    requestedAt: number;
  }>;
  resumeBreakpoint?: (
    id: string,
    modifications?: { input?: string; skip?: boolean },
  ) => void;
  cancelBreakpoint?: (id: string, reason?: string) => void;
  getAllAgentStates?: () => Record<
    string,
    {
      status: string;
      lastInput?: string;
      lastOutput?: unknown;
      totalTokens: number;
      runCount: number;
    }
  >;
  /** Get current scratchpad state (multi-agent only) */
  getScratchpadState?: () => Record<string, unknown>;
  /** Get current derived values (multi-agent only) */
  getDerivedState?: () => Record<string, unknown>;
}

/**
 * Connect DevTools to an orchestrator instance.
 *
 * Convenience function that creates a WebSocket transport and DevTools server,
 * automatically wiring up the orchestrator's timeline, health monitor, and breakpoint system.
 *
 * Requires the `ws` package: `npm install ws`
 *
 * **Security:** Binding to `0.0.0.0` exposes the server to all network interfaces.
 * Only do this behind a firewall or with proper authentication.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({ debug: true, ... });
 * const devtools = await connectDevTools(orchestrator, { port: 4040 });
 *
 * // Later, clean up:
 * devtools.close();
 * ```
 */
export async function connectDevTools(
  orchestrator: DevToolsCompatibleOrchestrator,
  options: ConnectDevToolsOptions = {},
): Promise<DevToolsServer> {
  if (!orchestrator.timeline) {
    throw new Error(
      "[Directive DevTools] Orchestrator must have debug: true to use DevTools",
    );
  }

  const transport = await createWsTransport({
    port: options.port ?? 4040,
    host: options.host ?? "localhost",
  });

  return createDevToolsServer({
    transport,
    timeline: orchestrator.timeline as unknown as DebugTimeline,
    healthMonitor: orchestrator.healthMonitor as HealthMonitor | undefined,
    healthPushIntervalMs: options.healthPushIntervalMs ?? 5000,
    batchSize: options.batchSize,
    authenticate: options.authenticate,
    getSnapshot: orchestrator.getAllAgentStates
      ? () => {
          const agents = orchestrator.getAllAgentStates!();

          return {
            timestamp: Date.now(),
            agents,
            eventCount: orchestrator.timeline!.getEvents().length,
          };
        }
      : undefined,
    getBreakpointState: orchestrator.getPendingBreakpoints
      ? () => ({
          pending: orchestrator.getPendingBreakpoints!(),
          resolved: [],
          cancelled: [],
        })
      : undefined,
    onResumeBreakpoint: orchestrator.resumeBreakpoint,
    onCancelBreakpoint: orchestrator.cancelBreakpoint,
    getScratchpadState: orchestrator.getScratchpadState,
    getDerivedState: orchestrator.getDerivedState,
    onForkFromSnapshot: orchestrator.timeline?.forkFrom
      ? (eventId: number) => {
          orchestrator.timeline!.forkFrom!(eventId);
          const newEventCount = orchestrator.timeline!.getEvents().length;

          return { newEventCount };
        }
      : undefined,
  });
}

// ============================================================================
// Node.js ws Transport Helper
// ============================================================================

/**
 * Configuration for the built-in Node.js `ws` transport.
 *
 * Requires the `ws` package to be installed: `npm install ws`
 */
export interface WsTransportConfig {
  /** Port to listen on. Default: 4040 */
  port?: number;
  /** Host to bind to. Default: "localhost" */
  host?: string;
  /** Maximum incoming message size in bytes. Default: 1048576 (1MB) */
  maxPayloadBytes?: number;
}

/**
 * Create a DevTools transport using the Node.js `ws` WebSocket library.
 *
 * This is a convenience helper — you can implement {@link DevToolsTransport}
 * with any WebSocket library.
 *
 * @example
 * ```typescript
 * const transport = await createWsTransport({ port: 4040 });
 * const server = createDevToolsServer({ transport, timeline });
 * ```
 */
export async function createWsTransport(
  config: WsTransportConfig = {},
): Promise<DevToolsTransport> {
  const port = config.port ?? 4040;
  const host = config.host ?? "localhost";

  // Dynamic import so ws is not a hard dependency
  const { WebSocketServer } = await import("ws");
  // maxPayload is supported at runtime but missing from @types/ws ServerOptions
  const wss = new WebSocketServer({
    port,
    host,
    ...{ maxPayload: config.maxPayloadBytes ?? 1_048_576 },
  });

  let connectionHandler:
    | ((
        client: DevToolsClient,
        onMessage: (handler: (data: string) => void) => void,
        onClose: (handler: () => void) => void,
      ) => void)
    | null = null;

  // biome-ignore lint/suspicious/noExplicitAny: ws types resolved at runtime via dynamic import
  wss.on("connection", (ws: any) => {
    let messageHandler: ((data: string) => void) | null = null;
    let closeHandler: (() => void) | null = null;

    const client: DevToolsClient = {
      send(data: string) {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      },
      close() {
        ws.close();
      },
    };

    ws.on("message", (raw: any) => {
      if (messageHandler) {
        messageHandler(raw.toString());
      }
    });

    ws.on("close", () => {
      if (closeHandler) {
        closeHandler();
      }
    });

    connectionHandler?.(
      client,
      (handler) => {
        messageHandler = handler;
      },
      (handler) => {
        closeHandler = handler;
      },
    );
  });

  return {
    onConnection(handler) {
      connectionHandler = handler;
    },
    close() {
      wss.close();
    },
  };
}
