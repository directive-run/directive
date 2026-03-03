"use client";

import { DEVTOOLS_EVENT_NAME } from "@directive-run/core/plugins";
import { useCallback, useEffect, useRef } from "react";
import { useDevToolsSystem } from "../DevToolsSystemContext";
import { FLUSH_INTERVAL_MS } from "../constants";
import type { DebugEvent } from "../types";

/**
 * Thin EventSource bridge — all state lives in the Directive system.
 *
 * Creates/closes EventSource, dispatches events into the system.
 * Reconnection timing is handled by the connection module's
 * reconnectNeeded constraint + reconnect resolver.
 * Server reset is handled by the serverReset effect.
 */
export function useDevToolsStream() {
  const system = useDevToolsSystem();
  const esRef = useRef<EventSource | null>(null);
  const maxIdRef = useRef(-1);
  const pendingRef = useRef<DebugEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    flushTimerRef.current = null;
    const batch = pendingRef.current;
    if (batch.length === 0) {
      return;
    }
    pendingRef.current = [];
    system.events.connection.pushEvents({ batch });
  }, [system]);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const streamUrl = system.facts.connection.streamUrl;
    system.events.connection.connecting();
    const es = new EventSource(streamUrl);
    esRef.current = es;

    es.onopen = () => {
      system.events.connection.connected();
    };

    es.onmessage = (msg) => {
      try {
        const event: DebugEvent = JSON.parse(msg.data);
        // Deduplicate on reconnect
        if (event.id <= maxIdRef.current) {
          return;
        }
        maxIdRef.current = event.id;

        // Check breakpoints before buffering
        const activeBreakpoints = system.facts.connection.breakpoints.filter(
          (b: { enabled: boolean; eventType: string }) =>
            b.enabled && b.eventType === event.type,
        );
        if (activeBreakpoints.length > 0) {
          // Inject breakpoint label into the event for display
          event.breakpointLabel = (
            activeBreakpoints[0] as { label: string }
          ).label;
          // Push this event first, then pause
          system.events.connection.pushEvents({ batch: [event] });
          system.events.connection.pauseStream({ event });
          es.close();
          esRef.current = null;

          return;
        }

        pendingRef.current.push(event);
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(flushPending, FLUSH_INTERVAL_MS);
        }
      } catch {
        // m9: Log malformed SSE messages in development
        if (process.env.NODE_ENV === "development") {
          console.warn("[DevTools] Failed to parse SSE message:", msg.data);
        }
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      system.events.connection.disconnected();
      system.events.connection.incrementRetry();
      // Reconnection delay is handled by the constraint + resolver
    };
  }, [system, flushPending]);

  // Watch connection.status — when resolver sets it to 'connecting', create new EventSource
  useEffect(() => {
    const unsub = system.watch("connection.status", (newStatus: unknown) => {
      if (newStatus === "connecting" && !esRef.current) {
        connect();
      }
    });

    return unsub;
  }, [system, connect]);

  // Watch isPaused — when resumed, reconnect EventSource
  useEffect(() => {
    let prevPaused = system.facts.connection.isPaused;
    const unsub = system.watch("connection.isPaused", (nowPaused: unknown) => {
      if (prevPaused && !nowPaused && !esRef.current) {
        connect();
      }
      prevPaused = nowPaused as boolean;
    });

    return unsub;
  }, [system, connect]);

  // Initial connection — skip if already disconnected (system-only mode, no AI stream)
  useEffect(() => {
    const status = system.facts.connection.status;
    if (status !== "disconnected") {
      connect();
    }

    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, [connect, system]);

  // Listen for imported events (from file import)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handler = (e: Event) => {
      const imported = (e as CustomEvent).detail as DebugEvent[];
      if (Array.isArray(imported) && imported.length > 0) {
        system.events.connection.importEvents({ imported });
        // Avoid Math.max(...spread) stack overflow for large imports
        maxIdRef.current = imported.reduce(
          (max, ev) => Math.max(max, ev.id),
          -1,
        );
      }
    };

    window.addEventListener("devtools-import", handler);

    return () => window.removeEventListener("devtools-import", handler);
  }, [system]);

  // Listen for client-side AI events (from emitDevToolsEvent bridge)
  // Use refs for handler deps to avoid re-registering the event listener
  const aiEnabledRef = useRef(false);
  const systemRef = useRef(system);
  const flushPendingRef = useRef(flushPending);
  systemRef.current = system;
  flushPendingRef.current = flushPending;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handler = (e: Event) => {
      try {
        const raw = (e as CustomEvent).detail;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return;
        }

        // Validate required DebugEvent shape
        if (
          typeof raw.type !== "string" ||
          typeof raw.id !== "number" ||
          typeof raw.timestamp !== "number"
        ) {
          return;
        }

        const event = raw as DebugEvent;

        // Auto-enable AI tabs when first client-side event arrives (dedup with ref)
        if (!aiEnabledRef.current) {
          aiEnabledRef.current = true;
          systemRef.current.events.connection.enableAi();
        }

        // Push into the same batch pipeline as SSE events
        pendingRef.current.push(event);
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(
            flushPendingRef.current,
            FLUSH_INTERVAL_MS,
          );
        }
      } catch {
        // Bridge listener must never crash DevTools
      }
    };

    window.addEventListener(DEVTOOLS_EVENT_NAME, handler);

    return () => {
      window.removeEventListener(DEVTOOLS_EVENT_NAME, handler);
      // Reset so remount can re-enable AI for a new system
      aiEnabledRef.current = false;
    };
  }, []); // stable — uses refs for all mutable deps

  // Manual reconnect (exposed for "click to retry" after max retries)
  const reconnect = useCallback(() => {
    system.events.connection.resetRetries();
    maxIdRef.current = -1;
    connect();
  }, [system, connect]);

  return { reconnect };
}
