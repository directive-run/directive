import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentHealthMetrics,
  BreakpointState,
  ClientMessage,
  ConnectionStatus,
  DebugEvent,
  DevToolsSnapshot,
  ServerMessage,
} from "../lib/types";

export interface DevToolsConnection {
  status: ConnectionStatus;
  sessionId: string | null;
  events: DebugEvent[];
  snapshot: DevToolsSnapshot | null;
  healthMetrics: Record<string, AgentHealthMetrics>;
  breakpointState: BreakpointState;
  error: string | null;
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
}

const INITIAL_BREAKPOINT_STATE: BreakpointState = { pending: [], resolved: [], cancelled: [] };
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 20;
const MAX_EVENTS = 5000;

export function useDevToolsConnection(): DevToolsConnection {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [snapshot, setSnapshot] = useState<DevToolsSnapshot | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<Record<string, AgentHealthMetrics>>({});
  const [breakpointState, setBreakpointState] = useState<BreakpointState>(INITIAL_BREAKPOINT_STATE);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const urlRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setEvents((prev) => {
          const next = [...prev, msg.event];

          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
        break;

      case "event_batch":
        setEvents((prev) => {
          const next = [...prev, ...msg.events];

          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
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

      case "pong":
        // Keepalive response — no action needed
        break;

      case "error":
        setError(`${msg.code}: ${msg.message}`);
        break;
    }
  }, []);

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
        const msg = JSON.parse(e.data as string) as ServerMessage;
        handleMessage(msg);
      } catch {
        // Ignore malformed messages
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
  }, [handleMessage]);

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
    setStatus("disconnected");
    setSessionId(null);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
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
    };
  }, []);

  return {
    status,
    sessionId,
    events,
    snapshot,
    healthMetrics,
    breakpointState,
    error,
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
          setEvents(parsed.events);
        } else {
          setError("Invalid session file: missing events array");
        }
      } catch {
        setError("Invalid session file: could not parse JSON");
      }
    }, []),
    clearEvents: useCallback(() => setEvents([]), []),
  };
}
