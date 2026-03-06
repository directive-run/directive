import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCustomToolRegistry } from "../custom-tools.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { ArchitectEvent } from "../types.js";

describe("createCustomToolRegistry", () => {
  it("registers and exposes a read tool", () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "check_health",
      description: "Check system health",
      parameters: {},
      handler: () => ({ success: true, data: { healthy: true } }),
    });

    expect(registry.size()).toBe(1);

    const defs = registry.getToolDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: "check_health",
      description: "Check system health",
      mutates: false,
    });
  });

  it("registers a mutating tool", () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "restart_service",
      description: "Restart a service",
      parameters: {
        service: { type: "string", description: "Service name", required: true },
      },
      mutates: true,
      handler: () => ({ success: true }),
    });

    const defs = registry.getToolDefs();
    expect(defs[0]!.mutates).toBe(true);
  });

  it("rejects built-in tool names", () => {
    const registry = createCustomToolRegistry();

    expect(() => {
      registry.register({
        name: "observe_system",
        description: "Conflicting tool",
        parameters: {},
        handler: () => ({ success: true }),
      });
    }).toThrow("conflicts with built-in tool");

    expect(() => {
      registry.register({
        name: "create_constraint",
        description: "Conflicting tool",
        parameters: {},
        handler: () => ({ success: true }),
      });
    }).toThrow("conflicts with built-in tool");
  });

  it("enforces max tools limit", () => {
    const registry = createCustomToolRegistry(2);

    registry.register({
      name: "tool_a",
      description: "A",
      parameters: {},
      handler: () => ({ success: true }),
    });

    registry.register({
      name: "tool_b",
      description: "B",
      parameters: {},
      handler: () => ({ success: true }),
    });

    expect(() => {
      registry.register({
        name: "tool_c",
        description: "C",
        parameters: {},
        handler: () => ({ success: true }),
      });
    }).toThrow("max tools limit");
  });

  it("allows re-registering existing tool (overwrite)", () => {
    const registry = createCustomToolRegistry(2);

    registry.register({
      name: "tool_a",
      description: "Version 1",
      parameters: {},
      handler: () => ({ success: true }),
    });

    registry.register({
      name: "tool_b",
      description: "B",
      parameters: {},
      handler: () => ({ success: true }),
    });

    // Re-register tool_a (should not count against limit)
    registry.register({
      name: "tool_a",
      description: "Version 2",
      parameters: {},
      handler: () => ({ success: true, data: "v2" }),
    });

    expect(registry.size()).toBe(2);
    expect(registry.getToolDefs().find((d) => d.name === "tool_a")!.description).toBe("Version 2");
  });

  it("unregisters a tool", () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "my_tool",
      description: "My tool",
      parameters: {},
      handler: () => ({ success: true }),
    });

    expect(registry.unregister("my_tool")).toBe(true);
    expect(registry.size()).toBe(0);
    expect(registry.unregister("my_tool")).toBe(false);
  });

  it("executes a sync handler", async () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "greet",
      description: "Greet a user",
      parameters: {
        name: { type: "string", description: "Name", required: true },
      },
      handler: (args) => ({
        success: true,
        data: `Hello, ${args.name}!`,
      }),
    });

    const ctx = {
      facts: Object.freeze({ phase: "running" }),
      inspect: () => ({}),
    };

    const result = await registry.execute("greet", { name: "Alice" }, ctx);
    expect(result).toEqual({ success: true, data: "Hello, Alice!" });
  });

  it("executes an async handler", async () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "fetch_data",
      description: "Fetch data",
      parameters: {},
      handler: async () => {
        await new Promise((r) => setTimeout(r, 10));

        return { success: true, data: { fetched: true } };
      },
    });

    const ctx = { facts: Object.freeze({}), inspect: () => ({}) };
    const result = await registry.execute("fetch_data", {}, ctx);
    expect(result).toEqual({ success: true, data: { fetched: true } });
  });

  it("returns null for unknown tool", () => {
    const registry = createCustomToolRegistry();
    const ctx = { facts: Object.freeze({}), inspect: () => ({}) };

    expect(registry.execute("nonexistent", {}, ctx)).toBeNull();
  });

  it("catches handler that throws", async () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "bad_tool",
      description: "Always throws",
      parameters: {},
      handler: () => {
        throw new Error("Handler exploded");
      },
    });

    const ctx = { facts: Object.freeze({}), inspect: () => ({}) };
    const result = await registry.execute("bad_tool", {}, ctx);
    expect(result).toMatchObject({ success: false, error: "Handler exploded" });
  });

  it("catches async handler that rejects", async () => {
    const registry = createCustomToolRegistry();

    registry.register({
      name: "failing_async",
      description: "Rejects",
      parameters: {},
      handler: async () => {
        throw new Error("Async failure");
      },
    });

    const ctx = { facts: Object.freeze({}), inspect: () => ({}) };
    const result = await registry.execute("failing_async", {}, ctx);
    expect(result).toMatchObject({ success: false, error: "Async failure" });
  });

  it("handler receives read-only facts", async () => {
    const registry = createCustomToolRegistry();
    let receivedFacts: unknown;

    registry.register({
      name: "read_ctx",
      description: "Read context",
      parameters: {},
      handler: (_args, ctx) => {
        receivedFacts = ctx.facts;

        return { success: true, data: ctx.facts };
      },
    });

    const facts = Object.freeze({ phase: "running", count: 42 });
    const ctx = { facts, inspect: () => ({}) };
    await registry.execute("read_ctx", {}, ctx);

    expect(receivedFacts).toEqual({ phase: "running", count: 42 });
    expect(Object.isFrozen(receivedFacts)).toBe(true);
  });

  it("handler can call inspect()", async () => {
    const registry = createCustomToolRegistry();
    let inspected: unknown;

    registry.register({
      name: "inspect_tool",
      description: "Inspect system",
      parameters: {},
      handler: (_args, ctx) => {
        inspected = ctx.inspect();

        return { success: true };
      },
    });

    const inspectData = { settled: true, requirements: [] };
    const ctx = { facts: Object.freeze({}), inspect: () => inspectData };
    await registry.execute("inspect_tool", {}, ctx);

    expect(inspected).toEqual(inspectData);
  });

  it("times out slow async handlers", async () => {
    const registry = createCustomToolRegistry(20, 50); // 50ms timeout

    registry.register({
      name: "slow_tool",
      description: "Very slow",
      parameters: {},
      handler: async () => {
        await new Promise((r) => setTimeout(r, 200));

        return { success: true };
      },
    });

    const ctx = { facts: Object.freeze({}), inspect: () => ({}) };
    const result = await registry.execute("slow_tool", {}, ctx);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("timed out"),
    });
  });
});

describe("custom tools integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("architect exposes registerTool and unregisterTool", () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
    });

    // Register a custom tool
    architect.registerTool({
      name: "custom_check",
      description: "Custom check",
      parameters: {},
      handler: () => ({ success: true }),
    });

    // Unregister it
    expect(architect.unregisterTool("custom_check")).toBe(true);
    expect(architect.unregisterTool("custom_check")).toBe(false);

    architect.destroy();
  });

  it("custom tools provided via options are registered", () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
      customTools: [
        {
          name: "my_tool",
          description: "My custom tool",
          parameters: {},
          handler: () => ({ success: true }),
        },
      ],
    });

    // Tool should be available (verify by trying to unregister)
    expect(architect.unregisterTool("my_tool")).toBe(true);

    architect.destroy();
  });

  it("custom tool is executed via pipeline when LLM calls it", async () => {
    const system = createTestSystem({ phase: "running" });
    const handlerSpy = vi.fn(() => ({ success: true, data: { result: "custom output" } }));

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        {
          toolCalls: [{ name: "my_custom_tool", arguments: '{"key":"value"}' }],
          totalTokens: 50,
        },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      customTools: [
        {
          name: "my_custom_tool",
          description: "A custom tool for testing",
          parameters: {
            key: { type: "string", description: "A key", required: true },
          },
          handler: handlerSpy,
        },
      ],
    });

    const events: ArchitectEvent[] = [];
    architect.on((e) => events.push(e));

    await architect.analyze();

    // The handler should have been called
    expect(handlerSpy).toHaveBeenCalled();
    expect(handlerSpy.mock.calls[0]![0]).toEqual({ key: "value" });

    // Should have applied event
    const applied = events.filter((e) => e.type === "applied");
    expect(applied.length).toBeGreaterThan(0);

    architect.destroy();
  });

  it("rejects built-in tool name via registerTool", () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([]),
      budget: { tokens: 100_000, dollars: 10 },
    });

    expect(() => {
      architect.registerTool({
        name: "rollback",
        description: "Bad tool",
        parameters: {},
        handler: () => ({ success: true }),
      });
    }).toThrow("conflicts with built-in tool");

    architect.destroy();
  });

  it("runtime-registered tool is available in next analysis", async () => {
    const system = createTestSystem({ phase: "running" });
    const handlerSpy = vi.fn(() => ({ success: true }));

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        // First analysis: uses observe_system
        { toolCalls: [{ name: "observe_system", arguments: "{}" }], totalTokens: 50 },
        // Second analysis: uses custom tool
        { toolCalls: [{ name: "late_tool", arguments: "{}" }], totalTokens: 50 },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
    });

    // First analysis — no custom tool yet
    await architect.analyze();

    // Register tool after first analysis
    architect.registerTool({
      name: "late_tool",
      description: "Registered late",
      parameters: {},
      handler: handlerSpy,
    });

    // Second analysis — custom tool should be available
    await architect.analyze();
    expect(handlerSpy).toHaveBeenCalled();

    architect.destroy();
  });
});
