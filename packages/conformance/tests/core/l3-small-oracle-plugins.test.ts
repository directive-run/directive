// Ported from packages/core/src/core/__tests__/l3-small-oracle-plugins.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the plugin API's init hook: onInit runs once per plugin,
// in registration order, awaited one at a time, and a plugin that fails does
// not stop the rest. Public API only; the logged text is never asserted.

afterEach(() => {
  vi.restoreAllMocks();
});

const mod = createModule("m", {
  schema: { facts: { n: t.number() }, derivations: {}, events: {} },
  init: (facts: any) => {
    facts.n = 0;
  },
});

/** Let every pending microtask and the awaited plugin chain finish. */
const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("plugin onInit", () => {
  it("runs once per plugin, in registration order, each awaited before the next", async () => {
    const calls: string[] = [];
    createSystem({
      module: mod,
      plugins: [
        {
          name: "a",
          onInit: () => {
            calls.push("a");
          },
        },
        {
          name: "b",
          onInit: async () => {
            calls.push("b:start");
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
            calls.push("b:end");
          },
        },
        {
          name: "c",
          onInit: () => {
            calls.push("c");
          },
        },
      ],
    } as never);

    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(calls).toEqual(["a", "b:start", "b:end", "c"]);
  });

  it("is handed the system", async () => {
    const seen: any[] = [];
    createSystem({
      module: mod,
      plugins: [
        {
          name: "p",
          onInit: (system: unknown) => {
            seen.push(system);
          },
        },
      ],
    } as never);

    await idle();

    expect(seen).toHaveLength(1);
    expect(typeof seen[0].facts).toBe("object");
  });

  it("a plugin without onInit starts quietly", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    createSystem({ module: mod, plugins: [{ name: "quiet" }] } as never);

    await idle();

    expect(error).not.toHaveBeenCalled();
  });

  it("a throwing or rejecting onInit is reported, and the next plugin still starts", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const good = vi.fn();
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "bad-sync",
          onInit: () => {
            throw new Error("sync failure");
          },
        },
        {
          name: "bad-async",
          onInit: async () => {
            throw new Error("async failure");
          },
        },
        { name: "good", onInit: good },
      ],
    } as never) as any;

    await idle();

    expect(good).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      plugin: "bad-sync",
      hook: "onInit",
    });
    expect(error.mock.calls[1]?.[1]).toMatchObject({
      plugin: "bad-async",
      hook: "onInit",
    });

    system.start();
    system.facts.n = 5;
    expect(system.facts.n).toBe(5);
  });
});
