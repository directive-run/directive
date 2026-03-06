import { describe, it, expect, vi } from "vitest";
import { killAll } from "../kill-switch.js";

describe("kill switch", () => {
  function mockSystem() {
    return {
      constraints: {
        unregister: vi.fn(),
      },
      resolvers: {
        unregister: vi.fn(),
      },
      effects: {
        unregister: vi.fn(),
      },
    };
  }

  it("removes all tracked definitions", () => {
    const system = mockSystem();
    const dynamicIds = new Set([
      "constraint::auto-retry",
      "constraint::error-handler",
      "resolver::fix-error",
    ]);

    const result = killAll(system as never, dynamicIds);

    expect(result.removed).toBe(3);
    expect(result.definitions).toHaveLength(3);
    expect(system.constraints.unregister).toHaveBeenCalledWith("auto-retry");
    expect(system.constraints.unregister).toHaveBeenCalledWith("error-handler");
    expect(system.resolvers.unregister).toHaveBeenCalledWith("fix-error");
  });

  it("clears the dynamicIds set", () => {
    const system = mockSystem();
    const dynamicIds = new Set(["constraint::test"]);

    killAll(system as never, dynamicIds);

    expect(dynamicIds.size).toBe(0);
  });

  it("returns timestamp", () => {
    const system = mockSystem();
    const dynamicIds = new Set<string>();

    const result = killAll(system as never, dynamicIds);

    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.removed).toBe(0);
  });

  it("handles empty set", () => {
    const system = mockSystem();
    const dynamicIds = new Set<string>();

    const result = killAll(system as never, dynamicIds);

    expect(result.removed).toBe(0);
    expect(result.definitions).toHaveLength(0);
  });

  it("continues on failure (best-effort)", () => {
    const system = mockSystem();
    system.constraints.unregister.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const dynamicIds = new Set([
      "constraint::failing",
      "resolver::succeeding",
    ]);

    const result = killAll(system as never, dynamicIds);

    // One failed, one succeeded
    expect(result.removed).toBe(1);
    expect(system.resolvers.unregister).toHaveBeenCalledWith("succeeding");
  });

  it("handles effects correctly", () => {
    const system = mockSystem();
    const dynamicIds = new Set(["effect::log-errors"]);

    const result = killAll(system as never, dynamicIds);

    expect(result.removed).toBe(1);
    expect(system.effects.unregister).toHaveBeenCalledWith("log-errors");
  });

  it("skips malformed entries", () => {
    const system = mockSystem();
    const dynamicIds = new Set(["no-separator", "constraint::valid"]);

    const result = killAll(system as never, dynamicIds);

    expect(result.removed).toBe(1);
    expect(result.definitions[0]!.id).toBe("valid");
  });
});
