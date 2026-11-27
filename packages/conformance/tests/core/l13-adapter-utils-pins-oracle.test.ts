// Ported from packages/core/src/core/__tests__/l13-adapter-utils-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { assertSystem } from "@directive-run/core/adapter-utils";
import { describe, expect, it } from "vitest";

// The L13 RFC's U12 (development): assertSystem throws for a missing system.
// The production half is l13-adapter-utils-pins-oracle-production.

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }

  return "did not throw";
}

describe("L13 probe pins: /adapter-utils assertSystem (development)", () => {
  it("U12: assertSystem throws for null and undefined, naming the hook and what it got", () => {
    expect(message(() => assertSystem("useFact", null))).toBe(
      "[Directive] useFact() requires a system instance as the first argument. Received null.",
    );
    expect(message(() => assertSystem("useSelector", undefined))).toBe(
      "[Directive] useSelector() requires a system instance as the first argument. Received undefined.",
    );
  });

  it("U12: assertSystem accepts anything else, including a falsy non-nullish value", () => {
    expect(() => assertSystem("h", {})).not.toThrow();
    expect(() => assertSystem("h", 0)).not.toThrow();
    expect(() => assertSystem("h", "")).not.toThrow();
    expect(() => assertSystem("h", false)).not.toThrow();
  });
});
