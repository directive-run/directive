import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Events visible in current replay state (sliced to cursor) */
  visibleEvents: DebugEvent[];
}

export function useReplay(events: DebugEvent[]): ReplayControls {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);

  const playingRef = useRef(false);
  const cursorRef = useRef(0);
  const speedRef = useRef<ReplaySpeed>(1);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Keep refs in sync
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { cursorRef.current = cursorIndex; }, [cursorIndex]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Animation loop for playback
  const animate = useCallback((now: number) => {
    if (!playingRef.current) {
      return;
    }

    const idx = cursorRef.current;
    if (idx >= events.length - 1) {
      setPlaying(false);

      return;
    }

    const elapsed = now - lastFrameTimeRef.current;
    const currentEvent = events[idx]!;
    const nextEvent = events[idx + 1]!;
    const gap = nextEvent.timestamp - currentEvent.timestamp;
    // Scale gap by speed — wait real-time gap / speed
    const scaledGap = gap / speedRef.current;

    if (elapsed >= scaledGap) {
      const next = idx + 1;
      cursorRef.current = next;
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
    setCursorIndex(events.length > 0 ? events.length - 1 : 0);
    setPlaying(false);
  }, [events.length]);

  const exit = useCallback(() => {
    setActive(false);
    setPlaying(false);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    if (cursorRef.current >= events.length - 1) {
      // If at end, restart from beginning
      setCursorIndex(0);
      cursorRef.current = 0;
    }
    setPlaying(true);
  }, [events.length]);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setCursorIndex((i) => Math.min(i + 1, events.length - 1));
  }, [events.length]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    setCursorIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goToStart = useCallback(() => {
    setPlaying(false);
    setCursorIndex(0);
  }, []);

  const goToEnd = useCallback(() => {
    setPlaying(false);
    setCursorIndex(Math.max(events.length - 1, 0));
  }, [events.length]);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
  }, []);

  const seekTo = useCallback((index: number) => {
    setCursorIndex(Math.max(0, Math.min(index, events.length - 1)));
  }, [events.length]);

  const cursorTimestamp = active && events.length > 0 && cursorIndex < events.length
    ? events[cursorIndex]!.timestamp
    : null;

  const visibleEvents = active
    ? events.slice(0, cursorIndex + 1)
    : events;

  return {
    state: {
      active,
      playing,
      cursorIndex,
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
    visibleEvents,
  };
}
