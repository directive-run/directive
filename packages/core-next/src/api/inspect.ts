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
}) => {
  // No constraints and no resolvers: no requirement to explain (1.35).
  system.explain ??= () => null;
  const resolverDefs = Object.entries(
    (module.resolvers ?? {}) as Record<
      string,
      { requirement?: unknown; meta?: unknown }
    >,
  ).map(([id, def]) => ({
    id,
    requirement:
      typeof def.requirement === "string" ? def.requirement : "(predicate)",
    meta: def.meta,
  }));
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
    // The fact keys only: a watched derivation that moved is listed too.
    let pending = 0;
    for (const key of observed.size ? written : []) {
      // A membership key (L10) is no invalidation either.
      pending += +!(
        key.startsWith(DERIVATION_DEP_PREFIX) ||
        key.startsWith(MEMBER_DEP_PREFIX)
      );
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
      resolverDefs,
      effects: metas(module.effects),
      sources: sources?.rows_() ?? [],
      attachedSourceCount: sources?.count_() ?? 0,
      derivations: metas(module.derive),
      modules: (module as { modules_?: unknown[] }).modules_ ?? [
        { id: module.id, meta: module.meta },
      ],
      traceEnabled: false,
    };
  };
};
