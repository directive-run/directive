/**
 * Golden files: what 1.35 writes that something else reads later — a history
 * export, a persistence plugin's saved data, a signed snapshot, an audit
 * ledger's hash chain. Data written by one release and read by another, so
 * 2.0 must keep reading what 1.35 wrote, and 1.35 must still read what the
 * workspace writes.
 *
 * `produce(engine)` runs one fixed script and returns the four artifacts as
 * text. `contracts/scripts/golden.ts` writes them from 1.35.0
 * (`directive-v1`) into `contracts/golden/`; `checkGoldens` proves, in both
 * directions, that the engines still agree about them.
 *
 * The clock is pinned to one constant while a script runs, so the number of
 * times an engine reads it cannot change what it writes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CoreEntry,
  coreEntries,
  v1Entries,
  v2DistEntries,
  v2Entries,
} from "../../lib/core-entries.js";
import {
  type Layer,
  type NamedFeature,
  layerIndex,
  layerOfFeature,
} from "../../lib/layers.js";

/**
 * The artifacts' exact bytes, as an engine hands them to storage. Not `.json`,
 * so no formatter ever rewrites them.
 */
export const GOLDEN_FILES = [
  "history-export.golden",
  "persistence-saved.golden",
  "signed-snapshot.golden",
  "audit-ledger.golden",
] as const;

export type GoldenName = (typeof GOLDEN_FILES)[number];
export type Goldens = Record<GoldenName, string>;

/**
 * The engines a golden check can load:
 * - `v1`: the published 1.35.0 (`directive-v1`), the reference;
 * - `local`: the workspace's core source (1.36);
 * - `v2`: core-next's source, the files the `conformance:v2` project aliases
 *   (lib/core-entries.ts v2Entries);
 * - `v2:dist`: core-next's built `dist/`, as `conformance:v2:dist` aliases it
 *   (v2DistEntries).
 * An entry core-next has not built resolves to `src/unbuilt.ts`, as in those
 * projects, and is listed in `unbuilt`.
 */
export type EngineName = "v1" | "local" | "v2" | "v2:dist";

/** The two entry modules a script needs, from one engine. */
export interface Engine {
  name: string;
  /** Loaded by file, so typed loosely on purpose. */
  core: any;
  plugins: any;
  /** The file each entry was loaded from. */
  files?: { core: string; plugins: string };
  /** Entries the engine has not built (core-next's `src/unbuilt.ts`). */
  unbuilt?: string[];
}

export const FIXED_NOW = 1_760_000_000_000;
export const SECRET = "directive-contracts-golden-secret";

function engineEntries(
  name: EngineName,
  build: "development" | "production",
): CoreEntry[] {
  if (name === "v1") {
    return v1Entries(build);
  }
  if (name === "v2:dist") {
    return v2DistEntries(undefined, build);
  }
  // Source engines read the dev flag through `#is-development`, which only a
  // test's mock can flip; there is no production file to load.
  if (build === "production") {
    throw new Error(
      `${name} is loaded from source and has no production build; use v1 or v2:dist`,
    );
  }

  return name === "v2" ? v2Entries() : coreEntries();
}

export async function loadEngine(
  name: EngineName,
  build: "development" | "production" = "development",
): Promise<Engine> {
  const entries = engineEntries(name, build);
  const file = (subpath: string) => {
    const entry = entries.find((e) => e.subpath === subpath);
    if (!entry) {
      throw new Error(`${name} has no ${subpath} entry`);
    }

    return entry.file;
  };
  const files = { core: file("."), plugins: file("./plugins") };

  return {
    name: build === "production" ? `${name}:prod` : name,
    core: await import(pathToFileURL(files.core).href),
    plugins: await import(pathToFileURL(files.plugins).href),
    files,
    unbuilt: Object.entries(files)
      .filter(([, f]) => f.endsWith("/unbuilt.ts"))
      .map(([entry]) => entry),
  };
}

/**
 * The four parts a golden check compares, each with its file and the
 * features its script and its read use, named as lib/layers.ts names them.
 * A part's layer is the highest of its features' layers (`partLayer`), so an
 * engine built to some layer runs exactly the parts at or below it.
 */
export const GOLDEN_PARTS = {
  history: {
    file: "history-export.golden",
    uses: [{ option: "history" }, { member: "history" }],
  },
  persistence: {
    file: "persistence-saved.golden",
    uses: [{ option: "plugins" }, { module: "plugins/persistence" }],
  },
  signed: {
    file: "signed-snapshot.golden",
    uses: [
      { member: "getDistributableSnapshot" },
      { name: "signSnapshot" },
      { name: "verifySnapshotSignature" },
    ],
  },
  ledger: {
    file: "audit-ledger.golden",
    // The chain records what the whole script does (the history's snapshots,
    // the persistence plugin's writes), so this part is the full script.
    uses: [
      { option: "history" },
      { option: "plugins" },
      { module: "plugins/persistence" },
      { module: "plugins/audit-ledger/index" },
      { module: "plugins/audit-ledger/sink" },
    ],
  },
} as const satisfies Record<
  string,
  { file: GoldenName; uses: readonly NamedFeature[] }
>;

export type GoldenPart = keyof typeof GOLDEN_PARTS;
export const PART_NAMES = Object.keys(GOLDEN_PARTS) as GoldenPart[];

/** The layer a part needs: the highest layer among the features it uses. */
export function partLayer(part: GoldenPart): Layer {
  return GOLDEN_PARTS[part].uses
    .map((f) => layerOfFeature(f))
    .reduce((a, b) => (layerIndex(b) > layerIndex(a) ? b : a), "L0");
}

/** Whether an engine built up to `current` runs `part`; null runs nothing. */
export function partRuns(part: GoldenPart, current: string | null): boolean {
  return (
    current !== null &&
    layerIndex(partLayer(part)) <= layerIndex(current as Layer)
  );
}

async function withFixedClock<T>(fn: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

async function atTime<T>(now: number, fn: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => now;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

function counterModule(engine: Engine) {
  const { createModule, t } = engine.core;

  return createModule("counter", {
    schema: {
      facts: { count: t.number(), label: t.string(), tags: t.array() },
      derivations: { doubled: t.number() },
      events: {},
      requirements: {},
    },
    init: (facts: Record<string, unknown>) => {
      facts.count = 0;
      facts.label = "start";
      facts.tags = [];
    },
    derive: {
      doubled: (facts: { count: number }) => facts.count * 2,
    },
  });
}

/** The script: the same writes on every engine. */
async function writeSome(system: any): Promise<void> {
  system.facts.count = 1;
  await system.settle();
  system.facts.label = "middle";
  system.facts.tags = ["a", { nested: [1, 2] }];
  await system.settle();
  system.facts.count = 2;
  await system.settle();
}

/** Run the script on `engine` and return what it wrote. */
export async function produce(engine: Engine): Promise<Goldens> {
  return withFixedClock(async () => {
    const storage = memoryStorage();
    const ledger = engine.core.createAuditLedger();
    const system = engine.core.createSystem({
      module: counterModule(engine),
      history: { maxSnapshots: 50 },
      plugins: [
        engine.plugins.persistencePlugin({
          storage,
          key: "golden",
          debounce: 0,
        }),
        ledger.plugin,
      ],
    });
    system.start();
    await writeSome(system);
    await new Promise((r) => setTimeout(r, 5));

    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["doubled"],
      includeFacts: ["count", "label"],
      ttlSeconds: 3600,
      metadata: { purpose: "golden" },
    });
    const signed = await engine.core.signSnapshot(snapshot, SECRET);
    const history: string = system.history.export();
    const saved = storage.getItem("golden") ?? "";
    const entries = ledger.toJSON().entries;
    system.destroy();

    return {
      "history-export.golden": history,
      "persistence-saved.golden": saved,
      "signed-snapshot.golden": JSON.stringify(signed),
      "audit-ledger.golden": JSON.stringify(entries),
    };
  });
}

/**
 * One part of the script, on a system with only what that part needs, and
 * the same writes (the ledger's part is the full script, see GOLDEN_PARTS). On 1.35.0 each part alone writes exactly its bytes in the
 * full script (golden.test.ts proves it), so an engine built below the full
 * ladder is checked on the parts it has.
 */
export async function producePart(
  engine: Engine,
  part: GoldenPart,
): Promise<string> {
  if (part === "ledger") {
    return (await produce(engine))["audit-ledger.golden"];
  }

  return withFixedClock(async () => {
    const storage = memoryStorage();
    const plugins =
      part === "persistence"
        ? [
            engine.plugins.persistencePlugin({
              storage,
              key: "golden",
              debounce: 0,
            }),
          ]
        : undefined;
    const system = engine.core.createSystem({
      module: counterModule(engine),
      ...(part === "history" ? { history: { maxSnapshots: 50 } } : {}),
      ...(plugins ? { plugins } : {}),
    });
    system.start();
    await writeSome(system);
    await new Promise((r) => setTimeout(r, 5));
    let out: string;
    if (part === "signed") {
      const snapshot = system.getDistributableSnapshot({
        includeDerivations: ["doubled"],
        includeFacts: ["count", "label"],
        ttlSeconds: 3600,
        metadata: { purpose: "golden" },
      });
      out = JSON.stringify(await engine.core.signSnapshot(snapshot, SECRET));
    } else if (part === "history") {
      out = system.history.export();
    } else {
      out = storage.getItem("golden") ?? "";
    }
    system.destroy();

    return out;
  });
}

/** The script's goldens for `parts`: the full script when every part is asked for. */
async function produceParts(
  engine: Engine,
  parts: readonly GoldenPart[],
): Promise<Partial<Goldens>> {
  if (PART_NAMES.every((p) => parts.includes(p))) {
    return produce(engine);
  }
  const out: Partial<Goldens> = {};
  for (const part of parts) {
    out[GOLDEN_PARTS[part].file] = await producePart(engine, part);
  }

  return out;
}

/**
 * The golden script's facts after its writes, on a bare system: the one step
 * every part shares, and the only one that needs nothing above L0.
 */
export async function scriptFacts(
  engine: Engine,
): Promise<Record<string, unknown>> {
  return withFixedClock(async () => {
    const system = engine.core.createSystem({ module: counterModule(engine) });
    system.start();
    await writeSome(system);
    const out = {
      count: system.facts.count,
      label: system.facts.label,
      tags: JSON.parse(JSON.stringify(system.facts.tags)),
      doubled: system.derive.doubled,
    };
    system.destroy();

    return out;
  });
}

/**
 * What `reader` makes of one part some engine wrote. For history and
 * persistence, `wrote` receives what the reader itself writes over that data
 * (its export after the import; what storage holds after it restored and was
 * destroyed), for a rollback check.
 */
export async function readPart(
  reader: Engine,
  goldens: Partial<Goldens>,
  part: GoldenPart,
  wrote?: (bytes: string) => void,
): Promise<unknown> {
  return withFixedClock(async () => {
    if (part === "history") {
      // History export: imported, the system is at the exported snapshot.
      const history = reader.core.createSystem({
        module: counterModule(reader),
        history: { maxSnapshots: 50 },
      });
      history.start();
      history.history.import(goldens["history-export.golden"]);
      await history.settle();
      const exported = history.history.export();
      wrote?.(exported);
      const out = {
        count: history.facts.count,
        label: history.facts.label,
        tags: history.facts.tags,
        currentIndex: history.history.currentIndex,
        exportedAgain: JSON.parse(exported),
      };
      history.destroy();

      return out;
    }

    if (part === "persistence") {
      // Persistence: a system started on the saved data restores it.
      const storage = memoryStorage({
        golden: goldens["persistence-saved.golden"] as string,
      });
      const restored = reader.core.createSystem({
        module: counterModule(reader),
        plugins: [
          reader.plugins.persistencePlugin({
            storage,
            key: "golden",
            debounce: 0,
          }),
        ],
      });
      restored.start();
      await restored.settle();
      const out = {
        count: restored.facts.count,
        label: restored.facts.label,
        tags: restored.facts.tags,
      };
      restored.destroy();
      wrote?.(storage.getItem("golden") ?? "");

      return out;
    }

    if (part === "signed") {
      // Signed snapshot: verifies with the secret, fails with another.
      const signed = JSON.parse(goldens["signed-snapshot.golden"] as string);

      return {
        valid: await reader.core.verifySnapshotSignature(signed, SECRET, {
          ignoreExpiry: true,
        }),
        wrongSecret: await reader.core.verifySnapshotSignature(
          signed,
          "other",
          { ignoreExpiry: true },
        ),
        // Reads that must FAIL: a changed data value, a changed signature
        // byte, and (clock past expiresAt, ignoreExpiry unset) an expired
        // signature.
        changedData: await reader.core.verifySnapshotSignature(
          { ...signed, data: { ...signed.data, count: signed.data.count + 1 } },
          SECRET,
          { ignoreExpiry: true },
        ),
        changedSignature: await reader.core.verifySnapshotSignature(
          {
            ...signed,
            signature: `${signed.signature[0] === "a" ? "b" : "a"}${signed.signature.slice(1)}`,
          },
          SECRET,
          { ignoreExpiry: true },
        ),
        freshWithoutIgnoreExpiry: await reader.core.verifySnapshotSignature(
          signed,
          SECRET,
        ),
        expired: await atTime(signed.expiresAt + 1000, () =>
          reader.core.verifySnapshotSignature(signed, SECRET),
        ),
      };
    }

    // Audit ledger: the chain verifies, and a ledger resumed from it keeps
    // the chain going.
    const entries = JSON.parse(goldens["audit-ledger.golden"] as string);
    const tampered = reader.core.memorySink();
    entries.forEach((entry: any, i: number) => {
      tampered.write(i === 1 ? { ...entry, next: "tampered" } : entry);
    });
    const tamperedVerify = reader.core
      .createAuditLedger({ sink: tampered })
      .verify();
    const sink = reader.core.memorySink();
    for (const entry of entries) {
      sink.write(entry);
    }
    const ledger = reader.core.createAuditLedger({ sink });
    const before = ledger.verify();
    const system = reader.core.createSystem({
      module: counterModule(reader),
      plugins: [ledger.plugin],
    });
    system.start();
    system.facts.count = 99;
    await system.settle();
    system.destroy();

    return { before, after: ledger.verify(), tampered: tamperedVerify };
  });
}

/**
 * What `reader` makes of artifacts some engine wrote, part by part; `wrote`
 * collects what it writes over them (`readPart`).
 */
async function read(
  reader: Engine,
  goldens: Partial<Goldens>,
  parts: readonly GoldenPart[] = PART_NAMES,
  wrote: Partial<Record<GoldenPart, string>> = {},
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    out[part] = await readPart(reader, goldens, part, (bytes) => {
      wrote[part] = bytes;
    });
  }

  return out;
}

export function readGoldens(dir: string): Goldens {
  return Object.fromEntries(
    GOLDEN_FILES.map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  ) as Goldens;
}

/** Deep equality that keeps Date, Map and Set distinct (JSON.stringify does not). */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return false;
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    return false;
  }
  if (a instanceof Date) {
    return a.getTime() === (b as Date).getTime();
  }
  if (a instanceof Map) {
    const mb = b as Map<unknown, unknown>;

    return (
      a.size === mb.size &&
      [...a].every(([k, v]) => mb.has(k) && same(v, mb.get(k)))
    );
  }
  if (a instanceof Set) {
    const sb = b as Set<unknown>;

    return a.size === sb.size && [...a].every((v) => sb.has(v));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);

  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b, k) &&
        same(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

/** Goldens whose exact bytes are signed or hashed: any byte change breaks verification. */
export const BYTE_IDENTICAL: readonly GoldenName[] = [
  "signed-snapshot.golden",
  "audit-ledger.golden",
];

/**
 * Who reads whose data in a golden comparison:
 * - `read-1.35`: the workspace starts on data at rest where 1.35.0 reads it
 *   (a golden 1.35.0 wrote, or U10's stored value), compared with what
 *   1.35.0 makes of the same data;
 * - `1.35-reads`: 1.35.0 reads what the workspace wrote (the rollback
 *   direction).
 */
export type GoldenDirection = "read-1.35" | "1.35-reads";

/**
 * The named golden cases a `goldenChanges` entry may cover: each case's part,
 * the directions it compares, and the engines that run it. Only the history
 * and persistence parts have cases; the signed snapshot and the audit chain
 * must stay byte-identical and readable both ways, with no entry.
 */
export const GOLDEN_CASES = {
  /** checkGoldens: the history export (both directions). */
  "history read": {
    part: "history",
    directions: ["read-1.35", "1.35-reads"],
    engines: ["v2", "v2:dist"],
  },
  /** checkGoldens: the persistence plugin's saved data (both directions). */
  "persistence read": {
    part: "persistence",
    directions: ["read-1.35", "1.35-reads"],
    engines: ["v2", "v2:dist"],
  },
  /** checkGoldens: 1.35.0 imports what the workspace exports after importing 1.35.0's export. */
  "history re-export": {
    part: "history",
    directions: ["1.35-reads"],
    engines: ["v2", "v2:dist"],
  },
  /** checkGoldens: 1.35.0 restores what the workspace saves after restoring 1.35.0's save. */
  "persistence re-save": {
    part: "persistence",
    directions: ["1.35-reads"],
    engines: ["v2", "v2:dist"],
  },
  /** checkEnvelope: today's flat format stored, either build. */
  "U10 flat": {
    part: "persistence",
    directions: ["read-1.35"],
    engines: ["v2", "v2:dist", "v2:dist:prod"],
  },
  /** checkEnvelope: an envelope stored, development build. */
  "U10 development": {
    part: "persistence",
    directions: ["read-1.35"],
    engines: ["v2", "v2:dist"],
  },
  /** checkEnvelope: an envelope stored, production build. */
  "U10 production": {
    part: "persistence",
    directions: ["read-1.35"],
    engines: ["v2:dist:prod"],
  },
  /** checkEnvelope: 1.35.0 restores the workspace's save made from the flat format. */
  "U10 flat rollback": {
    part: "persistence",
    directions: ["1.35-reads"],
    engines: ["v2", "v2:dist", "v2:dist:prod"],
  },
  /** checkEnvelope: 1.35.0 restores the workspace's save made from an envelope, development build. */
  "U10 development rollback": {
    part: "persistence",
    directions: ["1.35-reads"],
    engines: ["v2", "v2:dist"],
  },
  /** checkEnvelope: 1.35.0 restores the workspace's save made from an envelope, production build. */
  "U10 production rollback": {
    part: "persistence",
    directions: ["1.35-reads"],
    engines: ["v2:dist:prod"],
  },
} as const satisfies Record<
  string,
  {
    part: GoldenPart;
    directions: readonly GoldenDirection[];
    engines: readonly string[];
  }
>;

export type GoldenCase = keyof typeof GOLDEN_CASES;

/**
 * An approved change to one golden case (api-changes.json `goldenChanges`,
 * contracts/STABILITY.md): for `case`, in `direction`, on each of `engines`,
 * the value compared is `expected2` (what the engine makes of it now, as
 * JSON) instead of 1.35.0's. A different value still fails, and so does the
 * 1.35.0 value (the entry is stale). `row` is the one approved decisions-page
 * row it rests on.
 */
export interface GoldenChange {
  case: GoldenCase;
  direction: GoldenDirection;
  engines: string[];
  row: string;
  part: GoldenPart;
  expected2: unknown;
  reason: string;
  approvedBy: string;
  date: string;
}

const CHANGE_KEYS = [
  "case",
  "direction",
  "engines",
  "row",
  "part",
  "expected2",
  "reason",
  "approvedBy",
  "date",
] as const;

/**
 * The problems with `goldenChanges`, and the entries that may apply: each
 * must have exactly CHANGE_KEYS, a known case with its own part, a direction
 * and engines that case has, one row `(xx)`, a reason, a date, and a
 * signature. An unsigned or malformed entry never applies, and two entries
 * may not cover one case, direction and engine.
 */
export function checkGoldenChanges(changes: readonly unknown[]): {
  failures: string[];
  usable: GoldenChange[];
} {
  const failures: string[] = [];
  const usable: GoldenChange[] = [];
  const covered = new Map<string, number>();
  if (!Array.isArray(changes)) {
    return { failures: ["goldenChanges must be an array"], usable };
  }
  changes.forEach((raw, i) => {
    const problems: string[] = [];
    const c = raw as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      failures.push(`goldenChanges[${i}] must be an object`);

      return;
    }
    const keys = Object.keys(c);
    for (const key of CHANGE_KEYS) {
      if (!Object.hasOwn(c, key)) {
        problems.push(`has no ${key}`);
      }
    }
    for (const key of keys) {
      if (!(CHANGE_KEYS as readonly string[]).includes(key)) {
        problems.push(`has an unknown key ${key}`);
      }
    }
    const spec = Object.hasOwn(GOLDEN_CASES, String(c.case))
      ? GOLDEN_CASES[c.case as GoldenCase]
      : undefined;
    if (!spec) {
      problems.push(
        `names no golden case (one of ${Object.keys(GOLDEN_CASES).join(", ")})`,
      );
    } else {
      if (c.part !== spec.part) {
        problems.push(`must have part "${spec.part}" for its case`);
      }
      if (!(spec.directions as readonly unknown[]).includes(c.direction)) {
        problems.push(
          `has a direction its case does not compare (${spec.directions.join(" or ")})`,
        );
      }
      const engines = c.engines;
      if (
        !Array.isArray(engines) ||
        engines.length === 0 ||
        new Set(engines).size !== engines.length ||
        !engines.every((e) => (spec.engines as readonly unknown[]).includes(e))
      ) {
        problems.push(
          `must list distinct engines its case runs (${spec.engines.join(", ")})`,
        );
      }
    }
    if (typeof c.row !== "string" || !/^\([a-z]{1,3}\)$/.test(c.row)) {
      problems.push('must name one approved row, as "(ai)"');
    }
    if (typeof c.reason !== "string" || c.reason.trim() === "") {
      problems.push("needs a reason");
    }
    if (typeof c.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
      problems.push("needs a date, YYYY-MM-DD");
    }
    if (typeof c.approvedBy !== "string" || c.approvedBy.trim() === "") {
      problems.push("is unsigned (approvedBy is empty)");
    }
    const label = `goldenChanges[${i}] (${String(c.case)}, ${String(c.direction)}, ${String(c.row)})`;
    if (problems.length > 0) {
      failures.push(`${label} ${problems.join("; ")}`);

      return;
    }
    for (const engine of c.engines as string[]) {
      const at = `${String(c.case)} / ${String(c.direction)} / ${engine}`;
      const other = covered.get(at);
      if (other !== undefined) {
        failures.push(
          `${label} covers ${at}, which goldenChanges[${other}] already covers`,
        );
      }
      covered.set(at, i);
    }
    usable.push(c as unknown as GoldenChange);
  });

  return { failures, usable };
}

/** Where one golden comparison is made. */
interface GoldenAt {
  case: GoldenCase | undefined;
  direction: GoldenDirection;
  engine: string;
}

/**
 * One golden comparison. With no usable entry for `at`, `actual` must be
 * `expected` (1.35.0's). With one, `actual` must be the entry's `expected2`,
 * and must differ from 1.35.0's (else the entry is stale).
 */
function judge(
  usable: readonly GoldenChange[],
  at: GoldenAt,
  actual: unknown,
  expected: unknown,
  what: string,
): string[] {
  const text = (v: unknown) => JSON.stringify(v);
  const entry = usable.find(
    (c) =>
      c.case === at.case &&
      c.direction === at.direction &&
      c.engines.includes(at.engine),
  );
  if (!entry) {
    return same(actual, expected)
      ? []
      : [`${what}: ${text(actual)} vs ${text(expected)}`];
  }
  const label = `the goldenChanges entry for ${at.case} (${at.direction}, ${at.engine}, ${entry.row})`;
  if (same(actual, expected)) {
    return [
      `${label} covers no difference: ${at.engine} gives 1.35.0's ${text(expected)}; remove the entry or the engine`,
    ];
  }
  if (!same(actual, entry.expected2)) {
    return [
      `${what}, and not as ${label} records: ${text(actual)} vs the entry's ${text(entry.expected2)} (1.35.0: ${text(expected)})`,
    ];
  }

  return [];
}

/** The case for what an engine writes over 1.35.0's data of a part, if any. */
const REWRITE_CASE: Partial<Record<GoldenPart, GoldenCase>> = {
  history: "history re-export",
  persistence: "persistence re-save",
};

/** The case checkGoldens compares a part under, if the part has one. */
function readCase(part: GoldenPart): GoldenCase | undefined {
  const name = `${part} read`;

  return Object.hasOwn(GOLDEN_CASES, name) ? (name as GoldenCase) : undefined;
}

/**
 * Problems with the goldens in `dir`:
 * - each file is still exactly what 1.35.0 writes for the script;
 * - the workspace writes the same bytes for the signed snapshot and the audit
 *   chain (no entry changes this); history and persistence bytes may differ,
 *   but 1.35.0 must read them as it reads its own (case "<part> read",
 *   direction `1.35-reads`);
 * - the workspace reads what 1.35.0 wrote exactly as 1.35.0 does, including
 *   the reads that must fail (tampered, expired) (case "<part> read",
 *   direction `read-1.35`);
 * - what the workspace writes over 1.35.0's history and persistence data (its
 *   export after the import, its save after the restore), 1.35.0 reads as it
 *   reads its own from the same data (cases "history re-export" and
 *   "persistence re-save", direction `1.35-reads`), so no `read-1.35` entry
 *   can carry a write 1.35.0 does not read.
 * A signed `goldenChanges` entry for a case, direction and `local.name`
 * replaces 1.35.0's value there with the entry's `expected2` (`judge`);
 * every entry is validated on every call (`checkGoldenChanges`).
 * `parts` limits the engine under test to the parts it has built (each part
 * alone, `producePart`); 1.35.0's own checks always cover all four.
 */
export async function checkGoldens(
  dir: string,
  v1: Engine,
  local: Engine,
  goldenChanges: readonly unknown[] = [],
  parts: readonly GoldenPart[] = PART_NAMES,
): Promise<string[]> {
  const { failures, usable } = checkGoldenChanges(goldenChanges);
  const golden = readGoldens(dir);
  const fromV1 = await produce(v1);
  const fromLocal = await produceParts(local, parts);
  for (const f of parts.map((p) => GOLDEN_PARTS[p].file)) {
    if (golden[f] !== fromV1[f]) {
      failures.push(`golden ${f} is not what 1.35.0 writes`);
    }
    if (BYTE_IDENTICAL.includes(f) && golden[f] !== fromLocal[f]) {
      failures.push(`the workspace writes a different ${f} than 1.35.0`);
    }
  }
  const v1Wrote: Partial<Record<GoldenPart, string>> = {};
  const localWrote: Partial<Record<GoldenPart, string>> = {};
  const expected = await read(v1, golden, PART_NAMES, v1Wrote);
  const localReadsV1 = await read(local, golden, parts, localWrote);
  const v1ReadsLocal = await read(v1, fromLocal, parts);
  for (const part of parts) {
    const over = REWRITE_CASE[part];
    if (over) {
      const file = GOLDEN_PARTS[part].file;
      failures.push(
        ...judge(
          usable,
          { case: over, direction: "1.35-reads", engine: local.name },
          await readPart(v1, { [file]: localWrote[part] }, part),
          await readPart(v1, { [file]: v1Wrote[part] }, part),
          `1.35.0 reads what the workspace writes over 1.35.0's ${part} differently from its own`,
        ),
      );
    }
    const at = { case: readCase(part), engine: local.name };
    failures.push(
      ...judge(
        usable,
        { ...at, direction: "read-1.35" },
        localReadsV1[part],
        expected[part],
        `the workspace reads 1.35.0's ${part} differently`,
      ),
      ...judge(
        usable,
        { ...at, direction: "1.35-reads" },
        v1ReadsLocal[part],
        expected[part],
        `1.35.0 reads the workspace's ${part} differently`,
      ),
    );
  }
  const sanity = expected as {
    signed: Record<string, boolean>;
    ledger: {
      before: { valid: boolean };
      after: { valid: boolean };
      tampered: { valid: boolean };
    };
  };
  if (!sanity.signed.valid || sanity.signed.wrongSecret) {
    failures.push("1.35.0 does not verify its own signed snapshot");
  }
  if (
    sanity.signed.changedData ||
    sanity.signed.changedSignature ||
    sanity.signed.expired ||
    !sanity.signed.freshWithoutIgnoreExpiry
  ) {
    failures.push(
      `1.35.0 accepts a tampered or expired snapshot, or rejects a fresh one: ${JSON.stringify(sanity.signed)}`,
    );
  }
  if (sanity.ledger.tampered.valid) {
    failures.push("1.35.0 verifies a tampered audit chain");
  }
  if (!sanity.ledger.before.valid || !sanity.ledger.after.valid) {
    failures.push(
      `1.35.0 does not verify its own audit chain: ${JSON.stringify(sanity.ledger)}`,
    );
  }

  return failures;
}

/** U10's module: one number, and an init that keeps a restored value. */
function envelopeModule(engine: Engine) {
  const { createModule, t } = engine.core;

  return createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts: Record<string, unknown>) => {
      facts.n ??= 0;
    },
  });
}

export interface PersistRun {
  /** The facts after `start()`: what the load put in the store. */
  restored: Record<string, unknown>;
  /** What storage holds under the key after the next save. */
  saved: string | null;
  /** console.error and console.warn output, in order. */
  logged: string[];
}

/**
 * U10 (core-next/docs/rfc-l6-snapshots.md, A4 and R8): a system whose
 * storage holds `stored` under "app" starts with the persistence plugin;
 * read what loaded, write `n = 1`, destroy (the plugin saves at once) and
 * return what storage holds then, with what the engine logged.
 */
export async function persistRun(
  engine: Engine,
  stored: string,
): Promise<PersistRun> {
  const storage = memoryStorage({ app: stored });
  const logged: string[] = [];
  const real = { error: console.error, warn: console.warn };
  const capture = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  console.error = capture;
  console.warn = capture;
  try {
    const system = engine.core.createSystem({
      module: envelopeModule(engine),
      plugins: [
        engine.plugins.persistencePlugin({
          storage,
          key: "app",
          debounce: 0,
        }),
      ],
    });
    system.start();
    await system.settle();
    const restored = JSON.parse(JSON.stringify(system.getSnapshot().facts));
    system.facts.n = 1;
    await system.settle();
    system.destroy();

    return { restored, saved: storage.getItem("app"), logged };
  } finally {
    console.error = real.error;
    console.warn = real.warn;
  }
}

/** U10's two stored values: an envelope, and today's flat format. */
export const ENVELOPE = JSON.stringify({
  v: 1,
  schema: { m: 1 },
  facts: { n: 6 },
});
export const FLAT = JSON.stringify({ n: 6 });

/**
 * What a U10 run made of the stored value: the load and whether it logged.
 * The save is not here: what the engine writes is judged only by how 1.35.0
 * reads it (`checkEnvelope`'s rollback cases), so no `read-1.35` entry
 * carries a write.
 */
function readOutcome(run: PersistRun) {
  return { restored: run.restored, logged: run.logged.length > 0 };
}

/** What 1.35.0 made of a save: the load, its own next save, and whether it logged. */
function rollbackOutcome(run: PersistRun) {
  return { ...readOutcome(run), saved: run.saved };
}

/**
 * U10 on the engine under test (`next`) against 1.35.0 of the same build
 * (`ref`). For each stored value (today's flat format; an envelope):
 * - `next` loads it as 1.35.0 does, and logs when 1.35.0 does ("U10 flat",
 *   and "U10 development" or "U10 production"; direction `read-1.35`);
 * - 1.35.0 makes of `next`'s save from it what it makes of its own save from
 *   it: the load, its next save, and whether it logged ("U10 flat rollback",
 *   and "U10 development rollback" or "U10 production rollback"; direction
 *   `1.35-reads`).
 * A signed `goldenChanges` entry for a case, direction and `next.name`
 * replaces 1.35.0's value there with its `expected2`.
 */
export async function checkEnvelope(
  next: Engine,
  ref: Engine,
  goldenChanges: readonly unknown[] = [],
): Promise<string[]> {
  const production = ref.name.endsWith(":prod");
  if (next.name.endsWith(":prod") !== production) {
    throw new Error(
      `checkEnvelope needs one build: ${next.name} vs ${ref.name}`,
    );
  }
  const { failures, usable } = checkGoldenChanges(goldenChanges);
  const cases: [string, GoldenCase, GoldenCase][] = [
    [FLAT, "U10 flat", "U10 flat rollback"],
    production
      ? [ENVELOPE, "U10 production", "U10 production rollback"]
      : [ENVELOPE, "U10 development", "U10 development rollback"],
  ];
  for (const [stored, name, back] of cases) {
    const mine = await persistRun(next, stored);
    const theirs = await persistRun(ref, stored);
    failures.push(
      ...judge(
        usable,
        { case: name, direction: "read-1.35", engine: next.name },
        readOutcome(mine),
        readOutcome(theirs),
        `${next.name} handles ${name}'s stored data differently from 1.35.0`,
      ),
      ...judge(
        usable,
        { case: back, direction: "1.35-reads", engine: next.name },
        rollbackOutcome(await persistRun(ref, mine.saved ?? "")),
        rollbackOutcome(await persistRun(ref, theirs.saved ?? "")),
        `1.35.0 restores ${next.name}'s save from ${name}'s stored data differently from its own`,
      ),
    );
  }

  return failures;
}
