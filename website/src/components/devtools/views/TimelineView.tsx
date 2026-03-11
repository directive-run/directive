"use client";

import { useSelector } from "@directive-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDevToolsSystem } from "../DevToolsSystemContext";
import { EmptyState } from "../EmptyState";
import {
  CLUSTER_GAP_MS,
  EVENT_COLORS,
  EVENT_LABELS,
  SYSTEM_EVENT_COLORS,
  SYSTEM_EVENT_LABELS,
  TRACE_EVENT_CATEGORIES,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../constants";
import type { DebugEvent, NormalizedTraceEvent } from "../types";
import { Z_DRAWER } from "../z-index";

// ---------------------------------------------------------------------------
// Unified lane event — normalized shape for both AI and system events
// ---------------------------------------------------------------------------

interface LaneEvent {
  id: string;
  timestamp: number;
  type: string;
  laneId: string;
  source: "ai" | "system";
  // AI-specific fields preserved for detail panel
  agentId?: string;
  durationMs?: number;
  guardrailName?: string;
  guardrailType?: string;
  passed?: boolean;
  reason?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  inputLength?: number;
  outputLength?: number;
  modelId?: string;
  description?: string;
  errorMessage?: string;
  error?: string;
  errorCode?: string;
  breakpointLabel?: string;
  // System event data
  data?: unknown;
  [key: string]: unknown;
}

// Safe JSON.stringify that handles circular references and caps output size
const SAFE_STRINGIFY_MAX = 2000;
function safeStringify(value: unknown): string {
  try {
    const raw = JSON.stringify(value);

    return raw.length > SAFE_STRINGIFY_MAX
      ? raw.slice(0, SAFE_STRINGIFY_MAX) + "..."
      : raw;
  } catch {
    return "[unserializable]";
  }
}

// AI span pairs: start type → [complete type, error type]
const AI_SPAN_PAIRS: Record<string, [string, string]> = {
  agent_start: ["agent_complete", "agent_error"],
  task_start: ["task_complete", "task_error"],
};

// System span pairs: start type → [complete type, error type]
const SYSTEM_SPAN_PAIRS: Record<string, [string, string]> = {
  "resolver.start": ["resolver.complete", "resolver.error"],
  "reconcile.start": ["reconcile.end", "reconcile.end"],
};

// Merged color + label lookups
const ALL_COLORS: Record<string, string> = {
  ...EVENT_COLORS,
  ...SYSTEM_EVENT_COLORS,
};
const ALL_LABELS: Record<string, string> = {
  ...EVENT_LABELS,
  ...SYSTEM_EVENT_LABELS,
};

// All span pair definitions merged
const ALL_SPAN_PAIRS: Record<string, [string, string]> = {
  ...AI_SPAN_PAIRS,
  ...SYSTEM_SPAN_PAIRS,
};

export function TimelineView() {
  const system = useDevToolsSystem();
  const aiEvents = useSelector(
    system,
    (s) => s.facts.connection.events,
  ) as DebugEvent[];
  const systemTraceEvents = useSelector(
    system,
    (s) => s.facts.runtime.traceEvents,
  ) as NormalizedTraceEvent[];
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    events: LaneEvent[];
    laneId: string;
  } | null>(null);

  // SSR-safe portal target for tooltip (escapes DrawerPanel's transform containing block)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // Logarithmic slider helpers — linear slider position is useless at high ZOOM_MAX
  const LOG_RATIO = Math.log(ZOOM_MAX / ZOOM_MIN);
  const zoomToSlider = (z: number) =>
    (Math.log(z / ZOOM_MIN) / LOG_RATIO) * 100;
  const sliderToZoom = (v: number) =>
    ZOOM_MIN * Math.exp((v / 100) * LOG_RATIO);

  // Merge + normalize both sources into unified LaneEvent[]
  const {
    laneIds,
    laneEventsMap,
    hasAiLanes,
    hasSystemLanes,
    minTs,
    range,
    allEvents,
    presentTypes,
    eventIndexById,
  } = useMemo(() => {
    const merged: LaneEvent[] = [];

    // Normalize AI events — string ID with "ai-" prefix
    for (const e of aiEvents) {
      merged.push({
        ...e,
        id: `ai-${e.id}`,
        laneId: e.agentId || "system",
        source: "ai",
      });
    }

    // Normalize system trace events — string ID with "sys-" prefix
    for (const e of systemTraceEvents) {
      const category = TRACE_EVENT_CATEGORIES[e.type] ?? "System";
      merged.push({
        id: `sys-${e.id}`,
        timestamp: e.timestamp,
        type: e.type,
        laneId: category,
        source: "system",
        data: e.data,
      });
    }

    if (merged.length === 0) {
      return {
        laneIds: [],
        laneEventsMap: new Map<string, LaneEvent[]>(),
        hasAiLanes: false,
        hasSystemLanes: false,
        minTs: 0,
        range: 1,
        allEvents: [],
        presentTypes: new Set<string>(),
        eventIndexById: new Map<string, number>(),
      };
    }

    // Sort by timestamp
    merged.sort((a, b) => a.timestamp - b.timestamp);

    // Group by laneId, preserving insertion order
    const ids: string[] = [];
    const map = new Map<string, LaneEvent[]>();
    let hasAi = false;
    let hasSys = false;
    const types = new Set<string>();

    for (const e of merged) {
      types.add(e.type);
      if (e.source === "ai") {
        hasAi = true;
      } else {
        hasSys = true;
      }

      if (!map.has(e.laneId)) {
        ids.push(e.laneId);
        map.set(e.laneId, []);
      }
      map.get(e.laneId)!.push(e);
    }

    // Order lanes: AI lanes first, then system category lanes (System last)
    const LANE_ORDER = [
      "Facts",
      "Derivations",
      "Constraints",
      "Resolvers",
      "Effects",
      "System",
    ];
    const aiLanes = ids
      .filter((id) => {
        const first = map.get(id)?.[0];

        return first?.source === "ai";
      })
      .sort((a, b) => {
        if (a === "system") return 1;
        if (b === "system") return -1;

        return 0;
      });
    const sysLanes = ids
      .filter((id) => {
        const first = map.get(id)?.[0];

        return first?.source === "system";
      })
      .sort((a, b) => {
        const ai = LANE_ORDER.indexOf(a);
        const bi = LANE_ORDER.indexOf(b);

        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
    const orderedIds = [...aiLanes, ...sysLanes];

    const min = merged[0].timestamp;
    const max = merged[merged.length - 1].timestamp;
    const raw = Math.max(max - min, 1);
    const padded = Math.ceil(raw * 1.02);

    // O(1) lookup for selected event by ID
    const indexMap = new Map<string, number>();
    for (let i = 0; i < merged.length; i++) {
      indexMap.set(merged[i].id, i);
    }

    return {
      laneIds: orderedIds,
      laneEventsMap: map,
      hasAiLanes: hasAi,
      hasSystemLanes: hasSys,
      minTs: min,
      range: padded,
      allEvents: merged,
      presentTypes: types,
      eventIndexById: indexMap,
    };
  }, [aiEvents, systemTraceEvents]);

  // Clear stale selection when the event no longer exists (e.g. after clear)
  useEffect(() => {
    if (selected !== null && !eventIndexById.has(selected)) {
      setSelected(null);
    }
  }, [selected, eventIndexById]);

  // Auto-scroll to right edge when new events arrive (if follow is on)
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [aiEvents, systemTraceEvents, follow, zoom]);

  // Cmd/Ctrl + scroll wheel = zoom (exponential so high zoom is reachable)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = 1.003 ** -e.deltaY;
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
    }
  }, []);

  // "Fit" — zoom + scroll to the latest cluster of events
  const handleFitLatest = useCallback(() => {
    if (allEvents.length === 0) {
      return;
    }

    // Walk backwards from the last event; a gap > CLUSTER_GAP_MS starts a new cluster
    let clusterStartIdx = allEvents.length - 1;
    for (let i = allEvents.length - 1; i > 0; i--) {
      if (
        allEvents[i].timestamp - allEvents[i - 1].timestamp >
        CLUSTER_GAP_MS
      ) {
        break;
      }
      clusterStartIdx = i - 1;
    }

    const clusterStart = allEvents[clusterStartIdx].timestamp;
    const clusterEnd = allEvents[allEvents.length - 1].timestamp;
    const clusterRange = Math.max(clusterEnd - clusterStart, 100); // at least 100ms
    const fitRange = clusterRange * 1.4; // 40% padding

    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, range / fitRange));
    setZoom(newZoom);
    setFollow(false);

    // Scroll to cluster start after layout updates with new zoom
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        const contentWidth = scrollRef.current.scrollWidth;
        const scrollPos = ((clusterStart - minTs) / range) * contentWidth;
        scrollRef.current.scrollLeft = Math.max(
          0,
          scrollPos - scrollRef.current.clientWidth * 0.1,
        );
      }
    });
  }, [allEvents, range, minTs]);

  // Keyboard shortcuts: +/- zoom, 0 reset, f fit, arrow keys pan
  const containerRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.nativeEvent.stopImmediatePropagation();
          setSelected(null);
          break;
        case "=":
        case "+":
          e.preventDefault();
          setZoom((z) => Math.min(ZOOM_MAX, z * 1.5));
          break;
        case "-":
          e.preventDefault();
          setZoom((z) => Math.max(ZOOM_MIN, z / 1.5));
          break;
        case "0":
          e.preventDefault();
          setZoom(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (selected !== null) {
            const idx = eventIndexById.get(selected) ?? -1;
            if (idx > 0) {
              setSelected(allEvents[idx - 1].id);
            }
          } else if (scrollRef.current) {
            scrollRef.current.scrollLeft -= 100;
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (selected !== null) {
            const idx = eventIndexById.get(selected) ?? -1;
            if (idx !== -1 && idx < allEvents.length - 1) {
              setSelected(allEvents[idx + 1].id);
            }
          } else if (scrollRef.current) {
            scrollRef.current.scrollLeft += 100;
          }
          break;
        case "f":
          e.preventDefault();
          handleFitLatest();
          break;
      }
    },
    [handleFitLatest, selected, eventIndexById, allEvents],
  );

  // Disable follow when user manually scrolls left
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
    if (!atEnd && follow) {
      setFollow(false);
    }
    if (atEnd && !follow) {
      setFollow(true);
    }
  }, [follow]);

  // Hover tooltip: find events near cursor position in a lane
  const handleLaneMouseMove = useCallback(
    (e: React.MouseEvent, laneEvents: LaneEvent[], laneId: string) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const xRatio = (e.clientX - rect.left) / rect.width;
      const cursorTs = minTs + xRatio * range;
      const threshold = Math.max(range * 0.015, 100);

      const nearby = laneEvents.filter(
        (ev) =>
          Math.abs(ev.timestamp - cursorTs) <= threshold &&
          !hiddenTypes.has(ev.type),
      );

      if (nearby.length > 0) {
        setTooltip({ x: e.clientX, y: e.clientY, events: nearby, laneId });
      } else {
        setTooltip(null);
      }
    },
    [minTs, range, hiddenTypes],
  );

  const handleLaneMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (allEvents.length === 0) {
    return <EmptyState message="Waiting for events..." />;
  }

  const tickCount = 5;

  // Render a single lane of events
  const renderLane = (laneEvents: LaneEvent[], laneId: string) => {
    // Build runtime spans by pairing start → complete/error events
    const runtimeSpans: {
      startTs: number;
      endTs: number;
      durationMs: number;
      error: boolean;
    }[] = [];
    const startStacks: Record<string, number[]> = {};

    for (const e of laneEvents) {
      if (ALL_SPAN_PAIRS[e.type]) {
        if (!startStacks[e.type]) {
          startStacks[e.type] = [];
        }
        startStacks[e.type].push(e.timestamp);
      } else {
        // Check if this is an end event for any span pair
        for (const [startType, [completeType, errorType]] of Object.entries(
          ALL_SPAN_PAIRS,
        )) {
          if (e.type === completeType || e.type === errorType) {
            const stack = startStacks[startType];
            if (stack && stack.length > 0) {
              const startTs = stack.pop()!;
              runtimeSpans.push({
                startTs,
                endTs: e.timestamp,
                durationMs: e.timestamp - startTs,
                error: e.type === errorType && completeType !== errorType,
              });
            }
          }
        }
      }
    }

    return (
      <div
        className="relative h-7 w-full rounded bg-zinc-100 dark:bg-zinc-800/50"
        onMouseMove={(e) => handleLaneMouseMove(e, laneEvents, laneId)}
        onMouseLeave={handleLaneMouseLeave}
      >
        {/* Runtime spans */}
        {runtimeSpans.map((span, i) => {
          const left = ((span.startTs - minTs) / range) * 100;
          const width = (span.durationMs / range) * 100;

          return (
            <div
              key={`span-${i}`}
              className={`pointer-events-none absolute top-1 h-5 rounded-sm ${span.error ? "bg-red-500/15 dark:bg-red-400/10" : "bg-emerald-500/15 dark:bg-emerald-400/10"}`}
              style={{ left: `${left}%`, width: `${width}%`, minWidth: "4px" }}
            />
          );
        })}

        {/* Event markers */}
        {laneEvents
          .filter((e) => !hiddenTypes.has(e.type))
          .map((e) => {
            const left = ((e.timestamp - minTs) / range) * 100;
            const label = ALL_LABELS[e.type] ?? e.type;
            const isSelected = e.id === selected;

            return (
              <button
                key={`evt-${e.id}-${e.timestamp}`}
                aria-label={`${label}: ${laneId}${e.durationMs ? `, ${e.durationMs}ms` : ""}${e.guardrailName ? `, ${e.guardrailName}` : ""}`}
                className={`absolute top-1 z-10 h-5 cursor-pointer rounded-sm ${ALL_COLORS[e.type] ?? "bg-zinc-400"} ${isSelected ? "opacity-100 ring-2 ring-white" : "opacity-80"} transition-opacity hover:opacity-100`}
                style={{ left: `${left}%`, width: "6px" }}
                onClick={() => setSelected(e.id === selected ? null : e.id)}
                title={`${e.type}${e.durationMs ? ` (${e.durationMs}ms)` : ""}${e.guardrailName ? `: ${e.guardrailName}` : ""}`}
              />
            );
          })}
      </div>
    );
  };

  // Find the boundary index between AI and system lanes for the separator
  const separatorAfterIndex =
    hasAiLanes && hasSystemLanes
      ? laneIds.findIndex((id) => {
          const first = laneEventsMap.get(id)?.[0];

          return first?.source === "system";
        }) - 1
      : -1;

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col gap-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <button
          className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.5))}
          aria-label="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={zoomToSlider(zoom)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
          className="h-1 w-20 cursor-pointer accent-sky-500"
          aria-label="Timeline zoom"
        />
        <button
          className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.5))}
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {zoom >= 10 ? `${Math.round(zoom)}x` : `${zoom.toFixed(1)}x`}
        </span>
        <span
          className="font-mono text-[9px] text-zinc-400/50 dark:text-zinc-600"
          title="Cmd/Ctrl+scroll to zoom · +/- keys · f to fit · Arrow keys to pan · 0 to reset"
        >
          +/- zoom · f fit · arrows pan · 0 reset
        </span>
        <div className="flex-1" />
        <button
          className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-sky-500/20 hover:text-sky-400"
          onClick={handleFitLatest}
          aria-label="Fit to latest run"
          title="Zoom to fit the latest cluster of events (f)"
        >
          Fit
        </button>
        <button
          className={`cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition ${follow ? "bg-sky-500/20 text-sky-500" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
          onClick={() => {
            setFollow(!follow);
            if (!follow && scrollRef.current)
              scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
          }}
          aria-label={follow ? "Auto-scroll enabled" : "Enable auto-scroll"}
        >
          {follow ? "Following" : "Auto-scroll"}
        </button>
        {zoom > 1 && (
          <button
            className="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            onClick={() => setZoom(1)}
          >
            Reset
          </button>
        )}
      </div>

      {/* Timeline area: fixed labels on left, scrollable lanes on right */}
      <div className="flex gap-3">
        {/* Fixed lane labels */}
        <div className="w-28 shrink-0 space-y-2">
          {laneIds.map((laneId, i) => (
            <div key={laneId}>
              {i === separatorAfterIndex + 1 && separatorAfterIndex >= 0 && (
                <div
                  className="my-1.5 flex items-center gap-1.5"
                  role="separator"
                  aria-hidden="true"
                >
                  <div className="flex-1 border-t border-zinc-300/50 dark:border-zinc-600/50" />
                  <span className="font-mono text-[9px] text-zinc-400/60 dark:text-zinc-600">
                    System
                  </span>
                </div>
              )}
              <div className="flex h-7 items-center justify-end">
                <span
                  className="max-w-full truncate font-mono text-xs text-zinc-400 dark:text-zinc-500"
                  title={laneId}
                >
                  {laneId}
                </span>
              </div>
            </div>
          ))}
          {/* Spacer for time axis row */}
          <div className="h-4" />
        </div>

        {/* Scrollable lanes + time axis below */}
        <div className="min-w-0 flex-1">
          <div
            ref={scrollRef}
            className="overflow-x-auto devtools-timeline-scroll pb-2"
            style={{ touchAction: "pan-x" }}
            onWheel={handleWheel}
            onScroll={handleScroll}
          >
            <div
              className="space-y-2"
              style={{ width: `${zoom * 100}%`, minWidth: "100%" }}
              onMouseLeave={handleLaneMouseLeave}
            >
              {laneIds.map((laneId, i) => (
                <div key={laneId}>
                  {i === separatorAfterIndex + 1 &&
                    separatorAfterIndex >= 0 && (
                      <div
                        className="my-1.5 flex items-center"
                        role="separator"
                        aria-hidden="true"
                      >
                        <div className="flex-1 border-t border-zinc-300/50 dark:border-zinc-600/50" />
                      </div>
                    )}
                  {renderLane(laneEventsMap.get(laneId) ?? [], laneId)}
                </div>
              ))}

              {/* Time axis — inside scroll container so it scales with zoom */}
              <div className="relative h-4">
                {Array.from({ length: tickCount }).map((_, i) => {
                  const pct = (i / (tickCount - 1)) * 100;
                  const timeS = (
                    (range / 1000) *
                    (i / (tickCount - 1))
                  ).toFixed(1);

                  return (
                    <span
                      key={i}
                      className="absolute font-mono text-[10px] text-zinc-400 dark:text-zinc-500"
                      style={{
                        left: `${pct}%`,
                        transform:
                          i === tickCount - 1
                            ? "translateX(-100%)"
                            : i > 0
                              ? "translateX(-50%)"
                              : undefined,
                      }}
                    >
                      {timeS}s
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected event detail */}
      {selected !== null &&
        (() => {
          const idx = eventIndexById.get(selected) ?? -1;
          if (idx === -1) {
            return null;
          }
          const e = allEvents[idx];

          return (
            <div className="mt-2 rounded border border-zinc-200 bg-white p-3 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800">
              {/* Navigation header */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    disabled={idx === 0}
                    onClick={() => setSelected(allEvents[idx - 1].id)}
                    aria-label="Previous event"
                  >
                    ◀
                  </button>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {idx + 1} of {allEvents.length}
                  </span>
                  <button
                    className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 disabled:cursor-default disabled:opacity-30 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                    disabled={idx === allEvents.length - 1}
                    onClick={() => setSelected(allEvents[idx + 1].id)}
                    aria-label="Next event"
                  >
                    ▶
                  </button>
                </div>
                <button
                  className="cursor-pointer rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  onClick={() => setSelected(null)}
                  aria-label="Close detail panel"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1">
                <div>
                  <span className="text-zinc-500">type:</span>{" "}
                  <span
                    className={`inline-block rounded px-1 py-0.5 text-white text-[10px] ${ALL_COLORS[e.type] ?? "bg-zinc-400"}`}
                  >
                    {e.type}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">lane:</span> {e.laneId}
                </div>
                {e.source === "ai" && e.agentId && (
                  <div>
                    <span className="text-zinc-500">
                      {e.type.startsWith("task_") ? "task" : "agent"}:
                    </span>{" "}
                    {e.agentId}
                  </div>
                )}
                {e.description && (
                  <div>
                    <span className="text-zinc-500">description:</span>{" "}
                    {String(e.description)}
                  </div>
                )}
                {e.modelId && (
                  <div>
                    <span className="text-zinc-500">model:</span>{" "}
                    {String(e.modelId)}
                  </div>
                )}
                {!!e.breakpointLabel && (
                  <div>
                    <span className="text-zinc-500">breakpoint:</span>{" "}
                    {String(e.breakpointLabel)}
                  </div>
                )}
                {e.guardrailName && (
                  <div>
                    <span className="text-zinc-500">guardrail:</span>{" "}
                    {e.guardrailName}
                  </div>
                )}
                {e.guardrailType && (
                  <div>
                    <span className="text-zinc-500">guardrailType:</span>{" "}
                    {e.guardrailType}
                  </div>
                )}
                {e.passed !== undefined && (
                  <div>
                    <span className="text-zinc-500">passed:</span>{" "}
                    <span
                      className={e.passed ? "text-emerald-500" : "text-red-500"}
                    >
                      {String(e.passed)}
                    </span>
                  </div>
                )}
                {e.reason && (
                  <div>
                    <span className="text-zinc-500">reason:</span>{" "}
                    <span className="text-red-400">{e.reason}</span>
                  </div>
                )}
                {(e.errorMessage || e.error) && (
                  <div>
                    <span className="text-zinc-500">error:</span>{" "}
                    <span className="text-red-400">
                      {String(e.errorMessage ?? e.error)}
                    </span>
                  </div>
                )}
                {e.errorCode && (
                  <div>
                    <span className="text-zinc-500">code:</span>{" "}
                    <span className="text-amber-400">
                      {String(e.errorCode)}
                    </span>
                  </div>
                )}
                {e.totalTokens !== undefined && (
                  <div>
                    <span className="text-zinc-500">tokens:</span>{" "}
                    {e.totalTokens}
                    {e.inputTokens
                      ? ` (in: ${e.inputTokens}, out: ${e.outputTokens})`
                      : ""}
                  </div>
                )}
                {e.durationMs !== undefined && (
                  <div>
                    <span className="text-zinc-500">duration:</span>{" "}
                    {e.durationMs}ms
                  </div>
                )}
                {e.inputLength !== undefined && (
                  <div>
                    <span className="text-zinc-500">inputLength:</span>{" "}
                    {e.inputLength}
                  </div>
                )}
                {e.outputLength !== undefined && (
                  <div>
                    <span className="text-zinc-500">outputLength:</span>{" "}
                    {e.outputLength}
                  </div>
                )}
                {/* AI event type-specific data */}
                <AiEventDetail event={e} />
                {/* System event data */}
                <SystemEventDetail event={e} />
                <div>
                  <span className="text-zinc-500">time:</span>{" "}
                  {new Date(e.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })()}

      {/* Legend — click labels to show/hide event types. Only shows types present in current data. */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          onClick={() => {
            const allTypes = [...presentTypes];
            setHiddenTypes((prev) =>
              prev.size > 0 ? new Set() : new Set(allTypes),
            );
          }}
          className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label={
            hiddenTypes.size > 0
              ? "Show all event types"
              : "Hide all event types"
          }
        >
          {hiddenTypes.size > 0 ? "All" : "None"}
        </button>
        <div className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />
        {[...presentTypes]
          .sort((a, b) => {
            // AI types (no dot) first, system types (with dot) second
            const aIsSystem = a.includes(".");
            const bIsSystem = b.includes(".");
            if (aIsSystem !== bIsSystem) {
              return aIsSystem ? 1 : -1;
            }

            return a.localeCompare(b);
          })
          .map((type) => {
            const color = ALL_COLORS[type] ?? "bg-zinc-400";
            const hidden = hiddenTypes.has(type);

            return (
              <button
                key={type}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-opacity hover:bg-zinc-100 dark:hover:bg-zinc-800 ${hidden ? "opacity-30" : "opacity-100"}`}
                onClick={() => {
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) {
                      next.delete(type);
                    } else {
                      next.add(type);
                    }

                    return next;
                  });
                }}
                aria-label={`${hidden ? "Show" : "Hide"} ${ALL_LABELS[type] ?? type} events`}
                aria-pressed={!hidden}
              >
                <div
                  className={`h-2.5 w-2.5 rounded-sm ${color}`}
                  aria-hidden="true"
                />
                <span
                  className={`font-mono text-[10px] ${hidden ? "text-zinc-500 line-through dark:text-zinc-600" : "text-zinc-400 dark:text-zinc-500"}`}
                >
                  {ALL_LABELS[type] ?? type}
                </span>
              </button>
            );
          })}
      </div>

      {/* Hover tooltip — portaled to body to escape DrawerPanel's transform containing block */}
      {tooltip &&
        tooltip.events.length > 0 &&
        portalTarget &&
        createPortal(
          <div
            className="pointer-events-none fixed max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 shadow-xl"
            style={{
              zIndex: Z_DRAWER + 2,
              left: `${Math.min(tooltip.x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 320)}px`,
              top: `${Math.max(tooltip.y - 60, 8)}px`,
            }}
          >
            <div className="mb-1.5 font-mono text-[10px] font-medium text-zinc-400">
              {tooltip.laneId} · {tooltip.events.length} event
              {tooltip.events.length !== 1 ? "s" : ""}
            </div>
            <div className="space-y-1">
              {tooltip.events.slice(0, 8).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 font-mono text-[10px]"
                >
                  <div
                    className={`h-2 w-2 shrink-0 rounded-sm ${ALL_COLORS[e.type] ?? "bg-zinc-400"}`}
                  />
                  <span className="text-zinc-300">
                    {ALL_LABELS[e.type] ?? e.type}
                  </span>
                  {e.guardrailName && (
                    <span className="text-zinc-500">({e.guardrailName})</span>
                  )}
                  {e.passed !== undefined && (
                    <span
                      className={e.passed ? "text-emerald-400" : "text-red-400"}
                    >
                      {e.passed ? "✓" : "✗"}
                    </span>
                  )}
                  {e.durationMs !== undefined && (
                    <span className="text-zinc-500">{e.durationMs}ms</span>
                  )}
                  <TooltipSystemContext event={e} />
                </div>
              ))}
              {tooltip.events.length > 8 && (
                <div className="font-mono text-[10px] text-zinc-500">
                  +{tooltip.events.length - 8} more
                </div>
              )}
            </div>
          </div>,
          portalTarget,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TooltipSystemContext — renders system-specific context in the hover tooltip
// ---------------------------------------------------------------------------

function TooltipSystemContext({ event }: { event: LaneEvent }) {
  if (
    event.source !== "system" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }

  const d = event.data as Record<string, unknown>;

  // Show the most relevant identifier for each event type
  const label =
    d.key !== undefined
      ? String(d.key)
      : d.resolver !== undefined
        ? String(d.resolver)
        : d.id !== undefined && event.type.startsWith("requirement")
          ? String(d.type ?? d.id)
          : d.id !== undefined
            ? String(d.id)
            : null;

  if (!label) {
    return null;
  }

  return <span className="ml-1 text-zinc-500">{label}</span>;
}

// ---------------------------------------------------------------------------
// Collapsible long-content helper for AI event detail
// ---------------------------------------------------------------------------

function CollapsibleField({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") {
    return null;
  }
  const str = typeof value === "string" ? value : safeStringify(value);
  const isLong = str.length > 100;

  if (!isLong) {
    return (
      <div>
        <span className="text-zinc-500">{label}:</span>{" "}
        <span className="text-zinc-300">{str}</span>
      </div>
    );
  }

  return (
    <div>
      <span className="text-zinc-500">{label}:</span>
      <details className="inline">
        <summary className="ml-1 cursor-pointer text-zinc-400">
          {str.slice(0, 80)}…
        </summary>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-400 rounded bg-zinc-900 p-1.5">
          {str}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AiEventDetail — renders type-specific fields for AI events
// ---------------------------------------------------------------------------

function AiEventDetail({ event }: { event: LaneEvent }) {
  if (event.source !== "ai") {
    return null;
  }

  const t = event.type;

  return (
    <>
      {/* agent_start: input, instructions */}
      {t === "agent_start" && (
        <>
          <CollapsibleField label="input" value={event.input} />
          <CollapsibleField label="instructions" value={event.instructions} />
        </>
      )}

      {/* agent_complete: output */}
      {t === "agent_complete" && (
        <CollapsibleField label="output" value={event.output} />
      )}

      {/* pattern_start / pattern_complete: pattern metadata */}
      {(t === "pattern_start" || t === "pattern_complete") && (
        <>
          {event.patternId && (
            <div>
              <span className="text-zinc-500">patternId:</span>{" "}
              {String(event.patternId)}
            </div>
          )}
          {event.patternType && (
            <div>
              <span className="text-zinc-500">patternType:</span>{" "}
              {String(event.patternType)}
            </div>
          )}
          {Array.isArray(event.handlers) && (
            <div>
              <span className="text-zinc-500">handlers:</span>{" "}
              {event.handlers.join(", ")}
            </div>
          )}
          {t === "pattern_complete" && event.durationMs !== undefined && (
            <div>
              <span className="text-zinc-500">duration:</span>{" "}
              {String(event.durationMs)}ms
            </div>
          )}
          {event.achieved !== undefined && (
            <div>
              <span className="text-zinc-500">achieved:</span>{" "}
              <span
                className={event.achieved ? "text-emerald-500" : "text-red-500"}
              >
                {String(event.achieved)}
              </span>
            </div>
          )}
          {event.error && (
            <div>
              <span className="text-zinc-500">error:</span>{" "}
              <span className="text-red-400">{String(event.error)}</span>
            </div>
          )}
        </>
      )}

      {/* dag_node_update: nodeId, status, deps */}
      {t === "dag_node_update" && (
        <>
          {event.nodeId && (
            <div>
              <span className="text-zinc-500">nodeId:</span>{" "}
              {String(event.nodeId)}
            </div>
          )}
          {event.status && (
            <div>
              <span className="text-zinc-500">status:</span>{" "}
              <span
                className={
                  event.status === "completed"
                    ? "text-emerald-500"
                    : event.status === "running"
                      ? "text-amber-500"
                      : event.status === "error"
                        ? "text-red-500"
                        : "text-zinc-400"
                }
              >
                {String(event.status)}
              </span>
            </div>
          )}
          {Array.isArray(event.deps) && event.deps.length > 0 && (
            <div>
              <span className="text-zinc-500">deps:</span>{" "}
              {event.deps.join(", ")}
            </div>
          )}
        </>
      )}

      {/* race_start / race_winner / race_cancelled */}
      {(t === "race_start" ||
        t === "race_winner" ||
        t === "race_cancelled") && (
        <>
          {event.patternId && (
            <div>
              <span className="text-zinc-500">patternId:</span>{" "}
              {String(event.patternId)}
            </div>
          )}
          {Array.isArray(event.agents) && (
            <div>
              <span className="text-zinc-500">agents:</span>{" "}
              {event.agents.join(", ")}
            </div>
          )}
          {event.winnerId && (
            <div>
              <span className="text-zinc-500">winner:</span>{" "}
              <span className="text-emerald-400">{String(event.winnerId)}</span>
            </div>
          )}
          {event.durationMs !== undefined && t !== "race_start" && (
            <div>
              <span className="text-zinc-500">duration:</span>{" "}
              {String(event.durationMs)}ms
            </div>
          )}
          {event.reason && t === "race_cancelled" && (
            <div>
              <span className="text-zinc-500">reason:</span>{" "}
              <span className="text-red-400">{String(event.reason)}</span>
            </div>
          )}
        </>
      )}

      {/* debate_round */}
      {t === "debate_round" && (
        <>
          {event.round !== undefined && (
            <div>
              <span className="text-zinc-500">round:</span>{" "}
              {String(event.round)}
              {event.totalRounds ? ` / ${event.totalRounds}` : ""}
            </div>
          )}
          {event.winnerId && (
            <div>
              <span className="text-zinc-500">winner:</span>{" "}
              <span className="text-emerald-400">{String(event.winnerId)}</span>
            </div>
          )}
          {event.score !== undefined && (
            <div>
              <span className="text-zinc-500">score:</span>{" "}
              {String(event.score)}
            </div>
          )}
          {event.agentCount !== undefined && (
            <div>
              <span className="text-zinc-500">agents:</span>{" "}
              {String(event.agentCount)}
            </div>
          )}
        </>
      )}

      {/* reflection_iteration */}
      {t === "reflection_iteration" && (
        <>
          {event.iteration !== undefined && (
            <div>
              <span className="text-zinc-500">iteration:</span>{" "}
              {String(event.iteration)}
            </div>
          )}
          {event.passed !== undefined && (
            <div>
              <span className="text-zinc-500">passed:</span>{" "}
              <span
                className={event.passed ? "text-emerald-500" : "text-red-500"}
              >
                {String(event.passed)}
              </span>
            </div>
          )}
          {event.score !== undefined && (
            <div>
              <span className="text-zinc-500">score:</span>{" "}
              {String(event.score)}
            </div>
          )}
          {event.durationMs !== undefined && (
            <div>
              <span className="text-zinc-500">duration:</span>{" "}
              {String(event.durationMs)}ms
            </div>
          )}
        </>
      )}

      {/* reroute */}
      {t === "reroute" && (
        <>
          {(event.from != null || event.to != null) && (
            <div>
              <span className="text-zinc-500">route:</span>{" "}
              {event.from != null && (
                <span className="text-zinc-400">{String(event.from)}</span>
              )}
              {event.from != null && event.to != null && " → "}
              {event.to != null && (
                <span className="text-zinc-300">{String(event.to)}</span>
              )}
            </div>
          )}
          {event.reason && (
            <div>
              <span className="text-zinc-500">reason:</span>{" "}
              {String(event.reason)}
            </div>
          )}
        </>
      )}

      {/* scratchpad_update */}
      {t === "scratchpad_update" &&
        Array.isArray(event.keys) &&
        event.keys.length > 0 && (
          <div>
            <span className="text-zinc-500">keys:</span> {event.keys.join(", ")}
          </div>
        )}

      {/* breakpoint_hit / breakpoint_resumed */}
      {(t === "breakpoint_hit" || t === "breakpoint_resumed") && (
        <>
          {event.breakpointId && (
            <div>
              <span className="text-zinc-500">breakpointId:</span>{" "}
              {String(event.breakpointId)}
            </div>
          )}
          {event.breakpointType && (
            <div>
              <span className="text-zinc-500">breakpointType:</span>{" "}
              {String(event.breakpointType)}
            </div>
          )}
          {t === "breakpoint_resumed" && event.modified !== undefined && (
            <div>
              <span className="text-zinc-500">modified:</span>{" "}
              <span
                className={event.modified ? "text-amber-400" : "text-zinc-400"}
              >
                {String(event.modified)}
              </span>
            </div>
          )}
          {t === "breakpoint_resumed" && event.skipped !== undefined && (
            <div>
              <span className="text-zinc-500">skipped:</span>{" "}
              <span
                className={event.skipped ? "text-red-400" : "text-zinc-400"}
              >
                {String(event.skipped)}
              </span>
            </div>
          )}
        </>
      )}

      {/* agent_retry */}
      {t === "agent_retry" && (
        <>
          {event.attempt !== undefined && (
            <div>
              <span className="text-zinc-500">attempt:</span>{" "}
              {String(event.attempt)}
            </div>
          )}
          {event.errorMessage && (
            <div>
              <span className="text-zinc-500">error:</span>{" "}
              <span className="text-red-400">{String(event.errorMessage)}</span>
            </div>
          )}
          {event.delayMs !== undefined && (
            <div>
              <span className="text-zinc-500">delay:</span>{" "}
              {String(event.delayMs)}ms
            </div>
          )}
        </>
      )}
    </>
  );
}

function SystemEventDetail({ event }: { event: LaneEvent }) {
  if (
    event.source !== "system" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return null;
  }

  const d = event.data as Record<string, unknown>;
  const t = event.type;

  return (
    <>
      {/* Fact events: key, value, prev */}
      {d.key !== undefined && (
        <div>
          <span className="text-zinc-500">key:</span> {String(d.key)}
        </div>
      )}
      {d.value !== undefined && (
        <div>
          <span className="text-zinc-500">value:</span> {safeStringify(d.value)}
        </div>
      )}
      {d.prev !== undefined && (
        <div>
          <span className="text-zinc-500">prev:</span> {safeStringify(d.prev)}
        </div>
      )}
      {/* facts.batch: change count */}
      {t === "facts.batch" && Array.isArray(d.changes) && (
        <div>
          <span className="text-zinc-500">changes:</span> {d.changes.length}{" "}
          fact{d.changes.length !== 1 ? "s" : ""}
        </div>
      )}
      {/* Derivation events: id, deps, value */}
      {d.id !== undefined &&
        (t === "derivation.compute" || t === "derivation.invalidate") && (
          <div>
            <span className="text-zinc-500">derivation:</span> {String(d.id)}
          </div>
        )}
      {Array.isArray(d.deps) && (
        <div>
          <span className="text-zinc-500">deps:</span> {d.deps.join(", ")}
        </div>
      )}
      {t === "derivation.compute" && d.value !== undefined && !d.key && (
        <div>
          <span className="text-zinc-500">value:</span> {safeStringify(d.value)}
        </div>
      )}
      {/* Constraint events: id, active */}
      {d.id !== undefined &&
        (t === "constraint.evaluate" || t === "constraint.error") && (
          <div>
            <span className="text-zinc-500">constraint:</span> {String(d.id)}
          </div>
        )}
      {d.active !== undefined && (
        <div>
          <span className="text-zinc-500">active:</span>{" "}
          <span className={d.active ? "text-emerald-500" : "text-zinc-500"}>
            {String(d.active)}
          </span>
        </div>
      )}
      {/* Requirement events: id, type, byResolver */}
      {d.id !== undefined && t.startsWith("requirement") && (
        <>
          <div>
            <span className="text-zinc-500">requirement:</span> {String(d.id)}
          </div>
          {d.type !== undefined && (
            <div>
              <span className="text-zinc-500">type:</span> {String(d.type)}
            </div>
          )}
        </>
      )}
      {d.byResolver !== undefined && (
        <div>
          <span className="text-zinc-500">met by:</span> {String(d.byResolver)}
        </div>
      )}
      {/* Resolver events: resolver name, requirementId, duration, attempt */}
      {d.resolver !== undefined && (
        <div>
          <span className="text-zinc-500">resolver:</span> {String(d.resolver)}
        </div>
      )}
      {d.requirementId !== undefined && (
        <div>
          <span className="text-zinc-500">requirement:</span>{" "}
          {String(d.requirementId)}
        </div>
      )}
      {d.duration !== undefined && (
        <div>
          <span className="text-zinc-500">duration:</span>{" "}
          {Number(d.duration).toFixed(1)}ms
        </div>
      )}
      {d.attempt !== undefined && (
        <div>
          <span className="text-zinc-500">attempt:</span> {String(d.attempt)}
        </div>
      )}
      {/* Effect events: id */}
      {d.id !== undefined && (t === "effect.run" || t === "effect.error") && (
        <div>
          <span className="text-zinc-500">effect:</span> {String(d.id)}
        </div>
      )}
      {/* Error events: source, sourceId, message, strategy */}
      {d.source !== undefined && (t === "error" || t === "error.recovery") && (
        <div>
          <span className="text-zinc-500">source:</span> {String(d.source)}
          {d.sourceId ? ` (${String(d.sourceId)})` : ""}
        </div>
      )}
      {d.message !== undefined && (
        <div>
          <span className="text-zinc-500">message:</span>{" "}
          <span className="text-red-400">{String(d.message)}</span>
        </div>
      )}
      {d.strategy !== undefined && (
        <div>
          <span className="text-zinc-500">strategy:</span> {String(d.strategy)}
        </div>
      )}
      {d.error !== undefined && (
        <div>
          <span className="text-zinc-500">error:</span>{" "}
          <span className="text-red-400">{String(d.error)}</span>
        </div>
      )}
      {/* Time travel: trigger */}
      {d.trigger !== undefined && (
        <div>
          <span className="text-zinc-500">trigger:</span> {String(d.trigger)}
        </div>
      )}
      {d.from !== undefined && d.to !== undefined && (
        <div>
          <span className="text-zinc-500">jump:</span> {String(d.from)} →{" "}
          {String(d.to)}
        </div>
      )}
      {/* Reconcile end: counts */}
      {t === "reconcile.end" && (
        <>
          {Array.isArray(d.unmet) && (
            <div>
              <span className="text-zinc-500">unmet:</span> {d.unmet.length}
            </div>
          )}
          {Array.isArray(d.inflight) && (
            <div>
              <span className="text-zinc-500">inflight:</span>{" "}
              {d.inflight.length}
            </div>
          )}
          {Array.isArray(d.completed) && (
            <div>
              <span className="text-zinc-500">completed:</span>{" "}
              {d.completed.length}
            </div>
          )}
        </>
      )}
    </>
  );
}
