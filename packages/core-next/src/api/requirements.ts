/**
 * Requirements (L2): what a constraint asks for, and the id that says
 * two asks are the same one.
 *
 * The id is a contract (plan, "resumable resolvers"): it is built from the
 * requirement's content, so the same ask in two passes, two processes or
 * after a restore has the same id. Default: the type, a colon, and the other
 * fields as sorted JSON (1.35's `stableStringify`). A resolver's `key`
 * replaces it for its requirement type.
 */

export interface Requirement {
  type: string;
  [field: string]: unknown;
}

/** A requirement as the pass tracks it: its id and the constraint that asked. */
export interface RequirementWithId {
  requirement: Requirement;
  id: string;
  fromConstraint: string;
}

export type RequirementKeyFn = (req: Requirement) => string;

/** 1.35's stableStringify: sorted keys, tagged Date/RegExp/Map/Set, cycles marked. */
export function stableStringify(value: unknown, maxDepth = 50): string {
  const seen = new WeakSet<object>();
  const go = (v: unknown, depth: number): string => {
    if (depth > maxDepth) {
      return '"[max depth exceeded]"';
    }
    if (v === null || v === undefined) {
      return String(v);
    }
    switch (typeof v) {
      case "bigint":
        return `${v}n`;
      case "string":
        return JSON.stringify(v);
      case "number":
      case "boolean":
        return String(v);
      case "function":
      case "symbol":
        return `"[${typeof v}]"`;
    }
    if (v instanceof Date) {
      return `D:${v.toISOString()}`;
    }
    if (v instanceof RegExp) {
      return `R:${v.source}:${v.flags}`;
    }
    if (v instanceof Map) {
      return `M:${go([...v.entries()].sort(), depth + 1)}`;
    }
    if (v instanceof Set) {
      return `S:${go([...v].sort(), depth + 1)}`;
    }
    const obj = v as Record<string, unknown>;
    if (seen.has(obj)) {
      return '"[circular]"';
    }
    seen.add(obj);
    const out = Array.isArray(obj)
      ? `[${obj.map((item) => go(item, depth + 1)).join(",")}]`
      : `{${Object.keys(obj)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${go(obj[k], depth + 1)}`)
          .join(",")}}`;
    seen.delete(obj);

    return out;
  };

  return go(value, 0);
}

/** The requirement's id: its resolver's `key`, else type plus sorted fields. */
export function requirementId(
  req: Requirement,
  keyFn?: RequirementKeyFn,
): string {
  if (keyFn) {
    return keyFn(req);
  }
  const { type, ...rest } = req;

  return `${type}:${stableStringify(rest)}`;
}

/** 1.35's public name for {@link requirementId}. */
export const generateRequirementId = requirementId;

/** A requirement builder for one type: `req("LOAD")({ id: 1 })`. */
export function req<T extends string>(type: T) {
  return <P extends Record<string, unknown>>(props: P) =>
    ({ type, ...props }) as Requirement & { type: T } & P;
}

/** True when `req` is a requirement of `type`. */
export function isRequirementType<T extends string>(
  req: Requirement,
  type: T,
): req is Requirement & { type: T } {
  return req.type === type;
}

/** A resolver `requirement` predicate for one type. */
export function forType<T extends string>(
  type: T,
): (req: Requirement) => req is Requirement & { type: T } {
  return (req): req is Requirement & { type: T } => req.type === type;
}

/** 1.35's RequirementSet: requirements by id, the first added wins. */
export class RequirementSet {
  private map_ = new Map<string, RequirementWithId>();

  add(req: RequirementWithId): void {
    if (!this.map_.has(req.id)) {
      this.map_.set(req.id, req);
    }
  }

  remove(id: string): boolean {
    return this.map_.delete(id);
  }

  has(id: string): boolean {
    return this.map_.has(id);
  }

  get(id: string): RequirementWithId | undefined {
    return this.map_.get(id);
  }

  all(): RequirementWithId[] {
    return [...this.map_.values()];
  }

  ids(): string[] {
    return [...this.map_.keys()];
  }

  get size(): number {
    return this.map_.size;
  }

  clear(): void {
    this.map_.clear();
  }

  clone(): RequirementSet {
    const copy = new RequirementSet();
    for (const req of this.map_.values()) {
      copy.add(req);
    }

    return copy;
  }

  /** Added: only in this set. Removed: only in `other`. */
  diff(other: RequirementSet): {
    added: RequirementWithId[];
    removed: RequirementWithId[];
  } {
    const added = this.all().filter((req) => !other.has(req.id));
    const removed = other.all().filter((req) => !this.has(req.id));

    return { added, removed };
  }
}
