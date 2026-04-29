import { describe, expect, it } from "vitest";
import { virtualClock } from "../clock.js";
import {
  initialTimerState,
  elapsedMs,
  remainingMs,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  completeTimer,
  registerRepeat,
  tickTimer,
  timerOps,
} from "../timer.js";

describe("timer state — initial", () => {
  it("starts idle with zero elapsed", () => {
    const s = initialTimerState();
    expect(s.status).toBe("idle");
    expect(s.startedAtMs).toBe(null);
    expect(s.pausedDurationMs).toBe(0);
    expect(s.repeats).toBe(0);
    expect(elapsedMs(s, 1_000)).toBe(0);
  });
});

describe("timer state — start / elapsed", () => {
  it("startTimer sets startedAtMs and status=running", () => {
    const s = startTimer(initialTimerState(), 100);
    expect(s.status).toBe("running");
    expect(s.startedAtMs).toBe(100);
  });

  it("elapsed grows with clock now", () => {
    const s = startTimer(initialTimerState(), 100);
    expect(elapsedMs(s, 100)).toBe(0);
    expect(elapsedMs(s, 250)).toBe(150);
    expect(elapsedMs(s, 1_100)).toBe(1_000);
  });

  it("remaining counts down for a 1s countdown", () => {
    const s = startTimer(initialTimerState(), 100);
    expect(remainingMs(s, 100, 1_000)).toBe(1_000);
    expect(remainingMs(s, 600, 1_000)).toBe(500);
    expect(remainingMs(s, 1_100, 1_000)).toBe(0);
    expect(remainingMs(s, 5_000, 1_000)).toBe(0); // floors at 0
  });
});

describe("timer state — pause / resume", () => {
  it("pause freezes elapsed", () => {
    const running = startTimer(initialTimerState(), 100);
    const paused = pauseTimer(running, 300);
    expect(paused.status).toBe("paused");
    expect(paused.pausedAtMs).toBe(300);
    // even if clock advances, elapsed reads from pause moment
    expect(elapsedMs(paused, 999)).toBe(200);
    expect(elapsedMs(paused, 1_000_000)).toBe(200);
  });

  it("resume re-starts the count without losing elapsed", () => {
    let s = startTimer(initialTimerState(), 100);
    s = pauseTimer(s, 300); // 200ms elapsed
    s = resumeTimer(s, 1_000); // paused for 700ms
    expect(s.status).toBe("running");
    expect(s.pausedAtMs).toBe(null);
    expect(s.pausedDurationMs).toBe(700);
    // at clock=1100, total elapsed = 200 (pre-pause) + 100 (post-resume)
    expect(elapsedMs(s, 1_100)).toBe(300);
  });

  it("repeated pause/resume accumulates pausedDurationMs", () => {
    let s = startTimer(initialTimerState(), 0);
    s = pauseTimer(s, 100); // 100ms elapsed
    s = resumeTimer(s, 200); // paused 100ms
    s = pauseTimer(s, 300); // 100ms more elapsed (200ms total)
    s = resumeTimer(s, 500); // paused another 200ms (300ms total)
    expect(s.pausedDurationMs).toBe(300);
    expect(elapsedMs(s, 600)).toBe(300);
  });

  it("pause is a no-op when not running", () => {
    const idle = initialTimerState();
    expect(pauseTimer(idle, 100)).toBe(idle);
  });

  it("resume is a no-op when not paused", () => {
    const running = startTimer(initialTimerState(), 100);
    expect(resumeTimer(running, 200)).toBe(running);
  });
});

describe("timer state — reset / complete", () => {
  it("resetTimer returns initial state", () => {
    expect(resetTimer()).toEqual(initialTimerState());
  });

  it("completeTimer marks status=completed without losing elapsed math", () => {
    const running = startTimer(initialTimerState(), 100);
    const completed = completeTimer(running);
    expect(completed.status).toBe("completed");
    expect(elapsedMs(completed, 1_100)).toBe(1_000);
  });
});

describe("timer state — repeat", () => {
  it("registerRepeat advances startedAtMs by ms and increments count", () => {
    let s = startTimer(initialTimerState(), 100);
    s = registerRepeat(s, 1_000);
    expect(s.startedAtMs).toBe(1_100);
    expect(s.repeats).toBe(1);
    s = registerRepeat(s, 1_000);
    expect(s.startedAtMs).toBe(2_100);
    expect(s.repeats).toBe(2);
  });

  it("registerRepeat is no-op on idle state", () => {
    const idle = initialTimerState();
    const after = registerRepeat(idle, 1_000);
    expect(after).toBe(idle);
  });
});

describe("tickTimer signal", () => {
  it("countdown: returns no-op while elapsed < ms", () => {
    const s = startTimer(initialTimerState(), 0);
    expect(tickTimer(s, 500, { ms: 1_000 })).toEqual({ kind: "no-op" });
  });

  it("countdown: returns complete when elapsed >= ms", () => {
    const s = startTimer(initialTimerState(), 0);
    expect(tickTimer(s, 1_000, { ms: 1_000 })).toEqual({ kind: "complete" });
    expect(tickTimer(s, 5_000, { ms: 1_000 })).toEqual({ kind: "complete" });
  });

  it("repeat: returns repeat when elapsed >= ms", () => {
    const s = startTimer(initialTimerState(), 0);
    expect(tickTimer(s, 999, { ms: 1_000, mode: "repeat" })).toEqual({
      kind: "no-op",
    });
    expect(tickTimer(s, 1_000, { ms: 1_000, mode: "repeat" })).toEqual({
      kind: "repeat",
    });
  });

  it("up: never returns complete", () => {
    const s = startTimer(initialTimerState(), 0);
    expect(tickTimer(s, 1_000, { ms: 100, mode: "up" })).toEqual({
      kind: "no-op",
    });
    expect(tickTimer(s, 1_000_000, { ms: 100, mode: "up" })).toEqual({
      kind: "no-op",
    });
  });

  it("not-running statuses always return no-op", () => {
    const idle = initialTimerState();
    expect(tickTimer(idle, 5_000, { ms: 1_000 })).toEqual({ kind: "no-op" });
    const paused = pauseTimer(startTimer(initialTimerState(), 0), 500);
    expect(tickTimer(paused, 5_000, { ms: 1_000 })).toEqual({
      kind: "no-op",
    });
    const completed = completeTimer(startTimer(initialTimerState(), 0));
    expect(tickTimer(completed, 5_000, { ms: 1_000 })).toEqual({
      kind: "no-op",
    });
  });
});

describe("timerOps integration with virtualClock", () => {
  it("countdown completes deterministically", () => {
    const c = virtualClock(0);
    const ops = timerOps({ ms: 1_000 });
    let s = ops.initial();
    s = ops.start(s, c.now());
    c.advanceBy?.(500);
    expect(ops.tick(s, c.now()).kind).toBe("no-op");
    c.advanceBy?.(600);
    expect(ops.tick(s, c.now()).kind).toBe("complete");
  });

  it("repeat fires every interval", () => {
    const c = virtualClock(0);
    const ops = timerOps({ ms: 100, mode: "repeat" });
    let s = ops.start(ops.initial(), c.now());
    let fires = 0;
    for (let i = 0; i < 10; i++) {
      c.advanceBy?.(100);
      const sig = ops.tick(s, c.now());
      if (sig.kind === "repeat") {
        s = ops.registerRepeat(s);
        fires++;
      }
    }
    expect(fires).toBe(10);
    expect(s.repeats).toBe(10);
  });

  it("pause/resume preserves remaining ms", () => {
    const c = virtualClock(0);
    const ops = timerOps({ ms: 1_000 });
    let s = ops.start(ops.initial(), c.now());
    c.advanceBy?.(300);
    s = ops.pause(s, c.now());
    c.advanceBy?.(10_000); // long pause
    s = ops.resume(s, c.now());
    c.advanceBy?.(700);
    expect(ops.tick(s, c.now()).kind).toBe("complete");
    expect(ops.elapsedMs(s, c.now())).toBe(1_000);
  });
});
