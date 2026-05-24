import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { createAuditLedger, memorySink, type AuditEntry } from "../audit-ledger.js";

// happy-dom or node fine; we use node.
const flushTick = () => new Promise<void>((r) => setTimeout(r, 0));

// ============================================================================
// Test module
// ============================================================================

function makeModule() {
  return createModule("checkout", {
    schema: {
      facts: {
        cartTotal: t.number(),
        region: t.string(),
        active: t.boolean(),
      },
      derivations: {},
      events: {},
      requirements: { CHECKOUT: {} },
    },
    init: (facts) => {
      facts.cartTotal = 0;
      facts.region = "US";
      facts.active = false;
    },
    constraints: {
      canCheckout: {
        when: { cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } },
        require: { type: "CHECKOUT" },
      },
    },
  });
}

// ============================================================================
// Capture
// ============================================================================

describe("createAuditLedger — captures observation events", () => {
  let ledger: ReturnType<typeof createAuditLedger>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let system: any;

  beforeEach(() => {
    ledger = createAuditLedger();
    system = createSystem({ module: makeModule(), plugins: [ledger.plugin] });
  });

  afterEach(() => {
    system.destroy();
    ledger.destroy();
  });

  it("captures system.init / system.start", () => {
    system.start();
    const entries = ledger.query();
    expect(entries.some((e) => e.kind === "system.init")).toBe(true);
    expect(entries.some((e) => e.kind === "system.start")).toBe(true);
  });

  it("captures constraint.evaluate with whenSpec + whenExplain", async () => {
    system.start();
    await flushTick();

    const evals = ledger.query({ kind: "constraint.evaluate" });
    expect(evals.length).toBeGreaterThan(0);
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;
    expect(e.constraintId).toBe("canCheckout");
    expect(e.whenSpec).toBeDefined();
    expect(e.whenExplain).toBeDefined();
    expect(e.whenExplain!.length).toBeGreaterThan(0);
  });

  it("captures fact.change with prior + next", async () => {
    system.start();
    await flushTick();
    system.facts.cartTotal = 75;
    await flushTick();

    const changes = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
    });
    expect(changes.length).toBeGreaterThan(0);
    const c = changes[0] as Extract<AuditEntry, { kind: "fact.change" }>;
    expect(c.key).toBe("cartTotal");
    expect(c.next).toBe(75);
  });
});

// ============================================================================
// Query API + shortcuts
// ============================================================================

describe("createAuditLedger — query API", () => {
  it("filters by kind", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    const evals = ledger.query({ kind: "constraint.evaluate" });
    for (const e of evals) {
      expect(e.kind).toBe("constraint.evaluate");
    }

    system.destroy();
  });

  it("recent(n) returns the last N entries", () => {
    const sink = memorySink();
    for (let i = 0; i < 20; i++) {
      sink.write({
        seq: i,
        ts: i,
        kind: "fact.change",
        key: "x",
        prior: i - 1,
        next: i,
        prevHash: null,
      } as AuditEntry);
    }
    const last5 = sink.recent(5);
    expect(last5).toHaveLength(5);
    expect((last5[0] as Extract<AuditEntry, { kind: "fact.change" }>).next).toBe(
      15,
    );
  });

  it("forFact / forConstraint shortcuts work", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.cartTotal = 100;
    await flushTick();

    const cartFacts = ledger.forFact("cartTotal");
    expect(cartFacts.length).toBeGreaterThan(0);

    const canCheckoutEvals = ledger.forConstraint("canCheckout");
    expect(canCheckoutEvals.length).toBeGreaterThan(0);

    system.destroy();
  });

  it("changedBetween filter parses ISO strings strictly (SEC M2)", () => {
    const sink = memorySink();
    for (let i = 0; i < 5; i++) {
      sink.write({
        seq: i,
        ts: 1700000000000 + i * 1000,
        kind: "fact.change",
        key: "x",
        prior: null,
        next: i,
        prevHash: null,
      } as AuditEntry);
    }
    const inRange = sink.query({
      changedBetween: [1700000000500, 1700000002500],
    });
    expect(inRange.length).toBeGreaterThan(0);

    expect(() =>
      sink.query({ changedBetween: ["not a date", 0] }),
    ).toThrow(/parseable ISO/);
  });

  it("query factPath is exact-match only — no LIKE wildcards", () => {
    const sink = memorySink();
    sink.write({
      seq: 0,
      ts: 0,
      kind: "fact.change",
      key: "user.email",
      prior: null,
      next: "a@b.com",
      prevHash: null,
    } as AuditEntry);

    // Wildcard "%" should NOT match anything.
    const wildcard = sink.query({ factPath: "%" });
    expect(wildcard).toHaveLength(0);

    const exact = sink.query({ factPath: "user.email" });
    expect(exact).toHaveLength(1);
  });
});

// ============================================================================
// Capacity-bound ring buffer (SEC C3 for memory; SQLite is a separate sink)
// ============================================================================

describe("memorySink — bounded capacity", () => {
  it("drops oldest entries past capacity", () => {
    const sink = memorySink({ capacity: 3 });
    for (let i = 0; i < 10; i++) {
      sink.write({
        seq: i,
        ts: i,
        kind: "fact.change",
        key: "x",
        prior: i - 1,
        next: i,
        prevHash: null,
      } as AuditEntry);
    }
    const all = sink.toJSON().entries;
    expect(all).toHaveLength(3);
    expect((all[0] as Extract<AuditEntry, { kind: "fact.change" }>).next).toBe(
      7,
    );
    expect((all[2] as Extract<AuditEntry, { kind: "fact.change" }>).next).toBe(
      9,
    );
  });
});

// ============================================================================
// Hash chain — verify() detects tampering
// ============================================================================

describe("createAuditLedger — hash chain integrity", () => {
  it("verify() returns valid: true on a clean chain (sync)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.cartTotal = 75;
    await flushTick();

    const result = ledger.verify() as Extract<
      ReturnType<typeof ledger.verify>,
      { valid: boolean }
    >;
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.entryCount).toBeGreaterThan(0);
    }

    system.destroy();
  });

  it("verify() catches a tampered entry (SEC C1: stableStringify canonicalization)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.cartTotal = 50;
    await flushTick();

    const before = ledger.verify() as Extract<
      ReturnType<typeof ledger.verify>,
      { valid: boolean }
    >;
    expect(before.valid).toBe(true);

    const dump = ledger.toJSON();
    const entries = dump.entries;
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Tamper: re-write entry[1] in-place with a different payload.
    // Since entry[2]'s prevHash was computed from the ORIGINAL entry[1],
    // the chain breaks at index 2 (entry[2].prevHash !== hash(tampered entry[1])).
    (entries[1] as { kind: string }).kind = "fact.change";

    const after = ledger.verify() as Extract<
      ReturnType<typeof ledger.verify>,
      { valid: boolean }
    >;
    expect(after.valid).toBe(false);
    if (!after.valid) {
      expect(after.brokenAt).toBeGreaterThanOrEqual(0);
      expect(after.expectedHash).toBeDefined();
      expect(after.actualHash).toBeDefined();
    }

    system.destroy();
  });

  it("verify({ strong: true }) returns a Promise", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    const strongResult = (await ledger.verify({ strong: true })) as Extract<
      Awaited<ReturnType<typeof ledger.verify>>,
      { valid: boolean }
    >;
    expect(strongResult.valid).toBe(true);

    system.destroy();
  });

  it("genesis entry has prevHash: null", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    const entries = ledger.toJSON().entries;
    expect(entries[0]?.prevHash).toBeNull();
    expect(entries[1]?.prevHash).not.toBeNull();

    system.destroy();
  });
});

// ============================================================================
// Plugin lifecycle
// ============================================================================

describe("createAuditLedger — plugin lifecycle", () => {
  it("destroy() unsubscribes from observation events", async () => {
    // Use a separate sink we own so we can inspect it after destroy.
    const sink = memorySink();
    const ledger = createAuditLedger({ sink });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    const before = sink.toJSON().entries.length;
    expect(before).toBeGreaterThan(0);

    // Destroy the SUBSCRIPTION but keep the sink alive (using detach
    // pattern). For the public API, destroy() empties + detaches. To
    // test the unsubscribe, we just check fact mutations after destroy
    // don't grow the (now-detached) sink.
    ledger.destroy();
    const afterDestroy = sink.toJSON().entries.length;
    // destroy() empties the sink as part of cleanup.
    expect(afterDestroy).toBe(0);

    // New mutations after destroy must NOT land in the sink (it's
    // detached + emptied; new entries would re-grow it if subscription
    // was still active).
    system.facts.cartTotal = 999;
    await flushTick();
    expect(sink.toJSON().entries.length).toBe(0);

    system.destroy();
  });

  it("clear() empties the ledger and resets seq", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    expect(ledger.query().length).toBeGreaterThan(0);

    ledger.clear();
    expect(ledger.query()).toHaveLength(0);

    system.destroy();
  });
});

// ============================================================================
// PII redaction (SEC M1)
// ============================================================================

describe("createAuditLedger — PII redaction", () => {
  function piiModule() {
    return createModule("pii", {
      schema: {
        facts: {
          email: t.string().meta({ tags: ["pii"] }),
          public: t.string(),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.email = "alice@example.com";
        facts.public = "public-value";
      },
    });
  }

  it("redacts pii-tagged fact values by default", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: piiModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.email = "bob@example.com";
    system.facts.public = "another-value";
    await flushTick();

    const emailEntries = ledger.forFact("email");
    expect(emailEntries.length).toBeGreaterThan(0);
    for (const e of emailEntries) {
      if (e.kind === "fact.change") {
        expect(e.next).toBe("[redacted]");
        expect(e.prior).toBe("[redacted]");
      }
    }

    // Non-PII facts NOT redacted
    const publicEntries = ledger.forFact("public");
    const p = publicEntries.find((e) => e.kind === "fact.change") as
      | Extract<AuditEntry, { kind: "fact.change" }>
      | undefined;
    expect(p?.next).toBe("another-value");

    system.destroy();
  });

  it("capturePII: true opts out of redaction", async () => {
    const ledger = createAuditLedger({ capturePII: true });
    const system = createSystem({
      module: piiModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.email = "carol@example.com";
    await flushTick();

    const emailEntries = ledger.forFact("email");
    const e = emailEntries.find((x) => x.kind === "fact.change") as
      | Extract<AuditEntry, { kind: "fact.change" }>
      | undefined;
    expect(e?.next).toBe("carol@example.com");

    system.destroy();
  });
});
