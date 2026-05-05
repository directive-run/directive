import { virtualClock } from "@directive-run/core";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CancelError,
  type CancelReason,
  SupersededCancelError,
  TimeoutCancelError,
  cancelReason,
  cancellable,
} from "../index.js";

describe("R1.C cancellable() — basic invocation", () => {
  it("invokes the wrapped handler with a non-aborted signal", async () => {
    const wrapped = cancellable<{ count: number }, { delta: number }>(
      {},
      async ({ payload, facts, signal }) => {
        expect(signal.aborted).toBe(false);
        facts.count += payload.delta;
      },
    );
    const facts = { count: 0 };
    await wrapped({ facts, payload: { delta: 5 }, requeue: () => {} });
    expect(facts.count).toBe(5);
  });

  it("clears the supersession slot after a clean run", async () => {
    const captured: AbortSignal[] = [];
    const wrapped = cancellable<{ done: boolean }, Record<string, never>>(
      {},
      async ({ facts, signal }) => {
        captured.push(signal);
        facts.done = true;
      },
    );
    const facts = { done: false };
    await wrapped({ facts, payload: {}, requeue: () => {} });
    // After completion, captured signal stays unaborted (no timeout fired).
    expect(captured[0]?.aborted).toBe(false);
    // A second invocation gets a fresh controller — distinct identity.
    await wrapped({ facts, payload: {}, requeue: () => {} });
    expect(captured.length).toBe(2);
    expect(captured[1]?.aborted).toBe(false);
    expect(captured[1]).not.toBe(captured[0]);
  });
});

describe("R1.C cancellable() — supersession", () => {
  it("aborts the prior in-flight handler when a new dispatch arrives", async () => {
    let releaseFirst: () => void = () => {};
    const seen: string[] = [];
    const wrapped = cancellable<{ result: string }, { tag: string }>(
      { supersedeOn: "self" },
      async ({ payload, facts, signal }) => {
        if (payload.tag === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          if (signal.aborted) {
            seen.push("first-aborted");
            return;
          }
          seen.push("first-completed");
          facts.result = "first";
        } else {
          seen.push("second-completed");
          facts.result = "second";
        }
      },
    );

    const facts = { result: "" };
    // First dispatch — pauses on releaseFirst.
    const first = wrapped({
      facts,
      payload: { tag: "first" },
      requeue: () => {},
    });
    // Second dispatch — supersedes; first's signal aborts.
    const second = wrapped({
      facts,
      payload: { tag: "second" },
      requeue: () => {},
    });

    // Let second complete (it's synchronous after entry).
    await second;
    // Release first — it observes signal.aborted and returns.
    releaseFirst();
    await first;

    expect(seen).toEqual(["second-completed", "first-aborted"]);
    expect(facts.result).toBe("second");
  });

  it("the abort reason carries a 'superseded' CancelReason", async () => {
    let releaseFirst: () => void = () => {};
    let abortReason: unknown;
    const wrapped = cancellable<Record<string, never>, { tag: string }>(
      { supersedeOn: "self" },
      async ({ payload, signal }) => {
        if (payload.tag === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          if (signal.aborted) {
            abortReason = signal.reason;
          }
        }
        // Second-tag invocations exit synchronously without awaiting,
        // so they don't compete for the shared `releaseFirst` slot.
      },
    );

    const facts = {};
    const first = wrapped({
      facts,
      payload: { tag: "first" },
      requeue: () => {},
    });
    const second = wrapped({
      facts,
      payload: { tag: "second" },
      requeue: () => {},
    });

    await second;
    releaseFirst();
    await first;

    const reason = abortReason as CancelReason;
    expect(reason?.kind).toBe("superseded");
  });

  it("supersedeOn: 'never' lets prior invocations run to completion", async () => {
    let releaseFirst: () => void = () => {};
    const completions: string[] = [];
    const wrapped = cancellable<Record<string, never>, { tag: string }>(
      { supersedeOn: "never" },
      async ({ payload, signal }) => {
        if (payload.tag === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        if (!signal.aborted) {
          completions.push(payload.tag);
        }
      },
    );

    const facts = {};
    const first = wrapped({
      facts,
      payload: { tag: "first" },
      requeue: () => {},
    });
    const second = wrapped({
      facts,
      payload: { tag: "second" },
      requeue: () => {},
    });
    await second;
    releaseFirst();
    await first;

    expect(completions).toEqual(["second", "first"]);
  });
});

describe("R1.C cancellable() — timeout", () => {
  it("aborts the signal after timeoutMs (using virtualClock)", async () => {
    const clock = virtualClock(0);
    let abortReason: unknown;

    const wrapped = cancellable<Record<string, never>, Record<string, never>>(
      { timeoutMs: 1_000, setTimeout: clock.setTimeout },
      async ({ signal }) => {
        // Wait for an external "completion" or signal abort.
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            abortReason = signal.reason;
            resolve();
          });
        });
      },
    );

    const promise = wrapped({ facts: {}, payload: {}, requeue: () => {} });

    // Let the handler register the abort listener.
    await Promise.resolve();
    expect(abortReason).toBeUndefined();

    // Advance virtual time past the timeout — the timeout abort
    // fires synchronously inside advanceBy.
    clock.advanceBy?.(1_001);

    await promise;
    const reason = abortReason as CancelReason;
    expect(reason?.kind).toBe("timeout");
    if (reason?.kind === "timeout") {
      expect(reason.afterMs).toBe(1_000);
    }
  });

  it("does NOT abort when the handler completes before the timeout", async () => {
    const clock = virtualClock(0);
    let aborted = false;

    const wrapped = cancellable<Record<string, never>, Record<string, never>>(
      { timeoutMs: 5_000, setTimeout: clock.setTimeout },
      async ({ signal }) => {
        // Complete promptly.
        await Promise.resolve();
        if (signal.aborted) aborted = true;
      },
    );

    await wrapped({ facts: {}, payload: {}, requeue: () => {} });
    expect(aborted).toBe(false);

    // Advance past the (now-cleared) timeout — nothing should fire.
    clock.advanceBy?.(10_000);
    expect(aborted).toBe(false);
  });

  it("supersession + timeout compose: a superseded handler's timeout is cleared", async () => {
    const clock = virtualClock(0);
    let releaseFirst: () => void = () => {};
    const abortReasons: CancelReason[] = [];

    const wrapped = cancellable<Record<string, never>, { tag: string }>(
      { supersedeOn: "self", timeoutMs: 1_000, setTimeout: clock.setTimeout },
      async ({ payload, signal }) => {
        if (payload.tag === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        if (signal.aborted) {
          abortReasons.push(signal.reason as CancelReason);
        }
      },
    );

    const facts = {};
    const first = wrapped({
      facts,
      payload: { tag: "first" },
      requeue: () => {},
    });
    const second = wrapped({
      facts,
      payload: { tag: "second" },
      requeue: () => {},
    });

    await second;
    releaseFirst();
    await first;

    // First saw a 'superseded' abort, not a 'timeout' — the timeout
    // for first should have been cleaned up when supersession aborted.
    expect(abortReasons.length).toBe(1);
    expect(abortReasons[0]?.kind).toBe("superseded");

    // Advance past the original first timeout window — nothing else
    // should fire (controller is already aborted; clean exit).
    clock.advanceBy?.(2_000);
    expect(abortReasons.length).toBe(1);
  });
});

describe("R2 sec M-1: signal.reason is a CancelError subclass", () => {
  it("supersession reason is a SupersededCancelError instance", async () => {
    let releaseFirst: () => void = () => {};
    let abortReason: unknown;
    const wrapped = cancellable<Record<string, never>, { tag: string }>(
      { supersedeOn: "self" },
      async ({ payload, signal }) => {
        if (payload.tag === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          if (signal.aborted) abortReason = signal.reason;
        }
      },
    );

    const facts = {};
    const first = wrapped({
      facts,
      payload: { tag: "first" },
      requeue: () => {},
    });
    const second = wrapped({
      facts,
      payload: { tag: "second" },
      requeue: () => {},
    });
    await second;
    releaseFirst();
    await first;

    // The reason is now an Error subclass — survives transit through
    // fetch/.catch(err => err instanceof Error)/logging frameworks.
    expect(abortReason).toBeInstanceOf(Error);
    expect(abortReason).toBeInstanceOf(CancelError);
    expect(abortReason).toBeInstanceOf(SupersededCancelError);
    expect((abortReason as CancelError).kind).toBe("superseded");
    expect((abortReason as Error).message).toContain("superseded");
  });

  it("timeout reason is a TimeoutCancelError instance carrying afterMs", async () => {
    const clock = virtualClock(0);
    let abortReason: unknown;

    const wrapped = cancellable<Record<string, never>, Record<string, never>>(
      { timeoutMs: 1_000, setTimeout: clock.setTimeout },
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            abortReason = signal.reason;
            resolve();
          });
        });
      },
    );

    const promise = wrapped({ facts: {}, payload: {}, requeue: () => {} });
    await Promise.resolve();
    clock.advanceBy?.(1_001);
    await promise;

    expect(abortReason).toBeInstanceOf(Error);
    expect(abortReason).toBeInstanceOf(CancelError);
    expect(abortReason).toBeInstanceOf(TimeoutCancelError);
    expect((abortReason as TimeoutCancelError).afterMs).toBe(1_000);
  });

  it("cancelReason factory produces matching instances", () => {
    const s = cancelReason.superseded();
    expect(s).toBeInstanceOf(SupersededCancelError);
    expect(s.kind).toBe("superseded");

    const t = cancelReason.timeout(500);
    expect(t).toBeInstanceOf(TimeoutCancelError);
    expect(t.kind).toBe("timeout");
    expect(t.afterMs).toBe(500);
  });

  it("CancelReason type narrows correctly off signal.reason", () => {
    // Type-level smoke test: kind discriminator narrows.
    const reason: CancelReason = cancelReason.timeout(100);
    if (reason.kind === "timeout") {
      // TS knows reason has afterMs here
      expect(reason.afterMs).toBe(100);
    }
  });
});

describe("R2 sec M-3: cancelTimeout cleanup does not shadow handler errors", () => {
  it("a throwing setTimeout cancel-handle does not replace handler exception", async () => {
    const wrapped = cancellable<Record<string, never>, Record<string, never>>(
      {
        timeoutMs: 1_000,
        // Hostile setTimeout that returns a cancel function which throws.
        setTimeout: (_cb, _ms) => () => {
          throw new Error("hostile cancel");
        },
      },
      async () => {
        throw new Error("real handler error");
      },
    );

    await expect(
      wrapped({ facts: {}, payload: {}, requeue: () => {} }),
    ).rejects.toThrow("real handler error");
  });
});

describe("R1.C cancellable() — independence between separate HOCs", () => {
  it("two separate cancellable() wraps do NOT cancel each other", async () => {
    let releaseFirst: () => void = () => {};
    const completions: string[] = [];

    const wrapA = cancellable<Record<string, never>, Record<string, never>>(
      { supersedeOn: "self" },
      async ({ signal }) => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        if (!signal.aborted) completions.push("A");
      },
    );
    const wrapB = cancellable<Record<string, never>, Record<string, never>>(
      { supersedeOn: "self" },
      async ({ signal }) => {
        if (!signal.aborted) completions.push("B");
      },
    );

    const a = wrapA({ facts: {}, payload: {}, requeue: () => {} });
    // wrapB invocation does NOT abort wrapA's invocation — they have
    // independent supersession slots.
    const b = wrapB({ facts: {}, payload: {}, requeue: () => {} });
    await b;
    releaseFirst();
    await a;

    expect(completions).toEqual(["B", "A"]);
  });
});
