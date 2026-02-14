/**
 * Event Types - Type definitions for events and event handlers
 */

import type {
	Schema,
	SchemaType,
	ModuleSchema,
	EventsSchema,
	InferEventPayloadFromSchema,
	InferEvents,
} from "./schema.js";
import type { Facts } from "./facts.js";

// ============================================================================
// Legacy Event Schema Types (for backwards compatibility)
// ============================================================================

/**
 * @deprecated Use EventPayloadSchema from schema.ts
 */
export type LegacyEventPayloadSchema = Record<string, SchemaType<unknown>>;

/**
 * @deprecated Use TypedEventsDef from module.ts
 */
export interface TypedEventDef<
	S extends Schema,
	P extends LegacyEventPayloadSchema = LegacyEventPayloadSchema,
> {
	payload: P;
	handler: (facts: Facts<S>, event: InferLegacyEventPayload<P>) => void;
}

/**
 * @deprecated Use InferEventPayloadFromSchema from schema.ts
 */
export type InferLegacyEventPayload<P extends LegacyEventPayloadSchema> = {
	[K in keyof P]: P[K] extends SchemaType<infer T> ? T : never;
};

/**
 * @deprecated Use InferEventPayloadFromSchema from schema.ts
 */
export type InferEventPayload<P extends LegacyEventPayloadSchema> = InferLegacyEventPayload<P>;

/**
 * @deprecated Use TypedEventsDef from module.ts
 */
export type TypedEventsDef<S extends Schema> = Record<
	string,
	TypedEventDef<S, LegacyEventPayloadSchema>
>;

/**
 * @deprecated Use InferEvents from schema.ts
 */
export type InferEventsFromDef<E extends TypedEventsDef<Schema>> = {
	[K in keyof E]: { type: K } & InferLegacyEventPayload<E[K]["payload"]>;
}[keyof E];

// ============================================================================
// Schema-Based Event Types (New)
// ============================================================================

/** Helper to get events schema, defaulting to empty */
type GetEventsSchema<M extends ModuleSchema> = M["events"] extends EventsSchema ? M["events"] : Record<string, never>;

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
// Inline Event Handler Types (Legacy - for backwards compatibility)
// ============================================================================

/**
 * Extract the payload type from an inline event handler function.
 *
 * @deprecated Use TypedEventsDef from module.ts with schema
 */
export type ExtractEventPayload<F> = F extends (
	facts: Facts<infer _S>,
	payload: infer P,
) => void
	? P extends void | undefined
		? never
		: P
	: never;

/**
 * Check if an event handler has a payload parameter.
 *
 * @deprecated Use schema-based events
 */
export type HasEventPayload<F> = ExtractEventPayload<F> extends never ? false : true;

/**
 * Inline event handler definition.
 *
 * @deprecated Use TypedEventsDef from module.ts with schema
 */
export type InlineEventHandler<S extends Schema> = (
	// biome-ignore lint/suspicious/noExplicitAny: Need any for payload parameter flexibility
	facts: Facts<S>,
	// biome-ignore lint/suspicious/noExplicitAny: Need any for payload parameter flexibility
	payload?: any,
) => void;

/**
 * Inline events definition.
 *
 * @deprecated Use TypedEventsDef from module.ts with schema
 */
export type InlineEventsDef<S extends Schema> = Record<string, InlineEventHandler<S>>;

/**
 * Infer events from an inline events definition as a discriminated union.
 *
 * @deprecated Use InferEvents from schema.ts
 */
export type InferInlineEventsFromDef<E> = {
	[K in keyof E]: E[K] extends (...args: infer Args) => void
		? Args extends [infer _Facts, infer Payload]
			? Payload extends Record<string, unknown>
				? { type: K } & Payload
				: { type: K }
			: { type: K }
		: { type: K };
}[keyof E];

// ============================================================================
// System Event Types
// ============================================================================

/** System event */
export interface SystemEvent {
	type: string;
	[key: string]: unknown;
}

/** Event handler function - receives facts and the full event object */
export type EventHandler<S extends Schema> = (facts: Facts<S>, event: SystemEvent) => void;

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
export type EventsDef<S extends Schema> = Record<string, FlexibleEventHandler<S>>;
