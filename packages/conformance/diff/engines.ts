/**
 * The engines in one process, a fresh instance for every run.
 *
 * The other projects alias `@directive-run/core` to one engine each. A
 * differential scenario needs them side by side, so it loads each engine's
 * root entry by file, from the same derivations the vitest config uses
 * (`lib/core-entries.ts`):
 *
 * - `v1` — the published 1.35 development build (the reference);
 * - `local` — the workspace's core source;
 * - `v2` — `packages/core-next/src/index.ts`, once it exists. Until then it
 *   is absent and `v2Status()` says why; the census prints it.
 *
 * Every run gets a fresh module instance (`vi.resetModules()` before the
 * import; the diff project inlines `directive-v1` so the reset reaches it).
 * Engine module state — 1.35 dedupes some dev warnings per process, for
 * example — would otherwise make a run depend on which scenarios ran before
 * it, and two engines that keep that state in different places (per process
 * vs per system) would differ by test order rather than by behaviour.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type * as Core from "@directive-run/core";
import { vi } from "vitest";
import {
  coreEntries,
  defaultRepoRoot,
  v1Entries,
  v2Entries,
} from "../lib/core-entries.js";

export type CoreApi = typeof Core;

export type EngineName = "v1" | "local" | "v2";

export interface EngineHandle {
  name: EngineName | string;
  /** The entry file the engine is loaded from. */
  file: string;
  /** A fresh instance of the engine's public API. */
  load(): Promise<CoreApi>;
  /**
   * The engine's `/plugins` entry, from the instance the last `load()`
   * created (same module graph), or undefined if it has none.
   */
  loadPlugins(): Promise<Record<string, any> | undefined>;
  /**
   * Every other subpath the engine ships (`./testing`, `./adapter-utils`,
   * `./worker`, `./migration`, `./internals`), from the instance the last
   * `load()` created, keyed by the package.json subpath. A subpath the
   * engine has no file for is absent. Not-yet-built v2 entries are core-next's
   * stubs, which load and throw `featureMissing` when called.
   */
  loadEntries(): Promise<Record<string, Record<string, any>>>;
}

/** The subpaths `loadEntries` offers (the root and `./plugins` have their own). */
export const OTHER_SUBPATHS = [
  "./testing",
  "./adapter-utils",
  "./worker",
  "./migration",
  "./internals",
] as const;

/** core-next's root entry (it does not exist before Phase 1). */
export const V2_ENTRY = join(
  defaultRepoRoot,
  "packages/core-next/src/index.ts",
);

/**
 * An engine loaded from `file`, a fresh instance per load. Its plugins
 * entry defaults to `plugins/index.ts` beside a source entry.
 */
export function engineAt(
  name: string,
  file: string,
  pluginsFile: string | undefined = file.endsWith("/src/index.ts")
    ? join(file, "../plugins/index.ts")
    : undefined,
  entryFiles: Record<string, string> = {},
): EngineHandle {
  return {
    name,
    file,
    async load() {
      vi.resetModules();

      return (await import(/* @vite-ignore */ file)) as CoreApi;
    },
    async loadEntries() {
      const out: Record<string, Record<string, any>> = {};
      for (const [subpath, entryFile] of Object.entries(entryFiles)) {
        if (existsSync(entryFile)) {
          out[subpath] = (await import(/* @vite-ignore */ entryFile)) as Record<
            string,
            any
          >;
        }
      }

      return out;
    },
    async loadPlugins() {
      return pluginsFile && existsSync(pluginsFile)
        ? ((await import(/* @vite-ignore */ pluginsFile)) as Record<
            string,
            any
          >)
        : undefined;
    },
  };
}

function entry(name: "v1" | "local", subpath: string): string {
  const entries = name === "v1" ? v1Entries("development") : coreEntries();
  const found = entries.find((e) => e.subpath === subpath);
  if (!found) {
    throw new Error(`no ${subpath} entry for engine ${name}`);
  }

  return found.file;
}

const handle = (name: "v1" | "local") =>
  engineAt(
    name,
    entry(name, "."),
    entry(name, "./plugins"),
    Object.fromEntries(OTHER_SUBPATHS.map((s) => [s, entry(name, s)])),
  );

/**
 * core-next's file for each other subpath: where core's source has it, or
 * core-next's own `src/<name>.ts` (its worker and migration stubs sit
 * there until L13 builds them at core's path).
 */
function v2EntryFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const subpath of OTHER_SUBPATHS) {
    const derived = v2Entries().find((e) => e.subpath === subpath)?.file;
    const own = join(
      defaultRepoRoot,
      "packages/core-next/src",
      `${subpath.slice(2)}.ts`,
    );
    const file = derived && !derived.endsWith("/unbuilt.ts") ? derived : own;
    if (existsSync(file)) {
      out[subpath] = file;
    }
  }

  return out;
}

/**
 * The other subpaths' source files under a copy of `packages/core/src`
 * (`srcDir`), for an engine built from a copy (diff/self/faults.ts).
 */
export function entryFilesUnder(srcDir: string): Record<string, string> {
  const coreSrc = join(defaultRepoRoot, "packages/core/src");

  return Object.fromEntries(
    OTHER_SUBPATHS.map((subpath) => {
      const file = coreEntries().find((e) => e.subpath === subpath)?.file ?? "";

      return [subpath, join(srcDir, file.slice(coreSrc.length + 1))];
    }),
  );
}

/** Whether v2 takes part, and why not if it does not. */
export function v2Status(): { present: boolean; reason: string } {
  return existsSync(V2_ENTRY)
    ? { present: true, reason: `core-next at ${V2_ENTRY}` }
    : {
        present: false,
        reason:
          "packages/core-next does not exist yet (Phase 1); scenarios compare v1 with local only",
      };
}

/** The reference first, then the engines under test (local, and v2 if present). */
export function engines(): EngineHandle[] {
  const out = [handle("v1"), handle("local")];
  if (v2Status().present) {
    out.push(engineAt("v2", V2_ENTRY, undefined, v2EntryFiles()));
  }

  return out;
}
