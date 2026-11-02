/**
 * L6-pre pins (packages/core-next/docs/rfc-l6-snapshots.md, "Untested
 * behaviours"): U2 a development restore() with a bad key or value is
 * half-applied, U7 the order of the persistence plugin's restore against the
 * module init and initialFacts, U9 a stale saved key, U15 a namespaced
 * system's flat `ns::key` keys. Each records 1.35's behaviour; candidates
 * (ag), (ai) and (ak) would change U2, U7 and U9 only with a signed
 * divergences.json entry.
 *
 * The diff harness runs development builds only. The production halves of
 * U2 and U9 (production writes the unknown key) are pinned by the
 * conformance tests in packages/core/src/core/__tests__ (L6-pre-a).
 */

import type { AnySystem } from "../scenario.js";
import { scenario, suite } from "../scenario.js";

/** A Storage the scenario can see into. */
function memoryStorage(external: (data: unknown) => void, initial = {}) {
  const map = new Map<string, string>(Object.entries(initial));

  return {
    getItem: (key: string) => {
      external(["getItem", key]);

      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      external(["setItem", key, JSON.parse(value)]);
      map.set(key, value);
    },
    removeItem: (key: string) => {
      external(["removeItem", key]);
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

/** One saved object under "app". */
const saved = (facts: Record<string, unknown>) => ({
  app: JSON.stringify(facts),
});

/** A step that reports `keys` as the system's facts read them now. */
const read = (label: string, keys: string[]) => ({
  op: "run" as const,
  label,
  fn: (system: AnySystem, { external }: { external(d: unknown): void }) => {
    external([
      label,
      Object.fromEntries(
        keys.map((k) => [
          k,
          k.split(".").reduce((o: any, part) => o?.[part], system.facts),
        ]),
      ),
    ]);
  },
});

suite("L6 persistence and restore pins", () => {
  // U2 (S2, S3): restore() writes key by key; in development the first bad
  // key or value throws, after the keys before it were written.
  scenario(
    "restore() with an unknown key or a bad value is half-applied in development",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), tags: t.array() },
          derivations: { label: t.string() },
          events: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.tags = [];
        },
        derive: {
          label: (facts: any) => `${facts.n}/${facts.tags.length}`,
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "restore n, an unknown key, then tags",
        fn: (system) =>
          system.restore({ facts: { n: 5, bogus: 1, tags: ["x"] } }),
      },
      {
        op: "run",
        label: "read after the unknown key",
        fn: (system, { external }) =>
          external({
            n: system.facts.n,
            tags: [...system.facts.tags],
            label: system.derive.label,
          }),
      },
      { op: "settle" },
      {
        op: "run",
        label: "restore n, then a tags value that is not an array",
        fn: (system) =>
          system.restore({ facts: { n: 7, tags: "not-an-array" } }),
      },
      {
        op: "run",
        label: "read after the bad value",
        fn: (system, { external }) =>
          external({
            n: system.facts.n,
            tags: system.facts.tags,
            label: system.derive.label,
          }),
      },
      { op: "settle" },
    ],
  );

  // U7 (S11, Q1 to Q3, R4): the plugin restores when the system is created;
  // the module init runs at initialize() and overwrites what it sets, and the
  // next save writes the init's value. `??=` keeps the saved value, and an
  // init that reads a persisted fact sees it.
  const KEYS = ["set", "kept", "read", "seen"];
  scenario(
    "a persisted fact loses to an init that sets it, and survives ??= and a read",
    ({ core: { createModule, t }, plugins, external }) => ({
      module: createModule("m", {
        schema: {
          facts: {
            set: t.string(),
            kept: t.string(),
            read: t.string(),
            seen: t.string(),
          },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.set = "aperture";
          facts.kept ??= "aperture";
          facts.seen = `init read ${String(facts.read)}`;
        },
      } as any),
      plugins: [
        plugins.persistencePlugin({
          storage: memoryStorage(
            external,
            saved({ set: "sodium", kept: "sodium", read: "sodium" }),
          ),
          key: "app",
          include: ["set", "kept", "read"],
          debounce: 50,
          onRestore: (data: unknown) => external(["onRestore", data]),
        }),
      ],
    }),
    [
      read("created", KEYS),
      { op: "run", label: "initialize", fn: (system) => system.initialize() },
      read("initialized", KEYS),
      { op: "start" },
      { op: "settle" },
      read("started", KEYS),
      { op: "destroy" },
    ],
  );

  // U7 (R5): initialFacts are applied after the plugin's restore, and win.
  scenario(
    "initialFacts beat the persistence plugin's restore",
    ({ core: { createModule, t }, plugins, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { palette: t.string(), other: t.string() },
          derivations: {},
          events: {},
        },
      } as any),
      initialFacts: { palette: "init-facts" },
      plugins: [
        plugins.persistencePlugin({
          storage: memoryStorage(
            external,
            saved({ palette: "sodium", other: "saved" }),
          ),
          key: "app",
          debounce: 50,
        }),
      ],
    }),
    [
      read("created", ["palette", "other"]),
      { op: "run", label: "initialize", fn: (system) => system.initialize() },
      read("initialized", ["palette", "other"]),
      { op: "start" },
      { op: "settle" },
      read("started", ["palette", "other"]),
      { op: "destroy" },
    ],
  );

  // U9 (S10): a saved key the schema no longer has stops the development
  // restore at that key: keys before it load, keys after it do not.
  scenario(
    "a stale saved key aborts the development restore partway",
    ({ core: { createModule, t }, plugins, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), label: t.string() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.n ??= 0;
          facts.label ??= "fresh";
        },
      } as any),
      plugins: [
        plugins.persistencePlugin({
          storage: memoryStorage(
            external,
            saved({ n: 2, removedLater: true, label: "saved" }),
          ),
          key: "app",
          debounce: 50,
          onRestore: (data: unknown) => external(["onRestore", data]),
          onError: (error: unknown) => external(["onError", String(error)]),
        }),
      ],
    }),
    [
      read("created", ["n", "label"]),
      { op: "start" },
      { op: "settle" },
      read("started", ["n", "label"]),
      { op: "set", key: "n", value: 3 },
      { op: "advance", ms: 60 },
      { op: "destroy" },
    ],
  );

  // U15 (S13): on a namespaced system the plugin sees, saves and restores
  // flat `ns::key` keys, and `include` names them that way.
  scenario(
    "a namespaced system persists and restores flat ns::key keys",
    ({ core: { createModule, t }, plugins, external }) => ({
      modules: {
        c: createModule("c", {
          schema: {
            facts: { n: t.number(), other: t.string() },
            derivations: {},
            events: {},
          },
          init: (facts: any) => {
            facts.n ??= 0;
            facts.other ??= "fresh";
          },
        } as any),
      },
      plugins: [
        plugins.persistencePlugin({
          storage: memoryStorage(
            external,
            saved({ "c::n": 5, "c::other": "saved" }),
          ),
          key: "app",
          include: ["c::n"],
          debounce: 50,
          onRestore: (data: unknown) => external(["onRestore", data]),
        }),
      ],
    }),
    [
      { op: "start" },
      { op: "settle" },
      read("restored", ["c.n", "c.other"]),
      {
        op: "run",
        label: "write c.n and c.other",
        fn: (system) => {
          system.facts.c.n = 8;
          system.facts.c.other = "changed";
        },
      },
      { op: "advance", ms: 60 },
      read("saved", ["c.n", "c.other"]),
      { op: "destroy" },
    ],
  );
});
