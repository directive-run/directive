import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

// The error boundary in production: the same strategies, no development
// warnings. Public API only.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function build(errorBoundary?: Record<string, unknown>) {
  const recovery: [string, string, string][] = [];
  const mod = createModule("m", {
    schema: {
      facts: { x: t.number(), go: t.boolean() },
      derivations: { dd: t.number() },
      events: { bump: {} },
      requirements: { R: {} },
    },
    init: (facts: any) => {
      facts.x = 0;
      facts.go = false;
    },
    events: {
      bump: (facts: any) => {
        facts.x = facts.x + 1;
      },
    },
    derive: {
      dd: (facts: any) => {
        if (facts.x > 0) {
          throw new Error("derivation boom");
        }

        return facts.x;
      },
    },
    constraints: {
      probe: {
        when: (facts: any) => {
          if (facts.x > 0) {
            throw new Error("constraint boom");
          }

          return false;
        },
        require: { type: "R" },
      },
      need: { when: (facts: any) => facts.go === true, require: { type: "R" } },
    },
    resolvers: {
      work: {
        requirement: "R",
        resolve: async () => {
          throw new Error("resolver boom");
        },
      },
    },
  } as never);
  const system: any = createSystem({
    module: mod,
    errorBoundary,
    plugins: [
      {
        name: "watch",
        onErrorRecovery: (e: any, s: string) =>
          recovery.push([e.source, e.sourceId, s]),
      },
    ],
  } as never);

  return { system, recovery };
}

describe("the error boundary in production", () => {
  it("skips an unhandled error from a constraint, a resolver and a derivation without a word", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, recovery } = build();
    system.start();
    system.events.bump();
    system.facts.go = true;
    await system.settle();
    try {
      system.read("dd");
    } catch {
      // expected
    }

    expect(recovery).toHaveLength(3);
    expect(recovery.every((r) => r[2] === "skip")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("retry-later gives up silently once its attempts are used", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system, recovery } = build({
      onConstraintError: "retry-later",
      retryLater: { delayMs: 1000, maxRetries: 2 },
    });
    system.start();
    system.events.bump();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(recovery.map((r) => r[2])).toEqual([
      "retry-later",
      "retry-later",
      "skip",
    ]);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });
});
