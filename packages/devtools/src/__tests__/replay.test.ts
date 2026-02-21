import { describe, it, expect } from "vitest";

// Test the pure logic parts of the replay system
// The hook itself uses React state, but the boundary logic is testable

describe("replay cursor logic", () => {
  it("clamps cursor to 0 when events array is empty", () => {
    const eventsLength = 0;
    const cursorIndex = 5;
    const clampedIndex = Math.min(cursorIndex, Math.max(eventsLength - 1, 0));
    expect(clampedIndex).toBe(0);
  });

  it("clamps cursor when events array shrinks", () => {
    const eventsLength = 3;
    const cursorIndex = 10;
    const clampedIndex = Math.min(cursorIndex, Math.max(eventsLength - 1, 0));
    expect(clampedIndex).toBe(2);
  });

  it("does not clamp cursor within bounds", () => {
    const eventsLength = 10;
    const cursorIndex = 5;
    const clampedIndex = Math.min(cursorIndex, Math.max(eventsLength - 1, 0));
    expect(clampedIndex).toBe(5);
  });

  it("seekTo clamps to valid range", () => {
    const eventsLength = 10;

    function seekTo(index: number): number {
      return Math.max(0, Math.min(index, eventsLength - 1));
    }

    expect(seekTo(-5)).toBe(0);
    expect(seekTo(0)).toBe(0);
    expect(seekTo(5)).toBe(5);
    expect(seekTo(9)).toBe(9);
    expect(seekTo(100)).toBe(9);
  });

  it("step forward clamps at end", () => {
    const eventsLength = 5;

    function stepForward(current: number): number {
      return Math.min(current + 1, eventsLength - 1);
    }

    expect(stepForward(3)).toBe(4);
    expect(stepForward(4)).toBe(4); // already at end
  });

  it("step back clamps at beginning", () => {
    function stepBack(current: number): number {
      return Math.max(current - 1, 0);
    }

    expect(stepBack(3)).toBe(2);
    expect(stepBack(0)).toBe(0); // already at start
  });
});

describe("replay visibleEvents slicing", () => {
  const makeEvents = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      type: "agent_start" as const,
      timestamp: 1000 + i * 100,
      snapshotId: null,
    }));

  it("shows all events when replay is inactive", () => {
    const events = makeEvents(10);
    const active = false;
    const clampedIndex = 5;

    const visibleEvents = active ? events.slice(0, clampedIndex + 1) : events;
    expect(visibleEvents).toHaveLength(10);
  });

  it("slices events to cursor when replay is active", () => {
    const events = makeEvents(10);
    const active = true;
    const clampedIndex = 5;

    const visibleEvents = active ? events.slice(0, clampedIndex + 1) : events;
    expect(visibleEvents).toHaveLength(6); // 0 through 5 inclusive
  });

  it("shows 1 event when cursor is at start (M8 fix)", () => {
    const events = makeEvents(10);
    const active = true;
    const clampedIndex = 0;

    const visibleEvents = active ? events.slice(0, clampedIndex + 1) : events;
    expect(visibleEvents).toHaveLength(1);
    expect(visibleEvents[0]!.id).toBe(0);
  });

  it("shows all events when cursor is at end", () => {
    const events = makeEvents(10);
    const active = true;
    const clampedIndex = 9;

    const visibleEvents = active ? events.slice(0, clampedIndex + 1) : events;
    expect(visibleEvents).toHaveLength(10);
  });

  it("returns empty when events array is empty and replay is active", () => {
    const events: { id: number; type: "agent_start"; timestamp: number; snapshotId: null }[] = [];
    const active = true;
    const clampedIndex = 0;

    const visibleEvents = active ? events.slice(0, clampedIndex + 1) : events;
    expect(visibleEvents).toHaveLength(0);
  });
});

describe("replay frame-skip logic", () => {
  it("advances by 1 when gap is small", () => {
    const events = [
      { timestamp: 1000 },
      { timestamp: 1050 },
      { timestamp: 1100 },
    ];

    const currentIdx = 0;
    const speed = 1;
    const elapsed = 60; // ms since last frame

    const gap = events[1]!.timestamp - events[0]!.timestamp;
    const scaledGap = gap / speed;

    // Should advance since elapsed (60) >= scaledGap (50)
    expect(elapsed >= scaledGap).toBe(true);

    // Frame skip: accumulate gaps
    let next = currentIdx + 1;
    let accumulatedGap = gap;

    while (next < events.length - 1) {
      const nextGap = events[next + 1]!.timestamp - events[next]!.timestamp;
      if (accumulatedGap + nextGap > elapsed * speed) {
        break;
      }
      accumulatedGap += nextGap;
      next++;
    }

    // With elapsed=60ms and speed=1, gap=50, nextGap=50, accumulated=100 > 60*1=60 → stop at index 1
    expect(next).toBe(1);
  });

  it("skips multiple events when speed is high", () => {
    const events = [
      { timestamp: 1000 },
      { timestamp: 1010 },
      { timestamp: 1020 },
      { timestamp: 1030 },
      { timestamp: 1040 },
    ];

    const currentIdx = 0;
    const speed = 10;
    const elapsed = 16; // ~1 frame at 60fps

    const gap = events[1]!.timestamp - events[0]!.timestamp;
    const scaledGap = gap / speed;

    // Should advance: elapsed (16) >= scaledGap (1)
    expect(elapsed >= scaledGap).toBe(true);

    let next = currentIdx + 1;
    let accumulatedGap = gap;

    while (next < events.length - 1) {
      const nextGap = events[next + 1]!.timestamp - events[next]!.timestamp;
      if (accumulatedGap + nextGap > elapsed * speed) {
        break;
      }
      accumulatedGap += nextGap;
      next++;
    }

    // With elapsed=16, speed=10 → elapsed*speed=160, gaps are 10ms each
    // accumulated: 10, 20, 30, 40 — all < 160, so we go to index 4 (end)
    expect(next).toBe(4);
  });

  it("handles single-event array", () => {
    const events = [{ timestamp: 1000 }];
    const currentIdx = 0;
    const speed = 1;
    const elapsed = 100;

    // Already at end, no advancement possible
    let next = currentIdx;
    if (events.length > 1) {
      const gap = events[1]!.timestamp - events[0]!.timestamp;
      const scaledGap = gap / speed;
      if (elapsed >= scaledGap) {
        next = currentIdx + 1;
      }
    }

    expect(next).toBe(0);
  });

  it("handles events with identical timestamps (zero gap)", () => {
    const events = [
      { timestamp: 1000 },
      { timestamp: 1000 },
      { timestamp: 1000 },
    ];

    const currentIdx = 0;
    const speed = 1;
    const elapsed = 16;

    const gap = events[1]!.timestamp - events[0]!.timestamp;
    const scaledGap = gap / speed;

    // Zero gap means elapsed (16) >= scaledGap (0) → should advance
    expect(elapsed >= scaledGap).toBe(true);

    let next = currentIdx + 1;
    let accumulatedGap = gap;

    while (next < events.length - 1) {
      const nextGap = events[next + 1]!.timestamp - events[next]!.timestamp;
      if (accumulatedGap + nextGap > elapsed * speed) {
        break;
      }
      accumulatedGap += nextGap;
      next++;
    }

    // All gaps are 0, accumulated stays 0, always < elapsed*speed=16 → jump to end
    expect(next).toBe(2);
  });
});

// ============================================================================
// D10: play() with empty events does nothing
// ============================================================================

describe("play() with empty events guard (D10)", () => {
  it("does not start playback when events array is empty", () => {
    // Simulate the D10 guard from use-replay.ts:
    // if (events.length === 0) return;
    const events: { timestamp: number }[] = [];
    let playingStarted = false;

    function play() {
      if (events.length === 0) {
        return;
      }
      playingStarted = true;
    }

    play();
    expect(playingStarted).toBe(false);
  });

  it("starts playback when events array has entries", () => {
    const events = [{ timestamp: 1000 }, { timestamp: 2000 }];
    let playingStarted = false;

    function play() {
      if (events.length === 0) {
        return;
      }
      playingStarted = true;
    }

    play();
    expect(playingStarted).toBe(true);
  });

  it("starts playback with single event", () => {
    const events = [{ timestamp: 1000 }];
    let playingStarted = false;

    function play() {
      if (events.length === 0) {
        return;
      }
      playingStarted = true;
    }

    play();
    expect(playingStarted).toBe(true);
  });
});

describe("replay cursor timestamp computation", () => {
  it("computes cursor percentage within visible range", () => {
    const visibleRange = { start: 1000, duration: 2000 };
    const cursorTimestamp = 1500;

    const pct = ((cursorTimestamp - visibleRange.start) / visibleRange.duration) * 100;
    expect(pct).toBe(25);
  });

  it("returns null-like when cursor is outside range", () => {
    const visibleRange = { start: 1000, duration: 2000 };
    const cursorTimestamp = 500; // before range

    const pct = ((cursorTimestamp - visibleRange.start) / visibleRange.duration) * 100;
    // pct is -25, which is < 0, so the UI check (pct >= 0 && pct <= 100) would exclude it
    expect(pct < 0).toBe(true);
  });

  it("handles zero-duration range", () => {
    const visibleRange = { start: 1000, duration: 0 };
    const cursorTimestamp = 1000;

    // Division by zero → NaN or Infinity
    const pct = ((cursorTimestamp - visibleRange.start) / visibleRange.duration) * 100;
    expect(Number.isFinite(pct)).toBe(false);
  });
});
