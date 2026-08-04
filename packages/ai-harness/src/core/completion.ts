/**
 * Waiting for a run to finish, without waiting forever for one that will not.
 *
 * Both public entry points — {@link Harness.run} and `runComposition` — resolve
 * off the event stream rather than off a private completion signal, which is
 * deliberate: one channel means the promise cannot resolve on a different
 * notion of "done" than the caller is watching. The cost is that the promise is
 * only as reliable as the event, and the event is emitted from an effect at the
 * end of a cascade. Anything that stops the cascade — a resolver that threw
 * before it could write the fact that ends the run, a store that rejected on
 * the way to the announcement — leaves a system with nothing left to do and a
 * caller with nothing to wait for.
 *
 * That state is not ambiguous and it does not need a timeout to detect. A
 * Directive system knows when it has gone quiet: no resolver in flight, no
 * reconcile running or scheduled, no batch pending. If it is quiet and the
 * completion event has not been emitted, it is not going to be — every event
 * this package emits is emitted from inside a reconcile pass, and there are no
 * more of those coming. So the wait ends, loudly, with what the system was
 * doing rather than with a test runner's timeout.
 *
 * ## Why the engine's answer is not the whole answer
 *
 * "No resolver in flight" is the engine's count of resolvers it is still
 * *tracking*, and it stops tracking one the moment the constraint that produced
 * the requirement stops holding. That is the composition's ordinary shape: the
 * step constraint is gated on nothing being in flight, so it goes false as soon
 * as the step is dispatched, the requirement leaves the set, and the engine
 * lets go of a resolver that is going to run for another two minutes. A settled
 * system is therefore necessary and not sufficient, and the module — which
 * keeps its own counters for exactly this reason — is asked as well.
 *
 * @module
 */

/**
 * What {@link awaitCompletion} needs from a Directive system.
 *
 * Structural and small, for the same reason `ChainHost` is: every `System`
 * satisfies it, and naming the two members says plainly that the watchdog is
 * two reads and nothing more.
 */
export interface SettleableSystem {
  readonly isSettled: boolean;
  settle(maxWait?: number): Promise<void>;
}

/**
 * How long each settle window is.
 *
 * Not a deadline on the run. A window that expires means the system was still
 * working, which for a chain making provider calls is the ordinary case and
 * says nothing about whether it will finish — so the expiry is caught and the
 * next window opens. This is only how often the question is asked.
 */
const SETTLE_WINDOW_MS = 5_000;

/**
 * How long a system has to produce its completion event after going quiet.
 *
 * Also the poll interval for the case the engine reports itself settled while
 * the module says work is still out there — see the module note. Long enough
 * that a run spends nothing measurable on it, short enough that a run which is
 * never going to finish says so rather than reaching a test runner's timeout.
 */
const QUIET_CONFIRM_MS = 250;

/**
 * Wait for `finished`, or for the run to prove it is never going to finish.
 *
 * @param finished - Resolves when the run's completion event arrives.
 * @param system - The system running it.
 * @param isQuiet - Whether nothing is left to do, in the module's own terms as
 *   well as the engine's. See the module note on why the engine alone is not
 *   enough.
 * @param describe - The failure message, built lazily so a healthy run never
 *   pays for it. Called once, at the point the run is known to be stuck.
 */
export async function awaitCompletion(
  finished: Promise<void>,
  system: SettleableSystem,
  isQuiet: () => boolean,
  describe: () => string,
): Promise<void> {
  let done = false;
  const completed = finished.then(
    () => {
      done = true;
    },
    (error: unknown) => {
      // A run that ended by being torn down has ended. The watchdog has
      // nothing left to say about it, and saying it would replace the real
      // reason with a symptom.
      done = true;

      throw error;
    },
  );

  const watch = async (): Promise<void> => {
    while (!done) {
      try {
        await system.settle(SETTLE_WINDOW_MS);
      } catch {
        // The window expired with the system still busy. That is the healthy
        // case for anything that talks to a provider; open another one.
        continue;
      }

      // Quiet, as far as the engine is concerned. The completion event is
      // emitted from an effect and the promise it resolves does so a tick
      // later, so the tail of the pass that just ended gets a moment to land
      // before the run is called stuck.
      await new Promise((resolve) => {
        setTimeout(resolve, QUIET_CONFIRM_MS);
      });

      if (done) {
        return;
      }
      if (isQuiet()) {
        throw new Error(describe());
      }
    }
  };

  await Promise.race([completed, watch()]);
}
