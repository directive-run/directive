import { useCallback, useEffect, useRef } from "react";
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

/**
 * M4: Canvas-based minimap for performance.
 * Renders event ticks on a <canvas> instead of one DOM element per event.
 */
export function TimelineMinimap({ events, timeRange, viewStart, viewEnd, onPan }: TimelineMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  // Draw event ticks on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Draw event ticks (sample if too many)
    const maxTicks = 500;
    const step = events.length > maxTicks ? Math.ceil(events.length / maxTicks) : 1;

    for (let i = 0; i < events.length; i += step) {
      const event = events[i]!;
      const pos = ((event.timestamp - timeRange.start) / timeRange.duration);
      const x = Math.min(pos * w, w - 1);
      const color = EVENT_COLORS[event.type] ?? "#666";

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, 4, 2, h - 8);
    }

    ctx.globalAlpha = 1;
  }, [events, timeRange]);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
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

  // Keyboard handling for WCAG 4.1.2 slider semantics
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 0.05;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        onPan(Math.max(0, viewStart - step));
        break;
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        onPan(Math.min(1, viewStart + step));
        break;
      case "Home":
        e.preventDefault();
        onPan(0);
        break;
      case "End":
        e.preventDefault();
        onPan(1);
        break;
    }
  }, [onPan, viewStart]);

  return (
    <div
      ref={containerRef}
      className="relative h-5 cursor-pointer rounded bg-zinc-800/80"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Timeline minimap"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(viewStart * 100)}
    >
      {/* Canvas for event ticks */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      />

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
