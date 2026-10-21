/**
 * Runtime validation of fact writes (the 1.35 checks), in its own module so a
 * store built without it bundles none of it. A store calls the validator on
 * each write in development only.
 *
 * Also the internals' `createFactsStore` / `createFacts`, which take 1.35's
 * `validate` / `strictKeys` / `redactErrors` options and build the validator.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import {
  type CreateFactsStoreOptions,
  createFacts as createFactsCore,
  createFactsStore as createFactsStoreCore,
  safeStringify,
} from "./facts.js";
import type { Facts, FactsStore, Schema } from "./types.js";

function isZodSchema(v: unknown): boolean {
  const o = v as Record<string, unknown>;

  return (
    v !== null &&
    typeof v === "object" &&
    typeof o.safeParse === "function" &&
    "_def" in o &&
    typeof o.parse === "function"
  );
}

const typeLabel = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export interface ValidatorOptions {
  /** Default: development. */
  validate?: boolean;
  /** Throw on an unknown key. Default: development, unless the schema is empty. */
  strictKeys?: boolean;
  /** Keep values out of error messages. */
  redactErrors?: boolean;
}

/** The write check for `schema`, or `undefined` when validation is off. */
export function createValidator(
  schema: Schema,
  options: ValidatorOptions = {},
): ((key: string, value: unknown) => void) | undefined {
  if (!(options.validate ?? isDevelopment)) {
    return undefined;
  }
  const strictKeys =
    options.strictKeys ?? (isDevelopment && Object.keys(schema).length > 0);
  const redactErrors = options.redactErrors ?? false;
  const preview = (value: unknown) =>
    redactErrors ? "[redacted]" : safeStringify(value);

  return (key: string, value: unknown): void => {
    const st = (schema as Record<string, unknown>)[key] as
      | Record<string, any>
      | undefined;
    if (!st) {
      if (strictKeys) {
        throw new Error(
          `[Directive] Unknown fact key: "${key}". Key not defined in schema.`,
        );
      }
      console.warn(`[Directive] Unknown fact key: "${key}"`);

      return;
    }
    if (isZodSchema(st)) {
      const result = st.safeParse(value);
      if (result.success) {
        return;
      }
      const message =
        result.error?.message ??
        result.error?.issues?.[0]?.message ??
        "Validation failed";
      const expected = st._typeName
        ? st._typeName
        : st._def?.typeName
          ? String(st._def.typeName).replace(/^Zod/, "").toLowerCase()
          : "unknown";
      throw new Error(
        `[Directive] Validation failed for "${key}": expected ${expected}, got ${typeLabel(value)} ${preview(value)}. ${message}`,
      );
    }
    const validators = st._validators;
    if (!Array.isArray(validators) || validators.length === 0) {
      return;
    }
    for (let i = 0; i < validators.length; i++) {
      const validator = validators[i];
      if (typeof validator !== "function" || validator(value)) {
        continue;
      }
      let indexHint = "";
      if (typeof st._lastFailedIndex === "number" && st._lastFailedIndex >= 0) {
        indexHint = ` (element at index ${st._lastFailedIndex} failed)`;
        st._lastFailedIndex = -1;
      }
      throw new Error(
        `[Directive] Validation failed for "${key}": expected ${st._typeName ?? "unknown"}, got ${typeLabel(value)} ${preview(value)}${i === 0 ? "" : ` (validator ${i + 1} failed)`}${indexHint}`,
      );
    }
  };
}

export type StoreOptions<S extends Schema> = CreateFactsStoreOptions<S> &
  ValidatorOptions;

/** 1.35's `createFactsStore`: a store with its validator built from options. */
export function createFactsStore<S extends Schema>(
  options: StoreOptions<S>,
): FactsStore<S> {
  return createFactsStoreCore({
    ...options,
    validator: options.validator ?? createValidator(options.schema, options),
  });
}

/** 1.35's `createFacts`, with validation as {@link createFactsStore}. */
export function createFacts<S extends Schema>(
  options: StoreOptions<S>,
): { store: FactsStore<S>; facts: Facts<S> } {
  return createFactsCore({
    ...options,
    validator: options.validator ?? createValidator(options.schema, options),
  });
}

/**
 * The validation part: defines the kernel's `validate` feature, which the
 * system's store calls on each write in development.
 */
export const withValidation: SystemPart = ({ kernel, module }) => {
  const validator = createValidator((module.schema?.facts ?? {}) as Schema);
  if (validator) {
    kernel.define("validate", validator);
  }
};
