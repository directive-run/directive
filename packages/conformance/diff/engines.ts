/**
 * Both engines in one process, a fresh instance for every run.
 *
 * The other projects alias `@directive-run/core` to one engine each. A
 * differential scenario needs the two side by side, so it loads each engine's
 * root entry by file, from the same derivations the vitest config uses
 * (`lib/core-entries.ts`): the published 1.35 development build, and the
 * workspace's core source.
 *
 * Every run gets a fresh module instance (`vi.resetModules()` before the
 * import; the diff project inlines `directive-v1` so the reset reaches it).
 * Engine module state — 1.35 dedupes some dev warnings per process, for
 * example — would otherwise make a run depend on which scenarios ran before
 * it, and two engines that keep that state in different places (per process
 * vs per system) would differ by test order rather than by behaviour.
 */

import type * as Core from "@directive-run/core";
import { vi } from "vitest";
import { coreEntries, v1Entries } from "../lib/core-entries.js";

export type CoreApi = typeof Core;

export type EngineName = "v1" | "local";

export interface EngineHandle {
  name: EngineName;
  /** The entry file the engine is loaded from. */
  file: string;
  /** A fresh instance of the engine's public API. */
  load(): Promise<CoreApi>;
}

function rootEntry(name: EngineName): string {
  const entries = name === "v1" ? v1Entries("development") : coreEntries();
  const root = entries.find((e) => e.subpath === ".");
  if (!root) {
    throw new Error(`no root entry for engine ${name}`);
  }

  return root.file;
}

function handle(name: EngineName): EngineHandle {
  const file = rootEntry(name);

  return {
    name,
    file,
    async load() {
      vi.resetModules();

      return (await import(/* @vite-ignore */ file)) as CoreApi;
    },
  };
}

/** The reference engine first, then the engine under test. */
export function engines(): [EngineHandle, EngineHandle] {
  return [handle("v1"), handle("local")];
}
