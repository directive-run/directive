/**
 * PII operand redaction for cached predicate specs.
 *
 * Cached `whenSpec` operand pointers (e.g. `{ email: { $eq:
 * "alice@x.com" } }`) flow into every `constraint.evaluate` entry —
 * without scrubbing, the email would land in the audit trail in
 * plaintext on every evaluation. (C2)
 *
 * `redactWhenSpec` deep-clones the spec, walks it via `walkPredicate`,
 * and replaces operand values at PII-tagged fact paths with
 * `"[redacted]"`. Best-effort: if the spec contains anything
 * non-JSON-serialisable, we return the original (the caller has
 * already snapshotted the reference).
 */

import { walkPredicate } from "../../core/predicate.js";

/**
 * Navigate `root` to `dottedPath` (`foo.bar.$eq`, `foo[0].value`) and
 * replace the value at the leaf. Used by `redactWhenSpec` to scrub
 * PII operands in cached predicate specs. Best-effort: silently no-ops
 * if the path doesn't resolve (caller already cloned the spec).
 */
function replaceAtPath(root: unknown, dottedPath: string, value: unknown): void {
  if (root === null || typeof root !== "object") return;
  // Split on "." but treat "[N]" segments as array indices.
  // E.g. "[0].value" → ["[0]", "value"], "foo.bar[1]" → ["foo", "bar[1]"].
  const segs: Array<string | number> = [];
  for (const part of dottedPath.split(".")) {
    if (!part) continue;
    // Pull leading `[N]` if present.
    const m = part.match(/^\[(\d+)\](.*)$/);
    if (m) {
      segs.push(Number(m[1]));
      if (m[2]) segs.push(m[2].replace(/^\./, ""));
      continue;
    }
    // Trailing `[N]` on the segment.
    const m2 = part.match(/^([^[]+)\[(\d+)\](.*)$/);
    if (m2) {
      segs.push(m2[1]!);
      segs.push(Number(m2[2]));
      if (m2[3]) segs.push(m2[3].replace(/^\./, ""));
      continue;
    }
    segs.push(part);
  }

  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  if (cur === null || typeof cur !== "object") return;
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === undefined) return;
  (cur as Record<string | number, unknown>)[lastSeg] = value;
}

/**
 * Walk a predicate spec and replace operands at PII-tagged fact paths
 * with `"[redacted]"`. Returns the input as-is when redaction is
 * disabled (`capturePII: true`) or no PII tags are registered;
 * otherwise returns a deep clone with the leaf values rewritten. (C2)
 */
export function redactWhenSpec(
  spec: unknown,
  capturePII: boolean,
  piiTaggedFacts: ReadonlySet<string>,
): unknown {
  if (capturePII || piiTaggedFacts.size === 0) return spec;
  if (spec === null || typeof spec !== "object") return spec;

  // Deep-clone so we don't mutate the user's source predicate. JSON
  // round-trip handles plain objects + arrays cheaply; predicates are
  // already JSON-safe (validatePredicate enforces this).
  let cloned: unknown;
  try {
    cloned = JSON.parse(JSON.stringify(spec));
  } catch {
    // Spec contained something non-serializable; bail rather than crash.
    return spec;
  }

  walkPredicate(cloned, {
    operator(factPath, op, _operand, operandPath) {
      if (!piiTaggedFacts.has(factPath)) return;
      // Navigate cloned tree to operandPath and replace value.
      replaceAtPath(cloned, operandPath, "[redacted]");
      void op;
    },
    literal(factPath) {
      if (!piiTaggedFacts.has(factPath)) return;
      // Replace bare-value leaf at this factPath.
      replaceAtPath(cloned, factPath, "[redacted]");
    },
  });

  return cloned;
}
