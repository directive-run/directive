/**
 * Getting a preset from wherever the caller has one.
 *
 * Three sources — a built-in name, a JSON string, a path on disk — and one
 * validator behind all of them. Every route ends at {@link validatePreset}, so
 * "this preset is valid" means the same thing whether it was typed, fetched, or
 * read off disk.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { BUILTIN_PRESETS } from "../presets/index.js";
import { type PresetConfig, presetSchema } from "./preset-types.js";

// ============================================================================
// Validation
// ============================================================================

/** The outcome of checking an unknown value against the preset schema. */
export type PresetValidation =
  | { valid: true; preset: PresetConfig }
  | { valid: false; errors: string[] };

/**
 * Check an unknown value against the preset schema.
 *
 * Returns rather than throws, because the surfaces that call it directly — a
 * config editor, an HTTP endpoint validating a request body — want every
 * problem at once, not the first one. {@link assertPreset} is the throwing form
 * for callers that only proceed on success.
 */
export function validatePreset(value: unknown): PresetValidation {
  const result = presetSchema.safeParse(value);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => {
        const path = issue.path.join(".");

        return path === "" ? issue.message : `${path}: ${issue.message}`;
      }),
    };
  }

  return { valid: true, preset: result.data };
}

/**
 * Check a value and return it, or throw naming every problem.
 *
 * The throwing form exists so the error message is written once. A caller that
 * validated itself and threw its own message would report the same bad preset
 * differently depending on which door it came through.
 *
 * @param source - Where the value came from, for the error message.
 */
export function assertPreset(value: unknown, source: string): PresetConfig {
  const result = validatePreset(value);

  if (!result.valid) {
    throw new Error(
      `[ai-harness] Invalid preset from ${source}:\n  - ${result.errors.join("\n  - ")}`,
    );
  }

  return result.preset;
}

// ============================================================================
// Loading
// ============================================================================

/** The IDs of every preset that ships with the package. */
export function listPresets(): string[] {
  return Object.keys(BUILTIN_PRESETS).sort();
}

/** Whether a string looks like a JSON object rather than a name or a path. */
function looksLikeJson(source: string): boolean {
  return source.trimStart().startsWith("{");
}

/**
 * Resolve a preset from a built-in name, a JSON string, or a path.
 *
 * Resolution order is name, then JSON, then path — cheapest and least ambiguous
 * first. A built-in name never contains `{` or a path separator, so the three
 * cases cannot be confused for one another.
 *
 * @example
 * ```typescript
 * await loadPreset("code-review");              // built-in
 * await loadPreset('{"id":"ad-hoc", …}');       // literal
 * await loadPreset("./presets/mine.json");      // file
 * ```
 */
export async function loadPreset(
  nameOrPathOrJson: string,
): Promise<PresetConfig> {
  const builtin = Object.hasOwn(BUILTIN_PRESETS, nameOrPathOrJson)
    ? BUILTIN_PRESETS[nameOrPathOrJson]
    : undefined;

  if (builtin !== undefined) {
    return assertPreset(builtin, `built-in preset "${nameOrPathOrJson}"`);
  }

  if (looksLikeJson(nameOrPathOrJson)) {
    return assertPreset(
      parseJson(nameOrPathOrJson, "JSON string"),
      "JSON string",
    );
  }

  let contents: string;
  try {
    contents = await readFile(nameOrPathOrJson, "utf8");
  } catch (error) {
    const known = listPresets().join(", ");

    throw new Error(
      `[ai-harness] loadPreset: "${nameOrPathOrJson}" is not a built-in preset, not JSON, and could not be read as a file (${(error as Error).message}). Built-in presets: ${known}.`,
    );
  }

  return assertPreset(
    parseJson(contents, nameOrPathOrJson),
    `file ${nameOrPathOrJson}`,
  );
}

/** Parse JSON, saying where it came from when it will not parse. */
function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `[ai-harness] loadPreset: ${source} is not valid JSON — ${(error as Error).message}`,
    );
  }
}
