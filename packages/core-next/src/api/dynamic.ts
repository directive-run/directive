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
import { type SystemContext, type SystemPart, validateKeys } from "./core.js";
import { BLOCKED_PROPS, MEMBER_DEP_PREFIX } from "./facts.js";

type Fn = (...args: any[]) => any;

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

/** Object-form derivations given to `assign`: 1.35 keeps those as given. */
const ASSIGNED = new WeakSet<object>();

/** A change to a destroyed system is refused, with 1.35's text for each. */
const alive = (ctx: SystemContext, op: string, type: string, id: string) => {
  if (ctx.gone_) {
    throw new Error(
      `[Directive] Cannot ${op} ${type} "${id}" on a destroyed system.`,
    );
  }
};
/** The plugins' and observers' event, built only when one listens. */
const emitter =
  (ctx: SystemContext) => (at: string, data: Record<string, unknown>) =>
    ctx.wants_(at) && ctx.emit_(at, data);

/**
 * 1.35's updateDependencies: a derivation whose dependency set changed
 * unlinks the old set and links the new one, so it ends each list of what
 * it reads, and the next write's walk meets it last. Installed by the first
 * dynamic call (a replaced definition is what changes the set here).
 */
const relink = (node: any, old: Set<string> | undefined, deps: Set<string>) => {
  if (old?.size !== deps.size || [...deps].some((k) => !old!.has(k))) {
    const end = node.cursor;
    for (let l = end && node.deps; l; l = l === end ? null : l.nextDep) {
      const source = l.source;
      const last = source.subsTail;
      const { prevSub, nextSub } = l;
      if (nextSub) {
        prevSub ? (prevSub.nextSub = nextSub) : (source.subs = nextSub);
        nextSub.prevSub = prevSub;
        l.prevSub = last;
        l.nextSub = null;
        last.nextSub = source.subsTail = l;
      }
    }
  }
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
  // L10b: the store's registerKeys and unregisterKeys (1.35 core/facts.ts:
  // 645–728). The schema is the store's; a key taken away drops its writes
  // (M7), through a `set` wrapped at the first unregister.
  const store = ctx.store as any;
  const schema = (ctx.module.schema as any).facts as Record<string, unknown>;
  let gone: Set<string> | undefined;
  store.registerKeys = (more: Record<string, unknown>) => {
    const added: [string, unknown][] = [];
    for (const key of Object.keys(more)) {
      if (BLOCKED_PROPS.has(key)) {
        continue;
      }
      if (Object.hasOwn(schema, key) && schema[key] !== more[key]) {
        throw new Error(
          `[Directive] Cannot re-declare fact "${key}". A fact's type and its tags are fixed once registered — replacing the declaration would silently change what gets redacted.`,
        );
      }
      schema[key] = more[key];
      gone?.delete(key);
      added.push([key, more[key]]);
    }
    if (added[0]) {
      ctx.keys_?.(added);
      ctx.metaChanged_?.();
    }
  };
  store.unregisterKeys = (keys: readonly string[]) => {
    if (!gone) {
      const set = store.set;
      const out = (gone = new Set());
      store.set = (key: string, ...rest: unknown[]) =>
        out.has(key) || set(key, ...rest);
    }
    store.batch(() => {
      for (const key of keys) {
        store.delete(key);
        delete schema[key];
        gone!.add(key);
      }
    });
  };
  // L10b: registerModule and unregisterModule, built at the first call.
  let calls: Fn[] | undefined;
  for (const i of [0, 1]) {
    system[i ? "unregisterModule" : "registerModule"] = (target: any) =>
      (calls ??= modules(ctx))[i]!(target);
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
  ctx.relink_ = relink;
  const system = ctx.system as Record<string, any>;
  const m = ctx.module as Record<string, any>;
  const dynamic: Record<string, Set<string>> = {};
  const queue: [string, string, string, any][] = [];
  const kinds: Kinds = {};
  const emit = emitter(ctx);
  const check = (op: string, type: string, id: string) => {
    alive(ctx, op, type, id);
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
      // 1.35 hands a derivation's hook its compute, unwrapped at creation
      // and register, but an assigned one as given (its merged map's entry).
      const original =
        type === "derivation" && !ASSIGNED.has(map[id])
          ? computeOf(map[id])
          : map[id];
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
        type === "derivation" && def?.compute && ASSIGNED.add(def);
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
   * for who asked about the name before it existed, row (bm): a constraint,
   * or a derivation while something is watched, as 1.35's gate (a reader
   * outside the graph sees the name at its next read). Owed nothing,
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
        (system.inspect().observedDerivations &&
          (op === "assign" || fresh.some((key) => key !== member))) ||
        (op === "register" && ctx.kinds_.constraint?.reads_?.(member));
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
        // 1.35's destroy empties its queue (engine-definitions.ts:633).
        ctx.gone_ || apply(op, type, id, def);
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
    check(op, type, id);
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
    check("call", type, id);
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
      // D9: only what `register` added, and nothing once destroyed: 1.35's
      // destroy clears its four sets (engine-definitions.ts:634-637).
      isDynamic: (id: string) => !ctx.gone_ && ids.has(id),
      listDynamic: () => (ctx.gone_ ? [] : [...ids]),
    };
  }

  return kinds;
};

/** Each kind's type, its module map, and whether 1.35 tears it down first. */
const ORDER: [string, string][] = [
  ["constraint", "constraints"],
  ["effect", "effects"],
  ["derivation", "derive"],
];

/**
 * L10b: 1.35's engine registerModule and unregisterModule (engine.ts:4411–
 * 4876), the RFC's M1 to M7, over the same hooks as the registry. A module
 * is a module definition's shape; the namespaced layer hands in its
 * flattened one (namespaced.ts flattenModule).
 */
const modules = (ctx: SystemContext): Fn[] => {
  ctx.relink_ = relink;
  const system = ctx.system as Record<string, any>;
  const m = ctx.module as Record<string, any>;
  const schema = m.schema.facts as Record<string, unknown>;
  const store = ctx.store as any;
  const list = m.modules_ as Record<string, any>[];
  const going = new Map<object, Promise<void>>();
  const emit = emitter(ctx);
  const keys = (map?: object) => Object.keys(map ?? {});
  const freeze = (map?: Record<string, any>) => {
    for (const def of Object.values(map ?? {})) {
      def?.meta && (def.meta = freezeMeta(def.meta));
    }
  };
  const busy = (op: string, id: string) => {
    if (ctx.inPass_) {
      throw new Error(
        `[Directive] Cannot ${op} module "${id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    }
  };
  const register = (mod: Record<string, any>) => {
    const id = mod.id;
    busy("register", id);
    alive(ctx, "register", "module", id);
    const facts = mod.schema?.facts ?? {};
    // M1, 1.35's validateKeys (engine.ts:4449–4466), with its shorter text.
    validateKeys(id, mod, facts, 1, "");
    for (const key in facts) {
      if (key in schema) {
        throw new Error(
          `[Directive] Schema collision: Fact "${key}" already exists. Cannot register module "${id}".`,
        );
      }
    }
    if (isDevelopment) {
      for (const key in mod.derive) {
        key in schema &&
          console.warn(
            `[Directive] "${key}" exists as both a fact and a derivation after registering module "${id}".`,
          );
      }
    }
    // 1.35's snapshotEventNames: a module that lists its own starts a list.
    const snap = ctx.history_;
    const listed = mod.history?.snapshotEvents;
    if (snap && (listed || snap.events_)) {
      snap.events_ ??= new Set(keys(m.events));
      for (const name of listed ?? keys(mod.events)) {
        snap.events_.add(name);
      }
    }
    // The schema and its tags at once, before a source can publish (M3).
    store.registerKeys(facts);
    const add = (type: string, map: string) => {
      for (const key of keys(mod[map])) {
        const had = key in m[map];
        const def = (m[map][key] = mod[map][key]);
        const hooks = ctx.kinds_[type]!;
        const arg = type === "derivation" ? computeOf(def) : def;
        had && hooks.replace_ ? hooks.replace_(key, arg) : hooks.add_(key, arg);
      }
    };
    for (const key of keys(mod.events)) {
      const def = (m.events[key] = mod.events[key]);
      ctx.events_[key] = def?.handler ?? def;
    }
    freeze(mod.derive);
    // M2: a derivation that exists is replaced, with no word.
    add("derivation", "derive");
    freeze(mod.effects);
    add("effect", "effects");
    const sources = Object.entries(mod.sources ?? {}) as [string, any][];
    for (const [key, def] of sources) {
      m.sources[key] = def;
      emit("definition.register", {
        type: "source",
        id: key,
        def: {
          moduleId: id,
          ...(def.meta !== undefined && { meta: def.meta }),
        },
      });
    }
    sources[0] && (ctx.kernel.features as any).sources.add_(sources);
    freeze(mod.constraints);
    freeze(mod.resolvers);
    for (const key of keys(mod.resolvers)) {
      m.owners_ && (m.owners_[key] = mod);
    }
    if (ctx.kinds_.constraint) {
      add("constraint", "constraints");
      add("resolver", "resolvers");
    } else if (keys(mod.constraints)[0] || keys(mod.resolvers)[0]) {
      // The reconcile part is built from the maps (dynamic.ts's l2_).
      Object.assign(m.constraints, mod.constraints);
      Object.assign(m.resolvers, mod.resolvers);
      ctx.l2_!();
    }
    mod.meta && (mod.meta = freezeMeta(mod.meta));
    list.push(mod);
    mod.hooks && m.hooks_.push(mod.hooks);
    ctx.metaChanged_?.();
    mod.init && ctx.store.batch(() => mod.init(ctx.facts));
    emit("module.registered", { id });
    mod.hooks?.onInit?.(system);
    if (system.isRunning) {
      mod.hooks?.onStart?.(system);
      ctx.schedule();
    }
  };
  /** 1.35's drainResolvers: bounded, as a resolver may ignore its signal. */
  const drain = async (waits: unknown[], ids: string[]) => {
    if (!waits[0]) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(waits.map((p: any) => p?.catch(() => {}))),
      new Promise<void>((done) => {
        timer = setTimeout(
          isDevelopment
            ? () => {
                console.warn(
                  `[Directive] Timed out after 10000ms waiting for resolvers to finish: ${ids.join(", ")}. They were detached and aborted; one of them is not observing its abort signal.`,
                );
                done();
              }
            : done,
          1e4,
        );
      }),
    ]);
    clearTimeout(timer);
  };
  /** 1.35's unregisterModuleInner: the reverse of registration (M6). */
  const teardown = async (mod: Record<string, any>) => {
    const id = mod.id;
    const gone = (type: string, key: string) =>
      emit("definition.unregister", { type, id: key });
    const sources = keys(mod.sources);
    if (sources[0]) {
      (ctx.kernel.features as any).sources.remove_(sources);
      for (const key of sources) {
        delete m.sources[key];
        gone("source", key);
      }
    }
    const resolvers = keys(mod.resolvers);
    const hooks = ctx.kinds_.resolver;
    const waits = hooks?.waits_?.(resolvers) ?? [];
    for (const key of resolvers) {
      const def = m.resolvers[key];
      delete m.resolvers[key];
      delete m.owners_?.[key];
      // A key function another resolver declares for the type stays.
      const kept = Object.values(m.resolvers).some(
        (other: any) => other?.key && other.requirement === def?.requirement,
      );
      hooks?.remove_(key, kept ? undefined : def);
      gone("resolver", key);
    }
    // 1.35 awaits its drain whenever the module had a resolver.
    resolvers[0] && (await drain(waits, resolvers));
    for (const [type, map] of ORDER) {
      for (const key of keys(mod[map])) {
        const def = m[map][key];
        delete m[map][key];
        ctx.kinds_[type]?.remove_(key, def);
        gone(type, key);
      }
    }
    for (const name of keys(mod.events)) {
      delete m.events[name];
      delete ctx.events_[name];
      ctx.history_?.events_?.delete(name);
    }
    const facts = keys(mod.schema?.facts);
    store.unregisterKeys(facts);
    ctx.keys_?.(facts.map((key) => [key]));
    list.splice(list.indexOf(mod), 1);
    const at = m.hooks_.indexOf(mod.hooks);
    at < 0 || m.hooks_.splice(at, 1);
    ctx.metaChanged_?.();
    try {
      mod.hooks?.onStop?.(system);
    } catch (raw) {
      console.error(
        `[Directive] Module "${id}" hooks.onStop threw during unregister:`,
        raw instanceof Error ? raw : new Error(String(raw)),
      );
    }
    gone("module", id);
    emit("module.unregistered", { id });
    // 1.35 runs a pass now when running, and awaits it (engine.ts:4870);
    // one a write asked for still follows.
    system.isRunning && (await ctx.reconcile_());
  };
  /**
   * M5: by id or by the module itself; a second call joins the first. Only
   * the namespaced layer's own flattened module matches as an object: 1.35's
   * single-module wrapper registers a copy (system.ts:1338–1352), so the
   * caller's object is never in the engine's list (engine.ts:4686–4694).
   */
  const unregister = async (target: any) => {
    const label =
      typeof target === "string" ? target : (target?.id ?? "<module>");
    alive(ctx, "unregister", "module", label);
    busy("unregister", label);
    const found = list.find((mod) =>
      typeof target === "string"
        ? mod.id === target
        : m.owners_ && mod === target,
    );
    if (!found) {
      throw new Error(
        `[Directive] Cannot unregister module "${label}": no such module is registered.`,
      );
    }
    const prior = going.get(found);
    if (prior) {
      return void (await prior);
    }
    const run = teardown(found);
    going.set(found, run);
    try {
      await run;
    } finally {
      going.delete(found);
    }
  };

  return [register, unregister];
};
