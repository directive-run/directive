/**
 * Migration Utilities for Directive
 *
 * Helpers for migrating from Redux, Zustand, or XState to Directive.
 * These utilities help you understand your existing state management
 * and generate equivalent Directive module structures.
 */

// ============================================================================
// Types
// ============================================================================

/** Redux slice configuration (simplified) */
export interface ReduxSliceConfig {
  name: string;
  initialState: Record<string, unknown>;
  reducers: Record<
    string,
    (state: unknown, action?: { payload?: unknown }) => void
  >;
}

/** Zustand store configuration (simplified) */
export interface ZustandStoreConfig {
  state: Record<string, unknown>;
  actions: Record<string, (...args: unknown[]) => void>;
}

/** XState machine configuration (simplified) */
export interface XStateMachineConfig {
  id: string;
  initial: string;
  states: Record<string, { on?: Record<string, string | { target: string }> }>;
  context?: Record<string, unknown>;
}

/** Generated Directive module structure */
export interface DirectiveModuleStructure {
  name: string;
  facts: Record<string, string>;
  derivations: Record<string, string>;
  events: Record<string, Record<string, string>>;
  requirements: Record<string, unknown>;
  initCode: string;
  deriveCode: Record<string, string>;
  eventsCode: Record<string, string>;
}

// ============================================================================
// Redux Migration
// ============================================================================

/**
 * Analyze a Redux slice and generate a Directive module structure.
 *
 * @example
 * ```typescript
 * const reduxConfig = {
 *   name: 'counter',
 *   initialState: { value: 0, status: 'idle' },
 *   reducers: {
 *     increment: (state) => { state.value += 1; },
 *     decrement: (state) => { state.value -= 1; },
 *   },
 * };
 *
 * const structure = analyzeReduxSlice(reduxConfig);
 * console.log(generateModuleCode(structure));
 * ```
 */
export function analyzeReduxSlice(
  config: ReduxSliceConfig,
): DirectiveModuleStructure {
  const facts: Record<string, string> = {};
  const events: Record<string, Record<string, string>> = {};
  const eventsCode: Record<string, string> = {};

  // Analyze initial state to generate facts
  for (const [key, value] of Object.entries(config.initialState)) {
    facts[key] = inferTypeString(value);
  }

  // Analyze reducers to generate events
  for (const reducerName of Object.keys(config.reducers)) {
    // Simple heuristic: if reducer name suggests payload, add it
    const hasPayload =
      reducerName.includes("By") ||
      reducerName.includes("Set") ||
      reducerName.includes("With");
    if (hasPayload) {
      events[reducerName] = { payload: "t.object()" };
      eventsCode[reducerName] =
        `(facts, { payload }) => {\n    // TODO: Implement ${reducerName}\n  }`;
    } else {
      events[reducerName] = {};
      eventsCode[reducerName] =
        `(facts) => {\n    // TODO: Implement ${reducerName}\n  }`;
    }
  }

  // Generate init code
  const initLines = Object.entries(config.initialState)
    .map(([key, value]) => `    facts.${key} = ${JSON.stringify(value)};`)
    .join("\n");
  const initCode = `(facts) => {\n${initLines}\n  }`;

  return {
    name: config.name,
    facts,
    derivations: {},
    events,
    requirements: {},
    initCode,
    deriveCode: {},
    eventsCode,
  };
}

// ============================================================================
// Zustand Migration
// ============================================================================

/**
 * Analyze a Zustand store and generate a Directive module structure.
 *
 * @example
 * ```typescript
 * const zustandConfig = {
 *   state: { count: 0, loading: false },
 *   actions: {
 *     increment: () => {},
 *     decrement: () => {},
 *     setLoading: (loading: boolean) => {},
 *   },
 * };
 *
 * const structure = analyzeZustandStore(zustandConfig);
 * console.log(generateModuleCode(structure));
 * ```
 */
export function analyzeZustandStore(
  config: ZustandStoreConfig,
): DirectiveModuleStructure {
  const facts: Record<string, string> = {};
  const events: Record<string, Record<string, string>> = {};
  const eventsCode: Record<string, string> = {};

  // Analyze state
  for (const [key, value] of Object.entries(config.state)) {
    facts[key] = inferTypeString(value);
  }

  // Analyze actions
  for (const actionName of Object.keys(config.actions)) {
    events[actionName] = {};
    eventsCode[actionName] =
      `(facts) => {\n    // TODO: Implement ${actionName}\n  }`;
  }

  // Generate init code
  const initLines = Object.entries(config.state)
    .map(([key, value]) => `    facts.${key} = ${JSON.stringify(value)};`)
    .join("\n");
  const initCode = `(facts) => {\n${initLines}\n  }`;

  return {
    name: "store",
    facts,
    derivations: {},
    events,
    requirements: {},
    initCode,
    deriveCode: {},
    eventsCode,
  };
}

// ============================================================================
// XState Migration
// ============================================================================

/**
 * Analyze an XState machine and generate a Directive module structure.
 *
 * @example
 * ```typescript
 * const xstateConfig = {
 *   id: 'toggle',
 *   initial: 'inactive',
 *   states: {
 *     inactive: { on: { TOGGLE: 'active' } },
 *     active: { on: { TOGGLE: 'inactive' } },
 *   },
 * };
 *
 * const structure = analyzeXStateMachine(xstateConfig);
 * console.log(generateModuleCode(structure));
 * ```
 */
export function analyzeXStateMachine(
  config: XStateMachineConfig,
): DirectiveModuleStructure {
  const facts: Record<string, string> = {
    state: `t.string<${Object.keys(config.states)
      .map((s) => `'${s}'`)
      .join(" | ")}>()`,
  };
  const derivations: Record<string, string> = {};
  const deriveCode: Record<string, string> = {};
  const events: Record<string, Record<string, string>> = {};
  const eventsCode: Record<string, string> = {};

  // Add context to facts
  if (config.context) {
    for (const [key, value] of Object.entries(config.context)) {
      facts[key] = inferTypeString(value);
    }
  }

  // Generate state derivations (isActive, isInactive, etc.)
  for (const stateName of Object.keys(config.states)) {
    const derivationName = `is${capitalize(stateName)}`;
    derivations[derivationName] = "t.boolean()";
    deriveCode[derivationName] = `(facts) => facts.state === '${stateName}'`;
  }

  // Collect all events and their transitions
  const eventTransitions = new Map<string, Map<string, string>>();
  for (const [stateName, stateConfig] of Object.entries(config.states)) {
    if (!stateConfig.on) continue;
    for (const [eventName, target] of Object.entries(stateConfig.on)) {
      if (!eventTransitions.has(eventName)) {
        eventTransitions.set(eventName, new Map());
      }
      const targetState = typeof target === "string" ? target : target.target;
      eventTransitions.get(eventName)!.set(stateName, targetState);
    }
  }

  // Generate events and handlers
  for (const [eventName, transitions] of eventTransitions) {
    events[eventName] = {};

    if (transitions.size === 1) {
      const firstEntry = [...transitions.entries()][0];
      const toState = firstEntry ? firstEntry[1] : "unknown";
      eventsCode[eventName] =
        `(facts) => {\n    facts.state = '${toState}';\n  }`;
    } else {
      const cases = [...transitions.entries()]
        .map(
          ([from, to]) => `      case '${from}': facts.state = '${to}'; break;`,
        )
        .join("\n");
      eventsCode[eventName] =
        `(facts) => {\n    switch (facts.state) {\n${cases}\n    }\n  }`;
    }
  }

  // Generate init code
  const initLines = [`    facts.state = '${config.initial}';`];
  if (config.context) {
    for (const [key, value] of Object.entries(config.context)) {
      initLines.push(`    facts.${key} = ${JSON.stringify(value)};`);
    }
  }
  const initCode = `(facts) => {\n${initLines.join("\n")}\n  }`;

  return {
    name: config.id,
    facts,
    derivations,
    events,
    requirements: {},
    initCode,
    deriveCode,
    eventsCode,
  };
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate Directive module code from a structure.
 */
export function generateModuleCode(
  structure: DirectiveModuleStructure,
): string {
  const lines: string[] = [
    `import { createModule, t } from '@directive-run/core';`,
    "",
    `const ${structure.name}Module = createModule('${structure.name}', {`,
    "  schema: {",
    "    facts: {",
  ];

  // Facts
  for (const [key, type] of Object.entries(structure.facts)) {
    lines.push(`      ${key}: ${type},`);
  }
  lines.push("    },");

  // Derivations
  lines.push("    derivations: {");
  for (const [key, type] of Object.entries(structure.derivations)) {
    lines.push(`      ${key}: ${type},`);
  }
  lines.push("    },");

  // Events
  lines.push("    events: {");
  for (const [key, schema] of Object.entries(structure.events)) {
    const schemaStr = Object.entries(schema)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`      ${key}: { ${schemaStr} },`);
  }
  lines.push("    },");

  // Requirements
  lines.push("    requirements: {},");
  lines.push("  },");

  // Init
  lines.push(`  init: ${structure.initCode},`);

  // Derive
  if (Object.keys(structure.deriveCode).length > 0) {
    lines.push("  derive: {");
    for (const [key, code] of Object.entries(structure.deriveCode)) {
      lines.push(`    ${key}: ${code},`);
    }
    lines.push("  },");
  }

  // Events handlers
  lines.push("  events: {");
  for (const [key, code] of Object.entries(structure.eventsCode)) {
    lines.push(`    ${key}: ${code},`);
  }
  lines.push("  },");

  lines.push("});");
  lines.push("");
  lines.push(`export { ${structure.name}Module };`);

  return lines.join("\n");
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Infer a t.* type string from a JavaScript value.
 */
function inferTypeString(value: unknown): string {
  if (value === null) return "t.object().nullable()";
  if (value === undefined) return "t.object().optional()";

  switch (typeof value) {
    case "number":
      return "t.number()";
    case "string":
      return "t.string()";
    case "boolean":
      return "t.boolean()";
    case "object":
      if (Array.isArray(value)) {
        return "t.array(t.object())";
      }
      return "t.object()";
    default:
      return "t.object()";
  }
}

/**
 * Capitalize first letter.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// Migration Checklist Generator
// ============================================================================

/**
 * Generate a migration checklist for a given state management pattern.
 */
export function generateMigrationChecklist(
  source: "redux" | "zustand" | "xstate",
): string[] {
  const common = [
    "[ ] Install directive: pnpm add directive",
    "[ ] Create module file(s) for your state",
    "[ ] Define schema with facts, derivations, events",
    "[ ] Implement init function for initial state",
    "[ ] Implement event handlers",
    "[ ] Update imports in consuming code",
    "[ ] Test the new implementation",
    "[ ] Remove old state management code",
  ];

  const sourceSpecific: Record<string, string[]> = {
    redux: [
      "[ ] Convert reducers to event handlers",
      "[ ] Convert selectors to derivations",
      "[ ] Convert thunks to constraints + resolvers",
      "[ ] Update useSelector to useDerived",
      "[ ] Update useDispatch to system.dispatch",
    ],
    zustand: [
      "[ ] Convert store state to facts",
      "[ ] Convert store actions to events",
      "[ ] Convert computed getters to derivations",
      "[ ] Update useStore hooks to useDirective hooks",
    ],
    xstate: [
      "[ ] Convert machine states to a 'state' fact",
      "[ ] Convert state checks to derivations (isActive, etc.)",
      "[ ] Convert events to Directive events",
      "[ ] Convert guards to constraint 'when' conditions",
      "[ ] Convert services/actors to constraints + resolvers",
      "[ ] Update useMachine to useDirective hooks",
    ],
  };

  const specific = sourceSpecific[source] ?? [];
  return [...specific, ...common];
}
