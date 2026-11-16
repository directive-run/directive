/**
 * Dynamic definitions, the per-definition half (L10a; the L10 RFC's D1 to
 * D10 and K1 to K6): `register`, `assign`, `unregister`, `call`,
 * `isDynamic` and `listDynamic` on `system.constraints`, `resolvers`,
 * `effects` and `derive`, as 1.35's definitions registry
 * (core/engine-definitions.ts) gives them.
 *
 * One registry for the four kinds. It checks the id, refuses a duplicate or
 * a missing one, writes the module's map (which `meta` and the parts read
 * live), then calls the kind's hooks on `context.kinds_`: the core's
 * derivation seam, the effects part's and the reconcile part's. A change
 * asked for during a pass is queued and applied where the pass ends (D5).
 * Each applied change tells the plugins and `meta.subscribe` (D6).
 *
 * Two owner rows, taken on the instruction "I approve you for to do
 * everything" (2026-11-15): (bl) `derive.assign` with `{ compute, meta }`
 * unwraps the object as `register` does, where 1.35 leaves every read
 * throwing; (bm) is the core's (a reader that asked about a name before it
 * existed hears it arrive).
 */

import isDevelopment from "#is-development";
import { type DefinitionMeta, freezeMeta } from "../types/meta.js";
import type { SystemContext, SystemPart } from "./core.js";
import { BLOCKED_PROPS, MEMBER_DEP_PREFIX } from "./facts.js";

/** 1.35's type names, each with its module map (and `system` member). */
const MAPS: Record<string, string> = {
  constraint: "constraints",
  resolver: "resolvers",
  derivation: "derive",
  effect: "effects",
};
/** 1.35's derive members (RESERVED_DERIVE_NAMES). */
const NAMES = [
  "register",
  "assign",
  "unregister",
  "call",
  "isDynamic",
  "listDynamic",
];
/** 1.35's MAX_DEFERRED_REGISTRATIONS (engine.ts:1644). */
const MAX = 100;

/** A derivation's compute: the function, or the object form's (K1, (bl)). */
const computeOf = (def: any): unknown => {
  const fn = typeof def === "function" ? def : def?.compute;
  if (
    typeof def === "object" &&
    fn !== undefined &&
    typeof fn !== "function" &&
    (typeof fn !== "object" || fn === null)
  ) {
    // 1.35 sends it to the data-form compiler, whose text this is (U11).
    throw new Error(
      `[Directive] memoizePredicate: predicate must be a plain object or array; got ${typeof fn}`,
    );
  }

  return fn;
};

type Kinds = Record<string, Record<string, unknown>>;
/** On each kind's object (`system.constraints`, ...): its type and its system's registry. */
const OWNER = Symbol();
/**
 * The six members, one getter each for every system: the registry is built
 * at the first read of one, so a system that never touches them builds none
 * (about 3.8 KB a system, measured on startup-10-modules).
 */
const members = Object.fromEntries(
  NAMES.map((name) => [
    name,
    {
      enumerable: true,
      get(this: { [OWNER]: [string, () => Kinds] }) {
        const [type, build] = this[OWNER];

        return build()[type]![name];
      },
    },
  ]),
);

export const withDynamic: SystemPart = (ctx) => {
  const system = ctx.system as Record<string, any>;
  let kinds: Kinds | undefined;
  const build = () => (kinds ??= registry(ctx));
  for (const type in MAPS) {
    if (type !== "derivation") {
      const target = (system[MAPS[type]!] ??= {});
      target[OWNER] = [type, build];
      Object.defineProperties(target, members);
    }
  }
  // The six members come first, as 1.35's derive accessor
  // (engine-accessors.ts:46–55); everything else is the core's view.
  system.derive = new Proxy(system.derive, {
    get: (target, id) =>
      Object.hasOwn(members, id)
        ? build().derivation![id as string]
        : target[id],
  });
};

const registry = (ctx: SystemContext): Kinds => {
  const system = ctx.system as Record<string, any>;
  const m = ctx.module as Record<string, any>;
  const dynamic: Record<string, Set<string>> = {};
  const queue: [string, string, string, any][] = [];
  const kinds: Kinds = {};
  const emit = (at: string, data: Record<string, unknown>) =>
    ctx.wants_(at) && ctx.emit_(at, data);
  const check = (id: unknown) => {
    if (typeof id !== "string" || !id) {
      throw new Error(
        `[Directive] Definition ID must be a non-empty string. Received: ${String(id)}`,
      );
    }
    if (BLOCKED_PROPS.has(id)) {
      throw new Error(
        `[Directive] Security: Definition ID "${id}" is a blocked property.`,
      );
    }
    if (id.includes("::")) {
      throw new Error(
        `[Directive] Definition ID "${id}" cannot contain "::". This separator is reserved for namespacing.`,
      );
    }
  };
  /** 1.35's applyRegister, applyAssign and applyUnregister, as one. */
  const apply = (op: string, type: string, id: string, def?: any) => {
    const map = m[MAPS[type]!];
    const ids = dynamic[type]!;
    const hooks = ctx.kinds_[type];
    const written = ctx.counts_()[1] as Set<string>;
    const n = written.size;
    let owed: unknown;
    if (op === "unregister") {
      // D3: a static or unknown id is no error.
      if (!ids.has(id)) {
        if (isDevelopment) {
          console.warn(
            `[Directive] Cannot unregister static ${type} "${id}". Only dynamically registered ${type}s can be removed.`,
          );
        }

        return;
      }
      const old = map[id];
      delete map[id];
      ids.delete(id);
      hooks!.remove_(id, old);
      owed = owe(op, type, id, written, n);
      emit("definition.unregister", { type, id });
    } else {
      if (type === "derivation" && NAMES.includes(id)) {
        throw new Error(
          `[Directive] Derivation ID "${id}" conflicts with a reserved derive method name.`,
        );
      }
      // D2, with 1.35's `in`.
      if (op === "register" ? id in map : !(id in map)) {
        throw new Error(
          `[Directive] ${type[0]!.toUpperCase() + type.slice(1)} "${id}" ${op === "register" ? "already exists. Use assign() to override." : "does not exist. Use register() to create it."}`,
        );
      }
      const arg = type === "derivation" ? computeOf(def) : def;
      // D10.
      if (def?.meta) {
        def.meta = freezeMeta(def.meta as DefinitionMeta);
      }
      const original = map[id];
      map[id] = def;
      if (op === "register") {
        // The reconcile part is built at the first constraint or resolver
        // of a system that had none, from the map just written.
        hooks ? hooks.add_(id, arg) : ctx.l2_!();
        owed = owe(op, type, id, written, n);
        ids.add(id);
        emit("definition.register", { type, id, def });
        // K6: an effect's declared name that is now a derivation links to it.
        if (type === "derivation") {
          (ctx.kernel.features as any).effects?.link_(id);
        }
      } else {
        hooks!.replace_(id, arg);
        owed = owe(op, type, id, written, n);
        emit("definition.assign", { type, id, def, original });
      }
    }
    ctx.metaChanged_?.();
    if (owed) {
      ctx.schedule();
    }
  };
  /**
   * D7, 1.35's scheduleIfWorkOwed: a constraint or resolver change asks for
   * a pass, an effect's never. A derivation's asks only when it left an
   * announcement owed: an assign, or an unregister that staled a reader,
   * while something is watched (pendingInvalidationCount); a register only
   * for who asked about the name before it existed, row (bm). Owed nothing,
   * the keys the change wrote go (1.35 drops its roots), so no later pass
   * carries them; an effect that tested the name keeps its membership key,
   * quirk (c) and (w).
   */
  const owe = (
    op: string,
    type: string,
    id: string,
    written: Set<string>,
    n: number,
  ) => {
    let owed: unknown = type === "constraint" || type === "resolver";
    if (type === "derivation") {
      const member = MEMBER_DEP_PREFIX + id;
      const fresh = [...written].slice(n);
      owed =
        op === "register"
          ? fresh.length
          : system.inspect().observedDerivations &&
            (op === "assign" || fresh.some((key) => key !== member));
      if (!owed) {
        for (const key of fresh) {
          key[0]! < " " && written.delete(key);
        }
        op !== "assign" &&
          (ctx.kernel.features as any).effects?.reads_(member) &&
          written.add(member);
      }
    }

    return owed;
  };
  const flush = () => {
    ctx.end_ = undefined;
    for (const [op, type, id, def] of queue.splice(0)) {
      try {
        apply(op, type, id, def);
      } catch (error) {
        if (isDevelopment) {
          console.error(
            `[Directive] Error in deferred ${op} for ${type} "${id}":`,
            error,
          );
        }
      }
    }
  };
  const guarded = (op: string, type: string) => (id: string, def?: unknown) => {
    if (ctx.gone_) {
      throw new Error(
        `[Directive] Cannot ${op} ${type} "${id}" on a destroyed system.`,
      );
    }
    check(id);
    if (!ctx.inPass_) {
      return apply(op, type, id, def);
    }
    // D5: applied where the pass ends.
    if (queue.length >= MAX) {
      throw new Error(
        `[Directive] Too many deferred registrations (max ${MAX}). Avoid calling register/assign/unregister in resolver or effect callbacks during reconciliation.`,
      );
    }
    queue.push([op, type, id, def]);
    ctx.end_ = flush;
  };
  /** D8: a derivation answers now; the others answer a promise. */
  const call = (type: string) => (id: string, props?: unknown) => {
    if (ctx.gone_) {
      throw new Error(
        `[Directive] Cannot call ${type} "${id}" on a destroyed system.`,
      );
    }
    check(id);
    emit("definition.call", { type, id, props });
    if (!m[MAPS[type]!][id]) {
      const error = new Error(
        `[Directive] Cannot call ${type} "${id}" — it does not exist.`,
      );
      if (type === "derivation") {
        throw error;
      }

      return Promise.reject(error);
    }

    return ctx.kinds_[type]!.call_(id, props);
  };
  for (const type in MAPS) {
    const ids = (dynamic[type] = new Set());
    kinds[type] = {
      register: guarded("register", type),
      assign: guarded("assign", type),
      unregister: guarded("unregister", type),
      call: call(type),
      // D9: only what `register` added.
      isDynamic: (id: string) => ids.has(id),
      listDynamic: () => [...ids],
    };
  }

  return kinds;
};
