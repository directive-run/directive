/**
 * Event Types - Type definitions for events and event handlers
 */

import type { Facts } from "./facts.js";
import type {
  EventsSchema,
  InferEventPayloadFromSchema,
  InferEvents,
  ModuleSchema,
  Schema,
} from "./schema.js";

// ============================================================================
// Schema-Based Event Types
// ============================================================================

/** Helper to get events schema, defaulting to empty */
type GetEventsSchema<M extends ModuleSchema> = M["events"] extends EventsSchema
  ? M["events"]
  : Record<string, never>;

/**
 * Events accessor type from a module schema.
 * Provides typed dispatch functions for each event.
 *
 * @example
 * ```typescript
 * type Accessor = EventsAccessorFromSchema<MySchema>;
 * // {
 * //   increment: () => void;
 * //   setPhase: (payload: { phase: "red" | "green" }) => void;
 * // }
 * ```
 */
export type EventsAccessorFromSchema<M extends ModuleSchema> = {
  readonly [K in keyof GetEventsSchema<M>]: keyof GetEventsSchema<M>[K] extends never
    ? () => void
    : (payload: InferEventPayloadFromSchema<GetEventsSchema<M>[K]>) => void;
};

/**
 * Dispatch events union type from a module schema.
 * Used for system.dispatch() type.
 */
export type DispatchEventsFromSchema<M extends ModuleSchema> = InferEvents<M>;

// ============================================================================
// System Event Types
// ============================================================================

/** System event */
export interface SystemEvent {
  type: string;
  [key: string]: unknown;
}

/** Event handler function - receives facts and the full event object */
export type EventHandler<S extends Schema> = (
  facts: Facts<S>,
  event: SystemEvent,
) => void;

/**
 * Flexible event handler that accepts either:
 * - Simple handler: `(facts) => void`
 * - Typed payload handler: `(facts, { field }: { field: Type }) => void`
 * - Generic handler: `(facts, event: SystemEvent) => void`
 */
export type FlexibleEventHandler<S extends Schema> = (
  facts: Facts<S>,
  // biome-ignore lint/suspicious/noExplicitAny: Need any for flexible payload types
  event?: any,
) => void;

/** Events definition - accepts any event handler signature */
export type EventsDef<S extends Schema> = Record<
  string,
  FlexibleEventHandler<S>
>;
