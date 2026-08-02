/**
 * The presets that ship with the package.
 *
 * One, on purpose. A preset library is a separate concern with separate
 * versioning — this exists so `loadPreset("code-review")` resolves to something
 * and so there is a worked example of the shape.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";
import { codeReviewPreset } from "./code-review.js";

export { codeReviewPreset } from "./code-review.js";

/** Built-in presets, by ID. */
export const BUILTIN_PRESETS: Readonly<Record<string, PresetConfig>> =
  Object.freeze({
    [codeReviewPreset.id]: codeReviewPreset,
  });
