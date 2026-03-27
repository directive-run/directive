// @ts-nocheck
import { describe, it, expect, vi } from "vitest";
import { effectScope } from "vue";
import { useQuerySystem } from "../index";

function createMockSystem(opts: { autoStart?: boolean } = {}) {
  const system = {
    isRunning: false,
    start: vi.fn(() => {
      system.isRunning = true;
    }),
    destroy: vi.fn(() => {
      system.isRunning = false;
    }),
    queries: { user: { refetch: vi.fn() } },
    mutations: { update: { mutate: vi.fn() } },
  };
  if (opts.autoStart !== false) {
    system.start();
  }

  return system;
}

describe("useQuerySystem (Vue)", () => {
  it("creates the system from factory", () => {
    const scope = effectScope();
    const mock = createMockSystem({ autoStart: false });

    let result: typeof mock | undefined;
    scope.run(() => {
      result = useQuerySystem(() => mock);
    });

    expect(result).toBe(mock);
    scope.stop();
  });

  it("destroys on scope dispose", () => {
    const scope = effectScope();
    const mock = createMockSystem({ autoStart: false });

    scope.run(() => {
      useQuerySystem(() => mock);
    });

    expect(mock.destroy).not.toHaveBeenCalled();
    scope.stop();
    expect(mock.destroy).toHaveBeenCalledTimes(1);
  });

  it("returns bound handles", () => {
    const scope = effectScope();
    const mock = createMockSystem({ autoStart: false });

    let result: typeof mock | undefined;
    scope.run(() => {
      result = useQuerySystem(() => mock);
    });

    expect(result!.queries.user.refetch).toBeTypeOf("function");
    expect(result!.mutations.update.mutate).toBeTypeOf("function");
    scope.stop();
  });
});
