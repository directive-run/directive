/**
 * Meta Context - Format system metadata for LLM consumption
 *
 * Reads system.inspect() and produces a concise, structured context string
 * that helps LLMs understand the system's constraints, resolvers, modules,
 * and annotated facts.
 *
 * @example
 * ```typescript
 * import { toAIContext } from "@directive-run/ai";
 *
 * const context = toAIContext(system);
 * // Use in custom prompt building
 * ```
 */

import type { SystemInspection, DefinitionMeta } from "@directive-run/core";

// ============================================================================
// Format Helpers
// ============================================================================

/** Format tags/category as bracketed suffix: [auth, critical] */
function formatTags(meta: DefinitionMeta): string {
  const parts: string[] = [];
  if (meta.category) parts.push(meta.category);
  if (meta.tags?.length) {
    for (const tag of meta.tags) {
      if (tag !== meta.category) parts.push(tag);
    }
  }

  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

/** Format a single definition entry: "id (Label): Description [tags]" */
function formatEntry(
  id: string,
  meta: DefinitionMeta | undefined,
): string | null {
  if (!meta) return null;

  const label = meta.label ?? id;
  const desc = meta.description ? `: ${meta.description}` : "";
  const tags = formatTags(meta);
  const prefix = meta.label ? `${id} (${label})` : id;

  return `- ${prefix}${desc}${tags}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Format a SystemInspection into a concise context string for LLM consumption.
 *
 * Only includes definitions that have meta annotations. Sections with no
 * annotated definitions are omitted entirely to minimize token usage.
 *
 * @param inspection - Result of system.inspect()
 * @returns Formatted context string, or empty string if no meta exists
 */
export function formatSystemMeta(inspection: SystemInspection): string {
  const sections: string[] = [];

  // Modules
  const moduleEntries = inspection.modules
    .map((m) => formatEntry(m.id, m.meta))
    .filter(Boolean);
  if (moduleEntries.length > 0) {
    sections.push(`### Modules\n${moduleEntries.join("\n")}`);
  }

  // Active constraints (only those with meta)
  const activeConstraints = inspection.constraints
    .filter((c) => c.active && c.meta)
    .map((c) => formatEntry(c.id, c.meta))
    .filter(Boolean);
  if (activeConstraints.length > 0) {
    sections.push(`### Active Constraints\n${activeConstraints.join("\n")}`);
  }

  // Unmet requirements (with constraint label if available)
  if (inspection.unmet.length > 0) {
    const constraintMetaMap = new Map(
      inspection.constraints
        .filter((c) => c.meta?.label)
        .map((c) => [c.id, c.meta!.label!]),
    );

    const reqEntries = inspection.unmet.map((req) => {
      const constraintLabel =
        constraintMetaMap.get(req.fromConstraint) ?? req.fromConstraint;

      return `- ${req.requirement.type} — from "${constraintLabel}"`;
    });
    sections.push(`### Unmet Requirements\n${reqEntries.join("\n")}`);
  }

  // Resolver definitions (only those with meta)
  const resolverEntries = inspection.resolverDefs
    .map((r) => formatEntry(r.id, r.meta))
    .filter(Boolean);
  if (resolverEntries.length > 0) {
    sections.push(`### Resolvers\n${resolverEntries.join("\n")}`);
  }

  // Events (only those with meta)
  const eventEntries = inspection.events
    .map((e) => formatEntry(e.name, e.meta))
    .filter(Boolean);
  if (eventEntries.length > 0) {
    sections.push(`### Events\n${eventEntries.join("\n")}`);
  }

  // Facts with annotations (only those with meta)
  const factEntries = inspection.facts
    .map((f) => formatEntry(f.key, f.meta))
    .filter(Boolean);
  if (factEntries.length > 0) {
    sections.push(`### Annotated Facts\n${factEntries.join("\n")}`);
  }

  // Effects (only those with meta)
  const effectEntries = inspection.effects
    .map((e) => formatEntry(e.id, e.meta))
    .filter(Boolean);
  if (effectEntries.length > 0) {
    sections.push(`### Effects\n${effectEntries.join("\n")}`);
  }

  // Derivations (only those with meta)
  const derivationEntries = inspection.derivations
    .map((d) => formatEntry(d.id, d.meta))
    .filter(Boolean);
  if (derivationEntries.length > 0) {
    sections.push(`### Derivations\n${derivationEntries.join("\n")}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `## System Context\n\n${sections.join("\n\n")}`;
}

/**
 * Convenience: inspect a system and format its metadata for LLM context.
 *
 * @param system - Any object with an inspect() method returning SystemInspection
 * @returns Formatted context string, or empty string if no meta exists
 *
 * @example
 * ```typescript
 * const context = toAIContext(system);
 * if (context) {
 *   agent.instructions += "\n\n" + context;
 * }
 * ```
 */
export function toAIContext(system: {
  inspect(): SystemInspection;
}): string {
  return formatSystemMeta(system.inspect());
}
