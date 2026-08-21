import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, t } from "../../index.js";
import { handleWorkerMessages, registerWorkerModule } from "../worker.js";

/**
 * The worker adapter mirrors facts to the main thread by posting a message per
 * write — and it posted only for writes made outside a batch.
 *
 * This is not an audit gap. `FACT_CHANGED` is the only path that carries a
 * fact value across the boundary; there is no wholesale sync behind it. So a
 * worker-backed application missed every write an event handler made, which is
 * most of them, and its view of the facts silently diverged from the worker's.
 *
 * Worse: derived values are not batch-gated, so `DERIVATION_CHANGED` arrived
 * for a value computed from a fact whose own change never did. The main thread
 * could show a computed number contradicting the number it is computed from.
 */

type Posted = { type: string; [key: string]: unknown };

function makeModule() {
  return createModule("counter", {
    schema: {
      facts: { n: t.number() },
      derivations: { doubled: t.number() },
      events: { BUMP: {} },
    },
    init: (facts) => {
      facts.n = 0;
    },
    derive: {
      doubled: (facts) => facts.n * 2,
    },
    events: {
      BUMP: (facts) => {
        facts.n = facts.n + 1;
      },
    },
  });
}

describe("the worker adapter and batched writes", () => {
  let posted: Posted[];
  let onmessage: ((event: { data: unknown }) => unknown) | null;
  const originals = {
    postMessage: globalThis.postMessage,
    self: globalThis.self,
  };

  beforeEach(() => {
    posted = [];
    onmessage = null;
    const fakeSelf = {
      set onmessage(handler: (event: { data: unknown }) => unknown) {
        onmessage = handler;
      },
      get onmessage() {
        return onmessage as (event: { data: unknown }) => unknown;
      },
    };
    vi.stubGlobal("postMessage", (message: Posted) => {
      posted.push(message);
    });
    vi.stubGlobal("self", fakeSelf);
    registerWorkerModule("counter", makeModule());
    handleWorkerMessages();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.postMessage = originals.postMessage;
    globalThis.self = originals.self;
  });

  const send = async (message: unknown) => {
    await onmessage?.({ data: message });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("mirrors a write an event handler made", async () => {
    await send({ type: "INIT", config: { moduleNames: ["counter"] } });
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "DISPATCH", event: { type: "counter::BUMP" } });

    const factMessages = posted.filter((m) => m.type === "FACT_CHANGED");
    expect(factMessages).toHaveLength(1);
    expect(factMessages[0]).toMatchObject({ key: "counter::n", value: 1 });
  });

  it("sends the fact before the value computed from it", async () => {
    // The opening state is written in a batch, so the mirror was never told
    // `n` had a value — while the derived value computed from it was sent, in
    // the same startup sequence, because derivations are not gated the same
    // way. The main thread could show a computed number with no idea what it
    // was computed from.
    await send({ type: "INIT", config: { moduleNames: ["counter"] } });
    await send({ type: "START" });

    const kinds = posted.map((message) => message.type);
    const factAt = kinds.indexOf("FACT_CHANGED");
    const derivedAt = kinds.indexOf("DERIVATION_CHANGED");

    expect(
      factAt,
      "the opening value of the fact never crossed",
    ).toBeGreaterThan(-1);
    expect(derivedAt).toBeGreaterThan(-1);
    expect(factAt).toBeLessThan(derivedAt);
    expect(posted[factAt]).toMatchObject({ key: "counter::n", value: 0 });
  });

  it("posts one message per run of writes to a key, not one per write", async () => {
    // Every message here is a structured clone across a thread boundary and a
    // render on the other side. A handler writing one key a thousand times in
    // a batch posted a thousand of them, carrying values the main thread can
    // never observe — it only ever sees the last.
    registerWorkerModule("looper", loopModule());
    await send({ type: "INIT", config: { moduleNames: ["looper"] } });
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "DISPATCH", event: { type: "looper::LOOP" } });

    const factMessages = posted.filter((m) => m.type === "FACT_CHANGED");
    expect(factMessages).toHaveLength(1);
    expect(factMessages[0]).toMatchObject({ key: "looper::n", value: 500 });
  });
});

function loopModule() {
  return createModule("looper", {
    schema: {
      facts: { n: t.number() },
      events: { LOOP: {} },
    },
    init: (facts) => {
      facts.n = 0;
    },
    events: {
      LOOP: (facts) => {
        for (let i = 1; i <= 500; i++) {
          facts.n = i;
        }
      },
    },
  });
}
