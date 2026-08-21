import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import {
  type AuditEntry,
  createAuditLedger,
  memorySink,
} from "../audit-ledger/index.js";

/**
 * Four ways the record could be made to lie, each cheap enough to be worth
 * closing.
 *
 * None of this makes an in-memory ring buffer evidentiary. The chain is
 * unkeyed, so anyone who can reach the buffer can recompute it — see the
 * threat model. What these close is the case where a correct-looking answer is
 * produced for free.
 */

function makeSystem(ledger: ReturnType<typeof createAuditLedger>) {
  const mod = createModule("m", {
    schema: { facts: { n: t.number() } },
    init: (facts) => {
      facts.n = 0;
    },
  });

  return createSystem({ module: mod, plugins: [ledger.plugin] });
}

describe("the record under forgery", () => {
  it("does not accept an appended marker as an account of a trimmed prefix", () => {
    const ledger = createAuditLedger({ sink: memorySink({ capacity: 1000 }) });
    const system = makeSystem(ledger);
    system.start();
    for (let i = 1; i <= 15; i++) {
      system.facts.n = i;
    }

    const exported = JSON.parse(JSON.stringify(ledger.toJSON())) as {
      entries: AuditEntry[];
    };
    // Trim the prefix, then append a truncation marker so the gap reads as
    // ordinary rotation. The marker is an ordinary chained entry, so minting
    // one costs nothing unless it has to bear a sentinel.
    const trimmed = memorySink();
    for (const entry of exported.entries.slice(5)) {
      trimmed.write(entry);
    }
    const tip = exported.entries.at(-1)!;
    trimmed.write({
      kind: "system.truncated",
      droppedSeq: 0,
      droppedCount: 5,
      seq: tip.seq + 1,
      ts: tip.ts,
      prevHash: null,
      hashAlgo: "djb2-1",
      schemaVersion: 2,
    } as unknown as AuditEntry);

    const reader = createAuditLedger({ sink: trimmed });
    const verdict = reader.verify();
    if (verdict.valid) {
      expect(verdict.windowStartSeq).toBe(5);
      expect(verdict.truncationExplained).toBe(false);
    }

    reader.destroy();
    system.destroy();
    ledger.destroy();
  });

  it("does not let an entry with no origin answer to an origin query", () => {
    const sink = memorySink();
    const appended = createAuditLedger({ sink });
    sink.write({
      kind: "fact.change",
      key: "n",
      prior: 1,
      next: 999,
      seq: 0,
      ts: 0,
      prevHash: null,
      hashAlgo: "djb2-1",
      schemaVersion: 2,
    } as unknown as AuditEntry);

    // An entry claiming the current schema with no origin did not come from
    // the runtime. Answering to "authored" would let it hide among the
    // program's own writes.
    expect(appended.query({ kind: "fact.change", origin: "authored" })).toEqual(
      [],
    );

    // A genuine schema-1 entry is different: replayed writes were not recorded
    // at all under that schema, so an absent origin does mean the program made
    // it.
    sink.write({
      kind: "fact.change",
      key: "n",
      prior: 1,
      next: 2,
      seq: 1,
      ts: 0,
      prevHash: null,
      hashAlgo: "djb2-1",
      schemaVersion: 1,
    } as unknown as AuditEntry);
    expect(
      appended.query({ kind: "fact.change", origin: "authored" }),
    ).toHaveLength(1);

    appended.destroy();
  });

  it("does not chain the next entry onto one the sink refused", () => {
    // A sink can fail. Advancing the chain pointer before the write meant the
    // next entry pointed at a hash no stored entry carried, so the ledger
    // reported itself tampered from then on — and `verify()` stops at the
    // first break, so everything after it went unexamined.
    const real = memorySink();
    let failNext = false;
    const sink: typeof real = {
      ...real,
      query: real.query.bind(real),
      recent: real.recent.bind(real),
      forFact: real.forFact.bind(real),
      forConstraint: real.forConstraint.bind(real),
      clear: real.clear.bind(real),
      destroy: real.destroy.bind(real),
      toJSON: real.toJSON.bind(real),
      onTruncate: real.onTruncate?.bind(real),
      write: (entry) => {
        if (failNext) {
          failNext = false;
          throw new Error("sink is full");
        }
        real.write(entry);
      },
    };
    const seen: number[] = [];
    const ledger = createAuditLedger({
      sink,
      onWriteError: (_error, entry) => {
        seen.push(entry.seq);
      },
    });
    const system = makeSystem(ledger);
    system.start();
    system.facts.n = 1;

    failNext = true;
    system.facts.n = 2;

    system.facts.n = 3;
    system.facts.n = 4;

    // The dropped entry is reported rather than swallowed, and the chain
    // closes over the gap instead of breaking on it.
    expect(seen).toHaveLength(1);
    expect(ledger.verify().valid).toBe(true);

    system.destroy();
    ledger.destroy();
  });

  it("keeps a caller's filter out of the erasure record", () => {
    const ledger = createAuditLedger();
    const system = makeSystem(ledger);
    system.start();
    system.facts.n = 1;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // An erasure filter can arrive from a request body. The marker is frozen
    // and permanent, so anything copied into it verbatim stays there.
    const injected = "ssn=123-45-6789" as never;
    const result = ledger.erase({
      kind: "fact.change",
      origin: ["authored", injected],
    });
    errorSpy.mockRestore();

    const marker = result.markerEntry;
    if (marker && marker.kind === "system.subject-erased") {
      expect(JSON.stringify(marker.filterShape)).not.toContain("123-45-6789");
      expect(marker.filterShape.origin).toEqual(["authored"]);
    }

    system.destroy();
    ledger.destroy();
  });
});
