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

/**
 * Deterministic, so a failure names a seed rather than a mood.
 *
 * Warmed up before the first value is taken. Without it, the first output for
 * a small seed lands in a narrow band, so seven hundred and fifty seeds only
 * ever produced three of the eleven shapes — which is why properties that
 * looked thorough could not fail. A generator has to be checked for what it
 * actually generates, not for what its arms say it might.
 */
function makeRandom(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0x100000000;
  };
  next();
  next();
  next();

  return next;
}

type Shape = { value: unknown; label: string };

function generate(random: () => number, depth = 0): Shape {
  const roll = random();
  // Past the projection's own depth cap, so the shapes reach the line the
  // properties are about. Capped at twelve, the deepest thing generated
  // reached level twenty-one against a limit of fifty — the depth property
  // could not fail, and reverting the fix that put it there did not break a
  // single seed.
  if (depth > 70 || roll < 0.18) {
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
  if (roll < 0.72) {
    // Wide, past the node budget. At four hundred keys the budget was barely
    // reached, so the bounding property could not fail.
    const width = 400 + Math.floor(random() * 30_000);
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < width; i++) {
      wide[`k${i}`] = "v";
    }

    return { value: wide, label: `wide(${width})` };
  }
  if (roll < 0.76) {
    // Large and flat, in each collection shape. A million-element array is an
    // ordinary fact value.
    const size = 5_000 + Math.floor(random() * 50_000);
    const pick = random();
    if (pick < 0.35) {
      return {
        value: Array.from({ length: size }, (_, i) => i),
        label: `array(${size})`,
      };
    }
    if (pick < 0.6) {
      const sparse = new Array(size);
      sparse[0] = 1;
      sparse[size - 1] = 2;

      return { value: sparse, label: `sparse(${size})` };
    }
    if (pick < 0.8) {
      // Small and sparse, so the holes are the only thing under test rather
      // than the budget.
      const holes: unknown[] = [1];
      holes[4] = 2;
      holes[9] = 3;

      return { value: holes, label: "sparse(small)" };
    }

    return {
      value: new Map(Array.from({ length: size }, (_, i) => [`k${i}`, i])),
      label: `bigMap(${size})`,
    };
  }
  if (roll < 0.8) {
    // Keys that mean something to the language. `__proto__` reaches a setter
    // on the object prototype, so recording it by assignment dropped the value
    // — and anything parsed from external JSON can carry that key.
    const hostile: Record<string, unknown> = {};
    [
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "valueOf",
      "",
      "0",
      "length",
    ].forEach((key, index) => {
      Object.defineProperty(hostile, key, {
        // A distinct value per key, so one going missing is one fewer.
        value: `v${index}`,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });

    return { value: hostile, label: "hostile-keys" };
  }
  if (roll < 0.84) {
    // A spine of maps, which produce two levels for each one walked.
    let spine: unknown = { leaf: "deep" };
    const links = 20 + Math.floor(random() * 20);
    for (let i = 0; i < links; i++) {
      spine = new Map([["k", spine]]);
    }

    return { value: spine, label: `mapSpine(${links})` };
  }
  if (roll < 0.9) {
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

/** The budget the projection declares, mirrored so the bound can be asserted. */
const MAX_PROJECTED_NODES = 10_000;

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
    // Counted in values produced, against the budget the projection declares.
    // Asserted in bytes and milliseconds instead, this could not fail: the
    // widest shape generated came to a hundred kilobytes against a four
    // megabyte ceiling, so reverting the fix that bounds fan-out broke nothing.
    for (const seed of seeds) {
      const shape = generate(makeRandom(seed));
      const projected = asRecorded(shape.value);
      const produced = countRecorded(projected);
      expect(
        produced,
        `seed ${seed} (${shape.label}) produced ${produced} values`,
        // Twice the budget: each truncated collection ends with a marker, and
        // collections are themselves charged, so the markers cannot outnumber
        // the budget either. What matters is that the bound is a constant and
        // not a function of what was handed in.
      ).toBeLessThanOrEqual(MAX_PROJECTED_NODES * 2);
    }
  });

  it("keeps every value an export could have carried", () => {
    // The three properties above are all about what the projection produces
    // compared with itself, so total content loss satisfies all of them: an
    // empty object hashes the same live as exported, sits at no depth, and is
    // very well bounded.
    //
    // That is not hypothetical. A key of `__proto__` reaches a setter on the
    // object prototype, so recording it by assignment dropped the value and
    // two materially different payloads produced byte-identical entries that
    // verified clean. Nothing generated could have caught it, because nothing
    // asked whether anything went missing.
    for (const seed of seeds) {
      const shape = generate(makeRandom(seed));
      const projected = asRecorded(shape.value);
      const recorded = JSON.stringify(projected) ?? "";
      const expected = countExportable(shape.value);
      // `[too-large]` and `[max-depth]` are deliberate stops, and say so where
      // they stop, so a shape that reaches one is exempt from the count.
      if (
        recorded.includes("[too-large]") ||
        recorded.includes("[max-depth]")
      ) {
        continue;
      }
      const kept = countRecorded(projected);
      expect(
        kept,
        `seed ${seed} (${shape.label}) kept ${kept} of ${expected} values`,
      ).toBeGreaterThanOrEqual(expected);
    }
  });
});

/** How many values `JSON.stringify` would have carried out of this. */
function countExportable(value: unknown, seen = new Set<object>()): number {
  if (value === null) return 1;
  const type = typeof value;
  if (type === "function" || type === "symbol" || type === "undefined") {
    return 0;
  }
  if (type !== "object") return 1;
  const object = value as object;
  if (seen.has(object)) return 0;
  seen.add(object);
  try {
    if (object instanceof Date || object instanceof RegExp) return 1;
    if (object instanceof Map) {
      let total = 0;
      for (const [k, v] of object) {
        total += countExportable(k, seen) + countExportable(v, seen);
      }

      return total;
    }
    if (object instanceof Set) {
      let total = 0;
      for (const item of object) total += countExportable(item, seen);

      return total;
    }
    if (Array.isArray(object)) {
      let total = 0;
      for (let i = 0; i < object.length; i++) {
        total += countExportable(object[i], seen);
      }

      return total;
    }
    let total = 0;
    for (const item of Object.values(object as Record<string, unknown>)) {
      total += countExportable(item, seen);
    }

    return total;
  } finally {
    seen.delete(object);
  }
}

/** How many values the projection actually kept. */
function countRecorded(value: unknown, seen = new Set<object>()): number {
  if (value === null) return 1;
  if (typeof value !== "object") return 1;
  const object = value as object;
  if (seen.has(object)) return 0;
  seen.add(object);
  try {
    let total = 0;
    for (const item of Array.isArray(object)
      ? object
      : Object.values(object as Record<string, unknown>)) {
      total += countRecorded(item, seen);
    }

    return total;
  } finally {
    seen.delete(object);
  }
}
