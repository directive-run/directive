/**
 * L12c: the audit ledger's row (by), the root exports, and the status plugin.
 *
 * Row (by), approved in the L12 RFC: `verify()` rejects a break at a tombstone
 * this module minted unless the entry before it is a tombstone too. An
 * exported or copied ledger has no marks, so it keeps 1.35's verdict.
 */
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import * as root from "../index.js";
import { createAuditLedger, memorySink } from "../plugins/index.js";
import type { AuditEntry } from "../types/audit-ledger.js";

function makeModule() {
  return createModule("cart", {
    schema: { facts: { cartTotal: t.number() } },
    init: (facts) => {
      facts.cartTotal = 0;
    },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A memorySink whose export swaps one entry for an edited copy, in process. */
function tamperingSink(edit: (entries: AuditEntry[]) => void) {
  const real = memorySink();
  let armed = false;
  const sink: typeof real = {
    ...real,
    query: real.query.bind(real),
    recent: real.recent.bind(real),
    forFact: real.forFact.bind(real),
    forConstraint: real.forConstraint.bind(real),
    write: real.write.bind(real),
    clear: real.clear.bind(real),
    destroy: real.destroy.bind(real),
    erase: real.erase?.bind(real),
    onTruncate: real.onTruncate?.bind(real),
    toJSON: () => {
      const out = real.toJSON();
      if (armed) edit(out.entries as AuditEntry[]);

      return out;
    },
  };

  return {
    sink,
    arm: () => {
      armed = true;
    },
  };
}

async function erasedLedger(edit: (entries: AuditEntry[]) => void) {
  const { sink, arm } = tamperingSink(edit);
  const ledger = createAuditLedger({ sink });
  const system = createSystem({
    module: makeModule(),
    plugins: [ledger.plugin],
  });
  system.start();
  await tick();
  system.facts.cartTotal = 25;
  await tick();
  system.facts.cartTotal = 75;
  await tick();
  ledger.erase({ factPath: "cartTotal" });

  return { ledger, system, arm };
}

const tombIndex = (entries: AuditEntry[]) =>
  entries.findIndex((e, i) => i > 0 && e.kind === "system.entry-erased");

describe("audit ledger, row (by)", () => {
  it("an untampered ledger with erasures verifies", async () => {
    const { ledger, system } = await erasedLedger(() => {});
    const verdict = ledger.verify();
    expect(verdict.valid).toBe(true);
    if (verdict.valid) expect(verdict.erasedSeqs?.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("rejects an in-process tamper of the entry just before a minted tombstone", async () => {
    const { ledger, system, arm } = await erasedLedger((entries) => {
      const tomb = tombIndex(entries);
      const before = entries[tomb - 1]!;
      if (before.kind !== "system.entry-erased") {
        entries[tomb - 1] = { ...before, kind: "fact.change" } as AuditEntry;
      }
    });
    const entries = ledger.toJSON().entries as AuditEntry[];
    const tomb = tombIndex(entries);
    expect(tomb).toBeGreaterThan(0);
    // The precondition: the entry before is not itself a tombstone.
    expect(entries[tomb - 1]?.kind).not.toBe("system.entry-erased");
    arm();
    const verdict = ledger.verify();
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.brokenAt).toBe(tomb);
    system.destroy();
  });

  it("keeps 1.35's verdict for a copied ledger: the tamper verifies, unmarked", async () => {
    const { ledger, system, arm } = await erasedLedger((entries) => {
      const copy = JSON.parse(JSON.stringify(entries)) as AuditEntry[];
      const tomb = tombIndex(copy);
      (copy[tomb - 1] as { kind: string }).kind = "fact.change";
      entries.splice(0, entries.length, ...copy);
    });
    arm();
    expect(ledger.verify().valid).toBe(true);
    system.destroy();
  });

  it("adjacent erasures still verify: a break at a tombstone after a tombstone", async () => {
    const real = memorySink();
    const ledger = createAuditLedger({ sink: real });
    const system = createSystem({
      module: makeModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await tick();
    system.facts.cartTotal = 1;
    await tick();
    system.facts.cartTotal = 2;
    await tick();
    ledger.erase({ factPath: "cartTotal" });
    const all = real.toJSON().entries as AuditEntry[];
    const adjacent = all.some(
      (e, i) =>
        i > 0 &&
        e.kind === "system.entry-erased" &&
        all[i - 1]!.kind === "system.entry-erased",
    );
    expect(adjacent).toBe(true);
    expect(ledger.verify().valid).toBe(true);
    system.destroy();
  });

  it("verify({ strong: true }) throws 1.35's message (bw declined)", () => {
    const ledger = createAuditLedger();
    expect(() => ledger.verify({ strong: true })).toThrow(
      "[Directive] verify({ strong: true }) is reserved for v2",
    );
  });
});

describe("L12c root exports", () => {
  it("ships the ledger and the status plugin from the root", () => {
    for (const name of [
      "createAuditLedger",
      "memorySink",
      "createRequirementStatusPlugin",
      "createStatusHook",
      "createSystemWithStatus",
    ]) {
      expect(typeof (root as Record<string, unknown>)[name], name).toBe(
        "function",
      );
    }
    expect(root.createAuditLedger).toBe(createAuditLedger);
    expect(root.memorySink).toBe(memorySink);
  });

  it("createSystemWithStatus wires a status plugin that tracks a requirement", async () => {
    let release: () => void = () => {};
    const mod = createModule("load", {
      schema: {
        facts: { want: t.boolean(), done: t.boolean() },
        requirements: { FETCH: {} },
      },
      init: (facts) => {
        facts.want = false;
        facts.done = false;
      },
      constraints: {
        fetch: {
          when: (f) => f.want === true && f.done !== true,
          require: { type: "FETCH" },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          resolve: async (_req, ctx) => {
            await new Promise<void>((r) => {
              release = r;
            });
            ctx.facts.done = true;
          },
        },
      },
    });
    const { system, statusPlugin } = root.createSystemWithStatus({
      module: mod,
    });
    const useStatus = root.createStatusHook(statusPlugin);
    system.start();
    expect(useStatus("FETCH").isLoading).toBe(false);
    system.facts.want = true;
    await tick();
    expect(statusPlugin.getStatus("FETCH").isLoading).toBe(true);
    release();
    await tick();
    await tick();
    expect(statusPlugin.getStatus("FETCH").isLoading).toBe(false);
    expect(system.facts.done).toBe(true);
    system.destroy();
  });
});
