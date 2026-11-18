/**
 * `system.inspect()`, as a system part: the 1.35 inspection shape, read
 * from the module definition, with the L2 sections (requirements, runs,
 * constraints) from the reconcile part when the module has one.
 */

import type { EffectsFeature, ReconcileFeature, SystemPart } from "./core.js";
import { DERIVATION_DEP_PREFIX, MEMBER_DEP_PREFIX } from "./facts.js";
import type { SourcesFeature } from "./sources.js";

type Defs = Record<string, { meta?: unknown; _meta?: unknown } | undefined>;

const metas = (defs: unknown, key: "meta" | "_meta" = "meta") =>
  Object.keys((defs ?? {}) as Defs).map((id) => ({
    id,
    meta: (defs as Defs)[id]?.[key],
  }));

export const withInspect: SystemPart = ({
  kernel,
  module,
  system,
  counts_,
  derived,
  derivationDeps,
}) => {
  // No constraints and no resolvers: no requirement to explain (1.35).
  system.explain ??= () => null;
  system.inspect = () => {
    const l2 = (
      kernel.features as { reconcile?: ReconcileFeature }
    ).reconcile?.inspect_();
    const features = kernel.features as {
      sources?: SourcesFeature;
      effects?: EffectsFeature;
      reconcile?: ReconcileFeature;
    };
    const sources = features.sources;
    // 1.35's observed set (S3): what a constraint or effect reads now, and
    // what one named or asked about; pending is the roots written since the
    // last pass, and nothing when nothing is watched.
    const [watched, written] = counts_();
    const observed = new Set<string>();
    features.reconcile?.observed_(observed);
    features.effects?.observed_(observed);
    for (const id of watched) {
      observed.add(DERIVATION_DEP_PREFIX + id);
    }
    // L10: a derivation unregistered since a reader last ran is not observed.
    for (const key of observed) {
      key.slice(1) in derived || observed.delete(key);
    }
    // 1.35 counts invalidation roots (derivations.ts invalidateMany): each
    // derivation that read a written fact, or that asked about or read a
    // name registered or unregistered since (L10). A removed one is no root.
    let pending = 0;
    for (const id of observed.size ? Object.keys(module.derive ?? {}) : []) {
      for (const dep of derivationDeps(id) ?? []) {
        if (
          dep[0] === DERIVATION_DEP_PREFIX
            ? written.has(MEMBER_DEP_PREFIX + dep.slice(1)) &&
              !(dep.slice(1) in derived)
            : written.has(dep)
        ) {
          pending++;
          break;
        }
      }
    }

    return {
      unmet: l2?.unmet ?? [],
      inflight: l2?.inflight ?? [],
      pendingInvalidations: pending,
      observedDerivations: observed.size,
      facts: metas(module.schema?.facts, "_meta").map(({ id, meta }) => ({
        key: id,
        meta,
      })),
      events: metas(module.events).map(({ id, meta }) => ({ name: id, meta })),
      constraints: l2?.constraints ?? [],
      resolvers: l2?.resolvers ?? {},
      // Read live: a resolver registered at runtime is listed (1.35).
      resolverDefs: Object.entries(
        (module.resolvers ?? {}) as Record<
          string,
          { requirement?: unknown; meta?: unknown }
        >,
      ).map(([id, def]) => ({
        id,
        requirement:
          typeof def.requirement === "string" ? def.requirement : "(predicate)",
        meta: def.meta,
      })),
      effects: metas(module.effects),
      sources: sources?.rows_() ?? [],
      attachedSourceCount: sources?.count_() ?? 0,
      derivations: metas(module.derive),
      // L10b: the module list holds each module whole.
      modules: (
        ((module as any).modules_ ?? [module]) as {
          id: string;
          meta?: unknown;
        }[]
      ).map(({ id, meta }) => ({ id, meta })),
      traceEnabled: false,
    };
  };
};
