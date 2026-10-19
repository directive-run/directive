import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests: what an effect may and may not do with the facts it is
// handed, in development. Public API only.

afterEach(() => {
  vi.restoreAllMocks();
});

const schema = {
  facts: {
    count: t.number(),
    name: t.string(),
    flag: t.boolean(),
    obj: t.object<{ x: number }>(),
  },
  derivations: { doubled: t.number() },
};

function build(
  effects: Record<string, unknown>,
  options: Record<string, unknown> = {},
) {
  const errors: Array<[string, Error]> = [];
  const blocked: Array<[string, string]> = [];
  const mod = createModule("m", {
    schema,
    init: (facts: any) => {
      facts.count = 0;
      facts.name = "alice";
      facts.flag = false;
      facts.obj = { x: 1 };
    },
    derive: { doubled: (facts) => facts.count * 2 },
    effects: effects as never,
  });
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "spy",
        onEffectError: (id: string, error: unknown) => {
          errors.push([id, error as Error]);
        },
        onEffectWriteBlocked: (id: string, key: string) => {
          blocked.push([id, key]);
        },
      },
    ],
    ...options,
  } as never);

  return { system: system as any, errors, blocked };
}

function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("the facts an effect reads through", () => {
  it("a write names the effect and the key, is reported, and is dropped", async () => {
    quiet();
    const { system, errors, blocked } = build({
      w: {
        deps: ["flag"],
        run: (facts: any) => {
          facts.count = 99;
        },
      },
    });
    await system.start();

    expect(system.facts.count).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe("w");
    expect(errors[0]![1].message).toMatch(/effect "w"/);
    expect(errors[0]![1].message).toMatch(/"count"/);
    expect(blocked).toEqual([["w", "count"]]);
    await system.destroy();
  });

  it("is also refused after an await", async () => {
    quiet();
    const { system, errors, blocked } = build({
      w: {
        deps: ["flag"],
        run: async (facts: any) => {
          await Promise.resolve();
          facts.count = 99;
        },
      },
    });
    await system.start();
    await system.settle();

    expect(system.facts.count).toBe(0);
    expect(errors.map(([id]) => id)).toEqual(["w"]);
    expect(blocked).toEqual([["w", "count"]]);
    await system.destroy();
  });

  it("is refused from a cleanup too", async () => {
    quiet();
    const { system, errors } = build({
      w: {
        deps: ["count"],
        run: (facts: any) => () => {
          facts.name = "mallory";
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await system.settle();

    expect(system.facts.name).toBe("alice");
    expect(errors.some(([id]) => id === "w")).toBe(true);
    await system.destroy();
  });

  it("the store behind it refuses set and delete and reports them", async () => {
    quiet();
    const { system, errors, blocked } = build({
      s: {
        deps: ["flag"],
        run: (facts: any) => {
          facts.$store.set("count", 5);
        },
      },
      d: {
        deps: ["flag"],
        run: (facts: any) => {
          facts.$store.delete("name");
        },
      },
    });
    await system.start();

    expect(system.facts.count).toBe(0);
    expect(system.facts.name).toBe("alice");
    expect(errors.map(([id]) => id).sort()).toEqual(["d", "s"]);
    expect(blocked).toContainEqual(["s", "count"]);
    expect(blocked).toContainEqual(["d", "name"]);
    await system.destroy();
  });

  it("the store behind it still reads, batches and subscribes", async () => {
    const out: Record<string, unknown> = {};
    const { system, errors } = build({
      s: {
        deps: ["flag"],
        run: (facts: any) => {
          const store = facts.$store;
          out.get = store.get("count");
          out.has = store.has("count");
          out.hasNot = store.has("zzz");
          out.object = store.toObject();
          out.same = store === facts.$store;
          let ran = false;
          store.batch(() => {
            ran = true;
          });
          out.batched = ran;
          const stop = store.subscribe(["count"], () => undefined);
          const stopAll = store.subscribeAll(() => undefined);
          out.stop = typeof stop;
          out.stopAll = typeof stopAll;
          stop();
          stopAll();
        },
      },
    });
    await system.start();
    system.facts.count = 3;
    await system.settle();
    await system.effects.call("s");

    expect(errors).toEqual([]);
    expect(out.get).toBe(3);
    expect(out.has).toBe(true);
    expect(out.hasNot).toBe(false);
    expect((out.object as any).count).toBe(3);
    expect(out.same).toBe(true);
    expect(out.batched).toBe(true);
    expect(out.stop).toBe("function");
    expect(out.stopAll).toBe("function");
    await system.destroy();
  });

  it("reads see live values", async () => {
    const seen: number[] = [];
    const { system } = build({
      r: { deps: ["count"], run: (facts: any) => void seen.push(facts.count) },
    });
    await system.start();
    system.facts.count = 4;
    await system.settle();

    expect(seen).toEqual([0, 4]);
    await system.destroy();
  });

  it("is a different object from system.facts", async () => {
    let inside: unknown;
    const { system } = build({
      r: {
        deps: ["flag"],
        run: (facts: any) => {
          inside = facts;
        },
      },
    });
    await system.start();

    expect(inside).not.toBe(system.facts);
    await system.destroy();
  });
});

describe("prevFacts and derived are read-only in development", () => {
  it("writing prevFacts names it", async () => {
    quiet();
    const { system, errors, blocked } = build({
      w: {
        deps: ["count"],
        run: (_facts: any, prev: any) => {
          if (prev) {
            prev.count = 5;
          }
        },
      },
    });
    await system.start();
    expect(errors).toEqual([]);
    system.facts.count = 1;
    await system.settle();

    expect(errors).toHaveLength(1);
    expect(errors[0]![1].message).toMatch(/prevFacts\.count/);
    expect(blocked).toEqual([["w", "prevFacts.count"]]);
    await system.destroy();
  });

  it("writing derived names it", async () => {
    quiet();
    const { system, errors, blocked } = build({
      w: {
        deps: ["count"],
        run: (_facts: any, _prev: any, derived: any) => {
          derived.doubled = 5;
        },
      },
    });
    await system.start();

    expect(errors).toHaveLength(1);
    expect(errors[0]![1].message).toMatch(/derived\.doubled/);
    expect(blocked).toEqual([["w", "derived.doubled"]]);
    expect(system.derive.doubled).toBe(0);
    await system.destroy();
  });

  it("derived is readable, and the first run's prevFacts is null, not a view", async () => {
    const seen: any[] = [];
    const { system, errors } = build({
      r: {
        deps: ["count"],
        run: (_facts: any, prev: any, derived: any) => {
          seen.push([prev, derived.doubled]);
        },
      },
    });
    await system.start();
    system.facts.count = 2;
    await system.settle();

    expect(errors).toEqual([]);
    expect(seen[0]).toEqual([null, 0]);
    expect(seen[1][0].count).toBe(0);
    expect(seen[1][1]).toBe(4);
    await system.destroy();
  });

  it("prevFacts and derived reads leave no complaint behind", async () => {
    const { system, errors } = build({
      r: {
        deps: ["count"],
        run: (_facts: any, prev: any, derived: any) => {
          void prev?.count;
          void prev?.obj?.x;
          void derived.doubled;
        },
      },
    });
    await system.start();
    for (let n = 1; n <= 4; n++) {
      system.facts.count = n;
      await system.settle();
    }

    expect(errors).toEqual([]);
    await system.destroy();
  });
});

describe("an in-place change to a nested fact", () => {
  it("is reported to plugins, naming the effect and the path", async () => {
    quiet();
    const { system, errors, blocked } = build({
      m: {
        deps: ["flag"],
        run: (facts: any) => {
          facts.obj.x = 7;
        },
      },
    });
    await system.start();

    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe("m");
    expect(errors[0]![1].message).toMatch(/in place/);
    expect(errors[0]![1].message).toMatch(/obj/);
    expect(blocked.map(([id]) => id)).toEqual(["m"]);
    expect(blocked[0]![1]).toMatch(/^obj/);
    await system.destroy();
  });

  it("is reported when it happens after an await", async () => {
    quiet();
    const { system, errors } = build({
      m: {
        deps: ["flag"],
        run: async (facts: any) => {
          await Promise.resolve();
          facts.obj.x = 7;
        },
      },
    });
    await system.start();
    await system.settle();

    expect(errors.map(([id]) => id)).toEqual(["m"]);
    expect(errors[0]![1].message).toMatch(/in place/);
    await system.destroy();
  });

  it("is reported for an auto-tracked effect", async () => {
    quiet();
    const { system, errors } = build({
      m: {
        run: (facts: any) => {
          facts.obj.x = 7;
        },
      },
    });
    await system.start();

    expect(errors.map(([id]) => id)).toEqual(["m"]);
    await system.destroy();
  });

  it("is reported for an async auto-tracked effect", async () => {
    quiet();
    const { system, errors } = build({
      m: {
        run: async (facts: any) => {
          const o = facts.obj;
          await Promise.resolve();
          o.x = 7;
        },
      },
    });
    await system.start();
    await system.settle();

    expect(errors.map(([id]) => id)).toEqual(["m"]);
    await system.destroy();
  });

  it("is reported for a call()", async () => {
    quiet();
    let n = 10;
    const { system, errors } = build({
      m: {
        deps: ["count"],
        run: (facts: any) => {
          if (facts.count > 0) {
            facts.obj.x = ++n;
          }
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await system.settle();
    const before = errors.length;
    await system.effects.call("m");

    expect(errors.length).toBe(before + 1);
    expect(errors[errors.length - 1]![0]).toBe("m");
    await system.destroy();
  });

  it("is reported when an auto-tracked run happens through the stable path", async () => {
    quiet();
    const { system, errors } = build({
      m: {
        run: (facts: any) => {
          void facts.count;
          if (facts.count >= 6) {
            facts.obj.x = facts.count;
          }
        },
      },
    });
    await system.start();
    for (let n = 1; n <= 8; n++) {
      system.facts.count = n;
      await system.settle();
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    await system.destroy();
  });

  it("a nested read leaves no complaint behind", async () => {
    const { system, errors } = build({
      m: {
        deps: ["count"],
        run: (facts: any) => {
          void facts.obj.x;
        },
      },
    });
    await system.start();
    for (let n = 1; n <= 3; n++) {
      system.facts.count = n;
      await system.settle();
    }

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("two overlapping async runs of one effect both finish quietly", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { system, errors } = build({
      m: {
        deps: ["count"],
        run: async (facts: any) => {
          const n = facts.count;
          void facts.obj.x;
          if (n > 0) {
            await gate;
          }
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    const first = system.settle();
    release();
    await first;
    system.facts.count = 2;
    await system.settle();

    expect(errors).toEqual([]);
    await system.destroy();
  });
});

describe("a reported write reaches the error boundary too", () => {
  it("the boundary's callback sees the effect id", async () => {
    quiet();
    const onEffectError = vi.fn();
    const { system } = build(
      {
        w: {
          deps: ["flag"],
          run: (facts: any) => {
            facts.count = 99;
          },
        },
      },
      { errorBoundary: { onEffectError } },
    );
    await system.start();

    expect(onEffectError).toHaveBeenCalledTimes(1);
    expect(onEffectError.mock.calls[0]![1]).toBe("w");
    await system.destroy();
  });
});
