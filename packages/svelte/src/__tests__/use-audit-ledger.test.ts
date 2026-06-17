import {
  createAuditLedger,
  createModule,
  createSystem,
  memorySink,
  t,
} from "@directive-run/core";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mock Svelte runtime (mirrors stores.test.ts)
// ============================================================================

const destroyCallbacks: Array<() => void> = [];

vi.mock("svelte", () => ({
  onDestroy: (fn: () => void) => {
    destroyCallbacks.push(fn);
  },
}));

vi.mock("svelte/store", () => {
  type Subscriber<T> = (value: T) => void;
  type Unsubscriber = () => void;
  type StartStopNotifier<T> = (set: Subscriber<T>) => Unsubscriber | undefined;

  interface Readable<T> {
    subscribe(run: Subscriber<T>): Unsubscriber;
  }

  function readable<T>(
    initialValue: T,
    start?: StartStopNotifier<T>,
  ): Readable<T> {
    let value = initialValue;
    const subscribers = new Set<Subscriber<T>>();
    let stop: Unsubscriber | undefined;

    return {
      subscribe(run: Subscriber<T>): Unsubscriber {
        subscribers.add(run);
        if (subscribers.size === 1 && start) {
          stop = start((newValue: T) => {
            value = newValue;
            for (const sub of subscribers) {
              sub(value);
            }
          });
        }
        run(value);

        return () => {
          subscribers.delete(run);
          if (subscribers.size === 0 && stop) {
            stop();
            stop = undefined;
          }
        };
      },
    };
  }

  return { readable };
});

// Import AFTER mocks are defined
import { createAuditLedgerStore, useAuditLedger } from "../index";

// ============================================================================
// Test harness
// ============================================================================

function createLedgerSystem() {
  const ledger = createAuditLedger();
  const mod = createModule("audit-host", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts) => {
      facts.n = 0;
    },
  });
  const system = createSystem({ module: mod, plugins: [ledger.plugin] });
  system.start();

  return { ledger, system };
}

const flushTick = () => new Promise<void>((r) => setTimeout(r, 0));

function subscribeToStore<T>(store: {
  subscribe: (fn: (v: T) => void) => () => void;
}) {
  let value: T;
  const unsubscribe = store.subscribe((v) => {
    value = v;
  });

  return {
    getValue: () => value!,
    unsubscribe,
  };
}

// ============================================================================
// createAuditLedgerStore
// ============================================================================

describe("createAuditLedgerStore (svelte)", () => {
  let ctx: ReturnType<typeof createLedgerSystem>;

  beforeEach(() => {
    ctx = createLedgerSystem();
  });

  afterEach(() => {
    ctx.system.destroy();
    ctx.ledger.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
    destroyCallbacks.length = 0;
  });

  it("delivers current matching entries synchronously on first subscribe", async () => {
    ctx.system.facts.n = 1;
    ctx.system.facts.n = 2;
    await flushTick();

    const store = createAuditLedgerStore(ctx.ledger, { kind: "fact.change" });
    const { getValue, unsubscribe } =
      subscribeToStore<readonly unknown[]>(store);

    expect(getValue().length).toBeGreaterThan(0);
    expect(
      getValue().every((e) => (e as { kind: string }).kind === "fact.change"),
    ).toBe(true);
    unsubscribe();
  });

  it("re-emits after new ledger entries land", async () => {
    const store = createAuditLedgerStore(
      ctx.ledger,
      { kind: "fact.change" },
      { pollMs: 50 },
    );
    const { getValue, unsubscribe } =
      subscribeToStore<readonly unknown[]>(store);

    const startLen = getValue().length;

    ctx.system.facts.n = 9;
    await new Promise((r) => setTimeout(r, 90));

    expect(getValue().length).toBeGreaterThan(startLen);
    unsubscribe();
  });

  it("respects filter — unrelated kinds are excluded", async () => {
    ctx.system.facts.n = 5;
    await flushTick();

    const store = createAuditLedgerStore(ctx.ledger, {
      kind: "constraint.evaluate",
    });
    const { getValue, unsubscribe } =
      subscribeToStore<readonly unknown[]>(store);

    expect(
      getValue().every(
        (e) => (e as { kind: string }).kind === "constraint.evaluate",
      ),
    ).toBe(true);
    const factChanges = ctx.ledger.query({ kind: "fact.change" });
    expect(factChanges.length).toBeGreaterThan(0);
    unsubscribe();
  });

  it("clamps pollMs below 50 ms and warns in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = createAuditLedgerStore(ctx.ledger, {}, { pollMs: 10 });
    const { unsubscribe } = subscribeToStore<readonly unknown[]>(store);

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("below the 50 ms floor"),
      ),
    ).toBe(true);
    unsubscribe();
  });

  it("warns when ledger has >1000 entries at low pollMs", () => {
    const big = createAuditLedger({ sink: memorySink({ capacity: 20_000 }) });
    const mod = createModule("big-host", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.n = 0;
      },
    });
    const sys = createSystem({ module: mod, plugins: [big.plugin] });
    sys.start();
    for (let i = 0; i < 1100; i++) sys.facts.n = i;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createAuditLedgerStore(big, {}, { pollMs: 60 });
    const { unsubscribe } = subscribeToStore<readonly unknown[]>(store);

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("a lot of CPU per tick"),
      ),
    ).toBe(true);

    unsubscribe();
    sys.destroy();
    big.destroy();
  });

  it("stops polling after the last subscriber unsubscribes", async () => {
    vi.useFakeTimers();
    const querySpy = vi.spyOn(ctx.ledger, "query");

    const store = createAuditLedgerStore(ctx.ledger, {}, { pollMs: 100 });
    const { unsubscribe } = subscribeToStore<readonly unknown[]>(store);

    vi.advanceTimersByTime(300);
    const beforeUnsub = querySpy.mock.calls.length;
    expect(beforeUnsub).toBeGreaterThan(1);

    unsubscribe();
    querySpy.mockClear();

    vi.advanceTimersByTime(1000);
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("exposes useAuditLedger alias", () => {
    expect(useAuditLedger).toBe(createAuditLedgerStore);
  });
});
