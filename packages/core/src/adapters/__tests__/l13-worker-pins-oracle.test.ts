import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, t } from "../../index.js";
import { handleWorkerMessages, registerWorkerModule } from "../worker.js";

// The L13 RFC's probe pins for /worker (U13 to U15). Each pins 1.35's
// behaviour. U14 is where the row (cc) lives: (cc) is declined, so a worker
// keeps dropping a message that arrives before INIT or after DESTROY, with
// no reply, on both engines.

type Posted = { type: string; [key: string]: unknown };

function makeModule() {
  return createModule("pinned", {
    schema: {
      facts: { n: t.number(), label: t.string() },
      derivations: { double: t.number() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 1;
      facts.label = "start";
    },
    derive: { double: (facts: any) => facts.n * 2 },
  } as never);
}

describe("L13 probe pins: /worker", () => {
  let posted: Posted[];
  let onmessage: ((event: { data: unknown }) => unknown) | null;

  beforeEach(() => {
    posted = [];
    onmessage = null;
    vi.stubGlobal("postMessage", (message: Posted) => {
      posted.push(message);
    });
    vi.stubGlobal("self", {
      set onmessage(handler: (event: { data: unknown }) => unknown) {
        onmessage = handler;
      },
      get onmessage() {
        return onmessage as (event: { data: unknown }) => unknown;
      },
    });
    registerWorkerModule("pinned", makeModule());
    handleWorkerMessages();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (message: unknown) => {
    await onmessage?.({ data: message });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const init = () =>
    send({ type: "INIT", config: { moduleNames: ["pinned"] } });
  const types = () => posted.map((m) => m.type);

  it("U13: an unregistered module at INIT posts ERROR from INIT, and the worker stays uninitialised", async () => {
    await send({ type: "INIT", config: { moduleNames: ["nope"] } });

    expect(posted).toEqual([
      {
        type: "ERROR",
        error:
          "[Directive Worker] Module \"nope\" not registered. Call registerWorkerModule('nope', module) before handling messages.",
        source: "INIT",
      },
    ]);
    posted.length = 0;
    await send({ type: "START" });
    expect(posted).toEqual([]);
  });

  it("U13: a fact key with no module posts ERROR naming the format, and one for an unknown module names the module", async () => {
    await init();
    posted.length = 0;
    await send({ type: "SET_FACT", key: "n", value: 5 });
    await send({ type: "SET_FACT", key: "::n", value: 5 });
    await send({ type: "SET_FACT", key: "ghost::n", value: 5 });
    await send({ type: "SET_FACTS", facts: { n: 5 } });

    expect(posted).toEqual([
      {
        type: "ERROR",
        error:
          '[Directive] worker: fact key "n" names no module. Use "<module>::<fact>".',
        source: "SET_FACT",
      },
      {
        type: "ERROR",
        error:
          '[Directive] worker: fact key "::n" names no module. Use "<module>::<fact>".',
        source: "SET_FACT",
      },
      {
        type: "ERROR",
        error:
          '[Directive] worker: no module named "ghost" in this system, so "ghost::n" was not written.',
        source: "SET_FACT",
      },
      {
        type: "ERROR",
        error:
          '[Directive] worker: fact key "n" names no module. Use "<module>::<fact>".',
        source: "SET_FACTS",
      },
    ]);
  });

  it("U14: a message before INIT is dropped with no reply (shows cc)", async () => {
    for (const message of [
      { type: "START" },
      { type: "SET_FACT", key: "pinned::n", value: 3 },
      { type: "SET_FACTS", facts: { "pinned::n": 3 } },
      { type: "DISPATCH", event: { type: "x" } },
      { type: "INSPECT", requestId: "i-1" },
      { type: "GET_SNAPSHOT", requestId: "s-1" },
      { type: "SETTLE", requestId: "t-1" },
      { type: "STOP" },
      { type: "DESTROY" },
    ]) {
      await send(message);
    }

    expect(posted).toEqual([]);
  });

  it("U14: a message after DESTROY is dropped with no reply, and a second INIT starts afresh (shows cc)", async () => {
    await init();
    await send({ type: "START" });
    await send({ type: "DESTROY" });
    expect(types().slice(-2)).toEqual(["STARTED", "DESTROYED"]);
    posted.length = 0;

    await send({ type: "START" });
    await send({ type: "SET_FACT", key: "pinned::n", value: 3 });
    await send({ type: "INSPECT", requestId: "i-2" });
    await send({ type: "DESTROY" });
    expect(posted).toEqual([]);

    await init();
    expect(types()).toEqual(["READY"]);
  });

  it("U15: START posts the init write's changes before STARTED; an equal write posts nothing", async () => {
    await init();
    expect(types()).toEqual(["READY"]);
    posted.length = 0;
    await send({ type: "START" });

    const started = types().indexOf("STARTED");
    expect(started).toBe(types().length - 1);
    const before = posted.slice(0, started);
    expect(before.filter((m) => m.type === "FACT_CHANGED")).toEqual([
      { type: "FACT_CHANGED", key: "pinned::n", value: 1, prev: undefined },
      {
        type: "FACT_CHANGED",
        key: "pinned::label",
        value: "start",
        prev: undefined,
      },
    ]);
    expect(before.some((m) => m.type === "DERIVATION_CHANGED")).toBe(true);

    posted.length = 0;
    await send({ type: "SET_FACT", key: "pinned::n", value: 1 });
    expect(posted).toEqual([]);
    await send({ type: "SET_FACT", key: "pinned::n", value: 4 });
    expect(posted.filter((m) => m.type === "FACT_CHANGED")).toEqual([
      { type: "FACT_CHANGED", key: "pinned::n", value: 4, prev: 1 },
    ]);
  });

  it("U15: GET_SNAPSHOT after a write posts DERIVATION_CHANGED, then SNAPSHOT_RESULT, and SET_FACTS folds a key's run into one message", async () => {
    await init();
    await send({ type: "START" });
    await send({ type: "SET_FACT", key: "pinned::n", value: 4 });
    posted.length = 0;
    await send({ type: "GET_SNAPSHOT", requestId: "s-1", options: {} });
    expect(types()).toEqual(["DERIVATION_CHANGED", "SNAPSHOT_RESULT"]);
    expect(posted[0]).toEqual({
      type: "DERIVATION_CHANGED",
      key: "pinned::double",
      value: 8,
    });
    expect(posted[1]?.requestId).toBe("s-1");

    posted.length = 0;
    await send({
      type: "SET_FACTS",
      facts: { "pinned::n": 7, "pinned::label": "x" },
    });
    expect(posted.filter((m) => m.type === "FACT_CHANGED")).toEqual([
      { type: "FACT_CHANGED", key: "pinned::n", value: 7, prev: 4 },
      { type: "FACT_CHANGED", key: "pinned::label", value: "x", prev: "start" },
    ]);
  });
});
