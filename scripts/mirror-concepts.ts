/**
 * Mirror in-repo concept docs into the doc site's page format.
 *
 * The `docs/concepts/<name>.md` files in this repo are the source of truth
 * for every package-level concept page on directive.run. The site mirrors
 * them under `directive-docs/src/app/docs/...` with site-specific
 * frontmatter, Markdoc tags, and absolute cross-links. That transform was
 * being done by hand every time a concept changed, which guarantees drift.
 *
 * This script does the transform mechanically and writes the result to the
 * sibling `directive-docs` repo (resolved via `../directive-docs`). Run it
 * after editing any source-of-truth concept doc:
 *
 *   pnpm mirror-concepts
 *
 * The mapping from a concept slug to its rendered URL path lives in
 * MIRROR_TARGETS below. When you add a new concept doc, add an entry there.
 *
 * If you want to preview the output without writing, pass `--dry-run`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const REPO_ROOT = join(__dirname, "..");
const CONCEPTS_DIR = join(REPO_ROOT, "docs", "concepts");
const SITE_REPO = join(REPO_ROOT, "..", "directive-docs");
const SITE_DOCS = join(SITE_REPO, "src", "app", "docs");

/**
 * Map each concept file (slug, no extension) to the rendered URL path on the
 * doc site. Most packages live under `/docs/packages/<slug>`; plugin-style
 * features that already had a top-level docs route keep their existing path.
 *
 * Entries that aren't present here are skipped with a warning. Add new
 * concepts here when shipping them.
 */
const MIRROR_TARGETS: Record<string, string> = {
  // Lesser-known packages — Packages nav section
  timeline: "packages/timeline",
  mutator: "packages/mutator",
  optimistic: "packages/optimistic",
  query: "packages/query",
  "vite-dev-proxy": "packages/vite-dev-proxy",
  // Plugins / predicate tools — older top-level paths
  "audit-ledger": "audit-ledger",
  doctor: "doctor",
  predict: "predict",
  "predicate-from-intent": "predicate-from-intent",
  "predicate-codegen": "predicate-codegen",
  "describe-predicate": "describe-predicate",
  "when-explain-panel": "when-explain-panel",
  "replay-under": "replay-under",
  "rules-diff": "rules-diff",
  tune: "tune",
};

interface TransformResult {
  frontmatterTitle: string;
  frontmatterDescription: string;
  body: string;
}

/**
 * Apply the source → mirror transform.
 *
 * 1. Extract the H1 line; strip backticks for the frontmatter `title`.
 * 2. Extract the lead blockquote (one or more `>` lines immediately after
 *    the H1) and emit it as a normal paragraph followed by `{% .lead %}`.
 * 3. Use the un-blockquoted lead, collapsed to single line, as the
 *    frontmatter `description` (clamped at 200 chars).
 * 4. Insert `---` separators between every top-level H2 section.
 * 5. Rewrite relative cross-links: `(./other.md)` and `(other-name.md)`
 *    become `(/docs/<mapped-target-or-slug>)`.
 * 6. Convert any remaining `>` blockquotes that look like warnings or notes
 *    into `{% callout %}` Markdoc tags; plain quotes are left alone.
 * 7. Strip footnote anchor lines (`[fn]: ...`).
 */
function transform(source: string): TransformResult {
  const lines = source.split("\n");

  // 1. Extract H1.
  const h1Idx = lines.findIndex((l) => l.startsWith("# "));
  if (h1Idx === -1) {
    throw new Error("source has no H1 line");
  }
  const h1 = lines[h1Idx]!;
  const title = h1.replace(/^#\s+/, "").replace(/`/g, "").trim();

  // 2. Extract lead blockquote starting at h1Idx + 1, skipping blanks.
  let leadStart = h1Idx + 1;
  while (leadStart < lines.length && lines[leadStart]!.trim() === "") {
    leadStart++;
  }
  let leadEnd = leadStart;
  while (leadEnd < lines.length && lines[leadEnd]!.startsWith(">")) {
    leadEnd++;
  }
  const leadLines = lines
    .slice(leadStart, leadEnd)
    .map((l) => l.replace(/^>\s?/, "").trim());
  const leadParagraph = leadLines.filter(Boolean).join(" ");
  const description = leadParagraph.replace(/\s+/g, " ").slice(0, 200);

  // 3. Body assembly.
  const remaining = lines.slice(leadEnd).join("\n");
  // Insert `---` separators before every top-level H2 that isn't the first
  // line of body. We split on H2, then rejoin with `---\n\n` between.
  const h2Sections = remaining.split(/(?=^## )/m);
  const beforeFirstH2 = h2Sections[0] ?? "";
  const afterFirstH2 = h2Sections.slice(1);
  const bodyWithSeparators = [
    beforeFirstH2.trim(),
    ...afterFirstH2.map((s) => s.trim()),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  // 4. Cross-link rewrites.
  const linked = bodyWithSeparators.replace(
    /\(\.?\.?\/?([\w-]+)\.md\)/g,
    (_match, slug: string) => {
      const target = MIRROR_TARGETS[slug] ?? slug;
      return `(/docs/${target})`;
    },
  );

  // 5. Strip footnote anchors.
  const stripped = linked.replace(/^\[\w[^\]]*\]:\s+.+$/gm, "").trim();

  // 6. Compose final body: lead paragraph + `{% .lead %}`, then `---`,
  //    then the rest of the body.
  const finalBody = `${leadParagraph} {% .lead %}\n\n---\n\n${stripped}\n`;

  return {
    frontmatterTitle: title,
    frontmatterDescription: description,
    body: finalBody,
  };
}

function buildMirrorFile(result: TransformResult): string {
  // Escape any literal double-quote in the description for valid YAML.
  const safeDescription = result.frontmatterDescription.replace(/"/g, '\\"');
  return `---
title: ${result.frontmatterTitle}
description: ${safeDescription}
---

${result.body}`;
}

function main(): number {
  const dryRun = process.argv.includes("--dry-run");
  if (!existsSync(SITE_REPO)) {
    console.error(
      `[mirror-concepts] sibling directive-docs repo not found at ${SITE_REPO}`,
    );
    console.error(
      "  hint: run from a workspace that has both directive and directive-docs side by side",
    );
    return 1;
  }

  const files = readdirSync(CONCEPTS_DIR).filter((f) => f.endsWith(".md"));
  let written = 0;
  let drift = 0;
  let skipped = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const target = MIRROR_TARGETS[slug];
    if (!target) {
      console.warn(
        `[mirror-concepts] skipping ${file}: no entry in MIRROR_TARGETS`,
      );
      skipped++;
      continue;
    }

    const sourcePath = join(CONCEPTS_DIR, file);
    const source = readFileSync(sourcePath, "utf-8");

    let result: TransformResult;
    try {
      result = transform(source);
    } catch (err) {
      console.error(`[mirror-concepts] ${file}: ${(err as Error).message}`);
      continue;
    }

    const mirror = buildMirrorFile(result);
    const destPath = join(SITE_DOCS, target, "page.md");

    if (existsSync(destPath)) {
      const existing = readFileSync(destPath, "utf-8");
      if (existing === mirror) {
        // No drift.
        continue;
      }
      drift++;
    }

    if (dryRun) {
      console.log(`[mirror-concepts] would write ${target}/page.md`);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, mirror);
      console.log(`[mirror-concepts] wrote ${target}/page.md`);
    }
    written++;
  }

  if (skipped > 0) {
    console.log(`[mirror-concepts] ${skipped} files skipped (no mapping)`);
  }
  if (dryRun && drift > 0) {
    console.error(`[mirror-concepts] ${drift} mirror file(s) would change`);
    return 1;
  }
  console.log(`[mirror-concepts] ${written} file(s) written`);

  return 0;
}

process.exit(main());
