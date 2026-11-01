// Ported from packages/core/src/core/__tests__/l5-sources-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box pins for the engine's side of sources (L5): the plugin hooks a
// source's lifecycle reaches, the publish guards and the reason each drop
// reports, a namespaced source's own-module scoping, the gate evaluated at
// start, and detach on stop. Public API only. The logged text is never
// asserted, except that the cross-module warning names the bare event to
// publish instead (the fix it carries) and speaks once per source.

afterEach(() => {
  vi.restoreAllMocks();
});

type Publish = (eventName: string, payload?: unknown) => void;
type Handles = Record<string, Publish>;

/** A plugin that records every source hook it hears, in order. */
function recorder() {
  const log: unknown[][] = [];
  const plugin = {
    name: "sources-recorder",
    onSourceAttach: (id: string, moduleId: string) => {
      log.push(["attach", id, moduleId]);
    },
    onSourcePublish: (id: string, _moduleId: string, eventName: string) => {
      log.push(["publish", id, eventName]);
    },
    onSourceDrop: (
      id: string,
      _moduleId: string,
      eventName: string,
      reason: string,
    ) => {
      log.push(["drop", id, eventName, reason]);
    },
    onSourceDetach: (id: string, moduleId: string) => {
      log.push(["detach", id, moduleId]);
    },
    onSourceError: (
      id: string,
      moduleId: string,
      phase: string,
      error: unknown,
    ) => {
      log.push(["error", id, moduleId, phase, (error as Error).message]);
    },
  };

  return { log, plugin };
}

/** A module whose `poke` event counts; `sources` defaults to one `feed`. */
function pokeModule(
  id: string,
  handles: Handles,
  sources?: Record<string, unknown>,
) {
  return createModule(id, {
    schema: {
      facts: { hits: t.number(), open: t.boolean() },
      derivations: {},
      events: { poke: {} },
    },
    init: (facts: any) => {
      facts.hits = 0;
      facts.open = true;
    },
    events: {
      poke: (facts: any) => {
        facts.hits += 1;
      },
    },
    sources: sources ?? {
      feed: {
        attach: (publish: Publish) => {
          handles.feed = publish;

          return () => undefined;
        },
      },
    },
  } as any);
}

describe("plugins and a source's lifecycle", () => {
  it("hear its attach at start, its publish, and its detach at stop, which unsubscribes it", async () => {
    const handles: Handles = {};
    const { log, plugin } = recorder();
    let unsubscribed = 0;
    const system = createSystem({
      module: pokeModule("m", handles, {
        feed: {
          attach: (publish: Publish) => {
            handles.feed = publish;

            return () => {
              unsubscribed += 1;
            };
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    expect(log).toEqual([["attach", "feed", "m"]]);

    handles.feed!("poke");
    await system.settle();
    expect((system.facts as any).hits).toBe(1);
    expect(log).toEqual([
      ["attach", "feed", "m"],
      ["publish", "feed", "poke"],
    ]);

    system.stop();
    expect(unsubscribed).toBe(1);
    expect(log).toEqual([
      ["attach", "feed", "m"],
      ["publish", "feed", "poke"],
      ["detach", "feed", "m"],
    ]);
    system.destroy();
  });
});

describe("a source whose attach throws", () => {
  it("is reported to plugins as an attach error, and the next source still attaches", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: pokeModule("m", handles, {
        broken: {
          attach: () => {
            throw new Error("no transport");
          },
        },
        feed: {
          attach: (publish: Publish) => {
            handles.feed = publish;

            return () => undefined;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();

    expect(log).toEqual([
      ["error", "broken", "m", "attach", "no transport"],
      ["attach", "feed", "m"],
    ]);
    system.destroy();
  });
});

describe("a publish the engine refuses", () => {
  it("is a drop with its reason: an empty name, a blocked name, a name with no handler", async () => {
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: pokeModule("m", handles),
      plugins: [plugin],
    } as any);
    system.start();
    log.length = 0;

    handles.feed!("");
    handles.feed!("__proto__");
    handles.feed!("nope");
    await system.settle();

    expect(log).toEqual([
      ["drop", "feed", "", "invalid-event-name"],
      ["drop", "feed", "__proto__", "blocked-event-name"],
      ["drop", "feed", "nope", "unknown-event"],
    ]);
    expect((system.facts as any).hits).toBe(0);
    system.destroy();
  });

  it("is dropped as post-stop when a source still attached publishes while the system stops", async () => {
    // Sources detach in reverse registration order, so `late`'s unsubscribe
    // runs while `early` is still attached: `early`'s publish reaches the
    // engine after the system stopped running.
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = createSystem({
      module: pokeModule("m", handles, {
        early: {
          attach: (publish: Publish) => {
            handles.early = publish;

            return () => undefined;
          },
        },
        late: {
          attach: () => () => handles.early!("poke"),
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    log.length = 0;

    system.stop();
    await system.settle();

    expect(log).toEqual([
      ["detach", "late", "m"],
      ["drop", "early", "poke", "post-stop"],
      ["detach", "early", "m"],
    ]);
    expect((system.facts as any).hits).toBe(0);
    system.destroy();
  });

  it("is dropped as post-destroy when a source attached again during destroy publishes after it", () => {
    // The only public way to hold an attached source past destroy(): destroy
    // stops the system before it marks it destroyed, and a plugin that starts
    // it again from every onStop attaches the sources anew each time.
    const handles: Handles = {};
    const { log, plugin } = recorder();
    let restartOnStop = true;
    const system: any = createSystem({
      module: pokeModule("m", handles),
      plugins: [
        plugin,
        {
          name: "restart-on-stop",
          onStop: (sys: any) => {
            if (restartOnStop) sys.start();
          },
        },
      ],
    } as any);
    system.start();
    system.destroy();
    restartOnStop = false;
    log.length = 0;

    handles.feed!("poke");

    expect(log).toEqual([["drop", "feed", "poke", "post-destroy"]]);
  });
});

describe("a namespaced source", () => {
  function composed(handles: Handles, plugin: object) {
    return createSystem({
      modules: {
        loop: pokeModule("loop", handles),
        other: pokeModule("other", {}, {}),
      },
      plugins: [plugin],
    } as any) as any;
  }

  it("publishes its own module's event by its bare name", async () => {
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = composed(handles, plugin);
    system.start();
    log.length = 0;

    handles.feed!("poke");
    await system.settle();

    expect(system.facts.loop.hits).toBe(1);
    expect(system.facts.other.hits).toBe(0);
    expect(log).toEqual([["publish", "loop::feed", "loop::poke"]]);
    system.destroy();
  });

  it("drops another module's event as cross-module, and development warns once per source", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = composed(handles, plugin);
    system.start();
    log.length = 0;

    handles.feed!("other::poke");
    handles.feed!("other::poke");
    await system.settle();

    expect(system.facts.loop.hits).toBe(0);
    expect(system.facts.other.hits).toBe(0);
    expect(log).toEqual([
      ["drop", "loop::feed", "other::poke", "cross-module-event"],
      ["drop", "loop::feed", "other::poke", "cross-module-event"],
    ]);
    const aboutFeed = warn.mock.calls.filter((call) =>
      String(call[0]).includes("loop::feed"),
    );
    expect(aboutFeed).toHaveLength(1);
    system.destroy();
  });

  it("drops its own event named with its prefix, and the warning names the bare event to publish", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handles: Handles = {};
    const { log, plugin } = recorder();
    const system = composed(handles, plugin);
    system.start();
    log.length = 0;

    handles.feed!("loop::poke");
    await system.settle();

    expect(system.facts.loop.hits).toBe(0);
    expect(log).toEqual([
      ["drop", "loop::feed", "loop::poke", "cross-module-event"],
    ]);
    const aboutFeed = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes("loop::feed"));
    expect(aboutFeed).toHaveLength(1);
    expect(aboutFeed[0]).toContain('"poke"');
    system.destroy();
  });
});

describe("a gated source", () => {
  it("whose gate is open at start is attached when start() returns", async () => {
    const handles: Handles = {};
    const { log, plugin } = recorder();
    let attaches = 0;
    const system: any = createSystem({
      module: pokeModule("m", handles, {
        gated: {
          active: (facts: any) => facts.open === true,
          attach: (publish: Publish) => {
            attaches += 1;
            handles.gated = publish;

            return () => undefined;
          },
        },
      }),
      plugins: [plugin],
    } as any);
    system.start();
    expect(attaches).toBe(1);
    expect(log).toEqual([["attach", "gated", "m"]]);

    handles.gated!("poke");
    await system.settle();
    expect(system.facts.hits).toBe(1);
    expect(attaches).toBe(1);
    system.destroy();
  });
});
