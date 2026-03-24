/**
 * Dynamic definition registry for the engine.
 *
 * Extracted from engine.ts to reduce file size. Handles register, assign,
 * unregister, call, getOriginal, restoreOriginal, isDynamic, and listDynamic
 * for constraints, resolvers, derivations, and effects.
 *
 * @internal
 */

import type { ConstraintsManager } from "./constraints.js";
import type { DerivationsManager } from "./derivations.js";
import type { EffectsManager } from "./effects.js";
import type { PluginManager } from "./plugins.js";
import type { ResolversManager } from "./resolvers.js";
import { BLOCKED_PROPS } from "./tracking.js";
import type {
  ConstraintsDef,
  DerivationsDef,
  EffectsDef,
  ResolversDef,
  Schema,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Definition type for dynamic registration */
export type DefType = "constraint" | "resolver" | "derivation" | "effect";

type DeferredOp =
  | { op: "register"; type: DefType; id: string; def: unknown }
  | { op: "assign"; type: DefType; id: string; def: unknown }
  | { op: "unregister"; type: DefType; id: string };

// ============================================================================
// DefinitionsRegistry Interface
// ============================================================================

/**
 * Registry for dynamic definition management (register, assign, unregister, call).
 *
 * @remarks
 * Handles deferral during reconciliation — operations queued while reconciling
 * are applied atomically after the cycle completes. Tracks which definitions
 * were dynamically registered vs. statically defined from module configs.
 *
 * @internal
 */
export interface DefinitionsRegistry {
  /**
   * Register a new definition. Deferred if called during reconciliation.
   *
   * @param type - The definition type
   * @param id - Unique definition identifier
   * @param def - The definition object
   * @throws If the definition already exists, or the ID is invalid
   */
  register(type: DefType, id: string, def: unknown): void;

  /**
   * Override an existing definition. Deferred if called during reconciliation.
   * Stores the original for later restoration.
   *
   * @param type - The definition type
   * @param id - Definition identifier to override
   * @param def - The replacement definition
   * @throws If the definition does not exist, or the ID is invalid
   */
  assign(type: DefType, id: string, def: unknown): void;

  /**
   * Remove a dynamically registered definition. Deferred if called during reconciliation.
   * Static (module-defined) definitions cannot be unregistered.
   *
   * @param type - The definition type
   * @param id - Definition identifier to remove
   */
  unregister(type: DefType, id: string): void;

  /**
   * Invoke a definition directly (evaluate constraint, run resolver, etc.).
   *
   * @param type - The definition type
   * @param id - Definition identifier to invoke
   * @param props - Optional properties/payload
   * @returns The invocation result
   */
  call(type: DefType, id: string, props?: unknown): unknown;

  /**
   * Check if a definition was dynamically registered.
   *
   * @param type - The definition type
   * @param id - Definition identifier
   */
  isDynamic(type: DefType, id: string): boolean;

  /**
   * List all dynamically registered definition IDs for a type.
   *
   * @param type - The definition type
   */
  listDynamic(type: DefType): string[];

  /**
   * Flush deferred registrations queued during reconciliation.
   */
  flushDeferred(): void;

  /**
   * Get the original definition before it was assigned/overridden.
   *
   * @param type - The definition type
   * @param id - Definition identifier
   * @returns The original definition, or undefined if not overridden
   */
  getOriginal(type: DefType, id: string): unknown | undefined;

  /**
   * Restore a definition to its original value (before assign).
   *
   * @param type - The definition type
   * @param id - Definition identifier
   * @returns true if restored, false if no original was found
   */
  restoreOriginal(type: DefType, id: string): boolean;

  /**
   * Clean up all dynamic definition state.
   */
  destroy(): void;
}

// ============================================================================
// Factory Options
// ============================================================================

/**
 * Options for creating a definitions registry.
 *
 * @internal
 */
export interface CreateDefinitionsRegistryOptions<S extends Schema> {
  /** Merged constraint definitions (mutable reference) */
  mergedConstraints: ConstraintsDef<S>;
  /** Merged resolver definitions (mutable reference) */
  mergedResolvers: ResolversDef<S>;
  /** Merged derivation definitions (mutable reference) */
  mergedDerive: DerivationsDef<S>;
  /** Merged effect definitions (mutable reference) */
  mergedEffects: EffectsDef<S>;
  /** Constraints manager */
  constraintsManager: ConstraintsManager<S>;
  /** Resolvers manager */
  resolversManager: ResolversManager<S>;
  /** Derivations manager */
  derivationsManager: DerivationsManager<S, DerivationsDef<S>>;
  /** Effects manager */
  effectsManager: EffectsManager<S>;
  /** Plugin manager */
  pluginManager: PluginManager<S>;
  /** Getter for engine state flags */
  getState: () => { isDestroyed: boolean; isReconciling: boolean };
  /** Trigger reconciliation */
  scheduleReconcile: () => void;
  /** Max deferred registrations */
  maxDeferredRegistrations: number;
}

// ============================================================================
// Implementation
// ============================================================================

/** Reserved derive method names — derivation IDs cannot use these */
const RESERVED_DERIVE_NAMES = new Set([
  "register",
  "assign",
  "unregister",
  "call",
  "isDynamic",
  "listDynamic",
]);

/**
 * Per-type descriptor used by the dispatch map to collapse the switch
 * statements in applyRegister, applyAssign, and applyUnregister.
 */
interface TypeDescriptor {
  /** Human-readable label for error messages */
  label: string;
  /** The mutable merged definitions map for this type */
  mergedMap: Record<string, unknown>;
  /** The manager instance for this type */
  manager: {
    registerDefinitions(defs: Record<string, unknown>): void;
    assignDefinition(id: string, def: unknown): void;
    unregisterDefinition(id: string): void;
  };
  /** Set of dynamically registered IDs */
  dynamicSet: Set<string>;
  /** Map of originals for assigned definitions */
  originalsMap: Map<string, unknown>;
  /** Whether to call scheduleReconcile after register/assign/unregister */
  reconciles: boolean;
  /** Optional extra validation on the ID (e.g. reserved name check) */
  validateId?: (id: string) => void;
}

/**
 * Create a definitions registry for dynamic definition management.
 *
 * @remarks
 * Receives mutable references to the merged definition maps and manager
 * instances. Operations modify these references directly to maintain
 * atomicity with the engine's state.
 *
 * @param options - Managers, merged maps, and engine state accessors
 * @returns A {@link DefinitionsRegistry} instance
 *
 * @internal
 */
export function createDefinitionsRegistry<S extends Schema>(
  options: CreateDefinitionsRegistryOptions<S>,
): DefinitionsRegistry {
  const {
    mergedConstraints,
    mergedResolvers,
    mergedDerive,
    mergedEffects,
    constraintsManager,
    resolversManager,
    derivationsManager,
    effectsManager,
    pluginManager,
    getState,
    scheduleReconcile,
    maxDeferredRegistrations,
  } = options;

  /** Track which definitions were dynamically registered */
  const dynamicIds = {
    constraints: new Set<string>(),
    resolvers: new Set<string>(),
    derivations: new Set<string>(),
    effects: new Set<string>(),
  };

  /** Originals map for assigned definitions */
  const originals = {
    constraints: new Map<string, unknown>(),
    resolvers: new Map<string, unknown>(),
    derivations: new Map<string, unknown>(),
    effects: new Map<string, unknown>(),
  };

  /** Deferred registrations queue */
  const deferredRegistrations: DeferredOp[] = [];

  /** Validate derivation ID is not a reserved derive method name */
  function validateDerivationId(id: string): void {
    if (RESERVED_DERIVE_NAMES.has(id)) {
      throw new Error(
        `[Directive] Derivation ID "${id}" conflicts with a reserved derive method name.`,
      );
    }
  }

  /** Per-type dispatch map — eliminates switch statements in apply* functions */
  const typeDescriptors: Record<DefType, TypeDescriptor> = {
    constraint: {
      label: "Constraint",
      mergedMap: mergedConstraints as Record<string, unknown>,
      // biome-ignore lint/suspicious/noExplicitAny: Manager type erasure for dispatch map
      manager: constraintsManager as any,
      dynamicSet: dynamicIds.constraints,
      originalsMap: originals.constraints,
      reconciles: true,
    },
    resolver: {
      label: "Resolver",
      mergedMap: mergedResolvers as Record<string, unknown>,
      // biome-ignore lint/suspicious/noExplicitAny: Manager type erasure for dispatch map
      manager: resolversManager as any,
      dynamicSet: dynamicIds.resolvers,
      originalsMap: originals.resolvers,
      reconciles: true,
    },
    derivation: {
      label: "Derivation",
      mergedMap: mergedDerive as Record<string, unknown>,
      // biome-ignore lint/suspicious/noExplicitAny: Manager type erasure for dispatch map
      manager: derivationsManager as any,
      dynamicSet: dynamicIds.derivations,
      originalsMap: originals.derivations,
      reconciles: false,
      validateId: validateDerivationId,
    },
    effect: {
      label: "Effect",
      mergedMap: mergedEffects as Record<string, unknown>,
      // biome-ignore lint/suspicious/noExplicitAny: Manager type erasure for dispatch map
      manager: effectsManager as any,
      dynamicSet: dynamicIds.effects,
      originalsMap: originals.effects,
      reconciles: false,
    },
  };

  /** Validate a definition ID for safety */
  function validateDefId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
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
  }

  /** Apply a register operation immediately */
  function applyRegister(type: DefType, id: string, def: unknown): void {
    const desc = typeDescriptors[type];
    desc.validateId?.(id);

    if (id in desc.mergedMap) {
      throw new Error(
        `[Directive] ${desc.label} "${id}" already exists. Use assign() to override.`,
      );
    }

    desc.mergedMap[id] = def;
    desc.manager.registerDefinitions({ [id]: def });
    desc.dynamicSet.add(id);
    pluginManager.emitDefinitionRegister(type, id, def);

    if (desc.reconciles) {
      scheduleReconcile();
    }
  }

  /**
   * Apply an assign operation immediately.
   * Manager's assignDefinition() is called first (may validate/throw).
   * Only on success do we commit the original and update the merged map.
   */
  function applyAssign(type: DefType, id: string, def: unknown): void {
    const desc = typeDescriptors[type];
    desc.validateId?.(id);

    if (!(id in desc.mergedMap)) {
      throw new Error(
        `[Directive] ${desc.label} "${id}" does not exist. Use register() to create it.`,
      );
    }

    const original = desc.mergedMap[id];
    desc.manager.assignDefinition(id, def);
    desc.originalsMap.set(id, original);
    desc.mergedMap[id] = def;
    pluginManager.emitDefinitionAssign(type, id, def, original);

    if (desc.reconciles) {
      scheduleReconcile();
    }
  }

  /** Apply an unregister operation immediately */
  function applyUnregister(type: DefType, id: string): void {
    const desc = typeDescriptors[type];

    if (!desc.dynamicSet.has(id)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[Directive] Cannot unregister static ${type} "${id}". Only dynamically registered ${type}s can be removed.`,
        );
      }

      return;
    }

    desc.manager.unregisterDefinition(id);
    delete desc.mergedMap[id];
    desc.dynamicSet.delete(id);
    desc.originalsMap.delete(id);
    pluginManager.emitDefinitionUnregister(type, id);

    if (desc.reconciles) {
      scheduleReconcile();
    }
  }

  /** Flush deferred registrations after reconcile settles */
  function flushDeferred(): void {
    if (deferredRegistrations.length === 0) {
      return;
    }

    const ops = deferredRegistrations.splice(0);
    for (const op of ops) {
      try {
        switch (op.op) {
          case "register":
            applyRegister(op.type, op.id, op.def);
            break;
          case "assign":
            applyAssign(op.type, op.id, op.def);
            break;
          case "unregister":
            applyUnregister(op.type, op.id);
            break;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[Directive] Error in deferred ${op.op} for ${op.type} "${op.id}":`,
            error,
          );
        }
      }
    }
  }

  /** Enforce deferral or destroyed guards, then delegate */
  function guardedOp(
    op: "register" | "assign" | "unregister",
    type: DefType,
    id: string,
    def?: unknown,
  ): void {
    const { isDestroyed, isReconciling } = getState();

    if (isDestroyed) {
      throw new Error(
        `[Directive] Cannot ${op} ${type} "${id}" on a destroyed system.`,
      );
    }

    validateDefId(id);

    if (isReconciling) {
      if (deferredRegistrations.length >= maxDeferredRegistrations) {
        throw new Error(
          `[Directive] Too many deferred registrations (max ${maxDeferredRegistrations}). Avoid calling register/assign/unregister in resolver or effect callbacks during reconciliation.`,
        );
      }
      if (op === "unregister") {
        deferredRegistrations.push({ op, type, id });
      } else {
        deferredRegistrations.push({ op, type, id, def: def! });
      }

      return;
    }

    switch (op) {
      case "register":
        applyRegister(type, id, def!);
        break;
      case "assign":
        applyAssign(type, id, def!);
        break;
      case "unregister":
        applyUnregister(type, id);
        break;
    }
  }

  return {
    register(type: DefType, id: string, def: unknown) {
      guardedOp("register", type, id, def);
    },

    assign(type: DefType, id: string, def: unknown) {
      guardedOp("assign", type, id, def);
    },

    unregister(type: DefType, id: string) {
      guardedOp("unregister", type, id);
    },

    call(type: DefType, id: string, props?: unknown): unknown {
      const { isDestroyed } = getState();
      if (isDestroyed) {
        throw new Error(
          `[Directive] Cannot call ${type} "${id}" on a destroyed system.`,
        );
      }

      validateDefId(id);
      pluginManager.emitDefinitionCall(type, id, props);

      switch (type) {
        case "constraint":
          return constraintsManager.callOne(
            id,
            props as Record<string, unknown> | undefined,
          );
        case "resolver":
          return resolversManager.callOne(
            id,
            props as { type: string; [key: string]: unknown },
          );
        case "derivation":
          return derivationsManager.callOne(id);
        case "effect":
          return effectsManager.callOne(id);
      }
    },

    isDynamic(type: DefType, id: string): boolean {
      switch (type) {
        case "constraint":
          return dynamicIds.constraints.has(id);
        case "resolver":
          return dynamicIds.resolvers.has(id);
        case "derivation":
          return dynamicIds.derivations.has(id);
        case "effect":
          return dynamicIds.effects.has(id);
      }
    },

    listDynamic(type: DefType): string[] {
      switch (type) {
        case "constraint":
          return [...dynamicIds.constraints];
        case "resolver":
          return [...dynamicIds.resolvers];
        case "derivation":
          return [...dynamicIds.derivations];
        case "effect":
          return [...dynamicIds.effects];
      }
    },

    flushDeferred,

    getOriginal(type: DefType, id: string): unknown | undefined {
      const typeMap: Record<string, Map<string, unknown>> = {
        constraint: originals.constraints,
        resolver: originals.resolvers,
        derivation: originals.derivations,
        effect: originals.effects,
      };
      const map = typeMap[type];

      if (!map) {
        return undefined;
      }

      return map.get(id);
    },

    restoreOriginal(type: DefType, id: string): boolean {
      const typeMap: Record<string, Map<string, unknown>> = {
        constraint: originals.constraints,
        resolver: originals.resolvers,
        derivation: originals.derivations,
        effect: originals.effects,
      };
      const map = typeMap[type];

      if (!map || !map.has(id)) {
        return false;
      }

      const original = map.get(id);
      guardedOp("assign", type, id, original);
      map.delete(id);

      return true;
    },

    destroy() {
      deferredRegistrations.length = 0;
      dynamicIds.constraints.clear();
      dynamicIds.resolvers.clear();
      dynamicIds.derivations.clear();
      dynamicIds.effects.clear();
      originals.constraints.clear();
      originals.resolvers.clear();
      originals.derivations.clear();
      originals.effects.clear();
    },
  };
}
