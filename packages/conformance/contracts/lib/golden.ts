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
import { coreEntries, v1Entries } from "../../lib/core-entries.js";

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

/** The two entry modules a script needs, from one engine. */
export interface Engine {
  name: string;
  /** Loaded by file, so typed loosely on purpose. */
  core: any;
  plugins: any;
}

export const FIXED_NOW = 1_760_000_000_000;
export const SECRET = "directive-contracts-golden-secret";

export async function loadEngine(name: "v1" | "local"): Promise<Engine> {
  const entries = name === "v1" ? v1Entries("development") : coreEntries();
  const file = (subpath: string) => {
    const entry = entries.find((e) => e.subpath === subpath);
    if (!entry) {
      throw new Error(`${name} has no ${subpath} entry`);
    }

    return pathToFileURL(entry.file).href;
  };

  return {
    name,
    core: await import(file(".")),
    plugins: await import(file("./plugins")),
  };
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

/** What `reader` makes of artifacts some engine wrote. */
async function read(
  reader: Engine,
  goldens: Goldens,
): Promise<Record<string, unknown>> {
  return withFixedClock(async () => {
    const out: Record<string, unknown> = {};

    // History export: imported, the system is at the exported snapshot.
    const history = reader.core.createSystem({
      module: counterModule(reader),
      history: { maxSnapshots: 50 },
    });
    history.start();
    history.history.import(goldens["history-export.golden"]);
    await history.settle();
    out.history = {
      count: history.facts.count,
      label: history.facts.label,
      tags: history.facts.tags,
      currentIndex: history.history.currentIndex,
      exportedAgain: JSON.parse(history.history.export()),
    };
    history.destroy();

    // Persistence: a system started on the saved data restores it.
    const storage = memoryStorage({
      golden: goldens["persistence-saved.golden"],
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
    out.persistence = {
      count: restored.facts.count,
      label: restored.facts.label,
      tags: restored.facts.tags,
    };
    restored.destroy();

    // Signed snapshot: verifies with the secret, fails with another.
    const signed = JSON.parse(goldens["signed-snapshot.golden"]);
    out.signed = {
      valid: await reader.core.verifySnapshotSignature(signed, SECRET, {
        ignoreExpiry: true,
      }),
      wrongSecret: await reader.core.verifySnapshotSignature(signed, "other", {
        ignoreExpiry: true,
      }),
      // Reads that must FAIL: a changed data value, a changed signature byte,
      // and (clock past expiresAt, ignoreExpiry unset) an expired signature.
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

    // Audit ledger: the chain verifies, and a ledger resumed from it keeps
    // the chain going.
    const entries = JSON.parse(goldens["audit-ledger.golden"]);
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
    out.ledger = { before, after: ledger.verify(), tampered: tamperedVerify };

    return out;
  });
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

/** An approved change to what a reader makes of a golden part (api-changes.json `goldenChanges`). */
export interface GoldenChange {
  part: string;
  reason: string;
  approvedBy: string;
  date: string;
}

/**
 * Problems with the goldens in `dir`:
 * - each file is still exactly what 1.35.0 writes for the script;
 * - the workspace writes the same bytes for the signed snapshot and the audit
 *   chain; history and persistence bytes may differ, but 1.35.0 must read them
 *   as it reads its own, unless `goldenChanges` lists the part with approvedBy;
 * - the workspace reads what 1.35.0 wrote exactly as 1.35.0 does, including
 *   the reads that must fail (tampered, expired).
 */
export async function checkGoldens(
  dir: string,
  v1: Engine,
  local: Engine,
  goldenChanges: readonly GoldenChange[] = [],
): Promise<string[]> {
  const failures: string[] = [];
  const golden = readGoldens(dir);
  const fromV1 = await produce(v1);
  const fromLocal = await produce(local);
  for (const f of GOLDEN_FILES) {
    if (golden[f] !== fromV1[f]) {
      failures.push(`golden ${f} is not what 1.35.0 writes`);
    }
    if (BYTE_IDENTICAL.includes(f) && golden[f] !== fromLocal[f]) {
      failures.push(`the workspace writes a different ${f} than 1.35.0`);
    }
  }
  const expected = await read(v1, golden);
  const localReadsV1 = await read(local, golden);
  const v1ReadsLocal = await read(v1, fromLocal);
  for (const part of Object.keys(expected)) {
    if (!same(localReadsV1[part], expected[part])) {
      failures.push(
        `the workspace reads 1.35.0's ${part} differently: ${JSON.stringify(localReadsV1[part])} vs ${JSON.stringify(expected[part])}`,
      );
    }
    const approved = goldenChanges.some(
      (c) => c.part === part && c.approvedBy.trim() !== "",
    );
    if (!approved && !same(v1ReadsLocal[part], expected[part])) {
      failures.push(
        `1.35.0 reads the workspace's ${part} differently: ${JSON.stringify(v1ReadsLocal[part])} vs ${JSON.stringify(expected[part])}`,
      );
    }
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
