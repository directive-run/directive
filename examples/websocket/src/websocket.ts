/**
 * WebSocket Connections — Directive Module
 *
 * Demonstrates resolver-driven connection lifecycle, automatic reconnection
 * via constraints with exponential backoff, live message streaming,
 * reconnect countdown via time-based reactivity, and cleanup functions.
 */

import { type ModuleSchema, createModule, t } from "@directive-run/core";
import { MockWebSocket, type WsMessage } from "./mock-ws.js";

// ============================================================================
// Types
// ============================================================================

export type WsStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface EventLogEntry {
  timestamp: number;
  event: string;
  detail: string;
}

// ============================================================================
// Module-level socket reference
// ============================================================================

let activeSocket: MockWebSocket | null = null;

export function getActiveSocket(): MockWebSocket | null {
  return activeSocket;
}

// ============================================================================
// Schema
// ============================================================================

export const websocketSchema = {
  facts: {
    url: t.string(),
    status: t.string<WsStatus>(),
    connectRequested: t.boolean(),
    messages: t.object<WsMessage[]>(),
    retryCount: t.number(),
    maxRetries: t.number(),
    messageToSend: t.string(),
    now: t.number(),
    reconnectTargetTime: t.number(),
    messageRate: t.number(),
    connectFailRate: t.number(),
    reconnectFailRate: t.number(),
    eventLog: t.object<EventLogEntry[]>(),
  },
  derivations: {
    isConnected: t.boolean(),
    shouldReconnect: t.boolean(),
    reconnectDelay: t.number(),
    reconnectCountdown: t.number(),
    canSend: t.boolean(),
    messageCount: t.number(),
  },
  events: {
    requestConnect: {},
    disconnect: {},
    setMessageToSend: { value: t.string() },
    messageSent: {},
    setUrl: { value: t.string() },
    setMessageRate: { value: t.number() },
    setConnectFailRate: { value: t.number() },
    setReconnectFailRate: { value: t.number() },
    setMaxRetries: { value: t.number() },
    tick: {},
    clearMessages: {},
    forceError: {},
  },
  requirements: {
    CONNECT: {
      url: t.string(),
      messageRate: t.number(),
      connectFailRate: t.number(),
    },
    RECONNECT: {
      delay: t.number(),
      reconnectFailRate: t.number(),
    },
  },
} satisfies ModuleSchema;

// ============================================================================
// Helpers
// ============================================================================

function addLogEntry(facts: any, event: string, detail: string): void {
  const log = [...(facts.eventLog as EventLogEntry[])];
  log.push({ timestamp: Date.now(), event, detail });
  // Cap at 100
  if (log.length > 100) {
    log.splice(0, log.length - 100);
  }
  facts.eventLog = log;
}

// ============================================================================
// Module
// ============================================================================

export const websocketModule = createModule("websocket", {
  schema: websocketSchema,

  init: (facts) => {
    facts.url = "wss://demo.directive.run/chat";
    facts.status = "disconnected";
    facts.connectRequested = false;
    facts.messages = [];
    facts.retryCount = 0;
    facts.maxRetries = 5;
    facts.messageToSend = "";
    facts.now = Date.now();
    facts.reconnectTargetTime = 0;
    facts.messageRate = 3;
    facts.connectFailRate = 0;
    facts.reconnectFailRate = 0;
    facts.eventLog = [];
  },

  // ============================================================================
  // Derivations
  // ============================================================================

  derive: {
    isConnected: (facts) => facts.status === "connected",

    shouldReconnect: (facts) => {
      return (
        facts.status === "error" &&
        facts.retryCount < facts.maxRetries &&
        facts.connectRequested
      );
    },

    reconnectDelay: (facts) => {
      return Math.min(1000 * 2 ** facts.retryCount, 30000);
    },

    reconnectCountdown: (facts) => {
      if (facts.reconnectTargetTime <= 0) {
        return 0;
      }

      return Math.max(
        0,
        Math.ceil((facts.reconnectTargetTime - facts.now) / 1000),
      );
    },

    canSend: (facts) => {
      return facts.status === "connected" && facts.messageToSend.trim() !== "";
    },

    messageCount: (facts) => facts.messages.length,
  },

  // ============================================================================
  // Events
  // ============================================================================

  events: {
    requestConnect: (facts) => {
      facts.connectRequested = true;
      facts.status = "connecting";
      facts.retryCount = 0;
      facts.reconnectTargetTime = 0;
      facts.messages = [];
      facts.eventLog = [];
    },

    disconnect: (facts) => {
      facts.connectRequested = false;
      facts.status = "disconnected";
      facts.reconnectTargetTime = 0;

      // Null out before close() so the onclose handler's stale-socket guard works
      const socket = activeSocket;
      activeSocket = null;
      if (socket) {
        socket.close();
      }
    },

    setMessageToSend: (facts, { value }) => {
      facts.messageToSend = value;
    },

    messageSent: (facts) => {
      facts.messageToSend = "";
    },

    setUrl: (facts, { value }) => {
      facts.url = value;
    },

    setMessageRate: (facts, { value }) => {
      facts.messageRate = value;
    },

    setConnectFailRate: (facts, { value }) => {
      facts.connectFailRate = value;
    },

    setReconnectFailRate: (facts, { value }) => {
      facts.reconnectFailRate = value;
    },

    setMaxRetries: (facts, { value }) => {
      facts.maxRetries = value;
    },

    tick: (facts) => {
      facts.now = Date.now();
    },

    clearMessages: (facts) => {
      facts.messages = [];
    },

    forceError: (facts) => {
      facts.status = "error";

      // Null out before close() so the onclose handler's stale-socket guard works
      const socket = activeSocket;
      activeSocket = null;
      if (socket) {
        socket.close();
      }
    },
  },

  // ============================================================================
  // Constraints
  // ============================================================================

  constraints: {
    needsConnection: {
      priority: 100,
      when: (facts) => {
        return facts.connectRequested && facts.status === "connecting";
      },
      require: (facts) => ({
        type: "CONNECT",
        url: facts.url,
        messageRate: facts.messageRate,
        connectFailRate: facts.connectFailRate,
      }),
    },

    needsReconnect: {
      priority: 90,
      when: (facts) => {
        return (
          facts.status === "error" &&
          facts.retryCount < facts.maxRetries &&
          facts.connectRequested
        );
      },
      require: (facts) => ({
        type: "RECONNECT",
        delay: Math.min(1000 * 2 ** facts.retryCount, 30000),
        reconnectFailRate: facts.reconnectFailRate,
      }),
    },
  },

  // ============================================================================
  // Resolvers
  // ============================================================================

  resolvers: {
    connect: {
      requirement: "CONNECT",
      timeout: 10000,
      resolve: async (req, context) => {
        addLogEntry(context.facts, "connect", `Connecting to ${req.url}...`);

        // Close any existing socket
        if (activeSocket) {
          activeSocket.close();
          activeSocket = null;
        }

        try {
          const socket = new MockWebSocket(
            req.url,
            req.connectFailRate,
            req.messageRate * 1000,
          );

          // Track this socket so we can detect stale callbacks
          activeSocket = socket;
          const currentSocket = socket;

          socket.onmessage = (msg) => {
            if (activeSocket !== currentSocket) {
              return;
            }

            const messages = [...(context.facts.messages as WsMessage[])];
            messages.push(msg);
            // Cap at 50
            if (messages.length > 50) {
              messages.splice(0, messages.length - 50);
            }
            context.facts.messages = messages;
          };

          socket.onclose = () => {
            if (activeSocket !== currentSocket) {
              return;
            }

            context.facts.status = "disconnected";
            activeSocket = null;
            addLogEntry(context.facts, "close", "Connection closed");
          };

          socket.onerror = (error) => {
            if (activeSocket !== currentSocket) {
              return;
            }

            context.facts.status = "error";
            activeSocket = null;
            addLogEntry(context.facts, "error", error.message);
          };

          // Wait for connection to open
          await new Promise<void>((resolve, reject) => {
            socket.onopen = () => resolve();
            const prevError = socket.onerror;
            socket.onerror = (error) => {
              prevError?.(error);
              reject(error);
            };
          });

          context.facts.status = "connected";
          context.facts.retryCount = 0;
          context.facts.reconnectTargetTime = 0;
          addLogEntry(context.facts, "connected", "Connection established");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          context.facts.status = "error";
          activeSocket = null;
          addLogEntry(context.facts, "connect-error", msg);
          throw err;
        }
      },
    },

    reconnect: {
      requirement: "RECONNECT",
      timeout: 60000,
      resolve: async (req, context) => {
        const retryCount = context.facts.retryCount as number;
        context.facts.status = "reconnecting";
        context.facts.reconnectTargetTime = Date.now() + req.delay;
        addLogEntry(
          context.facts,
          "reconnect",
          `Waiting ${(req.delay / 1000).toFixed(1)}s (attempt ${retryCount + 1})...`,
        );

        await new Promise((resolve) => setTimeout(resolve, req.delay));

        context.facts.retryCount = retryCount + 1;
        context.facts.reconnectTargetTime = 0;
        context.facts.status = "connecting";
      },
    },
  },

  // ============================================================================
  // Effects
  // ============================================================================

  effects: {
    logStatusChange: {
      deps: ["status"],
      run: (facts, prev) => {
        if (prev && prev.status !== facts.status) {
          addLogEntry(facts, "status", `${prev.status} \u2192 ${facts.status}`);
        }
      },
    },
  },
});
