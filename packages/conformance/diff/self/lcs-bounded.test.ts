/**
 * `lcs` (diff/compare.ts) aligns each stream with a banded table sized by
 * Myers' edit distance, not the full rows x cols suffix table: a 72k-record
 * external stream (L12 gate, census-seed plugin case 13's first shrink) built
 * 5.3e9 cells and never finished. The band must give the SAME pairs as the
 * full table, ties included, with and without `text`, so the old table is
 * kept here as the reference and both run on many small traces with heavy
 * duplication, where ties are everywhere: as run, and with the band forced
 * (small streams that differ a lot take the old table itself).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALIGN_CELL_LIMIT, lcs } from "../compare.js";

/** The full-table `lcs` as it was before the band, verbatim. */
function referenceLcs(
  a: string[],
  b: string[],
  text?: [string[], string[]],
): [number, number][] {
  const n = a.length;
  const m = b.length;
  const sameText = (i: number, j: number) =>
    text === undefined || text[0][i] === text[1][j];
  let start = 0;
  while (
    start < n &&
    start < m &&
    a[start] === b[start] &&
    sameText(start, start)
  ) {
    start++;
  }
  let endA = n;
  let endB = m;
  while (
    endA > start &&
    endB > start &&
    a[endA - 1] === b[endB - 1] &&
    sameText(endA - 1, endB - 1)
  ) {
    endA--;
    endB--;
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) {
    pairs.push([i, i]);
  }
  const rows = endA - start;
  const cols = endB - start;
  if (rows > 0 && cols > 0) {
    const width = cols + 1;
    const unit = text === undefined ? 1 : Math.min(rows, cols) + 1;
    const score = (i: number, j: number) =>
      unit + (text !== undefined && sameText(start + i, start + j) ? 1 : 0);
    const table = new Uint32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        const skip = Math.max(
          table[(i + 1) * width + j] as number,
          table[i * width + j + 1] as number,
        );
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? Math.max(
                (table[(i + 1) * width + j + 1] as number) + score(i, j),
                skip,
              )
            : skip;
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (
        a[start + i] === b[start + j] &&
        table[i * width + j] ===
          (table[(i + 1) * width + j + 1] as number) + score(i, j)
      ) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (
        (table[(i + 1) * width + j] as number) >=
        (table[i * width + j + 1] as number)
      ) {
        i++;
      } else {
        j++;
      }
    }
  }
  for (let k = 0; k < n - endA; k++) {
    pairs.push([endA + k, endB + k]);
  }

  return pairs;
}

const RUNS = 4000;

/** A record: a key and a text, each from a tiny alphabet (heavy duplication). */
const record = (keys: number, texts: number) =>
  fc.tuple(
    fc.integer({ min: 0, max: keys - 1 }).map((k) => `k${k}`),
    fc.integer({ min: 0, max: texts - 1 }).map((t) => `t${t}`),
  );

/** Two independent streams. */
const independent = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 3 }))
  .chain(([keys, texts]) =>
    fc.tuple(
      fc.array(record(keys, texts), { maxLength: 24 }),
      fc.array(record(keys, texts), { maxLength: 24 }),
    ),
  );

/** One stream and a copy with a few records inserted, removed or retexted. */
const edited = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 3 }))
  .chain(([keys, texts]) =>
    fc.tuple(
      fc.array(record(keys, texts), { maxLength: 30 }),
      fc.array(
        fc.tuple(
          fc.constantFrom("insert", "remove", "retext"),
          fc.nat(),
          record(keys, texts),
        ),
        { maxLength: 6 },
      ),
    ),
  )
  .map(([base, edits]) => {
    const copy = [...base];
    for (const [op, at, rec] of edits) {
      const k = copy.length === 0 ? 0 : at % (copy.length + 1);
      if (op === "insert") {
        copy.splice(k, 0, rec);
      } else if (copy.length > 0) {
        const r = at % copy.length;
        if (op === "remove") {
          copy.splice(r, 1);
        } else {
          copy[r] = [(copy[r] as [string, string])[0], rec[1]];
        }
      }
    }
    return [base, copy] as const;
  });

const both = (
  a: ReadonlyArray<readonly [string, string]>,
  b: ReadonlyArray<readonly [string, string]>,
) => {
  const ka = a.map((r) => r[0]);
  const kb = b.map((r) => r[0]);
  const text: [string[], string[]] = [a.map((r) => r[1]), b.map((r) => r[1])];
  const keysOnly = referenceLcs(ka, kb);
  const withText = referenceLcs(ka, kb, text);
  // As run (small streams mostly take the full table) and with the band forced.
  expect(lcs(ka, kb)).toEqual(keysOnly);
  expect(lcs(ka, kb, text)).toEqual(withText);
  expect(lcs(ka, kb, undefined, true)).toEqual(keysOnly);
  expect(lcs(ka, kb, text, true)).toEqual(withText);
};

describe("lcs: the band gives the full table's pairs", () => {
  it("on independent small streams (keys only and with text)", () => {
    fc.assert(
      fc.property(independent, ([a, b]) => both(a, b)),
      { numRuns: RUNS, seed: 0x1c5 },
    );
  });

  it("on a stream and an edited copy (keys only and with text)", () => {
    fc.assert(
      fc.property(edited, ([a, b]) => both(a, b)),
      { numRuns: RUNS, seed: 0x1c6 },
    );
  });

  it("on edge shapes: empty, one-sided, all equal, all different", () => {
    const cases: Array<[string[], string[]]> = [
      [[], []],
      [["x"], []],
      [[], ["x"]],
      [
        ["x", "x", "x"],
        ["x", "x"],
      ],
      [
        ["x", "y"],
        ["y", "x"],
      ],
      [
        ["a", "b", "c"],
        ["d", "e"],
      ],
    ];
    for (const [a, b] of cases) {
      expect(lcs(a, b)).toEqual(referenceLcs(a, b));
      const ta = a.map((_, i) => `t${i % 2}`);
      const tb = b.map((_, i) => `t${(i + 1) % 2}`);
      expect(lcs(a, b, [ta, tb])).toEqual(referenceLcs(a, b, [ta, tb]));
      expect(lcs(a, b, undefined, true)).toEqual(referenceLcs(a, b));
      expect(lcs(a, b, [ta, tb], true)).toEqual(referenceLcs(a, b, [ta, tb]));
    }
  });
});

describe("lcs: bounded on large mostly-equal streams", () => {
  it("aligns 72k x 74k records with repeated keys in seconds", () => {
    // The shape of the L12 hang: a short common prefix, then streams of a
    // few repeated keys that differ by about 1,500 inserted records.
    const keys = [
      "log\u00000\u0000a",
      "log\u00001\u0000a",
      "log\u00001\u0000b",
    ];
    const a: string[] = ["head"];
    const b: string[] = ["head", "extra"];
    for (let i = 0; i < 72_000; i++) {
      const key = keys[(i * 7) % 3] as string;
      a.push(key);
      b.push(key);
      if (i % 48 === 0) {
        b.push(keys[i % 3] as string);
      }
    }
    const t0 = performance.now();
    const pairs = lcs(a, b);
    const ms = performance.now() - t0;
    expect(pairs.length).toBe(a.length);
    expect(ms).toBeLessThan(20_000);
  });

  it("throws past the cell limit instead of running on", () => {
    // All-different streams: D = rows + cols, so rows x (D + 1) passes the
    // limit, and the Myers pass stops at the limit's distance.
    const rows = 200_000;
    const a = Array.from({ length: rows }, (_, i) => `a${i}`);
    const b = Array.from({ length: rows }, (_, i) => `b${i}`);
    expect(rows * (2 * rows + 1)).toBeGreaterThan(ALIGN_CELL_LIMIT);
    expect(() => lcs(a, b)).toThrow(/cells/);
  });
});
