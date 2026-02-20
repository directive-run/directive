import type { DebugEvent } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";

interface TimelineBarProps {
  event: DebugEvent;
  timeRange: { start: number; duration: number };
  isSelected: boolean;
  onClick: () => void;
  row?: number;
}

/** Get duration from event if available */
function getEventDuration(event: DebugEvent): number {
  const dur = (event as Record<string, unknown>).durationMs;
  if (typeof dur === "number" && dur > 0) {
    return dur;
  }

  // Point events get minimum width
  return 0;
}

export function TimelineBar({ event, timeRange, isSelected, onClick, row = 0 }: TimelineBarProps) {
  const offset = event.timestamp - timeRange.start;
  const leftPct = (offset / timeRange.duration) * 100;
  const duration = getEventDuration(event);
  const widthPct = duration > 0
    ? Math.max((duration / timeRange.duration) * 100, 0.5)
    : 0;

  const color = EVENT_COLORS[event.type];
  const isPoint = widthPct === 0;

  return (
    <button
      onClick={onClick}
      aria-label={`${event.type.replace(/_/g, " ")}${event.agentId ? ` (${event.agentId})` : ""}${duration ? ` — ${duration}ms` : ""}`}
      className={`absolute transition-all ${
        isSelected ? "ring-2 ring-white/40 z-20" : "hover:brightness-125 z-10"
      }`}
      style={{
        left: `${Math.min(leftPct, 99)}%`,
        width: isPoint ? "8px" : `max(${widthPct}%, 8px)`,
        top: `${4 + row * 24}px`,
        height: "20px",
        backgroundColor: color,
        borderRadius: isPoint ? "50%" : "3px",
        opacity: isSelected ? 1 : 0.85,
      }}
      title={`${event.type}${event.agentId ? ` (${event.agentId})` : ""}${duration ? ` — ${duration}ms` : ""}`}
    >
      {/* Label for wider bars */}
      {!isPoint && widthPct > 3 && (
        <span className="block truncate px-1 text-[9px] leading-[20px] text-white/90 font-medium">
          {event.type.replace(/_/g, " ")}
        </span>
      )}
    </button>
  );
}
