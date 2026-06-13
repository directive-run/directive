/**
 * @directive-run/sources
 *
 * Source adapters for Directive — wrap external event streams (Supabase
 * realtime, Cloudflare DO alarms, WebSocket, Sentry, etc.) as typed
 * `source` primitives. Import vendor adapters from the per-vendor
 * subpath; only the vendors you import need their peer-dependency
 * installed.
 *
 * @example Supabase realtime channel as a source
 * ```ts
 * import { createClient } from '@supabase/supabase-js';
 * import { createModule, t } from '@directive-run/core';
 * import { sourceFromSupabaseChannel } from '@directive-run/sources/supabase';
 *
 * const supabase = createClient(url, key);
 *
 * const gameUpdates = createModule('gameUpdates', {
 *   schema: {
 *     facts: { snapshot: t.object<GameSnapshot>().nullable() },
 *     events: { GAME_UPDATED: { snapshot: t.object<GameSnapshot>() } },
 *   },
 *   init: (f) => { f.snapshot = null; },
 *   events: {
 *     GAME_UPDATED: (f, p) => { f.snapshot = p.snapshot; },
 *   },
 *   sources: {
 *     gameChannel: sourceFromSupabaseChannel({
 *       client: supabase,
 *       channel: `game:${gameId}`,
 *       events: [
 *         { table: 'games', filter: `id=eq.${gameId}`, event: 'UPDATE',
 *           map: (row) => ({ name: 'GAME_UPDATED', payload: { snapshot: mapRow(row) } }) },
 *       ],
 *     }),
 *   },
 * });
 * ```
 *
 * @example Cloudflare DO alarm as a source
 * ```ts
 * import { sourceFromDOAlarm } from '@directive-run/sources/cloudflare';
 *
 * // Inside your DurableObject class:
 * const ticker = createModule('ticker', {
 *   schema: {
 *     facts: { lastTick: t.number() },
 *     events: { TICK: { at: t.number() } },
 *   },
 *   init: (f) => { f.lastTick = 0; },
 *   events: { TICK: (f, p) => { f.lastTick = p.at; } },
 *   sources: {
 *     alarm: sourceFromDOAlarm({
 *       storage: this.state.storage,
 *       intervalMs: 30_000,
 *       eventName: 'TICK',
 *       payload: () => ({ at: Date.now() }),
 *     }),
 *   },
 * });
 * ```
 *
 * @packageDocumentation
 */

// The umbrella re-exports nothing concrete — adapters live at the
// per-vendor subpaths so the optional peerDependency isn't pulled
// transitively into a consumer that only uses one adapter.
//
// Import from:
//   @directive-run/sources/supabase
//   @directive-run/sources/cloudflare
//
// The subpath import is intentional: tree-shakers cannot reliably
// eliminate Supabase's runtime if it's re-exported from the umbrella,
// but a direct subpath import lands only the bytes that subpath
// actually uses.

export const VERSION = "0.3.0";
