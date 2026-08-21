import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import {
  type AuditEntry,
  createAuditLedger,
  memorySink,
} from "../audit-ledger/index.js";

/**
 * The ledger sits behind `system.observe()`, which had no `onFactsBatch` arm.
 * So a write wrapped in `system.batch()` produced no row, while the identical
 * unwrapped write produced one — and event handlers, effects, resolvers before
 * their first await, `initialFacts`, `hydrate` and every history restore all
 * write through a batch.
 *
 * The measurement that started this: same fact, same value, one wrapped and
 * one not, against a ledger asked for that key. Unbatched returned one row.
 * Batched returned none.
 */

const flushTick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeModule() {
  return createModule("checkout", {
    schema: {
      facts: { cartTotal: t.number(), region: t.string() },
    },
    init: (facts) => {
      facts.cartTotal = 0;
      facts.region = "US";
    },
  });
}

describe("audit ledger and batched writes", () => {
  let ledger: ReturnType<typeof createAuditLedger>;
  // biome-ignore lint/suspicious/noExplicitAny: test harness
  let system: any;

  beforeEach(() => {
    ledger = createAuditLedger();
    system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
      history: { maxSnapshots: 50 },
    });
  });

  afterEach(() => {
    system.destroy();
    ledger.destroy();
  });

  it("records a batched write, like the unbatched one beside it", async () => {
    system.start();
    await flushTick();

    system.facts.cartTotal = 75;
    await flushTick();
    const afterUnbatched = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
    }).length;

    system.batch(() => {
      system.facts.cartTotal = 120;
    });
    await flushTick();
    const afterBatched = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
    }).length;

    // `init` writes through a batch too, so it now contributes a row of its
    // own — the starting state was previously invisible to the trail.
    expect(afterUnbatched).toBe(2);
    expect(afterBatched - afterUnbatched).toBe(1);
  });

  it("records the write an event handler makes", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        events: { BUMP: {} },
      },
      init: (facts) => {
        facts.n = 0;
      },
      events: {
        BUMP: (facts) => {
          facts.n = facts.n + 1;
        },
      },
    });
    const led = createAuditLedger();
    const sys = createSystem({ module: mod, plugins: [led.plugin] });
    sys.start();
    await flushTick();

    sys.events.BUMP();
    await flushTick();

    const changes = led.query({
      kind: "fact.change",
      factPath: "n",
    }) as Extract<AuditEntry, { kind: "fact.change" }>[];
    // The handler's write plus `init`'s. Before this, neither appeared.
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.next === 1)).toMatchObject({ prior: 0 });

    sys.destroy();
    led.destroy();
  });

  it("files a replayed write rather than dropping it", async () => {
    system.start();
    await flushTick();
    system.facts.cartTotal = 75;
    await system.settle();
    system.facts.cartTotal = 120;
    await system.settle();

    system.history.goBack();
    await flushTick();

    const changes = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
    }) as Extract<AuditEntry, { kind: "fact.change" }>[];

    const replayed = changes.filter((c) => c.origin === "restore");
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ prior: 120, next: 75 });

    // The program's own writes are labelled as such rather than left blank —
    // a query for them names them instead of testing for a missing field, which
    // would silently reclassify every row the day another origin is added.
    expect(changes.filter((c) => c.origin === "authored").length).toBe(3);
  });

  it("redacts a tagged fact on the paths this made visible", async () => {
    // Routing more writes into the ledger means routing more values into it.
    // The `init` write and the batched write are both newly recorded, so both
    // are newly able to carry a tagged value into a durable sink.
    const mod = createModule("m", {
      schema: {
        facts: { email: t.string().meta({ tags: ["pii"] }), n: t.number() },
      },
      init: (facts) => {
        facts.email = "init@example.com";
        facts.n = 0;
      },
    });
    const led = createAuditLedger();
    const sys = createSystem({ module: mod, plugins: [led.plugin] });
    sys.start();
    await flushTick();

    sys.facts.email = "unbatched@example.com";
    await flushTick();
    sys.batch(() => {
      sys.facts.email = "batched@example.com";
    });
    await flushTick();

    const rows = led.query({ kind: "fact.change", factPath: "email" });
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("@example.com");

    sys.destroy();
    led.destroy();
  });

  it("selects by origin in the sink, not after the page is chosen", async () => {
    // `query()` walks newest-first and stops at `limit`. A caller filtering the
    // result is filtering a page that was already picked, so a fact whose
    // recent history is mostly replayed writes can fill the page and leave the
    // authored ones behind — the query returns nothing and looks like an
    // answer.
    system.start();
    await flushTick();
    system.facts.cartTotal = 1;
    await system.settle();
    system.facts.cartTotal = 2;
    await system.settle();
    system.history.goBack();
    await flushTick();

    const authored = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
      origin: "authored",
      limit: 1,
    });
    expect(authored).toHaveLength(1);
    expect(authored[0]).toMatchObject({ origin: "authored" });

    const replayed = ledger.query({
      kind: "fact.change",
      origin: "restore",
    });
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((e) => e.kind === "fact.change")).toBe(true);
  });

  it("keeps the chain verifiable once batched writes are in it", async () => {
    system.start();
    await flushTick();

    system.batch(() => {
      system.facts.cartTotal = 10;
      system.facts.region = "EU";
      system.facts.cartTotal = 20;
    });
    await flushTick();

    expect(ledger.verify().valid).toBe(true);

    const exported = JSON.parse(JSON.stringify(ledger.toJSON())) as {
      entries: AuditEntry[];
    };
    const reloaded = memorySink();
    for (const entry of exported.entries) {
      reloaded.write(entry);
    }
    const replay = createAuditLedger({ sink: reloaded });
    expect(replay.verify().valid).toBe(true);
    replay.destroy();
  });
});
