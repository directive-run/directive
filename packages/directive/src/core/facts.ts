/**
 * Facts Store - Proxy-based reactive state with auto-tracking
 *
 * Features:
 * - Proxy-based access (facts.phase instead of facts.get("phase"))
 * - Automatic dependency tracking via tracking context
 * - Batched updates with coalesced notifications
 * - Granular subscriptions by key
 * - Schema validation in development mode
 */

import { trackAccess, withoutTracking } from "./tracking.js";
import type {
	Facts,
	FactsSnapshot,
	FactsStore,
	InferSchema,
	Schema,
	SchemaType,
} from "./types.js";

// ============================================================================
// Schema Type Builders
// ============================================================================

/** Brand symbol for branded types */
declare const Brand: unique symbol;

/** Branded type - adds a unique brand to a base type */
export type Branded<T, B extends string> = T & { readonly [Brand]: B };

/** Extended SchemaType with type name for better error messages */
export interface ExtendedSchemaType<T> extends SchemaType<T> {
	readonly _typeName?: string;
	readonly _default?: T | (() => T);
	readonly _transform?: (value: unknown) => T;
	readonly _description?: string;
	readonly _refinements?: Array<{ predicate: (value: T) => boolean; message: string }>;
	/** Mutable - set by array validators to indicate which element failed */
	_lastFailedIndex?: number;
}

/** Safely stringify a value for error messages */
function safeStringify(value: unknown, maxLength = 100): string {
	try {
		return JSON.stringify(value)?.slice(0, maxLength) ?? String(value);
	} catch {
		return "[circular or non-serializable]";
	}
}

/** Track types that have already warned to avoid spam */
const warnedTypes = new Set<string>();

/** Create a schema type builder with optional type name */
function createSchemaType<T>(
	validators: Array<(v: T) => boolean> = [],
	typeName?: string,
	defaultValue?: T | (() => T),
	transform?: (value: unknown) => T,
	description?: string,
	refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
): ExtendedSchemaType<T> {
	return {
		_type: undefined as unknown as T,
		_validators: validators,
		_typeName: typeName,
		_default: defaultValue,
		_transform: transform,
		_description: description,
		_refinements: refinements,
		validate(fn: (value: T) => boolean) {
			return createSchemaType([...validators, fn], typeName, defaultValue, transform, description, refinements);
		},
	};
}

/** Chainable schema type with all common methods */
export interface ChainableSchemaType<T> extends ExtendedSchemaType<T> {
	default(value: T | (() => T)): ChainableSchemaType<T>;
	transform<U>(fn: (value: T) => U): ChainableSchemaType<U>;
	brand<B extends string>(): ChainableSchemaType<Branded<T, B>>;
	describe(description: string): ChainableSchemaType<T>;
	refine(predicate: (value: T) => boolean, message: string): ChainableSchemaType<T>;
	nullable(): ChainableSchemaType<T | null>;
	optional(): ChainableSchemaType<T | undefined>;
}

/** Create a chainable schema type with common methods */
function createChainableType<T>(
	validators: Array<(v: T) => boolean>,
	typeName: string,
	defaultValue?: T | (() => T),
	transform?: (value: unknown) => T,
	description?: string,
	refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
): ChainableSchemaType<T> {
	const base = createSchemaType<T>(validators, typeName, defaultValue, transform, description, refinements);
	return {
		...base,
		default(value: T | (() => T)) {
			return createChainableType(validators, typeName, value, transform, description, refinements);
		},
		transform<U>(fn: (value: T) => U) {
			const newTransform = (v: unknown) => {
				const intermediate = transform ? transform(v) : v as T;
				return fn(intermediate);
			};
			return createChainableType<U>([], typeName, undefined, newTransform as (v: unknown) => U, description);
		},
		brand<B extends string>() {
			return createChainableType<Branded<T, B>>(
				validators as Array<(v: Branded<T, B>) => boolean>,
				`Branded<${typeName}>`,
				defaultValue as Branded<T, B> | (() => Branded<T, B>),
				transform as (value: unknown) => Branded<T, B>,
				description,
				refinements as Array<{ predicate: (value: Branded<T, B>) => boolean; message: string }>,
			);
		},
		describe(desc: string) {
			return createChainableType(validators, typeName, defaultValue, transform, desc, refinements);
		},
		refine(predicate: (value: T) => boolean, message: string) {
			const newRefinements = [...(refinements ?? []), { predicate, message }];
			return createChainableType(
				[...validators, predicate],
				typeName,
				defaultValue,
				transform,
				description,
				newRefinements,
			);
		},
		nullable() {
			return createChainableType<T | null>(
				[(v): v is T | null => v === null || validators.every(fn => fn(v as T))],
				`${typeName} | null`,
				defaultValue as (T | null) | (() => T | null),
				transform as (value: unknown) => T | null,
				description,
			);
		},
		optional() {
			return createChainableType<T | undefined>(
				[(v): v is T | undefined => v === undefined || validators.every(fn => fn(v as T))],
				`${typeName} | undefined`,
				defaultValue as (T | undefined) | (() => T | undefined),
				transform as (value: unknown) => T | undefined,
				description,
			);
		},
	};
}

/**
 * Schema type builders for defining fact types.
 *
 * @example
 * ```typescript
 * const module = createModule("example", {
 *   schema: {
 *     name: t.string(),
 *     age: t.number().min(0).max(150),
 *     active: t.boolean(),
 *     tags: t.array<string>().of(t.string()),
 *     user: t.object<{ id: string; email: string }>(),
 *   },
 * });
 * ```
 */
export const t = {
	/**
	 * Create a string schema type.
	 *
	 * @example
	 * ```typescript
	 * // Basic string
	 * schema: { name: t.string() }
	 *
	 * // String literal union (for type safety)
	 * schema: { phase: t.string<"red" | "green" | "yellow">() }
	 *
	 * // With custom validation
	 * schema: { email: t.string().validate(s => s.includes("@")) }
	 *
	 * // With transform
	 * schema: { trimmed: t.string().transform(s => s.trim()) }
	 *
	 * // With brand
	 * schema: { userId: t.string().brand<"UserId">() }
	 * ```
	 */
	string<T extends string = string>() {
		return createChainableType<T>([
			(v): v is T => typeof v === "string",
		], "string") as ChainableSchemaType<T>;
	},

	/**
	 * Create a number schema type with optional min/max constraints.
	 *
	 * @example
	 * ```typescript
	 * // Basic number
	 * schema: { count: t.number() }
	 *
	 * // With range constraints
	 * schema: { age: t.number().min(0).max(150) }
	 *
	 * // With custom validation
	 * schema: { even: t.number().validate(n => n % 2 === 0) }
	 *
	 * // With default
	 * schema: { count: t.number().default(0) }
	 *
	 * // With transform (from string)
	 * schema: { age: t.number().transform(v => parseInt(String(v), 10)) }
	 * ```
	 */
	number() {
		type ChainableNumber = ChainableSchemaType<number> & {
			min(n: number): ChainableNumber;
			max(n: number): ChainableNumber;
		};

		const createChainableNumber = (
			validators: Array<(v: number) => boolean>,
			defaultValue?: number | (() => number),
			transform?: (value: unknown) => number,
			description?: string,
			refinements?: Array<{ predicate: (value: number) => boolean; message: string }>,
		): ChainableNumber => {
			const chainable = createChainableType<number>(validators, "number", defaultValue, transform, description, refinements);
			return {
				...chainable,
				min(n: number) {
					return createChainableNumber([...validators, (v) => v >= n], defaultValue, transform, description, refinements);
				},
				max(n: number) {
					return createChainableNumber([...validators, (v) => v <= n], defaultValue, transform, description, refinements);
				},
				default(value: number | (() => number)) {
					return createChainableNumber(validators, value, transform, description, refinements);
				},
				describe(desc: string) {
					return createChainableNumber(validators, defaultValue, transform, desc, refinements);
				},
				refine(predicate: (value: number) => boolean, message: string) {
					const newRefinements = [...(refinements ?? []), { predicate, message }];
					return createChainableNumber([...validators, predicate], defaultValue, transform, description, newRefinements);
				},
			};
		};
		return createChainableNumber([(v) => typeof v === "number"]);
	},

	/**
	 * Create a boolean schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: {
	 *   active: t.boolean(),
	 *   verified: t.boolean().default(false),
	 * }
	 * ```
	 */
	boolean() {
		return createChainableType<boolean>([(v) => typeof v === "boolean"], "boolean");
	},

	/**
	 * Create an array schema type.
	 * Can be used with or without element validation:
	 * - `t.array<string>()` - Type-only, no element validation
	 * - `t.array<string>().of(t.string())` - With element validation
	 */
	array<T>() {
		type ChainableArray = ChainableSchemaType<T[]> & {
			of(elementType: SchemaType<T>): ChainableArray;
			nonEmpty(): ChainableArray;
			maxLength(n: number): ChainableArray;
			minLength(n: number): ChainableArray;
			_lastFailedIndex?: number;
		};

		const createChainableArray = (
			validators: Array<(v: T[]) => boolean>,
			elementType?: SchemaType<T>,
			defaultValue?: T[] | (() => T[]),
			description?: string,
			indexRef?: { value: number },
		): ChainableArray => {
			const chainable = createChainableType<T[]>(validators, "array", defaultValue, undefined, description);
			// Use ref for storing failed index (shared with validator closure)
			const ref = indexRef ?? { value: -1 };
			const result: ChainableArray = {
				...chainable,
				get _lastFailedIndex() { return ref.value; },
				set _lastFailedIndex(v: number) { ref.value = v; },
				of(et: SchemaType<T>) {
					// Create a new ref for this chain
					const newRef = { value: -1 };
					return createChainableArray([
						...validators,
						(v) => {
							for (let i = 0; i < v.length; i++) {
								const item = v[i];
								if (!et._validators.every((validator) => validator(item))) {
									newRef.value = i;
									return false;
								}
							}
							return true;
						},
					], et, defaultValue, description, newRef);
				},
				nonEmpty() {
					return createChainableArray([...validators, (v) => v.length > 0], elementType, defaultValue, description, ref);
				},
				maxLength(n: number) {
					return createChainableArray([...validators, (v) => v.length <= n], elementType, defaultValue, description, ref);
				},
				minLength(n: number) {
					return createChainableArray([...validators, (v) => v.length >= n], elementType, defaultValue, description, ref);
				},
				default(value: T[] | (() => T[])) {
					return createChainableArray(validators, elementType, value, description, ref);
				},
				describe(desc: string) {
					return createChainableArray(validators, elementType, defaultValue, desc, ref);
				},
			};
			return result;
		};
		return createChainableArray([(v) => Array.isArray(v)]);
	},

	/**
	 * Create an object schema type.
	 * Can be used with or without shape validation:
	 * - `t.object<User>()` - Type-only, no property validation
	 * - `t.object<User>().shape({ name: t.string(), age: t.number() })` - With property validation
	 */
	object<T extends Record<string, unknown>>() {
		type ChainableObject = ChainableSchemaType<T> & {
			shape(schema: { [K in keyof T]?: SchemaType<T[K]> }): ChainableObject;
			nonNull(): ChainableObject;
			hasKeys(...keys: string[]): ChainableObject;
		};

		const createChainableObject = (
			validators: Array<(v: T) => boolean>,
			defaultValue?: T | (() => T),
			description?: string,
		): ChainableObject => {
			const chainable = createChainableType<T>(validators, "object", defaultValue, undefined, description);
			return {
				...chainable,
				shape(shapeSchema: { [K in keyof T]?: SchemaType<T[K]> }) {
					return createChainableObject([
						...validators,
						(v) => {
							for (const [key, schemaType] of Object.entries(shapeSchema)) {
								const value = (v as Record<string, unknown>)[key];
								const schemaT = schemaType as SchemaType<unknown>;
								if (schemaT && !schemaT._validators.every((validator) => validator(value))) {
									return false;
								}
							}
							return true;
						},
					], defaultValue, description);
				},
				nonNull() {
					return createChainableObject([...validators, (v) => v !== null && v !== undefined], defaultValue, description);
				},
				hasKeys(...keys: string[]) {
					return createChainableObject([
						...validators,
						(v) => keys.every((k) => k in (v as Record<string, unknown>)),
					], defaultValue, description);
				},
				default(value: T | (() => T)) {
					return createChainableObject(validators, value, description);
				},
				describe(desc: string) {
					return createChainableObject(validators, defaultValue, desc);
				},
			};
		};
		return createChainableObject([
			(v) => typeof v === "object" && v !== null && !Array.isArray(v),
		]);
	},

	/**
	 * Create an any-typed schema (bypasses all validation).
	 *
	 * @deprecated Use specific types (`t.string()`, `t.object()`, `t.union()`) for type safety.
	 * This bypasses all runtime validation.
	 *
	 * @example
	 * ```typescript
	 * // Use when type is complex or external
	 * schema: {
	 *   externalApiResponse: t.any<ExternalAPIResponse>(),
	 * }
	 * ```
	 */
	any<T>() {
		if (process.env.NODE_ENV !== "production" && !warnedTypes.has("any")) {
			warnedTypes.add("any");
			console.warn(
				"[Directive] t.any() bypasses runtime validation. " +
				"Consider using t.object<T>(), t.union(), or a Zod schema for type safety."
			);
		}
		return createSchemaType<T>([], "any");
	},

	/**
	 * Create an enum schema type for string literal unions.
	 *
	 * @example
	 * ```typescript
	 * // Define allowed values
	 * schema: { status: t.enum("idle", "loading", "success", "error") }
	 *
	 * // Type is inferred as "idle" | "loading" | "success" | "error"
	 * ```
	 */
	enum<T extends string>(...values: T[]) {
		if (process.env.NODE_ENV !== "production" && values.length === 0) {
			console.warn("[Directive] t.enum() called with no values - this will reject all strings");
		}
		const valueSet = new Set(values);
		return createChainableType<T>([
			(v): v is T => typeof v === "string" && valueSet.has(v as T),
		], `enum(${values.join("|")})`);
	},

	/**
	 * Create a literal schema type for exact value matching.
	 *
	 * @example
	 * ```typescript
	 * // Exact string match
	 * schema: { type: t.literal("user") }
	 *
	 * // Exact number match
	 * schema: { version: t.literal(1) }
	 *
	 * // Exact boolean
	 * schema: { enabled: t.literal(true) }
	 * ```
	 */
	literal<T extends string | number | boolean>(value: T) {
		return createChainableType<T>([
			(v): v is T => v === value,
		], `literal(${String(value)})`);
	},

	/**
	 * Create a nullable schema type (T | null).
	 *
	 * @example
	 * ```typescript
	 * // Nullable string
	 * schema: { name: t.nullable(t.string()) }
	 *
	 * // Nullable object
	 * schema: { user: t.nullable(t.object<User>()) }
	 * ```
	 */
	nullable<T>(innerType: SchemaType<T>) {
		const innerTypeName = (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
		return createSchemaType<T | null>([
			(v): v is T | null => {
				if (v === null) return true;
				return innerType._validators.every((validator) => validator(v as T));
			},
		], `${innerTypeName} | null`) as SchemaType<T | null>;
	},

	/**
	 * Create an optional schema type (T | undefined).
	 *
	 * @example
	 * ```typescript
	 * // Optional string
	 * schema: { nickname: t.optional(t.string()) }
	 *
	 * // Optional number
	 * schema: { age: t.optional(t.number()) }
	 * ```
	 */
	optional<T>(innerType: SchemaType<T>) {
		const innerTypeName = (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
		return createSchemaType<T | undefined>([
			(v): v is T | undefined => {
				if (v === undefined) return true;
				return innerType._validators.every((validator) => validator(v as T));
			},
		], `${innerTypeName} | undefined`) as SchemaType<T | undefined>;
	},

	/**
	 * Create a union schema type.
	 *
	 * @example
	 * ```typescript
	 * // String or number
	 * schema: { value: t.union(t.string(), t.number()) }
	 *
	 * // Multiple types
	 * schema: { data: t.union(t.string(), t.number(), t.boolean()) }
	 * ```
	 */
	union<T extends SchemaType<unknown>[]>(...types: T) {
		if (process.env.NODE_ENV !== "production" && types.length === 0) {
			console.warn("[Directive] t.union() called with no types - this will reject all values");
		}
		type UnionType = T[number] extends SchemaType<infer U> ? U : never;
		const typeNames = types.map(schemaType => (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown");
		return createChainableType<UnionType>([
			(v): v is UnionType => types.some(schemaType => schemaType._validators.every(fn => fn(v))),
		], typeNames.join(" | "));
	},

	/**
	 * Create a record schema type for dynamic key-value maps.
	 *
	 * @example
	 * ```typescript
	 * // Record with string values
	 * schema: { metadata: t.record(t.string()) }
	 *
	 * // Record with number values
	 * schema: { scores: t.record(t.number()) }
	 * ```
	 */
	record<V>(valueType: SchemaType<V>) {
		const valueTypeName = (valueType as ExtendedSchemaType<V>)._typeName ?? "unknown";
		return createChainableType<Record<string, V>>([
			(v): v is Record<string, V> => {
				if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
				return Object.values(v).every(val =>
					valueType._validators.every(validator => validator(val))
				);
			},
		], `Record<string, ${valueTypeName}>`);
	},

	/**
	 * Create a tuple schema type for fixed-length arrays with specific types.
	 *
	 * @example
	 * ```typescript
	 * // [string, number] tuple
	 * schema: { coord: t.tuple(t.string(), t.number()) }
	 *
	 * // [x, y, z] coordinates
	 * schema: { position: t.tuple(t.number(), t.number(), t.number()) }
	 * ```
	 */
	tuple<T extends SchemaType<unknown>[]>(...types: T) {
		if (process.env.NODE_ENV !== "production" && types.length === 0) {
			console.warn("[Directive] t.tuple() called with no types - this will only accept empty arrays");
		}
		type TupleType = { [K in keyof T]: T[K] extends SchemaType<infer U> ? U : never };
		const typeNames = types.map(schemaType => (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown");
		return createChainableType<TupleType>([
			(v): v is TupleType => {
				if (!Array.isArray(v) || v.length !== types.length) return false;
				return types.every((schemaType, i) =>
					schemaType._validators.every(validator => validator(v[i]))
				);
			},
		], `[${typeNames.join(", ")}]`);
	},

	/**
	 * Create a date schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: { createdAt: t.date() }
	 * ```
	 */
	date() {
		return createChainableType<Date>([
			(v): v is Date => v instanceof Date && !isNaN(v.getTime()),
		], "Date");
	},

	/**
	 * Create a UUID schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: { id: t.uuid() }
	 * ```
	 */
	uuid() {
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		return createChainableType<string>([
			(v): v is string => typeof v === "string" && uuidRegex.test(v),
		], "uuid");
	},

	/**
	 * Create an email schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: { email: t.email() }
	 * ```
	 */
	email() {
		// Simple email regex - for comprehensive validation use Zod
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return createChainableType<string>([
			(v): v is string => typeof v === "string" && emailRegex.test(v),
		], "email");
	},

	/**
	 * Create a URL schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: { website: t.url() }
	 * ```
	 */
	url() {
		return createChainableType<string>([
			(v): v is string => {
				if (typeof v !== "string") return false;
				try {
					new URL(v);
					return true;
				} catch {
					return false;
				}
			},
		], "url");
	},

	/**
	 * Create a bigint schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: { largeNumber: t.bigint() }
	 * ```
	 */
	bigint() {
		return createChainableType<bigint>([
			(v): v is bigint => typeof v === "bigint",
		], "bigint");
	},
};

// ============================================================================
// Facts Store Implementation
// ============================================================================

/** Options for creating a facts store */
export interface CreateFactsStoreOptions<S extends Schema> {
	schema: S;
	/** Validate values against schema (default: process.env.NODE_ENV !== 'production') */
	validate?: boolean;
	/** Throw on unknown schema keys (default: true in dev mode) */
	strictKeys?: boolean;
	/** Redact sensitive values in error messages */
	redactErrors?: boolean;
	/** Callback when facts change (for plugin hooks) */
	onChange?: (key: string, value: unknown, prev: unknown) => void;
	/** Callback for batch changes */
	onBatch?: (changes: Array<{ key: string; value: unknown; prev: unknown; type: "set" | "delete" }>) => void;
}

/**
 * Create a facts store with the given schema.
 */
export function createFactsStore<S extends Schema>(
	options: CreateFactsStoreOptions<S>,
): FactsStore<S> {
	const { schema, onChange, onBatch } = options;

	// Detect if this is a type assertion schema (empty object with no keys)
	const schemaKeys = Object.keys(schema);
	const isTypeAssertionSchema = schemaKeys.length === 0;

	// Default strictKeys to false for type assertion schemas (they have no runtime keys)
	const validate = options.validate ?? process.env.NODE_ENV !== "production";
	const strictKeys = options.strictKeys ?? (process.env.NODE_ENV !== "production" && !isTypeAssertionSchema);
	const redactErrors = options.redactErrors ?? false;

	const map = new Map<string, unknown>();
	const knownKeys = new Set<string>(); // Track all keys that have been set
	const keyListeners = new Map<string, Set<() => void>>();
	const allListeners = new Set<() => void>();

	let batching = 0;
	const batchChanges: Array<{ key: string; value: unknown; prev: unknown; type: "set" | "delete" }> = [];
	const dirtyKeys = new Set<string>();

	/** Check if a value is a Zod schema (robust detection) */
	function isZodSchema(v: unknown): v is { safeParse: (v: unknown) => { success: boolean; error?: { message?: string; issues?: Array<{ message: string }> } }; _def: unknown; parse: unknown } {
		return (
			v !== null &&
			typeof v === "object" &&
			"safeParse" in v && typeof (v as Record<string, unknown>).safeParse === "function" &&
			"_def" in v &&
			"parse" in v && typeof (v as Record<string, unknown>).parse === "function"
		);
	}

	/** Get expected type name from schema */
	function getExpectedType(schemaType: unknown): string {
		// Check for our SchemaType with _typeName
		const st = schemaType as { _typeName?: string };
		if (st._typeName) return st._typeName;

		// Check for Zod schema
		if (isZodSchema(schemaType)) {
			const def = (schemaType as { _def?: { typeName?: string } })._def;
			if (def?.typeName) {
				// Convert ZodString -> string, ZodNumber -> number, etc.
				return def.typeName.replace(/^Zod/, "").toLowerCase();
			}
		}

		return "unknown";
	}

	/** Format value for error message, respecting redactErrors option */
	function formatValueForError(value: unknown): string {
		if (redactErrors) return "[redacted]";
		return safeStringify(value);
	}

	/** Validate a value against the schema */
	function validateValue(key: string, value: unknown): void {
		if (!validate) return;

		const schemaType = schema[key];
		if (!schemaType) {
			if (strictKeys) {
				throw new Error(`[Directive] Unknown fact key: "${key}". Key not defined in schema.`);
			}
			console.warn(`[Directive] Unknown fact key: "${key}"`);
			return;
		}

		// Check for Zod schema (robust detection: safeParse + _def + parse)
		if (isZodSchema(schemaType)) {
			const result = schemaType.safeParse(value);
			if (!result.success) {
				const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
				const valuePreview = formatValueForError(value);
				// Extract error message safely from Zod error structure
				const errorMessage = result.error?.message
					?? result.error?.issues?.[0]?.message
					?? "Validation failed";
				const expectedType = getExpectedType(schemaType);
				throw new Error(
					`[Directive] Validation failed for "${key}": expected ${expectedType}, got ${valueType} ${valuePreview}. ${errorMessage}`,
				);
			}
			return;
		}

		// Check for our SchemaType (has _validators array)
		const st = schemaType as { _validators?: unknown; _typeName?: string; _lastFailedIndex?: number };
		const validators = st._validators;

		// Ensure validators is an array before iterating
		if (!validators || !Array.isArray(validators) || validators.length === 0) {
			return; // type assertion or empty validators - no validation
		}

		const expectedType = st._typeName ?? "unknown";

		for (let i = 0; i < validators.length; i++) {
			const validator = validators[i];
			if (typeof validator !== "function") continue;

			if (!validator(value as never)) {
				const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
				const valuePreview = formatValueForError(value);

				// Check for array index failure from schema type
				let indexHint = "";
				if (typeof st._lastFailedIndex === "number" && st._lastFailedIndex >= 0) {
					indexHint = ` (element at index ${st._lastFailedIndex} failed)`;
					st._lastFailedIndex = -1; // Reset for next validation
				}

				// Include expected type in error message
				const validatorHint = i === 0 ? "" : ` (validator ${i + 1} failed)`;
				throw new Error(
					`[Directive] Validation failed for "${key}": expected ${expectedType}, got ${valueType} ${valuePreview}${validatorHint}${indexHint}`,
				);
			}
		}
	}

	/** Notify listeners for a specific key */
	function notifyKey(key: string): void {
		keyListeners.get(key)?.forEach((listener) => listener());
	}

	/** Notify all listeners */
	function notifyAll(): void {
		allListeners.forEach((listener) => listener());
	}

	/** Flush batched changes and notify */
	function flush(): void {
		if (batching > 0) return;

		// Notify batch callback
		if (onBatch && batchChanges.length > 0) {
			onBatch([...batchChanges]);
		}

		// Notify key-specific listeners
		for (const key of dirtyKeys) {
			notifyKey(key);
		}

		// Notify all listeners once
		if (dirtyKeys.size > 0) {
			notifyAll();
		}

		// Clear batch state
		batchChanges.length = 0;
		dirtyKeys.clear();
	}

	const store: FactsStore<S> = {
		get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined {
			// Track access for auto-tracking
			trackAccess(key as string);
			return map.get(key as string) as InferSchema<S>[K] | undefined;
		},

		has(key: keyof InferSchema<S>): boolean {
			// Track access for auto-tracking
			trackAccess(key as string);
			return map.has(key as string);
		},

		set<K extends keyof InferSchema<S>>(key: K, value: InferSchema<S>[K]): void {
			validateValue(key as string, value);

			const prev = map.get(key as string);
			map.set(key as string, value);
			knownKeys.add(key as string); // Track known keys for serialization

			// Record change
			if (batching > 0) {
				batchChanges.push({ key: key as string, value, prev, type: "set" });
				dirtyKeys.add(key as string);
			} else {
				onChange?.(key as string, value, prev);
				notifyKey(key as string);
				notifyAll();
			}
		},

		delete(key: keyof InferSchema<S>): void {
			const prev = map.get(key as string);
			map.delete(key as string);
			knownKeys.delete(key as string); // Remove from known keys

			// Record change
			if (batching > 0) {
				batchChanges.push({ key: key as string, value: undefined, prev, type: "delete" });
				dirtyKeys.add(key as string);
			} else {
				onChange?.(key as string, undefined, prev);
				notifyKey(key as string);
				notifyAll();
			}
		},

		batch(fn: () => void): void {
			batching++;
			try {
				fn();
			} finally {
				batching--;
				flush();
			}
		},

		subscribe(
			keys: Array<keyof InferSchema<S>>,
			listener: () => void,
		): () => void {
			for (const key of keys) {
				const keyStr = key as string;
				if (!keyListeners.has(keyStr)) {
					keyListeners.set(keyStr, new Set());
				}
				keyListeners.get(keyStr)!.add(listener);
			}

			return () => {
				for (const key of keys) {
					keyListeners.get(key as string)?.delete(listener);
				}
			};
		},

		subscribeAll(listener: () => void): () => void {
			allListeners.add(listener);
			return () => allListeners.delete(listener);
		},

		toObject(): Record<string, unknown> {
			const result: Record<string, unknown> = {};
			for (const key of knownKeys) {
				if (map.has(key)) {
					result[key] = map.get(key);
				}
			}
			return result;
		},
	};

	return store;
}

// ============================================================================
// Proxy-based Facts Accessor
// ============================================================================

/** Prototype pollution guard - prevent access to dangerous properties */
const BLOCKED_PROPS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));

/**
 * Create a proxy-based facts accessor.
 * Allows clean syntax: facts.phase instead of facts.get("phase")
 */
export function createFactsProxy<S extends Schema>(
	store: FactsStore<S>,
	schema: S,
): Facts<S> {
	const schemaKeys = Object.keys(schema);
	const snapshot = (): FactsSnapshot<S> => ({
		get: <K extends keyof InferSchema<S>>(key: K) =>
			withoutTracking(() => store.get(key)),
		has: (key: keyof InferSchema<S>) =>
			withoutTracking(() => store.has(key)),
	});

	const proxy = new Proxy({} as Facts<S>, {
		get(_, prop: string | symbol) {
			if (prop === "$store") return store;
			if (prop === "$snapshot") return snapshot;

			// Special properties
			if (typeof prop === "symbol") return undefined;

			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return undefined;

			// Track and return the value
			return store.get(prop as keyof InferSchema<S>);
		},

		set(_, prop: string | symbol, value: unknown) {
			if (typeof prop === "symbol") return false;
			if (prop === "$store" || prop === "$snapshot") return false;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return false;

			// Validation is handled by store.set() when validate option is enabled
			store.set(prop as keyof InferSchema<S>, value as InferSchema<S>[keyof InferSchema<S>]);
			return true;
		},

		deleteProperty(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			if (prop === "$store" || prop === "$snapshot") return false;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return false;

			store.delete(prop as keyof InferSchema<S>);
			return true;
		},

		has(_, prop: string | symbol) {
			if (prop === "$store" || prop === "$snapshot") return true;
			if (typeof prop === "symbol") return false;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return false;

			return store.has(prop as keyof InferSchema<S>);
		},

		ownKeys() {
			// Return schema keys so Object.keys(facts) works
			return schemaKeys;
		},

		getOwnPropertyDescriptor(_, prop: string | symbol) {
			if (prop === "$store" || prop === "$snapshot") {
				return { configurable: true, enumerable: false, writable: false };
			}
			return { configurable: true, enumerable: true, writable: true };
		},
	});

	return proxy;
}

// ============================================================================
// Combined Factory
// ============================================================================

/**
 * Create facts store and proxy together.
 */
export function createFacts<S extends Schema>(
	options: CreateFactsStoreOptions<S>,
): { store: FactsStore<S>; facts: Facts<S> } {
	const store = createFactsStore(options);
	const facts = createFactsProxy(store, options.schema);
	return { store, facts };
}
