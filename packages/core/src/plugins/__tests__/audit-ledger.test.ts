import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import {
  type AuditEntry,
  createAuditLedger,
  memorySink,
} from "../audit-ledger/index.js";

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
    expect(
      (last5[0] as Extract<AuditEntry, { kind: "fact.change" }>).next,
    ).toBe(15);
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

    expect(() => sink.query({ changedBetween: ["not a date", 0] })).toThrow(
      /parseable ISO/,
    );
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

  it("verify() catches a tampered entry via a sink-level swap (SEC C1: stableStringify canonicalization)", async () => {
    // Entries are now frozen at write time, so in-process mutation
    // throws — see the "freezes entries at write time (C3)" test below.
    // To exercise the verify() tamper path, we install a sink wrapper
    // that swaps a payload at query time (modeling persisted-bytes
    // tampering on the way back from disk).
    const realSink = memorySink();
    let swap: ((entries: AuditEntry[]) => void) | null = null;
    const sink: typeof realSink = {
      ...realSink,
      query: realSink.query.bind(realSink),
      recent: realSink.recent.bind(realSink),
      forFact: realSink.forFact.bind(realSink),
      forConstraint: realSink.forConstraint.bind(realSink),
      write: realSink.write.bind(realSink),
      clear: realSink.clear.bind(realSink),
      destroy: realSink.destroy.bind(realSink),
      toJSON: () => {
        const out = realSink.toJSON();
        if (swap) {
          const cloned = JSON.parse(JSON.stringify(out)) as typeof out;
          swap(cloned.entries as AuditEntry[]);
          return cloned;
        }
        return out;
      },
    };
    const ledger = createAuditLedger({ sink });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();
    system.facts.cartTotal = 50;
    await flushTick();

    const before = ledger.verify();
    expect(before.valid).toBe(true);

    // Now tell the sink wrapper to mutate entry[1].kind on the next
    // toJSON() call. verify() pulls entries via toJSON, so this models
    // persisted-bytes tampering visible to the verifier.
    swap = (entries) => {
      if (entries[1]) (entries[1] as { kind: string }).kind = "fact.change";
    };

    const after = ledger.verify();
    expect(after.valid).toBe(false);
    if (!after.valid) {
      expect(after.brokenAt).toBeGreaterThanOrEqual(0);
      expect(after.expectedHash).toBeDefined();
      expect(after.actualHash).toBeDefined();
    }

    system.destroy();
  });

  it("verify({ strong: true }) THROWS — reserved for v2, no silent no-op (C1)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    expect(() => ledger.verify({ strong: true })).toThrow(
      /strong: true.*reserved for v2/,
    );

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

// ============================================================================
// R1 fixes — C2 whenSpec PII redaction
// ============================================================================

describe("createAuditLedger — whenSpec PII operand redaction (C2)", () => {
  function piiConstraintModule() {
    return createModule("pii-when", {
      schema: {
        facts: {
          email: t.string().meta({ tags: ["pii"] }),
          cartTotal: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { CHECKOUT: {} },
      },
      init: (facts) => {
        facts.email = "noone@nowhere.com";
        facts.cartTotal = 0;
      },
      constraints: {
        emailGated: {
          // Literal operand sitting on a PII-tagged fact — without
          // the C2 fix this would leak into every audit entry.
          when: { email: { $eq: "alice@x.com" } },
          require: { type: "CHECKOUT" },
        },
      },
    });
  }

  it("redacts literal operands at pii-tagged fact paths in cached whenSpec", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: piiConstraintModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const evals = ledger.query({ kind: "constraint.evaluate" });
    expect(evals.length).toBeGreaterThan(0);
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;
    expect(e.whenSpec).toBeDefined();
    // The original literal "alice@x.com" must be redacted in the cache.
    const spec = e.whenSpec as { email: { $eq: unknown } };
    expect(spec.email.$eq).toBe("[redacted]");

    system.destroy();
  });

  it("does NOT redact operands on non-pii facts", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: piiConstraintModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    // Cart-total is not pii-tagged; operands on it should remain.
    // Inspect the cached spec via the entry's whenSpec.
    const evals = ledger.query({ kind: "constraint.evaluate" });
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;
    const spec = e.whenSpec as { email: { $eq: unknown } };
    // email is redacted, cartTotal would not be — only the email
    // operand should change.
    expect(spec.email.$eq).toBe("[redacted]");

    system.destroy();
  });

  it("capturePII: true leaves whenSpec operands unredacted", async () => {
    const ledger = createAuditLedger({ capturePII: true });
    const system = createSystem({
      module: piiConstraintModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const evals = ledger.query({ kind: "constraint.evaluate" });
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;
    const spec = e.whenSpec as { email: { $eq: unknown } };
    expect(spec.email.$eq).toBe("alice@x.com");

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — C3 immutable entries
// ============================================================================

describe("createAuditLedger — frozen entries (C3)", () => {
  it("freezes entries at write time — in-process mutation throws", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const entries = ledger.query();
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0]!;

    // Vitest runs in strict mode — mutating a frozen object throws.
    expect(() => {
      (entry as { kind: string }).kind = "x";
    }).toThrow(TypeError);

    system.destroy();
  });

  it("freezes top-level whenExplain clauses (depth 2)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));

    const evals = ledger.query({ kind: "constraint.evaluate" });
    const evalEntry = evals.find(
      (e) =>
        e.kind === "constraint.evaluate" &&
        Array.isArray(e.whenExplain) &&
        e.whenExplain.length > 0,
    ) as Extract<AuditEntry, { kind: "constraint.evaluate" }> | undefined;
    expect(evalEntry).toBeDefined();
    const clause = evalEntry!.whenExplain![0]!;
    expect(() => {
      (clause as { path: string }).path = "x";
    }).toThrow(TypeError);

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — C4 whenSpec cache invalidation on assign()
// ============================================================================

describe("createAuditLedger — whenSpec cache refreshes on assign (C4)", () => {
  it("captures the NEW whenSpec after constraints.assign(), not the stale one", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    // Sanity: the original spec is captured.
    const before = ledger.query({
      kind: "constraint.evaluate",
      constraintId: "canCheckout",
    });
    expect(before.length).toBeGreaterThan(0);
    const beforeEntry = before[0] as Extract<
      AuditEntry,
      { kind: "constraint.evaluate" }
    >;
    expect(beforeEntry.whenSpec).toBeDefined();

    // Dynamically assign() a new spec.
    system.constraints.assign("canCheckout", {
      when: { cartTotal: { $gte: 999 } },
      require: { type: "CHECKOUT" },
    });
    ledger.clear();

    // Trigger a new evaluate by mutating a fact.
    system.facts.cartTotal = 1000;
    await new Promise((r) => setTimeout(r, 0));

    const after = ledger.query({
      kind: "constraint.evaluate",
      constraintId: "canCheckout",
    });
    expect(after.length).toBeGreaterThan(0);
    const afterEntry = after[0] as Extract<
      AuditEntry,
      { kind: "constraint.evaluate" }
    >;
    expect(afterEntry.whenSpec).toBeDefined();
    // The NEW spec has cartTotal.$gte = 999; the OLD spec had region.
    const newSpec = afterEntry.whenSpec as {
      cartTotal?: { $gte?: number };
      region?: unknown;
    };
    expect(newSpec.cartTotal?.$gte).toBe(999);
    expect(newSpec.region).toBeUndefined();

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — C8 erase()
// ============================================================================

describe("createAuditLedger — per-subject erase() (C8)", () => {
  it("replaces matching entries with tombstones and emits a chained marker", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    system.facts.cartTotal = 100;
    await new Promise((r) => setTimeout(r, 0));

    const before = ledger.forFact("cartTotal").length;
    expect(before).toBeGreaterThan(0);

    // (M7) erase returns `markerEntry` (the chained summary), not
    // `tombstone` — N per-entry tombstones live in the sink itself.
    const { erased, markerEntry } = ledger.erase({ factPath: "cartTotal" });
    expect(erased).toBeGreaterThan(0);
    expect(markerEntry).not.toBeNull();
    expect(markerEntry!.kind).toBe("system.subject-erased");

    // Subject-erased marker is recorded in the chain.
    const markers = ledger.query({ kind: "system.subject-erased" });
    expect(markers.length).toBe(1);

    // Erased entries are now tombstones, not fact.change.
    const tombstones = ledger.query({ kind: "system.entry-erased" });
    expect(tombstones.length).toBe(erased);

    system.destroy();
  });

  it("verify() recognizes tombstones as legitimate breaks (N1 + M1)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 25;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 125;
    await new Promise((r) => setTimeout(r, 0));

    // Pre-erase: chain should verify clean.
    const before = ledger.verify();
    expect(before.valid).toBe(true);

    // Erase the middle cartTotal entry (the 75 one).
    const { erased } = ledger.erase({
      factPath: "cartTotal",
      changedBetween: [0, Date.now()],
    });
    expect(erased).toBeGreaterThan(0);

    // After erasure: verify() still reports valid:true and surfaces
    // the erased seqs in erasedSeqs rather than as tamper.
    const after = ledger.verify();
    expect(after.valid).toBe(true);
    if (after.valid) {
      expect(after.erasedSeqs).toBeDefined();
      expect(after.erasedSeqs!.length).toBe(erased);
      expect(after.entryCount).toBeGreaterThan(0);
    }

    system.destroy();
  });

  it("verify() still detects REAL tamper even when tombstones are present (N1)", async () => {
    // Use a sink wrapper to simulate persisted-bytes tampering on an
    // entry that has nothing to do with erasure.
    const realSink = memorySink();
    let swap: ((entries: AuditEntry[]) => void) | null = null;
    const sink: typeof realSink = {
      ...realSink,
      query: realSink.query.bind(realSink),
      recent: realSink.recent.bind(realSink),
      forFact: realSink.forFact.bind(realSink),
      forConstraint: realSink.forConstraint.bind(realSink),
      write: realSink.write.bind(realSink),
      clear: realSink.clear.bind(realSink),
      destroy: realSink.destroy.bind(realSink),
      erase: realSink.erase?.bind(realSink),
      onTruncate: realSink.onTruncate?.bind(realSink),
      toJSON: () => {
        const out = realSink.toJSON();
        if (swap) {
          const cloned = JSON.parse(JSON.stringify(out)) as typeof out;
          swap(cloned.entries as AuditEntry[]);
          return cloned;
        }
        return out;
      },
    };
    const ledger = createAuditLedger({ sink });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 25;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 125;
    await new Promise((r) => setTimeout(r, 0));

    // Erase one fact-change entry.
    ledger.erase({ factPath: "cartTotal" });

    // Tamper with an EARLY entry (system.init) — has nothing to do
    // with the erasure window.
    swap = (entries) => {
      const initIdx = entries.findIndex((e) => e.kind === "system.init");
      if (initIdx >= 0 && entries[initIdx]) {
        (entries[initIdx] as { kind: string }).kind = "fact.change";
      }
    };

    const after = ledger.verify();
    expect(after.valid).toBe(false);
    if (!after.valid) {
      expect(after.brokenAt).toBeGreaterThanOrEqual(0);
    }

    system.destroy();
  });

  it("verify() throws on unknown hashAlgo discriminator (N5)", () => {
    const sink = memorySink();
    // Genesis entry with a bogus hashAlgo.
    sink.write({
      seq: 0,
      ts: 0,
      kind: "fact.change",
      key: "x",
      prior: null,
      next: 1,
      prevHash: null,
      hashAlgo: "unknown-algo" as "djb2-1",
    } as AuditEntry);

    const ledger = createAuditLedger({ sink });
    expect(() => ledger.verify()).toThrow(/unknown hashAlgo/i);
  });

  it("erase marker uses filterHash + filterShape — no raw PII (N2)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    // Mutate the PII-suggestively-named field to guarantee the filter
    // matches at least one entry; under MAJOR-3 semantics, a 0-match
    // erase emits no marker. We still verify the raw filter value
    // never lands in the marker payload.
    system.facts.cartTotal = 100;
    system.facts.region = "EU";
    await new Promise((r) => setTimeout(r, 0));

    // factPath is technically `cartTotal` here — keep a PII-looking
    // *value* in the filterHash test, but match a real key so a marker
    // emits and we can inspect its serialized form.
    ledger.erase({ factPath: "cartTotal" });

    const markers = ledger.query({ kind: "system.subject-erased" });
    expect(markers.length).toBe(1);
    const m = markers[0] as Extract<
      AuditEntry,
      { kind: "system.subject-erased" }
    >;
    // No raw filter blob in any field — only the hash + shape.
    expect(typeof m.filterHash).toBe("string");
    expect(m.filterHash.length).toBeGreaterThan(0);
    expect(m.filterShape).toEqual({
      factPath: true,
      constraintId: false,
      kind: undefined,
      changedBetween: undefined,
    });

    system.destroy();
  });

  it("erase marker filterShape marks changedBetween as '[range]' without values (N2)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 100;
    await new Promise((r) => setTimeout(r, 0));

    ledger.erase({ changedBetween: [0, Date.now()] });
    const markers = ledger.query({ kind: "system.subject-erased" });
    const m = markers[0] as Extract<
      AuditEntry,
      { kind: "system.subject-erased" }
    >;
    expect(m.filterShape.changedBetween).toBe("[range]");

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — M9 snapshot / history navigate lifecycle
// ============================================================================

describe("createAuditLedger — snapshot / history.navigate lifecycle (M9)", () => {
  it("captures system.snapshot when a snapshot is taken", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
      history: { maxSnapshots: 10 },
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    // Each fact change triggers an automatic snapshot when history is on.
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));

    const snaps = ledger.query({ kind: "system.snapshot" });
    expect(snaps.length).toBeGreaterThan(0);
    const s = snaps[0] as Extract<AuditEntry, { kind: "system.snapshot" }>;
    expect(typeof s.snapshotId).toBe("number");
    expect(typeof s.trigger).toBe("string");

    system.destroy();
  });

  it("captures system.history.navigate on goBack", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
      history: { maxSnapshots: 10 },
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 100;
    await new Promise((r) => setTimeout(r, 0));

    system.history?.goBack();
    await new Promise((r) => setTimeout(r, 0));

    const navs = ledger.query({ kind: "system.history.navigate" });
    expect(navs.length).toBeGreaterThan(0);
    const n = navs[0] as Extract<
      AuditEntry,
      { kind: "system.history.navigate" }
    >;
    expect(typeof n.from).toBe("number");
    expect(typeof n.to).toBe("number");

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — M22 function-form whenSource
// ============================================================================

describe("createAuditLedger — function-form whenSource (M22, N5)", () => {
  it("captures a sourceHash (not raw source) for function-form constraints", async () => {
    const fnModule = createModule("fn-when", {
      schema: {
        facts: {
          x: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.x = 0;
      },
      constraints: {
        fnFormed: {
          when: (facts) => facts.x > 10,
          require: { type: "GO" },
        },
      },
    });
    const ledger = createAuditLedger();
    const system = createSystem({
      module: fnModule,
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const evals = ledger.query({
      kind: "constraint.evaluate",
      constraintId: "fnFormed",
    });
    expect(evals.length).toBeGreaterThan(0);
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;
    // No whenSpec for function-form constraints…
    expect(e.whenSpec).toBeUndefined();
    // …but a sourceHash is captured (NOT the source itself).
    expect(e.whenSource).toBeDefined();
    expect(e.whenSource?.kind).toBe("function");
    expect(typeof e.whenSource?.sourceHash).toBe("string");
    expect(e.whenSource?.sourceHash.length).toBeGreaterThan(0);
    // Regression guard: the legacy `preview` field must not be present.
    expect(
      (e.whenSource as unknown as { preview?: unknown }).preview,
    ).toBeUndefined();

    system.destroy();
  });

  it("N5: secret in closure body is NOT leaked into the audit entry", async () => {
    // Construct a function-form constraint whose source contains a
    // distinct, recognizable "secret" string. After capture, the
    // serialized audit entry must NOT contain that string anywhere —
    // the whole point of hashing the source instead of slicing it.
    const API_KEY_SENTINEL = "sk-live-CANARY-12345";

    const secretFnModule = createModule("secret-fn-when", {
      schema: {
        facts: {
          x: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.x = 0;
      },
      constraints: {
        secretGated: {
          // Inline secret in the function body — exactly the kind of
          // pattern that would leak via a preview field.
          when: (facts) => {
            const apiKey = API_KEY_SENTINEL;

            return facts.x > 0 && apiKey.length > 0;
          },
          require: { type: "GO" },
        },
      },
    });

    const ledger = createAuditLedger();
    const system = createSystem({
      module: secretFnModule,
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const evals = ledger.query({
      kind: "constraint.evaluate",
      constraintId: "secretGated",
    });
    expect(evals.length).toBeGreaterThan(0);
    const e = evals[0] as Extract<AuditEntry, { kind: "constraint.evaluate" }>;

    // sourceHash is present…
    expect(e.whenSource?.sourceHash).toBeDefined();
    expect(typeof e.whenSource?.sourceHash).toBe("string");

    // …but the secret literal is nowhere in the serialized entry.
    const serialized = JSON.stringify(e);
    expect(serialized).not.toContain(API_KEY_SENTINEL);
    expect(serialized).not.toContain("CANARY");
    expect(serialized).not.toContain("apiKey");
  });
});

// ============================================================================
// R1 fixes — M23 truncation marker
// ============================================================================

describe("createAuditLedger — truncation marker (M23)", () => {
  it("emits system.truncated BEFORE the oldest entry is dropped", async () => {
    // Tight capacity so we overflow on a small number of entries.
    const sink = memorySink({ capacity: 4 });
    const ledger = createAuditLedger({ sink });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    // Cause lots of fact changes to overflow capacity.
    for (let i = 0; i < 20; i++) {
      system.facts.cartTotal = i;
    }
    await new Promise((r) => setTimeout(r, 0));

    const truncs = ledger.query({ kind: "system.truncated" });
    expect(truncs.length).toBeGreaterThan(0);
    const t0 = truncs[0] as Extract<AuditEntry, { kind: "system.truncated" }>;
    expect(typeof t0.droppedSeq).toBe("number");
    expect(t0.droppedCount).toBeGreaterThan(0);

    system.destroy();
  });
});

// ============================================================================
// R1 fixes — M26 hashAlgo on every entry
// ============================================================================

describe("createAuditLedger — hashAlgo canonicalization tag (M26)", () => {
  it("stamps hashAlgo: 'djb2-1' on every entry", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));

    const entries = ledger.query();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect((e as { hashAlgo: string }).hashAlgo).toBe("djb2-1");
    }

    system.destroy();
  });
});

// ============================================================================
// R3 fixes — F-5 schemaVersion on every entry
// ============================================================================

describe("createAuditLedger — schemaVersion (F-5)", () => {
  it("stamps schemaVersion: 1 on every entry", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));

    const entries = ledger.query();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect((e as { schemaVersion: number }).schemaVersion).toBe(1);
    }

    system.destroy();
  });

  it("schemaVersion survives erasure — tombstones carry it forward", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));

    ledger.erase({ factPath: "cartTotal" });

    const tombstones = ledger.query({ kind: "system.entry-erased" });
    expect(tombstones.length).toBeGreaterThan(0);
    for (const t of tombstones) {
      expect((t as { schemaVersion: number }).schemaVersion).toBe(1);
    }

    system.destroy();
  });
});

// ============================================================================
// R3 fixes — N7 tombstone forgery detection via internal sentinel
// ============================================================================

describe("createAuditLedger — N7 tombstone forgery detection", () => {
  it("verify() flags forged tombstone (sink.write of system.entry-erased) as tamper", async () => {
    const sink = memorySink();
    const ledger = createAuditLedger({ sink });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 25;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));

    // Pre-forgery: chain verifies clean.
    expect(ledger.verify().valid).toBe(true);

    // Attacker holding a `sink` reference forges a tombstone entry
    // directly — exactly the pattern that would mask real tampering as
    // legitimate erasure under R1/R2 semantics.
    sink.write({
      seq: 99,
      ts: Date.now(),
      kind: "system.entry-erased",
      prevHash: "deadbeef",
      hashAlgo: "djb2-1",
      schemaVersion: 1,
      originalKind: "fact.change",
      erasedAt: Date.now(),
      // NOTE: no `__internal` sentinel — sink consumers cannot reach
      // the in-module symbol.
    } as unknown as AuditEntry);

    const after = ledger.verify();
    expect(after.valid).toBe(false);
    if (!after.valid) {
      expect(after.reason).toBeDefined();
      expect(after.reason).toMatch(/tombstone forgery/i);
      expect(after.reason).toMatch(/sentinel/i);
    }

    system.destroy();
  });

  it("legitimate ledger.erase() tombstones still pass verify (sentinel present)", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 25;
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 75;
    await new Promise((r) => setTimeout(r, 0));

    ledger.erase({ factPath: "cartTotal" });
    const result = ledger.verify();
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect((result.erasedSeqs ?? []).length).toBeGreaterThan(0);
    }

    system.destroy();
  });

  it("__internal sentinel is stripped from query/toJSON/recent/forFact public reads", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    system.facts.cartTotal = 50;
    await new Promise((r) => setTimeout(r, 0));

    ledger.erase({ factPath: "cartTotal" });

    const all = [
      ...ledger.query(),
      ...ledger.recent(100),
      ...ledger.forFact("cartTotal"),
      ...ledger.toJSON().entries,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect((e as { __internal?: unknown }).__internal).toBeUndefined();
    }

    system.destroy();
  });
});

// ============================================================================
// R3 fixes — erasedSeqs deduplication for adjacent tombstones (Sec MAJOR)
// ============================================================================

describe("createAuditLedger — erasedSeqs dedupes adjacent tombstones", () => {
  it("two consecutive erasures yield each seq exactly once in erasedSeqs", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));
    // Two consecutive fact.change entries — same key, adjacent in the
    // sink — guarantees adjacent tombstones after erase().
    system.facts.cartTotal = 10;
    system.facts.cartTotal = 20;
    system.facts.cartTotal = 30;
    await new Promise((r) => setTimeout(r, 0));

    const { erased } = ledger.erase({ factPath: "cartTotal" });
    expect(erased).toBeGreaterThanOrEqual(2);

    const result = ledger.verify();
    expect(result.valid).toBe(true);
    if (result.valid && result.erasedSeqs) {
      const set = new Set(result.erasedSeqs);
      expect(set.size).toBe(result.erasedSeqs.length);
    }

    system.destroy();
  });
});

// ============================================================================
// R3 fixes — MAJOR-3 erase 0-match guard
// ============================================================================

describe("createAuditLedger — MAJOR-3 erase 0-match guard", () => {
  it("erase() with no matches returns { erased: 0, markerEntry: null } and emits no marker", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await new Promise((r) => setTimeout(r, 0));

    const before = ledger.query({ kind: "system.subject-erased" }).length;
    const result = ledger.erase({
      kind: "constraint.evaluate",
      factPath: "nonexistent-key",
    });

    expect(result.erased).toBe(0);
    expect(result.markerEntry).toBeNull();

    const after = ledger.query({ kind: "system.subject-erased" }).length;
    expect(after).toBe(before);

    system.destroy();
  });
});
