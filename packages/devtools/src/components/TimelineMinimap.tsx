import { useCallback, useRef } from "react";
import type { DebugEvent } from "../lib/types";
import { EVENT_COLORS } from "../lib/colors";

interface TimelineMinimapProps {
  events: DebugEvent[];
  timeRange: { start: number; duration: number };
  /** Visible window start as fraction 0-1 */
  viewStart: number;
  /** Visible window end as fraction 0-1 */
  viewEnd: number;
  onPan: (fraction: number) => void;
}

export function TimelineMinimap({ events, timeRange, viewStart, viewEnd, onPan }: TimelineMinimapProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (!barRef.current) {
        return;
      }

      const rect = barRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onPan(fraction);
    },
    [onPan],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointer(e);
    },
    [handlePointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging.current) {
        handlePointer(e);
      }
    },
    [handlePointer],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={barRef}
      className="relative h-5 cursor-pointer rounded bg-zinc-800/80"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="slider"
      aria-label="Timeline minimap"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(viewStart * 100)}
    >
      {/* Event ticks */}
      {events.map((event) => {
        const pos = ((event.timestamp - timeRange.start) / timeRange.duration) * 100;

        return (
          <div
            key={event.id}
            className="absolute top-1 h-3"
            style={{
              left: `${Math.min(pos, 99.5)}%`,
              width: "2px",
              backgroundColor: EVENT_COLORS[event.type],
              opacity: 0.6,
            }}
          />
        );
      })}

      {/* Visible window highlight */}
      <div
        className="absolute inset-y-0 rounded border border-blue-400/60 bg-blue-500/20"
        style={{
          left: `${viewStart * 100}%`,
          width: `${Math.max((viewEnd - viewStart) * 100, 1)}%`,
        }}
      />
    </div>
  );
}
