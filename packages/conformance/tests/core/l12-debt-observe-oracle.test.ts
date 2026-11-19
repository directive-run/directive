// Ported from packages/core/src/core/__tests__/l12-debt-observe-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The L12 RFC's "Mutation debt owed to L8, L9 and L11": 27 mutants in L8, L9
// and L11 code that only L12's plugin tests killed, read here through
// `observe()` and plugin hooks at their owning layer, so that layer's gate
// kills them. Each test sits at its own layer (lib/layers.ts): the history
// pin at L8 (`observe` is an instrument), the meta pin at L9, the data-form
// `when` pin at L11. The expected lists were recorded on 1.35.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await wait();
  }
}

describe("mutation debt owed to L8: history navigation through observe() and hooks", () => {
  it("each fact.change over writes, an effect's copy, goBack, goForward and a restore, with the snapshot and navigation hooks", async () => {
    const log: unknown[] = [];
    const mod = createModule("h", {
      schema: {
        facts: { n: t.number(), copy: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.copy = 0;
      },
      effects: {
        mirror: {
          run: (facts: any) => {
            if (facts.copy !== facts.n) {
              facts.copy = facts.n;
            }
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      history: true,
      plugins: [
        {
          name: "history-hooks",
          onSnapshot: (snapshot: any) =>
            log.push(["onSnapshot", snapshot?.facts ?? null]),
          onHistoryNavigate: (from: unknown, to: unknown) =>
            log.push(["onHistoryNavigate", from, to]),
        },
      ],
    } as never) as any;
    system.observe((event: any) => {
      if (event.type === "fact.change") {
        log.push([
          "fact.change",
          event.key,
          event.prev,
          event.next,
          event.origin,
        ]);
      }
    });
    system.start();
    await flush();
    log.push(["--", "write 1"]);
    system.facts.n = 1;
    await flush();
    log.push(["--", "write 2"]);
    system.facts.n = 2;
    await flush();
    log.push(["--", "goBack", system.history.snapshots.length]);
    system.history.goBack();
    await flush();
    log.push(["--", "goForward", system.history.snapshots.length]);
    system.history.goForward();
    await flush();
    log.push(["--", "restore", system.history.snapshots.length]);
    const saved = system.getSnapshot();
    system.facts.n = 7;
    await flush();
    system.restore(saved);
    await flush();
    log.push(["--", "end", system.history.snapshots.length, system.facts.n]);

    expect(log).toMatchInlineSnapshot(`
      [
        [
          "fact.change",
          "n",
          undefined,
          0,
          "authored",
        ],
        [
          "fact.change",
          "copy",
          undefined,
          0,
          "authored",
        ],
        [
          "onSnapshot",
          {
            "copy": 0,
            "n": 0,
          },
        ],
        [
          "--",
          "write 1",
        ],
        [
          "fact.change",
          "n",
          0,
          1,
          "authored",
        ],
        [
          "onSnapshot",
          {
            "copy": 0,
            "n": 1,
          },
        ],
        [
          "--",
          "write 2",
        ],
        [
          "fact.change",
          "n",
          1,
          2,
          "authored",
        ],
        [
          "onSnapshot",
          {
            "copy": 0,
            "n": 2,
          },
        ],
        [
          "--",
          "goBack",
          3,
        ],
        [
          "fact.change",
          "n",
          2,
          1,
          "restore",
        ],
        [
          "onHistoryNavigate",
          2,
          1,
        ],
        [
          "--",
          "goForward",
          3,
        ],
        [
          "fact.change",
          "n",
          1,
          2,
          "restore",
        ],
        [
          "onHistoryNavigate",
          1,
          2,
        ],
        [
          "--",
          "restore",
          3,
        ],
        [
          "fact.change",
          "n",
          2,
          7,
          "authored",
        ],
        [
          "onSnapshot",
          {
            "copy": 0,
            "n": 7,
          },
        ],
        [
          "fact.change",
          "n",
          7,
          2,
          "hydrate",
        ],
        [
          "onSnapshot",
          {
            "copy": 0,
            "n": 2,
          },
        ],
        [
          "--",
          "end",
          5,
          2,
        ],
      ]
    `);
    system.destroy();
  });
});

describe("mutation debt owed to L9: fact tags through meta, beside observe()", () => {
  it("meta reports each fact's tags, untagged facts as carrying none, and observe() sees the same writes", async () => {
    const mod = createModule("p", {
      schema: {
        facts: {
          email: t.string().meta({ tags: ["pii"] }),
          card: t.string().meta({ tags: ["pii", "billing"] }),
          plain: t.number(),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts: any) => {
        facts.email = "a@b.c";
        facts.card = "4242";
        facts.plain = 0;
      },
      meta: { label: "people" },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const changes: unknown[] = [];
    system.observe((event: any) => {
      if (event.type === "fact.change") {
        changes.push([event.key, event.prev, event.next]);
      }
    });
    system.start();
    await flush();
    system.facts.email = "x@y.z";
    system.facts.plain = 1;
    await flush();

    const meta = system.meta;
    expect(typeof meta).toBe("object");
    expect(meta.module("p")).toMatchInlineSnapshot(`
      {
        "label": "people",
      }
    `);
    expect([
      meta.carriesTag("fact", "email", "pii"),
      meta.carriesTag("fact", "card", "pii"),
      meta.carriesTag("fact", "card", "billing"),
      meta.carriesTag("fact", "plain", "pii"),
      meta.carriesTag("fact", "email", "billing"),
    ]).toMatchInlineSnapshot(`
      [
        true,
        true,
        true,
        false,
        false,
      ]
    `);
    expect(meta.byTag("pii")).toMatchInlineSnapshot(`
      [
        {
          "id": "email",
          "kind": "fact",
          "meta": {
            "tags": [
              "pii",
            ],
          },
          "tagOrigin": "authored",
        },
        {
          "id": "card",
          "kind": "fact",
          "meta": {
            "tags": [
              "pii",
              "billing",
            ],
          },
          "tagOrigin": "authored",
        },
      ]
    `);
    expect(changes).toMatchInlineSnapshot(`
      [
        [
          "email",
          undefined,
          "a@b.c",
        ],
        [
          "card",
          undefined,
          "4242",
        ],
        [
          "plain",
          undefined,
          0,
        ],
        [
          "email",
          "a@b.c",
          "x@y.z",
        ],
        [
          "plain",
          0,
          1,
        ],
      ]
    `);
    system.destroy();
  });
});

describe("mutation debt owed to L11: a data-form when through observe() and inspect()", () => {
  it("constraint.evaluate carries active and whenExplain, and inspect() the whenSpec, beside a function when", async () => {
    const mod = createModule("c", {
      schema: {
        facts: { n: t.number(), done: t.number() },
        derivations: {},
        events: {},
        requirements: { GO: {}, FN: {} },
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.done = 0;
      },
      constraints: {
        data: { when: { n: { $gte: 2 } }, require: { type: "GO" } },
        fn: { when: (facts: any) => facts.n >= 2, require: { type: "FN" } },
      },
      resolvers: {
        go: {
          requirement: "GO",
          resolve: async (_req: unknown, context: any) => {
            context.facts.done += 1;
          },
        },
        fn: {
          requirement: "FN",
          resolve: async (_req: unknown, context: any) => {
            context.facts.done += 10;
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const evaluations: unknown[] = [];
    system.observe((event: any) => {
      if (event.type === "constraint.evaluate") {
        evaluations.push([event.id, event.active, event.whenExplain ?? null]);
      }
    });
    system.start();
    await flush();
    system.facts.n = 1;
    await flush();
    system.facts.n = 3;
    await flush();

    expect(evaluations).toMatchInlineSnapshot(`
      [
        [
          "data",
          false,
          [
            {
              "actual": 0,
              "expected": 2,
              "op": "$gte",
              "pass": false,
              "path": "n",
            },
          ],
        ],
        [
          "fn",
          false,
          null,
        ],
        [
          "data",
          false,
          [
            {
              "actual": 1,
              "expected": 2,
              "op": "$gte",
              "pass": false,
              "path": "n",
            },
          ],
        ],
        [
          "fn",
          false,
          null,
        ],
        [
          "data",
          true,
          [
            {
              "actual": 3,
              "expected": 2,
              "op": "$gte",
              "pass": true,
              "path": "n",
            },
          ],
        ],
        [
          "fn",
          true,
          null,
        ],
      ]
    `);
    expect(
      system
        .inspect()
        .constraints.map((c: any) => [c.id, c.whenSpec ?? null, c.active]),
    ).toMatchInlineSnapshot(`
      [
        [
          "data",
          {
            "n": {
              "$gte": 2,
            },
          },
          true,
        ],
        [
          "fn",
          null,
          true,
        ],
      ]
    `);
    expect(system.facts.done).toBe(11);
    system.destroy();
  });
});
