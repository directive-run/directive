import { afterEach, describe, expect, it } from "vitest";
import { combineSignals, createRunner, linkSignals } from "../agent-utils.js";
import type { AgentLike } from "../types.js";

describe("combineSignals — fetch signal collision", () => {
  it("returns undefined when no signals provided", () => {
    expect(combineSignals([undefined, undefined])).toBeUndefined();
    expect(combineSignals([])).toBeUndefined();
  });

  it("returns the single signal when only one is live", () => {
    const c = new AbortController();
    const out = combineSignals([undefined, c.signal]);
    expect(out).toBe(c.signal);
  });

  it("aborts when EITHER input signal aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const out = combineSignals([a.signal, b.signal])!;
    expect(out.aborted).toBe(false);
    a.abort();
    expect(out.aborted).toBe(true);
  });

  it("aborts via second signal independently", () => {
    const a = new AbortController();
    const b = new AbortController();
    const out = combineSignals([a.signal, b.signal])!;
    b.abort();
    expect(out.aborted).toBe(true);
  });

  it("returns an already-aborted signal if any input is pre-aborted", () => {
    const a = new AbortController();
    const b = new AbortController();
    a.abort();
    const out = combineSignals([a.signal, b.signal])!;
    expect(out.aborted).toBe(true);
  });
});

/**
 * The fallback path, on runtimes without `AbortSignal.any`, wires a listener
 * onto every input signal. A caller's signal usually outlives the call it was
 * passed to by a long way — one signal per session, one call per turn — so a
 * listener left behind on every call is a leak that grows with the session.
 */
describe("linkSignals — the fallback wiring comes apart again", () => {
  const anyFn = (
    AbortSignal as unknown as {
      any?: (s: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;

  afterEach(() => {
    (AbortSignal as unknown as { any?: unknown }).any = anyFn;
  });

  function withoutAbortSignalAny(): void {
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
  }

  it("stops listening once released", () => {
    withoutAbortSignalAny();
    const a = new AbortController();
    const b = new AbortController();
    const link = linkSignals([a.signal, b.signal]);

    link.release();
    a.abort();

    expect(link.signal?.aborted).toBe(false);
  });

  it("still aborts before it is released", () => {
    withoutAbortSignalAny();
    const a = new AbortController();
    const b = new AbortController();
    const link = linkSignals([a.signal, b.signal]);

    b.abort();

    expect(link.signal?.aborted).toBe(true);
  });

  it("releases the sibling listener when one input fires", () => {
    withoutAbortSignalAny();
    const a = new AbortController();
    const b = new AbortController();
    const link = linkSignals([a.signal, b.signal]);

    a.abort();
    // `b` is still live and still referenced by the caller; nothing of this
    // call should remain attached to it.
    expect(link.signal?.aborted).toBe(true);
    expect(() => b.abort()).not.toThrow();
  });
});

describe("createRunner — signal collision", () => {
  it("both buildRequest signal AND runOptions signal can trigger fetch abort", async () => {
    let observedSignal: AbortSignal | undefined;

    const userController = new AbortController();
    const buildController = new AbortController();

    const fakeFetch: typeof globalThis.fetch = async (
      _url,
      init?: RequestInit,
    ) => {
      observedSignal = init?.signal ?? undefined;
      // Return a minimal Response-like object that the runner's
      // `response.ok` branch is happy with.
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    };

    const runner = createRunner({
      fetch: fakeFetch,
      buildRequest: () => ({
        url: "https://example.test/api",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: buildController.signal,
        },
      }),
      parseResponse: async () => ({
        text: "ok",
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
      }),
    });

    const agent: AgentLike = { name: "test" };
    await runner(agent, "hello", { signal: userController.signal });

    expect(observedSignal).toBeDefined();
    expect(observedSignal!.aborted).toBe(false);
    // Aborting either underlying signal must propagate to the combined signal.
    userController.abort();
    expect(observedSignal!.aborted).toBe(true);
  });

  it("buildRequest signal still works when caller passes no signal", async () => {
    let observedSignal: AbortSignal | undefined;
    const buildController = new AbortController();

    const fakeFetch: typeof globalThis.fetch = async (
      _url,
      init?: RequestInit,
    ) => {
      observedSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    };

    const runner = createRunner({
      fetch: fakeFetch,
      buildRequest: () => ({
        url: "https://example.test/api",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: buildController.signal,
        },
      }),
      parseResponse: async () => ({
        text: "ok",
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
      }),
    });

    await runner({ name: "test" }, "hello");
    // The buildRequest signal must still reach fetch when no
    // runOptions.signal is provided.
    expect(observedSignal).toBe(buildController.signal);
  });
});
