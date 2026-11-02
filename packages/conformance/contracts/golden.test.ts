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
  ENVELOPE,
  type Engine,
  FLAT,
  GOLDEN_PARTS,
  type GoldenChange,
  type GoldenPart,
  PART_NAMES,
  checkEnvelope,
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
/** The signed golden changes (contracts/STABILITY.md), checked on every call. */
const goldenChanges = JSON.parse(
  readFileSync(
    join(defaultRepoRoot, "packages/conformance/contracts/api-changes.json"),
    "utf8",
  ),
).goldenChanges as unknown[];
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
    expect(await checkGoldens(goldenDir, v1, local, goldenChanges)).toEqual([]);
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
    expect(
      await checkGoldens(goldenDir, v1, engine, goldenChanges, [part]),
    ).toEqual([]);
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
    `[${partLayer("persistence")}] the persistence golden: core-next saves 1.35.0's flat format, and 1.35.0 restores it as its own (skipped by layer while core-next is built below ${partLayer("persistence")})`,
    skip("persistence"),
    async () => {
      const pairs: [Engine, Engine][] = [
        [await loadEngine("v2"), v1],
        [await loadEngine("v2:dist"), v1],
        [await loadEngine("v2:dist", "production"), v1Prod],
      ];
      const failures: string[] = [];
      for (const [next, ref] of pairs) {
        failures.push(...(await checkEnvelope(next, ref, goldenChanges)));
      }
      expect(failures).toEqual([]);
    },
  );
});

/**
 * The `goldenChanges` mechanism itself, on the workspace engine drifted the
 * way an approved row drifts core-next and named "v2" (the engines a case
 * allows). An entry replaces 1.35.0's value for its case, direction and
 * engines only, with the value it records; nothing else passes.
 */
describe("goldenChanges: a signed entry covers one case, with its recorded value", () => {
  /** Reads a restored value as it is ((ai)): the module init writes nothing. */
  const keepsRestored = (): Engine => ({
    ...local,
    name: "v2",
    core: {
      ...local.core,
      createModule: (id: string, def: Record<string, unknown>) =>
        local.core.createModule(id, { ...def, init: () => {} }),
    },
  });
  /** Saves over the stored value, keeping its keys the save does not write ((ak)). */
  const keepsStoredKeys = (): Engine => ({
    ...local,
    name: "v2",
    plugins: {
      ...local.plugins,
      persistencePlugin: (options: { storage: Storage }) =>
        local.plugins.persistencePlugin({
          ...options,
          storage: {
            ...options.storage,
            getItem: (k: string) => options.storage.getItem(k),
            removeItem: (k: string) => options.storage.removeItem(k),
            setItem: (k: string, v: string) => {
              const next = JSON.parse(v);
              const prev = JSON.parse(options.storage.getItem(k) ?? "{}");
              const kept = Object.entries(prev).filter(
                ([key]) => !Object.hasOwn(next, key),
              );
              options.storage.setItem(
                k,
                JSON.stringify({ ...Object.fromEntries(kept), ...next }),
              );
            },
          },
        }),
    },
  });
  const READ = {
    count: 2,
    label: "middle",
    tags: ["a", { nested: [1, 2] }],
  };
  const entry = (over: Partial<GoldenChange> = {}): GoldenChange => ({
    case: "persistence read",
    direction: "read-1.35",
    engines: ["v2"],
    row: "(ai)",
    part: "persistence",
    expected2: READ,
    reason: "self-test fixture",
    approvedBy: "self-test",
    date: "2026-11-02",
    ...over,
  });
  const persistence = (engine: Engine, changes: unknown[]) =>
    checkGoldens(goldenDir, v1, engine, changes, ["persistence"]);
  const READ_FAILS = /the workspace reads 1\.35\.0's persistence differently/;

  it("a signed entry passes exactly its case, and removing it brings the failure back", async () => {
    const drifted = keepsRestored();
    expect((await persistence(drifted, [])).join("\n")).toMatch(READ_FAILS);
    expect(await persistence(drifted, [entry()])).toEqual([]);
    const without = [entry()].filter((c) => c.case !== "persistence read");
    expect((await persistence(drifted, without)).join("\n")).toMatch(
      READ_FAILS,
    );
  });

  it("an unsigned entry fails, and covers nothing", async () => {
    const out = (
      await persistence(keepsRestored(), [entry({ approvedBy: " " })])
    ).join("\n");
    expect(out).toMatch(/is unsigned/);
    expect(out).toMatch(READ_FAILS);
  });

  it("a signed entry with a different value fails", async () => {
    const out = await persistence(keepsRestored(), [
      entry({ expected2: { ...READ, count: 3 } }),
    ]);
    expect(out.join("\n")).toMatch(
      /reads 1\.35\.0's persistence differently, and not as the goldenChanges entry for persistence read \(read-1\.35, v2, \(ai\)\) records/,
    );
  });

  it("an entry covers only its own case, direction and engines", async () => {
    const drifted = keepsRestored();
    for (const other of [
      entry({ engines: ["v2:dist"] }),
      entry({ direction: "1.35-reads" }),
      entry({ case: "history read", part: "history" }),
    ]) {
      expect((await persistence(drifted, [other])).join("\n")).toMatch(
        READ_FAILS,
      );
    }
    // The other direction's entry finds 1.35.0's value there: stale.
    expect(
      (await persistence(drifted, [entry({ direction: "1.35-reads" })])).join(
        "\n",
      ),
    ).toMatch(/covers no difference/);
  });

  it("an entry on an engine that reads as 1.35.0 does is stale", async () => {
    const asV1: Engine = { ...local, name: "v2" };
    expect((await persistence(asV1, [entry()])).join("\n")).toMatch(
      /entry for persistence read \(read-1\.35, v2, \(ai\)\) covers no difference/,
    );
  });

  it("a malformed or overlapping entry fails, and covers nothing", async () => {
    const drifted = keepsRestored();
    const bad: [unknown[], RegExp][] = [
      [[entry({ case: "signed read" as never })], /names no golden case/],
      [[entry({ part: "history" })], /must have part "persistence"/],
      [
        [entry({ case: "U10 production", engines: ["v2"] })],
        /must list distinct engines its case runs/,
      ],
      [
        [entry({ case: "U10 rollback", direction: "read-1.35" })],
        /has a direction its case does not compare/,
      ],
      [[entry({ engines: [] })], /must list distinct engines/],
      [[entry({ row: "(ai)+(ak)" })], /must name one approved row/],
      [[entry({ date: "today" })], /needs a date/],
      [[entry({ reason: "" })], /needs a reason/],
      [[{ ...entry(), parts: "*" }], /has an unknown key parts/],
      [
        [
          Object.fromEntries(
            Object.entries(entry()).filter(([k]) => k !== "expected2"),
          ),
        ],
        /has no expected2/,
      ],
      [[entry(), entry()], /which goldenChanges\[0\] already covers/],
    ];
    for (const [changes, problem] of bad) {
      const out = (await persistence(drifted, changes)).join("\n");
      expect(out, String(problem)).toMatch(problem);
      if (changes.length === 1) {
        expect(out, String(problem)).toMatch(READ_FAILS);
      }
    }
  });

  it("U10: a signed entry covers its own case, and rollback stays strict", async () => {
    const drifted = keepsStoredKeys();
    const dev = (over: Partial<GoldenChange> = {}) =>
      entry({
        case: "U10 development",
        row: "(ak)",
        expected2: {
          restored: { n: 0 },
          saved: '{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}',
          logged: true,
        },
        ...over,
      });
    const DEV_FAILS = /v2 handles U10 development's stored data differently/;
    expect((await checkEnvelope(drifted, v1, [])).join("\n")).toMatch(
      DEV_FAILS,
    );
    expect(await checkEnvelope(drifted, v1, [dev()])).toEqual([]);
    expect(
      (await checkEnvelope(drifted, v1, [dev({ approvedBy: "" })])).join("\n"),
    ).toMatch(DEV_FAILS);
    expect(
      (
        await checkEnvelope(drifted, v1, [
          dev({ expected2: { restored: { n: 0 }, saved: "{}", logged: true } }),
        ])
      ).join("\n"),
    ).toMatch(/and not as the goldenChanges entry for U10 development/);
    expect(
      (await checkEnvelope(drifted, v1, [dev({ case: "U10 flat" })])).join(
        "\n",
      ),
    ).toMatch(DEV_FAILS);

    // A save 1.35.0 cannot restore fails the rollback, whatever read-1.35
    // entry covers the save itself.
    const unreadable: Engine = {
      ...local,
      name: "v2",
      plugins: {
        ...local.plugins,
        persistencePlugin: (options: { storage: Storage }) =>
          local.plugins.persistencePlugin({
            ...options,
            storage: {
              getItem: (k: string) => options.storage.getItem(k),
              removeItem: (k: string) => options.storage.removeItem(k),
              setItem: (k: string, v: string) =>
                options.storage.setItem(k, `[${v}]`),
            },
          }),
      },
    };
    const flatSave = await persistRun(unreadable, FLAT);
    const out = (
      await checkEnvelope(unreadable, v1, [
        entry({
          case: "U10 flat",
          row: "(ak)",
          expected2: {
            restored: flatSave.restored,
            saved: flatSave.saved,
            logged: flatSave.logged.length > 0,
          },
        }),
        dev({
          expected2: {
            ...(await (async () => {
              const r = await persistRun(unreadable, ENVELOPE);
              return {
                restored: r.restored,
                saved: r.saved,
                logged: r.logged.length > 0,
              };
            })()),
          },
        }),
      ])
    ).join("\n");
    expect(out).not.toMatch(/U10 flat|U10 development/);
    expect(out).toMatch(/1\.35\.0 restores v2's flat save differently/);
  });
});
