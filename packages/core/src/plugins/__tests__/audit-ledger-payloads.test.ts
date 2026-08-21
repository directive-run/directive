import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import {
  type AuditEntry,
  createAuditLedger,
  memorySink,
} from "../audit-ledger/index.js";

/**
 * What a payload does to the record.
 *
 * A fact value is not something the application always authors — it can come
 * from a source publishing external data, a query result, a request body. So
 * the shapes a value can take are an input to this subsystem, not a detail of
 * it, and each of these was a way for one value to break the record.
 */

function makeSystem(ledger: ReturnType<typeof createAuditLedger>) {
  const mod = createModule("m", {
    schema: { facts: { n: t.number(), v: t.object<unknown>() } },
    init: (facts) => {
      facts.n = 0;
      facts.v = {};
    },
  });

  return createSystem({ module: mod, plugins: [ledger.plugin] });
}

function reload(ledger: ReturnType<typeof createAuditLedger>) {
  const exported = JSON.parse(JSON.stringify(ledger.toJSON())) as {
    entries: AuditEntry[];
  };
  const sink = memorySink({ capacity: 10_000 });
  for (const entry of exported.entries) {
    sink.write(entry);
  }

  return createAuditLedger({ sink });
}

describe("a fact value reaching the record", () => {
  it("does not expand a shared reference once per path that reaches it", () => {
    // The cycle guard is scoped to the current path, which is what a cycle
    // is — but with nothing remembering work already done, a graph whose
    // nodes are each referenced twice is expanded into a tree. Twenty-two
    // nodes took four seconds and produced a 37MB entry; a little deeper
    // takes the process. One fact write must not be able to do that.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    let node: unknown = { leaf: 1 };
    for (let i = 0; i < 24; i++) {
      node = { a: node, b: node };
    }

    const startedAt = Date.now();
    system.facts.v = node;
    const elapsed = Date.now() - startedAt;

    // Bounded by the projection's node budget rather than by the shape of
    // whatever was handed in.
    expect(elapsed).toBeLessThan(1000);
    const row = ledger.query({ kind: "fact.change", factPath: "v" })[0];
    expect(JSON.stringify(row).length).toBeLessThan(2_000_000);
    expect(JSON.stringify(row)).toContain("[too-large]");

    system.destroy();
    ledger.destroy();
  });

  it("records nothing the hash cannot reach", () => {
    // The canonical stringifier stops at a depth and writes a marker. Content
    // an entry held below that was in the record and outside the hash — so it
    // could be edited in place, and two payloads differing only down there
    // were indistinguishable.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    let deep: unknown = { leaf: "APPROVED" };
    for (let i = 0; i < 60; i++) {
      deep = { d: deep };
    }
    system.facts.v = deep;
    system.facts.n = 1;
    system.facts.n = 2;

    const row = ledger.query({ kind: "fact.change", factPath: "v" })[0] as {
      next: unknown;
    };
    let cursor = row.next as Record<string, unknown>;
    let reached = 0;
    while (cursor && typeof cursor === "object" && "d" in cursor) {
      cursor = cursor.d as Record<string, unknown>;
      reached++;
    }
    // The record stops where the hash stops, and says so where it stops.
    expect(reached).toBeLessThan(60);
    expect(JSON.stringify(row)).toContain("[max-depth]");
    expect(JSON.stringify(row)).not.toContain("APPROVED");

    system.destroy();
    ledger.destroy();
  });

  it("verifies after an export for values JSON has no form for", () => {
    // A date recorded as a date cannot survive an export as a date. Recorded
    // as one, the live entry and its export disagreed about a value nobody
    // touched, and the exported trail read as tampered.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    system.facts.v = {
      when: new Date(0),
      pattern: /ab+c/gi,
      pairs: new Map([["k", 1]]),
      items: new Set([1, 2]),
      gap: [1, undefined, 3],
      notANumber: Number.NaN,
      huge: Number.POSITIVE_INFINITY,
    };
    system.facts.n = 1;

    expect(ledger.verify().valid).toBe(true);

    const reader = reload(ledger);
    const verdict = reader.verify();
    expect(verdict.valid).toBe(true);

    // The content is kept, in the shapes an export has.
    const row = JSON.stringify(
      ledger.query({ kind: "fact.change", factPath: "v" })[0],
    );
    expect(row).toContain("1970-01-01");
    expect(row).toContain("ab+c");
    expect(row).toContain('[["k",1]]');

    reader.destroy();
    system.destroy();
    ledger.destroy();
  });

  it("verifies after an export when a value is a function", () => {
    // Handling objects and non-finite numbers left a top-level function or
    // symbol untouched: the stringifier renders both and JSON drops the key.
    // A function also defeats the structured copy, so the entry held the
    // caller's own function, and its closure, unfrozen.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    system.facts.v = { fn: () => "secret", sym: Symbol("s"), ok: 1 };
    system.facts.n = 1;

    expect(ledger.verify().valid).toBe(true);
    const reader = reload(ledger);
    expect(reader.verify().valid).toBe(true);

    const row = JSON.stringify(
      ledger.query({ kind: "fact.change", factPath: "v" })[0],
    );
    expect(row).toContain('"ok":1');
    expect(row).not.toContain("secret");

    reader.destroy();
    system.destroy();
    ledger.destroy();
  });

  it("verifies after a restart that resumes from an export", () => {
    // A resumed ledger holds entries it did not write and then writes some of
    // its own. Deciding a verdict on which entries carry the runtime's mark
    // meant that first own write turned every imported tombstone into a
    // forgery — which is every restart.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();
    system.facts.n = 1;
    system.facts.n = 2;
    ledger.erase({ factPath: "n" });

    const resumed = reload(ledger);
    expect(resumed.verify().valid).toBe(true);

    const resumedSystem = makeSystem(resumed);
    resumedSystem.start();
    resumedSystem.facts.n = 3;

    const verdict = resumed.verify();
    expect(verdict.valid).toBe(true);

    resumedSystem.destroy();
    resumed.destroy();
    system.destroy();
    ledger.destroy();
  });

  it("records nothing the hash cannot reach, through a map as well", () => {
    // A map is projected as an array of pairs, which is two levels of output
    // for one level walked. Charging it one let content sit at twice the depth
    // the cap thought it was allowing — back below the line the canonical
    // stringifier walks to, so it was in the record, outside the hash, and
    // editable in place.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    let nested: unknown = { secret: "111-11-1111" };
    for (let i = 0; i < 30; i++) {
      nested = new Map([["k", nested]]);
    }
    system.facts.v = nested;
    system.facts.n = 1;

    const row = JSON.stringify(
      ledger.query({ kind: "fact.change", factPath: "v" })[0],
    );
    // Whatever the record kept is inside what the hash covers, so the value
    // beyond the cap is not there to be edited.
    expect(row).not.toContain("111-11-1111");
    expect(row).toContain("[max-depth]");
    expect(ledger.verify().valid).toBe(true);

    system.destroy();
    ledger.destroy();
  });

  it("bounds what a payload produces, not just what it walks", () => {
    // The budget was charged per object visited, so leaves were free: one
    // object with a few thousand string keys, reached down a shared graph,
    // produced ninety-three megabytes from about two thousand inputs.
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();

    const leaf: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i++) {
      leaf[`k${i}`] = "v";
    }
    let level: unknown = leaf;
    for (let i = 0; i < 12; i++) {
      level = { a: level, b: level };
    }

    const startedAt = Date.now();
    system.facts.v = level;
    const elapsed = Date.now() - startedAt;

    const row = JSON.stringify(
      ledger.query({ kind: "fact.change", factPath: "v" })[0],
    );
    expect(elapsed).toBeLessThan(1000);
    expect(row.length).toBeLessThan(2_000_000);

    system.destroy();
    ledger.destroy();
  });

  it("starts a fresh chain rather than failing to construct", () => {
    // The resume reads the sink at construction. A sink is supplied by the
    // caller and may be a network or a disk, so letting it throw there made
    // the availability of the audit store the availability of the system.
    const hostile = {
      ...memorySink(),
      recent: () => {
        throw new Error("store unreachable");
      },
    } as ReturnType<typeof memorySink>;

    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    const ledger = createAuditLedger({ sink: hostile });
    console.error = original;

    expect(errors.length).toBeGreaterThan(0);
    expect(() => ledger.verify()).not.toThrow();

    ledger.destroy();
  });

  it("does not continue from an entry whose sequence number is unusable", () => {
    const sink = memorySink();
    sink.write({
      kind: "system.start",
      seq: Number.POSITIVE_INFINITY,
      ts: 0,
      prevHash: null,
      hashAlgo: "djb2-1",
      schemaVersion: 2,
    } as unknown as AuditEntry);

    const original = console.error;
    console.error = () => {};
    const ledger = createAuditLedger({ sink });
    console.error = original;

    const system = makeSystem(ledger);
    system.start();
    system.facts.n = 1;

    // Counting up from a non-finite number produces entries whose sequence is
    // not a number, and those hash differently once written out than they do
    // in memory. The unusable entry is still in the sink — it was put there
    // directly — but nothing the ledger writes inherits it.
    const own = ledger
      .toJSON()
      .entries.filter((entry) => entry.seq !== Number.POSITIVE_INFINITY);
    expect(own.length).toBeGreaterThan(0);
    for (const entry of own) {
      expect(Number.isSafeInteger(entry.seq)).toBe(true);
    }

    system.destroy();
    ledger.destroy();
  });
});
