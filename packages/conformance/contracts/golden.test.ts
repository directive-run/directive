/**
 * Golden files written by 1.35.0: the workspace reads them as 1.35.0 does
 * and writes the same bytes, and 1.35.0 reads what the workspace writes.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultRepoRoot } from "../lib/core-entries.js";
import {
  type Engine,
  GOLDEN_PARTS,
  type GoldenPart,
  PART_NAMES,
  checkGoldens,
  loadEngine,
  partLayer,
  partRuns,
  persistRun,
  producePart,
  readGoldens,
  same,
  scriptFacts,
} from "./lib/golden.js";

const goldenDir = join(
  defaultRepoRoot,
  "packages/conformance/contracts/golden",
);
/** The highest layer core-next has built: the v2 parts above it skip. */
const current = JSON.parse(
  readFileSync(
    join(defaultRepoRoot, "packages/conformance/layers.rules.json"),
    "utf8",
  ),
).current as string | null;
let v1: Engine;
let v1Prod: Engine;
let local: Engine;
let scratch: string;

beforeAll(async () => {
  v1 = await loadEngine("v1");
  v1Prod = await loadEngine("v1", "production");
  local = await loadEngine("local");
  scratch = mkdtempSync(join(tmpdir(), "contracts-golden-"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("golden files", () => {
  it("are 1.35.0's, and round-trip between 1.35.0 and the workspace", async () => {
    expect(await checkGoldens(goldenDir, v1, local)).toEqual([]);
  });

  it("a changed byte in any golden fails the check", async () => {
    const dir = join(scratch, "bytes");
    cpSync(goldenDir, dir, { recursive: true });
    const edit = (file: string, from: string, to: string) => {
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
    };
    edit("history-export.golden", '"currentIndex":', '"currentIndex": ');
    edit("persistence-saved.golden", '"count":2', '"count":3');
    edit("signed-snapshot.golden", '"signature":"a', '"signature":"b');
    edit("audit-ledger.golden", '"seq":1,', '"seq":7,');
    const failures = await checkGoldens(dir, v1, local);
    for (const f of [
      "history-export.golden",
      "persistence-saved.golden",
      "signed-snapshot.golden",
      "audit-ledger.golden",
    ]) {
      expect(failures).toContain(`golden ${f} is not what 1.35.0 writes`);
    }
  });

  it("an engine that reads a golden differently fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: { ...local.core, verifySnapshotSignature: async () => false },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures.join("\n")).toMatch(
      /the workspace reads 1\.35\.0's signed differently/,
    );
  });

  it("an engine that writes a golden differently fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: {
        ...local.core,
        signSnapshot: async (s: object, secret: string) => ({
          ...(await local.core.signSnapshot(s, secret)),
          algorithm: "hmac-sha512",
        }),
      },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures).toContain(
      "the workspace writes a different signed-snapshot.golden than 1.35.0",
    );
    expect(failures.join("\n")).toMatch(
      /1\.35\.0 reads the workspace's signed differently/,
    );
  });

  it("an engine that accepts tampered or expired signatures fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: { ...local.core, verifySnapshotSignature: async () => true },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures.join("\n")).toMatch(
      /the workspace reads 1\.35\.0's signed differently/,
    );
  });

  it("an engine whose audit verify accepts a tampered chain fails the check", async () => {
    const drifted: Engine = {
      ...local,
      core: {
        ...local.core,
        createAuditLedger: (...args: unknown[]) => {
          const ledger = local.core.createAuditLedger(...args);

          return { ...ledger, verify: () => ({ valid: true }) };
        },
      },
    };
    const failures = await checkGoldens(goldenDir, v1, drifted);
    expect(failures.join("\n")).toMatch(
      /the workspace reads 1\.35\.0's ledger differently/,
    );
  });

  it("same() tells Date, Map and Set apart where JSON cannot", () => {
    expect(same(new Date(1), new Date(2))).toBe(false);
    expect(same(new Date(1), new Date(1))).toBe(true);
    expect(same(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(same(new Map([["a", 1]]), {})).toBe(false);
    expect(same(new Set([1]), new Set([2]))).toBe(false);
    expect(same(new Set([1]), new Set([1]))).toBe(true);
    expect(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(same({ a: undefined }, {})).toBe(false);
  });
});

describe("golden parts, one at a time", () => {
  it("each part's layer is the highest of its features in lib/layers.ts", () => {
    expect(
      Object.fromEntries(PART_NAMES.map((p) => [p, partLayer(p)])),
    ).toEqual({
      history: "L8",
      persistence: "L6",
      signed: "L12",
      ledger: "L12",
    });
  });

  it("each part alone writes, on 1.35.0, exactly the bytes of the full script", async () => {
    const golden = readGoldens(goldenDir);
    for (const part of PART_NAMES) {
      expect(await producePart(v1, part), part).toBe(
        golden[GOLDEN_PARTS[part].file],
      );
    }
  });

  it("a check of some parts still fails a drift in them, and only in them", async () => {
    const drifted: Engine = {
      ...local,
      core: { ...local.core, verifySnapshotSignature: async () => false },
    };
    expect(
      (await checkGoldens(goldenDir, v1, drifted, [], ["signed"])).join("\n"),
    ).toMatch(/the workspace reads 1\.35\.0's signed differently/);
    expect(
      await checkGoldens(goldenDir, v1, drifted, [], ["persistence"]),
    ).toEqual([]);
  });
});

/**
 * core-next, from source (as `conformance:v2` aliases it) and from its built
 * dist (as `conformance:v2:dist` does). Each part runs once core-next is built
 * to its layer (layers.rules.json `current`) and is skipped until then. The
 * title names the layer, `[Ln]`, and the census holds it to that: skipped
 * exactly while Ln is above `current`, passing from then on.
 */
const gated = (part: GoldenPart, target: string) =>
  `[${partLayer(part)}] ${target}: the ${part} golden round-trips with 1.35.0 (skipped by layer while core-next is built below ${partLayer(part)})`;
const skip = (part: GoldenPart) => ({ skip: !partRuns(part, current) });

describe("golden files on core-next", () => {
  let next: Engine;
  let nextDist: Engine;
  beforeAll(async () => {
    next = await loadEngine("v2");
    nextDist = await loadEngine("v2:dist");
  });
  const roundTrip = async (engine: Engine, part: GoldenPart) => {
    expect(await checkGoldens(goldenDir, v1, engine, [], [part])).toEqual([]);
  };

  it("v2 and v2:dist load core-next, not 1.x", () => {
    expect(next.files?.core).toMatch(/\/packages\/core-next\/src\/index\.ts$/);
    expect(nextDist.files?.core).toMatch(/\/packages\/core-next\/dist\//);
    for (const engine of [next, nextDist]) {
      expect(engine.core.createSystem, engine.name).toBeTypeOf("function");
      expect(engine.core.createSystem).not.toBe(local.core.createSystem);
      expect(engine.core.createSystem).not.toBe(v1.core.createSystem);
      // An entry core-next has not built is its unbuilt stub, and says so.
      expect(engine.unbuilt?.includes("plugins"), engine.name).toBe(
        engine.plugins.UNBUILT === true,
      );
    }
  });

  it("[L0] the script's writes land on core-next as on 1.35.0", async () => {
    const expected = await scriptFacts(v1);
    expect(await scriptFacts(next)).toEqual(expected);
    expect(await scriptFacts(nextDist)).toEqual(expected);
  });

  it(gated("history", "v2"), skip("history"), () => roundTrip(next, "history"));
  it(gated("persistence", "v2"), skip("persistence"), () =>
    roundTrip(next, "persistence"),
  );
  it(gated("signed", "v2"), skip("signed"), () => roundTrip(next, "signed"));
  it(gated("ledger", "v2"), skip("ledger"), () => roundTrip(next, "ledger"));
  it(gated("history", "v2:dist"), skip("history"), () =>
    roundTrip(nextDist, "history"),
  );
  it(gated("persistence", "v2:dist"), skip("persistence"), () =>
    roundTrip(nextDist, "persistence"),
  );
  it(gated("signed", "v2:dist"), skip("signed"), () =>
    roundTrip(nextDist, "signed"),
  );
  it(gated("ledger", "v2:dist"), skip("ledger"), () =>
    roundTrip(nextDist, "ledger"),
  );
});

/**
 * U10 (core-next/docs/rfc-l6-snapshots.md, R8 and A4): what 1.35.0 makes of a
 * saved-state envelope `{ v, schema, facts }` written where its persistence
 * plugin reads, and what its next save leaves there. A4 keeps 1.35.0's flat
 * format at the alpha, so 1.35.0 must keep reading what the alpha writes:
 * these pins make any change to the format a deliberate one.
 */
describe("a saved-state envelope (U10)", () => {
  const ENVELOPE = JSON.stringify({ v: 1, schema: { m: 1 }, facts: { n: 6 } });
  const FLAT = JSON.stringify({ n: 6 });

  it("1.35.0 development: an envelope does not load, and the next save overwrites it", async () => {
    const run = await persistRun(v1, ENVELOPE);
    expect(run.restored).toEqual({ n: 0 });
    expect(run.saved).toBe('{"n":1}');
    expect(run.logged.join("\n")).toMatch(/Plugin error/);
  });

  it("1.35.0 production: an envelope loads v, schema and facts as facts, and the next save merges into it", async () => {
    const run = await persistRun(v1Prod, ENVELOPE);
    expect(run.restored).toEqual({
      v: 1,
      schema: { m: 1 },
      facts: { n: 6 },
      n: 0,
    });
    expect(run.saved).toBe('{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}');
    expect(run.logged).toEqual([]);
  });

  it("1.35.0 restores today's flat format, the one the alpha keeps, in both modes", async () => {
    for (const engine of [v1, v1Prod]) {
      const run = await persistRun(engine, FLAT);
      expect(run, engine.name).toEqual({
        restored: { n: 6 },
        saved: '{"n":1}',
        logged: [],
      });
    }
  });

  it(
    "[L6] core-next saves 1.35.0's flat format, and 1.35.0 restores it as its own (skipped by layer while core-next is built below L6)",
    skip("persistence"),
    async () => {
      const pairs: [Engine, Engine][] = [
        [await loadEngine("v2"), v1],
        [await loadEngine("v2:dist"), v1],
        [await loadEngine("v2:dist", "production"), v1Prod],
      ];
      for (const [next, ref] of pairs) {
        for (const stored of [FLAT, ENVELOPE]) {
          const wrote = await persistRun(next, stored);
          const expected = await persistRun(ref, stored);
          expect(wrote.restored, next.name).toEqual(expected.restored);
          expect(wrote.saved, next.name).toBe(expected.saved);
          expect(wrote.logged.length > 0, next.name).toBe(
            expected.logged.length > 0,
          );
        }
        const back = await persistRun(
          ref,
          (await persistRun(next, FLAT)).saved ?? "",
        );
        expect(back.restored, next.name).toEqual({ n: 1 });
      }
    },
  );
});
