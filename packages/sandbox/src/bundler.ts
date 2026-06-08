/**
 * esbuild adapter for the sandbox. Takes the user's multi-file payload
 * and produces a single ESM string the worker can evaluate.
 *
 * `@directive-run/*` packages are marked **external** — the worker
 * imports them at runtime via Node's normal ESM resolver, which finds
 * them in `node_modules`. We don't inline them because (a) bundle size
 * would explode, (b) they're already cached in the parent process so
 * the runtime resolver is fast.
 *
 * The bundler uses the in-memory plugin pattern: every file in the
 * payload is registered as a virtual entry, and relative imports
 * resolve against the in-memory map. esbuild handles TS → JS, top-
 * level await, and ESM linking in one pass.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { PlaygroundFile } from "./types.js";

/**
 * Resolve a `@directive-run/*` bare specifier to an absolute file://
 * URL using the host process's node_modules. Required because the
 * worker imports the bundle from `/tmp` (Phase A P0-A1) where Node's
 * ESM resolver can't walk up to find `@directive-run/*`. By rewriting
 * to absolute file URLs at bundle time, the worker doesn't need a
 * node_modules anchor.
 *
 * Returns null when the package can't be resolved (e.g. consumer has
 * a different install layout); the caller falls back to leaving the
 * bare specifier in place, which works when the worker IS next to
 * node_modules.
 */
function resolveDirectivePackageToFileUrl(specifier: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(specifier);
    return pathToFileURL(resolved).href;
  } catch {
    return null;
  }
}

const ENTRY_PATH = "src/main.ts";
const VIRTUAL_NAMESPACE = "directive-sandbox-vfs";

export interface BundleResult {
  /** Single ESM string ready to evaluate inside the worker. */
  source: string;
  /** Total bytes of the bundled JS (informational). */
  bytes: number;
}

export class BundleError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BundleError";
  }
}

/**
 * Find the `var system = createSystem(...)` declaration esbuild
 * emits for the runner and inject a side-channel global assignment
 * immediately after it. Captures the system BEFORE any subsequent
 * `system.start()`, dispatches, or `await system.settle()` can
 * throw — so the worker can post-mortem facts even on a runtime
 * error inside the user's runner.
 *
 * esbuild's output uses `var` for hoisted top-level bindings, and
 * the entry's `const system = createSystem(...)` becomes one of:
 *
 *   var system = createSystem({ ... });
 *   var system2 = createSystem({ ... });   // when "system" collides
 *
 * The regex tolerates both. If no match, returns the source
 * unchanged (the entry-file epilogue still handles the clean-run
 * case via the appended assignment).
 */
function injectEarlyCapture(bundled: string): string {
  const re = /(var\s+(system\d*)\s*=\s*createSystem\s*\([\s\S]*?\)\s*;)/;
  const match = bundled.match(re);
  if (!match) {
    return bundled;
  }
  const decl = match[1]!;
  const localName = match[2]!;
  const capture = `\n(globalThis).__directiveSandbox_system__ = ${localName};\n`;
  return bundled.replace(decl, decl + capture);
}

export async function bundleSandboxFiles(
  files: PlaygroundFile[],
): Promise<BundleResult> {
  const entry = files.find((f) => f.path === ENTRY_PATH);
  if (!entry) {
    throw new BundleError(
      `payload must include "${ENTRY_PATH}" — that's the entry point the runner targets`,
    );
  }

  const fileMap = new Map<string, string>();
  for (const file of files) {
    fileMap.set(file.path, file.source);
  }

  try {
    const result = await build({
      entryPoints: [`${VIRTUAL_NAMESPACE}:${ENTRY_PATH}`],
      bundle: true,
      format: "esm",
      target: "node20",
      platform: "node",
      write: false,
      logLevel: "silent",
      // The plugin's onResolve below intercepts every `@directive-run/*`
      // import and rewrites it to an absolute file:// URL (so the
      // worker can import the bundle from /tmp without needing
      // node_modules above it). The wildcard external is the safety
      // net for any specifier the plugin doesn't recognize.
      external: ["@directive-run/*"],
      // Top-level await is required (the runner does `await system.settle()`)
      // and node20 supports it natively.
      supported: { "top-level-await": true },
      plugins: [
        {
          name: "directive-sandbox-vfs",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === "entry-point") {
                const path = args.path.replace(`${VIRTUAL_NAMESPACE}:`, "");
                return { path, namespace: VIRTUAL_NAMESPACE };
              }
              if (args.namespace !== VIRTUAL_NAMESPACE) {
                return null;
              }
              if (args.path.startsWith("@directive-run/")) {
                // Phase A audit P0-A1: rewrite to absolute file:// URL
                // so the worker's `/tmp/.../bundle.mjs` can import the
                // package without needing node_modules above /tmp.
                // Falls back to the bare specifier when resolution
                // fails — the legacy "write next to node_modules"
                // pattern still works as a backup.
                const resolved = resolveDirectivePackageToFileUrl(args.path);
                if (resolved) {
                  return { external: true, path: resolved };
                }
                return { external: true, path: args.path };
              }
              if (args.path.startsWith("./") || args.path.startsWith("../")) {
                // Resolve relative to the importer's path.
                const importerDir = args.importer.replace(/\/[^/]+$/, "");
                // The runner imports `./counter.js`; the actual virtual
                // file lives at `src/counter.ts`. Strip the `.js` and
                // try both extensions so users can write either.
                const stripped = args.path
                  .replace(/^\.\//, "")
                  .replace(/\.js$/, "");
                const candidates = [
                  `${importerDir}/${stripped}.ts`,
                  `${importerDir}/${stripped}.js`,
                  `${importerDir}/${stripped}`,
                  // Also try the raw path in case the importer's dir
                  // resolution misses the leading slash.
                  `${stripped}.ts`,
                  `${stripped}.js`,
                ].map((p) => p.replace(/\/+/g, "/"));

                for (const candidate of candidates) {
                  if (fileMap.has(candidate)) {
                    return { path: candidate, namespace: VIRTUAL_NAMESPACE };
                  }
                }
                throw new BundleError(
                  `cannot resolve "${args.path}" from "${args.importer}" — tried ${candidates.join(", ")}`,
                );
              }
              throw new BundleError(
                `unexpected import "${args.path}" from "${args.importer}" — only relative or @directive-run/* allowed`,
              );
            });
            b.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, (args) => {
              const contents = fileMap.get(args.path);
              if (contents === undefined) {
                throw new BundleError(`virtual file missing: ${args.path}`);
              }
              // For the entry file, append a trailing assignment so the
              // runner's top-level `const system = …` binding ends up on
              // a side-channel global the worker reads after execution.
              // ESM module exports are sealed, so we can't patch
              // `createSystem` post-import; instead we lift the binding
              // out of the entry module's scope here. The convention is
              // documented by `@directive-run/scaffold`'s `generateRunner`
              // which always names the local binding `system`.
              if (args.path === ENTRY_PATH) {
                const epilogue = [
                  "",
                  "// directive-sandbox: lift the runner's `system` binding",
                  "// onto a side-channel global so the worker can read",
                  "// system.facts.$store.toObject() after execution.",
                  "if (typeof system !== 'undefined') {",
                  "  (globalThis).__directiveSandbox_system__ = system;",
                  "}",
                ].join("\n");
                return { contents: contents + epilogue, loader: "ts" };
              }
              return { contents, loader: "ts" };
            });
          },
        },
      ],
    });
    const rawSource = result.outputFiles[0]?.text;
    if (!rawSource) {
      throw new BundleError("esbuild produced no output");
    }
    // Inject an early-capture immediately after `createSystem(...)` so
    // the worker can read facts even when subsequent runner code throws
    // (e.g. an async settle() rejection from a bad event payload). The
    // entry-file epilogue (appended in onLoad) only fires on a clean
    // run; this regex fires regardless. Idempotent — duplicate
    // assignments to the same global are harmless.
    const source = injectEarlyCapture(rawSource);
    return { source, bytes: Buffer.byteLength(source, "utf8") };
  } catch (err) {
    if (err instanceof BundleError) {
      throw err;
    }
    throw new BundleError(
      `bundle failed: ${(err as Error).message ?? String(err)}`,
      err,
    );
  }
}
