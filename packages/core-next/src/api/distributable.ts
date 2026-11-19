/**
 * `getDistributableSnapshot` and `watchDistributableSnapshot`, as a system
 * part (L12a, the RFC's D1 to D9): 1.35's engine methods (engine.ts:4092–4296)
 * and its namespaced wrappers (system.ts:699–785) in one part. `createSystem`
 * wires it on every system (A1, O1); `createSystemCore` and the floor go
 * without it, and the beta drops it.
 *
 * The part reads only what the core offers: the derivation ids and `read`,
 * the store's facts, and the core's `subscribe`. It subscribes to nothing
 * until a watch is made.
 *
 * One row, approved on the owner's instruction ("I approve you for to do
 * everything", 2026-11-15; the L12 RFC's (bx), "Option taken: approved, in
 * L12a"): a watch also subscribes to its included facts, so a write to one
 * calls back when it changes `data`. 1.35 hears only the watched
 * derivations, so a client mirroring `includeFacts` stays stale until one
 * moves. The version check is 1.35's, so a callback still means `data` moved.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { hashObject } from "./predicate-hash.js";

type Rec = Record<string, unknown>;

interface Options {
  includeDerivations?: string[];
  excludeDerivations?: string[];
  includeFacts?: string[];
  ttlSeconds?: number;
  metadata?: Rec;
  includeVersion?: boolean;
}

interface Distributable {
  data: Rec;
  createdAt: number;
  expiresAt?: number;
  version?: string;
  metadata?: Rec;
}

/** The namespaced form's separator (namespaced.ts SEPARATOR). */
const SEP = "::";

export const withDistributable: SystemPart = ({
  system,
  store,
  derived,
  module,
}) => {
  // The core's, taken before the namespaced form puts its own on the system.
  const read = system.read as (id: string) => unknown;
  const subscribe = system.subscribe as (
    ids: string[],
    fn: () => void,
  ) => () => void;
  const namespaced = !!(module as { load_?: unknown }).load_;

  /** The watched derivations: included (known ones), less the excluded. */
  const pick = (
    all: string[],
    { includeDerivations, excludeDerivations }: Options,
  ) => {
    let keys = includeDerivations
      ? includeDerivations.filter((k) => all.includes(k))
      : all;
    if (excludeDerivations) {
      keys = keys.filter((k) => !excludeDerivations.includes(k));
    }

    return keys;
  };

  const get = (options: Options = {}): Distributable => {
    const { includeDerivations, includeFacts, ttlSeconds, metadata } = options;
    const data: Rec = {};
    const all = Object.keys(derived);
    if (isDevelopment && includeDerivations) {
      const unknown = includeDerivations.filter((k) => !all.includes(k));
      if (unknown.length > 0) {
        console.warn(
          `[Directive] getDistributableSnapshot: Unknown derivation keys ignored: ${unknown.join(", ")}. Available: ${all.join(", ") || "(none)"}`,
        );
      }
    }
    for (const key of pick(all, options)) {
      try {
        data[key] = read(key);
      } catch (error) {
        if (isDevelopment) {
          console.warn(
            `[Directive] getDistributableSnapshot: Skipping derivation "${key}" due to error:`,
            error,
          );
        }
      }
    }
    if (includeFacts?.length) {
      const facts = store.toObject();
      if (isDevelopment) {
        const unknown = includeFacts.filter((k) => !(k in facts));
        if (unknown.length > 0) {
          console.warn(
            `[Directive] getDistributableSnapshot: Unknown fact keys ignored: ${unknown.join(", ")}. Available: ${Object.keys(facts).join(", ") || "(none)"}`,
          );
        }
      }
      for (const key of includeFacts) {
        if (key in facts) {
          data[key] = facts[key];
        }
      }
    }
    const createdAt = Date.now();
    const snapshot: Distributable = { data, createdAt };
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      snapshot.expiresAt = createdAt + ttlSeconds * 1000;
    }
    if (options.includeVersion) {
      snapshot.version = hashObject(data);
    }
    if (metadata) {
      snapshot.metadata = metadata;
    }

    return snapshot;
  };

  const watch = (
    options: Options,
    callback: (snapshot: Distributable) => void,
  ): (() => void) => {
    const keys = pick(Object.keys(derived), options);
    if (!keys.length) {
      if (isDevelopment) {
        console.warn(
          "[Directive] watchDistributableSnapshot: No derivations to watch. Callback will never be called.",
        );
      }

      return () => {};
    }
    // Every snapshot a watch takes carries `version` (D7).
    const versioned = { ...options, includeVersion: true };
    // The first one seeds the version and computes the derivations, so
    // their invalidations reach the listener.
    let previous = get(versioned).version;
    const changed = () => {
      const snapshot = get(versioned);
      if (snapshot.version !== previous) {
        previous = snapshot.version;
        callback(snapshot);
      }
    };
    const off = subscribe(keys, changed);
    // (bx): the included facts too.
    const offFacts = store.subscribe(options.includeFacts ?? [], changed);

    return () => {
      off();
      offFacts();
    };
  };

  if (!namespaced) {
    system.getDistributableSnapshot = get;
    system.watchDistributableSnapshot = watch;

    return;
  }
  // The namespaced form (1.35 system.ts:699–785): `"a.count"` in, data
  // nested by module out (`{ a: { count } }`; a key with no module goes
  // under `_root`).
  const inward = (options?: Options): Options => {
    const map = (keys?: string[]) => keys?.map((k) => k.split(".").join(SEP));

    return {
      ...options,
      includeDerivations: map(options?.includeDerivations),
      excludeDerivations: map(options?.excludeDerivations),
      includeFacts: map(options?.includeFacts),
    };
  };
  const outward = (snapshot: Distributable): Distributable => {
    const data: Record<string, Rec> = {};
    for (const [key, value] of Object.entries(snapshot.data)) {
      const at = key.indexOf(SEP);
      const ns = at > 0 ? key.slice(0, at) : "_root";
      (data[ns] ??= {})[at > 0 ? key.slice(at + SEP.length) : key] = value;
    }

    return { ...snapshot, data };
  };
  system.getDistributableSnapshot = (options?: Options) =>
    outward(get(inward(options)));
  system.watchDistributableSnapshot = (
    options: Options,
    callback: (snapshot: Distributable) => void,
  ) => watch(inward(options), (snapshot) => callback(outward(snapshot)));
};
