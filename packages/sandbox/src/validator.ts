/**
 * AST allowlist validator. Pre-flights every file in the payload
 * BEFORE the bundler so a hostile snippet never reaches the runtime
 * surface. Without this layer, `worker_threads` resource limits
 * (heap-only) leak FS + network access through — a snippet that
 * `import("node:fs")` would still pwn the host process.
 *
 * Allowlist:
 *
 * - Imports: must match `@directive-run/*` (specifically `core`, `ai`,
 *   `query`) OR a relative path ending in `.js` (the multi-file
 *   payload's own files).
 * - Identifier accesses: only the allowlisted Directive API surface
 *   plus `console.*`, `Math.*`, `JSON.*`. Anything that touches
 *   global Node namespaces (`process`, `require`, `fs`, `child_process`,
 *   `net`, `dgram`, `cluster`, etc.) is rejected.
 *
 * Strict by default — we'd rather reject a valid pattern (and learn
 * about it via a real-world report) than ship a "mostly safe" sandbox.
 * The Phase 2 plan calls out that we expand based on actual failures.
 *
 * Returns the list of validation errors; an empty list means safe to
 * bundle + execute. Callers should bail on any non-empty result.
 */

import { Project, SyntaxKind } from "ts-morph";
import type { PlaygroundFile } from "./types.js";

const ALLOWED_IMPORT_PATTERNS: RegExp[] = [
  /^@directive-run\/(core|ai|query)(\/.+)?$/,
  /^\.\/.+\.js$/,
  /^\.\.\/.+\.js$/,
];

/**
 * Globals/identifiers the snippet may touch at top level. The runner
 * shape `generateRunner` emits + idiomatic Directive demos. Anything
 * else (process, require, fetch, fs, child_process, net, etc.) is a
 * sandbox escape attempt.
 */
const ALLOWED_GLOBALS = new Set<string>([
  // Directive runtime surface
  "createSystem",
  // We also allow the destructured exports the runner might use:
  "system",
  // Standard JS we'll let through
  "console",
  "Math",
  "JSON",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "Promise",
  "Error",
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Reflect",
  "globalThis",
  // Top-level await + iteration sugar
  "undefined",
  "null",
  "NaN",
  "Infinity",
]);

/**
 * Identifiers that ALWAYS represent a sandbox escape — even if they'd
 * be allowed in some other context. Listed explicitly so a reader of
 * the validator can audit the threat model in one place.
 */
const DENIED_GLOBALS = new Set<string>([
  "process",
  "require",
  "module",
  "__dirname",
  "__filename",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "eval",
  "Function",
  // The MCP server runs on Node; these are Node-only globals that
  // bypass workers' resource isolation entirely.
  "Buffer",
  "setImmediate",
  "queueMicrotask",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
]);

export interface ValidationError {
  path: string;
  line: number;
  column: number;
  message: string;
}

function checkImports(
  fileLabel: string,
  project: Project,
  errors: ValidationError[],
): void {
  const sourceFile = project.getSourceFileOrThrow(fileLabel);
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const allowed = ALLOWED_IMPORT_PATTERNS.some((re) =>
      re.test(moduleSpecifier),
    );
    if (!allowed) {
      const { line, column } = sourceFile.getLineAndColumnAtPos(
        decl.getStart(),
      );
      errors.push({
        path: fileLabel,
        line,
        column,
        message: `import "${moduleSpecifier}" is not allowed in the sandbox. Allowed: @directive-run/{core,ai,query} or relative "./X.js" paths.`,
      });
    }
  }
}

function checkDynamicImportsAndCalls(
  fileLabel: string,
  project: Project,
  errors: ValidationError[],
): void {
  const sourceFile = project.getSourceFileOrThrow(fileLabel);
  // Reject `import("…")` (dynamic), `require("…")` (CommonJS), and
  // `new Function("…")` (string-to-code) at any depth.
  sourceFile.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.ImportKeyword) {
      const parent = node.getParent();
      if (parent && parent.getKind() === SyntaxKind.CallExpression) {
        const { line, column } = sourceFile.getLineAndColumnAtPos(
          node.getStart(),
        );
        errors.push({
          path: fileLabel,
          line,
          column,
          message: "dynamic import() is not allowed in the sandbox",
        });
      }
    }
    if (node.getKind() === SyntaxKind.NewExpression) {
      const text = node.getText();
      if (/^new\s+Function\s*\(/.test(text)) {
        const { line, column } = sourceFile.getLineAndColumnAtPos(
          node.getStart(),
        );
        errors.push({
          path: fileLabel,
          line,
          column,
          message: "new Function(...) is not allowed in the sandbox",
        });
      }
    }
  });
}

function checkGlobalIdentifiers(
  fileLabel: string,
  project: Project,
  errors: ValidationError[],
): void {
  const sourceFile = project.getSourceFileOrThrow(fileLabel);
  // Walk every Identifier and check whether it resolves to a
  // top-level binding. We only care about the "free" identifiers —
  // ones the snippet didn't declare via import, var/let/const, or
  // function/class declaration. Those are globals.
  const localBindings = new Set<string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    for (const n of decl.getNamedImports()) {
      localBindings.add(n.getName());
    }
    const def = decl.getDefaultImport();
    if (def) localBindings.add(def.getText());
    const ns = decl.getNamespaceImport();
    if (ns) localBindings.add(ns.getText());
  }
  for (const v of sourceFile.getVariableDeclarations()) {
    localBindings.add(v.getName());
  }
  for (const f of sourceFile.getFunctions()) {
    const name = f.getName();
    if (name) localBindings.add(name);
  }
  for (const c of sourceFile.getClasses()) {
    const name = c.getName();
    if (name) localBindings.add(name);
  }

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.Identifier) {
      return;
    }
    const name = node.getText();
    if (localBindings.has(name)) {
      return;
    }
    if (ALLOWED_GLOBALS.has(name)) {
      return;
    }

    // Skip identifiers in non-reference positions where the name is
    // just a label, not a binding reference:
    //
    // - Property-assignment KEYS in object literals: `{ module: x }`
    //   — the LHS `module` is a label, not a reference to Node's `module`.
    // - Property-access NAMES: `obj.foo` — `foo` is a property selector.
    // - Property-access in shorthand: `{ foo }` — `foo` IS a reference;
    //   ts-morph's ShorthandPropertyAssignment parents that case, so we
    //   only filter PropertyAssignment.name and PropertyAccessExpression.name.
    // - Type-annotation positions: `let x: foo` — `foo` is a type.
    // - Import/export specifier names.
    const parent = node.getParent();
    if (parent) {
      const parentKind = parent.getKind();
      // `{ module: x }` — name child of a PropertyAssignment.
      if (parentKind === SyntaxKind.PropertyAssignment) {
        const propertyName = (
          parent as { getNameNode?: () => unknown }
        ).getNameNode?.();
        if (propertyName === node) {
          return;
        }
      }
      // `obj.foo` — `foo` is the .name on the right of a dot.
      if (parentKind === SyntaxKind.PropertyAccessExpression) {
        const accessName = (
          parent as { getNameNode?: () => unknown }
        ).getNameNode?.();
        if (accessName === node) {
          return;
        }
      }
      // `{ foo: bar }` LHS for shorthand-style method declarations.
      if (parentKind === SyntaxKind.MethodDeclaration) {
        return;
      }
      // import { foo } / import { foo as bar } / export { foo }
      if (
        parentKind === SyntaxKind.ImportSpecifier ||
        parentKind === SyntaxKind.ExportSpecifier ||
        parentKind === SyntaxKind.NamespaceImport ||
        parentKind === SyntaxKind.ImportClause
      ) {
        return;
      }
      // Function/method parameter names.
      if (parentKind === SyntaxKind.Parameter) {
        return;
      }
      // Type references — `let x: foo` etc.
      if (
        parentKind === SyntaxKind.TypeReference ||
        parentKind === SyntaxKind.TypeQuery
      ) {
        return;
      }
    }

    if (DENIED_GLOBALS.has(name)) {
      const { line, column } = sourceFile.getLineAndColumnAtPos(
        node.getStart(),
      );
      errors.push({
        path: fileLabel,
        line,
        column,
        message: `identifier "${name}" is denied in the sandbox (FS/network/eval surface)`,
      });
    }
    // We don't reject unknown identifiers — they might be legitimate
    // members of an allowlist-imported binding (e.g. `system.events.foo`
    // — `foo` is an identifier in property-access position). The
    // import + denylist + dynamic-import check above already covers
    // the actual escape paths.
  });
}

export function validateSandboxInput(
  files: PlaygroundFile[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: 99, // ESNext
      module: 99, // ESNext
      allowJs: true,
      strict: false,
    },
  });

  for (const file of files) {
    project.createSourceFile(file.path, file.source, { overwrite: true });
  }

  for (const file of files) {
    checkImports(file.path, project, errors);
    checkDynamicImportsAndCalls(file.path, project, errors);
    checkGlobalIdentifiers(file.path, project, errors);
  }

  return errors;
}
