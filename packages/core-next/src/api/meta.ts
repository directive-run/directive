/**
 * `system.meta`, as a system part (L9a; 1.35 engine.ts:2387–2821): what each
 * definition is (its authored meta) and which values carry a tag. Every 1.35
 * system has it, so `createSystem` always wires it; nothing runs per write.
 *
 * - At build, each definition's meta is replaced by a frozen copy whose
 *   `tags` are read strictly (`freezeMeta`, as 1.35 does at registration), and
 *   each schema type this package builds is frozen with its `_meta`, so a tag
 *   cannot be taken back (M1, M2).
 * - The runtime keeps its own copy of every fact's tags, untagged keys too:
 *   `carriesTag("fact", …)` is a map lookup, `undefined` for a key it never
 *   recorded (M3).
 * - A derivation inherits the tags of the facts it read on its last
 *   computation, through derivations, stopping at `tagBoundary: true` (M4).
 *   The walk reads each derivation (computing a stale one, as 1.35 does), fenced
 *   off dependency tracking, so a question asked from a body records nothing.
 * - `subscribe` calls a listener for `immediate` only at L9: nothing changes
 *   the definitions until L10's dynamic registration (M8).
 */

import { type DefinitionMeta, freezeMeta } from "../types/meta.js";
import type { SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX, withoutTracking } from "./facts.js";

type Meta = DefinitionMeta | undefined;
type Defs = Record<string, { meta?: Meta } | undefined>;
interface Row {
  kind: string;
  id: string;
  meta: DefinitionMeta;
  tagOrigin: string;
}

/**
 * Schema types already frozen (1.35's preparedSchemaTypes): a second system
 * over the same module does not freeze them again.
 */
const prepared = new WeakSet<object>();

export const withMeta: SystemPart = (context) => {
  const { kernel, module, system, tracker, derived, derivationDeps } = context;
  /** meta.subscribe's listeners, told of each definition change (L10, D6). */
  const listeners = new Set<() => void>();
  context.metaChanged_ = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (error) {
        console.error("[Directive] Metadata subscriber error:", { error });
      }
    }
  };
  // The namespaced form lists its modules; a single module is its own row.
  // L10b: one list, which registerModule and unregisterModule change.
  const m = module as Record<string, any>;
  let mods = (m.modules_ ??= [module]) as {
    id: string;
    meta?: Meta;
  }[];
  const schema = (m.schema?.facts ?? {}) as Record<string, { _meta?: Meta }>;
  const derive = (m.derive ?? {}) as Defs;
  // 1.35's byTag order: modules, facts, then these, then derivations.
  const kinds = new Map<string, Defs>(
    (["event", "constraint", "resolver", "effect"] as const).map((kind) => [
      kind,
      (m[kind === "event" ? "events" : `${kind}s`] ?? {}) as Defs,
    ]),
  );
  for (const defs of [...kinds.values(), derive, mods]) {
    for (const def of Object.values(defs)) {
      if (def?.meta) {
        def.meta = freezeMeta(def.meta);
      }
    }
  }
  const tagSets = new Map<string, ReadonlySet<string>>();
  /**
   * Facts that join, or (an entry with no type slot, L10b: unregisterModule)
   * leave. As 1.35 (recordFactTags, engine.ts:2477–2491; registerModule,
   * 4509–4527): every joining key's tags first, untagged keys too, then each
   * type is prepared once, where a missing type throws (the WeakSet refuses
   * it) after the keys joined.
   */
  const note = (entries: [string, unknown?][]) => {
    for (const entry of entries) {
      const tags = (entry[1] as { _meta?: Meta })?._meta?.tags;
      1 in entry
        ? tagSets.set(entry[0], new Set(tags?.length ? tags : []))
        : tagSets.delete(entry[0]);
    }
    for (const entry of entries) {
      const type = entry[1] as { _meta?: Meta };
      if (1 in entry && !prepared.has(type)) {
        prepared.add(type);
        if (type._meta) {
          type._meta = freezeMeta(type._meta);
        }
        // Only the types this package builds, which are objects (1.35's
        // isOwnSchemaType, engine.ts:253–259): a Zod schema caches onto
        // itself.
        if (typeof type === "object" && "_typeName" in type) {
          Object.freeze(type);
        }
      }
    }
  };
  note(Object.entries(schema));
  context.keys_ = note;
  const fenced = <T>(fn: () => T): T =>
    kernel.graph.untracked(() => withoutTracking(tracker, fn));
  const has = Object.hasOwn as (o: object, id: string) => boolean;
  /** The tags `id` picks up from what it read, less those it authored. */
  const inherited = (id: string): string[] => {
    const authored = derive[id]?.meta;
    const tags = new Set<string>();
    if (authored?.tagBoundary !== true) {
      const seen = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const current = queue.pop()!;
        if (seen.has(current) || !has(derive, current)) {
          continue;
        }
        seen.add(current);
        // Read first, as 1.35's dependencyEdges does: a stale one computes.
        derived[current];
        for (const dep of derivationDeps(current) ?? []) {
          if (!dep.startsWith(DERIVATION_DEP_PREFIX)) {
            for (const tag of tagSets.get(dep) ?? []) {
              tags.add(tag);
            }
          } else if (derive[dep.slice(1)]?.meta?.tagBoundary !== true) {
            queue.push(dep.slice(1));
          }
        }
      }
      for (const tag of authored?.tags ?? []) {
        tags.delete(tag);
      }
    }

    return [...tags];
  };
  const withTags = (meta: Meta, extra: Record<string, unknown>) =>
    Object.freeze(Object.assign(Object.create(null), meta, extra));
  const collect = () => {
    const rows: Row[] = [];
    const push = (
      kind: string,
      id: string,
      meta: Meta,
      tagOrigin = "authored",
    ) => meta && rows.push({ kind, id, meta, tagOrigin });
    for (const mod of mods) {
      push("module", mod.id, mod.meta);
    }
    for (const key in schema) {
      push("fact", key, schema[key]?._meta);
    }
    for (const [kind, defs] of kinds) {
      for (const id in defs) {
        push(kind, id, defs[id]?.meta);
      }
    }
    for (const id in derive) {
      const meta = derive[id]?.meta;
      push("derivation", id, meta);
      // An unannotated derivation still carries what its inputs carry.
      const tags = inherited(id);
      if (tags.length) {
        push("derivation", id, withTags(meta, { tags }), "inherited");
      }
    }

    return rows;
  };
  const metaOf = (kind: string) => (id: string) => kinds.get(kind)![id]?.meta;
  const modMeta = (id: string) => mods.find((mod) => mod.id === id)?.meta;
  // 1.35's destroy clears its module and event meta maps and its meta
  // subscribers (engine.ts:3504–3506, 3552–3554) and keeps every other
  // definition's: a module teardown that finishes later tells no one.
  kernel.onDispose(() => {
    mods = [];
    kinds.set("event", {});
    listeners.clear();
  });
  Object.assign(system.meta as object, {
    module: modMeta,
    fact: (key: string) => schema[key]?._meta,
    event: metaOf("event"),
    constraint: metaOf("constraint"),
    resolver: metaOf("resolver"),
    effect: metaOf("effect"),
    derivation(id: string) {
      const authored = derive[id]?.meta;
      const tags = fenced(() => inherited(id));

      return tags.length
        ? withTags(authored, { inheritedTags: Object.freeze(tags) })
        : authored;
    },
    byTag: (tag: string, options?: { kind?: string }) =>
      fenced(collect).filter(
        (row) =>
          (options?.kind === undefined || row.kind === options.kind) &&
          row.meta.tags?.includes(tag),
      ),
    carriesTag(kind: string, id: string, tag: string) {
      if (kind === "fact") {
        return tagSets.get(id)?.has(tag);
      }
      if (kind === "derivation") {
        if (!has(derive, id)) {
          return undefined;
        }
        if (derive[id]?.meta?.tags?.includes(tag)) {
          return true;
        }
        // A body that throws does not decide what gets redacted.
        try {
          return fenced(() => inherited(id).includes(tag));
        } catch {
          return undefined;
        }
      }
      // 1.35 answers for a module or an event only when it has meta, and for
      // the other kinds whenever the id is defined. A Map, so `__proto__` is
      // no kind.
      const defs = kinds.get(kind);
      const meta =
        kind === "module"
          ? modMeta(id)
          : defs && has(defs, id)
            ? (defs[id]?.meta ?? (kind === "event" ? undefined : {}))
            : undefined;

      return meta && (meta.tags?.includes(tag) ?? false);
    },
    // At L9 nothing changes the definitions, so a listener is only ever
    // called for `immediate`; L10's dynamic registration keeps and calls them.
    // The tag list narrows nothing, as in 1.35.
    subscribe(
      tags: readonly string[] | (() => void),
      listener?: (() => void) | { immediate?: boolean },
      options?: { immediate?: boolean },
    ) {
      const fn = (typeof tags === "function" ? tags : listener) as () => void;
      if (((fn === tags ? listener : options) as typeof options)?.immediate) {
        fn();
      }
      listeners.add(fn);

      return () => {
        listeners.delete(fn);
      };
    },
  });
};
