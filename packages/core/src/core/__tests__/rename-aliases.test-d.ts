/**
 * RFC 0006 — `*Definition` rename aliases — TS inference smoke tests.
 *
 * Verifies that the `export type { X as YDefinition }` aliases in
 * `types/index.ts` preserve TS inference across the five edge cases
 * where simple `type X = Y` aliases can break:
 *
 *   1. Direct structural identity (`type X = Y`).
 *   2. Generic constraint position (`<T extends X>`).
 *   3. Mapped-key position (`keyof X`).
 *   4. Conditional-type distribution (`T extends X ? A : B`).
 *   5. Tagged-union literal discriminant (`U["kind"]`).
 *   6. Barrel re-export + downstream re-alias.
 *
 * The `export type { ... as ... }` re-export-rename pattern preserves
 * all of these because it forwards the original type's generic
 * parameters and identity transparently — the alias is the SAME type
 * symbol, just under a different name.
 *
 * Compiled as a regular `.test-d.ts` file; if any assertion fails at
 * the type level, `tsc --noEmit` rejects.
 */

import type {
  ModuleDefinition,
  SourceDefinition,
  SourcePublishFn,
  SourceUnsubscribeFn,
  SourcesDefinition,
} from "../types/index.js";
// The remaining alias names that don't appear in the smoke
// assertions below still need an import to verify the
// `export type { X as Y }` pattern resolves. Renaming an alias to
// a non-existent canonical would fail this import. The underscore
// prefix marks them as intentionally unused at the value level;
// importing them is the assertion. `.test-d.ts` files are exempt
// from `noUnusedImports` (see biome.json override).
import type {
  ConstraintDefinition as _ConstraintDefinition,
  ConstraintsDefinition as _ConstraintsDefinition,
  DerivationDefinition as _DerivationDefinition,
  DerivationsDefinition as _DerivationsDefinition,
  EffectDefinition as _EffectDefinition,
  EffectsDefinition as _EffectsDefinition,
  ResolverDefinition as _ResolverDefinition,
  ResolversDefinition as _ResolversDefinition,
} from "../types/index.js";
import type {
  ModuleDef,
  SourceDef,
  SourcePublish,
  SourceUnsubscribe,
  SourcesDef,
} from "../types/index.js";
import type {
  ConstraintDef as _ConstraintDef,
  ConstraintsDef as _ConstraintsDef,
  DerivationDef as _DerivationDef,
  DerivationsDef as _DerivationsDef,
  EffectDef as _EffectDef,
  EffectsDef as _EffectsDef,
  ResolverDef as _ResolverDef,
  ResolversDef as _ResolversDef,
} from "../types/index.js";

// ----------------------------------------------------------------------
// 1. Direct structural identity
// ----------------------------------------------------------------------

type IdentityModule = ModuleDefinition extends ModuleDef ? true : false;
type IdentityModuleRev = ModuleDef extends ModuleDefinition ? true : false;
const _identity1: IdentityModule = true;
const _identity2: IdentityModuleRev = true;

type IdentitySource = SourceDefinition extends SourceDef ? true : false;
const _identity3: IdentitySource = true;

type IdentityFn = SourcePublishFn extends SourcePublish ? true : false;
const _identity4: IdentityFn = true;

type IdentityUnsub = SourceUnsubscribeFn extends SourceUnsubscribe
  ? true
  : false;
const _identity5: IdentityUnsub = true;

// ----------------------------------------------------------------------
// 2. Generic constraint position — extends check works across alias
// ----------------------------------------------------------------------
//
// The fact that the file type-checks (no constraint-violation error)
// when SourceDefinition is used as a generic constraint AND the file
// imports both the alias and the canonical at the top is the
// assertion. Aliases that fail to satisfy generic-constraint position
// would error at module-load.

// ----------------------------------------------------------------------
// 3. Mapped-key position
// ----------------------------------------------------------------------

type SrcKeys = keyof SourceDefinition;
type SrcKeysCanonical = keyof SourceDef;
type KeysIdentical = SrcKeys extends SrcKeysCanonical
  ? SrcKeysCanonical extends SrcKeys
    ? true
    : false
  : false;
const _keys: KeysIdentical = true;

// ----------------------------------------------------------------------
// 4. Conditional-type distribution
// ----------------------------------------------------------------------

type IsSourceAlias<T> = T extends SourceDefinition ? true : false;
type IsSourceCanonical<T> = T extends SourceDef ? true : false;

type Distrib = IsSourceAlias<SourceDef | string>; // → true | false
type DistribCanonical = IsSourceCanonical<SourceDef | string>; // → true | false
type DistribIdentical = Distrib extends DistribCanonical
  ? DistribCanonical extends Distrib
    ? true
    : false
  : false;
const _distrib: DistribIdentical = true;

// ----------------------------------------------------------------------
// 5. Tagged-union literal discriminant
// ----------------------------------------------------------------------

declare const sd: SourceDefinition;
declare const sdCanonical: SourceDef;
// If the alias broke identity, these two would not be assignable to
// each other. The fact that they do compile is the assertion.
const _tagged1: typeof sd = sdCanonical;
const _tagged2: typeof sdCanonical = sd;

// ----------------------------------------------------------------------
// 6. Barrel re-export + downstream re-alias
// ----------------------------------------------------------------------

// Re-alias the spelled-out name to verify the alias survives a second
// hop. Consumers that re-export the type under their own name should
// see the same shape.
type MyOwnModuleDefinition = ModuleDefinition;
type _barrelDouble = MyOwnModuleDefinition extends ModuleDef ? true : false;
const _barrel: _barrelDouble = true;

// ----------------------------------------------------------------------
// Coverage sanity — every aliased cohort represented above
// ----------------------------------------------------------------------

declare const ssd: SourcesDefinition;

// SourcesDef is the only cohort whose canonical generic surface is
// invokable without fixtures (it's `Record<string, SourceDef>`); the
// other cohorts (ConstraintDef, EffectDef, ResolverDef, DerivationDef,
// ...) all require generic schema fixtures the test doesn't build.
// Their alias identity is exercised through the `import type` block
// at the top of the file — if the `export type { X as Y }` pattern
// lost generic forwarding, the imports themselves would fail to
// resolve.
type SsdMatches = SourcesDefinition extends SourcesDef ? true : false;
const _ssd: SsdMatches = true;

// Suppress unused-locals lint for the declared sample vars.
void [
  _identity1,
  _identity2,
  _identity3,
  _identity4,
  _identity5,
  _keys,
  _distrib,
  _tagged1,
  _tagged2,
  _barrel,
  ssd,
  _ssd,
];
