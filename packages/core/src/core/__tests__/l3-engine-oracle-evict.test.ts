/**
 * evict(): the host runtime is about to drop the system. While it runs,
 * start() is ignored.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

function hanging(slowDestroyMs = 0) {
  const starts: string[] = [];
  const plugin = {
    name: "starts",
    onStart: () => {
      starts.push("start");
    },
  };
  const mod = createModule("hang", {
    schema: {
      facts: { go: t.boolean() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
    },
    constraints: {
      load: { when: (facts: any) => facts.go, require: { type: "LOAD" } },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        // Takes its time to wind down once told to stop.
        resolve: async (_req: unknown, context: any) => {
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => {
              setTimeout(resolve, slowDestroyMs);
            });
          });
        },
      },
    },
  } as never);
  const system: any = createSystem({ module: mod, plugins: [plugin] });

  return { system, starts };
}

describe("start() while evict() is running", () => {
  it("is ignored: the system does not start", async () => {
    const { system, starts } = hanging();

    const evicting = system.evict();
    system.start();
    await evicting;

    expect(starts).toEqual([]);
    expect(system.isRunning).toBe(false);
  });
});
