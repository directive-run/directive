/** The fewest fuzz cases a differential run must COMPARE (runaways are discarded, not compared). */
export const FUZZ_FLOOR = 200;

/** PR CI generates this many cases: the margin lets a few runaways through without dropping below the floor. */
export const FUZZ_DEFAULT_RUNS = FUZZ_FLOOR + 5;

/**
 * Most runaway cases (reference passed the timer budget) a run tolerates:
 * 1% of the cases generated, never fewer than 2. A generator that starts
 * producing mostly runaways would otherwise quietly compare nothing.
 */
export function maxRunaways(cases: number): number {
  return Math.max(Math.floor(cases / 100), 2);
}
