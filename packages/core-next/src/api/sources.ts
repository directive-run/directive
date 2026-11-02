/**
 * L5a: a module's `sources`, the lifecycle half of 1.35's sources manager
 * (core/sources.ts, engine.ts:3361–3418, 3473, 3533, 3559–3611): attach at
 * start, publish and its drop reasons, module-scoped publish, attach and
 * teardown errors, async teardown with timeouts, `onEvict` and
 * `system.evict()` (RFC L5 rows A1–A6, P1–P5, V1–V4).
 *
 * Not here: gates, linger, retry and coalesce (L5b, through `gate_`); the
 * counters and `inspect().sources` (L9); runtime registration (L10).
 *
 * In the alpha a 1.35 config declares sources with no import, so
 * `createSystem` carries this part (A1, owner-approved 2026-11-01); the
 * system core and the `floor` fixture do not. The core calls it at four
 * seams: `start_` after the modules' onStart hooks, `gate_` after the
 * effects phase, `stop_` before the effect cleanups, and `stopAsync_` where
 * 1.35's stopAsync awaits its cleanupAllAsync.
 *
 * Durations run on the kernel clock. The evict deadline is an epoch time and
 * is compared with Date.now(), never with the clock's now() (RFC L5, C list).
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { BLOCKED_PROPS } from "./facts.js";

type Fn = (...args: any[]) => any;
type Phase = "attach" | "cleanup" | "runtime";

/** A source definition, as far as L5a reads it. */
interface Def {
  attach: Fn;
  key?: unknown;
  active?: unknown;
  onEvict?: Fn;
  evictTimeoutMs?: number;
}

/** One attach: a fresh record per start, as 1.35's AttachedSource. */
interface Attached {
  id_: string;
  module_: string;
  def_: Def;
  off_: Fn;
  detached_: boolean;
}

/** 1.35's per-source counters, reset at every start. */
interface Counters {
  publishCount: number;
  lastPublishAt: number | null;
  dropCount: number;
  lastDropReason: string | null;
  lastDropAt: number | null;
  errorCount: number;
  lastError: { phase: string; message: string; at: number } | null;
  attachedAt: number | null;
  detachedAt: number | null;
}

/** The sources part as the core's lifecycle drives it. */
export interface SourcesFeature {
  /** inspect().sources: one row per declared source (1.35's shape). */
  rows_(): Record<string, unknown>[];
  /** inspect().attachedSourceCount. */
  count_(): number;
  start_(): void;
  /** After the effects phase of every pass: the gates (L5b). */
  gate_(): void;
  stop_(): void;
  stopAsync_(): Promise<void>;
}

declare module "../kernel.js" {
  interface KernelFeatures {
    /** Added by `withSources` (sources.ts). */
    sources: SourcesFeature;
  }
}

/** 1.35's localSourceId: the id without its module's `ns::` prefix. */
export const localId = (id: string, moduleId: string): string =>
  id.startsWith(`${moduleId}::`) ? id.slice(moduleId.length + 2) : id;

const empty = (): Counters => ({
  publishCount: 0,
  lastPublishAt: null,
  dropCount: 0,
  lastDropReason: null,
  lastDropAt: null,
  errorCount: 0,
  lastError: null,
  attachedAt: null,
  detachedAt: null,
});

const toError = (raw: unknown): Error =>
  raw instanceof Error ? raw : new Error(String(raw));

/** 1.35's resolveSourceTimeout: `evictTimeoutMs`, else 5 s. */
const timeoutOf = (ms: number | undefined): number =>
  ms === undefined
    ? 5000
    : ms === Number.POSITIVE_INFINITY
      ? ms
      : !Number.isFinite(ms) || ms <= 0
        ? 5000
        : Math.floor(ms);

/** The prefix of every attach and teardown message (1.35's text). */
const who = (rec: Attached) =>
  `[Directive] Module "${rec.module_}" → Source "${rec.id_}"`;

export const withSources: SystemPart = (context) => {
  const { kernel, module, system, fire_, untick_, down_ } = context;
  const { clock, hooks } = kernel;
  // The namespaced form hands the core `ns::id` sources (namespaced.ts); the
  // owner is the namespace, as 1.35's prefixSources makes it.
  const namespaced = !!(module as { load_?: unknown }).load_;
  const defs = Object.entries((module.sources ?? {}) as Record<string, Def>);
  const ownerOf = (id: string) =>
    namespaced ? id.slice(0, id.indexOf("::")) : module.id;
  let attached: Attached[] = [];
  /** Ids attached now: inspect's `attached` (1.35's attachedDefinitionIds). */
  let live = new Set<string>();
  const counters = new Map<string, Counters>();
  /** The counters of `id`, made when missing (1.35's `?? emptyCounters()`). */
  const of = (id: string) => {
    let c = counters.get(id);
    if (!c) {
      counters.set(id, (c = empty()));
    }

    return c;
  };
  let phase: "idle" | "attached" | "stopped" = "idle";
  let evicting = false;
  /** Sources already warned about a cross-module publish, per system. */
  const warned = new Set<string>();

  // After destroy the kernel's stream is gone; as in 1.35, plugins still
  // hear a source (the core's tail does the same for its own records).
  type Tail = { deliver_(e: unknown): void; wants_(at: string): boolean };
  const tail = () => kernel.features.plugins as Tail | undefined;
  /** A source record for plugins, built only when one listens (P1). */
  const hear = (at: string, rec: Attached, more?: Record<string, unknown>) => {
    if (kernel.disposed ? tail()?.wants_(at) : hooks.wants(at)) {
      const data = { id: rec.id_, moduleId: rec.module_, ...more };
      if (kernel.disposed) {
        tail()!.deliver_({
          ...data,
          t: clock.now(),
          seq: 0,
          sys: kernel.id,
          at,
        });
      } else {
        hooks.emit(at, data);
      }
    }
  };
  /** 1.35's reportError: plugins get a message cut at 256 characters. */
  const report = (rec: Attached, phase: Phase, error: Error) => {
    const m = error.message;
    const message =
      m.length <= 256
        ? m
        : `${m.slice(0, 256)}…[${m.length - 256} chars truncated]`;
    const c = of(rec.id_);
    c.errorCount += 1;
    c.lastError = { phase, message, at: Date.now() };
    hear("source.error", rec, {
      phase,
      error:
        m.length <= 256
          ? error
          : Object.assign(new Error(message), {
              name: error.name,
              stack: error.stack,
            }),
    });
  };

  /** The engine's guard and dispatch: a drop reason, or none when handled. */
  const deliver = (rec: Attached, name: string, payload: unknown) => {
    let target = name;
    let reason: string | undefined = context.gone_
      ? "post-destroy"
      : !system.isRunning
        ? "post-stop"
        : typeof name !== "string" || name.length === 0
          ? "invalid-event-name"
          : BLOCKED_PROPS.has(name)
            ? "blocked-event-name"
            : undefined;
    const at = rec.id_.indexOf("::");
    if (!reason && at !== -1) {
      // A namespaced source publishes only its own module's events: a bare
      // name is scoped, and a name with the separator is dropped as given.
      const ns = rec.id_.slice(0, at);
      if (name.includes("::")) {
        if (isDevelopment && !warned.has(rec.id_)) {
          warned.add(rec.id_);
          const own = `${ns}::`;
          console.warn(
            `[Directive] Source "${rec.id_}" published "${name}". A source publishes only its own module's events, so this is dropped (reason "cross-module-event"). ${
              name.startsWith(own)
                ? `Drop the "${own}" prefix: publish("${name.slice(own.length)}").`
                : `Publish an event module "${ns}" declares; to reach another module, have that event's handler or a resolver dispatch an event the other module owns.`
            }`,
          );
        }
        reason = "cross-module-event";
      } else {
        target = `${ns}::${name}`;
      }
    }
    if (
      !reason &&
      !fire_(target, { type: target, ...(payload as Record<string, unknown>) })
    ) {
      reason = "unknown-event";
    }
    // As 1.35: a record from an earlier start has no counters after a
    // restart, and is not heard.
    const c = counters.get(rec.id_);
    if (!c) {
      return;
    }
    const now = Date.now();
    if (reason) {
      c.dropCount += 1;
      c.lastDropReason = reason;
      c.lastDropAt = now;
    } else {
      c.publishCount += 1;
      c.lastPublishAt = now;
    }
    hear(
      reason ? "source.drop" : "source.publish",
      rec,
      reason ? { eventName: target, reason } : { eventName: target },
    );
  };

  /** 1.35's attachOne for an ungated source. */
  const attach = (id: string, def: Def) => {
    const rec: Attached = {
      id_: id,
      module_: ownerOf(id),
      def_: def,
      off_: () => undefined,
      detached_: false,
    };
    // Counters first, so a publish inside attach is counted.
    of(id);
    try {
      // The record exists before attach runs, so a publish made inside it
      // is dispatched; a failed attach never detaches, so its handle stays
      // live (A2, A3).
      const off = def.attach(
        (name: string, payload?: unknown) => {
          if (!rec.detached_) {
            deliver(rec, name, payload);
          }
        },
        (error: unknown) => {
          if (!rec.detached_) {
            report(rec, "runtime", toError(error));
          }
        },
      );
      if (typeof off !== "function") {
        const err = new Error(
          off !== null &&
            typeof off === "object" &&
            typeof (off as { then?: unknown }).then === "function"
            ? `${who(rec)} attach() returned a Promise. attach() must be synchronous; rewrite as \`attach: (publish) => { ... return () => unsubscribe(); }\`. Do any async work inside the subscription's own internals — the cleanup function must be registered immediately so \`system.stop()\` can tear the source down.`
            : `${who(rec)} did not return an unsubscribe function from attach(). Every source must return a cleanup function (e.g. \`return () => undefined\`) so the system can tear it down at stop(). If the source needs no teardown, return \`() => undefined\`, not \`undefined\`.`,
        );
        console.error(err);
        report(rec, "attach", err);

        return;
      }
      rec.off_ = off;
      attached.push(rec);
      live.add(id);
      const c = of(id);
      c.attachedAt = Date.now();
      c.detachedAt = null;
      hear("source.attach", rec);
    } catch (raw) {
      const error = toError(raw);
      console.error(`${who(rec)} attach() threw:`, error);
      report(rec, "attach", error);
    }
  };

  /** A teardown step that threw (1.35's cleanupAll and cleanupAllAsync). */
  const failed = (rec: Attached, raw: unknown) => {
    const error = toError(raw);
    console.error(`${who(rec)} unsubscribe threw:`, error);
    report(rec, "cleanup", error);
  };
  /** Flags the record, then plugins hear the detach before the unsubscribe. */
  const detach = (rec: Attached) => {
    rec.detached_ = true;
    hear("source.detach", rec);
    of(rec.id_).detachedAt = Date.now();
  };

  /**
   * 1.35's raceWithTimeout, on the kernel clock. The timer is not owned by
   * the system: like 1.35's setTimeout it still fires after a destroy, so a
   * hang never holds the teardown.
   */
  const race = async (
    work: Promise<unknown>,
    ms: number,
    onTimeout: () => void,
  ) => {
    if (ms === Number.POSITIVE_INFINITY) {
      return await work;
    }
    let fired = false;
    let timer = 0;
    const timeout = new Promise<undefined>((resolve) => {
      timer = clock.setTimeout(() => {
        fired = true;
        onTimeout();
        resolve(undefined);
      }, ms);
    });
    const safe = work.catch((error) => {
      if (fired) {
        return undefined;
      }
      throw error;
    });
    try {
      return await Promise.race([safe, timeout]);
    } finally {
      clock.clearTimeout(timer);
    }
  };
  /** A timed step's error: the timeout's message, then the report. */
  const late = (rec: Attached, phase: Phase, what: string) => () => {
    const err = new Error(`${who(rec)} ${what}`);
    console.error(err.message);
    report(rec, phase, err);
  };

  /** 1.35's evictAll: each attached source's onEvict, in attach order. */
  const evictAll = async () => {
    if (phase !== "attached") {
      return;
    }
    for (const rec of attached) {
      if (rec.detached_) {
        continue;
      }
      const def = rec.def_;
      if (!def?.onEvict) {
        continue;
      }
      const ms = timeoutOf(def.evictTimeoutMs);
      try {
        await race(
          Promise.resolve(def.onEvict()),
          ms,
          late(
            rec,
            "runtime",
            `onEvict exceeded ${ms}ms timeout; abandoning so downstream sources still get evicted.`,
          ),
        );
      } catch (raw) {
        const error = toError(raw);
        console.error(`${who(rec)} onEvict threw:`, error);
        report(rec, "runtime", error);
      }
    }
  };

  kernel.define("sources", {
    rows_: () =>
      defs.map(([id, def]) => {
        const moduleId = ownerOf(id);
        const c = counters.get(id) ?? empty();

        return {
          id,
          moduleId,
          localId: localId(id, moduleId),
          meta: (def as { meta?: unknown }).meta,
          attached: live.has(id),
          attachedAt: c.attachedAt,
          detachedAt: c.detachedAt,
          publishCount: c.publishCount,
          lastPublishAt: c.lastPublishAt,
          dropCount: c.dropCount,
          lastDropReason: c.lastDropReason,
          lastDropAt: c.lastDropAt,
          errorCount: c.errorCount,
          lastError: c.lastError,
        };
      }),
    count_: () => attached.filter((rec) => !rec.detached_).length,
    start_() {
      // 1.35's attachAll: a fresh list and fresh counters each start; gated
      // sources are left to the gate evaluation (L5b), so the attach order
      // is ungated first.
      attached = [];
      live = new Set();
      counters.clear();
      phase = "attached";
      for (const [id, def] of defs) {
        if (typeof def.key !== "function" && typeof def.active !== "function") {
          attach(id, def);
        }
      }
    },
    gate_() {
      // L5b: the key and active gates.
    },
    // Reverse attach order. A promise from unsubscribe is not awaited here.
    stop_() {
      if (phase !== "attached") {
        return;
      }
      phase = "stopped";
      for (let i = attached.length - 1; i >= 0; i--) {
        const rec = attached[i];
        if (!rec || rec.detached_) {
          continue;
        }
        detach(rec);
        try {
          rec.off_();
        } catch (raw) {
          failed(rec, raw);
        }
      }
      attached = [];
      live = new Set();
    },
    // Reverse attach order; each unsubscribe awaited, capped by its timeout.
    async stopAsync_() {
      if (phase !== "attached") {
        return;
      }
      phase = "stopped";
      for (let i = attached.length - 1; i >= 0; i--) {
        const rec = attached[i];
        if (!rec || rec.detached_) {
          continue;
        }
        detach(rec);
        const ms = timeoutOf(rec.def_?.evictTimeoutMs);
        try {
          await race(
            Promise.resolve(rec.off_()),
            ms,
            late(
              rec,
              "cleanup",
              `unsubscribe exceeded ${ms}ms timeout; abandoning to unblock teardown.`,
            ),
          );
        } catch (raw) {
          failed(rec, raw);
        }
      }
      attached = [];
      live = new Set();
    },
  });

  // 1.35's engine.start: refused, with a warning, while an eviction runs.
  const start = system.start as () => void;
  system.start = () => {
    if (evicting) {
      if (isDevelopment && !system.isRunning) {
        console.warn(
          "[Directive] system.start() called during evict() — ignored. Re-create the system after destroyAsync() resolves.",
        );
      }

      return;
    }
    start();
  };

  /**
   * 1.35's evict (RFC 0009, B1 at L5): every attached source's onEvict, then
   * the engine's destroyAsync. `deadline` is epoch milliseconds: one already
   * past starts the work and returns at once; otherwise the work races the
   * time left, which alone goes to a kernel-clock timer.
   */
  system.evict = async (deadline?: number): Promise<void> => {
    // The system wrapper ends the tick first, even when evict is refused.
    untick_();
    if (evicting || context.gone_) {
      return;
    }
    evicting = true;
    const build = () =>
      (async () => {
        await evictAll();
        await down_();
      })().finally(() => {
        evicting = false;
      });
    if (deadline !== undefined && deadline - Date.now() <= 0) {
      build().catch(() => {});

      return;
    }
    const work = build();
    if (deadline === undefined) {
      await work;

      return;
    }
    const remaining = deadline - Date.now();
    work.catch(() => {});
    await Promise.race([
      work,
      new Promise<void>((resolve) => clock.setTimeout(resolve, remaining)),
    ]);
  };
};
