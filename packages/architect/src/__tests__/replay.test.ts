import { describe, it, expect, vi } from "vitest";
import { createReplayRecorder, replayWithArchitect } from "../replay.js";
import type { ReplayRecording } from "../types.js";

function mockSystem() {
  const subscribers: Array<() => void> = [];
  const settledSubscribers: Array<(settled: boolean) => void> = [];

  return {
    facts: { count: 0, status: "idle" },
    inspect: vi.fn(() => ({
      facts: { count: 0, status: "idle" },
      constraints: [],
      resolvers: [],
      pendingRequirements: [],
    })),
    constraints: { listDynamic: vi.fn(() => []) },
    resolvers: { listDynamic: vi.fn(() => []) },
    effects: { listDynamic: vi.fn(() => []) },
    subscribe: vi.fn((cb: () => void) => {
      subscribers.push(cb);

      return () => {
        const idx = subscribers.indexOf(cb);
        if (idx >= 0) {
          subscribers.splice(idx, 1);
        }
      };
    }),
    onSettledChange: vi.fn((cb: (settled: boolean) => void) => {
      settledSubscribers.push(cb);

      return () => {
        const idx = settledSubscribers.indexOf(cb);
        if (idx >= 0) {
          settledSubscribers.splice(idx, 1);
        }
      };
    }),
    _emitFactChange: () => {
      for (const cb of subscribers) {
        cb();
      }
    },
    _emitSettledChange: (settled: boolean) => {
      for (const cb of settledSubscribers) {
        cb(settled);
      }
    },
  };
}

describe("replay recorder", () => {
  it("creates a recorder", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    expect(recorder).toBeDefined();
    expect(recorder.isRecording()).toBe(false);
  });

  it("starts and stops recording", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    recorder.start();

    expect(recorder.isRecording()).toBe(true);

    const recording = recorder.stop();

    expect(recorder.isRecording()).toBe(false);
    expect(recording).toBeDefined();
    expect(recording.initialState).toBeDefined();
    expect(recording.events).toBeDefined();
  });

  it("captures fact snapshots", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    recorder.start();

    system.facts.count = 5;
    system._emitFactChange();

    system.facts.count = 10;
    system._emitFactChange();

    const recording = recorder.stop();

    expect(recording.events).toHaveLength(2);
    expect(recording.events[0]!.type).toBe("fact-snapshot");
  });

  it("captures settlement changes", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    recorder.start();

    system._emitSettledChange(false);
    system._emitSettledChange(true);

    const recording = recorder.stop();

    expect(recording.events).toHaveLength(2);
    expect(recording.events[0]!.type).toBe("settlement-change");
    expect(recording.events[0]!.data!.settled).toBe(false);
  });

  it("records initial state", () => {
    const system = mockSystem();
    system.facts.count = 42;

    const recorder = createReplayRecorder(system as never);
    recorder.start();

    const recording = recorder.stop();

    expect(recording.initialState.count).toBe(42);
  });

  it("does not capture events before start", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    system._emitFactChange();
    system._emitFactChange();

    recorder.start();
    system._emitFactChange();

    const recording = recorder.stop();

    expect(recording.events).toHaveLength(1);
  });

  it("does not capture events after stop", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    recorder.start();
    system._emitFactChange();

    const recording = recorder.stop();

    system._emitFactChange();
    system._emitFactChange();

    expect(recording.events).toHaveLength(1);
  });

  it("reports event count", () => {
    const system = mockSystem();
    const recorder = createReplayRecorder(system as never);

    recorder.start();
    system._emitFactChange();
    system._emitFactChange();

    expect(recorder.eventCount()).toBe(2);

    recorder.stop();
  });
});

describe("replay with architect", () => {
  it("replays a recording through LLM", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "I would create a constraint",
      toolCalls: [],
      totalTokens: 50,
    });

    const recording: ReplayRecording = {
      events: [
        {
          offsetMs: 0,
          type: "settlement-change",
          facts: { count: 0 },
          unmetRequirements: [],
          data: { settled: false },
        },
        {
          offsetMs: 1000,
          type: "fact-snapshot",
          facts: { count: 5 },
          unmetRequirements: ["RETRY"],
        },
      ],
      initialState: { count: 0 },
      durationMs: 2000,
      startedAt: Date.now() - 2000,
    };

    const result = await replayWithArchitect(recording, mockRunner as never);

    expect(result.original).toHaveLength(2);
    expect(result.comparison.totalEvents).toBe(2);
    expect(result.comparison.triggeredEvents).toBeGreaterThan(0);
  });

  it("respects maxEvents option", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "",
      toolCalls: [],
      totalTokens: 50,
    });

    const recording: ReplayRecording = {
      events: Array.from({ length: 10 }, (_, i) => ({
        offsetMs: i * 100,
        type: "settlement-change" as const,
        facts: { count: i },
        unmetRequirements: ["TEST"],
        data: { settled: false },
      })),
      initialState: { count: 0 },
      durationMs: 1000,
      startedAt: Date.now() - 1000,
    };

    const result = await replayWithArchitect(recording, mockRunner as never, {
      maxEvents: 3,
    });

    expect(result.original).toHaveLength(10);
    // Only first 3 events processed
    expect(mockRunner).toHaveBeenCalledTimes(3);
  });

  it("collects proposed actions from LLM", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "Creating a constraint",
      toolCalls: [
        {
          name: "create_constraint",
          arguments: JSON.stringify({
            id: "auto-fix",
            whenCode: "facts.count > 5",
            require: { type: "FIX" },
          }),
        },
      ],
      totalTokens: 50,
    });

    const recording: ReplayRecording = {
      events: [
        {
          offsetMs: 0,
          type: "settlement-change",
          facts: { count: 10 },
          unmetRequirements: [],
          data: { settled: false },
        },
      ],
      initialState: { count: 0 },
      durationMs: 100,
      startedAt: Date.now(),
    };

    const result = await replayWithArchitect(recording, mockRunner as never);

    expect(result.withArchitect.length).toBeGreaterThan(0);
    expect(result.comparison.totalActions).toBeGreaterThan(0);
  });

  it("handles LLM errors gracefully", async () => {
    const mockRunner = vi.fn().mockRejectedValue(new Error("LLM error"));

    const recording: ReplayRecording = {
      events: [
        {
          offsetMs: 0,
          type: "settlement-change",
          facts: { count: 0 },
          unmetRequirements: [],
          data: { settled: false },
        },
      ],
      initialState: { count: 0 },
      durationMs: 100,
      startedAt: Date.now(),
    };

    const result = await replayWithArchitect(recording, mockRunner as never);

    // Should not throw — gracefully handles error
    expect(result.withArchitect[0]!.proposedActions).toHaveLength(0);
  });

  it("returns comparison summary", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "",
      toolCalls: [],
      totalTokens: 50,
    });

    const recording: ReplayRecording = {
      events: [
        {
          offsetMs: 0,
          type: "fact-snapshot",
          facts: { count: 0 },
          unmetRequirements: [],
        },
        {
          offsetMs: 100,
          type: "settlement-change",
          facts: { count: 5 },
          unmetRequirements: [],
          data: { settled: false },
        },
      ],
      initialState: { count: 0 },
      durationMs: 200,
      startedAt: Date.now(),
    };

    const result = await replayWithArchitect(recording, mockRunner as never);

    expect(result.comparison.totalEvents).toBe(2);
    expect(typeof result.comparison.triggeredEvents).toBe("number");
    expect(typeof result.comparison.totalActions).toBe("number");
  });
});
