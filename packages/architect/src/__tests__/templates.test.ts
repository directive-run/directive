import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTemplateRegistry,
  BUILT_IN_TEMPLATES,
} from "../templates.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { ArchitectEvent } from "../types.js";

describe("BUILT_IN_TEMPLATES", () => {
  it("has 5 built-in templates", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(5);
  });

  it("each template has required fields", () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(["resilience", "optimization", "monitoring", "safety", "custom"]).toContain(t.category);
      expect(["constraint", "resolver", "constraint+resolver"]).toContain(t.type);
      expect(Array.isArray(t.parameters)).toBe(true);
    }
  });
});

describe("createTemplateRegistry", () => {
  it("lists all built-in templates", () => {
    const registry = createTemplateRegistry();

    expect(registry.list()).toHaveLength(5);
    expect(registry.get("rate-limit")).toBeDefined();
    expect(registry.get("error-threshold")).toBeDefined();
    expect(registry.get("circuit-breaker")).toBeDefined();
    expect(registry.get("health-monitor")).toBeDefined();
    expect(registry.get("idle-timeout")).toBeDefined();
  });

  it("registers custom templates", () => {
    const registry = createTemplateRegistry([
      {
        id: "custom-check",
        name: "Custom Check",
        description: "A custom check",
        category: "custom",
        type: "constraint",
        parameters: [
          { name: "key", type: "string", description: "Fact key", required: true },
        ],
        generateWhenCode: (p) => `return facts["${p.key}"] === true;`,
        generateRequire: (p) => ({ type: "CUSTOM_CHECK", key: p.key }),
      },
    ]);

    expect(registry.list()).toHaveLength(6);
    expect(registry.get("custom-check")).toBeDefined();
  });

  it("register() adds a template at runtime", () => {
    const registry = createTemplateRegistry();

    registry.register({
      id: "new-template",
      name: "New Template",
      description: "Added at runtime",
      category: "safety",
      type: "constraint",
      parameters: [],
      generateWhenCode: () => "return true;",
      generateRequire: () => ({ type: "NEW" }),
    });

    expect(registry.list()).toHaveLength(6);
    expect(registry.get("new-template")).toBeDefined();
  });

  it("get() returns undefined for unknown ID", () => {
    const registry = createTemplateRegistry();

    expect(registry.get("nonexistent")).toBeUndefined();
  });
});

describe("template instantiation", () => {
  it("rate-limit template instantiates correctly", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("rate-limit", {
      factKey: "apiCalls",
      threshold: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.constraintArgs).toBeDefined();
    expect(result!.constraintArgs!.whenCode).toContain("apiCalls");
    expect(result!.constraintArgs!.whenCode).toContain("100");
    expect(result!.constraintArgs!.require).toEqual({
      type: "RATE_LIMIT_EXCEEDED",
      factKey: "apiCalls",
      threshold: 100,
    });
    expect(result!.constraintArgs!.priority).toBe(80);
    expect(result!.resolverArgs).toBeUndefined();
  });

  it("error-threshold template instantiates correctly", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("error-threshold", {
      factKey: "errorCount",
      maxErrors: 10,
      requirementType: "TOO_MANY_ERRORS",
    });

    expect(result!.constraintArgs!.whenCode).toContain("errorCount");
    expect(result!.constraintArgs!.whenCode).toContain("10");
    expect(result!.constraintArgs!.require.type).toBe("TOO_MANY_ERRORS");
  });

  it("circuit-breaker template creates both constraint and resolver", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("circuit-breaker", {
      failureFactKey: "failures",
      stateFactKey: "circuitState",
    });

    expect(result).not.toBeNull();
    expect(result!.constraintArgs).toBeDefined();
    expect(result!.resolverArgs).toBeDefined();

    // Constraint watches failures
    expect(result!.constraintArgs!.whenCode).toContain("failures");
    expect(result!.constraintArgs!.whenCode).toContain("circuitState");
    expect(result!.constraintArgs!.whenCode).toContain('"closed"');

    // Resolver sets circuit to open
    expect(result!.resolverArgs!.resolveCode).toContain('"open"');
    expect(result!.resolverArgs!.requirement).toBe("CIRCUIT_OPEN");
  });

  it("health-monitor template instantiates correctly", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("health-monitor", {
      factKey: "cpuUsage",
      minValue: 20,
    });

    expect(result!.constraintArgs!.whenCode).toContain("cpuUsage");
    expect(result!.constraintArgs!.whenCode).toContain("20");
  });

  it("idle-timeout template instantiates correctly", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("idle-timeout", {
      factKey: "lastActivity",
      timeoutMs: 300000,
    });

    expect(result!.constraintArgs!.whenCode).toContain("lastActivity");
    expect(result!.constraintArgs!.whenCode).toContain("300000");
    expect(result!.constraintArgs!.whenCode).toContain("Date.now()");
  });

  it("fills default parameters", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("rate-limit", {
      factKey: "calls",
      threshold: 50,
      // requirementType not provided — should use default
    });

    expect(result!.constraintArgs!.require.type).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns null for missing required parameters", () => {
    const registry = createTemplateRegistry();

    // rate-limit requires factKey and threshold
    const result = registry.instantiate("rate-limit", {
      factKey: "calls",
      // threshold missing
    });

    expect(result).toBeNull();
  });

  it("returns null for unknown template ID", () => {
    const registry = createTemplateRegistry();

    expect(registry.instantiate("nonexistent", {})).toBeNull();
  });

  it("circuit-breaker uses default maxFailures", () => {
    const registry = createTemplateRegistry();
    const result = registry.instantiate("circuit-breaker", {
      failureFactKey: "f",
      stateFactKey: "s",
    });

    expect(result!.constraintArgs!.whenCode).toContain("5"); // default maxFailures
  });
});

describe("formatForPrompt", () => {
  it("includes all templates", () => {
    const registry = createTemplateRegistry();
    const text = registry.formatForPrompt();

    expect(text).toContain("## Constraint Templates");
    expect(text).toContain("Rate Limiter");
    expect(text).toContain("Error Threshold");
    expect(text).toContain("Circuit Breaker");
    expect(text).toContain("Health Monitor");
    expect(text).toContain("Idle Timeout");
    expect(text).toContain("apply_template");
  });

  it("includes parameter descriptions", () => {
    const registry = createTemplateRegistry();
    const text = registry.formatForPrompt();

    expect(text).toContain("factKey");
    expect(text).toContain("threshold");
    expect(text).toContain("(required)");
  });
});

describe("templates integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("list_templates tool returns templates via pipeline", async () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        {
          toolCalls: [{ name: "list_templates", arguments: "{}" }],
          totalTokens: 50,
        },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
    });

    const events: ArchitectEvent[] = [];
    architect.on((e) => events.push(e));

    await architect.analyze();

    // list_templates is read-only, so it completes without needing approval
    const applied = events.filter((e) => e.type === "applied");
    expect(applied.length).toBeGreaterThan(0);

    architect.destroy();
  });

  it("apply_template tool creates constraint in system", async () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        {
          toolCalls: [{
            name: "apply_template",
            arguments: JSON.stringify({
              templateId: "rate-limit",
              params: { factKey: "apiCalls", threshold: 100 },
            }),
          }],
          totalTokens: 50,
        },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
    });

    const events: ArchitectEvent[] = [];
    architect.on((e) => events.push(e));

    await architect.analyze();

    const applied = events.filter((e) => e.type === "applied");
    expect(applied.length).toBeGreaterThan(0);

    // Should have created a constraint in the system
    const defs = architect.getActiveDefinitions();
    const templateDef = defs.find((d) => d.id.startsWith("rate-limit-"));
    expect(templateDef).toBeDefined();
    expect(templateDef!.type).toBe("constraint");

    architect.destroy();
  });

  it("custom templates provided via options are available", async () => {
    const system = createTestSystem({ phase: "running" });

    const architect = createAIArchitect({
      system: system as any,
      runner: mockRunner([
        {
          toolCalls: [{
            name: "apply_template",
            arguments: JSON.stringify({
              templateId: "my-custom",
              params: { key: "status" },
            }),
          }],
          totalTokens: 50,
        },
      ]),
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      templates: [{
        id: "my-custom",
        name: "My Custom",
        description: "Custom template",
        category: "custom",
        type: "constraint",
        parameters: [
          { name: "key", type: "string", description: "Key", required: true },
        ],
        generateWhenCode: (p) => `return facts["${p.key}"] === true;`,
        generateRequire: (p) => ({ type: "CUSTOM", key: p.key }),
      }],
    });

    await architect.analyze();

    const defs = architect.getActiveDefinitions();
    const customDef = defs.find((d) => d.id.startsWith("my-custom-"));
    expect(customDef).toBeDefined();

    architect.destroy();
  });
});
