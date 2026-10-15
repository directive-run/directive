/**
 * Everything the port is allowed to change besides core import specifiers.
 *
 * One module, read by both the port and the check, so the two can never
 * disagree about what a faithful copy looks like.
 */

/** Paths are relative to packages/core. */
export interface EnvironmentRewrite {
  file: string;
  from: string;
  to: string;
  /** Names the replacement imports from helpers/engine.ts. */
  helpers: string[];
  why: string;
}

/**
 * Code that locates core's build relative to the test file's own path. A copy
 * lives elsewhere, so it asks the engine under test instead.
 */
export const ENVIRONMENT_REWRITES: EnvironmentRewrite[] = [
  {
    file: "src/core/__tests__/superseded-bodies-and-retry-timer.test.ts",
    from: 'join(here, "../../../dist/index.js")',
    to: "engineDistEntry()",
    helpers: ["engineDistEntry"],
    why: "The child-process exit test imports core's built ESM entry by a path relative to the test file.",
  },
  {
    file: "__tests__/dist-types.test.ts",
    from: 'join(packageDir, "dist", "index.d.ts")',
    to: "engineDistTypes()",
    helpers: ["engineDistTypes"],
    why: "Typechecks a fixture against the engine's published declarations, found relative to the test file.",
  },
  {
    file: "__tests__/dist-types.test.ts",
    from: 'join(packageDir, "..", "..")',
    to: "workspaceRoot()",
    helpers: ["workspaceRoot"],
    why: "Finds the workspace's typescript binary relative to the test file.",
  },
];

/** Tests that inspect core's 1.x build output rather than behaviour. */
export const NOT_ENGINE_BEHAVIOUR = new Map<string, string>([
  [
    "src/__tests__/dev-mode-bundle.test.ts",
    "Reads core's dist/ files and package.json to check what each build ships. A packaging test for the 1.x build, not engine behaviour; 2.0 gets its own size and dev-text gates.",
  ],
]);

/** The header the port writes on every copy. */
export function header(original: string): string[] {
  return [
    `// Ported from packages/core/${original} by packages/conformance/scripts/port.ts.`,
    "// Do not edit by hand: change the original and re-run the port.",
  ];
}

/** `src/core/__tests__/x.test.ts` → `tests/core/x.test.ts`. */
export function portPath(original: string): string {
  const parts = original
    .split("/")
    .filter((p) => p !== "__tests__" && p !== "src");
  if (parts.length === 1) {
    return `tests/${original.startsWith("src/") ? "root" : "package"}/${parts[0]}`;
  }

  return `tests/${parts.join("/")}`;
}
