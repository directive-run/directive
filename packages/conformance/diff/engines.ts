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
}

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
): EngineHandle {
  return {
    name,
    file,
    async load() {
      vi.resetModules();

      return (await import(/* @vite-ignore */ file)) as CoreApi;
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
  engineAt(name, entry(name, "."), entry(name, "./plugins"));

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
    out.push(engineAt("v2", V2_ENTRY));
  }

  return out;
}
