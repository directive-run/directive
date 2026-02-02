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

/** Create a schema type builder */
function createSchemaType<T>(validators: Array<(v: T) => boolean> = []): SchemaType<T> {
	return {
		_type: undefined as unknown as T,
		_validators: validators,
		validate(fn: (value: T) => boolean) {
			return createSchemaType([...validators, fn]);
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
	 * ```
	 */
	string<T extends string = string>() {
		return createSchemaType<T>([
			(v): v is T => typeof v === "string",
		]) as SchemaType<T>;
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
	 * ```
	 */
	number() {
		const createChainableNumber = (
			validators: Array<(v: number) => boolean>,
		): SchemaType<number> & {
			min(n: number): SchemaType<number> & { max(n: number): SchemaType<number> };
			max(n: number): SchemaType<number> & { min(n: number): SchemaType<number> };
		} => ({
			...createSchemaType<number>(validators),
			min(n: number) {
				return createChainableNumber([...validators, (v) => v >= n]);
			},
			max(n: number) {
				return createChainableNumber([...validators, (v) => v <= n]);
			},
		});
		return createChainableNumber([(v) => typeof v === "number"]);
	},

	/**
	 * Create a boolean schema type.
	 *
	 * @example
	 * ```typescript
	 * schema: {
	 *   active: t.boolean(),
	 *   verified: t.boolean(),
	 * }
	 * ```
	 */
	boolean() {
		return createSchemaType<boolean>([(v) => typeof v === "boolean"]);
	},
	/**
	 * Create an array schema type.
	 * Can be used with or without element validation:
	 * - `t.array<string>()` - Type-only, no element validation
	 * - `t.array<string>().of(t.string())` - With element validation
	 */
	array<T>() {
		const createChainableArray = (
			validators: Array<(v: T[]) => boolean>,
		): SchemaType<T[]> & {
			/** Validate each element with the given schema type */
			of(elementType: SchemaType<T>): SchemaType<T[]> & {
				nonEmpty(): SchemaType<T[]>;
				maxLength(n: number): SchemaType<T[]>;
				minLength(n: number): SchemaType<T[]>;
			};
			nonEmpty(): SchemaType<T[]>;
			maxLength(n: number): SchemaType<T[]>;
			minLength(n: number): SchemaType<T[]>;
		} => ({
			...createSchemaType<T[]>(validators),
			of(elementType: SchemaType<T>) {
				return createChainableArray([
					...validators,
					(v) =>
						v.every((item) =>
							elementType._validators.every((validator) => validator(item)),
						),
				]);
			},
			nonEmpty() {
				return createChainableArray([...validators, (v) => v.length > 0]);
			},
			maxLength(n: number) {
				return createChainableArray([...validators, (v) => v.length <= n]);
			},
			minLength(n: number) {
				return createChainableArray([...validators, (v) => v.length >= n]);
			},
		});
		return createChainableArray([(v) => Array.isArray(v)]);
	},
	/**
	 * Create an object schema type.
	 * Can be used with or without shape validation:
	 * - `t.object<User>()` - Type-only, no property validation
	 * - `t.object<User>().shape({ name: t.string(), age: t.number() })` - With property validation
	 */
	object<T extends Record<string, unknown>>() {
		const createChainableObject = (
			validators: Array<(v: T) => boolean>,
		): SchemaType<T> & {
			/** Validate object properties with the given schema */
			shape(schema: { [K in keyof T]?: SchemaType<T[K]> }): SchemaType<T>;
			nonNull(): SchemaType<T>;
			hasKeys(...keys: string[]): SchemaType<T>;
		} => ({
			...createSchemaType<T>(validators),
			shape(schema: { [K in keyof T]?: SchemaType<T[K]> }) {
				return createChainableObject([
					...validators,
					(v) => {
						for (const [key, schemaType] of Object.entries(schema)) {
							const value = (v as Record<string, unknown>)[key];
							const type = schemaType as SchemaType<unknown>;
							if (type && !type._validators.every((validator) => validator(value))) {
								return false;
							}
						}
						return true;
					},
				]);
			},
			nonNull() {
				return createChainableObject([...validators, (v) => v !== null && v !== undefined]);
			},
			hasKeys(...keys: string[]) {
				return createChainableObject([
					...validators,
					(v) => keys.every((k) => k in (v as Record<string, unknown>)),
				]);
			},
		});
		return createChainableObject([
			(v) => typeof v === "object" && v !== null && !Array.isArray(v),
		]);
	},
	/**
	 * Create an any-typed schema (bypasses all validation).
	 *
	 * **WARNING:** This bypasses all runtime validation. Use sparingly and only when:
	 * - The type is too complex to validate at runtime
	 * - You're handling external data with unknown structure
	 * - Performance is critical and validation overhead is unacceptable
	 *
	 * Prefer specific types (`t.string()`, `t.object()`, etc.) for type safety.
	 *
	 * @example
	 * ```typescript
	 * // Use when type is complex or external
	 * schema: {
	 *   externalApiResponse: t.any<ExternalAPIResponse>(),
	 *   complexUnion: t.any<string | number | { nested: boolean }>(),
	 * }
	 * ```
	 */
	any<T>() {
		return createSchemaType<T>([]);
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
	const { schema, validate = process.env.NODE_ENV !== "production", onChange, onBatch } = options;

	const map = new Map<string, unknown>();
	const knownKeys = new Set<string>(); // Track all keys that have been set
	const keyListeners = new Map<string, Set<() => void>>();
	const allListeners = new Set<() => void>();

	let batching = 0;
	const batchChanges: Array<{ key: string; value: unknown; prev: unknown; type: "set" | "delete" }> = [];
	const dirtyKeys = new Set<string>();

	/** Validate a value against the schema */
	function validateValue(key: string, value: unknown): void {
		if (!validate) return;

		const schemaType = schema[key];
		if (!schemaType) {
			console.warn(`[Directive] Unknown fact key: "${key}"`);
			return;
		}

		for (let i = 0; i < schemaType._validators.length; i++) {
			const validator = schemaType._validators[i]!;
			if (!validator(value as never)) {
				const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
				const valuePreview = JSON.stringify(value)?.slice(0, 100) ?? String(value);
				// Try to infer expected type from validator index
				const expectedHint = i === 0 ? " (type check failed)" : ` (validator ${i + 1} failed)`;
				throw new Error(
					`[Directive] Validation failed for "${key}"${expectedHint}: got ${valueType} ${valuePreview}`,
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
				result[key] = map.get(key);
			}
			return result;
		},
	};

	return store;
}

// ============================================================================
// Proxy-based Facts Accessor
// ============================================================================

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

			// Track and return the value
			return store.get(prop as keyof InferSchema<S>);
		},

		set(_, prop: string | symbol, value: unknown) {
			if (typeof prop === "symbol") return false;
			if (prop === "$store" || prop === "$snapshot") return false;

			store.set(prop as keyof InferSchema<S>, value as InferSchema<S>[keyof InferSchema<S>]);
			return true;
		},

		deleteProperty(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			if (prop === "$store" || prop === "$snapshot") return false;

			store.delete(prop as keyof InferSchema<S>);
			return true;
		},

		has(_, prop: string | symbol) {
			if (prop === "$store" || prop === "$snapshot") return true;
			if (typeof prop === "symbol") return false;

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
