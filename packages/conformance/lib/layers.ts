/**
 * Which 2.0 layer each test needs: the highest feature it actually uses.
 *
 * A test uses a feature when the code it runs mentions it: its own body, the
 * hooks and declarations of the describes around it, and every file-level
 * function or constant it reaches. Three kinds of mention count:
 *
 * - a core export it calls, placed by the module that declares it
 *   (`loggingPlugin` lives in plugins/ → L12);
 * - an option key in a definition (`resolvers.<id>.batch` → L7);
 * - a system method or property (`system.history` → L8).
 *
 * Over-approximating is the safe direction: a test placed too high only runs
 * later than it could; a test placed too low fails an engine that is right.
 */

import { relative } from "node:path";
import { type Identifier, Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type StaticTest, isDescribeCall, isTestCall } from "./tests.js";

export const LAYERS = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "L6",
  "L7",
  "L8",
  "L9",
  "L10",
  "L11",
  "L12",
  "L13",
] as const;
export type Layer = (typeof LAYERS)[number];

export const layerIndex = (layer: Layer): number => LAYERS.indexOf(layer);

/** Core source path (relative to packages/core/src) → layer. First match wins. */
const MODULE_LAYERS: [RegExp, Layer][] = [
  [/^plugins\/persistence\b/, "L6"],
  [/^plugins\//, "L12"],
  [/^(utils\/testing|utils\/migration|adapters\/|adapter-utils)/, "L13"],
  [/^(utils\/history|core\/history)/, "L8"],
  [
    /^core\/(predicate|doctor|rules-diff|predict|replay-under|sweep-under)/,
    "L11",
  ],
  [/^core\/schema-introspection/, "L6"],
  [/^core\/(sources|types\/sources)/, "L5"],
  [/^core\/(clock|timer|errors|plugins|types\/plugins)/, "L3"],
  [/^core\/(constraints|resolvers|requirements)/, "L2"],
  [/^core\/(module|system|engine)/, "L1"],
  [
    /^core\/(facts|derivations|tracking|schema-builders|effects|types\/|types\.ts)/,
    "L0",
  ],
];

/** Exports placed by name where their module holds more than one layer. */
const NAME_LAYERS: Record<string, Layer> = {
  // utils/utils.ts holds unrelated helpers; place what tests use by name.
  signSnapshot: "L12",
  verifySnapshotSignature: "L12",
};

/** `chain` is the option-key path, innermost last; `*` matches any one key. */
const OPTION_LAYERS: [string[], Layer, string][] = [
  [["resolvers", "*", "batch"], "L7", "batch resolver"],
  [["effects", "*", "deps"], "L4", "effect deps"],
  [["effects", "*", "on"], "L4", "effect on"],
  [["constraints"], "L2", "constraints"],
  [["resolvers"], "L2", "resolvers"],
  [["plugins"], "L3", "plugins"],
  [["errorBoundary"], "L3", "error boundary"],
  [["sources"], "L5", "sources"],
  [["history"], "L8", "history"],
  [["meta"], "L9", "meta"],
  [["modules"], "L1", "modules"],
  [["crossModuleDeps"], "L1", "crossModuleDeps"],
];

/** Member names, on any receiver. */
const MEMBER_LAYERS: Record<string, Layer> = {
  inspect: "L9",
  observe: "L9",
  explain: "L9",
  why: "L9",
  trace: "L9",
  meta: "L9",
  history: "L8",
  goBack: "L8",
  goForward: "L8",
  goTo: "L8",
  hydrate: "L6",
  getSnapshot: "L6",
  restore: "L6",
  refine: "L6",
  transform: "L6",
  brand: "L6",
  getDistributableSnapshot: "L12",
  watchDistributableSnapshot: "L12",
  registerModule: "L10",
  unregisterModule: "L10",
  evict: "L10",
  whenReady: "L3",
  stopAsync: "L3",
  destroyAsync: "L3",
  onSettledChange: "L3",
};

/** Members that are dynamic-definition calls only on a definition registry. */
const REGISTRY_MEMBERS = new Set([
  "register",
  "unregister",
  "assign",
  "call",
  "isDynamic",
  "listDynamic",
]);
const REGISTRIES = new Set([
  "constraints",
  "resolvers",
  "effects",
  "derive",
  "events",
]);

export interface Feature {
  name: string;
  layer: Layer;
}

export class UnknownModuleError extends Error {}

/** Core bindings a file imports, statically or by `await import`. */
function coreBindings(
  sf: SourceFile,
  coreSrc: string,
  isCoreFile: (file: string) => boolean,
): Map<string, Feature> {
  const bindings = new Map<string, Feature>();
  const place = (local: string, exported: string, target: SourceFile) => {
    if (!isCoreFile(target.getFilePath())) {
      return;
    }
    const byName = NAME_LAYERS[exported];
    if (byName) {
      bindings.set(local, { name: exported, layer: byName });
      return;
    }
    const decls = target.getExportedDeclarations().get(exported) ?? [];
    const decl = decls[0];
    if (!decl) {
      return;
    }
    const path = relative(coreSrc, decl.getSourceFile().getFilePath());
    const match = MODULE_LAYERS.find(([re]) => re.test(path));
    if (!match) {
      throw new UnknownModuleError(
        `layers: no layer for ${exported} (declared in ${path}); add it to MODULE_LAYERS or NAME_LAYERS`,
      );
    }
    bindings.set(local, { name: exported, layer: match[1] });
  };

  for (const imp of sf.getImportDeclarations()) {
    const target = imp.getModuleSpecifierSourceFile();
    if (!target || imp.isTypeOnly()) {
      continue;
    }
    for (const named of imp.getNamedImports()) {
      if (named.isTypeOnly()) {
        continue;
      }
      const local = named.getAliasNode()?.getText() ?? named.getName();
      place(local, named.getName(), target);
    }
  }

  // `const { createModule } = await import("../../index.js")`
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getNameNode();
    const call = decl
      .getInitializer()
      ?.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (
      !Node.isObjectBindingPattern(name) ||
      !call ||
      call.getExpression().getKind() !== SyntaxKind.ImportKeyword
    ) {
      continue;
    }
    const arg = call.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) {
      continue;
    }
    const target = sf
      .getProject()
      .getSourceFile(
        (p) =>
          p.getFilePath() ===
          resolveSibling(sf.getFilePath(), arg.getLiteralText()),
      );
    if (!target) {
      continue;
    }
    for (const el of name.getElements()) {
      const exported = el.getPropertyNameNode()?.getText() ?? el.getName();
      place(el.getName(), exported, target);
    }
  }

  return bindings;
}

function resolveSibling(from: string, spec: string): string {
  const dir = from.slice(0, from.lastIndexOf("/"));
  const parts = `${dir}/${spec}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      out.pop();
    } else if (p !== ".") {
      out.push(p);
    }
  }

  return out.join("/").replace(/\.js$/, ".ts");
}

/** Option-key path of a property assignment, outermost first. */
function optionChain(node: Node): string[] {
  const chain: string[] = [];
  let current: Node | undefined = node;
  while (current) {
    if (
      Node.isPropertyAssignment(current) ||
      Node.isShorthandPropertyAssignment(current) ||
      Node.isMethodDeclaration(current)
    ) {
      chain.unshift(current.getName().replace(/^["']|["']$/g, ""));
    }
    current = current.getParent();
  }

  return chain;
}

function matchesSuffix(chain: string[], pattern: string[]): boolean {
  if (chain.length < pattern.length) {
    return false;
  }
  const tail = chain.slice(chain.length - pattern.length);

  return pattern.every((p, i) => p === "*" || p === tail[i]);
}

/** Features mentioned anywhere inside `root`. */
function featuresIn(root: Node, bindings: Map<string, Feature>): Feature[] {
  const out: Feature[] = [];
  root.forEachDescendant((node) => {
    if (Node.isIdentifier(node)) {
      const f = bindings.get(node.getText());
      const parent = node.getParent();
      const isMemberName =
        Node.isPropertyAccessExpression(parent) &&
        parent.getNameNode() === node;
      if (f && !isMemberName) {
        out.push({ name: `import ${f.name}`, layer: f.layer });
      }
    } else if (
      Node.isPropertyAssignment(node) ||
      Node.isShorthandPropertyAssignment(node) ||
      Node.isMethodDeclaration(node)
    ) {
      const chain = optionChain(node);
      // A fact, event or derivation may be named like an option.
      if (chain.some((k) => k === "schema" || k === "facts")) {
        return;
      }
      for (const [pattern, layer, label] of OPTION_LAYERS) {
        if (matchesSuffix(chain, pattern)) {
          out.push({ name: `option ${label}`, layer });
        }
      }
      if (matchesSuffix(chain, ["effects", "*", "run"])) {
        const fn = Node.isPropertyAssignment(node)
          ? node.getInitializer()
          : node;
        if (
          fn &&
          (Node.isArrowFunction(fn) ||
            Node.isFunctionExpression(fn) ||
            Node.isMethodDeclaration(fn)) &&
          fn.getParameters().length >= 2
        ) {
          out.push({ name: "option effect prev", layer: "L4" });
        }
      }
    } else if (Node.isPropertyAccessExpression(node)) {
      const name = node.getName();
      const layer = MEMBER_LAYERS[name];
      if (layer) {
        out.push({ name: `member .${name}`, layer });
      }
      const receiver = node.getExpression();
      if (
        REGISTRY_MEMBERS.has(name) &&
        Node.isPropertyAccessExpression(receiver) &&
        REGISTRIES.has(receiver.getName())
      ) {
        out.push({
          name: `member .${receiver.getName()}.${name}`,
          layer: "L10",
        });
      }
    }
  });

  return out;
}

/** File- and describe-level code a test can reach. */
function reachable(test: StaticTest, sf: SourceFile): Node[] {
  const nodes: Node[] = [];
  const fn = test.call.getArguments()[1];
  if (fn) {
    nodes.push(fn);
  }

  const isBlockStatement = (s: Node) => {
    const call = Node.isExpressionStatement(s) ? s.getExpression() : undefined;

    return (
      !!call &&
      Node.isCallExpression(call) &&
      (isTestCall(call) || isDescribeCall(call))
    );
  };

  // Hooks and declarations of every enclosing describe.
  for (const describe of test.describes) {
    const body = describe.getArguments()[1];
    if (
      body &&
      (Node.isArrowFunction(body) || Node.isFunctionExpression(body))
    ) {
      const block = body.getBody();
      if (Node.isBlock(block)) {
        for (const s of block.getStatements()) {
          if (!isBlockStatement(s)) {
            nodes.push(s);
          }
        }
      }
    }
  }

  // File-level hooks always run; file-level declarations run when reached.
  const declarations = new Map<string, Node>();
  for (const s of sf.getStatements()) {
    if (Node.isImportDeclaration(s) || isBlockStatement(s)) {
      continue;
    }
    if (Node.isFunctionDeclaration(s) || Node.isClassDeclaration(s)) {
      const name = s.getName();
      if (name) {
        declarations.set(name, s);
      }
    } else if (Node.isVariableStatement(s)) {
      for (const d of s.getDeclarations()) {
        for (const id of d
          .getNameNode()
          .getDescendantsOfKind(SyntaxKind.Identifier)) {
          declarations.set(id.getText(), s);
        }
        if (Node.isIdentifier(d.getNameNode())) {
          declarations.set(d.getName(), s);
        }
      }
    } else {
      nodes.push(s);
    }
  }

  const included = new Set<Node>(nodes);
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.pop() as Node;
    for (const id of node.getDescendantsOfKind(
      SyntaxKind.Identifier,
    ) as Identifier[]) {
      const decl = declarations.get(id.getText());
      if (decl && !included.has(decl)) {
        included.add(decl);
        queue.push(decl);
      }
    }
  }

  return [...included];
}

export interface TestLayer {
  layer: Layer;
  /** The features that set the layer. */
  by: string[];
  /** Features above the layer that this file's rule pulls down into it. */
  pulledDown?: string[];
  /** Pinned files only: every feature that lifts the test above its rule. */
  above?: string[];
  dynamic?: true;
}

export interface FileRule {
  rule: Layer;
  /** Correctness file: no test may sit above `rule` except via `allowAbove`. */
  pin?: boolean;
  /** Features used only to observe; they do not raise a test above `rule`. */
  instruments?: string[];
  /** Features that may raise a pinned test above `rule`, with the reason. */
  allowAbove?: Record<string, string>;
}

export function layerTests(
  sf: SourceFile,
  tests: StaticTest[],
  rule: FileRule,
  coreSrc: string,
  isCoreFile: (file: string) => boolean,
): Record<string, TestLayer> {
  const bindings = coreBindings(sf, coreSrc, isCoreFile);
  const out: Record<string, TestLayer> = {};
  const ruleIndex = layerIndex(rule.rule);
  const instruments = new Set(rule.instruments ?? []);

  for (const test of tests) {
    const features = reachable(test, sf).flatMap((n) =>
      featuresIn(n, bindings),
    );
    const unique = new Map<string, Feature>();
    for (const f of features) {
      unique.set(f.name, f);
    }
    const all = [...unique.values()];
    const raising = all.filter((f) => !instruments.has(f.name));
    const pulled = all
      .filter((f) => instruments.has(f.name) && layerIndex(f.layer) > ruleIndex)
      .map((f) => `${f.name} (${f.layer})`)
      .sort();
    const top = raising.reduce(
      (max, f) => Math.max(max, layerIndex(f.layer)),
      0,
    );
    const layer = LAYERS[top] as Layer;
    const entry: TestLayer = {
      layer,
      by: raising
        .filter((f) => f.layer === layer)
        .map((f) => f.name)
        .sort(),
    };
    if (pulled.length > 0) {
      entry.pulledDown = pulled;
    }
    const above = raising
      .filter((f) => layerIndex(f.layer) > ruleIndex)
      .map((f) => f.name)
      .sort();
    if (rule.pin && above.length > 0) {
      entry.above = above;
    }
    if (test.dynamic) {
      entry.dynamic = true;
    }
    out[test.key] = entry;
  }

  return out;
}
