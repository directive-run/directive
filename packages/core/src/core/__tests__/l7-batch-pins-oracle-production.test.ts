import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

// The production half of the L7 RFC's U9. In development, a batched resolver
// with no handler at all throws at createSystem. Production checks nothing:
// the system builds, and each requirement completes with no code run.
// Public API only.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a batched resolver with no handler, in production (U9)", () => {
  it("builds with no error and completes each requirement once the window closes", async () => {
    const log: string[] = [];
    const t0 = Date.now();
    const plugin = {
      name: "rec",
      onResolverComplete: (_resolver: string, req: { id: string }) => {
        log.push(`complete ${req.id} @${Date.now() - t0}`);
      },
      onResolverError: (_resolver: string, req: { id: string }) => {
        log.push(`error ${req.id}`);
      },
    };
    const mod = createModule("m", {
      schema: {
        facts: { want: t.array<string>() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.want = [];
      },
      constraints: {
        fetch: {
          when: (f: any) => f.want.length > 0,
          require: (f: any) =>
            f.want.map((id: string) => ({ type: "FETCH", id })),
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (req: { id: string }) => req.id,
          batch: { enabled: true, windowMs: 10 },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [plugin],
    } as never) as any;
    system.start();
    system.facts.want = ["a", "b"];
    await vi.advanceTimersByTimeAsync(100);

    expect(log).toEqual(["complete a @10", "complete b @10"]);
    system.destroy();
  });
});
