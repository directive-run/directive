import { useEffect, useMemo, useRef, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";
import { useTimelineZoom } from "../hooks/use-timeline-zoom";
import type { TimeFormat } from "../lib/time-format";
import { formatTimestamp, formatDuration } from "../lib/time-format";

interface FlamechartViewProps {
  events: DebugEvent[];
  timeFormat?: TimeFormat;
}

/** A single bar in the flamechart */
interface FlameBar {
  id: number;
  type: DebugEventType;
  agentId?: string;
  startMs: number;
  durationMs: number;
  depth: number;
  label: string;
  tokens?: number;
  event: DebugEvent;
}

const BAR_HEIGHT = 24;
const BAR_GAP = 1;
const MIN_BAR_WIDTH_PX = 4;

const DEPTH_LABELS: Record<number, string> = {
  0: "Patterns",
  1: "Agents",
  2: "Resolvers",
};

/** Short label for event types */
function typeLabel(type: DebugEventType): string {
  const map: Partial<Record<DebugEventType, string>> = {
    pattern_start: "Pattern",
    pattern_complete: "Pattern",
    agent_start: "Agent",
    agent_complete: "Agent",
    resolver_start: "Resolver",
    resolver_complete: "Resolver",
  };

  return map[type] ?? type.replace(/_/g, " ");
}

/** Pair start/end events into flame bars, assign nesting depth */
function buildFlameStacks(events: DebugEvent[]): FlameBar[] {
  const bars: FlameBar[] = [];

  // Pair start/end events by type prefix and agentId
  const pairings: Array<{ startType: DebugEventType; endType: DebugEventType; depth: number }> = [
    { startType: "pattern_start", endType: "pattern_complete", depth: 0 },
    { startType: "agent_start", endType: "agent_complete", depth: 1 },
    { startType: "resolver_start", endType: "resolver_complete", depth: 2 },
  ];

  // Track open spans for pairing
  const openSpans = new Map<string, DebugEvent>();

  for (const event of events) {
    let matched = false;

    for (const { startType, endType, depth } of pairings) {
      if (event.type === startType) {
        const key = `${startType}::${event.agentId ?? "global"}`;
        openSpans.set(key, event);
        matched = true;
        break;
      }

      if (event.type === endType) {
        const key = `${startType}::${event.agentId ?? "global"}`;
        const start = openSpans.get(key);
        if (start) {
          const durationMs =
            typeof event.durationMs === "number"
              ? event.durationMs
              : event.timestamp - start.timestamp;

          bars.push({
            id: start.id,
            type: startType,
            agentId: event.agentId,
            startMs: start.timestamp,
            durationMs: Math.max(durationMs, 0),
            depth,
            label: event.agentId
              ? `${typeLabel(startType)}: ${event.agentId}`
              : typeLabel(startType),
            tokens: typeof event.totalTokens === "number" ? event.totalTokens : undefined,
            event: start,
          });
          openSpans.delete(key);
        }
        matched = true;
        break;
      }
    }

    // Point events (no start/end pair) — show as thin bars at depth based on category
    if (!matched) {
      let depth = 1;
      if (event.type.startsWith("pattern")) {
        depth = 0;
      } else if (event.type.startsWith("resolver")) {
        depth = 2;
      }

      bars.push({
        id: event.id,
        type: event.type,
        agentId: event.agentId,
        startMs: event.timestamp,
        durationMs: 0,
        depth,
        label: event.agentId
          ? `${typeLabel(event.type)}: ${event.agentId}`
          : typeLabel(event.type),
        event,
      });
    }
  }

  // Also create bars for any unclosed spans (still running)
  for (const [key, start] of openSpans) {
    const startType = key.split("::")[0] as DebugEventType;
    const depth = pairings.find((p) => p.startType === startType)?.depth ?? 1;
    const lastTimestamp = events.length > 0 ? events[events.length - 1]!.timestamp : start.timestamp;

    bars.push({
      id: start.id,
      type: startType,
      agentId: start.agentId,
      startMs: start.timestamp,
      durationMs: Math.max(lastTimestamp - start.timestamp, 0),
      depth,
      label: start.agentId
        ? `${typeLabel(startType)}: ${start.agentId} (running)`
        : `${typeLabel(startType)} (running)`,
      event: start,
    });
  }

  return bars;
}

/** E8: Compute performance summary stats from flame bars */
function computePerfSummary(flameBars: FlameBar[], timeRange: { start: number; duration: number }) {
  const agentBars = flameBars.filter((b) => b.depth === 1 && b.durationMs > 0);
  if (agentBars.length === 0) {
    return null;
  }

  const totalWallTime = timeRange.duration;
  const sumAgentDurations = agentBars.reduce((sum, b) => sum + b.durationMs, 0);

  // Slowest agent
  let slowest = agentBars[0]!;
  for (const bar of agentBars) {
    if (bar.durationMs > slowest.durationMs) {
      slowest = bar;
    }
  }

  // Parallelism ratio
  const parallelismRatio = totalWallTime > 0 ? sumAgentDurations / totalWallTime : 1;

  // Critical path: longest single bar (simplified)
  const criticalPathMs = slowest.durationMs;

  return {
    totalDurationMs: totalWallTime,
    criticalPathMs,
    parallelismRatio,
    slowestAgent: slowest.agentId ?? "unknown",
    slowestMs: slowest.durationMs,
  };
}

/** Canvas-based minimap for flamechart zoom */
function FlamechartMinimap({
  flameBars,
  timeRange,
  viewStart,
  viewEnd,
  onPan,
}: {
  flameBars: FlameBar[];
  timeRange: { start: number; duration: number };
  viewStart: number;
  viewEnd: number;
  onPan: (fraction: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Draw bars
    for (const bar of flameBars) {
      if (bar.durationMs <= 0) {
        continue;
      }

      const x = ((bar.startMs - timeRange.start) / timeRange.duration) * w;
      const barW = Math.max(1, (bar.durationMs / timeRange.duration) * w);
      const y = (bar.depth / 3) * h;
      const barH = h / 3 - 1;

      ctx.fillStyle = EVENT_COLORS[bar.type] ?? "#666";
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, y, barW, barH);
    }

    // Draw viewport
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
    const vx = viewStart * w;
    const vw = (viewEnd - viewStart) * w;
    ctx.fillRect(vx, 0, vw, h);
    ctx.strokeRect(vx, 0, vw, h);
  }, [flameBars, timeRange, viewStart, viewEnd]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    onPan(fraction);
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-8 w-full cursor-pointer rounded border border-zinc-800"
      onClick={handleClick}
      aria-label="Flamechart minimap"
    />
  );
}

export function FlamechartView({ events, timeFormat = "elapsed" }: FlamechartViewProps) {
  const [selectedBar, setSelectedBar] = useState<FlameBar | null>(null);
  const [hoveredBar, setHoveredBar] = useState<FlameBar | null>(null);

  // E4: Use shared zoom hook
  const zoom = useTimelineZoom(events);
  const baseTimestamp = events[0]?.timestamp;

  // D2: Escape key closes detail panel
  useEffect(() => {
    if (!selectedBar) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedBar(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBar]);

  const flameBars = useMemo(() => buildFlameStacks(events), [events]);

  const maxDepth = useMemo(() => {
    let max = 0;
    for (const bar of flameBars) {
      if (bar.depth > max) {
        max = bar.depth;
      }
    }

    return max;
  }, [flameBars]);

  const chartHeight = (maxDepth + 1) * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;

  // E8: Performance summary
  const perfSummary = useMemo(
    () => computePerfSummary(flameBars, zoom.timeRange),
    [flameBars, zoom.timeRange],
  );

  // Time axis labels using time format
  const timeAxisLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i <= 5; i++) {
      const ts = zoom.visibleRange.start + (zoom.visibleRange.duration * i) / 5;
      labels.push(formatTimestamp(ts, timeFormat, baseTimestamp));
    }

    return labels;
  }, [zoom.visibleRange, timeFormat, baseTimestamp]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl" aria-hidden="true">🔥</div>
          <p>Run an agent to see the flamechart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* E8: Performance summary */}
      {perfSummary && (
        <div className="flex items-center gap-6 border-b border-zinc-800 px-6 py-2.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total Duration</div>
            <div className="text-sm font-bold text-zinc-100">{formatDuration(perfSummary.totalDurationMs)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Critical Path</div>
            <div className="text-sm font-bold text-zinc-100">{formatDuration(perfSummary.criticalPathMs)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Parallelism</div>
            <div className="text-sm font-bold text-zinc-100">{perfSummary.parallelismRatio.toFixed(2)}x</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Slowest Agent</div>
            <div className="text-sm font-bold text-zinc-100">
              {perfSummary.slowestAgent} ({formatDuration(perfSummary.slowestMs)})
            </div>
          </div>

          {/* E4: Zoom controls */}
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
        </div>
      )}

      {/* Chart area */}
      <div
        className="flex flex-1 overflow-auto"
        onWheel={zoom.handleWheel}
        onMouseDown={zoom.handlePanMouseDown}
        onMouseMove={zoom.handlePanMouseMove}
        onMouseUp={zoom.handlePanMouseUp}
        onMouseLeave={zoom.handlePanMouseUp}
        style={{ cursor: zoom.zoomLevel > 1 ? "grab" : undefined }}
      >
        {/* Depth labels */}
        <div className="sticky left-0 z-10 flex w-28 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          {Array.from({ length: maxDepth + 1 }, (_, depth) => (
            <div
              key={depth}
              className="flex items-center px-3 text-[10px] font-medium uppercase tracking-wider text-zinc-500"
              style={{ height: BAR_HEIGHT + BAR_GAP }}
            >
              {DEPTH_LABELS[depth] ?? `Depth ${depth}`}
            </div>
          ))}
        </div>

        {/* Flame bars — E4: zoom-aware positioning */}
        <div ref={zoom.laneContainerRef} className="relative flex-1" style={{ minHeight: chartHeight }}>
          {flameBars.map((bar) => {
            const leftPct = ((bar.startMs - zoom.visibleRange.start) / zoom.visibleRange.duration) * 100;
            const widthPct = bar.durationMs > 0
              ? (bar.durationMs / zoom.visibleRange.duration) * 100
              : 0;

            // Skip bars fully outside visible range
            if (leftPct + widthPct < -5 || leftPct > 105) {
              return null;
            }

            const top = bar.depth * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;
            const color = EVENT_COLORS[bar.type];
            const isSelected = selectedBar?.id === bar.id;
            const isHovered = hoveredBar?.id === bar.id;

            return (
              <button
                key={`${bar.id}-${bar.type}`}
                className="absolute cursor-pointer transition-opacity"
                aria-label={`${bar.label}${bar.durationMs > 0 ? ` — ${formatDuration(bar.durationMs)}` : ""}`}
                style={{
                  left: `${leftPct}%`,
                  width: widthPct > 0 ? `max(${MIN_BAR_WIDTH_PX}px, ${widthPct}%)` : `${MIN_BAR_WIDTH_PX}px`,
                  top,
                  height: BAR_HEIGHT,
                  backgroundColor: color,
                  opacity: isSelected || isHovered ? 1 : 0.8,
                  border: isSelected ? "1px solid white" : "1px solid transparent",
                  borderRadius: 3,
                  overflow: "hidden",
                  padding: 0,
                }}
                onClick={() => {
                  setSelectedBar(selectedBar?.id === bar.id ? null : bar);
                }}
                onMouseEnter={() => setHoveredBar(bar)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                {/* Bar label (only visible when wide enough) */}
                <span
                  className="block truncate px-1.5 text-[10px] font-medium leading-[24px] text-white"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                >
                  {bar.label}
                </span>
              </button>
            );
          })}

          {/* Hover tooltip */}
          {hoveredBar && !selectedBar && (
            <div
              className="pointer-events-none absolute z-50 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg"
              style={{
                left: `${Math.min(
                  ((hoveredBar.startMs - zoom.visibleRange.start) / zoom.visibleRange.duration) * 100,
                  85,
                )}%`,
                top: hoveredBar.depth * (BAR_HEIGHT + BAR_GAP) + BAR_HEIGHT + BAR_GAP + 4,
              }}
            >
              <div className="font-medium text-zinc-200">{hoveredBar.label}</div>
              <div className="mt-1 text-zinc-400">
                Type: <span className="text-zinc-300">{hoveredBar.type}</span>
              </div>
              {hoveredBar.agentId && (
                <div className="text-zinc-400">
                  Agent: <span className="text-zinc-300">{hoveredBar.agentId}</span>
                </div>
              )}
              <div className="text-zinc-400">
                Duration:{" "}
                <span className="text-zinc-300">
                  {hoveredBar.durationMs > 0 ? formatDuration(hoveredBar.durationMs) : "instant"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedBar && (
          <div className="w-72 shrink-0 overflow-auto border-l border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
              <button
                onClick={() => setSelectedBar(null)}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Close detail panel"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-zinc-500">Type</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: EVENT_COLORS[selectedBar.type] }}
                  />
                  <span className="text-zinc-200">{selectedBar.type}</span>
                </div>
              </div>

              {selectedBar.agentId && (
                <div>
                  <span className="text-zinc-500">Agent</span>
                  <div className="mt-0.5 text-zinc-200">{selectedBar.agentId}</div>
                </div>
              )}

              <div>
                <span className="text-zinc-500">Duration</span>
                <div className="mt-0.5 text-zinc-200">
                  {selectedBar.durationMs > 0
                    ? formatDuration(selectedBar.durationMs)
                    : "instant (point event)"}
                </div>
              </div>

              <div>
                <span className="text-zinc-500">Start</span>
                <div className="mt-0.5 text-zinc-200">
                  {formatTimestamp(selectedBar.startMs, timeFormat, baseTimestamp)}
                </div>
              </div>

              {selectedBar.tokens != null && (
                <div>
                  <span className="text-zinc-500">Tokens</span>
                  <div className="mt-0.5 text-zinc-200">
                    {selectedBar.tokens.toLocaleString()}
                  </div>
                </div>
              )}

              <div>
                <span className="text-zinc-500">Depth</span>
                <div className="mt-0.5 text-zinc-200">
                  {DEPTH_LABELS[selectedBar.depth] ?? `Level ${selectedBar.depth}`}
                </div>
              </div>

              <div>
                <span className="text-zinc-500">Event ID</span>
                <div className="mt-0.5 text-zinc-200">#{selectedBar.id}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* E4: Minimap (only when zoomed) */}
      {zoom.zoomLevel > 1 && (
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-1">
          <div className="flex items-center gap-2">
            <div className="w-28 shrink-0" />
            <FlamechartMinimap
              flameBars={flameBars}
              timeRange={zoom.timeRange}
              viewStart={zoom.viewStart}
              viewEnd={zoom.viewEnd}
              onPan={zoom.handleMinimapPan}
            />
          </div>
        </div>
      )}

      {/* Time axis */}
      <div className="flex border-t border-zinc-800 bg-zinc-900 px-4 py-1">
        <div className="w-28 shrink-0" />
        <div className="flex flex-1 justify-between text-[10px] text-zinc-500">
          {timeAxisLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
