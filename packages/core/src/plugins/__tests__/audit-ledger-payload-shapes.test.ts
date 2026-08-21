import { describe, expect, it } from "vitest";
import { stableStringify } from "../../utils/utils.js";
import { asRecorded } from "../audit-ledger/hash.js";

/**
 * Generated payload shapes, checked against the three properties the record
 * depends on.
 *
 * Four rounds of review found the same defect in this projection, each time
 * through a shape adjacent to the one the last fix was written against: a map
 * nested deeper than an object because it emits two levels per level walked; a
 * leaf with many primitive keys because the budget counted objects; a shared
 * reference graph because the cycle guard forgot; a top-level function because
 * the loop above it only looked at objects.
 *
 * Reviewing by hand found each one in under an hour and missed the next one
 * every time, so the shapes are generated here instead. The properties are
 * what the record actually promises — everything else about a payload is
 * negotiable.
 */

/** Deterministic, so a failure names a seed rather than a mood. */
function makeRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0x100000000;
  };
}

type Shape = { value: unknown; label: string };

function generate(random: () => number, depth = 0): Shape {
  const roll = random();
  if (depth > 12 || roll < 0.18) {
    const leaves: Shape[] = [
      { value: "s", label: "string" },
      { value: 42, label: "number" },
      { value: Number.NaN, label: "NaN" },
      { value: Number.POSITIVE_INFINITY, label: "Infinity" },
      { value: -0, label: "-0" },
      { value: true, label: "boolean" },
      { value: null, label: "null" },
      { value: undefined, label: "undefined" },
      { value: new Date(0), label: "Date" },
      { value: /ab+c/gi, label: "RegExp" },
      { value: 10n, label: "BigInt" },
      { value: () => "x", label: "function" },
      { value: Symbol("s"), label: "symbol" },
      { value: Object.create(null), label: "null-proto" },
    ];

    return leaves[Math.floor(random() * leaves.length)]!;
  }

  const child = () => generate(random, depth + 1);
  if (roll < 0.34) {
    const a = child();
    const b = child();

    return { value: [a.value, b.value], label: `[${a.label},${b.label}]` };
  }
  if (roll < 0.5) {
    const a = child();

    return { value: new Map([["k", a.value]]), label: `Map(${a.label})` };
  }
  if (roll < 0.62) {
    const a = child();

    return { value: new Set([a.value]), label: `Set(${a.label})` };
  }
  if (roll < 0.72) {
    // A shared, acyclic reference — reachable by two paths.
    const shared = child();

    return {
      value: { a: shared.value, b: shared.value },
      label: `shared(${shared.label})`,
    };
  }
  if (roll < 0.8) {
    // A wide leaf, which is how the node budget was escaped.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 400; i++) {
      wide[`k${i}`] = "v";
    }

    return { value: wide, label: "wide" };
  }
  if (roll < 0.86) {
    // A cycle.
    const cyclic: Record<string, unknown> = { self: null };
    cyclic.self = cyclic;

    return { value: cyclic, label: "cyclic" };
  }
  const a = child();
  const b = child();

  return {
    value: { a: a.value, b: b.value },
    label: `{${a.label},${b.label}}`,
  };
}

/**
 * The depth the canonical stringifier stops walking at. Anything an entry
 * holds below this is in the record and outside the hash.
 */
const STRINGIFIER_MAX_DEPTH = 50;

function deepestLevel(value: unknown, depth = 0, seen = new Set<object>()) {
  if (value === null || typeof value !== "object") return depth;
  if (seen.has(value)) return depth;
  seen.add(value);
  let deepest = depth;
  for (const item of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    deepest = Math.max(deepest, deepestLevel(item, depth + 1, seen));
  }
  seen.delete(value);

  return deepest;
}

describe("a projected payload, over generated shapes", () => {
  // Enough shapes that a whole class has to hold, not enough to make the suite
  // slow. Every defect the hand-written rounds found is generated within the
  // first few hundred.
  const seeds = Array.from({ length: 750 }, (_, i) => i + 1);

  it("records nothing the hash cannot reach", () => {
    for (const seed of seeds) {
      const shape = generate(makeRandom(seed));
      const projected = asRecorded(shape.value);
      const reached = deepestLevel(projected);
      expect(
        reached,
        `seed ${seed} (${shape.label}) recorded content at depth ${reached}`,
      ).toBeLessThanOrEqual(STRINGIFIER_MAX_DEPTH);
    }
  });

  it("hashes the same live as it does after an export", () => {
    for (const seed of seeds) {
      const shape = generate(makeRandom(seed));
      const projected = asRecorded(shape.value);
      // A value that projects to nothing is not recorded at all — the entry
      // drops the key — so there is no pair of hashes to compare.
      if (projected === undefined) continue;
      const live = stableStringify(projected);
      const roundTripped = stableStringify(
        JSON.parse(JSON.stringify(projected)),
      );
      expect(roundTripped, `seed ${seed} (${shape.label})`).toBe(live);
    }
  });

  it("produces a bounded amount from an unbounded input", () => {
    for (const seed of seeds) {
      const shape = generate(makeRandom(seed));
      const startedAt = Date.now();
      const projected = asRecorded(shape.value);
      const elapsed = Date.now() - startedAt;
      const size = (JSON.stringify(projected) ?? "").length;
      expect(
        elapsed,
        `seed ${seed} (${shape.label}) took ${elapsed}ms`,
      ).toBeLessThan(500);
      expect(
        size,
        `seed ${seed} (${shape.label}) produced ${size} bytes`,
      ).toBeLessThan(4_000_000);
    }
  });
});
