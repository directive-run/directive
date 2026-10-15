// Ported from packages/core/src/plugins/__tests__/docs-snippet-compiles.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createAuditLedger } from "@directive-run/core";
import { describe, expect, it } from "vitest";

/**
 * The snippet the audit-ledger page ships, compiled.
 *
 * The version this replaced did not compile: it called `.filter()` on the
 * result and read `entry.origin`, but `query()` returns the whole `AuditEntry`
 * union and a runtime `kind` filter narrows nothing at the type level. It was
 * published in both repos as the only example of the feature.
 */
describe("documented origin query", () => {
  it("compiles and selects in the sink", () => {
    const ledger = createAuditLedger();

    const rows = ledger.query({
      kind: "fact.change",
      factPath: "cartTotal",
      origin: "authored",
    });

    expect(Array.isArray(rows)).toBe(true);
    ledger.destroy();
  });
});
