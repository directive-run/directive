/**
 * L6: dev-only schema validation (t.* refine / transform / brand / optional
 * / nullable), the persistence plugin, distributable snapshots.
 */

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

suite("L6 schema validation and persistence", () => {
  scenario(
    "t.* refine, transform, brand and wrong types in development",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: {
            handle: t
              .string()
              .refine((s: string) => s.startsWith("@"), "must start with @"),
            upper: t
              .string()
              .transform((v: unknown) => String(v).toUpperCase()),
            id: t.string().brand<"UserId">(),
            age: t.number().min(0).max(150),
            nick: t.string().optional(),
            tag: t.string().nullable(),
          },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.handle = "@ada";
          facts.upper = "a";
          facts.id = "u1";
          facts.age = 30;
          facts.tag = null;
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "handle", value: "ada" },
      { op: "set", key: "upper", value: "mixed Case" },
      { op: "set", key: "age", value: -1 },
      { op: "set", key: "age", value: "old" },
      { op: "set", key: "tag", value: 5 },
      { op: "set", key: "nick", value: undefined },
      { op: "settle" },
    ],
  );

  scenario(
    "the persistence plugin restores, saves debounced, and excludes keys",
    ({ core: { createModule, t }, plugins, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), secret: t.string(), label: t.string() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.secret = "s";
          facts.label = "fresh";
        },
      } as any),
      plugins: [
        plugins.persistencePlugin({
          storage: memoryStorage(external, {
            app: JSON.stringify({ n: 41, label: "saved" }),
          }),
          key: "app",
          exclude: ["secret"],
          debounce: 50,
          onRestore: (data: unknown) => external(["onRestore", data]),
          onSave: (data: unknown) => external(["onSave", data]),
        }),
      ],
    }),
    [
      { op: "start" },
      { op: "checkpoint", label: "restored" },
      { op: "set", key: "n", value: 42 },
      { op: "set", key: "secret", value: "t" },
      { op: "advance", ms: 20 },
      { op: "set", key: "n", value: 43 },
      { op: "advance", ms: 60 },
      { op: "settle" },
    ],
  );

  scenario(
    "distributable snapshots",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { name: t.string(), count: t.number() },
          derivations: { display: t.string() },
          events: {},
        },
        init: (facts: any) => {
          facts.name = "Ada";
          facts.count = 1;
        },
        derive: { display: (facts: any) => `${facts.name} (${facts.count})` },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "distributable snapshot",
        fn: (system, { external }) => {
          external([
            "distributable",
            system.getDistributableSnapshot({
              includeDerivations: ["display"],
              ttlSeconds: 60,
              metadata: { v: 1 },
            }),
          ]);
          external([
            "distributable, facts only",
            system.getDistributableSnapshot({ includeFacts: ["count"] }),
          ]);
        },
      },
      { op: "set", key: "count", value: 2 },
      { op: "settle" },
    ],
  );
});
