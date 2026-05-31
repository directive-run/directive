import { describe, expect, it } from "vitest";
import { type ApiDocEntry, formatEntries } from "../generate-api-skeleton";

describe("formatEntries", () => {
  it("renders empty output for an empty entry list", () => {
    expect(formatEntries([])).toEqual([]);
  });

  it("groups by kind and renders the canonical heading for each", () => {
    const entries: ApiDocEntry[] = [
      { name: "useFact", kind: "function", description: "Read a fact" },
      { name: "Schema", kind: "interface" },
      { name: "Facts", kind: "type" },
      { name: "Engine", kind: "class" },
      { name: "VERSION", kind: "const" },
    ];

    const lines = formatEntries(entries);

    expect(lines).toContain("### Functions");
    expect(lines).toContain("### Classes");
    expect(lines).toContain("### Interfaces");
    expect(lines).toContain("### Types");
    expect(lines).toContain("### Constants");
  });

  it("emits the kind-order ranking: function, class, interface, type, const", () => {
    const entries: ApiDocEntry[] = [
      { name: "MyType", kind: "type" },
      { name: "myConst", kind: "const" },
      { name: "myFunc", kind: "function" },
      { name: "MyClass", kind: "class" },
      { name: "MyInterface", kind: "interface" },
    ];

    const lines = formatEntries(entries);

    const order = lines.filter((l) => l.startsWith("### ")).map((l) => l);

    expect(order).toEqual([
      "### Functions",
      "### Classes",
      "### Interfaces",
      "### Types",
      "### Constants",
    ]);
  });

  it("renders the first line of a multi-line description after the dash", () => {
    const entries: ApiDocEntry[] = [
      {
        name: "useFact",
        kind: "function",
        description: "Read a fact.\nMore detail here that should not appear.",
      },
    ];

    const lines = formatEntries(entries);

    expect(lines).toContain("- `useFact` — Read a fact.");
    expect(lines.join("\n")).not.toContain("More detail here");
  });

  it("includes a short signature in a TS fence when ≤120 chars", () => {
    const entries: ApiDocEntry[] = [
      {
        name: "useFact",
        kind: "function",
        signature: "function useFact<K>(key: K): FactValue<K>",
      },
    ];

    const lines = formatEntries(entries);

    expect(lines.some((l) => l.includes("```ts"))).toBe(true);
    expect(
      lines.some((l) => l.includes("function useFact<K>(key: K)")),
    ).toBe(true);
  });

  it("omits the signature fence when the signature is too long", () => {
    const longSig = `function f(${"a".repeat(130)}): void`;
    const entries: ApiDocEntry[] = [
      { name: "f", kind: "function", signature: longSig },
    ];

    const lines = formatEntries(entries);

    expect(lines.some((l) => l.includes("```ts"))).toBe(false);
  });

  it("silently drops kinds outside the canonical list", () => {
    // The renderer iterates a fixed kindOrder (function, class, interface,
    // type, variable, const, enum, other). Entries with any other kind
    // get bucketed correctly but never rendered — TypeDoc only emits the
    // canonical kinds in practice, but locking the behavior in keeps the
    // limit explicit so a future renderer can choose to surface them.
    const entries: ApiDocEntry[] = [
      { name: "weird", kind: "namespace" },
      { name: "useFact", kind: "function" },
    ];

    const lines = formatEntries(entries);

    expect(lines).toContain("### Functions");
    expect(lines.some((l) => l.includes("`weird`"))).toBe(false);
  });

  it("renders `other` as the trailing bucket when kind is missing", () => {
    const entries: ApiDocEntry[] = [
      { name: "mystery", kind: "" },
      { name: "useFact", kind: "function" },
    ];

    const lines = formatEntries(entries);

    const headings = lines.filter((l) => l.startsWith("### "));

    expect(headings).toContain("### Functions");
    expect(headings).toContain("### Other");
    expect(headings.indexOf("### Functions")).toBeLessThan(
      headings.indexOf("### Other"),
    );
  });
});
