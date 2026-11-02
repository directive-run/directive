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
  persistenceWrite,
  producePart,
  readGoldens,
  readPart,
  restoreRun,
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

  it("1.35.0's persistence rollback read restores its own golden as the golden holds it, where the script's init would end at the init's values", async () => {
    const golden = readGoldens(goldenDir);
    const saved = golden["persistence-saved.golden"];
    expect(await restoreRun(v1, saved)).toEqual({
      restored: { count: 2, label: "middle", tags: ["a", { nested: [1, 2] }] },
      logged: false,
      saved,
    });
    // Through the script's init, 1.35.0 restores and then overwrites: the
    // read a rollback check cannot use.
    expect(await readPart(v1, golden, "persistence")).toEqual({
      count: 0,
      label: "start",
      tags: [],
    });
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
  const keepsStoredKeys = (base: Engine = local): Engine => ({
    ...base,
    name: "v2",
    plugins: {
      ...base.plugins,
      persistencePlugin: (options: { storage: Storage }) =>
        base.plugins.persistencePlugin({
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
    // The same engine reads the same recorded value both times: with the
    // entry it passes; without it, that very value fails against 1.35.0's.
    expect(await persistence(drifted, [entry()])).toEqual([]);
    expect(await persistence(drifted, [])).toEqual([
      `the workspace reads 1.35.0's persistence differently: ${JSON.stringify(READ)} vs ${JSON.stringify({ count: 0, label: "start", tags: [] })}`,
    ]);
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
        [entry({ case: "U10 flat rollback", direction: "read-1.35" })],
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

  /** Wraps every save in [ ], which 1.35.0 does not restore as its own. */
  const writesWrapped = (base: Engine = local): Engine => ({
    ...base,
    name: "v2",
    plugins: {
      ...base.plugins,
      persistencePlugin: (options: { storage: Storage }) =>
        base.plugins.persistencePlugin({
          ...options,
          storage: {
            getItem: (k: string) => options.storage.getItem(k),
            removeItem: (k: string) => options.storage.removeItem(k),
            setItem: (k: string, v: string) =>
              options.storage.setItem(k, `[${v}]`),
          },
        }),
    },
  });
  const DEV = { restored: {}, logged: true };
  const dev = (over: Partial<GoldenChange> = {}) =>
    entry({ case: "U10 development", row: "(ak)", expected2: DEV, ...over });
  const DEV_FAILS = /v2 handles U10 development's stored data differently/;
  const DEV_ROLLBACK_FAILS =
    /1\.35\.0 restores v2's save from U10 development's stored data differently from its own/;

  it("U10: a signed read-1.35 entry covers its own case, with its recorded value", async () => {
    // The init keeps what loaded, so an envelope 1.35.0 rejects leaves n unset.
    const drifted = keepsRestored();
    expect(await checkEnvelope(drifted, v1, [dev()])).toEqual([]);
    expect(await checkEnvelope(drifted, v1, [])).toEqual([
      `v2 handles U10 development's stored data differently from 1.35.0: ${JSON.stringify(DEV)} vs ${JSON.stringify({ restored: { n: 0 }, logged: true })}`,
    ]);
    expect(
      (await checkEnvelope(drifted, v1, [dev({ approvedBy: "" })])).join("\n"),
    ).toMatch(DEV_FAILS);
    expect(
      (
        await checkEnvelope(drifted, v1, [
          dev({ expected2: { restored: { n: 6 }, logged: true } }),
        ])
      ).join("\n"),
    ).toMatch(/and not as the goldenChanges entry for U10 development/);
    expect(
      (await checkEnvelope(drifted, v1, [dev({ case: "U10 flat" })])).join(
        "\n",
      ),
    ).toMatch(DEV_FAILS);
  });

  it("U10: 1.35.0 reads the save made from every stored value, and no read-1.35 entry relaxes it", async () => {
    // core-next's development save today ((ak)): the envelope's stale keys
    // stay beside n, and 1.35.0 then restores n as 0, not 1.
    const staleKeys = keepsStoredKeys();
    expect((await persistRun(staleKeys, ENVELOPE)).saved).toBe(
      '{"v":1,"schema":{"m":1},"facts":{"n":6},"n":1}',
    );
    expect((await checkEnvelope(staleKeys, v1, [])).join("\n")).toMatch(
      DEV_ROLLBACK_FAILS,
    );
    // The same save from an engine whose development read differs, with a
    // signed read-1.35 entry covering that read: the read passes, the
    // rollback still fails.
    const both = keepsStoredKeys(keepsRestored());
    const out = (await checkEnvelope(both, v1, [dev()])).join("\n");
    expect(out).not.toMatch(DEV_FAILS);
    expect(out).toMatch(DEV_ROLLBACK_FAILS);
    // Every stored value's save is read: a save 1.35.0 cannot restore fails
    // the flat and the development rollback.
    const wrapped = (await checkEnvelope(writesWrapped(), v1, [])).join("\n");
    expect(wrapped).toMatch(
      /1\.35\.0 restores v2's save from U10 flat's stored data differently/,
    );
    expect(wrapped).toMatch(DEV_ROLLBACK_FAILS);
    expect(wrapped).not.toMatch(/handles U10/);
  });

  /** Edits every save's JSON before it reaches storage. */
  const rewritesSave = (
    edit: (saved: Record<string, unknown>) => Record<string, unknown>,
    base: Engine = local,
  ): Engine => ({
    ...base,
    name: "v2",
    plugins: {
      ...base.plugins,
      persistencePlugin: (options: { storage: Storage }) =>
        base.plugins.persistencePlugin({
          ...options,
          storage: {
            getItem: (k: string) => options.storage.getItem(k),
            removeItem: (k: string) => options.storage.removeItem(k),
            setItem: (k: string, v: string) =>
              options.storage.setItem(k, JSON.stringify(edit(JSON.parse(v)))),
          },
        }),
    },
  });

  it("checkGoldens: 1.35.0 restores the workspace's persistence as it restores its own, whatever read-1.35 entry covers the read", async () => {
    const ROLLBACK_FAILS =
      /1\.35\.0 reads the workspace's persistence differently/;
    const RESAVE_FAILS =
      /1\.35\.0 reads what the workspace writes over 1\.35\.0's persistence differently from its own/;
    const edits: [
      string,
      (s: Record<string, unknown>) => Record<string, unknown>,
    ][] = [
      ["one value changed", (s) => ({ ...s, count: Number(s.count) + 1 })],
      [
        "one key dropped",
        (s) =>
          Object.fromEntries(Object.entries(s).filter(([k]) => k !== "label")),
      ],
      ["one stale key added", (s) => ({ ...s, stale: 1 })],
    ];
    for (const [what, changed] of edits) {
      // The workspace reads 1.35.0's data as 1.35.0 does; only its writes differ.
      const without = (await persistence(rewritesSave(changed), [])).join("\n");
      expect(without, what).not.toMatch(READ_FAILS);
      expect(without, what).toMatch(ROLLBACK_FAILS);
      expect(without, what).toMatch(RESAVE_FAILS);
      // Its read also differs, under a signed read-1.35 entry: the read
      // passes, both rollbacks still fail.
      const covered = (
        await persistence(rewritesSave(changed, keepsRestored()), [entry()])
      ).join("\n");
      expect(covered, what).not.toMatch(READ_FAILS);
      expect(covered, what).toMatch(ROLLBACK_FAILS);
      expect(covered, what).toMatch(RESAVE_FAILS);
    }
  });

  /** Edits each save, seeing what the plugin loaded (null from empty storage). */
  const editsSave = (
    edit: (saved: string, loaded: string | null) => string,
    base: Engine = local,
  ): Engine => ({
    ...base,
    name: "v2",
    plugins: {
      ...base.plugins,
      persistencePlugin: (options: { storage: Storage; key: string }) => {
        const loaded = options.storage.getItem(options.key);

        return base.plugins.persistencePlugin({
          ...options,
          storage: {
            getItem: (k: string) => options.storage.getItem(k),
            removeItem: (k: string) => options.storage.removeItem(k),
            setItem: (k: string, v: string) =>
              options.storage.setItem(k, edit(v, loaded)),
          },
        });
      },
    },
  });
  const dropLabel = (v: string) => {
    const { label: _, ...rest } = JSON.parse(v);

    return JSON.stringify(rest);
  };
  /** Drops label from a save made after a load and a change. */
  const dropsLabelAfterLoadChange = (base: Engine = local) =>
    editsSave(
      (v, loaded) => (loaded === null || v === loaded ? v : dropLabel(v)),
      base,
    );
  /** Drops label from a save made after a load, when the module has an init. */
  const dropsLabelWithInit = (base: Engine = local): Engine => {
    let init = false;
    const edited = editsSave(
      (v, loaded) => (loaded === null || !init ? v : dropLabel(v)),
      base,
    );

    return {
      ...edited,
      core: {
        ...edited.core,
        createModule: (id: string, def: Record<string, unknown>) => {
          init = typeof def.init === "function";

          return edited.core.createModule(id, def);
        },
      },
    };
  };
  const WRITE_FAILS =
    /1\.35\.0 reads the workspace's save after a load and a write differently from its own/;

  it("checkGoldens: 1.35.0 restores the workspace's save after a load and a write, whatever read-1.35 entry covers the read", async () => {
    const saved = readGoldens(goldenDir)["persistence-saved.golden"];
    // 1.35.0's own save after the write: the golden's values, count written.
    expect((await persistenceWrite(v1, local, saved)).ours).toEqual({
      restored: { count: 3, label: "middle", tags: ["a", { nested: [1, 2] }] },
      logged: false,
    });
    // An honest workspace passes: 1.x's order, and (ai)'s.
    expect(await persistence(local, [])).toEqual([]);
    expect(await persistence(keepsRestored(), [entry()])).toEqual([]);
    const standIns: [string, (base?: Engine) => Engine][] = [
      ["drops label after a load and a change", dropsLabelAfterLoadChange],
      ["drops label after a load, with an init", dropsLabelWithInit],
    ];
    for (const [what, standIn] of standIns) {
      // Only this case sees it, with no entry or under a signed read-1.35
      // entry covering the read.
      for (const out of [
        await persistence(standIn(), []),
        await persistence(standIn(keepsRestored()), [entry()]),
      ]) {
        expect(out.join("\n"), what).toMatch(WRITE_FAILS);
        expect(
          out.filter((f) => !WRITE_FAILS.test(f)),
          what,
        ).toEqual([]);
      }
    }
    // Each step is needed: with no write, the change-only drop saves what
    // 1.35.0 saves; with no init, the init-only drop does.
    const noWrite = await persistenceWrite(
      v1,
      dropsLabelAfterLoadChange(),
      saved,
      { init: true, write: false },
    );
    expect(noWrite.theirs).toEqual(noWrite.ours);
    const noInit = await persistenceWrite(v1, dropsLabelWithInit(), saved, {
      init: false,
      write: true,
    });
    expect(noInit.theirs).toEqual(noInit.ours);
  });

  it("checkGoldens: a 1.35.0 that restores its own persistence golden other than as the golden holds it fails", async () => {
    // Its load reads count as 9; with storage empty (the script) it writes
    // exactly the goldens, and through the script's init it reads alike.
    const misreads: Engine = {
      ...v1,
      plugins: {
        ...v1.plugins,
        persistencePlugin: (options: { storage: Storage }) =>
          v1.plugins.persistencePlugin({
            ...options,
            storage: {
              getItem: (k: string) => {
                const v = options.storage.getItem(k);

                return v === null
                  ? v
                  : JSON.stringify({ ...JSON.parse(v), count: 9 });
              },
              removeItem: (k: string) => options.storage.removeItem(k),
              setItem: (k: string, v: string) => options.storage.setItem(k, v),
            },
          }),
      },
    };
    const out = await checkGoldens(
      goldenDir,
      misreads,
      local,
      [],
      ["persistence"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(
      /^1\.35\.0 does not restore its own persistence golden as the golden holds it: \{"restored":\{"count":9,/,
    );
  });

  it("checkGoldens: 1.35.0 imports what the workspace exports over 1.35.0's history, whatever read-1.35 entry covers the read", async () => {
    // After an import, the export keeps only the first snapshot: a write
    // the read-1.35 "history read" value carries (exportedAgain).
    const reExportsOne = (): Engine => ({
      ...local,
      name: "v2",
      core: {
        ...local.core,
        createSystem: (options: unknown) => {
          const system = local.core.createSystem(options);
          let imported = false;
          const bind = (o: object, v: unknown) =>
            typeof v === "function" ? v.bind(o) : v;

          return new Proxy(system, {
            get(target, prop) {
              const value = Reflect.get(target, prop, target);
              if (prop !== "history" || !value) {
                return bind(target, value);
              }

              return new Proxy(value, {
                get(h, p) {
                  const v = Reflect.get(h, p, h);
                  if (p === "import") {
                    return (data: string) => {
                      imported = true;

                      return v.call(h, data);
                    };
                  }
                  if (p === "export" && imported) {
                    return () => {
                      const e = JSON.parse(v.call(h));

                      return JSON.stringify({
                        ...e,
                        snapshots: e.snapshots.slice(0, 1),
                        ...("currentIndex" in e ? { currentIndex: 0 } : {}),
                      });
                    };
                  }

                  return bind(h, v);
                },
              });
            },
            set: (target, prop, value) =>
              Reflect.set(target, prop, value, target),
          });
        },
      },
    });
    const drifted = reExportsOne();
    const history = (changes: unknown[]) =>
      checkGoldens(goldenDir, v1, drifted, changes, ["history"]);
    const READS = /the workspace reads 1\.35\.0's history differently/;
    const REEXPORT_FAILS =
      /1\.35\.0 reads what the workspace writes over 1\.35\.0's history differently from its own/;
    const without = (await history([])).join("\n");
    expect(without).toMatch(READS);
    expect(without).toMatch(REEXPORT_FAILS);
    const covered = (
      await history([
        entry({
          case: "history read",
          part: "history",
          expected2: await readPart(drifted, readGoldens(goldenDir), "history"),
        }),
      ])
    ).join("\n");
    expect(covered).not.toMatch(READS);
    expect(covered).toMatch(REEXPORT_FAILS);
  });
});
