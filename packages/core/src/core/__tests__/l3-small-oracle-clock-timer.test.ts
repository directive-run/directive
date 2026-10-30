import { describe, expect, it } from "vitest";
import {
  completeTimer,
  elapsedMs,
  initialTimerState,
  pauseTimer,
  registerRepeat,
  remainingMs,
  resumeTimer,
  startTimer,
  timerOps,
  virtualClock,
} from "../../index.js";
import type { TimerFactState } from "../../index.js";

// Black-box tests for the virtual clock and the timer state helpers, through
// the public exports only. They pin what a caller can see: when a callback
// fires, what each transition leaves alone, and what elapsed time reads.

describe("virtualClock deadlines", () => {
  it("fires a callback whose deadline is exactly the instant advanced to", () => {
    const clock = virtualClock(0);
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(clock.now()), 100);

    clock.advanceBy?.(99);
    expect(fired).toEqual([]);

    clock.advanceBy?.(1);
    expect(fired).toEqual([100]);
    expect(clock.now()).toBe(100);
  });

  it("fires a callback due exactly at the end of a larger advance, after earlier ones", () => {
    const clock = virtualClock(10);
    const order: string[] = [];
    clock.setTimeout(() => order.push("edge"), 50);
    clock.setTimeout(() => order.push("early"), 5);

    clock.advanceBy?.(50);

    expect(order).toEqual(["early", "edge"]);
    expect(clock.now()).toBe(60);
  });
});

describe("timer state transitions leave the wrong status alone", () => {
  const running = (): TimerFactState => startTimer(initialTimerState(), 0);

  it("startTimer on a running timer changes nothing, so it keeps its start", () => {
    const state = running();
    const again = startTimer(state, 500);

    expect(again).toEqual(state);
    expect(again.startedAtMs).toBe(0);
    expect(elapsedMs(again, 700)).toBe(700);
  });

  it("startTimer on a paused timer changes nothing, so it stays paused", () => {
    const paused = pauseTimer(running(), 100);
    const again = startTimer(paused, 500);

    expect(again).toEqual(paused);
    expect(again.status).toBe("paused");
    expect(elapsedMs(again, 900)).toBe(100);
  });

  it("registerRepeat on a paused timer changes nothing", () => {
    const paused = pauseTimer(running(), 100);
    const again = registerRepeat(paused, 1_000);

    expect(again).toEqual(paused);
    expect(again.repeats).toBe(0);
    expect(again.startedAtMs).toBe(0);
  });

  it("resumeTimer on a completed timer leaves it completed", () => {
    // Completing a paused timer keeps the moment it was paused at.
    const completed = completeTimer(pauseTimer(running(), 100));
    const again = resumeTimer(completed, 400);

    expect(again).toEqual(completed);
    expect(again.status).toBe("completed");
  });
});

describe("elapsed time", () => {
  it("excludes every earlier pause when the timer is paused again", () => {
    let state = startTimer(initialTimerState(), 0);
    state = pauseTimer(state, 100);
    state = resumeTimer(state, 150);
    state = pauseTimer(state, 300);

    // 300 on the clock, 50 of it spent paused. Frozen while paused.
    expect(elapsedMs(state, 300)).toBe(250);
    expect(elapsedMs(state, 9_999)).toBe(250);
  });

  // Only the read at the moment of completion is pinned. Later reads of a
  // timer completed while paused keep counting on 1.35, against "pauses
  // freeze" (RFC 0001); triaged v1-bug in mutation-triage/timer.json.
  it("a timer completed while paused reports the elapsed time it had", () => {
    const completed = completeTimer(
      pauseTimer(startTimer(initialTimerState(), 0), 100),
    );

    expect(elapsedMs(completed, 100)).toBe(100);
  });

  it("a paused timer that never recorded when it paused counts against the clock", () => {
    const state: TimerFactState = {
      startedAtMs: 100,
      pausedDurationMs: 0,
      pausedAtMs: null,
      status: "paused",
      repeats: 0,
    };

    expect(elapsedMs(state, 600)).toBe(500);
  });

  it("resumeTimer on a paused timer that never recorded when it paused changes nothing", () => {
    const state: TimerFactState = {
      startedAtMs: 100,
      pausedDurationMs: 0,
      pausedAtMs: null,
      status: "paused",
      repeats: 0,
    };

    expect(resumeTimer(state, 1_000)).toEqual(state);
  });
});

describe("timerOps", () => {
  it("remainingMs counts the configured total down from the start", () => {
    const ops = timerOps({ ms: 1_000, mode: "down" });
    const state = ops.start(ops.initial(), 0);

    expect(ops.remainingMs(state, 0)).toBe(1_000);
    expect(ops.remainingMs(state, 300)).toBe(700);
    expect(ops.remainingMs(state, 5_000)).toBe(0);
    expect(remainingMs(state, 300, 1_000)).toBe(700);
  });
});
