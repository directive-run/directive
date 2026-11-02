/**
 * What 2.0 has not built yet says so (slice P3-F3). Three cases:
 * - An option for an unbuilt feature (`history`, `trace`) warns once per
 *   system in development, and the system runs as 1.35 does with that option
 *   off (system.ts). Production is silent.
 * - A member 1.35 always provides that 2.0 has not built throws
 *   `featureMissing` when called, in development (`withMissing`). Production
 *   leaves it out: the member names alone cost about 150 B gzip in the
 *   minimal app, past its 28,800 B ceiling, so there a call is the
 *   platform's TypeError, as before. Where 1.35 itself gives null or a no-op
 *   with the feature off (`history`, `onHistoryChange`), every build keeps
 *   that value.
 * - A `/plugins` or `/testing` export 2.0 has not built is a stub with 1.35's
 *   name and signature that throws `featureMissing` when called.
 *
 * The error's `code` is stable: assert it, not the wording. The full text is
 * development only; production carries the code and the member's name.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";

/** The `code` of every error `featureMissing` throws. */
export const FEATURE_MISSING = "E_FEATURE_MISSING";

/**
 * Throws the error for `name` (a member or an export), which arrives in
 * `layer`: an Error named FeatureMissingError with `code`, `feature` and
 * `layer`.
 */
export const featureMissing = (name: string, layer: number): never => {
  throw Object.assign(
    new Error(
      isDevelopment
        ? `[Directive] ${name} is not in 2.0.0-alpha yet: it arrives in layer ${layer} of the 2.0 engine.`
        : `[Directive] ${FEATURE_MISSING} ${name}`,
    ),
    { code: FEATURE_MISSING, feature: name, layer },
  );
};

/**
 * In development, puts 1.35's always-present members that 2.0 has not built
 * on the system, each throwing `featureMissing` when called; a member a built
 * part already defined is left alone. Runs after every other part except the
 * plugins, so a plugin's onInit sees the whole surface.
 */
export const withMissing: SystemPart = ({ system }) => {
  const s = system as Record<string, any>;
  // 1.35 without the history option (engine.ts:2605, 4343-4348): history is
  // null and onHistoryChange adds a listener that nothing ever calls.
  s.history = null;
  s.onHistoryChange = () => () => {};
  // A dead-code `if`, not an early return: esbuild drops the block before
  // it counts uses, so production keeps neither featureMissing nor the names.
  if (isDevelopment) {
    const stub = (
      target: Record<string, unknown>,
      prefix: string,
      names: string,
      layer: number,
    ) => {
      for (const name of names.split(" ")) {
        target[name] ??= () => featureMissing(prefix + name, layer);
      }
    };
    for (const key of ["constraints", "resolvers", "effects"]) {
      stub(
        (s[key] ??= {}),
        `${key}.`,
        "register assign unregister call isDynamic listDynamic",
        10,
      );
    }
    stub(
      s.meta,
      "meta.",
      "byTag carriesTag constraint derivation effect event fact module resolver subscribe",
      9,
    );
    stub(s, "", "registerModule unregisterModule", 10);
    stub(s, "", "getDistributableSnapshot watchDistributableSnapshot", 12);
  }
};
