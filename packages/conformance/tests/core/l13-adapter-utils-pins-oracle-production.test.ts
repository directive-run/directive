// Ported from packages/core/src/core/__tests__/l13-adapter-utils-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { assertSystem } = await import("@directive-run/core/adapter-utils");

// The production half of the L13 RFC's U12: assertSystem returns for a
// missing system, and says nothing.

describe("L13 probe pins: /adapter-utils assertSystem (production)", () => {
  it("U12: assertSystem returns for null and undefined", () => {
    expect(() => assertSystem("useFact", null)).not.toThrow();
    expect(() => assertSystem("useFact", undefined)).not.toThrow();
    expect(assertSystem("useFact", undefined)).toBeUndefined();
  });
});
