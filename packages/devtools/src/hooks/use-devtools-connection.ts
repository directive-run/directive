import { useCallback, useEffect, useRef, useState } from "react";
import {
  VALID_EVENT_TYPES,
  VALID_SERVER_MESSAGE_TYPES,
  type AgentHealthMetrics,
  type BreakpointState,
  type ClientMessage,
  type ConnectionStatus,
  type DebugEvent,
  type DevToolsSnapshot,
  type ServerMessage,
} from "../lib/types";

export interface DevToolsConnection {
  status: ConnectionStatus;
  sessionId: string | null;
  events: DebugEvent[];
  snapshot: DevToolsSnapshot | null;
  healthMetrics: Record<string, AgentHealthMetrics>;
  breakpointState: BreakpointState;
  error: string | null;
  // Phase 2: Scratchpad & derived state
  scratchpadState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  // Phase 2: Token streaming
  streamingTokens: Map<string, { tokens: string; count: number; startedAt: number }>;
  // E12: Pause live updates
  isPaused: boolean;
  pendingCount: number;
  togglePause: () => void;
  connect: (url: string) => void;
  disconnect: () => void;
  send: (message: ClientMessage) => void;
  requestSnapshot: () => void;
  requestHealth: () => void;
  requestEvents: (since?: number) => void;
  requestBreakpoints: () => void;
  resumeBreakpoint: (id: string, modifications?: { input?: string; skip?: boolean }) => void;
  cancelBreakpoint: (id: string, reason?: string) => void;
  exportSession: () => void;
  importSession: (data: string) => void;
  clearEvents: () => void;
  // Phase 2: New request methods
  requestScratchpad: () => void;
  requestDerived: () => void;
  forkFromSnapshot: (eventId: number) => void;
}

const INITIAL_BREAKPOINT_STATE: BreakpointState = { pending: [], resolved: [], cancelled: [] };
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;
const MAX_EVENTS = 5000;
const STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_STREAMING_AGENTS = 50;
/** Keys that must never be set via dynamic property assignment */
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Validate that a parsed message has a known ServerMessage type */
function isValidServerMessage(value: unknown): value is ServerMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return typeof obj.type === "string" && VALID_SERVER_MESSAGE_TYPES.has(obj.type);
}

/** Validate that a value looks like a DebugEvent with a known type */
function isValidEvent(value: unknown): value is DebugEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" &&
    typeof obj.type === "string" &&
    VALID_EVENT_TYPES.has(obj.type) &&
    typeof obj.timestamp === "number"
  );
}

/** Validate and filter an array of events, returning only valid ones */
function validateEvents(arr: unknown[]): DebugEvent[] {
  return arr.filter(isValidEvent);
}

export function useDevToolsConnection(): DevToolsConnection {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [snapshot, setSnapshot] = useState<DevToolsSnapshot | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<Record<string, AgentHealthMetrics>>({});
  const [breakpointState, setBreakpointState] = useState<BreakpointState>(INITIAL_BREAKPOINT_STATE);
  const [error, setError] = useState<string | null>(null);
  // Phase 2 state
  const [scratchpadState, setScratchpadState] = useState<Record<string, unknown>>({});
  const [derivedState, setDerivedState] = useState<Record<string, unknown>>({});
  const [streamingTokens, setStreamingTokens] = useState<Map<string, { tokens: string; count: number; startedAt: number }>>(new Map());

  // E12: Pause live updates
  const [isPaused, setIsPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pausedRef = useRef(false);
  const pendingWhilePausedRef = useRef<DebugEvent[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const urlRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamCleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Event buffer for batched appends (M6: avoid O(n) copy per event)
  const eventBufferRef = useRef<DebugEvent[]>([]);
  const flushRafRef = useRef<number | null>(null);

  // Pending fork state (C3: replace setTimeout with message-based)
  const pendingForkRef = useRef(false);
  const forkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Send helper (declared early for use in handleMessage)
  const sendRef = useRef<(message: ClientMessage) => void>(() => {});
  // DX#6: Store handleMessage in a ref to break connect → handleMessage dependency chain
  const handleMessageRef = useRef<(msg: ServerMessage) => void>(() => {});

  /** Flush buffered events into state on animation frame */
  const flushEventBuffer = useCallback(() => {
    flushRafRef.current = null;
    const buffered = eventBufferRef.current;
    if (buffered.length === 0) {
      return;
    }

    eventBufferRef.current = [];

    // E12: When paused, buffer events instead of appending
    if (pausedRef.current) {
      pendingWhilePausedRef.current.push(...buffered);
      setPendingCount(pendingWhilePausedRef.current.length);

      return;
    }

    setEvents((prev) => {
      const next = prev.concat(buffered);

      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });
  }, []);

  /** Schedule a buffer flush on the next animation frame */
  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current == null) {
      flushRafRef.current = requestAnimationFrame(flushEventBuffer);
    }
  }, [flushEventBuffer]);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "welcome":
        setSessionId(msg.sessionId);
        setStatus("connected");
        setError(null);
        reconnectAttemptsRef.current = 0;
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        break;

      case "event":
        eventBufferRef.current.push(msg.event);
        scheduleFlush();
        break;

      case "event_batch":
        eventBufferRef.current.push(...msg.events);
        scheduleFlush();
        break;

      case "snapshot":
        setSnapshot(msg.data);
        break;

      case "health":
        setHealthMetrics(msg.metrics);
        break;

      case "breakpoints":
        setBreakpointState(msg.state);
        break;

      // Phase 2: Scratchpad
      case "scratchpad_state": {
        const safe: Record<string, unknown> = Object.create(null);
        for (const [k, v] of Object.entries(msg.data)) {
          if (!BLOCKED_KEYS.has(k)) {
            safe[k] = v;
          }
        }
        setScratchpadState(safe);
        break;
      }

      case "scratchpad_update":
        if (typeof msg.key === "string" && !BLOCKED_KEYS.has(msg.key)) {
          setScratchpadState((prev) => ({ ...prev, [msg.key]: msg.value }));
        }
        break;

      // Phase 2: Derived
      case "derived_state": {
        const safe: Record<string, unknown> = Object.create(null);
        for (const [k, v] of Object.entries(msg.data)) {
          if (!BLOCKED_KEYS.has(k)) {
            safe[k] = v;
          }
        }
        setDerivedState(safe);
        break;
      }

      case "derived_update":
        if (typeof msg.id === "string" && !BLOCKED_KEYS.has(msg.id)) {
          setDerivedState((prev) => ({ ...prev, [msg.id]: msg.value }));
        }
        break;

      // Phase 2: Fork (C3: handle fork_complete properly)
      case "fork_complete":
        if (pendingForkRef.current) {
          pendingForkRef.current = false;
          // M15: Clear the fallback timeout since we got a response
          if (forkTimeoutRef.current) {
            clearTimeout(forkTimeoutRef.current);
            forkTimeoutRef.current = null;
          }
          sendRef.current({ type: "request_events" });
        }
        break;

      // Phase 2: Token streaming
      // M7: Validate message fields before processing
      case "token_stream":
        if (typeof msg.agentId !== "string" || !msg.agentId || typeof msg.tokens !== "string" || typeof msg.tokenCount !== "number") {
          break;
        }
        setStreamingTokens((prev) => {
          // Cap max concurrent streams
          if (!prev.has(msg.agentId) && prev.size >= MAX_STREAMING_AGENTS) {
            return prev;
          }

          const next = new Map(prev);
          const existing = next.get(msg.agentId);
          const tokens = (existing?.tokens ?? "") + msg.tokens;

          // Cap token buffer at 10KB per agent
          next.set(msg.agentId, {
            tokens: tokens.length > 10_000 ? tokens.slice(-10_000) : tokens,
            count: msg.tokenCount,
            startedAt: existing?.startedAt ?? Date.now(),
          });

          return next;
        });
        break;

      case "stream_done":
        if (typeof msg.agentId !== "string" || !msg.agentId) {
          break;
        }
        setStreamingTokens((prev) => {
          const next = new Map(prev);
          next.delete(msg.agentId);

          return next;
        });
        break;

      case "pong":
        // Keepalive response — no action needed
        break;

      case "error":
        setError(`${msg.code}: ${msg.message}`);
        break;

      default: {
        // M8: Exhaustive switch — catches unhandled message types at compile time
        const _exhaustive: never = msg;
        console.warn("[DevTools] Unhandled message type:", (_exhaustive as { type: string }).type);
      }
    }
  }, [scheduleFlush]);

  // Keep handleMessage ref in sync
  useEffect(() => { handleMessageRef.current = handleMessage; }, [handleMessage]);

  const connect = useCallback((url: string) => {
    // Clean up existing connection
    if (wsRef.current) {
      shouldReconnectRef.current = false;
      wsRef.current.close();
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    urlRef.current = url;
    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    setStatus("connecting");
    setError(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Welcome message from server sets status to "connected"
      // Start keepalive pings
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
      }
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30_000);
    };

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string);
        if (!isValidServerMessage(parsed)) {
          console.warn("[DevTools] Received unknown WebSocket message type:", parsed?.type);

          return;
        }
        // DX#6: Use ref to avoid connect depending on handleMessage identity
        handleMessageRef.current(parsed);
      } catch {
        console.warn("[DevTools] Received malformed WebSocket message");
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket connection error");
    };

    ws.onclose = () => {
      // Guard against stale onclose from a previous socket nulling the current ref
      if (wsRef.current !== ws) {
        return;
      }
      wsRef.current = null;
      // Clean up ping timer for this socket
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (shouldReconnectRef.current && urlRef.current) {
        reconnectAttemptsRef.current++;
        if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
          setStatus("error");
          setError(`Could not reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
          shouldReconnectRef.current = false;

          return;
        }
        setStatus("connecting");
        const delay = Math.min(
          reconnectDelayRef.current * (1 + Math.random() * 0.5),
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectTimerRef.current = setTimeout(() => {
          if (urlRef.current) {
            connect(urlRef.current);
          }
        }, delay);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY_MS);
      } else {
        setStatus("disconnected");
      }
    };
  // DX#6: No deps on handleMessage — we read from handleMessageRef.current
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // E10/M13: Clear stale streaming tokens on disconnect
    setStreamingTokens(new Map());
    setStatus("disconnected");
    setSessionId(null);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Keep sendRef in sync for use in handleMessage
  useEffect(() => { sendRef.current = send; }, [send]);

  // M3: Clean up stale streaming tokens periodically
  useEffect(() => {
    streamCleanupTimerRef.current = setInterval(() => {
      setStreamingTokens((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);

        for (const [agentId, data] of next) {
          if (now - data.startedAt > STREAM_TIMEOUT_MS) {
            next.delete(agentId);
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    }, 30_000);

    return () => {
      if (streamCleanupTimerRef.current) {
        clearInterval(streamCleanupTimerRef.current);
      }
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
      }
      // M15: Clean up fork timeout
      if (forkTimeoutRef.current) {
        clearTimeout(forkTimeoutRef.current);
      }
    };
  }, []);

  // E12: Toggle pause
  const togglePause = useCallback(() => {
    const wasPaused = pausedRef.current;
    const nowPaused = !wasPaused;
    pausedRef.current = nowPaused;
    setIsPaused(nowPaused);

    if (wasPaused) {
      // Unpause: merge buffered events
      const pending = pendingWhilePausedRef.current;
      pendingWhilePausedRef.current = [];
      setPendingCount(0);
      if (pending.length > 0) {
        setEvents((prev) => {
          const next = prev.concat(pending);

          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      }
    }
  }, []);

  return {
    status,
    sessionId,
    events,
    snapshot,
    healthMetrics,
    breakpointState,
    error,
    scratchpadState,
    derivedState,
    streamingTokens,
    isPaused,
    pendingCount,
    togglePause,
    connect,
    disconnect,
    send,
    requestSnapshot: useCallback(() => send({ type: "request_snapshot" }), [send]),
    requestHealth: useCallback(() => send({ type: "request_health" }), [send]),
    requestEvents: useCallback((since?: number) => send({ type: "request_events", since }), [send]),
    requestBreakpoints: useCallback(() => send({ type: "request_breakpoints" }), [send]),
    resumeBreakpoint: useCallback((id: string, modifications?: { input?: string; skip?: boolean }) => {
      send({ type: "resume_breakpoint", breakpointId: id, modifications });
    }, [send]),
    cancelBreakpoint: useCallback((id: string, reason?: string) => {
      send({ type: "cancel_breakpoint", breakpointId: id, reason });
    }, [send]),
    exportSession: useCallback(() => {
      // Export is handled client-side by SessionPanel.handleExportToFile
    }, []),
    importSession: useCallback((data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed && Array.isArray(parsed.events)) {
          const valid = validateEvents(parsed.events);
          if (valid.length === 0) {
            setError("Invalid session file: no valid events found");
          } else {
            setEvents(valid);
            if (valid.length < parsed.events.length) {
              setError(`Imported ${valid.length}/${parsed.events.length} events (${parsed.events.length - valid.length} invalid events skipped)`);
            }
          }
        } else {
          setError("Invalid session file: missing events array");
        }
      } catch {
        setError("Invalid session file: could not parse JSON");
      }
    }, []),
    clearEvents: useCallback(() => setEvents([]), []),
    // Phase 2 methods
    requestScratchpad: useCallback(() => send({ type: "request_scratchpad" }), [send]),
    requestDerived: useCallback(() => send({ type: "request_derived" }), [send]),
    // C3: Fixed — uses fork_complete message instead of setTimeout
    // M12: Validate eventId is a finite positive integer
    forkFromSnapshot: useCallback((eventId: number) => {
      if (!Number.isFinite(eventId) || eventId < 0) {
        setError("Invalid event ID for fork");

        return;
      }
      pendingForkRef.current = true;
      send({ type: "fork_from_snapshot", eventId });
      // M15: Store timeout ref for cleanup on unmount
      if (forkTimeoutRef.current) {
        clearTimeout(forkTimeoutRef.current);
      }
      forkTimeoutRef.current = setTimeout(() => {
        forkTimeoutRef.current = null;
        if (pendingForkRef.current) {
          pendingForkRef.current = false;
          send({ type: "request_events" });
          setError("Fork may have failed — no confirmation received");
        }
      }, 10_000);
    }, [send]),
  };
}
