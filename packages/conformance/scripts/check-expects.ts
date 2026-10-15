/**
 * Prove the port changed nothing a test asserts.
 *
 * For every ported file, against its original in packages/core:
 *
 * 1. Every assertion survives verbatim. Each `expect(...)`/`expect.*`/
 *    `assert*` call is collected from both files, whitespace-normalised, and
 *    the two multisets must be equal. One edited, dropped or added assertion
 *    fails the check.
 * 2. Nothing else changed either. With import declarations removed, dynamic
 *    import specifiers blanked and the port's two header lines dropped, the
 *    files must be byte-identical, apart from the environment rewrites the
 *    port declares (each must be applied exactly where it says).
 * 3. The set is complete. Every original classified black-box or internals
 *    has a port, every port has an original, and no core test is newer than
 *    the last port.
 * 4. Every port sits in exactly one layer of layers.json.
 *
 * Usage: pnpm --filter @directive-run/conformance check:expects
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";

const here = dirname(fileURLToPath(import.meta.url));
const conformanceRoot = resolve(here, "..");
const repoRoot = resolve(conformanceRoot, "../..");

const manifest = JSON.parse(
  readFileSync(join(here, "manifest.json"), "utf8"),
) as Record<string, string>;
const classification = JSON.parse(
  readFileSync(join(here, "classification.json"), "utf8"),
) as Array<{ file: string; category: string }>;

/** Keep in step with ENVIRONMENT_REWRITES in port.ts. */
const ENVIRONMENT_REWRITES: Record<string, Array<[string, string]>> = {
  "packages/core/src/core/__tests__/superseded-bodies-and-retry-timer.test.ts":
    [['join(here, "../../../dist/index.js")', "engineDistEntry()"]],
};

const project = new Project({ useInMemoryFileSystem: false });

function load(path: string): SourceFile {
  return project.addSourceFileAtPath(path);
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The root identifier of a call chain: `expect(a).not.toBe(b)` → `expect`. */
function chainRoot(node: Node): string | undefined {
  let current: Node = node;
  for (;;) {
    if (Node.isCallExpression(current)) {
      current = current.getExpression();
    } else if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
    } else if (Node.isAwaitExpression(current)) {
      current = current.getExpression();
    } else if (Node.isIdentifier(current)) {
      return current.getText();
    } else {
      return undefined;
    }
  }
}

/** Outermost assertion calls: the whole `expect(x).toBe(y)`, not its parts. */
function assertions(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const root = chainRoot(call);
    if (root !== "expect" && root !== "assert" && !root?.startsWith("assert")) {
      continue;
    }
    const parent = call.getParent();
    const isInner =
      (Node.isPropertyAccessExpression(parent) ||
        Node.isCallExpression(parent)) &&
      chainRoot(parent) === root &&
      // `expect(expect.any(Number))`-style args are their own chain.
      !(Node.isCallExpression(parent) && parent.getArguments().includes(call));
    if (isInner) {
      continue;
    }
    out.push(normalise(call.getText()));
  }

  return out.sort();
}

/** The file with imports gone, dynamic-import specifiers blanked. */
function body(sf: SourceFile, rewrites: Array<[string, string]>): string {
  const cuts: Array<[number, number, string]> = [];
  for (const imp of sf.getImportDeclarations()) {
    cuts.push([imp.getFullStart(), imp.getEnd(), ""]);
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
      continue;
    }
    const arg = call.getArguments()[0];
    if (arg && Node.isStringLiteral(arg)) {
      cuts.push([arg.getStart(), arg.getEnd(), '"<specifier>"']);
    }
  }
  let text = sf.getFullText();
  for (const [start, end, replacement] of cuts.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  for (const [from, to] of rewrites) {
    text = text.split(from).join(to);
  }

  return text
    .split("\n")
    .filter((line) => !line.startsWith("// Ported from packages/core/src/"))
    .filter(
      (line) =>
        line !==
        "// Do not edit by hand: change the original and re-run the port.",
    )
    .join("\n")
    .trim();
}

function multisetDiff(
  a: string[],
  b: string[],
): { missing: string[]; extra: string[] } {
  const counts = new Map<string, number>();
  for (const x of a) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  const extra: string[] = [];
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n === 0) {
      extra.push(x);
    } else {
      counts.set(x, n - 1);
    }
  }
  const missing = [...counts].flatMap(([x, n]) => Array(n).fill(x) as string[]);

  return { missing, extra };
}

let failures = 0;
let files = 0;
let total = 0;
const fail = (message: string) => {
  failures++;
  console.error(`✗ ${message}`);
};

for (const [ported, original] of Object.entries(manifest)) {
  const portedPath = join(conformanceRoot, ported);
  const originalPath = join(repoRoot, original);
  if (!existsSync(portedPath)) {
    fail(`${ported} is in the manifest but missing; re-run the port`);
    continue;
  }
  if (!existsSync(originalPath)) {
    fail(`${original} no longer exists; re-run the port`);
    continue;
  }
  files++;
  const a = load(originalPath);
  const b = load(portedPath);

  const before = assertions(a);
  const after = assertions(b);
  total += before.length;
  const { missing, extra } = multisetDiff(before, after);
  for (const m of missing) {
    fail(`${ported}: assertion missing or changed: ${m.slice(0, 160)}`);
  }
  for (const e of extra) {
    fail(`${ported}: assertion not in the original: ${e.slice(0, 160)}`);
  }

  const rewrites = ENVIRONMENT_REWRITES[original] ?? [];
  for (const [from] of rewrites) {
    if (!a.getFullText().includes(from)) {
      fail(
        `${original}: declared environment rewrite no longer matches: ${from}`,
      );
    }
  }
  if (body(a, rewrites) !== body(b, [])) {
    fail(`${ported}: differs from ${original} outside import specifiers`);
  }
}

const expected = classification
  .filter((c) => c.category === "black-box" || c.category === "internals")
  .map((c) => `packages/core/src/${c.file}`);
const portedOriginals = new Set(Object.values(manifest));
for (const file of expected) {
  if (!portedOriginals.has(file)) {
    fail(`${file} is classified portable but has no port`);
  }
}
if (portedOriginals.size !== expected.length) {
  fail(
    `manifest has ${portedOriginals.size} originals, classification expects ${expected.length}`,
  );
}

// A core test added since the last port has no classification yet.
const coreSrc = join(repoRoot, "packages/core/src");
const classified = new Set(classification.map((c) => c.file));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" ? [] : walk(full);
    }

    return /\/__tests__\/[^/]+\.test\.ts$/.test(full) ? [full] : [];
  });
for (const file of walk(coreSrc)) {
  const rel = relative(coreSrc, file);
  if (!classified.has(rel)) {
    fail(
      `packages/core/src/${rel} is new since the last port; re-run the port`,
    );
  }
}

// 4. Every port sits in exactly one layer, and layers name only real ports.
const layers = JSON.parse(
  readFileSync(join(conformanceRoot, "layers.json"), "utf8"),
) as { layers: Record<string, { files: string[] }>; inferred: string[] };
const placed = new Map<string, string>();
for (const [layer, { files: layerFiles }] of Object.entries(layers.layers)) {
  for (const file of layerFiles) {
    const already = placed.get(file);
    if (already) {
      fail(`layers.json: ${file} is in both ${already} and ${layer}`);
    }
    placed.set(file, layer);
    if (!(file in manifest)) {
      fail(`layers.json: ${layer} names ${file}, which is not a port`);
    }
  }
}
for (const file of Object.keys(manifest)) {
  if (!placed.has(file)) {
    fail(`layers.json: ${file} is in no layer`);
  }
}
for (const file of layers.inferred) {
  if (!placed.has(file)) {
    fail(`layers.json: inferred ${file} is in no layer`);
  }
}

if (failures > 0) {
  console.error(
    `\n[check-expects] ${failures} problem(s) across ${files} files`,
  );
  process.exit(1);
}
console.log(
  `[check-expects] ${files} files, ${total} assertions: identical to the originals`,
);
