/**
 * `system.trace`, as a system part (L9b; 1.35 core/engine-trace.ts and its
 * call sites in engine.ts): with the `trace` option on, each pass that did
 * something becomes an entry in a ring of `maxRuns` (100). It is built from
 * the kernel's records; with the option off the part subscribes to nothing,
 * so a pass does main's work.
 *
 * - A write is queued when it happens and moved into the next pass's entry
 *   when that pass starts (R3). A pass with no fact change, constraint hit,
 *   added requirement or effect run leaves no entry.
 * - An entry whose resolvers are still running is `pending`; it settles when
 *   the last one completes, errors or is canceled, gets its causal chain and
 *   anomalies, and is handed to `onTraceComplete` (R4, R5).
 * - (bh), approved: `system.trace` is one frozen array until the next change,
 *   and an entry is frozen when it settles, one level into the lists and rows
 *   the trace made; values and meta are the program's and stay as they are.
 * - (bi), approved: a pending run pushed out of the ring still settles and
 *   reports, through the resolver runs still in flight when it was pushed
 *   out; nothing else is kept for it.
 *
 * Placed after the plugins part, so its listener hears each record after the
 * plugins do and `onTraceComplete` follows the hook that settled the run, as
 * in 1.35.
 */

import type { KernelEvent } from "../kernel.js";
import type { SystemPart } from "./core.js";
import type { RequirementWithId } from "./requirements.js";
import type { FactChange } from "./types.js";

type Rec = Record<string, any>;
type Entry = Rec;

/** Freezes `o` and, `depth` levels down, what it holds, but not the program's values or meta (bh). */
const lock = (o: any, depth: number): any => {
  if (depth && o && typeof o === "object") {
    for (const key in o) {
      if (key !== "meta" && !key.endsWith("Value")) {
        lock(o[key], depth - 1);
      }
    }
  }

  return Object.freeze(o);
};

export const withTrace =
  (option: boolean | { maxRuns?: number } | undefined): SystemPart =>
  (context) => {
    // 1.35 turns it on with `true` or any object (engine-trace.ts:162–165).
    if ((option !== true && typeof option !== "object") || !option) {
      return;
    }
    const { kernel, module, system, emit_: emit } = context;
    const maxRuns = (option as { maxRuns?: number }).maxRuns ?? 100;
    const m = module as Rec;
    const metaOf = (defs: Rec | undefined, id: string) => defs?.[id]?.meta;
    const entries: Entry[] = [];
    /** Each requirement in flight → the entry whose pass started it. */
    const owners = new Map<string, Entry>();
    /** Each pending entry → its resolvers still running and its start. */
    const open = new Map<Entry, [number, number]>();
    let queued: Rec[] = [];
    let current: Entry | null = null;
    let started = 0;
    let added: RequirementWithId[] = [];
    let flight: Map<string, { resolver_: string; reqs_?: unknown }> | undefined;
    let cache: readonly Entry[] | null = null;
    let id = 0;
    let count = 0;
    let total = 0;

    const settle = (entry: Entry, duration: number) => {
      entry.status = "settled";
      entry.duration = duration;
      entry.causalChain = [
        ...entry.factChanges.map((c: Rec) => `${c.key} changed`),
        ...entry.derivationsRecomputed.map((d: Rec) => `${d.id} recomputed`),
        ...entry.constraintsHit.map((c: Rec) => `${c.id} constraint hit`),
        ...entry.requirementsAdded.map(
          (r: Rec) => `${r.type} requirement added`,
        ),
        ...entry.resolversCompleted.map(
          (r: Rec) => `${r.resolver} resolved (${r.duration.toFixed(0)}ms)`,
        ),
        ...entry.resolversErrored.map((r: Rec) => `${r.resolver} errored`),
        ...entry.effectsRun.map((e: Rec) => `${e.id} effect ran`),
      ].join(" → ");
      // 1.35's updateTraceStats: the duration anomaly after three runs.
      count++;
      total += duration;
      const average = total / count;
      const anomalies: string[] = [];
      if (count > 3 && duration > average * 5) {
        anomalies.push(
          `Duration ${duration.toFixed(0)}ms is 5x+ above average (${average.toFixed(0)}ms)`,
        );
      }
      const errored = entry.resolversErrored.length;
      if (errored > 0) {
        anomalies.push(`${errored} resolver(s) errored`);
      }
      if (anomalies.length > 0) {
        entry.anomalies = anomalies;
      }
    };
    const report = (entry: Entry) => {
      cache = null;
      emit("trace.complete", { entry: lock(entry, 3) });
    };
    /** A resolver of `req`'s run ended: its run settles with the last one. */
    const end = (req: RequirementWithId) => {
      const entry = owners.get(req.id);
      owners.delete(req.id);
      const state = entry && open.get(entry);
      if (state && --state[0] <= 0) {
        open.delete(entry!);
        settle(entry!, performance.now() - state[1]);
        report(entry!);
      }
    };
    /** The row `req`'s run gets on its entry, when it still has one. */
    const row = (event: KernelEvent, list: string, extra: Rec) =>
      owners.get((event.req as RequirementWithId).id)?.[list].push({
        resolver: event.resolver,
        requirementId: (event.req as RequirementWithId).id,
        ...extra,
        meta: metaOf(m.resolvers, event.resolver as string),
      });
    const finish = () => {
      const entry = current!;
      current = null;
      entry.duration = performance.now() - started;
      for (const req of added) {
        // 1.35 names the resolver of a run in flight, and a batch run is not
        // one (its getInflightInfo, as the pass end's result reads it).
        const run = flight?.get(req.id);
        const resolver = run && !run.reqs_ ? run.resolver_ : "unknown";
        entry.resolversStarted.push({
          resolver,
          requirementId: req.id,
          meta: metaOf(m.resolvers, resolver),
        });
        owners.set(req.id, entry);
      }
      added = [];
      if (
        entry.factChanges.length +
          entry.constraintsHit.length +
          entry.requirementsAdded.length +
          entry.effectsRun.length >
        0
      ) {
        const running = entry.resolversStarted.length;
        if (running === 0) {
          settle(entry, entry.duration);
        } else {
          open.set(entry, [running, started]);
        }
        entries.push(entry);
        if (entries.length > maxRuns) {
          // (bi): a pending run pushed out still settles and reports, but
          // only through a run still in flight: nothing is kept for a
          // requirement no run will end (no resolver, or a batch not yet
          // started), so what is kept is bounded by the runs in flight.
          const out = entries.shift()!;
          const state = open.get(out);
          if (state) {
            state[0] = 0;
            for (const { requirementId: id } of out.resolversStarted) {
              if (owners.get(id) === out) {
                if (flight?.has(id)) {
                  state[0]++;
                } else {
                  owners.delete(id);
                }
              }
            }
            if (!state[0]) {
              open.delete(out);
            }
          }
        }
        cache = null;
        if (running === 0) {
          report(entry);
        }
      }
    };
    const fact = (key: string, oldValue: unknown, newValue: unknown) =>
      queued.push({ key, oldValue, newValue });
    const on: Record<string, (event: KernelEvent) => void> = {
      "fact.set": (e) => fact(e.key as string, e.prev, e.value),
      "fact.batch"(e) {
        for (const c of e.changes as FactChange[]) {
          fact(c.key, c.prev, c.type === "delete" ? undefined : c.value);
        }
      },
      "reconcile.start"() {
        // A pass that threw left its entry open: it ends where the next begins.
        if (current) {
          finish();
        }
        started = performance.now();
        current = {
          id: ++id,
          timestamp: Date.now(),
          duration: 0,
          status: "pending",
          factChanges: queued,
          derivationsRecomputed: [],
          constraintsHit: [],
          requirementsAdded: [],
          requirementsRemoved: [],
          resolversStarted: [],
          resolversCompleted: [],
          resolversErrored: [],
          effectsRun: [],
          effectErrors: [],
        };
        queued = [];
        for (const change of current.factChanges) {
          change.meta = m.schema?.facts?.[change.key]?._meta;
        }
      },
      "derivation.compute"(e) {
        current?.derivationsRecomputed.push({
          id: e.id,
          deps: e.deps,
          oldValue: e.oldValue,
          newValue: e.value,
          meta: metaOf(m.derive, e.id as string),
        });
      },
      "effect.run"(e) {
        current?.effectsRun.push({
          id: e.id,
          triggeredBy: e.deps,
          meta: metaOf(m.effects, e.id as string),
        });
      },
      "effect.error"(e) {
        current?.effectErrors.push({
          id: e.id,
          error: String(e.error),
          meta: metaOf(m.effects, e.id as string),
        });
      },
      "requirement.diff"(e) {
        if (current) {
          for (const hit of e.hit as Rec[]) {
            current.constraintsHit.push({
              ...hit,
              meta: metaOf(m.constraints, hit.id),
            });
          }
          added = e.added as RequirementWithId[];
          flight = e.flight as typeof flight;
          for (const [list, reqs] of [
            ["requirementsAdded", added],
            ["requirementsRemoved", e.removed],
          ] as const) {
            for (const req of reqs as RequirementWithId[]) {
              current[list].push({
                id: req.id,
                type: req.requirement.type,
                fromConstraint: req.fromConstraint,
              });
            }
          }
        }
      },
      "resolver.complete": (e) =>
        row(e, "resolversCompleted", { duration: e.duration }),
      "requirement.met": (e) => end(e.req as RequirementWithId),
      "resolver.error"(e) {
        row(e, "resolversErrored", { error: String(e.error) });
        end(e.req as RequirementWithId);
      },
      "requirement.canceled": (e) => end(e.req as RequirementWithId),
      "reconcile.end"() {
        if (current) {
          finish();
        }
      },
      "system.destroy"() {
        entries.length = 0;
        owners.clear();
        open.clear();
        queued = [];
        current = null;
        cache = null;
      },
    };
    kernel.hooks.on(
      Object.assign((event: KernelEvent) => on[event.at]?.(event), {
        wants_: (at: string) => !!on[at],
      }),
    );
    // Effect runs list what they read (effects.ts `wantsRunDeps`).
    context.trace_ = true;
    const read = () => (cache ??= Object.freeze([...entries]));
    Object.defineProperty(system, "trace", { get: read });
    const inspect = system.inspect as () => Rec;
    system.inspect = () => ({
      ...inspect(),
      traceEnabled: true,
      trace: structuredClone(read()),
    });
  };
