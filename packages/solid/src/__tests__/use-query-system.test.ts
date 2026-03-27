import { describe, it, expect, vi } from "vitest";
import { useQuerySystem } from "../index";

// Note: Solid's onCleanup requires reactive context.
// We test the export exists and type shape.

function createMockSystem() {
  const system = {
    isRunning: true,
    start: vi.fn(),
    destroy: vi.fn(),
    queries: { user: { refetch: vi.fn() } },
    mutations: { update: { mutate: vi.fn() } },
  };

  return system;
}

describe("useQuerySystem (Solid)", () => {
  it("is exported as a function", () => {
    expect(useQuerySystem).toBeTypeOf("function");
  });

  it("mock system has expected shape", () => {
    const mock = createMockSystem();
    expect(mock.queries.user.refetch).toBeTypeOf("function");
    expect(mock.mutations.update.mutate).toBeTypeOf("function");
  });
});
