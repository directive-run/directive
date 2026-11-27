/**
 * L13c: `/worker` (W1 to W7 of the L13 RFC), ported from 1.35.
 *
 * The worker side runs in process: `self` and `postMessage` are stubbed, as
 * 1.35's own tests do. Row (cc) was declined, so a message before `INIT` or
 * after `DESTROY` gets no reply.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type WorkerOutboundMessage,
  createWorkerClient,
  getWorkerModuleRegistry,
  handleWorkerMessages,
  registerWorkerModule,
} from "../adapters/worker.js";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";

type Posted = { type: string; [key: string]: unknown };

function makeModule() {
  return createModule("counter", {
    schema: {
      facts: { n: t.number(), label: t.string() },
      derivations: { double: t.number() },
      events: { bump: {}, burst: {} },
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.n = 1;
      facts.label = "start";
    },
    derive: { double: (facts: any) => facts.n * 2 },
    events: {
      bump: (facts: any) => {
        facts.n += 1;
      },
      // n, n, label, n: three runs, so three messages.
      burst: (facts: any) => {
        facts.n = 10;
        facts.n = 11;
        facts.label = "mid";
        facts.n = 12;
      },
    },
    constraints: {
      needsLoad: {
        when: (facts: any) => facts.label === "load",
        require: { type: "LOAD" },
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        resolve: async (_req: unknown, context: any) => {
          context.facts.label = "loaded";
        },
      },
    },
  } as never);
}

describe("L13c /worker: the worker side", () => {
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
    getWorkerModuleRegistry().clear();
    vi.unstubAllGlobals();
  });

  const send = async (message: unknown) => {
    await onmessage?.({ data: message });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const init = () =>
    send({ type: "INIT", config: { moduleNames: ["counter"] } });
  const types = () => posted.map((m) => m.type);
  const facts = () =>
    posted
      .filter((m) => m.type === "FACT_CHANGED")
      .map((m) => [m.key, m.value, m.prev]);

  it("W1: the registry is one map, filled by registerWorkerModule", () => {
    const registry = getWorkerModuleRegistry();
    const other = { id: "other" };
    registerWorkerModule("other", other);

    expect(getWorkerModuleRegistry()).toBe(registry);
    expect(registry.get("other")).toBe(other);
    expect([...registry.keys()]).toEqual(["counter", "other"]);
  });

  it("W2: INIT posts READY and nothing else; START posts the init write before STARTED", async () => {
    await init();
    expect(types()).toEqual(["READY"]);

    posted.length = 0;
    await send({ type: "START" });
    expect(types().at(-1)).toBe("STARTED");
    expect(facts()).toEqual([
      ["counter::n", 1, undefined],
      ["counter::label", "start", undefined],
    ]);
  });

  it("W2: an unregistered module posts ERROR from INIT and leaves no system", async () => {
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

  it("W3: a message before INIT or after DESTROY gets no reply ((cc) declined)", async () => {
    const all = [
      { type: "START" },
      { type: "SET_FACT", key: "counter::n", value: 3 },
      { type: "SET_FACTS", facts: { "counter::n": 3 } },
      { type: "DISPATCH", event: { type: "bump" } },
      { type: "INSPECT", requestId: "i-1" },
      { type: "GET_SNAPSHOT", requestId: "s-1" },
      { type: "SETTLE", requestId: "t-1" },
      { type: "STOP" },
      { type: "DESTROY" },
    ];
    for (const message of all) {
      await send(message);
    }
    expect(posted).toEqual([]);

    await init();
    await send({ type: "START" });
    await send({ type: "DESTROY" });
    expect(types().at(-1)).toBe("DESTROYED");
    posted.length = 0;
    for (const message of all) {
      await send(message);
    }
    expect(posted).toEqual([]);
  });

  it("W4: SET_FACT writes through the owning module; a bad key posts ERROR", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "SET_FACT", key: "counter::n", value: 5 });
    expect(facts()).toEqual([["counter::n", 5, 1]]);

    posted.length = 0;
    await send({ type: "SET_FACT", key: "counter::n", value: 5 });
    expect(posted).toEqual([]);

    await send({ type: "SET_FACT", key: "n", value: 9 });
    await send({ type: "SET_FACT", key: "ghost::n", value: 9 });
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
          '[Directive] worker: no module named "ghost" in this system, so "ghost::n" was not written.',
        source: "SET_FACT",
      },
    ]);
  });

  it("W4: SET_FACTS writes in one batch, one message per key", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({
      type: "SET_FACTS",
      facts: { "counter::n": 7, "counter::label": "seven" },
    });
    expect(facts()).toEqual([
      ["counter::n", 7, 1],
      ["counter::label", "seven", "start"],
    ]);
  });

  it("W5: a batched write folds each run of one key into one message, first prev and last value", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "DISPATCH", event: { type: "counter::burst" } });
    expect(facts()).toEqual([
      ["counter::n", 11, 1],
      ["counter::label", "mid", "start"],
      ["counter::n", 12, 11],
    ]);
  });

  it("W5: the fact is posted before the value derived from it", async () => {
    await init();
    await send({ type: "START" });
    await send({ type: "GET_SNAPSHOT", requestId: "s-0" });
    posted.length = 0;

    await send({ type: "DISPATCH", event: { type: "counter::bump" } });
    await send({ type: "GET_SNAPSHOT", requestId: "s-1" });

    const fact = posted.findIndex((m) => m.type === "FACT_CHANGED");
    const derived = posted.findIndex((m) => m.type === "DERIVATION_CHANGED");
    expect(posted[fact]).toEqual({
      type: "FACT_CHANGED",
      key: "counter::n",
      value: 2,
      prev: 1,
    });
    expect(posted[derived]).toMatchObject({
      type: "DERIVATION_CHANGED",
      value: 4,
    });
    expect(fact).toBeGreaterThanOrEqual(0);
    expect(derived).toBeGreaterThan(fact);
    expect(types().at(-1)).toBe("SNAPSHOT_RESULT");
  });

  it("W5: a requirement is mirrored when created and when met", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "SET_FACT", key: "counter::label", value: "load" });
    await send({ type: "SETTLE", requestId: "settle-1" });

    const created = posted.find((m) => m.type === "REQUIREMENT_CREATED") as
      | Extract<WorkerOutboundMessage, { type: "REQUIREMENT_CREATED" }>
      | undefined;
    const met = posted.find((m) => m.type === "REQUIREMENT_MET") as
      | Extract<WorkerOutboundMessage, { type: "REQUIREMENT_MET" }>
      | undefined;
    expect(created?.requirement.type).toBe("LOAD");
    expect(typeof created?.requirement.id).toBe("string");
    expect(met?.requirementId).toBe(created?.requirement.id);
    expect(typeof met?.resolverId).toBe("string");
    expect(posted.at(-1)).toEqual({
      type: "SETTLE_RESULT",
      requestId: "settle-1",
      success: true,
    });
  });

  it("W6: GET_SNAPSHOT and INSPECT answer with their request id", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "GET_SNAPSHOT", requestId: "snapshot-1" });
    await send({ type: "INSPECT", requestId: "inspect-2" });

    const snapshot = posted.find((m) => m.type === "SNAPSHOT_RESULT");
    const inspection = posted.find((m) => m.type === "INSPECT_RESULT");
    expect(snapshot?.requestId).toBe("snapshot-1");
    expect(snapshot?.snapshot).toMatchObject({ data: expect.any(Object) });
    expect(inspection?.requestId).toBe("inspect-2");
    expect(inspection?.inspection).toMatchObject({
      unmet: [],
      inflight: [],
    });
  });

  it("W6: STOP posts STOPPED", async () => {
    await init();
    await send({ type: "START" });
    posted.length = 0;

    await send({ type: "STOP" });
    expect(types()).toEqual(["STOPPED"]);
  });
});

describe("L13c /worker: createWorkerClient (W7)", () => {
  function makeWorker() {
    const sent: Posted[] = [];
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
      postMessage: (message: Posted) => {
        sent.push(message);
      },
      terminate: vi.fn(),
    };
    const reply = (message: WorkerOutboundMessage) =>
      worker.onmessage?.({ data: message });

    return { worker, sent, reply };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends each call as its message, and the lifecycle promises resolve on the reply", async () => {
    const { worker, sent, reply } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const ready = client.init({ moduleNames: ["counter"] });
    reply({ type: "READY" });
    await ready;
    const started = client.start();
    reply({ type: "STARTED" });
    await started;
    client.setFact("counter::n", 2);
    client.setFacts({ "counter::n": 3 });
    client.dispatch({ type: "bump" });
    const stopped = client.stop();
    reply({ type: "STOPPED" });
    await stopped;
    const destroyed = client.destroy();
    reply({ type: "DESTROYED" });
    await destroyed;
    client.terminate();

    expect(sent).toEqual([
      { type: "INIT", config: { moduleNames: ["counter"] } },
      { type: "START" },
      { type: "SET_FACT", key: "counter::n", value: 2 },
      { type: "SET_FACTS", facts: { "counter::n": 3 } },
      { type: "DISPATCH", event: { type: "bump" } },
      { type: "STOP" },
      { type: "DESTROY" },
    ]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("numbers request ids across kinds and resolves each by its id", async () => {
    const { worker, sent, reply } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const snapshot = client.getSnapshot({ includeFacts: ["n"] } as never);
    const inspection = client.inspect();
    const settled = client.settle(50);
    expect(sent).toEqual([
      {
        type: "GET_SNAPSHOT",
        options: { includeFacts: ["n"] },
        requestId: "snapshot-1",
      },
      { type: "INSPECT", requestId: "inspect-2" },
      { type: "SETTLE", timeout: 50, requestId: "settle-3" },
    ]);

    reply({ type: "SETTLE_RESULT", requestId: "settle-3", success: true });
    reply({
      type: "INSPECT_RESULT",
      requestId: "inspect-2",
      inspection: { unmet: [] } as never,
    });
    reply({
      type: "SNAPSHOT_RESULT",
      requestId: "snapshot-1",
      snapshot: { data: { n: 1 } } as never,
    });
    await expect(settled).resolves.toBeUndefined();
    await expect(inspection).resolves.toEqual({ unmet: [] });
    await expect(snapshot).resolves.toEqual({ data: { n: 1 } });
  });

  it("a failed settle rejects with the worker's message, or 'Settle failed'", async () => {
    const { worker, reply } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const first = client.settle();
    reply({
      type: "SETTLE_RESULT",
      requestId: "settle-1",
      success: false,
      error: "took too long",
    });
    await expect(first).rejects.toThrow("took too long");

    const second = client.settle();
    reply({ type: "SETTLE_RESULT", requestId: "settle-2", success: false });
    await expect(second).rejects.toThrow("Settle failed");
  });

  it("a request times out after 30 s by default, and after timeoutMs when given", async () => {
    vi.useFakeTimers();
    const { worker } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const slow = client.inspect();
    const slowResult = expect(slow).rejects.toThrow(
      "[Directive] worker request timed out after 30000ms",
    );
    const quick = client.getSnapshot(undefined, 100);
    const quickResult = expect(quick).rejects.toThrow(
      "[Directive] worker request timed out after 100ms",
    );
    await vi.advanceTimersByTimeAsync(100);
    await quickResult;
    await vi.advanceTimersByTimeAsync(29_900);
    await slowResult;
  });

  it("a timeout of 0 or Infinity arms no timer", async () => {
    vi.useFakeTimers();
    const { worker, reply } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const never = client.inspect(0);
    const forever = client.inspect(Number.POSITIVE_INFINITY);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    reply({
      type: "INSPECT_RESULT",
      requestId: "inspect-1",
      inspection: { unmet: [] } as never,
    });
    reply({
      type: "INSPECT_RESULT",
      requestId: "inspect-2",
      inspection: { unmet: [] } as never,
    });
    await expect(never).resolves.toEqual({ unmet: [] });
    await expect(forever).resolves.toEqual({ unmet: [] });
  });

  it("an answered request clears its timer", async () => {
    vi.useFakeTimers();
    const { worker, reply } = makeWorker();
    const client = createWorkerClient({ worker: worker as never });

    const inspection = client.inspect();
    expect(vi.getTimerCount()).toBe(1);
    reply({
      type: "INSPECT_RESULT",
      requestId: "inspect-1",
      inspection: { unmet: [] } as never,
    });
    await inspection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a worker error rejects every pending request and reaches onError", async () => {
    vi.useFakeTimers();
    const { worker } = makeWorker();
    const onError = vi.fn();
    const client = createWorkerClient({ worker: worker as never, onError });

    const a = client.inspect();
    const b = client.getSnapshot();
    const aResult = expect(a).rejects.toThrow(
      "[Directive] worker errored: boom",
    );
    const bResult = expect(b).rejects.toThrow(
      "[Directive] worker errored: boom",
    );
    worker.onerror?.({ message: "boom" });
    await aResult;
    await bResult;
    expect(vi.getTimerCount()).toBe(0);
    expect(onError).toHaveBeenCalledWith("boom", "worker");

    worker.onerror?.(undefined);
    expect(onError).toHaveBeenLastCalledWith("unknown error", "worker");
  });

  it("mirror messages reach their callbacks", () => {
    const { worker, reply } = makeWorker();
    const onFactChange = vi.fn();
    const onDerivationChange = vi.fn();
    const onRequirementCreated = vi.fn();
    const onRequirementMet = vi.fn();
    const onError = vi.fn();
    createWorkerClient({
      worker: worker as never,
      onFactChange,
      onDerivationChange,
      onRequirementCreated,
      onRequirementMet,
      onError,
    });

    reply({ type: "FACT_CHANGED", key: "counter::n", value: 2, prev: 1 });
    reply({ type: "DERIVATION_CHANGED", key: "counter::double", value: 4 });
    reply({
      type: "REQUIREMENT_CREATED",
      requirement: { type: "LOAD", id: "r1" },
    });
    reply({ type: "REQUIREMENT_MET", requirementId: "r1", resolverId: "load" });
    reply({ type: "ERROR", error: "bad key", source: "SET_FACT" });

    expect(onFactChange).toHaveBeenCalledWith("counter::n", 2, 1);
    expect(onDerivationChange).toHaveBeenCalledWith("counter::double", 4);
    expect(onRequirementCreated).toHaveBeenCalledWith({
      type: "LOAD",
      id: "r1",
    });
    expect(onRequirementMet).toHaveBeenCalledWith("r1", "load");
    expect(onError).toHaveBeenCalledWith("bad key", "SET_FACT");
  });
});
