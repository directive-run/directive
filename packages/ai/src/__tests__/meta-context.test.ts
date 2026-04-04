import { describe, expect, it } from "vitest";
import type { SystemInspection } from "@directive-run/core";
import { formatSystemMeta, toAIContext } from "../meta-context";

// ============================================================================
// Helpers
// ============================================================================

function makeInspection(
  overrides: Partial<SystemInspection> = {},
): SystemInspection {
  return {
    unmet: [],
    inflight: [],
    facts: [],
    events: [],
    constraints: [],
    resolvers: {},
    resolverDefs: [],
    effects: [],
    derivations: [],
    modules: [],
    traceEnabled: false,
    ...overrides,
  };
}

// ============================================================================
// formatSystemMeta
// ============================================================================

describe("formatSystemMeta", () => {
  it("returns empty string when no meta exists", () => {
    const inspection = makeInspection({
      constraints: [
        {
          id: "check",
          active: true,
          disabled: false,
          priority: 0,
          hitCount: 1,
          lastActiveAt: null,
        },
      ],
    });

    expect(formatSystemMeta(inspection)).toBe("");
  });

  it("formats modules with meta", () => {
    const result = formatSystemMeta(
      makeInspection({
        modules: [
          { id: "auth", meta: { label: "Authentication", description: "Handles login", category: "auth" } },
          { id: "data", meta: undefined },
        ],
      }),
    );

    expect(result).toContain("### Modules");
    expect(result).toContain("auth (Authentication): Handles login [auth]");
    expect(result).not.toContain("data");
  });

  it("formats active constraints with meta", () => {
    const result = formatSystemMeta(
      makeInspection({
        constraints: [
          {
            id: "needsLogin",
            active: true,
            disabled: false,
            priority: 0,
            hitCount: 1,
            lastActiveAt: null,
            meta: { label: "Requires Auth", tags: ["critical"] },
          },
          {
            id: "inactive",
            active: false,
            disabled: false,
            priority: 0,
            hitCount: 0,
            lastActiveAt: null,
            meta: { label: "Inactive One" },
          },
        ],
      }),
    );

    expect(result).toContain("### Active Constraints");
    expect(result).toContain("Requires Auth");
    expect(result).toContain("[critical]");
    // Inactive constraint should not appear
    expect(result).not.toContain("Inactive One");
  });

  it("formats unmet requirements with constraint labels", () => {
    const result = formatSystemMeta(
      makeInspection({
        unmet: [
          {
            id: "req-1",
            requirement: { type: "LOGIN" },
            fromConstraint: "needsLogin",
          },
        ],
        constraints: [
          {
            id: "needsLogin",
            active: true,
            disabled: false,
            priority: 0,
            hitCount: 1,
            lastActiveAt: null,
            meta: { label: "Requires Auth" },
          },
        ],
      }),
    );

    expect(result).toContain("### Unmet Requirements");
    expect(result).toContain('LOGIN — from "Requires Auth"');
  });

  it("formats resolvers with meta", () => {
    const result = formatSystemMeta(
      makeInspection({
        resolverDefs: [
          { id: "login", requirement: "LOGIN", meta: { label: "OAuth Flow", description: "Exchanges code for token" } },
          { id: "plain", requirement: "OTHER" },
        ],
      }),
    );

    expect(result).toContain("### Resolvers");
    expect(result).toContain("OAuth Flow");
    expect(result).toContain("Exchanges code for token");
    expect(result).not.toContain("plain");
  });

  it("formats annotated facts", () => {
    const result = formatSystemMeta(
      makeInspection({
        facts: [
          { key: "email", meta: { label: "Email Address", tags: ["pii"] } },
          { key: "count" },
        ],
      }),
    );

    expect(result).toContain("### Annotated Facts");
    expect(result).toContain("Email Address");
    expect(result).toContain("[pii]");
    expect(result).not.toContain("count");
  });

  it("formats effects with meta", () => {
    const result = formatSystemMeta(
      makeInspection({
        effects: [
          { id: "log", meta: { label: "Logger", category: "logging" } },
        ],
      }),
    );

    expect(result).toContain("### Effects");
    expect(result).toContain("Logger");
    expect(result).toContain("[logging]");
  });

  it("formats derivations with meta", () => {
    const result = formatSystemMeta(
      makeInspection({
        derivations: [
          { id: "fullName", meta: { label: "Full Name", description: "First + last" } },
        ],
      }),
    );

    expect(result).toContain("### Derivations");
    expect(result).toContain("Full Name");
    expect(result).toContain("First + last");
  });

  it("omits sections with no annotated entries", () => {
    const result = formatSystemMeta(
      makeInspection({
        modules: [{ id: "auth", meta: { label: "Auth" } }],
        // constraints, resolvers, etc. all empty
      }),
    );

    expect(result).toContain("### Modules");
    expect(result).not.toContain("### Active Constraints");
    expect(result).not.toContain("### Resolvers");
    expect(result).not.toContain("### Annotated Facts");
  });

  it("deduplicates category from tags", () => {
    const result = formatSystemMeta(
      makeInspection({
        modules: [
          {
            id: "auth",
            meta: { label: "Auth", category: "auth", tags: ["auth", "critical"] },
          },
        ],
      }),
    );

    // "auth" should appear once, not twice
    const authModule = result.split("\n").find((l) => l.includes("Auth"));
    expect(authModule).toContain("[auth, critical]");
    // Not [auth, auth, critical]
    expect(authModule).not.toContain("auth, auth");
  });

  it("handles full system with all definition types", () => {
    const result = formatSystemMeta(
      makeInspection({
        modules: [{ id: "app", meta: { label: "App Module" } }],
        constraints: [
          {
            id: "c1",
            active: true,
            disabled: false,
            priority: 0,
            hitCount: 1,
            lastActiveAt: null,
            meta: { label: "Constraint 1" },
          },
        ],
        resolverDefs: [{ id: "r1", requirement: "DO", meta: { label: "Resolver 1" } }],
        facts: [{ key: "f1", meta: { label: "Fact 1" } }],
        effects: [{ id: "e1", meta: { label: "Effect 1" } }],
        derivations: [{ id: "d1", meta: { label: "Derivation 1" } }],
      }),
    );

    expect(result).toContain("## System Context");
    expect(result).toContain("### Modules");
    expect(result).toContain("### Active Constraints");
    expect(result).toContain("### Resolvers");
    expect(result).toContain("### Annotated Facts");
    expect(result).toContain("### Effects");
    expect(result).toContain("### Derivations");
  });
});

// ============================================================================
// toAIContext
// ============================================================================

describe("toAIContext", () => {
  it("wraps system.inspect() and formats meta", () => {
    const mockSystem = {
      inspect: () =>
        makeInspection({
          modules: [{ id: "test", meta: { label: "Test Module" } }],
        }),
    };

    const result = toAIContext(mockSystem);
    expect(result).toContain("## System Context");
    expect(result).toContain("Test Module");
  });

  it("returns empty string for system with no meta", () => {
    const mockSystem = {
      inspect: () => makeInspection(),
    };

    expect(toAIContext(mockSystem)).toBe("");
  });
});
