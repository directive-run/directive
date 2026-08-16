/**
 * The ledger is the durable sink. Anything it writes raw is permanent, and
 * because the chain is hash-linked it cannot be edited out afterwards without
 * breaking the chain.
 *
 * Its pii set was built at attach and refreshed only from a plugin hook that
 * `registerModule` does not emit — so a module registered after start brought
 * facts the ledger never learned were tagged, and their values went into the
 * chain in the clear. The same function also cleared the set before asking what
 * to put in it, so one throw emptied it permanently.
 *
 * Both are the shape the fact-PII guardrail was restructured twice to remove,
 * still live in the more durable of the two sinks.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";
import { createAuditLedger } from "../audit-ledger/index";

const flushTick = () => new Promise((r) => setTimeout(r, 0));

function baseModule() {
  return createModule("base", {
    schema: { facts: { plain: t.string() } },
    init: (facts) => {
      facts.plain = "";
    },
  });
}

function laterModule() {
  return createModule("later", {
    schema: { facts: { ssn: t.string().meta({ tags: ["pii"] }) } },
    init: (facts) => {
      facts.ssn = "";
    },
  });
}

describe("the ledger learns about facts tagged after it attached", () => {
  it("redacts a pii fact from a module registered after start", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: baseModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    system.registerModule(laterModule());
    await flushTick();

    (system.facts as unknown as Record<string, unknown>).ssn = "123-45-6789";
    await flushTick();

    const entries = ledger.forFact("ssn");
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      if (e.kind === "fact.change") {
        expect(e.next).toBe("[redacted]");
        expect(JSON.stringify(e)).not.toContain("123-45-6789");
      }
    }

    system.stop();
  });

  it("does not stop redacting because one lookup failed", async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: laterModule(),
      plugins: [ledger.plugin],
    });
    system.start();
    await flushTick();

    // A metadata lookup that throws once. Before, the set was cleared before
    // the call, so the throw left it empty for the life of the system.
    const meta = system.meta as unknown as {
      carriesTag: (k: string, i: string, t: string) => boolean | undefined;
    };
    const real = meta.carriesTag.bind(meta);
    let thrown = false;
    meta.carriesTag = (k, i, tag) => {
      if (!thrown) {
        thrown = true;
        throw new Error("lookup blew up");
      }

      return real(k, i, tag);
    };

    system.facts.ssn = "111-22-3333";
    await flushTick();
    meta.carriesTag = real;
    system.facts.ssn = "444-55-6666";
    await flushTick();

    const raw = JSON.stringify(ledger.forFact("ssn"));
    expect(raw).not.toContain("444-55-6666");

    system.stop();
  });
});
