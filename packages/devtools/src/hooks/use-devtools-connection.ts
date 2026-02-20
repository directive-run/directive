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
const RECONNECT_DELAY_MS = 3000;
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

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "welcome":
        setSessionId(msg.sessionId);
        setStatus("connected");
        setError(null);
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

    urlRef.current = url;
    shouldReconnectRef.current = true;
    setStatus("connecting");
    setError(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Welcome message from server sets status to "connected"
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
      wsRef.current = null;
      if (shouldReconnectRef.current && urlRef.current) {
        setStatus("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          if (urlRef.current) {
            connect(urlRef.current);
          }
        }, RECONNECT_DELAY_MS);
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
    exportSession: useCallback(() => send({ type: "export_session" }), [send]),
    importSession: useCallback((data: string) => send({ type: "import_session", data }), [send]),
    clearEvents: useCallback(() => setEvents([]), []),
  };
}
