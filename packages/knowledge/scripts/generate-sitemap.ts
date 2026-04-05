/**
 * Generate sitemap.md from the docs site navigation tree.
 *
 * Reads navigation.ts from the directive-docs repo and generates a markdown
 * sitemap with page titles and URLs. AI tools use this to discover docs
 * pages without manual maintenance.
 *
 * Run: tsx scripts/generate-sitemap.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../../scripts/lib/log";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, "..", "sitemap.md");
const BASE_URL = "https://directive.run";

// Find the navigation.ts file in the sibling directive-docs repo
const NAV_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "directive-docs",
  "src",
  "lib",
  "navigation.ts",
);

interface NavLink {
  title: string;
  href: string;
}

interface NavSection {
  title: string;
  links: NavLink[];
}

/**
 * Parse navigation arrays from the TypeScript source.
 * Line-by-line parsing — more robust than regex on multi-line TS.
 */
function parseNavigation(source: string): {
  docs: NavSection[];
  ai: NavSection[];
} {
  const docs: NavSection[] = [];
  const ai: NavSection[] = [];

  let currentArray: NavSection[] | null = null;
  let currentSection: NavSection | null = null;

  for (const line of source.split("\n")) {
    const trimmed = line.trim();

    // Detect which array we're in
    if (trimmed.startsWith("export const docsNavigation")) {
      currentArray = docs;
      continue;
    }
    if (trimmed.startsWith("export const aiNavigation")) {
      currentArray = ai;
      continue;
    }
    // End of array (next export or combined navigation)
    if (
      currentArray &&
      (trimmed.startsWith("export const navigation") ||
        trimmed.startsWith("export function") ||
        trimmed.startsWith("export type"))
    ) {
      if (currentSection && currentSection.links.length > 0) {
        currentArray.push(currentSection);
      }
      currentArray = null;
      currentSection = null;
      continue;
    }

    if (!currentArray) continue;

    // Section title
    const titleMatch = trimmed.match(/title:\s*"([^"]+)"/);
    const hrefMatch = trimmed.match(/href:\s*"([^"]+)"/);

    if (titleMatch && !hrefMatch) {
      // This is a section title (has title but no href)
      if (currentSection && currentSection.links.length > 0) {
        currentArray.push(currentSection);
      }
      currentSection = { title: titleMatch[1], links: [] };
    } else if (titleMatch && hrefMatch) {
      // This is a link (has both title and href on same line)
      currentSection?.links.push({
        title: titleMatch[1],
        href: hrefMatch[1],
      });
    }
  }

  // Push last section
  if (currentArray && currentSection && currentSection.links.length > 0) {
    currentArray.push(currentSection);
  }

  return { docs, ai };
}

function generateSitemap(docs: NavSection[], ai: NavSection[]): string {
  const lines: string[] = [
    "# Directive Documentation Sitemap",
    "",
    "> Auto-generated from the docs site navigation. Do not edit manually.",
    `> Run \`pnpm --filter @directive-run/knowledge generate-sitemap\` to refresh.`,
    "",
    `Website: ${BASE_URL}`,
    "",
  ];

  if (docs.length > 0) {
    lines.push("## Docs");
    lines.push("");
    for (const section of docs) {
      lines.push(`### ${section.title}`);
      for (const link of section.links) {
        lines.push(`- [${link.title}](${BASE_URL}${link.href})`);
      }
      lines.push("");
    }
  }

  if (ai.length > 0) {
    lines.push("## AI");
    lines.push("");
    for (const section of ai) {
      lines.push(`### ${section.title}`);
      for (const link of section.links) {
        lines.push(`- [${link.title}](${BASE_URL}${link.href})`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// Main
if (!existsSync(NAV_PATH)) {
  log.warn(`Navigation file not found at ${NAV_PATH}`);
  log.warn("Skipping sitemap generation (directive-docs repo not found)");
  process.exit(0);
}

const source = readFileSync(NAV_PATH, "utf-8");
const { docs, ai } = parseNavigation(source);

const totalLinks = docs.reduce((n, s) => n + s.links.length, 0) +
  ai.reduce((n, s) => n + s.links.length, 0);

const sitemap = generateSitemap(docs, ai);
writeFileSync(OUTPUT, sitemap, "utf-8");

log.success(`Generated sitemap.md — ${docs.length + ai.length} sections, ${totalLinks} pages`);
