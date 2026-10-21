/**
 * Schema Type Builders: the shared base every `t.*` builder module uses.
 *
 * Provides type-safe schema definitions with optional runtime validation.
 * Used to define fact types, derivation types, event payload types, etc.
 *
 * This module has no dependency on the facts store or tracking system.
 */

import type { DefinitionMeta, SchemaType } from "../types.js";

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
  readonly _meta?: DefinitionMeta;
}

/** Create a schema type builder with optional type name */
export function createSchemaType<T>(
  validators: Array<(v: T) => boolean> = [],
  typeName?: string,
  defaultValue?: T | (() => T),
  transform?: (value: unknown) => T,
  description?: string,
  refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
  meta?: DefinitionMeta,
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
  meta(meta: DefinitionMeta): ChainableSchemaType<T>;
}

/**
 * The chainable types the builders return.
 *
 * Declared here at module scope rather than inside each builder, and that
 * placement is load-bearing. These types are recursive — `minLength` returns the
 * same chainable type — and a recursive type declared *inside* a function has no
 * name the declaration emitter can reference. The bundled `.d.ts` then emitted the
 * recursive position as `ChainableSchemaType<T> & any`, which is `any`, so a
 * consumer who tightened a fact with `t.number().min(0)` silently lost the fact's
 * type and the type of everything reading it. The source was correct throughout,
 * which is why no test running against `src/` could see it.
 *
 * Covered by `packages/core/__tests__/dist-types.test.ts`, which typechecks
 * against the built declarations the way a consumer does.
 */
export interface ChainableStringType<T extends string>
  extends ChainableSchemaType<T> {
  minLength(n: number): ChainableStringType<T>;
  maxLength(n: number): ChainableStringType<T>;
  pattern(regex: RegExp): ChainableStringType<T>;
  meta(m: DefinitionMeta): ChainableStringType<T>;
}

export interface ChainableNumberType extends ChainableSchemaType<number> {
  min(n: number): ChainableNumberType;
  max(n: number): ChainableNumberType;
  meta(m: DefinitionMeta): ChainableNumberType;
}

export interface ChainableArrayType<T> extends ChainableSchemaType<T[]> {
  of(elementType: SchemaType<T>): ChainableArrayType<T>;
  nonEmpty(): ChainableArrayType<T>;
  maxLength(n: number): ChainableArrayType<T>;
  minLength(n: number): ChainableArrayType<T>;
  meta(m: DefinitionMeta): ChainableArrayType<T>;
  _lastFailedIndex?: number;
}

export interface ChainableObjectType<T> extends ChainableSchemaType<T> {
  shape(schema: { [K in keyof T]?: SchemaType<T[K]> }): ChainableObjectType<T>;
  nonNull(): ChainableObjectType<T>;
  hasKeys(...keys: string[]): ChainableObjectType<T>;
  meta(m: DefinitionMeta): ChainableObjectType<T>;
}

/** Create a chainable schema type with common methods */
export function createChainableType<T>(
  validators: Array<(v: T) => boolean>,
  typeName: string,
  defaultValue?: T | (() => T),
  transform?: (value: unknown) => T,
  description?: string,
  refinements?: Array<{ predicate: (value: T) => boolean; message: string }>,
  fieldMeta?: DefinitionMeta,
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
    meta(m: DefinitionMeta) {
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
