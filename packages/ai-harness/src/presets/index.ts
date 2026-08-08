/**
 * The presets that ship with the package.
 *
 * Eight of them, and one more that deliberately does not ship here:
 * `presets/custom/dream.json` sits on disk as a file, loaded with
 * `--preset ./presets/custom/dream.json`. Keeping one preset outside the
 * registry means the user-defined path is exercised by the package's own tests
 * from the first release rather than discovered to be broken by the first
 * person who tries it.
 *
 * `debate` is not among the IDs here and will not be: `@directive-run/ai`
 * already ships a debate pattern, and two things under one name in adjacent
 * packages is a support burden nobody is paid enough to carry.
 *
 * Ordering below is the order {@link BUILTIN_PRESETS} lists them in, which is
 * the order the CLI prints. It runs from the bounded, checkable presets to the
 * exploratory one — `code-review` and `pre-mortem` are what this package is
 * for, and `moonshot` is last for the reasons written into its own module.
 *
 * @module
 */

import type { PresetConfig } from "../core/preset-types.js";
import { archaeologyPreset } from "./archaeology.js";
import { brainstormPreset } from "./brainstorm.js";
import { codeReviewPreset } from "./code-review.js";
import { crypto101Preset } from "./crypto-101.js";
import { decipherPreset } from "./decipher.js";
import { moonshotPreset } from "./moonshot.js";
import { preMortemPreset } from "./pre-mortem.js";
import { researchPreset } from "./research.js";

export { archaeologyPreset } from "./archaeology.js";
export { brainstormPreset } from "./brainstorm.js";
export { codeReviewPreset } from "./code-review.js";
export { crypto101Preset } from "./crypto-101.js";
export { decipherPreset } from "./decipher.js";
export { moonshotPreset } from "./moonshot.js";
export { preMortemPreset } from "./pre-mortem.js";
export { researchPreset } from "./research.js";

/** Every preset that ships with the package, in listing order. */
export const PRESET_LIST: readonly PresetConfig[] = Object.freeze([
  codeReviewPreset,
  preMortemPreset,
  brainstormPreset,
  archaeologyPreset,
  decipherPreset,
  crypto101Preset,
  researchPreset,
  moonshotPreset,
]);

/** Built-in presets, by ID. */
export const BUILTIN_PRESETS: Readonly<Record<string, PresetConfig>> =
  Object.freeze(
    Object.fromEntries(PRESET_LIST.map((preset) => [preset.id, preset])),
  );
