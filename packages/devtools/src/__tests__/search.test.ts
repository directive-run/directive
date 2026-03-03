import { describe, expect, it } from "vitest";

// Test the pure search logic from SearchBar

/** Build a flat lowercase string from all string/number properties of an event */
function buildSearchString(event: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const key of Object.keys(event)) {
    const value = event[key];
    if (typeof value === "string") {
      parts.push(value);
    } else if (typeof value === "number") {
      parts.push(String(value));
    }
  }

  return parts.join(" ").toLowerCase();
}

/** Execute search with regex length limit (M4) */
function executeSearch(
  term: string,
  searchIndex: { id: number; text: string }[],
): { matches: Set<number>; isInvalid: boolean } | null {
  if (!term.trim()) {
    return null;
  }

  // Reject oversized patterns
  if (term.length > 200) {
    return { matches: new Set(), isInvalid: true };
  }

  // D1: Reject patterns with nested quantifiers (ReDoS prevention)
  if (/([+*}])\)([+*{])/.test(term) || /([+*}])\]([+*{])/.test(term)) {
    return { matches: new Set(), isInvalid: true };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(term, "i");
  } catch {
    return { matches: new Set(), isInvalid: true };
  }

  const matches = new Set<number>();
  for (const entry of searchIndex) {
    if (regex.test(entry.text)) {
      matches.add(entry.id);
    }
  }

  return { matches, isInvalid: false };
}

describe("buildSearchString", () => {
  it("extracts string and number properties", () => {
    const result = buildSearchString({
      id: 1,
      type: "agent_start",
      timestamp: 1000,
      agentId: "TestAgent",
    });
    expect(result).toContain("1");
    expect(result).toContain("agent_start");
    expect(result).toContain("1000");
    expect(result).toContain("testagent"); // lowercased
  });

  it("ignores non-string/number properties", () => {
    const result = buildSearchString({
      name: "test",
      data: { nested: true },
      items: [1, 2, 3],
      active: true,
    });
    expect(result).toContain("test");
    expect(result).not.toContain("nested");
    expect(result).not.toContain("true");
  });

  it("returns empty string for empty object", () => {
    expect(buildSearchString({})).toBe("");
  });

  it("lowercases all text", () => {
    const result = buildSearchString({ name: "UPPERCASE", mixed: "MiXeD" });
    expect(result).toBe("uppercase mixed");
  });
});

describe("executeSearch", () => {
  const index = [
    { id: 1, text: "agent_start test-agent 1000" },
    { id: 2, text: "agent_complete test-agent 2000 200" },
    { id: 3, text: "agent_error other-agent 3000 boom" },
    { id: 4, text: "resolver_start test-agent 1500" },
  ];

  it("returns null for empty/whitespace query", () => {
    expect(executeSearch("", index)).toBeNull();
    expect(executeSearch("   ", index)).toBeNull();
  });

  it("finds matching events by text", () => {
    const result = executeSearch("boom", index);
    expect(result).not.toBeNull();
    expect(result!.matches.size).toBe(1);
    expect(result!.matches.has(3)).toBe(true);
  });

  it("finds multiple matches", () => {
    const result = executeSearch("test-agent", index);
    expect(result!.matches.size).toBe(3);
  });

  it("supports regex patterns", () => {
    const result = executeSearch("agent_(start|error)", index);
    expect(result!.matches.size).toBe(2);
    expect(result!.matches.has(1)).toBe(true);
    expect(result!.matches.has(3)).toBe(true);
  });

  it("returns isInvalid for bad regex", () => {
    const result = executeSearch("[invalid", index);
    expect(result!.isInvalid).toBe(true);
    expect(result!.matches.size).toBe(0);
  });

  it("rejects patterns longer than 200 chars (M4)", () => {
    const longPattern = "a".repeat(201);
    const result = executeSearch(longPattern, index);
    expect(result!.isInvalid).toBe(true);
  });

  it("accepts patterns of exactly 200 chars", () => {
    const pattern = "a".repeat(200);
    const result = executeSearch(pattern, index);
    // This is valid regex, just won't match anything
    expect(result!.isInvalid).toBe(false);
    expect(result!.matches.size).toBe(0);
  });

  it("is case insensitive", () => {
    const result = executeSearch("BOOM", index);
    expect(result!.matches.size).toBe(1);
    expect(result!.matches.has(3)).toBe(true);
  });

  it("returns empty matches for no results", () => {
    const result = executeSearch("nonexistent", index);
    expect(result!.matches.size).toBe(0);
    expect(result!.isInvalid).toBe(false);
  });

  it("handles regex special characters gracefully", () => {
    // Unescaped special chars that are valid regex
    const result = executeSearch("agent.*start", index);
    expect(result!.isInvalid).toBe(false);
    expect(result!.matches.has(1)).toBe(true);
  });

  it("rejects patterns at exactly 201 chars", () => {
    const pattern = "a".repeat(201);
    const result = executeSearch(pattern, index);
    expect(result!.isInvalid).toBe(true);
  });

  it("handles empty search index", () => {
    const result = executeSearch("test", []);
    expect(result!.matches.size).toBe(0);
    expect(result!.isInvalid).toBe(false);
  });

  it("rejects ReDoS patterns with nested quantifiers (D1)", () => {
    const result = executeSearch("(a+)+$", index);
    expect(result!.isInvalid).toBe(true);
    expect(result!.matches.size).toBe(0);
  });

  it("rejects (a*)*b ReDoS pattern (D1)", () => {
    const result = executeSearch("(a*)*b", index);
    expect(result!.isInvalid).toBe(true);
  });

  it("accepts safe regex patterns after D1 filter", () => {
    const result = executeSearch("agent_(start|end)", index);
    expect(result!.isInvalid).toBe(false);
  });

  it("handles backslash in pattern", () => {
    const indexWithBackslash = [{ id: 1, text: "path\\to\\file" }];
    // Double backslash is valid regex matching literal backslash
    const result = executeSearch("path\\\\to", indexWithBackslash);
    expect(result!.isInvalid).toBe(false);
    expect(result!.matches.has(1)).toBe(true);
  });
});

// ============================================================================
// buildSearchString edge cases
// ============================================================================

describe("buildSearchString edge cases", () => {
  it("handles null values in object", () => {
    const result = buildSearchString({ name: "test", value: null });
    // null is not string or number, so only "test" should be present
    expect(result).toBe("test");
  });

  it("handles undefined values in object", () => {
    const result = buildSearchString({ name: "test", value: undefined });
    expect(result).toBe("test");
  });

  it("handles boolean values (excluded)", () => {
    const result = buildSearchString({ flag: true, name: "test" });
    expect(result).toBe("test");
    expect(result).not.toContain("true");
  });

  it("handles zero as a number value", () => {
    const result = buildSearchString({ count: 0 });
    expect(result).toBe("0");
  });

  it("handles negative numbers", () => {
    const result = buildSearchString({ offset: -100 });
    expect(result).toBe("-100");
  });
});
