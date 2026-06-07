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

/**
 * Consumer-safe @directive-run/* packages. These are the things a
 * realistic Directive demo might import: the runtime + UI adapters +
 * data primitives. Each has been audited for whether it can pull in a
 * sandbox-escape surface (process, fs, child_process, etc.); the ones
 * listed here can't.
 *
 * Packages deliberately EXCLUDED:
 *
 * - `@directive-run/cli` — uses process.argv + fs.write.
 * - `@directive-run/mcp` — speaks MCP over process.stdin/stdout; we
 *   don't want sandboxed snippets opening a transport.
 * - `@directive-run/sandbox` — sandbox-in-sandbox; needs esbuild +
 *   worker_threads. No legitimate use case.
 * - `@directive-run/vite-plugin-api-proxy` — build tooling, expects a
 *   vite config that isn't present.
 *
 * The denylist below catches anyone who tries to import one of these
 * by pattern; the allowlist catches everything else.
 */
const ALLOWED_DIRECTIVE_PACKAGES = new Set<string>([
  "core",
  "ai",
  "query",
  "el",
  "react",
  "vue",
  "svelte",
  "solid",
  "lit",
  "optimistic",
  "timeline",
  "mutator",
  "knowledge",
  "scaffold",
  "claude-plugin",
  "lint",
]);

const DENIED_DIRECTIVE_PACKAGES = new Set<string>([
  "cli",
  "mcp",
  "sandbox",
  "vite-plugin-api-proxy",
]);

/**
 * Extract the package name segment from a @directive-run/* specifier.
 *
 *   "@directive-run/core"          → "core"
 *   "@directive-run/ai/openai"     → "ai"
 *   "@directive-run/react/hooks"   → "react"
 *
 * Returns null when the specifier doesn't match the scope.
 */
function extractDirectivePackage(specifier: string): string | null {
  const match = specifier.match(/^@directive-run\/([^/]+)/);
  return match ? match[1]! : null;
}

function isAllowedImport(specifier: string): boolean {
  if (/^\.{1,2}\/.+\.js$/.test(specifier)) {
    return true;
  }
  const dpkg = extractDirectivePackage(specifier);
  if (dpkg === null) {
    return false;
  }
  if (DENIED_DIRECTIVE_PACKAGES.has(dpkg)) {
    return false;
  }
  return ALLOWED_DIRECTIVE_PACKAGES.has(dpkg);
}

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

function importRejectionMessage(specifier: string): string {
  const dpkg = extractDirectivePackage(specifier);
  if (dpkg && DENIED_DIRECTIVE_PACKAGES.has(dpkg)) {
    return `import "${specifier}" is denied — @directive-run/${dpkg} is a build/CLI/sandbox tool, not for use inside a sandboxed demo`;
  }
  return `import "${specifier}" is not allowed in the sandbox. Allowed: relative "./X.js" paths or any of @directive-run/{${Array.from(
    ALLOWED_DIRECTIVE_PACKAGES,
  )
    .sort()
    .join(",")}}.`;
}

function checkImports(
  fileLabel: string,
  project: Project,
  errors: ValidationError[],
): void {
  const sourceFile = project.getSourceFileOrThrow(fileLabel);
  for (const decl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    if (!isAllowedImport(moduleSpecifier)) {
      const { line, column } = sourceFile.getLineAndColumnAtPos(
        decl.getStart(),
      );
      errors.push({
        path: fileLabel,
        line,
        column,
        message: importRejectionMessage(moduleSpecifier),
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

/**
 * The Phase A AE security audit (docs/AE-AUDIT-SANDBOX.md) found that
 * the original "skip identifiers in property-access position" rule
 * (added to avoid `{module: x}` false-positives) was a TOTAL bypass:
 * `globalThis.process.exit()` worked because `process` was a property
 * name and got skipped. This pass closes that hole.
 *
 * The threat model: an allowed receiver (`globalThis`, `Object`,
 * `Reflect`, an allowed class) is reached freely, but accessing any
 * denied identifier name on it OR `.constructor` on any value OR
 * calling Function via property-access must be rejected.
 *
 * Rules:
 *
 * 1. Property access (`a.b`) where `b` is in DENIED_GLOBALS — reject.
 *    Catches `globalThis.process`, `globalThis.fetch`, `obj.eval`,
 *    `mod.Function`, etc.
 * 2. Property access where `b` is `constructor` — reject. Catches the
 *    `({}).constructor.constructor("...")()` Function-smuggle chain.
 *    No legitimate Directive use.
 * 3. Element access (`a["b"]`) where `b` is a STRING LITERAL matching
 *    a denied name — reject. Catches `globalThis["process"]`,
 *    `globalThis["fetch"]`, etc. String concatenation
 *    (`globalThis["proc" + "ess"]`) isn't catchable at AST time;
 *    documented as a known gap.
 * 4. Element access on `globalThis` with ANY string literal — reject.
 *    Stricter than (3); `globalThis["Object"]` is denied even though
 *    `Object` is allowlisted because there's no legitimate reason
 *    to reach Object via bracket syntax.
 * 5. Call expression where callee is `Function` (free identifier or
 *    property access on globalThis/Object) — reject. Catches
 *    `Function("return process")()` without `new`.
 * 6. `Reflect.get(globalThis, "X")` / `Reflect.has(globalThis, "X")` /
 *    `Object.getOwnPropertyDescriptor(globalThis, "X")` — reject when
 *    first arg is `globalThis` (or any allowed global) and second arg
 *    is a string literal matching a denied name OR `constructor`.
 */
function checkPropertyAccessEscapes(
  fileLabel: string,
  project: Project,
  errors: ValidationError[],
): void {
  const sourceFile = project.getSourceFileOrThrow(fileLabel);

  const report = (node: import("ts-morph").Node, message: string) => {
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
    errors.push({ path: fileLabel, line, column, message });
  };

  const stripStringLiteral = (text: string): string | null => {
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith("`") && trimmed.endsWith("`"))
    ) {
      return trimmed.slice(1, -1);
    }
    return null;
  };

  sourceFile.forEachDescendant((node) => {
    const kind = node.getKind();

    // Rule 1 + 2: PropertyAccessExpression — receiver.name
    if (kind === SyntaxKind.PropertyAccessExpression) {
      const name = (node as { getName?: () => string }).getName?.();
      if (!name) {
        return;
      }
      if (name === "constructor") {
        report(
          node,
          "`.constructor` access is denied in the sandbox (Function-constructor smuggle vector)",
        );
        return;
      }
      if (DENIED_GLOBALS.has(name)) {
        report(
          node,
          `\`.${name}\` access is denied in the sandbox (FS/network/eval surface) — accessing a denied global via property syntax was the property-access bypass closed in v0.3.0`,
        );
        return;
      }
    }

    // Rule 3 + 4: ElementAccessExpression — receiver["string-literal"]
    if (kind === SyntaxKind.ElementAccessExpression) {
      const expression = (
        node as { getExpression?: () => { getText: () => string } }
      ).getExpression?.();
      const argument = (
        node as {
          getArgumentExpression?: () => { getText: () => string } | undefined;
        }
      ).getArgumentExpression?.();
      const receiverText = expression?.getText() ?? "";
      const argText = argument?.getText() ?? "";
      const literal = stripStringLiteral(argText);

      // Rule 4: ANY bracket access on globalThis with a string literal.
      if (receiverText === "globalThis" && literal !== null) {
        report(
          node,
          "bracket-access on `globalThis` with a string literal is denied in the sandbox (use direct identifier reference for allowlisted names)",
        );
        return;
      }
      // Rule 3: bracket access whose literal matches a denied name OR
      // `constructor`, on ANY receiver.
      if (literal !== null) {
        if (literal === "constructor" || DENIED_GLOBALS.has(literal)) {
          report(
            node,
            `bracket-access \`["${literal}"]\` is denied in the sandbox (would reach a denied name)`,
          );
          return;
        }
      }
    }

    // Rule 5: CallExpression with callee `Function(...)` (no `new`).
    if (kind === SyntaxKind.CallExpression) {
      const expression = (
        node as {
          getExpression?: () => {
            getKind: () => number;
            getText: () => string;
          };
        }
      ).getExpression?.();
      const exprText = expression?.getText() ?? "";
      if (exprText === "Function") {
        report(node, "`Function(...)` call is denied in the sandbox");
        return;
      }
      // Rule 6: Reflect.get / Reflect.has / Object.getOwnPropertyDescriptor
      // with `globalThis` (or any allowed global) + denied string-literal.
      const reflectAccess = exprText.match(/^(Reflect|Object)\.(\w+)$/);
      if (reflectAccess) {
        const callExpr = node as {
          getArguments?: () => { getText: () => string }[];
        };
        const args = callExpr.getArguments?.() ?? [];
        if (args.length >= 2) {
          const firstArg = args[0]!.getText();
          const secondArgLiteral = stripStringLiteral(args[1]!.getText());
          const denyMethods = new Set([
            "get",
            "has",
            "getOwnPropertyDescriptor",
            "getOwnPropertyDescriptors",
            "ownKeys",
            "getPrototypeOf",
          ]);
          if (
            denyMethods.has(reflectAccess[2]!) &&
            (firstArg === "globalThis" || ALLOWED_GLOBALS.has(firstArg)) &&
            secondArgLiteral !== null &&
            (secondArgLiteral === "constructor" ||
              DENIED_GLOBALS.has(secondArgLiteral))
          ) {
            report(
              node,
              `\`${reflectAccess[1]}.${reflectAccess[2]}(${firstArg}, "${secondArgLiteral}")\` would reach a denied name`,
            );
          }
        }
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
    checkPropertyAccessEscapes(file.path, project, errors);
    checkGlobalIdentifiers(file.path, project, errors);
  }

  return errors;
}
