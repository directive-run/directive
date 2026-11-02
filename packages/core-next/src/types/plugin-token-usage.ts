/**
 * Copied from 1.35 (packages/core/src/plugins/token-usage.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

/**
 * The canonical shape of a provider-reported token usage, and the one function
 * that produces it.
 *
 * Two spellings of the cache-write count exist in the wild. `cacheWriteTokens`
 * matches the rate that prices it (`cacheWritePerMillion`) and is canonical
 * here; `cacheCreationTokens` follows Anthropic's wire format and is the
 * documented alias. Every consumer that turns token counts into money or into
 * metrics routes through {@link normalizeTokenUsage}, so neither spelling is
 * read anywhere else — teaching each consumer both spellings is how one
 * consumer came to know only one of them, and a run reporting ten million
 * cache-write tokens was recorded as having written none.
 *
 * @module
 */

/**
 * A token usage read once, with the cache-write alias already resolved.
 *
 * A field is `undefined` when the source did not carry it as an own property,
 * and `NaN` when it carried one holding something other than a number. The two
 * are deliberately distinct: absent means "the provider did not report this
 * class", which every consumer reads as zero, while present-but-not-a-number
 * means "the provider reported something no ledger can use", which every
 * consumer must reject. Collapsing both to `undefined` is what let a
 * `cacheReadTokens` of `"10000000"` bill as zero while the same string in
 * `inputTokens` was correctly refused.
 *
 * No range validation happens here — a consumer that bills money and a consumer
 * that counts metrics reject different things, and both reject after
 * normalization, not during it.
 */
export interface NormalizedTokenUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly cacheReadTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
}
