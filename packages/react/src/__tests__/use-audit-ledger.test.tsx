// @vitest-environment happy-dom
import {
  createAuditLedger,
  createModule,
  createSystem,
  memorySink,
  t,
} from "@directive-run/core";
import { act, renderHook } from "@testing-library/react";
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

describe("useAuditLedger (react)", () => {
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

  it("returns current matching entries synchronously on first render", async () => {
    ctx.system.facts.n = 1;
    ctx.system.facts.n = 2;
    await flushTick();

    const { result } = renderHook(() =>
      useAuditLedger(ctx.ledger, { kind: "fact.change" }),
    );

    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.every((e) => e.kind === "fact.change")).toBe(true);
  });

  it("re-emits after new ledger entries land", async () => {
    const { result } = renderHook(() =>
      useAuditLedger(ctx.ledger, { kind: "fact.change" }, { pollMs: 50 }),
    );

    const startLen = result.current.length;

    await act(async () => {
      ctx.system.facts.n = 42;
      await new Promise((r) => setTimeout(r, 80));
    });

    expect(result.current.length).toBeGreaterThan(startLen);
  });

  it("respects filter — unrelated kinds are excluded", async () => {
    ctx.system.facts.n = 5;
    await flushTick();

    const { result } = renderHook(() =>
      useAuditLedger(ctx.ledger, { kind: "constraint.evaluate" }),
    );

    expect(result.current.every((e) => e.kind === "constraint.evaluate")).toBe(
      true,
    );
    const factChanges = ctx.ledger.query({ kind: "fact.change" });
    expect(factChanges.length).toBeGreaterThan(0);
  });

  it("clamps pollMs below 50 ms and warns in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useAuditLedger(ctx.ledger, {}, { pollMs: 10 }));

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("below the 50 ms floor"),
      ),
    ).toBe(true);
  });

  it("warns once when ledger has >1000 entries at low pollMs", () => {
    // Build a large ledger via a high-capacity sink and many writes.
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
    renderHook(() => useAuditLedger(big, {}, { pollMs: 60 }));

    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("a lot of CPU per tick"),
      ),
    ).toBe(true);

    sys.destroy();
    big.destroy();
  });

  it("stops polling after unmount", async () => {
    vi.useFakeTimers();
    const querySpy = vi.spyOn(ctx.ledger, "query");

    const { unmount } = renderHook(() =>
      useAuditLedger(ctx.ledger, {}, { pollMs: 100 }),
    );

    // Initial render queried once.
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    const afterTicks = querySpy.mock.calls.length;
    expect(afterTicks).toBeGreaterThan(1);

    unmount();
    querySpy.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(querySpy).not.toHaveBeenCalled();
  });
});
