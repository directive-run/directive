/**
 * One event fan-out, shared by the chain and the composition.
 *
 * Both of them hand out an `emit` and both of them are driven from inside a
 * reconcile pass, so a listener that throws is a listener that throws in the
 * middle of a resolver or an effect. The two used to answer that differently:
 * the chain caught the throw and reported it, the composition let it out. The
 * composition is the one where letting it out is unrecoverable — its step
 * counter is opened before the announcement and closed in a `finally` further
 * down, so a throw between them left `stepInFlight` true forever, the
 * composition never settled, and the watchdog that exists to catch a run that
 * will not finish could not fire, because its own quiet test reads the counter
 * the throw stranded.
 *
 * So there is one fan-out and one answer. A surface that throws while rendering
 * is not the run's problem and must not become the run's failure — but it is
 * also not something to swallow, and this package has no console of its own,
 * deliberately: the event stream is the whole point of the event stream, and a
 * surface that swapped stdout for a socket would never see a `console.error`.
 * The report is therefore itself an event, delivered to the listeners that did
 * not throw — and to the one that did, which is why the recursion is guarded.
 * One level deep is a report; two is a loop, so the second level is dropped.
 *
 * @module
 */

import type { HarnessEvent, HarnessEventSink } from "./events.js";

export interface EventFanOut {
  /**
   * The listener set, live.
   *
   * Exposed because both callers subscribe to their own completion event
   * through it and unsubscribe when it arrives — the same door a surface comes
   * through, so the promise a caller holds cannot resolve on a different notion
   * of "done" than the one the caller is watching.
   */
  listeners: Set<HarnessEventSink>;
  /** Deliver one event to every listener, surviving any of them. */
  emit: HarnessEventSink;
}

/**
 * Build a fan-out.
 *
 * @param now - The clock the listener-failure report is stamped with. The same
 *   injectable clock the rest of the package takes, so a test that fixes time
 *   fixes this too.
 * @param initial - A listener to start with, typically the caller's `onEvent`.
 */
export function createEventFanOut(
  now: () => number,
  initial?: HarnessEventSink,
): EventFanOut {
  const listeners = new Set<HarnessEventSink>();
  if (initial) {
    listeners.add(initial);
  }

  let reportingListenerFailure = false;

  const emit: HarnessEventSink = (event: HarnessEvent) => {
    const failures: string[] = [];

    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (failures.length === 0 || reportingListenerFailure) {
      return;
    }

    reportingListenerFailure = true;
    try {
      for (const message of failures) {
        emit({ type: "error", scope: "listener", message, at: now() });
      }
    } finally {
      reportingListenerFailure = false;
    }
  };

  return { listeners, emit };
}
