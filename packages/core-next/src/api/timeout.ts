/**
 * Timeouts on the kernel clock, shared by async constraints and resolvers
 * (L2). The timer is owned by the system, so disposing the kernel clears
 * it, and a virtual clock makes it deterministic.
 */

import type { Clock } from "../clock.js";

const TIMEOUT: unique symbol = Symbol();

/** True for the error {@link withTimeout} rejects with. */
export const isTimeout = (error: unknown): boolean =>
  !!(error as Record<symbol, unknown> | null)?.[TIMEOUT];

/** Reject with a marked error after `ms` on the kernel clock, owned by `owner`. */
export function withTimeout<T>(
  clock: Clock,
  owner: number,
  value: T | Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(
      () => reject(Object.assign(new Error(message), { [TIMEOUT]: true })),
      ms,
      { owner, kind: "timeout" },
    );
    Promise.resolve(value).then(
      (v) => {
        clock.clearTimeout(timer);
        resolve(v);
      },
      (error) => {
        clock.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
