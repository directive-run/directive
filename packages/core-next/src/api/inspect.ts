/**
 * `system.inspect()`, as a system part: the 1.35 inspection shape, read
 * from the module definition, with the L2 sections (requirements, runs,
 * constraints) from the reconcile part when the module has one.
 */

import type { ReconcileFeature, SystemPart } from "./core.js";

type Defs = Record<string, { meta?: unknown; _meta?: unknown } | undefined>;

const metas = (defs: unknown, key: "meta" | "_meta" = "meta") =>
  Object.keys((defs ?? {}) as Defs).map((id) => ({
    id,
    meta: (defs as Defs)[id]?.[key],
  }));

export const withInspect: SystemPart = ({ kernel, module, system }) => {
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

    return {
      unmet: l2?.unmet ?? [],
      inflight: l2?.inflight ?? [],
      pendingInvalidations: 0,
      observedDerivations: 0,
      facts: metas(module.schema?.facts, "_meta").map(({ id, meta }) => ({
        key: id,
        meta,
      })),
      events: metas(module.events).map(({ id, meta }) => ({ name: id, meta })),
      constraints: l2?.constraints ?? [],
      resolvers: l2?.resolvers ?? {},
      resolverDefs,
      effects: metas(module.effects),
      sources: [],
      attachedSourceCount: 0,
      derivations: metas(module.derive),
      modules: (module as { modules_?: unknown[] }).modules_ ?? [
        { id: module.id, meta: module.meta },
      ],
      traceEnabled: false,
    };
  };
};
