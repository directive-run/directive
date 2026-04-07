/**
 * Schema Type Builders
 *
 * Provides type-safe schema definitions with optional runtime validation.
 * Used to define fact types, derivation types, event payload types, etc.
 *
 * This module has no dependency on the facts store or tracking system.
 */

import isDevelopment from "#is-development";
import type { SchemaType } from "./types.js";

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
  readonly _refinements?: Array<{
    predicate: (value: T) => boolean;
    message: string;
  }>;
  /** Mutable - set by array validators to indicate which element failed */
  _lastFailedIndex?: number;
  /** Optional metadata for debugging and devtools (never read on hot path). */
  readonly _meta?: import("./types/meta.js").DefinitionMeta;
}

/** Create a schema type builder with optional type name */
function createSchemaType<T>(
  validators: Array<(v: T) => boolean> = [],
  typeName?: string,
  defaultValue?: T | (() => T),
  transform?: (value: unknown) => T,
  description?: string,
  refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
  meta?: import("./types/meta.js").DefinitionMeta,
): ExtendedSchemaType<T> {
  return {
    _type: undefined as unknown as T,
    _validators: validators,
    _typeName: typeName,
    _default: defaultValue,
    _transform: transform,
    _description: description,
    _refinements: refinements,
    _meta: meta,
    validate(fn: (value: T) => boolean) {
      return createSchemaType(
        [...validators, fn],
        typeName,
        defaultValue,
        transform,
        description,
        refinements,
        meta,
      );
    },
  };
}

/** Chainable schema type with all common methods */
export interface ChainableSchemaType<T> extends ExtendedSchemaType<T> {
  default(value: T | (() => T)): ChainableSchemaType<T>;
  transform<U>(fn: (value: T) => U): ChainableSchemaType<U>;
  brand<B extends string>(): ChainableSchemaType<Branded<T, B>>;
  describe(description: string): ChainableSchemaType<T>;
  refine(
    predicate: (value: T) => boolean,
    message: string,
  ): ChainableSchemaType<T>;
  nullable(): ChainableSchemaType<T | null>;
  optional(): ChainableSchemaType<T | undefined>;
  /** Attach metadata for debugging and devtools. */
  meta(
    meta: import("./types/meta.js").DefinitionMeta,
  ): ChainableSchemaType<T>;
}

/** Create a chainable schema type with common methods */
function createChainableType<T>(
  validators: Array<(v: T) => boolean>,
  typeName: string,
  defaultValue?: T | (() => T),
  transform?: (value: unknown) => T,
  description?: string,
  refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
  fieldMeta?: import("./types/meta.js").DefinitionMeta,
): ChainableSchemaType<T> {
  const base = createSchemaType<T>(
    validators,
    typeName,
    defaultValue,
    transform,
    description,
    refinements,
    fieldMeta,
  );
  return {
    ...base,
    default(value: T | (() => T)) {
      return createChainableType(
        validators,
        typeName,
        value,
        transform,
        description,
        refinements,
        fieldMeta,
      );
    },
    transform<U>(fn: (value: T) => U) {
      const newTransform = (v: unknown) => {
        const intermediate = transform ? transform(v) : (v as T);
        return fn(intermediate);
      };
      return createChainableType<U>(
        [],
        typeName,
        undefined,
        newTransform as (v: unknown) => U,
        description,
        undefined,
        fieldMeta,
      );
    },
    brand<B extends string>() {
      return createChainableType<Branded<T, B>>(
        validators as Array<(v: Branded<T, B>) => boolean>,
        `Branded<${typeName}>`,
        defaultValue as Branded<T, B> | (() => Branded<T, B>),
        transform as (value: unknown) => Branded<T, B>,
        description,
        refinements as Array<{
          predicate: (value: Branded<T, B>) => boolean;
          message: string;
        }>,
        fieldMeta,
      );
    },
    describe(desc: string) {
      return createChainableType(
        validators,
        typeName,
        defaultValue,
        transform,
        desc,
        refinements,
        fieldMeta,
      );
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
        fieldMeta,
      );
    },
    nullable() {
      return createChainableType<T | null>(
        [
          (v): v is T | null =>
            v === null || validators.every((fn) => fn(v as T)),
        ],
        `${typeName} | null`,
        defaultValue as (T | null) | (() => T | null),
        transform as (value: unknown) => T | null,
        description,
        undefined,
        fieldMeta,
      );
    },
    optional() {
      return createChainableType<T | undefined>(
        [
          (v): v is T | undefined =>
            v === undefined || validators.every((fn) => fn(v as T)),
        ],
        `${typeName} | undefined`,
        defaultValue as (T | undefined) | (() => T | undefined),
        transform as (value: unknown) => T | undefined,
        description,
        undefined,
        fieldMeta,
      );
    },
    meta(m: import("./types/meta.js").DefinitionMeta) {
      return createChainableType(
        validators,
        typeName,
        defaultValue,
        transform,
        description,
        refinements,
        m,
      );
    },
  };
}

/**
 * Schema type builders for defining fact types.
 *
 * @remarks
 * Each builder returns a chainable {@link ExtendedSchemaType} with validation
 * methods (`.min()`, `.max()`, `.pattern()`, etc.) and dev-mode runtime
 * type checking. Validators are tree-shaken in production builds.
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
 *
 * @public
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
    type ChainableString = ChainableSchemaType<T> & {
      minLength(n: number): ChainableString;
      maxLength(n: number): ChainableString;
      pattern(regex: RegExp): ChainableString;
      meta(m: import("./types/meta.js").DefinitionMeta): ChainableString;
    };

    const createChainableString = (
      validators: Array<(v: T) => boolean>,
      defaultValue?: T | (() => T),
      transform?: (value: unknown) => T,
      description?: string,
      refinements?: Array<{
        predicate: (value: T) => boolean;
        message: string;
      }>,
      fm?: import("./types/meta.js").DefinitionMeta,
    ): ChainableString => {
      const chainable = createChainableType<T>(
        validators,
        "string",
        defaultValue,
        transform,
        description,
        refinements,
        fm,
      );
      return {
        ...chainable,
        minLength(n: number) {
          return createChainableString(
            [...validators, (v) => (v as string).length >= n],
            defaultValue, transform, description, refinements, fm,
          );
        },
        maxLength(n: number) {
          return createChainableString(
            [...validators, (v) => (v as string).length <= n],
            defaultValue, transform, description, refinements, fm,
          );
        },
        pattern(regex: RegExp) {
          return createChainableString(
            [...validators, (v) => regex.test(v as string)],
            defaultValue, transform, description, refinements, fm,
          );
        },
        default(value: T | (() => T)) {
          return createChainableString(
            validators, value, transform, description, refinements, fm,
          );
        },
        describe(desc: string) {
          return createChainableString(
            validators, defaultValue, transform, desc, refinements, fm,
          );
        },
        refine(predicate: (value: T) => boolean, message: string) {
          const newRefinements = [
            ...(refinements ?? []),
            { predicate, message },
          ];
          return createChainableString(
            [...validators, predicate],
            defaultValue, transform, description, newRefinements, fm,
          );
        },
        meta(m: import("./types/meta.js").DefinitionMeta) {
          return createChainableString(
            validators, defaultValue, transform, description, refinements, m,
          );
        },
      };
    };

    return createChainableString([(v): v is T => typeof v === "string"]);
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
      meta(m: import("./types/meta.js").DefinitionMeta): ChainableNumber;
    };

    const createChainableNumber = (
      validators: Array<(v: number) => boolean>,
      defaultValue?: number | (() => number),
      transform?: (value: unknown) => number,
      description?: string,
      refinements?: Array<{
        predicate: (value: number) => boolean;
        message: string;
      }>,
      fm?: import("./types/meta.js").DefinitionMeta,
    ): ChainableNumber => {
      const chainable = createChainableType<number>(
        validators, "number", defaultValue, transform, description, refinements, fm,
      );
      return {
        ...chainable,
        min(n: number) {
          return createChainableNumber(
            [...validators, (v) => v >= n],
            defaultValue, transform, description, refinements, fm,
          );
        },
        max(n: number) {
          return createChainableNumber(
            [...validators, (v) => v <= n],
            defaultValue, transform, description, refinements, fm,
          );
        },
        default(value: number | (() => number)) {
          return createChainableNumber(
            validators, value, transform, description, refinements, fm,
          );
        },
        describe(desc: string) {
          return createChainableNumber(
            validators, defaultValue, transform, desc, refinements, fm,
          );
        },
        refine(predicate: (value: number) => boolean, message: string) {
          const newRefinements = [
            ...(refinements ?? []),
            { predicate, message },
          ];
          return createChainableNumber(
            [...validators, predicate],
            defaultValue, transform, description, newRefinements, fm,
          );
        },
        meta(m: import("./types/meta.js").DefinitionMeta) {
          return createChainableNumber(
            validators, defaultValue, transform, description, refinements, m,
          );
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
    return createChainableType<boolean>(
      [(v) => typeof v === "boolean"],
      "boolean",
    );
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
      meta(m: import("./types/meta.js").DefinitionMeta): ChainableArray;
      _lastFailedIndex?: number;
    };

    const createChainableArray = (
      validators: Array<(v: T[]) => boolean>,
      elementType?: SchemaType<T>,
      defaultValue?: T[] | (() => T[]),
      description?: string,
      indexRef?: { value: number },
      fm?: import("./types/meta.js").DefinitionMeta,
    ): ChainableArray => {
      const chainable = createChainableType<T[]>(
        validators,
        "array",
        defaultValue,
        undefined,
        description,
        undefined,
        fm,
      );
      // Use ref for storing failed index (shared with validator closure)
      const ref = indexRef ?? { value: -1 };
      const result: ChainableArray = {
        ...chainable,
        get _lastFailedIndex() {
          return ref.value;
        },
        set _lastFailedIndex(v: number) {
          ref.value = v;
        },
        of(et: SchemaType<T>) {
          const newRef = { value: -1 };
          return createChainableArray(
            [...validators, (v) => {
              for (let i = 0; i < v.length; i++) {
                if (!et._validators.every((validator) => validator(v[i]))) {
                  newRef.value = i;
                  return false;
                }
              }
              return true;
            }],
            et, defaultValue, description, newRef, fm,
          );
        },
        nonEmpty() {
          return createChainableArray(
            [...validators, (v) => v.length > 0],
            elementType, defaultValue, description, ref, fm,
          );
        },
        maxLength(n: number) {
          return createChainableArray(
            [...validators, (v) => v.length <= n],
            elementType, defaultValue, description, ref, fm,
          );
        },
        minLength(n: number) {
          return createChainableArray(
            [...validators, (v) => v.length >= n],
            elementType, defaultValue, description, ref, fm,
          );
        },
        default(value: T[] | (() => T[])) {
          return createChainableArray(
            validators, elementType, value, description, ref, fm,
          );
        },
        describe(desc: string) {
          return createChainableArray(
            validators, elementType, defaultValue, desc, ref, fm,
          );
        },
        meta(m: import("./types/meta.js").DefinitionMeta) {
          return createChainableArray(
            validators, elementType, defaultValue, description, ref, m,
          );
        },
      };
      return result;
    };
    return createChainableArray([(v) => Array.isArray(v)]);
  },

  /**
   * Create an object schema type for any complex value.
   * Can be used with or without shape validation:
   * - `t.object<User>()` - Type-only, no property validation
   * - `t.object<User>().shape({ name: t.string(), age: t.number() })` - With property validation
   *
   * For arrays, prefer `t.array<T>()` which adds `Array.isArray` validation.
   */
  object<T>() {
    type ChainableObject = ChainableSchemaType<T> & {
      shape(schema: { [K in keyof T]?: SchemaType<T[K]> }): ChainableObject;
      nonNull(): ChainableObject;
      hasKeys(...keys: string[]): ChainableObject;
      meta(m: import("./types/meta.js").DefinitionMeta): ChainableObject;
    };

    const createChainableObject = (
      validators: Array<(v: T) => boolean>,
      defaultValue?: T | (() => T),
      description?: string,
      fm?: import("./types/meta.js").DefinitionMeta,
    ): ChainableObject => {
      const chainable = createChainableType<T>(
        validators, "object", defaultValue, undefined, description, undefined, fm,
      );
      return {
        ...chainable,
        shape(shapeSchema: { [K in keyof T]?: SchemaType<T[K]> }) {
          return createChainableObject(
            [...validators, (v) => {
              for (const [key, schemaType] of Object.entries(shapeSchema)) {
                const value = (v as Record<string, unknown>)[key];
                const schemaT = schemaType as SchemaType<unknown>;
                if (schemaT && !schemaT._validators.every((validator) => validator(value))) {
                  return false;
                }
              }
              return true;
            }],
            defaultValue, description, fm,
          );
        },
        nonNull() {
          return createChainableObject(
            [...validators, (v) => v !== null && v !== undefined],
            defaultValue, description, fm,
          );
        },
        hasKeys(...keys: string[]) {
          return createChainableObject(
            [...validators, (v) => keys.every((k) => k in (v as Record<string, unknown>))],
            defaultValue, description, fm,
          );
        },
        default(value: T | (() => T)) {
          return createChainableObject(validators, value, description, fm);
        },
        describe(desc: string) {
          return createChainableObject(validators, defaultValue, desc, fm);
        },
        meta(m: import("./types/meta.js").DefinitionMeta) {
          return createChainableObject(validators, defaultValue, description, m);
        },
      };
    };
    return createChainableObject([
      (v) => typeof v === "object" && v !== null && !Array.isArray(v),
    ]);
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
    if (isDevelopment && values.length === 0) {
      console.warn(
        "[Directive] t.enum() called with no values - this will reject all strings",
      );
    }
    const valueSet = new Set(values);
    return createChainableType<T>(
      [(v): v is T => typeof v === "string" && valueSet.has(v as T)],
      `enum(${values.join("|")})`,
    );
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
    return createChainableType<T>(
      [(v): v is T => v === value],
      `literal(${String(value)})`,
    );
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
    const innerTypeName =
      (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
    return createSchemaType<T | null>(
      [
        (v): v is T | null => {
          if (v === null) {
            return true;
          }
          return innerType._validators.every((validator) => validator(v as T));
        },
      ],
      `${innerTypeName} | null`,
    ) as SchemaType<T | null>;
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
    const innerTypeName =
      (innerType as ExtendedSchemaType<T>)._typeName ?? "unknown";
    return createSchemaType<T | undefined>(
      [
        (v): v is T | undefined => {
          if (v === undefined) {
            return true;
          }
          return innerType._validators.every((validator) => validator(v as T));
        },
      ],
      `${innerTypeName} | undefined`,
    ) as SchemaType<T | undefined>;
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
    if (isDevelopment && types.length === 0) {
      console.warn(
        "[Directive] t.union() called with no types - this will reject all values",
      );
    }
    type UnionType = T[number] extends SchemaType<infer U> ? U : never;
    const typeNames = types.map(
      (schemaType) =>
        (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown",
    );
    return createChainableType<UnionType>(
      [
        (v): v is UnionType =>
          types.some((schemaType) =>
            schemaType._validators.every((fn) => fn(v)),
          ),
      ],
      typeNames.join(" | "),
    );
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
    const valueTypeName =
      (valueType as ExtendedSchemaType<V>)._typeName ?? "unknown";
    return createChainableType<Record<string, V>>(
      [
        (v): v is Record<string, V> => {
          if (typeof v !== "object" || v === null || Array.isArray(v))
            return false;
          return Object.values(v).every((val) =>
            valueType._validators.every((validator) => validator(val)),
          );
        },
      ],
      `Record<string, ${valueTypeName}>`,
    );
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
    if (isDevelopment && types.length === 0) {
      console.warn(
        "[Directive] t.tuple() called with no types - this will only accept empty arrays",
      );
    }
    type TupleType = {
      [K in keyof T]: T[K] extends SchemaType<infer U> ? U : never;
    };
    const typeNames = types.map(
      (schemaType) =>
        (schemaType as ExtendedSchemaType<unknown>)._typeName ?? "unknown",
    );
    return createChainableType<TupleType>(
      [
        (v): v is TupleType => {
          if (!Array.isArray(v) || v.length !== types.length) {
            return false;
          }
          return types.every((schemaType, i) =>
            schemaType._validators.every((validator) => validator(v[i])),
          );
        },
      ],
      `[${typeNames.join(", ")}]`,
    );
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
    return createChainableType<Date>(
      [(v): v is Date => v instanceof Date && !Number.isNaN(v.getTime())],
      "Date",
    );
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
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return createChainableType<string>(
      [(v): v is string => typeof v === "string" && uuidRegex.test(v)],
      "uuid",
    );
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
    return createChainableType<string>(
      [(v): v is string => typeof v === "string" && emailRegex.test(v)],
      "email",
    );
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
    return createChainableType<string>(
      [
        (v): v is string => {
          if (typeof v !== "string") {
            return false;
          }
          try {
            new URL(v);
            return true;
          } catch {
            return false;
          }
        },
      ],
      "url",
    );
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
    return createChainableType<bigint>(
      [(v): v is bigint => typeof v === "bigint"],
      "bigint",
    );
  },

  /**
   * Create an `any` schema type that accepts all values without validation.
   *
   * @example
   * ```typescript
   * schema: { payload: t.any() }
   * ```
   */
  // biome-ignore lint/suspicious/noExplicitAny: Intentional any type for schema builder
  any() {
    return createChainableType<any>([], "any");
  },

  /**
   * Create an `unknown` schema type that accepts all values without validation.
   * Prefer `t.unknown()` over `t.any()` for stricter downstream type checking.
   *
   * @example
   * ```typescript
   * schema: { data: t.unknown() }
   * ```
   */
  unknown() {
    return createChainableType<unknown>([], "unknown");
  },
};
