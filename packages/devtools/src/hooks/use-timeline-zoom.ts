import { useCallback, useMemo, useRef, useState } from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 20;

interface TimeRange {
  start: number;
  end: number;
  duration: number;
}

interface VisibleRange {
  start: number;
  end: number;
  duration: number;
}

export interface TimelineZoom {
  zoomLevel: number;
  panOffset: number;
  visibleRange: VisibleRange;
  timeRange: TimeRange;
  /** Minimap fractions */
  viewStart: number;
  viewEnd: number;
  /** Time axis labels for visible range */
  timeAxisLabels: string[];
  /** Replay cursor percentage position in visible range */
  getReplayCursorPct: (replayCursor: number | null | undefined) => number | null;

  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomReset: () => void;
  handleWheel: (e: React.WheelEvent) => void;
  handlePanMouseDown: (e: React.MouseEvent) => void;
  handlePanMouseMove: (e: React.MouseEvent) => void;
  handlePanMouseUp: () => void;
  handleMinimapPan: (fraction: number) => void;
  laneContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useTimelineZoom(events: { timestamp: number }[]): TimelineZoom {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);

  const panDragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const laneContainerRef = useRef<HTMLDivElement>(null);

  // Compute time range (full, unzoomed)
  const timeRange = useMemo((): TimeRange => {
    if (events.length === 0) {
      return { start: 0, end: 1, duration: 1 };
    }

    const start = events[0]!.timestamp;
    const end = events[events.length - 1]!.timestamp;
    const duration = Math.max(end - start, 1);

    return { start, end, duration };
  }, [events]);

  // Visible time range (zoomed/panned)
  const visibleRange = useMemo((): VisibleRange => {
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

  // Time axis labels for visible range
  const timeAxisLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i <= 4; i++) {
      const ms = (visibleRange.start - timeRange.start) + (visibleRange.duration * i / 4);
      labels.push(`${Math.round(ms)}ms`);
    }

    return labels;
  }, [visibleRange, timeRange.start]);

  const getReplayCursorPct = useCallback(
    (replayCursor: number | null | undefined): number | null => {
      if (replayCursor == null) {
        return null;
      }

      return ((replayCursor - visibleRange.start) / visibleRange.duration) * 100;
    },
    [visibleRange],
  );

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
      const targetOffset = fraction * timeRange.duration - visibleDuration / 2;
      setPanOffset(Math.max(0, Math.min(targetOffset, maxOffset)));
    },
    [timeRange.duration, zoomLevel],
  );

  return {
    zoomLevel,
    panOffset,
    visibleRange,
    timeRange,
    viewStart,
    viewEnd,
    timeAxisLabels,
    getReplayCursorPct,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleWheel,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handleMinimapPan,
    laneContainerRef,
  };
}
