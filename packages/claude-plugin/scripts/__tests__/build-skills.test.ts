import { describe, expect, it } from "vitest";
import {
  parseFrontmatterArrays,
  stripBuildFrontmatter,
} from "../build-skills";

describe("parseFrontmatterArrays", () => {
  it("parses inline arrays for both fields", () => {
    const template = `---
name: example
description: An example skill
knowledgeFiles: [intro, advanced, troubleshooting]
examples: [counter, traffic-light]
---

# Body
`;

    const result = parseFrontmatterArrays(template);

    expect(result.knowledgeFiles).toEqual([
      "intro",
      "advanced",
      "troubleshooting",
    ]);
    expect(result.examples).toEqual(["counter", "traffic-light"]);
  });

  it("returns null for absent fields", () => {
    const template = `---
name: example
description: An example skill
---

# Body
`;

    const result = parseFrontmatterArrays(template);

    expect(result.knowledgeFiles).toBeNull();
    expect(result.examples).toBeNull();
  });

  it("strips single and double quotes from array items", () => {
    const template = `---
knowledgeFiles: ["intro", 'advanced', plain]
---
`;

    const result = parseFrontmatterArrays(template);

    expect(result.knowledgeFiles).toEqual(["intro", "advanced", "plain"]);
  });

  it("handles empty arrays", () => {
    const template = `---
knowledgeFiles: []
examples: []
---
`;

    const result = parseFrontmatterArrays(template);

    expect(result.knowledgeFiles).toEqual([]);
    expect(result.examples).toEqual([]);
  });

  it("returns null when no frontmatter is present", () => {
    const result = parseFrontmatterArrays("# Just a body\n\nno frontmatter\n");

    expect(result.knowledgeFiles).toBeNull();
    expect(result.examples).toBeNull();
  });

  it("handles multi-line arrays", () => {
    // The `[^\]]*` capture intentionally crosses newlines so the parser
    // accepts both inline and block-formatted arrays. Template authors
    // can break a long list across lines without disabling parsing.
    const template = `---
knowledgeFiles: [
  intro,
  advanced
]
---
`;

    const result = parseFrontmatterArrays(template);

    expect(result.knowledgeFiles).toEqual(["intro", "advanced"]);
  });

  it("skips blank entries from trailing commas", () => {
    const template = `---
examples: [counter,, traffic-light,]
---
`;

    const result = parseFrontmatterArrays(template);

    expect(result.examples).toEqual(["counter", "traffic-light"]);
  });
});

describe("stripBuildFrontmatter", () => {
  it("removes both knowledgeFiles and examples lines", () => {
    const template = `---
name: example
description: An example
knowledgeFiles: [a, b]
examples: [x, y]
---

# Body
`;

    const result = stripBuildFrontmatter(template);

    expect(result).toContain("name: example");
    expect(result).toContain("description: An example");
    expect(result).not.toContain("knowledgeFiles");
    expect(result).not.toContain("examples:");
  });

  it("is a no-op when neither field is present", () => {
    const template = `---
name: example
description: An example
---

# Body
`;

    expect(stripBuildFrontmatter(template)).toBe(template);
  });

  it("strips matching lines anywhere in the document (current behavior)", () => {
    // The regex is unanchored to the `---` frontmatter block, so any line
    // starting with `knowledgeFiles:` or `examples:` gets removed —
    // including ones that legitimately appear in body prose. Templates
    // today never put those words at column 0 in the body, so the
    // behavior is harmless in practice. Documenting it here so a future
    // template that does will surface this constraint as a failure.
    const template = `---
name: example
knowledgeFiles: [a]
---

# Heading

knowledgeFiles: a body line that starts with the field name
`;

    const result = stripBuildFrontmatter(template);

    expect(result).toContain("name: example");
    expect(result).not.toContain("knowledgeFiles: [a]");
    expect(result).not.toContain("knowledgeFiles: a body line");
  });

  it("is idempotent", () => {
    const template = `---
knowledgeFiles: [a]
examples: [b]
---

body
`;

    const once = stripBuildFrontmatter(template);
    const twice = stripBuildFrontmatter(once);

    expect(twice).toBe(once);
  });
});
