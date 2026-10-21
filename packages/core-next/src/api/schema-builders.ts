/**
 * Schema Type Builders: the `t` object. Each builder lives in its own module
 * under ./schema/ (base.ts holds what they share), so code that imports a
 * builder directly bundles only that builder.
 */

import { any } from "./schema/any.js";
import { array } from "./schema/array.js";
import { bigint } from "./schema/bigint.js";
import { boolean } from "./schema/boolean.js";
import { date } from "./schema/date.js";
import { email } from "./schema/email.js";
import { enumType } from "./schema/enum.js";
import { literal } from "./schema/literal.js";
import { nullable } from "./schema/nullable.js";
import { number } from "./schema/number.js";
import { object } from "./schema/object.js";
import { optional } from "./schema/optional.js";
import { record } from "./schema/record.js";
import { string } from "./schema/string.js";
import { tuple } from "./schema/tuple.js";
import { union } from "./schema/union.js";
import { unknown } from "./schema/unknown.js";
import { url } from "./schema/url.js";
import { uuid } from "./schema/uuid.js";

export type * from "./schema/base.js";
export type { UnionFn } from "./schema/union.js";

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
  string,
  number,
  boolean,
  array,
  object,
  enum: enumType,
  literal,
  nullable,
  optional,
  union,
  record,
  tuple,
  date,
  uuid,
  email,
  url,
  bigint,
  any,
  unknown,
};
