import { describe, expect, it } from "vitest";
import { generateSitemap, parseNavigation } from "../generate-sitemap";

describe("parseNavigation", () => {
  it("extracts sections and links from docsNavigation only", () => {
    const source = `
export const docsNavigation = [
  {
    title: "Getting Started",
    links: [
      { title: "Quick Start", href: "/docs/quick-start" },
      { title: "Install", href: "/docs/install" },
    ],
  },
];

export type Nav = typeof docsNavigation;
`;

    const { docs, ai } = parseNavigation(source);

    expect(ai).toEqual([]);
    expect(docs).toEqual([
      {
        title: "Getting Started",
        links: [
          { title: "Quick Start", href: "/docs/quick-start" },
          { title: "Install", href: "/docs/install" },
        ],
      },
    ]);
  });

  it("extracts both docsNavigation and aiNavigation", () => {
    const source = `
export const docsNavigation = [
  {
    title: "Concepts",
    links: [
      { title: "Facts", href: "/docs/facts" },
    ],
  },
];

export const aiNavigation = [
  {
    title: "AI",
    links: [
      { title: "Agents", href: "/ai/agents" },
      { title: "Multi-Agent", href: "/ai/multi-agent" },
    ],
  },
];

export function combined() {}
`;

    const { docs, ai } = parseNavigation(source);

    expect(docs).toHaveLength(1);
    expect(ai).toHaveLength(1);
    expect(ai[0]?.links).toHaveLength(2);
    expect(ai[0]?.links[0]).toEqual({ title: "Agents", href: "/ai/agents" });
  });

  it("returns empty arrays when neither nav export is present", () => {
    const result = parseNavigation("export const other = 1;\n");

    expect(result).toEqual({ docs: [], ai: [] });
  });

  it("rolls up multiple sections before terminator", () => {
    const source = `
export const docsNavigation = [
  {
    title: "A",
    links: [
      { title: "a1", href: "/a/1" },
    ],
  },
  {
    title: "B",
    links: [
      { title: "b1", href: "/b/1" },
      { title: "b2", href: "/b/2" },
    ],
  },
];

export const navigation = [];
`;

    const { docs } = parseNavigation(source);

    expect(docs.map((s) => s.title)).toEqual(["A", "B"]);
    expect(docs[1]?.links).toHaveLength(2);
  });

  it("drops empty sections", () => {
    const source = `
export const docsNavigation = [
  {
    title: "Empty",
    links: [],
  },
  {
    title: "Full",
    links: [
      { title: "x", href: "/x" },
    ],
  },
];

export function combine() {}
`;

    const { docs } = parseNavigation(source);

    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe("Full");
  });
});

describe("generateSitemap", () => {
  it("renders both Docs and AI sections with absolute URLs", () => {
    const sitemap = generateSitemap(
      [
        {
          title: "Getting Started",
          links: [{ title: "Quick Start", href: "/docs/quick-start" }],
        },
      ],
      [
        {
          title: "AI",
          links: [{ title: "Agents", href: "/ai/agents" }],
        },
      ],
    );

    expect(sitemap).toContain("# Directive Documentation Sitemap");
    expect(sitemap).toContain("Website: https://directive.run");
    expect(sitemap).toContain("## Docs");
    expect(sitemap).toContain("### Getting Started");
    expect(sitemap).toContain(
      "- [Quick Start](https://directive.run/docs/quick-start)",
    );
    expect(sitemap).toContain("## AI");
    expect(sitemap).toContain("### AI");
    expect(sitemap).toContain("- [Agents](https://directive.run/ai/agents)");
  });

  it("omits the AI heading when ai is empty", () => {
    const sitemap = generateSitemap(
      [{ title: "S", links: [{ title: "p", href: "/p" }] }],
      [],
    );

    expect(sitemap).toContain("## Docs");
    expect(sitemap).not.toContain("## AI");
  });

  it("omits the Docs heading when docs is empty", () => {
    const sitemap = generateSitemap(
      [],
      [{ title: "AI", links: [{ title: "a", href: "/a" }] }],
    );

    expect(sitemap).not.toContain("## Docs");
    expect(sitemap).toContain("## AI");
  });
});
