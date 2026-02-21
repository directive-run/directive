import { useMemo, useState } from "react";
import type { DebugEvent, DebugEventType } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";

interface FlamechartViewProps {
  events: DebugEvent[];
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
            typeof (event as Record<string, unknown>).durationMs === "number"
              ? ((event as Record<string, unknown>).durationMs as number)
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
            tokens: (event as Record<string, unknown>).totalTokens as number | undefined,
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

export function FlamechartView({ events }: FlamechartViewProps) {
  const [selectedBar, setSelectedBar] = useState<FlameBar | null>(null);
  const [hoveredBar, setHoveredBar] = useState<FlameBar | null>(null);

  const timeRange = useMemo(() => {
    if (events.length === 0) {
      return { start: 0, end: 1, duration: 1 };
    }

    const start = events[0]!.timestamp;
    const end = events[events.length - 1]!.timestamp;
    const duration = Math.max(end - start, 1);

    return { start, end, duration };
  }, [events]);

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

  // Time axis labels
  const timeAxisLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i <= 5; i++) {
      const ms = (timeRange.duration * i) / 5;
      labels.push(`${Math.round(ms)}ms`);
    }

    return labels;
  }, [timeRange]);

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="mb-2 text-4xl">🔥</div>
          <p>Run an agent to see the flamechart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Chart area */}
      <div className="flex flex-1 overflow-auto">
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

        {/* Flame bars */}
        <div className="relative flex-1" style={{ minHeight: chartHeight }}>
          {flameBars.map((bar) => {
            const leftPct = ((bar.startMs - timeRange.start) / timeRange.duration) * 100;
            const widthPct = bar.durationMs > 0
              ? (bar.durationMs / timeRange.duration) * 100
              : 0;
            const top = bar.depth * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;
            const color = EVENT_COLORS[bar.type];
            const isSelected = selectedBar?.id === bar.id;
            const isHovered = hoveredBar?.id === bar.id;

            return (
              <button
                key={`${bar.id}-${bar.type}`}
                className="absolute cursor-pointer transition-opacity"
                aria-label={`${bar.label}${bar.durationMs > 0 ? ` — ${bar.durationMs.toFixed(1)}ms` : ""}`}
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
                  ((hoveredBar.startMs - timeRange.start) / timeRange.duration) * 100,
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
                  {hoveredBar.durationMs > 0 ? `${hoveredBar.durationMs.toFixed(1)}ms` : "instant"}
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
                    ? `${selectedBar.durationMs.toFixed(1)}ms`
                    : "instant (point event)"}
                </div>
              </div>

              <div>
                <span className="text-zinc-500">Start</span>
                <div className="mt-0.5 text-zinc-200">
                  +{(selectedBar.startMs - timeRange.start).toFixed(1)}ms
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
