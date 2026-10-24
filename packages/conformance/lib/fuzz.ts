/** The fewest fuzz cases a differential run must COMPARE (runaways are discarded, not compared). */
export const FUZZ_FLOOR = 200;

/** PR CI generates this many cases: the margin lets a few runaways through without dropping below the floor. */
export const FUZZ_DEFAULT_RUNS = FUZZ_FLOOR + 5;

/**
 * The cases a run adds for v2, as a percent of its `DIFF_FUZZ_RUNS`: they are
 * generated at or below the layer core-next has built (`current` in
 * layers.rules.json; diff/fuzz/model.ts `ceiling`). A system that uses every
 * layer is placed above `current`, so v2 would sit out of it: without this
 * share, v2 takes part in almost none of the cases. The `runs` cases across
 * every layer all still run; the share is added to them. The count is exact,
 * not a probability, and the cases are still seeded.
 */
export const FUZZ_V2_PERCENT = 40;

/** How many cases a run of `runs` adds, generated at or below `current` (rounded up). */
export function v2Cases(runs: number): number {
  return Math.ceil((runs * FUZZ_V2_PERCENT) / 100);
}

/**
 * The fewest fuzz cases a run must compare on v2 as well, whenever v2 runs
 * anything at all (`current` is not null). At the PR default (205 cases) the
 * share adds 82; the margin lets a few discarded cases through.
 */
export const FUZZ_V2_FLOOR = 60;

/**
 * Most runaway cases (reference passed the timer budget) a run tolerates:
 * 1% of the cases generated, never fewer than 2. A generator that starts
 * producing mostly runaways would otherwise quietly compare nothing.
 */
export function maxRunaways(cases: number): number {
  return Math.max(Math.floor(cases / 100), 2);
}
