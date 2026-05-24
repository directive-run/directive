/**
 * Schema Introspection
 *
 * A runtime discriminant for every `t.*()` builder result, so downstream
 * consumers (`predicateFromIntent`, `doctor`, future `predicateToZod`)
 * can ask "what kind is this fact?" without grepping the source.
 *
 * The discriminant lives at `_kind?: SchemaKindNode` on `ExtendedSchemaType`.
 * Base builders set it; chain mutators (`.nullable()`, `.brand()`, etc.)
 * preserve / decorate it. When `_kind` is absent (legacy or third-party
 * builder), the parser falls back to reading the freeform `_typeName`
 * string. When even that fails: `{ kind: "unknown" }` — graceful close.
 *
 * This module has zero hot-path cost; it is only invoked when an
 * introspecting caller asks for it.
 */

import { PREDICATE_OPERATORS, type PredicateOp } from "./types/predicate.js";

/**
 * Minimal structural shape for a schema-builder result that
 * introspection cares about. Avoids the contravariance trap on
 * `ExtendedSchemaType<T>` when `T = unknown` (which makes
 * `ChainableString` un-assignable to `ExtendedSchemaType<unknown>`
 * via the `_refinements` field). Any builder result is structurally
 * compatible with this shape.
 */
export interface IntrospectableSchema {
  readonly _kind?: SchemaKindNode;
  readonly _typeName?: string;
}

// ============================================================================
// SchemaKindNode tree
// ============================================================================

/**
 * The closed set of kinds a Directive schema field can be.
 *
 * Drives operator availability via {@link getOperatorsForKind}: e.g.
 * `"number"` gets the orderable operators (`$gte`, `$lte`); `"boolean"`
 * does not.
 */
export type SchemaKind =
  | "number"
  | "string"
  | "boolean"
  | "bigint"
  | "date"
  | "array"
  | "object"
  | "record"
  | "tuple"
  | "enum"
  | "literal"
  | "union"
  | "branded"
  | "unknown";

/**
 * A tree-shaped discriminator for a schema field. Composite kinds
 * (array, object, tuple, etc.) carry their element / shape information
 * so an LLM-prompt builder can show "cartTotal is a number" AND
 * "items is an array of { sku: string, qty: number }".
 *
 * `nullable` / `hasDefault` flags appear on the inner node (NOT a
 * wrapping kind) so operator-lookup on `t.number().nullable()` returns
 * the number's operators unchanged — `$gte` works on the non-null arm.
 */
export type SchemaKindNode =
  | (
      | { kind: "number" | "string" | "boolean" | "bigint" | "date" | "unknown" }
      | { kind: "literal"; value: string | number | boolean | null; primitive: "string" | "number" | "boolean" | "null" }
      | { kind: "enum"; values: readonly (string | number)[]; primitive: "string" | "number" }
      | { kind: "array"; element: SchemaKindNode }
      | { kind: "tuple"; elements: readonly SchemaKindNode[] }
      | { kind: "object"; shape: Record<string, SchemaKindNode> }
      | { kind: "record"; value: SchemaKindNode }
      | { kind: "union"; members: readonly SchemaKindNode[] }
      | { kind: "branded"; inner: SchemaKindNode }
    ) & {
      /** True if the schema accepts `null` (from `.nullable()` / `.optional()`). */
      nullable?: boolean;
      /** True if the schema has a `.default()`. */
      hasDefault?: boolean;
    };

// ============================================================================
// Parse `_typeName` → SchemaKindNode (fallback for legacy / third-party)
// ============================================================================

const PRIMITIVE_KINDS = new Set<SchemaKind>([
  "number",
  "string",
  "boolean",
  "bigint",
  "date",
  "unknown",
]);

/**
 * Best-effort parse of a freeform `_typeName` string into a structured
 * kind node. Used only when `_kind` is absent. Always falls back to
 * `{ kind: "unknown" }`; never throws.
 */
function parseTypeName(typeName: string | undefined): SchemaKindNode {
  if (!typeName) return { kind: "unknown" };

  // "Branded<inner>" — recurse.
  const branded = /^Branded<(.+)>$/.exec(typeName);
  if (branded) {
    return { kind: "branded", inner: parseTypeName(branded[1]) };
  }

  // "X | null" / "X | undefined" — nullable wrapper.
  if (typeName.endsWith(" | null") || typeName.endsWith(" | undefined")) {
    const inner = parseTypeName(
      typeName.replace(/ \| (null|undefined)$/, ""),
    );

    return { ...inner, nullable: true };
  }

  // Bare primitive.
  if (PRIMITIVE_KINDS.has(typeName as SchemaKind)) {
    return { kind: typeName as SchemaKind } as SchemaKindNode;
  }

  // String-flavored named types (email, uuid, url, etc.) all map to "string"
  // for operator purposes.
  if (/^(email|uuid|url|cuid|datetime|iso\b)/i.test(typeName)) {
    return { kind: "string" };
  }

  // Generic union "X | Y | Z" → union of parsed members (used by t.union()).
  if (typeName.includes(" | ")) {
    const members = typeName.split(" | ").map(parseTypeName);

    return { kind: "union", members };
  }

  // Bare names we recognize as composite without elements.
  if (typeName === "array") return { kind: "array", element: { kind: "unknown" } };
  if (typeName === "object") return { kind: "object", shape: {} };
  if (typeName === "record") return { kind: "record", value: { kind: "unknown" } };
  if (typeName === "tuple") return { kind: "tuple", elements: [] };
  if (typeName === "union") return { kind: "union", members: [] };

  return { kind: "unknown" };
}

// ============================================================================
// Get the kind node for a single schema field
// ============================================================================

/**
 * Return the {@link SchemaKindNode} for a schema field. Prefers the
 * explicit `_kind` discriminant set by the builder; falls back to
 * parsing the freeform `_typeName` string for legacy / third-party
 * builders that don't set `_kind`.
 *
 * @example
 * ```ts
 * getKind(t.number())              // → { kind: "number" }
 * getKind(t.string().nullable())   // → { kind: "string", nullable: true }
 * getKind(t.array(t.number()))     // → { kind: "array", element: { kind: "number" } }
 * ```
 */
export function getKind(schema: unknown): SchemaKindNode {
  if (!schema || typeof schema !== "object") return { kind: "unknown" };
  const s = schema as IntrospectableSchema;
  if (s._kind) return s._kind;

  return parseTypeName(s._typeName);
}

// ============================================================================
// Walk a module schema → Map<dotted-path, SchemaKindNode>
// ============================================================================

/**
 * Walk the `facts` block of a module schema and emit a flat map from
 * dotted path → kind node. Nested `t.object()` shapes flatten using
 * `.` as the separator, matching the convention used by
 * `OperatorObject<V>`'s nested-path support.
 *
 * Passing a top-level schema directly (without the `facts:` wrapper)
 * also works — anything iterable as `Record<string, ExtendedSchemaType>`
 * is acceptable.
 */
export function getSchemaFieldKinds(
  schema: unknown,
): Map<string, SchemaKindNode> {
  const out = new Map<string, SchemaKindNode>();
  if (!schema || typeof schema !== "object") return out;
  const root = schema as Record<string, unknown>;
  const factsCandidate =
    "facts" in root && root.facts && typeof root.facts === "object"
      ? root.facts
      : root;
  const facts = factsCandidate as Record<string, unknown>;

  for (const [key, builder] of Object.entries(facts)) {
    if (!builder || typeof builder !== "object") continue;
    const node = getKind(builder);
    out.set(key, node);

    // Flatten nested object shapes one level — matches OperatorObject<V>'s
    // dotted-path support.
    if (node.kind === "object") {
      for (const [innerKey, innerNode] of Object.entries(node.shape)) {
        out.set(`${key}.${innerKey}`, innerNode);
      }
    }
  }

  return out;
}

// ============================================================================
// Operator allowlist per kind
// ============================================================================

const COMMON_OPS: readonly PredicateOp[] = [
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$exists",
];

const ORDERABLE_OPS: readonly PredicateOp[] = [
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$between",
];

const STRING_OPS: readonly PredicateOp[] = [
  "$matches",
  "$startsWith",
  "$endsWith",
  "$contains",
];

/**
 * Return the set of `PredicateOp` strings that are valid against a
 * given {@link SchemaKindNode}.
 *
 * Mirrors the type-level matrix encoded in `OperatorObject<V>` in
 * `types/predicate.ts` — drift between the two is enforced by the
 * compile-time conformance test
 * (`schema-introspection-conformance.test-d.ts`).
 *
 * - **Common to all kinds:** `$eq`, `$ne`, `$in`, `$nin`, `$exists`
 * - **Orderable (`number`/`string`/`bigint`/`date`):** + `$gt`, `$gte`,
 *   `$lt`, `$lte`, `$between`
 * - **String-specific:** + `$matches`, `$startsWith`, `$endsWith`, `$contains`
 * - **Array:** + `$contains` (over the element type)
 * - **Union:** *intersection* across members (the operand must be valid
 *   for every branch).
 * - **Branded:** delegates to the inner kind.
 * - **Literal / Enum:** operators of the primitive, with `$eq` / `$in`
 *   operand restricted at the LLM-prompt layer (not enforced here).
 *
 * `nullable` does not change operator availability — `$gte` on a
 * nullable number is fine on the non-null arm; `$exists` handles null.
 */
export function getOperatorsForKind(node: SchemaKindNode): readonly PredicateOp[] {
  switch (node.kind) {
    case "number":
    case "bigint":
    case "date":
      return [...COMMON_OPS, ...ORDERABLE_OPS];
    case "string":
      return [...COMMON_OPS, ...ORDERABLE_OPS, ...STRING_OPS];
    case "boolean":
    case "unknown":
      return COMMON_OPS;
    case "array":
      return [...COMMON_OPS, "$contains"];
    case "object":
    case "record":
    case "tuple":
      return COMMON_OPS;
    case "literal":
    case "enum":
      // Operators allowed by the underlying primitive.
      return getOperatorsForKind(
        node.primitive === "number"
          ? { kind: "number" }
          : node.primitive === "boolean"
            ? { kind: "boolean" }
            : node.primitive === "null"
              ? { kind: "unknown" }
              : { kind: "string" },
      );
    case "branded":
      return getOperatorsForKind(node.inner);
    case "union": {
      // Intersection of operators valid on every member.
      if (node.members.length === 0) return COMMON_OPS;
      const sets = node.members.map((m) => new Set(getOperatorsForKind(m)));
      const first = sets[0]!;
      const intersection: PredicateOp[] = [];
      for (const op of first) {
        if (sets.every((s) => s.has(op))) intersection.push(op);
      }

      return intersection;
    }
    default: {
      // Exhaustiveness check — TS will flag if a new kind is added without
      // a switch arm.
      const _exhaustive: never = node;
      void _exhaustive;

      return COMMON_OPS;
    }
  }
}

/**
 * Return all known predicate operators — convenience for prompt builders
 * that need to show the LLM the full set.
 */
export function listAllPredicateOperators(): readonly PredicateOp[] {
  return Array.from(PREDICATE_OPERATORS) as readonly PredicateOp[];
}
