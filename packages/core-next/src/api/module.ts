/**
 * createModule and createModuleFactory with the 1.35 checks.
 *
 * Structural checks (reserved fact names, reserved `abortOn`/`bind` keys, the
 * dependency-set separator) throw in every build: each one stops a silent
 * mis-routing later. The rest are development warnings, written out behind
 * the dev flag so a production build drops their text.
 */

import isDevelopment from "#is-development";
import { BLOCKED_PROPS, DERIVATION_DEP_PREFIX } from "./facts.js";
import type { ModuleDef, ModuleDefinition, ModuleSchema } from "./types.js";

type Config = Record<string, any>;
const keysOf = (o: unknown): string[] => Object.keys(o ?? {});
const warn = (message: string) => console.warn(`[Directive] ${message}`);

function check(id: string, config: Config): void {
  const factKeys = keysOf(config.schema?.facts);
  const deps = keysOf(config.crossModuleDeps);
  const reserved = new Set(["self", "prev", "current", ...deps]);
  for (const key of factKeys) {
    if (reserved.has(key)) {
      throw new Error(
        `[Directive] module '${id}': fact key '${key}' conflicts with a reserved namespace pivot or evaluation alias (self / prev / current / a crossModuleDep namespace). Three fixes:\n  1. Rename the fact (e.g. ${key}_)\n  2. Remove '${key}' from this module's crossModuleDeps if it's not actually needed\n  3. Move the fact under a wrapping namespace (t.object({ inner: ... }))`,
      );
    }
  }
  for (const [cid, constraint] of Object.entries(config.constraints ?? {})) {
    for (const field of ["abortOn", "bind"]) {
      for (const key of (constraint as Config)?.[field] ?? []) {
        if (BLOCKED_PROPS.has(key) || key.startsWith("$")) {
          throw new Error(
            `[Directive] module '${id}' constraint '${cid}': ${field} key '${key}' is reserved (BLOCKED_PROPS or $-prefixed)`,
          );
        }
      }
    }
  }
  const separator = (name: string, what: string) => {
    if (name.includes(DERIVATION_DEP_PREFIX)) {
      throw new Error(
        `[Directive] module '${id}': ${what} '${JSON.stringify(name)}' contains U+001F (unit separator). That character separates derivation IDs from fact keys inside a dependency set, so a name carrying it makes the two indistinguishable — writing the fact would invalidate readers of a same-named derivation. Rename it to something without control characters.`,
      );
    }
  };
  for (const key of factKeys) {
    separator(key, "fact key");
  }
  for (const key of keysOf(config.derive)) {
    separator(key, "derivation");
  }
}

/** Development only: the 1.35 advice about a module's shape. */
function advise(id: string, config: Config): void {
  if (!id || typeof id !== "string") {
    warn("Module ID must be a non-empty string");
  } else if (!/^(__[a-z][a-z0-9_-]*|[a-z][a-z0-9-]*)$/i.test(id)) {
    warn(
      `Module ID "${id}" should follow kebab-case convention (e.g., "my-module")`,
    );
  }
  const schema = config.schema;
  if (!schema) {
    warn("Module schema is required");
  } else if (!schema.facts) {
    if (
      Object.values(schema).some(
        (v) => v != null && typeof v === "object" && "_typeName" in v,
      )
    ) {
      warn(
        `Module "${id}" schema appears to contain fact declarations directly. Did you mean \`schema: { facts: { ... } }\` instead of \`schema: { ... }\`?`,
      );
    }
    warn("Module schema.facts is required");
  }
  const align = (
    impl: unknown,
    declared: unknown,
    label: string,
    schemaLabel: string,
    missing: string,
  ) => {
    const implKeys = keysOf(impl);
    const schemaKeys = keysOf(declared);
    for (const key of implKeys) {
      if (!schemaKeys.includes(key)) {
        warn(`${label} "${key}" not declared in ${schemaLabel}`);
      }
    }
    for (const key of schemaKeys) {
      if (!implKeys.includes(key)) {
        warn(`${schemaLabel}["${key}"] ${missing}`);
      }
    }
  };
  align(
    config.derive,
    schema?.derivations,
    "Derivation",
    "schema.derivations",
    "has no matching implementation in derive",
  );
  align(
    config.events,
    schema?.events,
    "Event",
    "schema.events",
    "has no matching handler in events",
  );
  const snapshotEvents = config.history?.snapshotEvents as string[] | undefined;
  if (snapshotEvents) {
    if (snapshotEvents.length === 0) {
      warn(
        "history.snapshotEvents is an empty array — no events will create history snapshots. Omit history.snapshotEvents entirely to snapshot all events, or list specific events.",
      );
    }
    const events = keysOf(schema?.events);
    for (const name of snapshotEvents) {
      if (!events.includes(name)) {
        warn(
          `history.snapshotEvents entry "${name}" not declared in schema.events. Available events: ${events.join(", ") || "(none)"}`,
        );
      }
    }
  }
  if (config.resolvers && schema?.requirements) {
    const types = keysOf(schema.requirements);
    for (const [name, resolver] of Object.entries(config.resolvers)) {
      const requirement = (resolver as Config)?.requirement;
      if (typeof requirement === "string" && !types.includes(requirement)) {
        warn(
          `Resolver "${name}" references unknown requirement type "${requirement}". Available types: ${types.join(", ") || "(none)"}`,
        );
      }
    }
  }
}

export function createModule<const M extends ModuleSchema>(
  id: string,
  definition: ModuleDef<M>,
): ModuleDefinition<M> {
  const config = definition as Config;
  check(id, config);
  if (isDevelopment) {
    advise(id, config);
  }

  // The 1.35 shape, field for field: anything else on the config is dropped.
  return {
    id,
    schema: config.schema,
    init: config.init,
    derive: config.derive ?? {},
    events: config.events ?? {},
    effects: config.effects,
    sources: config.sources,
    constraints: config.constraints,
    resolvers: config.resolvers,
    hooks: config.hooks,
    meta: config.meta,
    history: config.history,
    crossModuleDeps: config.crossModuleDeps,
  } as unknown as ModuleDefinition<M>;
}

export function createModuleFactory<const M extends ModuleSchema>(
  definition: ModuleDef<M>,
): (name: string) => ModuleDefinition<M> {
  return (name) => createModule(name, definition);
}
