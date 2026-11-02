/**
 * A module's `sources`, 1.35's sources manager (core/sources.ts,
 * engine.ts:1932–1951, 3361–3426, 3473, 3533, 3559–3611). L5a: attach at
 * start, publish and its drop reasons, module-scoped publish, attach and
 * teardown errors, async teardown with timeouts, `onEvict` and
 * `system.evict()` (RFC L5 rows A1–A6, P1–P5, V1–V4). L5b: the key and
 * active gates, `gateLingerMs`, the retry after a failed gated attach and
 * `coalesce` (G1–G6, L1–L3, T1–T3, K1–K3), with the owner-approved
 * candidates (aa), (ab) and (ac). L5c: the two leak fixes, (ad) a stop
 * inside an attach ends the attach loop and detaches that source too, and
 * (ae) stopAsync clears the gate timers before its first await.
 *
 * Not here: the history-navigation gate skip (L8); runtime registration and
 * its timer clearing (L10).
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
 * The linger and backoff timers are kernel-clock timers owned by the system,
 * one per gated source at most, cleared at start, stop and destroy.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { BLOCKED_PROPS } from "./facts.js";
import { type CheckedReadView, createCheckedReadView } from "./readonly.js";

type Fn = (...args: any[]) => any;
type Phase = "attach" | "cleanup" | "runtime";

/** A source definition, as far as the part reads it. */
interface Def {
  attach: Fn;
  key?: unknown;
  active?: unknown;
  onEvict?: Fn;
  evictTimeoutMs?: number;
  gateLingerMs?: number;
  coalesce?: string;
}

/** Whom a record or a message names. */
interface Who {
  id_: string;
  module_: string;
}

/** One attach: a fresh record per attach, as 1.35's AttachedSource. */
interface Attached extends Who {
  def_: Def;
  off_: Fn;
  detached_: boolean;
  /** Detached by its gate: a later publish is a `gate-closed` drop (P3). */
  closed_?: true;
}

/**
 * A gated source: 1.35's keyFns, lastKey, lingerTimers and attachRetries
 * entries in one record. A linger needs a committed key and a retry needs
 * none (with (aa) a failed attach commits null), so one timer slot serves
 * both: `to_` is the linger's target or the retry's key.
 */
interface Gate extends Who {
  def_: Def;
  fn_: Fn;
  /** The committed key: what is attached, never what was only intended. */
  key_?: string | null;
  timer_?: number;
  to_?: string | null;
  /** Failed attaches at `to_`; 0 when no retry is owed. */
  tries_?: number;
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

/** Development: a gate that wrote a fact or changed one in place. */
const gateError = (id: string, what: string) =>
  new Error(
    `[Directive] Source "${id}": its key/active gate ${what}. Gates are pure reads of facts; change facts from an event handler or resolver.`,
  );

/** 1.35's resolveSourceTimeout: `evictTimeoutMs`, else 5 s. */
const timeoutOf = (ms: number | undefined): number =>
  ms === Number.POSITIVE_INFINITY
    ? ms
    : ms! > 0 && Number.isFinite(ms)
      ? Math.floor(ms!)
      : 5000;

/** The prefix of every attach and teardown message (1.35's text). */
const who = (rec: Who) =>
  `[Directive] Module "${rec.module_}" → Source "${rec.id_}"`;

export const withSources: SystemPart = (context) => {
  const { kernel, module, system, facts, fire_, untick_, down_ } = context;
  const { clock, hooks } = kernel;
  // The namespaced form hands the core `ns::id` sources (namespaced.ts); the
  // owner is the namespace, as 1.35's prefixSources makes it.
  const namespaced = !!(module as { load_?: unknown }).load_;
  /** The namespaced form's facts view for a module's gates (G6). */
  const scope = (module as { gate_?: Fn }).gate_;
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
  const hear = (at: string, rec: Who, more?: Record<string, unknown>) => {
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
  const report = (rec: Who, phase: Phase | "gate", error: Error) => {
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
        message === m
          ? error
          : Object.assign(new Error(message), {
              name: error.name,
              stack: error.stack,
            }),
    });
    // A gate that throws fails closed: the source just never attaches. With
    // no plugin listening that is invisible, so development says so, once
    // per source.
    if (isDevelopment && phase === "gate" && !warned.has(`${rec.id_}|gate`)) {
      warned.add(`${rec.id_}|gate`);
      console.warn(
        `[Directive] Source "${rec.id_}": its key/active gate threw, so the source stays detached: ${message} The error is in inspect().sources and reaches plugins through onSourceError; this warning shows once per source and only in development.`,
      );
    }
  };
  /** A drop: counted when the source has counters, always heard (1.35). */
  const drop = (rec: Who, name: string, reason: string) => {
    const c = counters.get(rec.id_);
    if (c) {
      c.dropCount += 1;
      c.lastDropReason = reason;
      c.lastDropAt = Date.now();
    }
    hear("source.drop", rec, { eventName: name, reason });
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
    // As 1.35, a publish is counted and heard only while its id has
    // counters. Every start makes them afresh for each ungated source, so a
    // live handle from an earlier start (a failed attach's, which no stop
    // detaches) is counted and heard again; a gated id has none until its
    // gate opens or fails, and until then is not heard.
    const c = counters.get(rec.id_);
    if (!c) {
      return;
    }
    if (reason) {
      drop(rec, target, reason);
    } else {
      c.publishCount += 1;
      c.lastPublishAt = Date.now();
      hear("source.publish", rec, { eventName: target });
    }
  };

  /** 1.35's attachOne: true when attached. A keyed source gets `{ key }`. */
  const attach = (id: string, def: Def, key?: string): boolean => {
    const rec: Attached = {
      id_: id,
      module_: ownerOf(id),
      def_: def,
      off_: () => undefined,
      detached_: false,
    };
    // Counters first, so a publish inside attach is counted.
    of(id);
    // Through a detached record a publish is dropped: as `gate-closed` after
    // its gate closed, silently after a stop (P3).
    const inner = (name: string, payload?: unknown) => {
      if (!rec.detached_) {
        deliver(rec, name, payload);
      } else if (rec.closed_) {
        drop(rec, name, "gate-closed");
      }
    };
    let publish = inner;
    if (def.coalesce === "lastWriteWins") {
      // K1: one pending payload per event name until a microtask; a second
      // publish of the name replaces it, as a `coalesced` drop, and the
      // flush keeps first-publish order. The buffer lives in this closure,
      // so a re-key starts empty (K2).
      let pending: Map<string, unknown> | undefined;
      publish = (name, payload) => {
        if (rec.detached_) {
          inner(name);
        } else if (pending) {
          if (pending.has(name)) {
            drop(rec, name, "coalesced");
          }
          pending.set(name, payload);
        } else {
          const queued = (pending = new Map([[name, payload]]));
          queueMicrotask(() => {
            pending = undefined;
            // (ab): a payload still pending when its gate closed is a
            // `gate-closed` drop, heard after the detach; after a stop it
            // stays silent (1.35 drops them all uncounted, K3).
            for (const [n, p] of queued) {
              inner(n, p);
            }
          });
        }
      };
    }
    try {
      // The record exists before attach runs, so a publish made inside it
      // is dispatched; a failed attach never detaches, so its handle stays
      // live (A2, A3).
      const fail = (error: unknown) => {
        if (!rec.detached_) {
          report(rec, "runtime", toError(error));
        }
      };
      const off =
        key === undefined
          ? def.attach(publish, fail)
          : def.attach(publish, fail, { key });
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

        return false;
      }
      rec.off_ = off;
      attached.push(rec);
      live.add(id);
      const c = of(id);
      c.attachedAt = Date.now();
      c.detachedAt = null;
      hear("source.attach", rec);
      if (phase !== "attached") {
        // (ad): a stop ran inside this attach, before its unsubscribe
        // existed, so the stop's detach could not reach it: it goes now.
        unsubscribe(rec);
        live.delete(id);
      }

      return true;
    } catch (raw) {
      const error = toError(raw);
      console.error(`${who(rec)} attach() threw:`, error);
      report(rec, "attach", error);

      return false;
    }
  };

  /** A teardown step that threw (1.35's cleanupAll and cleanupAllAsync). */
  const failed = (rec: Attached, raw: unknown) => {
    const error = toError(raw);
    console.error(
      `${who(rec)} unsubscribe threw${rec.closed_ ? " during gate-closed" : ""}:`,
      error,
    );
    report(rec, "cleanup", error);
  };
  /** Flags the record, then plugins hear the detach before the unsubscribe. */
  const detach = (rec: Attached) => {
    rec.detached_ = true;
    hear("source.detach", rec);
    of(rec.id_).detachedAt = Date.now();
  };
  /** A synchronous detach: flag, hear, then unsubscribe (a promise not awaited). */
  const unsubscribe = (rec: Attached) => {
    detach(rec);
    try {
      rec.off_();
    } catch (raw) {
      failed(rec, raw);
    }
  };

  // --- gates (G1–G6, L1–L3, T1–T3) ---------------------------------------
  const gates: Gate[] = [];
  /** The ungated sources, which start attaches in declaration order. */
  const ungated: [string, Def][] = [];
  for (const [id, def] of defs) {
    const { key, active } = def;
    const on = typeof active === "function";
    if (on || typeof key === "function") {
      if (typeof key === typeof active) {
        throw new Error(
          `[Directive] Source "${id}" declares both \`key\` and \`active\`. Use ONE: \`key\` for identity-based re-keying (returns a string | null), \`active\` for a simple on/off gate (returns a boolean).`,
        );
      }
      // The rest of the state is set by `end()`, which every start runs.
      gates.push({
        id_: id,
        module_: ownerOf(id),
        def_: def,
        // Strictly `=== true`: a truthy non-boolean must not open a channel.
        fn_: on
          ? (f: unknown) => ((active as Fn)(f) === true ? "__on__" : null)
          : (key as Fn),
      });
    } else {
      ungated.push([id, def]);
    }
  }
  const disarm = (gate: Gate) => {
    clock.clearTimeout(gate.timer_!);
    gate.timer_ = 0;
  };
  /** The kernel-clock timer of `gate`, owned by the system: one at a time. */
  const arm = (gate: Gate, ms: number, fn: () => void) => {
    disarm(gate);
    gate.timer_ = clock.setTimeout(
      () => {
        gate.timer_ = 0;
        fn();
      },
      ms,
      { owner: kernel.owner },
    );
  };
  /**
   * 1.35's runTeardownAndReattach: the committed key's subscription goes
   * (detachOne, `gate-closed`; none on a rising edge, as nothing is
   * attached under a null key), then commitAttach: attach under `k`, or
   * commit null, and record the result. A failed attach owes a retry,
   * 250 ms doubling to 30 s, held off while that backoff runs; a retry owed
   * for another key never holds this one. (aa): the failure commits null,
   * so the retry, and a return to an old key, is a rising edge. (ac): the
   * backoff ends on a clock timer that evaluates this gate.
   */
  const commit = (gate: Gate, k: string | null | undefined) => {
    const rec = attached.find((r) => !r.detached_ && r.id_ === gate.id_);
    if (rec) {
      rec.closed_ = true;
      unsubscribe(rec);
      attached.splice(attached.indexOf(rec), 1);
      live.delete(rec.id_);
    }
    if (k != null) {
      const again = gate.tries_ && gate.to_ === k;
      if (again && gate.timer_) {
        return;
      }
      if (!attach(gate.id_, gate.def_, k)) {
        gate.tries_ = again ? gate.tries_! + 1 : 1;
        gate.key_ = null;
        gate.to_ = k;
        // Not while a stopAsync awaits its teardown (phase "stopped").
        arm(
          gate,
          Math.min(250 * 2 ** (gate.tries_ - 1), 30_000),
          () => phase === "attached" && evaluate(gate),
        );

        return;
      }
    }
    gate.key_ = k;
    gate.tries_ = 0;
    disarm(gate);
  };
  /**
   * Development: the read-only view gates read through (G5), and the gate
   * being evaluated, for the refused-write message.
   */
  let dev: { check_: CheckedReadView<object>; id_: string | null } | undefined;
  /** 1.35's evaluateGated for one gate: fail closed, then follow the edge. */
  const evaluate = (gate: Gate) => {
    let k: string | null = null;
    try {
      const fn = gate.fn_;
      let raw: unknown;
      if (isDevelopment) {
        if (!dev) {
          const refuse = (key: string): never => {
            throw gateError(dev!.id_ ?? "<unknown>", `wrote "${key}"`);
          };
          const readonlyStore = Object.freeze({
            ...context.store,
            set: refuse,
            delete: refuse,
          });
          dev = {
            id_: null,
            check_: createCheckedReadView(facts as object, refuse, {
              override: (prop) =>
                prop === "$store" ? readonlyStore : undefined,
            }),
          };
        }
        const { check_ } = dev;
        dev.id_ = gate.id_;
        let changed: string | null;
        try {
          raw = fn(scope ? scope(check_.view, gate.module_) : check_.view);
        } finally {
          dev.id_ = null;
          // Always taken, so a gate that throws leaves nothing recorded
          // for the next one to be blamed for.
          changed = check_.takeMutation();
        }
        if (changed !== null) {
          throw gateError(gate.id_, `changed "${changed}" in place`);
        }
      } else {
        raw = fn(scope ? scope(facts, gate.module_) : facts);
      }
      if (raw !== null && typeof raw !== "string") {
        throw new Error(
          `gate returned ${raw === undefined ? "undefined" : typeof raw} — must return string | null`,
        );
      }
      k = raw;
    } catch (raw) {
      report(gate, "gate", toError(raw));
    }
    const committed = gate.key_;
    const ms = gate.def_.gateLingerMs!;
    if (gate.timer_ && committed !== null) {
      // A linger in flight, committed → to_: a return cancels it, the same
      // target leaves it running, and a third key tears the committed one
      // down at once (L2; commit ends the timer).
      if (k === committed) {
        disarm(gate);
      } else if (k !== gate.to_) {
        commit(gate, k);
      }
    } else if (k !== committed) {
      // (aa): a committed key is attached, so an unchanged key owes nothing.
      if (committed !== null && ms > 0) {
        // A fall or a re-key lingers: the committed key stays until the
        // timer. A rising edge never lingers.
        gate.to_ = k;
        arm(gate, ms, () => commit(gate, gate.to_));
      } else {
        commit(gate, k);
      }
    }
  };
  /**
   * Every gate, while attached (1.35's evaluateGated). (ad): a stop inside a
   * gated attach ends the pass.
   */
  const gate = () => {
    for (const g of gates) {
      if (phase === "attached") {
        evaluate(g);
      }
    }
  };
  /** The end of an attach cycle: no list, and no gate state or timer. */
  const end = () => {
    attached = [];
    live = new Set();
    for (const g of gates) {
      disarm(g);
      g.key_ = null;
      g.tries_ = 0;
    }
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

        // The counters in their own order, which is 1.35's row order.
        return {
          id,
          moduleId,
          localId: localId(id, moduleId),
          meta: (def as { meta?: unknown }).meta,
          attached: live.has(id),
          ...c,
        };
      }),
    count_: () => attached.filter((rec) => !rec.detached_).length,
    start_() {
      // 1.35's attachAll: a fresh list, fresh counters and fresh gate state
      // each start. The ungated sources attach first; then every gate is
      // evaluated once (engine.ts:3426), so a source whose gate is open at
      // start is attached when start() returns.
      end();
      counters.clear();
      phase = "attached";
      for (const [id, def] of ungated) {
        // (ad): a stop inside an attach ends the loop.
        if (phase !== "attached") {
          break;
        }
        attach(id, def);
      }
      gate();
    },
    gate_: gate,
    // Reverse attach order. A promise from unsubscribe is not awaited here.
    stop_() {
      if (phase !== "attached") {
        return;
      }
      phase = "stopped";
      for (let i = attached.length - 1; i >= 0; i--) {
        const rec = attached[i];
        if (rec && !rec.detached_) {
          unsubscribe(rec);
        }
      }
      end();
    },
    // Reverse attach order; each unsubscribe awaited, capped by its timeout.
    async stopAsync_() {
      if (phase !== "attached") {
        return;
      }
      phase = "stopped";
      // (ae): the linger and backoff timers go before the first await, so
      // none fires into the teardown and attaches what nothing unsubscribes.
      gates.forEach(disarm);
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
      end();
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
