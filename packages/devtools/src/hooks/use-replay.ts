import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEvent } from "../lib/types";

export type ReplaySpeed = 1 | 2 | 5 | 10;

export interface ReplayState {
  active: boolean;
  playing: boolean;
  cursorIndex: number;
  speed: ReplaySpeed;
  /** Timestamp at the current cursor position */
  cursorTimestamp: number | null;
}

export interface ReplayControls {
  state: ReplayState;
  /** Enter replay mode (pauses live feed) */
  enter: () => void;
  /** Exit replay mode (resumes live feed) */
  exit: () => void;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  /** Jump to a specific event index */
  seekTo: (index: number) => void;
  /** E9: Start replay from a specific event index */
  replayFromIndex: (index: number) => void;
  /** Events visible in current replay state (sliced to cursor) */
  visibleEvents: DebugEvent[];
}

export function useReplay(events: DebugEvent[]): ReplayControls {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);

  // Single ref object to avoid stale closures in rAF
  const stateRef = useRef({
    playing: false,
    cursorIndex: 0,
    speed: 1 as ReplaySpeed,
    eventsLength: events.length,
  });

  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Keep ref in sync
  useEffect(() => {
    stateRef.current.playing = playing;
    stateRef.current.cursorIndex = cursorIndex;
    stateRef.current.speed = speed;
    stateRef.current.eventsLength = events.length;
  }, [playing, cursorIndex, speed, events.length]);

  // Animation loop for playback — M7: reads from stateRef for up-to-date values
  const animate = useCallback((now: number) => {
    const { playing: isPlaying, cursorIndex: idx, speed: spd, eventsLength } = stateRef.current;

    if (!isPlaying) {
      return;
    }

    // Clamp cursor to bounds
    if (idx >= eventsLength - 1) {
      setPlaying(false);

      return;
    }

    const elapsed = now - lastFrameTimeRef.current;
    const currentEvent = events[idx];
    const nextEvent = events[idx + 1];

    // Safety: if events array changed and our index is invalid, stop
    if (!currentEvent || !nextEvent) {
      setPlaying(false);

      return;
    }

    const gap = nextEvent.timestamp - currentEvent.timestamp;
    // Scale gap by speed — wait real-time gap / speed
    const scaledGap = gap / spd;

    if (elapsed >= scaledGap) {
      // Frame-skip: advance by multiple events if we're behind
      let next = idx + 1;
      let accumulatedGap = gap;

      while (next < eventsLength - 1) {
        const peekNext = events[next + 1];
        if (!peekNext) {
          break;
        }

        const nextGap = peekNext.timestamp - events[next]!.timestamp;
        if (accumulatedGap + nextGap > elapsed * spd) {
          break;
        }

        accumulatedGap += nextGap;
        next++;
      }

      stateRef.current.cursorIndex = next;
      setCursorIndex(next);
      lastFrameTimeRef.current = now;
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [events]);

  // Start/stop animation
  useEffect(() => {
    if (playing && active) {
      lastFrameTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, active, animate]);

  const enter = useCallback(() => {
    setActive(true);
    setCursorIndex(0);
    stateRef.current.cursorIndex = 0;
    setPlaying(false);
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    setPlaying(false);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    // D10: Guard against empty events array
    if (events.length === 0) {
      return;
    }

    if (stateRef.current.cursorIndex >= events.length - 1) {
      // If at end, restart from beginning
      setCursorIndex(0);
      stateRef.current.cursorIndex = 0;
    }
    setPlaying(true);
  }, [events.length]);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setCursorIndex((i) => {
      const next = Math.min(i + 1, events.length - 1);
      stateRef.current.cursorIndex = next;

      return next;
    });
  }, [events.length]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    setCursorIndex((i) => {
      const next = Math.max(i - 1, 0);
      stateRef.current.cursorIndex = next;

      return next;
    });
  }, []);

  const goToStart = useCallback(() => {
    setPlaying(false);
    setCursorIndex(0);
    stateRef.current.cursorIndex = 0;
  }, []);

  const goToEnd = useCallback(() => {
    setPlaying(false);
    const idx = Math.max(events.length - 1, 0);
    setCursorIndex(idx);
    stateRef.current.cursorIndex = idx;
  }, [events.length]);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
  }, []);

  const seekTo = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, events.length - 1));
    setCursorIndex(clamped);
    stateRef.current.cursorIndex = clamped;
  }, [events.length]);

  // E9: Start replay from a specific event index
  const replayFromIndex = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, events.length - 1));
    setCursorIndex(clamped);
    stateRef.current.cursorIndex = clamped;
    if (!active) {
      setActive(true);
    }
    setPlaying(true);
  }, [events.length, active]);

  // Clamp cursor when events array shrinks
  const clampedIndex = active ? Math.min(cursorIndex, Math.max(events.length - 1, 0)) : cursorIndex;

  const cursorTimestamp = active && events.length > 0 && clampedIndex < events.length
    ? events[clampedIndex]!.timestamp
    : null;

  // Memoize to avoid new array reference on every render during replay
  const visibleEvents = useMemo(
    () => active ? events.slice(0, clampedIndex + 1) : events,
    [active, events, clampedIndex],
  );

  return {
    state: {
      active,
      playing,
      cursorIndex: clampedIndex,
      speed,
      cursorTimestamp,
    },
    enter,
    exit,
    play,
    pause,
    stepForward,
    stepBack,
    goToStart,
    goToEnd,
    setSpeed,
    seekTo,
    replayFromIndex,
    visibleEvents,
  };
}
