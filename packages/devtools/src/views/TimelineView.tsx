import { useCallback, useEffect, useMemo, useState } from "react";
import { EventDetail } from "../components/EventDetail";
import { SearchBar } from "../components/SearchBar";
import { TimelineBar } from "../components/TimelineBar";
import { TimelineMinimap } from "../components/TimelineMinimap";
import type { Anomaly } from "../hooks/use-anomalies";
import { useTimelineFilters } from "../hooks/use-timeline-filters";
import { useTimelineZoom } from "../hooks/use-timeline-zoom";
import { EVENT_COLORS } from "../lib/colors";
import type { TimeFormat } from "../lib/time-format";
import { formatTimestamp } from "../lib/time-format";
import {
  type DebugEvent,
  type DebugEventType,
  ERROR_EVENT_TYPES,
} from "../lib/types";

interface TimelineViewProps {
  events: DebugEvent[];
  /** Optional replay cursor line timestamp */
  replayCursor?: number | null;
  /** Optional fork handler */
  onForkFromSnapshot?: (eventId: number) => void;
  /** Optional token stream data */
  streamingTokens?: Map<string, { tokens: string; count: number }>;
  /** Optional anomalies detected */
  anomalies?: Anomaly[];
  /** E7: Time format */
  timeFormat?: TimeFormat;
  onTimeFormatChange?: (format: TimeFormat) => void;
  /** E12: Pause live updates */
  isPaused?: boolean;
  pendingCount?: number;
  onTogglePause?: () => void;
  /** E9: Replay from event */
  onReplayFromHere?: (eventId: number) => void;
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

/** Compute row packing for overlapping events in a lane */
function computeRows(
  laneEvts: DebugEvent[],
  range: { start: number; duration: number },
): Map<number, number> {
  const rowMap = new Map<number, number>();
  const getLeft = (e: DebugEvent) =>
    ((e.timestamp - range.start) / range.duration) * 100;
  const getRight = (e: DebugEvent) => {
    const w =
      typeof e.durationMs === "number" && e.durationMs > 0
        ? (e.durationMs / range.duration) * 100
        : 0.5;

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

export function TimelineView({
  events,
  replayCursor,
  onForkFromSnapshot,
  streamingTokens,
  anomalies,
  timeFormat = "elapsed",
  onTimeFormatChange,
  isPaused,
  pendingCount,
  onTogglePause,
  onReplayFromHere,
}: TimelineViewProps) {
  const [selectedEvent, setSelectedEvent] = useState<DebugEvent | null>(null);

  // D1: Stable callback for TimelineBar — toggles selection without creating new closures per bar
  const handleSelectEvent = useCallback((event: DebugEvent) => {
    setSelectedEvent((prev) => (prev?.id === event.id ? null : event));
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // D2: Escape key closes detail panel
  useEffect(() => {
    if (!selectedEvent) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
      ) {
        setSelectedEvent(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEvent]);

  // Extracted hooks
  const zoom = useTimelineZoom(events);
  const filters = useTimelineFilters(events);

  // Build anomaly lookup set for quick highlight checks
  const anomalyEventIds = useMemo(() => {
    if (!anomalies || anomalies.length === 0) {
      return new Set<number>();
    }

    return new Set(anomalies.map((a) => a.eventId));
  }, [anomalies]);

  // Group events by agent and pre-compute row packing (memoized together)
  const lanesWithRows = useMemo(() => {
    const laneMap = new Map<string, DebugEvent[]>();
    laneMap.set("__global__", []);

    for (const agent of filters.agents) {
      laneMap.set(agent, []);
    }

    for (const event of filters.filteredEvents) {
      const lane = event.agentId ?? "__global__";
      if (!laneMap.has(lane)) {
        laneMap.set(lane, []);
      }
      laneMap.get(lane)!.push(event);
    }

    // Remove empty lanes, compute rows
    const result = new Map<
      string,
      { events: DebugEvent[]; rowMap: Map<number, number>; maxRow: number }
    >();

    for (const [key, laneEvents] of laneMap) {
      if (laneEvents.length === 0) {
        continue;
      }

      const rowMap = computeRows(laneEvents, zoom.visibleRange);
      let maxRow = 0;
      for (const r of rowMap.values()) {
        if (r > maxRow) {
          maxRow = r;
        }
      }
      result.set(key, { events: laneEvents, rowMap, maxRow });
    }

    return result;
  }, [filters.filteredEvents, filters.agents, zoom.visibleRange]);

  // Replay cursor position
  const replayCursorPct = zoom.getReplayCursorPct(replayCursor);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">
            📊
          </div>
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
          value={filters.agentFilter ?? ""}
          onChange={(e) => filters.setAgentFilter(e.target.value || null)}
          aria-label="Filter by agent"
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">All agents</option>
          {filters.agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {/* Type filter chips */}
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Filter by event type"
        >
          {filters.presentTypes.map((type) => {
            const isActive =
              filters.typeFilter.size === 0 || filters.typeFilter.has(type);

            return (
              <button
                key={type}
                onClick={() => filters.toggleType(type)}
                aria-pressed={
                  filters.typeFilter.size === 0 || filters.typeFilter.has(type)
                }
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  isActive ? "" : "!bg-zinc-800 !text-zinc-300 !border-zinc-600"
                }`}
                style={{
                  backgroundColor: `${EVENT_COLORS[type]}20`,
                  color: EVENT_COLORS[type],
                  border: `1px solid ${EVENT_COLORS[type]}40`,
                }}
              >
                {EVENT_TYPE_LABELS[type] ?? type}
              </button>
            );
          })}
        </div>

        {/* M7/E1/E15: Error filter shortcut — uses ERROR_EVENT_TYPES constant */}
        <button
          onClick={() => {
            const isErrorOnly =
              filters.typeFilter.size === ERROR_EVENT_TYPES.size &&
              [...ERROR_EVENT_TYPES].every((t) => filters.typeFilter.has(t));

            if (isErrorOnly) {
              // Clear filter — show all types again
              filters.setTypeFilter(new Set());
            } else {
              // Set filter to only error types
              filters.setTypeFilter(new Set(ERROR_EVENT_TYPES));
            }
          }}
          className="rounded border border-red-800/50 bg-red-950/30 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-950/50"
          title="Show only error events"
        >
          Errors
        </button>

        {/* E10: AND/OR filter mode toggle */}
        <button
          onClick={() =>
            filters.setFilterMode(filters.filterMode === "and" ? "or" : "and")
          }
          className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
            filters.filterMode === "or"
              ? "border-blue-500/50 bg-blue-950/30 text-blue-400"
              : "border-zinc-700 bg-zinc-800 text-zinc-400"
          }`}
          title={`Filter mode: ${filters.filterMode.toUpperCase()} — click to toggle`}
        >
          {filters.filterMode.toUpperCase()}
        </button>

        {/* Search */}
        <div className="min-w-[180px] max-w-[260px]">
          <SearchBar events={events} onResults={filters.setSearchMatchIds} />
        </div>

        {/* Zoom controls */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={zoom.handleZoomOut}
            disabled={zoom.zoomLevel <= 1}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            onClick={zoom.handleZoomReset}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
            aria-label="Reset zoom"
          >
            {zoom.zoomLevel}x
          </button>
          <button
            onClick={zoom.handleZoomIn}
            disabled={zoom.zoomLevel >= 20}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>

        {/* E7: Time format toggle */}
        {onTimeFormatChange && (
          <div
            className="flex rounded border border-zinc-700"
            role="group"
            aria-label="Time format"
          >
            {(["ms", "elapsed", "clock"] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => onTimeFormatChange(fmt)}
                className={`px-1.5 py-0.5 text-[10px] ${
                  timeFormat === fmt
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        )}

        {/* E12: Pause button */}
        {onTogglePause && (
          <button
            onClick={onTogglePause}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${
              isPaused
                ? "border-amber-500/50 bg-amber-950/30 text-amber-400"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            title={isPaused ? "Resume live updates" : "Pause live updates"}
          >
            {isPaused ? "▶" : "⏸"}
            {isPaused && pendingCount != null && pendingCount > 0 && (
              <span className="rounded-full bg-amber-500/30 px-1 text-amber-300">
                {pendingCount}
              </span>
            )}
          </button>
        )}

        {/* Event count */}
        <span className="text-xs text-zinc-500">
          {filters.filteredEvents.length}/{events.length} events
        </span>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lanes */}
        <div
          ref={zoom.laneContainerRef}
          className="flex-1 overflow-auto"
          onWheel={zoom.handleWheel}
          onMouseDown={zoom.handlePanMouseDown}
          onMouseMove={zoom.handlePanMouseMove}
          onMouseUp={zoom.handlePanMouseUp}
          onMouseLeave={zoom.handlePanMouseUp}
          style={{ cursor: zoom.zoomLevel > 1 ? "grab" : undefined }}
        >
          <div className="min-w-[600px]">
            {Array.from(lanesWithRows).map(
              ([laneId, { events: laneEvents, rowMap, maxRow }]) => (
                <div key={laneId} className="flex border-b border-zinc-800/50">
                  {/* Lane label */}
                  <div className="sticky left-0 z-10 flex w-32 shrink-0 items-center border-r border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400">
                    {laneId === "__global__" ? "Global" : laneId}
                  </div>

                  {/* Event bars */}
                  <div
                    className="relative flex-1 px-1"
                    style={{
                      minHeight: `${Math.max(36, 4 + maxRow * 24 + 24)}px`,
                    }}
                  >
                    {laneEvents.map((event) => (
                      <TimelineBar
                        key={event.id}
                        event={event}
                        timeRange={zoom.visibleRange}
                        isSelected={selectedEvent?.id === event.id}
                        onSelect={handleSelectEvent}
                        row={rowMap.get(event.id) ?? 0}
                        isAnomaly={anomalyEventIds.has(event.id)}
                      />
                    ))}

                    {/* Replay cursor line */}
                    {replayCursorPct != null &&
                      replayCursorPct >= 0 &&
                      replayCursorPct <= 100 && (
                        <div
                          className="absolute top-0 bottom-0 z-30 w-px bg-red-500"
                          style={{ left: `${replayCursorPct}%` }}
                        />
                      )}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedEvent && (
          <div className="w-80 shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-900">
            <EventDetail
              event={selectedEvent}
              onClose={handleCloseDetail}
              onForkFromSnapshot={onForkFromSnapshot}
              onReplayFromHere={onReplayFromHere}
              timeFormat={timeFormat}
              baseTimestamp={events[0]?.timestamp}
            />
          </div>
        )}
      </div>

      {/* Token stream panel */}
      {streamingTokens && streamingTokens.size > 0 && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Live Tokens
          </div>
          <div className="flex gap-3 overflow-x-auto">
            {Array.from(streamingTokens).map(([agentId, data]) => (
              <div key={agentId} className="min-w-[200px] max-w-[400px]">
                <div className="mb-0.5 text-[10px] text-zinc-500">
                  {agentId} ({data.count} tokens)
                </div>
                <div className="max-h-16 overflow-y-auto rounded bg-zinc-800/80 px-2 py-1 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all">
                  {data.tokens.slice(-500)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Minimap (only when zoomed) */}
      {zoom.zoomLevel > 1 && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-1">
          <div className="flex items-center gap-2">
            <div className="w-32 shrink-0" />
            <TimelineMinimap
              events={filters.filteredEvents}
              timeRange={zoom.timeRange}
              viewStart={zoom.viewStart}
              viewEnd={zoom.viewEnd}
              onPan={zoom.handleMinimapPan}
            />
          </div>
        </div>
      )}

      {/* Time axis — E7: use formatTimestamp */}
      <div className="flex border-t border-zinc-800 bg-zinc-900 px-4 py-1">
        <div className="w-32 shrink-0" />
        <div className="flex flex-1 justify-between text-[10px] text-zinc-500">
          {Array.from({ length: 5 }, (_, i) => {
            const ts =
              zoom.visibleRange.start + (zoom.visibleRange.duration * i) / 4;

            return (
              <span key={i}>
                {formatTimestamp(ts, timeFormat, events[0]?.timestamp)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
