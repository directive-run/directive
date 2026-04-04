---
"@directive-run/core": minor
"@directive-run/ai": minor
---

Add DefinitionMeta — optional metadata for all 7 definition types

**Core (`@directive-run/core`):**
- `DefinitionMeta` type: label, description, category, color, tags, extensible index signature
- `meta?` on modules, facts (via `t.number().meta()`), events (`{ handler, meta }`), constraints, resolvers, effects, derivations (`{ compute, meta }`)
- `system.meta` O(1) accessor: module, fact, event, constraint, resolver, effect, derivation
- `system.meta.byCategory()` and `system.meta.byTag()` bulk queries with `MetaMatch` return type
- `system.inspect()` surfaces meta on all 7 definition types + modules array
- `system.explain()` uses meta.label and meta.description in causal chains
- Trace entries enriched with inline meta on all sub-arrays (factChanges, constraintsHit, resolversStarted, resolversCompleted, resolversErrored, effectsRun, derivationsRecomputed)
- All meta frozen at registration via Object.create(null) + Object.freeze (prototype pollution defense)
- Devtools graph renders meta.label for node labels, meta.color for node colors, meta.description as SVG tooltips

**AI (`@directive-run/ai`):**
- `formatSystemMeta(inspection)` — formats SystemInspection into LLM-readable markdown context
- `toAIContext(system)` — convenience wrapper
- `metaContext: true` option on both single-agent and multi-agent orchestrators
- Token-efficient: only includes annotated definitions, omits empty sections
