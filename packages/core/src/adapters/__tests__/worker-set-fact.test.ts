import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, t } from "../../index.js";
import { handleWorkerMessages, registerWorkerModule } from "../worker.js";

/**
 * Writing a fact into a worker system threw, for every worker system.
 *
 * The worker always builds a namespaced system, whose top-level facts object
 * exposes a namespace per module and correctly refuses a flat `ns::key`
 * assignment — but that is exactly what `SET_FACT` attempted, so the proxy
 * rejected it and the write failed. `SET_FACTS` probed for a store on the same
 * object, did not find one, and fell through to the same failing path.
 *
 * Nothing covered either, and the messages are the only way the main thread
 * writes to the worker at all. So the channel completed in the worker-to-main
 * direction was dead in the other one.
 */

type Posted = { type: string; [key: string]: unknown };

function makeModule() {
  return createModule("counter", {
    schema: { facts: { n: t.number(), label: t.string() } },
    init: (facts) => {
      facts.n = 0;
      facts.label = "start";
    },
  });
}

describe("writing facts into a worker system", () => {
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
    registerWorkerModule("counter", makeModule());
    handleWorkerMessages();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = async (message: unknown) => {
    await onmessage?.({ data: message });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const started = async () => {
    await send({ type: "INIT", config: { moduleNames: ["counter"] } });
    await send({ type: "START" });
    posted.length = 0;
  };

  it("applies a single fact and mirrors it back", async () => {
    await started();

    await send({ type: "SET_FACT", key: "counter::n", value: 42 });

    const errors = posted.filter((m) => m.type === "ERROR");
    expect(errors).toEqual([]);
    const changes = posted.filter((m) => m.type === "FACT_CHANGED");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ key: "counter::n", value: 42 });
  });

  it("applies several facts as one batch", async () => {
    await started();

    await send({
      type: "SET_FACTS",
      facts: { "counter::n": 7, "counter::label": "set" },
    });

    const errors = posted.filter((m) => m.type === "ERROR");
    expect(errors).toEqual([]);
    const changes = posted.filter((m) => m.type === "FACT_CHANGED");
    expect(changes.map((c) => c.key).sort()).toEqual([
      "counter::label",
      "counter::n",
    ]);
  });

  it("reports a key that names no module rather than failing silently", async () => {
    await started();

    await send({ type: "SET_FACT", key: "nope::n", value: 1 });

    const errors = posted.filter((m) => m.type === "ERROR");
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.error)).toMatch(/nope/);
  });
});
