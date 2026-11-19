/**
 * What 2.0 has not built yet says so (slice P3-F3): a `/plugins` or
 * `/testing` export 2.0 has not built is a stub with 1.35's name and
 * signature that throws `featureMissing` when called. (The members 1.35
 * always provides are all built: L12a built the last two, the distributable
 * snapshot calls, and with them went the development-only `withMissing`.)
 *
 * The error's `code` is stable: assert it, not the wording. The full text is
 * development only; production carries the code and the member's name.
 */

import isDevelopment from "#is-development";

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
