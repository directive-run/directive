/**
 * `system.inspect()`, as a system part: the 1.35 inspection shape for an L0
 * system, read from the module definition.
 */

import type { SystemPart } from "./core.js";

type Defs = Record<string, { meta?: unknown; _meta?: unknown } | undefined>;

const metas = (defs: unknown, key: "meta" | "_meta" = "meta") =>
  Object.keys((defs ?? {}) as Defs).map((id) => ({
    id,
    meta: (defs as Defs)[id]?.[key],
  }));

export const withInspect: SystemPart = ({ module, system }) => {
  system.inspect = () => ({
    unmet: [],
    inflight: [],
    pendingInvalidations: 0,
    observedDerivations: 0,
    facts: metas(module.schema?.facts, "_meta").map(({ id, meta }) => ({
      key: id,
      meta,
    })),
    events: metas(module.events).map(({ id, meta }) => ({ name: id, meta })),
    constraints: [],
    resolvers: {},
    resolverDefs: [],
    effects: metas(module.effects),
    sources: [],
    attachedSourceCount: 0,
    derivations: metas(module.derive),
    modules: [{ id: module.id, meta: module.meta }],
    traceEnabled: false,
  });
};
