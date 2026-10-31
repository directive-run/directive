/**
 * `@directive-run/core/testing`, as far as L2 needs it: 1.35's
 * `flushMicrotasks` and nothing else (the rest of the subpath is L13).
 * Its own entry, so nothing here reaches a bundle that does not import it.
 */

/** Ten microtask turns: lets a pass, a run and its follow-ups settle. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
