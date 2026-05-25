import {
  createAuditLedger,
  createModule,
  createSystem,
  memorySink,
  t,
} from "@directive-run/core";
import { type Accessor, createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuditLedger } from "../index";

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

// ============================================================================
// useAuditLedger
// ============================================================================

describe("useAuditLedger (solid)", () => {
  let ctx: ReturnType<typeof createLedgerSystem>;

  beforeEach(() => {
    ctx = createLedgerSystem();
  });

  afterEach(() => {
    ctx.system.destroy();
    ctx.ledger.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns current matching entries synchronously on creation", async () => {
    ctx.system.facts.n = 1;
    ctx.system.facts.n = 2;
    await flushTick();

    let dispose!: () => void;
    let entries!: Accessor<readonly unknown[]>;

    createRoot((_dispose) => {
      dispose = _dispose;
      entries = useAuditLedger(ctx.ledger, { kind: "fact.change" });
    });

    expect(entries().length).toBeGreaterThan(0);
    expect(
      entries().every((e) => (e as { kind: string }).kind === "fact.change"),
    ).toBe(true);

    dispose();
  });

  it("re-emits after new ledger entries land", async () => {
    let dispose!: () => void;
    let entries!: Accessor<readonly unknown[]>;

    createRoot((_dispose) => {
      dispose = _dispose;
      entries = useAuditLedger(
        ctx.ledger,
        { kind: "fact.change" },
        { pollMs: 50 },
      );
    });

    const startLen = entries().length;

    ctx.system.facts.n = 11;
    await new Promise((r) => setTimeout(r, 90));

    expect(entries().length).toBeGreaterThan(startLen);
    dispose();
  });

  it("respects filter — unrelated kinds are excluded", async () => {
    ctx.system.facts.n = 5;
    await flushTick();

    let dispose!: () => void;
    let entries!: Accessor<readonly unknown[]>;

    createRoot((_dispose) => {
      dispose = _dispose;
      entries = useAuditLedger(ctx.ledger, { kind: "constraint.evaluate" });
    });

    expect(
      entries().every(
        (e) => (e as { kind: string }).kind === "constraint.evaluate",
      ),
    ).toBe(true);
    const factChanges = ctx.ledger.query({ kind: "fact.change" });
    expect(factChanges.length).toBeGreaterThan(0);
    dispose();
  });

  it("clamps pollMs below 50 ms and warns in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    let dispose!: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useAuditLedger(ctx.ledger, {}, { pollMs: 10 });
    });

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("below the 50 ms floor"),
      ),
    ).toBe(true);
    dispose();
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

    let dispose!: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useAuditLedger(big, {}, { pollMs: 60 });
    });

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("a lot of CPU per tick"),
      ),
    ).toBe(true);

    dispose();
    sys.destroy();
    big.destroy();
  });

  it("stops polling after the reactive root disposes", async () => {
    vi.useFakeTimers();
    const querySpy = vi.spyOn(ctx.ledger, "query");

    let dispose!: () => void;
    createRoot((_dispose) => {
      dispose = _dispose;
      useAuditLedger(ctx.ledger, {}, { pollMs: 100 });
    });

    vi.advanceTimersByTime(300);
    const beforeDispose = querySpy.mock.calls.length;
    expect(beforeDispose).toBeGreaterThan(1);

    dispose();
    querySpy.mockClear();

    vi.advanceTimersByTime(1000);
    expect(querySpy).not.toHaveBeenCalled();
  });
});
