/**
 * A batch run detached by a re-raise is aborted when its requirement is
 * retracted, found by the L7 batch fuzz (cases 16:all#185 and 9:all#46;
 * api/resolvers.ts `abort()`).
 *
 * A batched requirement raised again while its batch runs is queued again
 * and the running batch goes on detached (fuzz case 1967). A write that
 * then retracts the requirement cancels the new run. 1.35 aborts every
 * batch that owns the requirement, so the old one too. Before the fix 2.0
 * looked only at the requirement's run in flight: the detached batch went
 * on, retried, wrote, and reported an outcome for a canceled requirement.
 *
 * A let-go run (RFC-0003: its requirement is bound by `abortOn`, so its
 * retraction detaches it) is not aborted, as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const recorder = (log: string[]) => ({
  name: "rec",
  onResolverComplete: (_r: string, req: any) => log.push(`complete ${req.id}`),
  onResolverError: (_r: string, req: any) => log.push(`error ${req.id}`),
  onResolverRetry: (_r: string, req: any) => log.push(`retry ${req.id}`),
  onResolverCancel: (_r: string, req: any) => log.push(`cancel ${req.id}`),
  onRequirementMet: (req: any) => log.push(`met ${req.id}`),
});

describe("a batch run detached by a re-raise, then retracted", () => {
  it("is aborted with the new run: no retry, no outcome, no write (1.35)", async () => {
    const log: string[] = [];
    let calls = 0;
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.b = false;
        f.out = 0;
      },
      constraints: {
        // Bound: retracted while queued, it stays queued and runs.
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
        // Not bound: its retraction cancels the requirement.
        plain: {
          when: (f: any) => f.b,
          require: () => [{ type: "FETCH", id: "x" }],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10, maxSize: 5 },
          retry: { attempts: 2, backoff: "none", initialDelay: 1 },
          resolveBatch: async (_reqs: any[], ctx: any) => {
            const n = ++calls;
            log.push(`call ${n}`);
            ctx.signal.addEventListener("abort", () =>
              log.push(`aborted ${n}`),
            );
            // It does not watch its signal: it fails, then would retry.
            await new Promise((r) => setTimeout(r, 30));
            if (n === 1) {
              throw new Error("first fails");
            }
            // A run still wanted writes (a canceled one's write would land).
            ctx.signal.aborted || (ctx.facts.out = n);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true; // x queued
    await vi.advanceTimersByTimeAsync(1);
    facts.a = false; // retracted; bound, so it stays queued
    await vi.advanceTimersByTimeAsync(10); // the window closes: call 1 runs x
    expect(log).toEqual(["call 1"]);
    facts.b = true; // x raised again while call 1 runs: call 1 goes on detached
    await vi.advanceTimersByTimeAsync(11); // call 2 runs x
    expect(log).toEqual(["call 1", "call 2"]);
    facts.b = false; // a write retracts x
    await vi.advanceTimersByTimeAsync(1);
    // Both runs that own x are aborted and report their cancel, in the
    // order they started (1.35).
    expect(log).toEqual([
      "call 1",
      "call 2",
      "aborted 1",
      "cancel x",
      "aborted 2",
      "cancel x",
    ]);
    await vi.advanceTimersByTimeAsync(200);
    // Call 1's failure comes after its abort: no retry (call 3 would write
    // 3), no outcome.
    expect(calls).toBe(2);
    expect(log.slice(6)).toEqual([]);
    expect(facts.out).toBe(0);
    system.stop();
  });

  it("goes on if retracted while queued again: only the queued one is canceled (1.35)", async () => {
    const log: string[] = [];
    let calls = 0;
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.b = false;
        f.out = 0;
      },
      constraints: {
        // Bound: retracted while queued, it stays queued and runs.
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
        // Not bound: its retraction cancels the requirement.
        plain: {
          when: (f: any) => f.b,
          require: () => [{ type: "FETCH", id: "x" }],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10, maxSize: 5 },
          retry: { attempts: 2, backoff: "none", initialDelay: 1 },
          resolveBatch: async (_reqs: any[], ctx: any) => {
            const n = ++calls;
            log.push(`call ${n}`);
            ctx.signal.addEventListener("abort", () =>
              log.push(`aborted ${n}`),
            );
            // It does not watch its signal: it fails, then would retry.
            await new Promise((r) => setTimeout(r, 30));
            if (n === 1) {
              throw new Error("first fails");
            }
            // A run still wanted writes (a canceled one's write would land).
            ctx.signal.aborted || (ctx.facts.out = n);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true; // x queued
    await vi.advanceTimersByTimeAsync(1);
    facts.a = false; // retracted; bound, so it stays queued
    await vi.advanceTimersByTimeAsync(10); // the window closes: call 1 runs x
    expect(log).toEqual(["call 1"]);
    facts.b = true; // x raised again while call 1 runs: call 1 goes on detached
    await vi.advanceTimersByTimeAsync(1); // x queued again, not yet run
    facts.b = false; // a write retracts x while it is queued
    await vi.advanceTimersByTimeAsync(200);
    // 1.35 cancels the queued x and stops there: call 1 goes on, retries
    // (call 2) and reports its outcome.
    expect(log.slice(0, 2)).toEqual(["call 1", "cancel x"]);
    expect(log).not.toContain("aborted 1");
    expect(calls).toBe(2);
    expect(log).toContain("complete x");
    expect(facts.out).toBe(2);
    system.stop();
  });

  it("aborts the batches that own it in the order they started (1.35)", async () => {
    const log: string[] = [];
    let calls = 0;
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.b = false;
        f.out = 0;
      },
      constraints: {
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
        plain: {
          when: (f: any) => f.b,
          require: () => [{ type: "FETCH", id: "x" }],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10, maxSize: 5 },
          resolveBatch: async (_reqs: any[], ctx: any) => {
            const n = ++calls;
            log.push(`call ${n}`);
            ctx.signal.addEventListener("abort", () =>
              log.push(`aborted ${n}`),
            );
            await new Promise((r) => setTimeout(r, 30));
            ctx.signal.aborted || (ctx.facts.out = n);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true;
    await vi.advanceTimersByTimeAsync(11); // call 1 runs x
    facts.a = false; // bound: call 1 is let go
    await vi.advanceTimersByTimeAsync(1);
    facts.b = true; // x raised again, not bound: call 2 runs it
    await vi.advanceTimersByTimeAsync(11);
    facts.b = false; // a write retracts x: both calls own it
    await vi.advanceTimersByTimeAsync(1);
    // 1.35 gives "aborted 1, aborted 2" (the review's probe A); 2.0 aborted
    // the run in flight first.
    expect(log).toEqual([
      "call 1",
      "call 2",
      "aborted 1",
      "cancel x",
      "aborted 2",
      "cancel x",
    ]);
    await vi.advanceTimersByTimeAsync(200);
    expect(log.slice(6)).toEqual([]);
    expect(facts.out).toBe(0);
    system.stop();
  });
});

describe("a let-go batch run (RFC-0003)", () => {
  it("is not aborted when another of its requirements is retracted", async () => {
    const log: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.b = false;
        f.out = 0;
      },
      constraints: {
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
        plain: {
          when: (f: any) => f.b,
          require: () => [{ type: "FETCH", id: "y" }],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10, maxSize: 5 },
          resolveBatch: async (reqs: any[], ctx: any) => {
            log.push(`call ${reqs.map((r) => r.id).join(",")}`);
            ctx.signal.addEventListener("abort", () => log.push("aborted"));
            await new Promise((r) => setTimeout(r, 30));
            ctx.facts.out = 1;
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true;
    facts.b = true;
    await vi.advanceTimersByTimeAsync(11); // one call runs x and y
    expect(log).toEqual(["call x,y"]);
    facts.a = false; // x retracted; bound, so the run is let go
    await vi.advanceTimersByTimeAsync(1);
    facts.b = false; // y retracted: only y leaves the let-go run
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["call x,y", "cancel y"]);
    await vi.advanceTimersByTimeAsync(100);
    // The let-go run goes on: its write lands and it reports x.
    expect(log).not.toContain("aborted");
    expect(log).toContain("complete x");
    expect(facts.out).toBe(1);
    system.stop();
  });

  it("a let-go batch run goes on after its requirement's retraction", async () => {
    const log: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.out = 0;
      },
      constraints: {
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10, maxSize: 5 },
          resolveBatch: async (_reqs: any[], ctx: any) => {
            log.push("call");
            ctx.signal.addEventListener("abort", () => log.push("aborted"));
            await new Promise((r) => setTimeout(r, 30));
            ctx.facts.out = 1;
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true;
    await vi.advanceTimersByTimeAsync(11); // the call runs x
    facts.a = false; // retracted; bound, so the run is let go
    await vi.advanceTimersByTimeAsync(100);
    expect(log).not.toContain("aborted");
    expect(log).not.toContain("cancel x");
    expect(log).toContain("complete x");
    expect(facts.out).toBe(1);
    system.stop();
  });

  it("a let-go single run is not touched by an unrelated retraction", async () => {
    const log: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { a: t.boolean(), b: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.a = false;
        f.b = false;
        f.out = 0;
      },
      constraints: {
        bound: {
          when: (f: any) => f.a,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
        plain: {
          when: (f: any) => f.b,
          require: () => [{ type: "FETCH", id: "y" }],
        },
      },
      resolvers: {
        // Not batched: each requirement is a single run.
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          resolve: async (req: any, ctx: any) => {
            log.push(`run ${req.id}`);
            ctx.signal.addEventListener("abort", () =>
              log.push(`aborted ${req.id}`),
            );
            await new Promise((r) => setTimeout(r, 30));
            ctx.signal.aborted || req.id !== "x" || (ctx.facts.out = 1);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod, plugins: [recorder(log)] });
    system.start();
    const facts = system.facts as any;
    facts.a = true;
    facts.b = true;
    await vi.advanceTimersByTimeAsync(1); // x and y run
    expect(log).toEqual(["run x", "run y"]);
    facts.a = false; // x retracted; bound, so its run is let go
    await vi.advanceTimersByTimeAsync(1);
    facts.b = false; // y retracted: only y's run is aborted
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(["run x", "run y", "aborted y", "cancel y"]);
    await vi.advanceTimersByTimeAsync(100);
    // The let-go run goes on: its write lands and it reports x.
    expect(log).not.toContain("aborted x");
    expect(log).not.toContain("cancel x");
    expect(log).toContain("complete x");
    expect(facts.out).toBe(1);
    system.stop();
  });
});
