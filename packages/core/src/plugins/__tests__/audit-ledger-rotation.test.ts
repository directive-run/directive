import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import {
  type AuditEntry,
  createAuditLedger,
  memorySink,
} from "../audit-ledger/index.js";

/**
 * A bounded sink drops its oldest entries once it is full. That is ordinary
 * operation, not damage — but `verify()` began every walk at the genesis hash,
 * so the first link failed the moment the head rotated out and a healthy
 * ledger reported itself altered for the rest of its life.
 *
 * The consequence is worse than a wrong answer. An operator who learns that
 * routine rotation reads as tamper learns to ignore the one control that would
 * tell them about real tamper.
 *
 * Recording batched writes made this routine rather than rare: roughly four
 * times the entries reach the sink, so the default buffer wraps four times
 * sooner.
 */

const flushTick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeSystem(ledger: ReturnType<typeof createAuditLedger>) {
  const mod = createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts) => {
      facts.n = 0;
    },
  });

  return createSystem({ module: mod, plugins: [ledger.plugin] });
}

describe("a rotated ledger", () => {
  it("verifies, and says which seq the surviving window starts at", async () => {
    const ledger = createAuditLedger({ sink: memorySink({ capacity: 40 }) });
    const system = makeSystem(ledger);
    system.start();
    await flushTick();

    for (let i = 1; i <= 200; i++) {
      system.batch(() => {
        system.facts.n = i;
      });
    }
    await flushTick();

    const result = ledger.verify();
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.windowStartSeq).toBeGreaterThan(0);
      // The window carries the markers the sink wrote as it rotated, so the
      // missing prefix has an account of itself.
      expect(result.truncationExplained).toBe(true);
    }

    system.destroy();
    ledger.destroy();
  });

  it("still catches tamper inside the surviving window", async () => {
    const real = memorySink({ capacity: 40 });
    let swap: ((entries: AuditEntry[]) => void) | null = null;
    const sink: typeof real = {
      ...real,
      query: real.query.bind(real),
      recent: real.recent.bind(real),
      forFact: real.forFact.bind(real),
      forConstraint: real.forConstraint.bind(real),
      write: real.write.bind(real),
      clear: real.clear.bind(real),
      destroy: real.destroy.bind(real),
      onTruncate: real.onTruncate?.bind(real),
      toJSON: () => {
        const out = real.toJSON();
        if (!swap) return out;
        const cloned = JSON.parse(JSON.stringify(out)) as typeof out;
        swap(cloned.entries as AuditEntry[]);

        return cloned;
      },
    };
    const ledger = createAuditLedger({ sink });
    const system = makeSystem(ledger);
    system.start();
    await flushTick();
    for (let i = 1; i <= 200; i++) {
      system.batch(() => {
        system.facts.n = i;
      });
    }
    await flushTick();

    expect(ledger.verify().valid).toBe(true);

    // Edit an entry in the middle of what survived.
    swap = (entries) => {
      const target = entries[Math.floor(entries.length / 2)] as {
        kind: string;
      };
      const before = target.kind;
      target.kind =
        before === "fact.change" ? "constraint.evaluate" : "fact.change";
      expect(target.kind).not.toBe(before);
    };

    expect(ledger.verify().valid).toBe(false);

    system.destroy();
    ledger.destroy();
  });

  it("counts every dropped entry, including the ones its own marker displaced", () => {
    // Measured at the sink, because markers rotate out of the buffer like
    // anything else — summing the markers that happen to have survived cannot
    // account for what was dropped.
    //
    // The marker is itself a write. Reporting a drop while making one evicted
    // a second entry that no marker mentioned, so the buffer lost two per
    // overflow and reported one: a 2x undercount in the only number an
    // operator has for how much history is gone.
    const capacity = 10;
    const sink = memorySink({ capacity });
    let reported = 0;
    let markersWritten = 0;
    sink.onTruncate?.((_seq, count) => {
      reported += count;
      markersWritten++;
      // The handler writes a marker of its own, as the ledger's does.
      sink.write({
        kind: "system.truncated",
        droppedSeq: _seq,
        droppedCount: count,
        seq: 10_000 + reported,
        ts: 0,
        prevHash: null,
        hashAlgo: "djb2-1",
        schemaVersion: 2,
      } as unknown as AuditEntry);
    });

    const written = 100;
    for (let i = 0; i < written; i++) {
      sink.write({
        kind: "system.start",
        seq: i,
        ts: 0,
        prevHash: null,
        hashAlgo: "djb2-1",
        schemaVersion: 2,
      } as unknown as AuditEntry);
    }

    // A drop made while a marker is being written is held and reported by the
    // next one, so one final write settles the tail.
    sink.write({
      kind: "system.stop",
      seq: written,
      ts: 0,
      prevHash: null,
      hashAlgo: "djb2-1",
      schemaVersion: 2,
    } as unknown as AuditEntry);

    // Everything written, plus every marker the handler added, minus what is
    // still in the buffer, is what was dropped — and all of it was reported.
    const totalWrites = written + 1 + markersWritten;
    const stillHeld = sink.toJSON().entries.length;
    const actuallyDropped = totalWrites - stillHeld;

    // The lag is at most one entry — the drop made to fit the most recent
    // marker, which the next marker reports. It does not grow with volume:
    // ~180 entries were dropped here and the count is short by one, where
    // before it was short by half of them.
    expect(actuallyDropped).toBeGreaterThan(100);
    expect(actuallyDropped - reported).toBeLessThanOrEqual(1);
    sink.destroy();
  });

  it("keeps seq running forwards through the buffer", async () => {
    // The marker used to be written before the entry that caused it, so the
    // buffer read [marker(n+1), entry(n)] and seq ran backwards.
    const ledger = createAuditLedger({ sink: memorySink({ capacity: 40 }) });
    const system = makeSystem(ledger);
    system.start();
    await flushTick();
    for (let i = 1; i <= 200; i++) {
      system.batch(() => {
        system.facts.n = i;
      });
    }
    await flushTick();

    const seqs = ledger.toJSON().entries.map((e) => e.seq);
    const inversions = seqs.filter((s, i) => i > 0 && s < seqs[i - 1]!).length;
    expect(inversions).toBe(0);

    system.destroy();
    ledger.destroy();
  });

  it("says so when entries are missing and nothing explains why", () => {
    // Seeding the walk from the surviving window is what stops rotation
    // reading as tamper — but on its own it also accepts a prefix someone
    // deleted, because the first entry ends up checked against its own
    // recorded hash. A rotated window carries the markers its sink wrote; a
    // hand-trimmed one does not.
    const sink = memorySink({ capacity: 1000 });
    const ledger = createAuditLedger({ sink });
    const system = makeSystem(ledger);
    system.start();
    for (let i = 1; i <= 20; i++) {
      system.facts.n = i;
    }

    const full = ledger.verify();
    expect(full.valid).toBe(true);
    if (full.valid) expect(full.windowStartSeq).toBeUndefined();

    const exported = JSON.parse(JSON.stringify(ledger.toJSON())) as {
      entries: AuditEntry[];
    };
    const trimmed = memorySink();
    for (const entry of exported.entries.slice(5)) {
      trimmed.write(entry);
    }
    const reader = createAuditLedger({ sink: trimmed });
    const verdict = reader.verify();

    expect(verdict.valid).toBe(true);
    if (verdict.valid) {
      expect(verdict.windowStartSeq).toBe(5);
      expect(verdict.truncationExplained).toBe(false);
    }

    reader.destroy();
    system.destroy();
    ledger.destroy();
  });
});
