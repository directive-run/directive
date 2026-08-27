import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * Snapshot serialization degraded through three tiers in silence:
 * `structuredClone`, then `JSON.parse(JSON.stringify(…))`, then a shallow
 * spread — both fallbacks behind bare `catch` blocks.
 *
 * The last tier is the dangerous one. A shallow copy aliases every nested
 * object, so mutating a fact after a snapshot was taken rewrites the snapshot
 * too. Time travel then shows a past that never happened, which is worse than
 * refusing to record one: an operator comparing two points in history is given
 * a difference that was manufactured by the reading.
 *
 * Reaching that tier needs two different hostile values at once — something
 * `structuredClone` rejects (a function) and something `JSON.stringify` rejects
 * (a bigint) — which is why it went unnoticed.
 */

const consoleWarn = vi.spyOn(console, "warn");

beforeEach(() => {
  consoleWarn.mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarn.mockReset();
});

function hostileModule() {
  return createModule("hostile", {
    schema: {
      facts: {
        // Rejected by structuredClone.
        callback: t.any(),
        // Rejected by JSON.stringify.
        huge: t.bigint(),
        // The value that must not be aliased into the snapshot.
        nested: t.object<{ n: number }>(),
        tick: t.number(),
      },
      events: { bump: {} },
    },
    init: (facts) => {
      facts.callback = () => undefined;
      facts.huge = 1n;
      facts.nested = { n: 1 };
      facts.tick = 0;
    },
    events: {
      bump: (facts) => {
        facts.tick = facts.tick + 1;
      },
    },
  });
}

describe("history snapshots never alias live state", () => {
  it("does not let a later mutation rewrite a snapshot already taken", async () => {
    const system = createSystem({
      module: hostileModule(),
      history: { maxSnapshots: 10 },
    });
    system.start();

    system.events.bump();
    await system.settle();
    const takenAt = system.history?.snapshots.length ?? 0;
    expect(takenAt).toBeGreaterThan(0);

    // Mutate the nested object in place, exactly as application code would.
    const live = system.facts.nested as { n: number };
    live.n = 999;

    const recorded = system.history?.snapshots.at(-1)?.facts as Record<
      string,
      unknown
    >;
    const snapshotNested = recorded?.nested as { n: number } | undefined;

    // If the snapshot aliases the live object this reads 999.
    expect(snapshotNested?.n).not.toBe(999);

    system.destroy();
  });

  it("names the fact it could not capture", async () => {
    // A distinct key, because the report is deduplicated at module scope: the
    // same fact shape warns once ever, not once per system.
    const opaque = createModule("opaque", {
      schema: {
        facts: { liveHandle: t.any(), enormous: t.bigint(), tick: t.number() },
        events: { bump: {} },
      },
      init: (facts) => {
        facts.liveHandle = () => undefined;
        facts.enormous = 2n;
        facts.tick = 0;
      },
      events: {
        bump: (facts) => {
          facts.tick = facts.tick + 1;
        },
      },
    });

    const system = createSystem({
      module: opaque,
      history: { maxSnapshots: 10 },
    });
    system.start();
    system.events.bump();
    await system.settle();

    const message = consoleWarn.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("cannot be captured in history"));

    expect(message).toBeDefined();
    expect(message).toContain("liveHandle");
    // The old text blamed class instances, which clone fine and never reach
    // this path — it sent people looking for the wrong cause.
    expect(message).not.toContain("class instance");

    system.destroy();
  });

  it("keeps the facts it can capture rather than degrading the whole snapshot", async () => {
    const system = createSystem({
      module: hostileModule(),
      history: { maxSnapshots: 10 },
    });
    system.start();
    system.events.bump();
    await system.settle();

    const recorded = system.history?.snapshots.at(-1)?.facts as Record<
      string,
      unknown
    >;

    // One uncloneable fact must not cost the rest of the snapshot.
    expect(recorded?.tick).toBe(1);
    expect((recorded?.nested as { n: number })?.n).toBe(1);

    system.destroy();
  });

  it("still deep-clones ordinary facts", async () => {
    const plain = createModule("plain", {
      schema: {
        facts: { box: t.object<{ n: number }>(), tick: t.number() },
        events: { bump: {} },
      },
      init: (facts) => {
        facts.box = { n: 1 };
        facts.tick = 0;
      },
      events: {
        bump: (facts) => {
          facts.tick = facts.tick + 1;
        },
      },
    });

    const system = createSystem({
      module: plain,
      history: { maxSnapshots: 10 },
    });
    system.start();
    system.events.bump();
    await system.settle();

    const live = system.facts.box as { n: number };
    live.n = 42;

    const recorded = system.history?.snapshots.at(-1)?.facts as Record<
      string,
      unknown
    >;
    expect((recorded?.box as { n: number })?.n).toBe(1);

    system.destroy();
  });
});

describe("history and the development warning proxies", () => {
  it("captures and restores a fact updated the documented way", async () => {
    // `facts.doc = { ...facts.doc, title }` is the immutable update the
    // architecture docs recommend — and it reads every nested value through the
    // dev warning proxy and spreads the results, so the wrappers get stored.
    // `structuredClone` refuses a Proxy, which made an ordinary fact holding a
    // string and a Date uncapturable, and time travel silently stopped
    // restoring it.
    const doc = createModule("doc", {
      schema: {
        facts: {
          body: t.object<{ title: string; when: Date }>(),
          tick: t.number(),
        },
        events: { touch: {} },
      },
      init: (facts) => {
        facts.body = { title: "v0", when: new Date(0) };
        facts.tick = 0;
      },
      events: {
        touch: (facts) => {
          facts.body = { ...facts.body, title: `v${facts.tick + 1}` };
          facts.tick = facts.tick + 1;
        },
      },
    });

    const system = createSystem({
      module: doc,
      history: { maxSnapshots: 20 },
    });
    system.start();
    await system.settle();

    system.events.touch();
    await system.settle();
    system.events.touch();
    await system.settle();

    expect((system.facts.body as { title: string }).title).toBe("v2");

    system.history?.goBack();

    expect(system.facts.tick).toBe(1);
    // The fact that used to be dropped from every snapshot.
    expect((system.facts.body as { title: string }).title).toBe("v1");

    system.destroy();
  });

  it("leaves an uncapturable fact at its current value when restoring", async () => {
    // The promise the warning makes, pinned. An omitted key is not written on
    // restore, so it keeps whatever it holds now.
    const mixed = createModule("mixed", {
      schema: {
        facts: { handle: t.any(), big: t.bigint(), tick: t.number() },
        events: { bump: {} },
      },
      init: (facts) => {
        facts.handle = () => "first";
        facts.big = 3n;
        facts.tick = 0;
      },
      events: {
        bump: (facts) => {
          facts.tick = facts.tick + 1;
        },
      },
    });

    const system = createSystem({
      module: mixed,
      history: { maxSnapshots: 20 },
    });
    system.start();
    await system.settle();
    system.events.bump();
    await system.settle();
    system.events.bump();
    await system.settle();

    const replacement = () => "second";
    system.facts.handle = replacement;

    system.history?.goBack();

    expect(system.facts.tick).toBe(1);
    expect(system.facts.handle).toBe(replacement);

    system.destroy();
  });
});
