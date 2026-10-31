/**
 * Timeouts on the kernel clock, shared by async constraints and resolvers
 * (L2). 1.35's withTimeout, await for await: a race with a timer, cleared
 * once the race settles. As in 1.35 the timer is not cleared by stop or
 * destroy (a run canceled meanwhile ignores it when it fires); a virtual
 * clock makes it deterministic.
 */

import type { Clock } from "../clock.js";

const TIMEOUT: unique symbol = Symbol();

/** True for the error {@link withTimeout} rejects with. */
export const isTimeout = (error: unknown): boolean =>
  !!(error as Record<symbol, unknown> | null)?.[TIMEOUT];

/** Reject with a marked error after `ms` on the kernel clock. */
export async function withTimeout<T>(
  clock: Clock,
  value: T | Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer = 0;
  const timedOut = new Promise<never>((_, reject) => {
    timer = clock.setTimeout(
      () => reject(Object.assign(new Error(message), { [TIMEOUT]: true })),
      ms,
      { kind: "timeout" },
    );
  });
  try {
    return await Promise.race([value, timedOut]);
  } finally {
    clock.clearTimeout(timer);
  }
}
