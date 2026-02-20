import { useCallback, useMemo, useRef, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";
import { EventDetail } from "../components/EventDetail";
import { TimelineBar } from "../components/TimelineBar";
import { TimelineMinimap } from "../components/TimelineMinimap";

interface TimelineViewProps {
  events: DebugEvent[];
  /** Optional replay cursor line timestamp */
  replayCursor?: number | null;
  /** Optional fork handler */
  onForkFromSnapshot?: (eventId: number) => void;
  /** Optional token stream data */
  streamingTokens?: Map<string, { tokens: string; count: number }>;
}

const EVENT_TYPE_LABELS: Partial<Record<DebugEventType, string>> = {
  agent_start: "Start",
  agent_complete: "Complete",
  agent_error: "Error",
  agent_retry: "Retry",
  guardrail_check: "Guardrail",
  constraint_evaluate: "Constraint",
  resolver_start: "Resolver Start",
  resolver_complete: "Resolver Done",
  resolver_error: "Resolver Error",
  approval_request: "Approval Req",
  approval_response: "Approval Res",
  handoff_start: "Handoff",
  handoff_complete: "Handoff Done",
  pattern_start: "Pattern",
  pattern_complete: "Pattern Done",
  dag_node_update: "DAG Node",
  breakpoint_hit: "Breakpoint",
  breakpoint_resumed: "Resumed",
  derivation_update: "Derivation",
  scratchpad_update: "Scratchpad",
  reflection_iteration: "Reflection",
  race_start: "Race",
  race_winner: "Winner",
  race_cancelled: "Cancelled",
  reroute: "Reroute",
  debate_round: "Debate",
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

export function TimelineView({ events, replayCursor, onForkFromSnapshot, streamingTokens }: TimelineViewProps) {
  const [selectedEvent, setSelectedEvent] = useState<DebugEvent | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<DebugEventType>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  // Zoom/pan state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0); // ms offset from start

  // Pan drag state
  const panDragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const laneContainerRef = useRef<HTMLDivElement>(null);

  // Compute unique agents
  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.agentId) {
        set.add(e.agentId);
      }
    }

    return Array.from(set).sort();
  }, [events]);

  // Compute time range (full, unzoomed)
  const timeRange = useMemo(() => {
    if (events.length === 0) {
      return { start: 0, end: 1, duration: 1 };
    }

    const start = events[0]!.timestamp;
    const end = events[events.length - 1]!.timestamp;
    const duration = Math.max(end - start, 1);

    return { start, end, duration };
  }, [events]);

  // Visible time range (zoomed/panned)
  const visibleRange = useMemo(() => {
    const visibleDuration = timeRange.duration / zoomLevel;
    const maxOffset = timeRange.duration - visibleDuration;
    const clampedOffset = Math.max(0, Math.min(panOffset, maxOffset));
    const visibleStart = timeRange.start + clampedOffset;

    return {
      start: visibleStart,
      duration: visibleDuration,
      end: visibleStart + visibleDuration,
    };
  }, [timeRange, zoomLevel, panOffset]);

  // Minimap fractions
  const viewStart = timeRange.duration > 0 ? (visibleRange.start - timeRange.start) / timeRange.duration : 0;
  const viewEnd = timeRange.duration > 0 ? (visibleRange.end - timeRange.start) / timeRange.duration : 1;

  // Filter events
  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (typeFilter.size > 0) {
      filtered = filtered.filter((e) => typeFilter.has(e.type));
    }
    if (agentFilter) {
      filtered = filtered.filter((e) => e.agentId === agentFilter);
    }

    return filtered;
  }, [events, typeFilter, agentFilter]);

  // Group events by agent for lane display
  const lanes = useMemo(() => {
    const laneMap = new Map<string, DebugEvent[]>();
    laneMap.set("__global__", []);

    for (const agent of agents) {
      laneMap.set(agent, []);
    }

    for (const event of filteredEvents) {
      const lane = event.agentId ?? "__global__";
      if (!laneMap.has(lane)) {
        laneMap.set(lane, []);
      }
      laneMap.get(lane)!.push(event);
    }

    // Remove empty lanes
    for (const [key, value] of laneMap) {
      if (value.length === 0) {
        laneMap.delete(key);
      }
    }

    return laneMap;
  }, [filteredEvents, agents]);

  // Toggle type filter
  const toggleType = (type: DebugEventType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }

      return next;
    });
  };

  // Get unique event types present
  const presentTypes = useMemo(() => {
    const set = new Set<DebugEventType>();
    for (const e of events) {
      set.add(e.type);
    }

    return Array.from(set);
  }, [events]);

  // Compute rows for all events in a lane
  function computeRows(laneEvts: DebugEvent[], range: { start: number; duration: number }): Map<number, number> {
    const rowMap = new Map<number, number>();
    const getLeft = (e: DebugEvent) => ((e.timestamp - range.start) / range.duration) * 100;
    const getRight = (e: DebugEvent) => {
      const dur = (e as Record<string, unknown>).durationMs;
      const w = typeof dur === "number" && dur > 0 ? (dur / range.duration) * 100 : 0.5;

      return getLeft(e) + w;
    };

    const rowRightEdges: number[] = [];

    for (const event of laneEvts) {
      const myLeft = getLeft(event);
      const myRight = getRight(event);

      let row = 0;
      while (row < rowRightEdges.length && rowRightEdges[row]! > myLeft) {
        row++;
      }

      rowMap.set(event.id, row);
      rowRightEdges[row] = myRight;
    }

    return rowMap;
  }

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(z + 1, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => {
      const next = Math.max(z - 1, MIN_ZOOM);
      if (next === 1) {
        setPanOffset(0);
      }

      return next;
    });
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1);
    setPanOffset(0);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        setZoomLevel((z) => {
          const next = Math.max(MIN_ZOOM, Math.min(z + delta, MAX_ZOOM));
          if (next === 1) {
            setPanOffset(0);
          }

          return next;
        });
      } else if (zoomLevel > 1) {
        // Horizontal scroll to pan
        const panDelta = (e.deltaX || e.deltaY) * (timeRange.duration / zoomLevel / 500);
        setPanOffset((p) => {
          const maxOffset = timeRange.duration - timeRange.duration / zoomLevel;

          return Math.max(0, Math.min(p + panDelta, maxOffset));
        });
      }
    },
    [zoomLevel, timeRange.duration],
  );

  // Pan drag handlers
  const handlePanMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoomLevel <= 1) {
        return;
      }
      // Only pan on middle-click or when clicking empty space
      if (e.button === 1 || (e.target === e.currentTarget)) {
        e.preventDefault();
        panDragRef.current = { startX: e.clientX, startOffset: panOffset };
      }
    },
    [zoomLevel, panOffset],
  );

  const handlePanMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!panDragRef.current || !laneContainerRef.current) {
        return;
      }

      const containerWidth = laneContainerRef.current.clientWidth;
      const pxDelta = panDragRef.current.startX - e.clientX;
      const msDelta = (pxDelta / containerWidth) * (timeRange.duration / zoomLevel);
      const maxOffset = timeRange.duration - timeRange.duration / zoomLevel;
      setPanOffset(Math.max(0, Math.min(panDragRef.current.startOffset + msDelta, maxOffset)));
    },
    [timeRange.duration, zoomLevel],
  );

  const handlePanMouseUp = useCallback(() => {
    panDragRef.current = null;
  }, []);

  // Minimap pan
  const handleMinimapPan = useCallback(
    (fraction: number) => {
      const visibleDuration = timeRange.duration / zoomLevel;
      const maxOffset = timeRange.duration - visibleDuration;
      // Center the visible window on the clicked fraction
      const targetOffset = fraction * timeRange.duration - visibleDuration / 2;
      setPanOffset(Math.max(0, Math.min(targetOffset, maxOffset)));
    },
    [timeRange.duration, zoomLevel],
  );

  // Time axis labels for visible range
  const timeAxisLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const ms = (visibleRange.start - timeRange.start) + (visibleRange.duration * i / 4);
      labels.push(`${Math.round(ms)}ms`);
    }

    return labels;
  }, [visibleRange, timeRange.start]);

  // Replay cursor position
  const replayCursorPct = replayCursor != null
    ? ((replayCursor - visibleRange.start) / visibleRange.duration) * 100
    : null;

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl">📊</div>
          <p>No events recorded yet</p>
          <p className="mt-1 text-xs">Run an agent to see timeline events</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
        {/* Agent filter */}
        <select
          value={agentFilter ?? ""}
          onChange={(e) => setAgentFilter(e.target.value || null)}
          aria-label="Filter by agent"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-1">
          {presentTypes.map((type) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                typeFilter.size === 0 || typeFilter.has(type)
                  ? ""
                  : "!bg-zinc-800 !text-zinc-500 !border-zinc-700"
              }`}
              style={{
                backgroundColor: `${EVENT_COLORS[type]}20`,
                color: EVENT_COLORS[type],
                border: `1px solid ${EVENT_COLORS[type]}40`,
              }}
            >
              {EVENT_TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={zoomLevel <= MIN_ZOOM}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            onClick={handleZoomReset}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
            aria-label="Reset zoom"
          >
            {zoomLevel}x
          </button>
          <button
            onClick={handleZoomIn}
            disabled={zoomLevel >= MAX_ZOOM}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        {/* Event count */}
        <span className="text-xs text-zinc-500">
          {filteredEvents.length}/{events.length} events
        </span>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lanes */}
        <div
          ref={laneContainerRef}
          className="flex-1 overflow-auto"
          onWheel={handleWheel}
          onMouseDown={handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={handlePanMouseUp}
          onMouseLeave={handlePanMouseUp}
          style={{ cursor: zoomLevel > 1 ? "grab" : undefined }}
        >
          <div className="min-w-[600px]">
            {Array.from(lanes).map(([laneId, laneEvents]) => {
              const rowMap = computeRows(laneEvents, visibleRange);
              let maxRow = 0;
              for (const r of rowMap.values()) {
                if (r > maxRow) {
                  maxRow = r;
                }
              }

              return (
                <div key={laneId} className="flex border-b border-zinc-800/50">
                  {/* Lane label */}
                  <div className="sticky left-0 z-10 flex w-32 shrink-0 items-center border-r border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400">
                    {laneId === "__global__" ? "Global" : laneId}
                  </div>

                  {/* Event bars */}
                  <div className="relative flex-1 px-1" style={{ minHeight: `${Math.max(36, 4 + maxRow * 24 + 24)}px` }}>
                    {laneEvents.map((event) => (
                      <TimelineBar
                        key={event.id}
                        event={event}
                        timeRange={visibleRange}
                        isSelected={selectedEvent?.id === event.id}
                        onClick={() => setSelectedEvent(
                          selectedEvent?.id === event.id ? null : event,
                        )}
                        row={rowMap.get(event.id) ?? 0}
                      />
                    ))}

                    {/* Replay cursor line */}
                    {replayCursorPct != null && replayCursorPct >= 0 && replayCursorPct <= 100 && (
                      <div
                        className="absolute top-0 bottom-0 z-30 w-px bg-red-500"
                        style={{ left: `${replayCursorPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedEvent && (
          <div className="w-80 shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-900">
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              onForkFromSnapshot={onForkFromSnapshot}
            />
          </div>
        )}
      </div>

      {/* Token stream panel */}
      {streamingTokens && streamingTokens.size > 0 && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Live Tokens</div>
          <div className="flex gap-3 overflow-x-auto">
            {Array.from(streamingTokens).map(([agentId, data]) => (
              <div key={agentId} className="min-w-[200px] max-w-[400px]">
                <div className="mb-0.5 text-[10px] text-zinc-500">{agentId} ({data.count} tokens)</div>
                <div className="max-h-16 overflow-y-auto rounded bg-zinc-800/80 px-2 py-1 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                  {data.tokens.slice(-500)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Minimap (only when zoomed) */}
      {zoomLevel > 1 && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-1">
          <div className="flex items-center gap-2">
            <div className="w-32 shrink-0" />
            <TimelineMinimap
              events={filteredEvents}
              timeRange={timeRange}
              viewStart={viewStart}
              viewEnd={viewEnd}
              onPan={handleMinimapPan}
            />
          </div>
        </div>
      )}

      {/* Time axis */}
      <div className="flex border-t border-zinc-800 bg-zinc-900 px-4 py-1">
        <div className="w-32 shrink-0" />
        <div className="flex flex-1 justify-between text-[10px] text-zinc-600">
          {timeAxisLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
