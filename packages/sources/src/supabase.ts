/**
 * @directive-run/sources/supabase
 *
 * Bridges Supabase realtime channels into the Directive `source` primitive.
 * One factory call → one declared source on your module → the engine
 * owns the subscription lifecycle. No `useEffect` bridges, no manual
 * cleanup, no leaked channels.
 *
 * @example Wire a Supabase realtime channel for a single game row
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
 *   events: { GAME_UPDATED: (f, p) => { f.snapshot = p.snapshot; } },
 *   sources: {
 *     gameChannel: sourceFromSupabaseChannel({
 *       client: supabase,
 *       channel: `game:${gameId}`,
 *       events: [{
 *         table: 'games',
 *         filter: `id=eq.${gameId}`,
 *         event: 'UPDATE',
 *         map: (row) => ({ name: 'GAME_UPDATED', payload: { snapshot: mapRow(row) } }),
 *       }],
 *     }),
 *   },
 * });
 * ```
 */

import type { SourceDef, SourcePublish } from "@directive-run/core";

// ============================================================================
// Type stubs for the Supabase API surface we touch
// ============================================================================

// We deliberately do NOT import from `@supabase/supabase-js` so this file
// type-checks without the optional peerDependency installed. The runtime
// shape matches Supabase's RealtimeChannel + SupabaseClient surfaces;
// consumers who install the package get full typing through their own
// `createClient(...)` instance.

interface SupabasePayload {
  schema: string;
  table: string;
  commit_timestamp?: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

type SupabaseHandler = (payload: SupabasePayload) => void;

interface SupabasePresencePayload {
  event: "sync" | "join" | "leave";
  // Presence state shape is user-defined per channel; surface as an opaque
  // record so the consumer's `map` can cast to its own shape.
  newPresences?: Record<string, unknown>[];
  leftPresences?: Record<string, unknown>[];
  // `sync` events carry the full presence snapshot.
  state?: Record<string, Record<string, unknown>[]>;
}

interface SupabaseBroadcastPayload {
  type: "broadcast";
  event: string;
  // Broadcast payload is opaque user data per channel.
  payload: Record<string, unknown>;
}

interface SupabaseRealtimeChannel {
  on(
    type: "postgres_changes",
    filter: {
      event: "INSERT" | "UPDATE" | "DELETE" | "*";
      schema?: string;
      table?: string;
      filter?: string;
    },
    handler: SupabaseHandler,
  ): SupabaseRealtimeChannel;
  on(
    type: "presence",
    filter: { event: "sync" | "join" | "leave" },
    handler: (payload: SupabasePresencePayload) => void,
  ): SupabaseRealtimeChannel;
  on(
    type: "broadcast",
    filter: { event: string },
    handler: (payload: SupabaseBroadcastPayload) => void,
  ): SupabaseRealtimeChannel;
  subscribe(callback?: (status: string) => void): SupabaseRealtimeChannel;
  unsubscribe(): Promise<"ok" | "timed out" | "error">;
}

interface SupabaseRealtimeClient {
  channel(name: string): SupabaseRealtimeChannel;
  removeChannel(
    channel: SupabaseRealtimeChannel,
  ): Promise<"ok" | "timed out" | "error">;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Declarative mapping from a Supabase `postgres_changes` event to a typed
 * Directive event publish. `map` runs on every matching payload; return
 * `null` to skip publishing for that row (useful for soft-filters).
 */
export interface SupabaseEventBinding {
  /** Postgres event type. Use `'*'` for any. */
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Table to listen on. */
  table: string;
  /** Postgres schema. Default `'public'`. */
  schema?: string;
  /** Server-side filter expression (e.g. `id=eq.123`). */
  filter?: string;
  /**
   * Map the Supabase payload to a typed Directive event. Return `null` to
   * skip this publish (e.g. filter out updates that don't affect the
   * tracked fields).
   */
  map: (
    payload: SupabasePayload,
  ) => { name: string; payload: Record<string, unknown> } | null;
}

/**
 * Declarative mapping from a Supabase presence event (`sync`, `join`,
 * `leave`) to a typed Directive event publish. Optional — channels that
 * don't use presence can omit the `presence` array on options.
 */
export interface SupabasePresenceBinding {
  /** Presence event to subscribe to. */
  event: "sync" | "join" | "leave";
  /**
   * Map the presence payload to a typed Directive event. Return `null`
   * to skip publishing.
   */
  map: (
    payload: SupabasePresencePayload,
  ) => { name: string; payload: Record<string, unknown> } | null;
}

/**
 * Declarative mapping from a Supabase broadcast event to a typed
 * Directive event publish. Optional — channels that don't use broadcast
 * can omit the `broadcast` array on options.
 */
export interface SupabaseBroadcastBinding {
  /** Broadcast event name. Use `'*'` to listen to all broadcast events. */
  event: string;
  /**
   * Map the broadcast payload to a typed Directive event. Return `null`
   * to skip publishing.
   */
  map: (
    payload: SupabaseBroadcastPayload,
  ) => { name: string; payload: Record<string, unknown> } | null;
}

export interface SupabaseChannelOptions {
  /** The Supabase client (`createClient(url, key)`). */
  client: SupabaseRealtimeClient;
  /** Channel name. Must be unique per system instance. */
  channel: string;
  /** One or more `postgres_changes` event bindings on this channel. */
  events: readonly SupabaseEventBinding[];
  /**
   * Optional presence bindings. The Supabase Realtime presence channel
   * publishes `sync`/`join`/`leave` events independently from
   * `postgres_changes`; consumers wiring a presence-based feature
   * (lobby roster, typing indicators, etc.) declare bindings here.
   */
  presence?: readonly SupabasePresenceBinding[];
  /**
   * Optional broadcast bindings. The Supabase Realtime broadcast surface
   * lets clients fan out arbitrary JSON payloads on a channel
   * (chat-style messaging, custom RPC). Consumers wiring those features
   * declare bindings here.
   */
  broadcast?: readonly SupabaseBroadcastBinding[];
  /**
   * Optional status hook. Fires with Supabase's connection status
   * (`'SUBSCRIBED'`, `'CHANNEL_ERROR'`, `'TIMED_OUT'`, `'CLOSED'`).
   * Wire to your logging / health-check telemetry.
   */
  onStatus?: (status: string) => void;
  /**
   * Optional pii-redaction hook applied to every payload row BEFORE the
   * `map` callback runs. Useful for blanking columns the schema author
   * marked as PII when the consumer's `createFactPIIGuardrail` cannot
   * reach the field shape (e.g. nested Supabase JSON column).
   *
   * Default: identity (no redaction).
   */
  redactRow?: (row: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Build a `SourceDef` that subscribes to a Supabase realtime channel
 * and publishes typed Directive events for each matching row change.
 *
 * @returns a `SourceDef` to drop into a module's `sources:` map.
 */
export function sourceFromSupabaseChannel(
  options: SupabaseChannelOptions,
): SourceDef {
  const {
    client,
    channel: channelName,
    events,
    presence,
    broadcast,
    onStatus,
    redactRow = (row) => row,
  } = options;

  return {
    attach: (publish: SourcePublish) => {
      // Build the channel + register every binding. Each binding's
      // `map` runs on every matching row; the source publishes the
      // returned Directive event.
      let chan = client.channel(channelName);
      for (const binding of events) {
        chan = chan.on(
          "postgres_changes",
          {
            event: binding.event,
            schema: binding.schema ?? "public",
            table: binding.table,
            ...(binding.filter !== undefined ? { filter: binding.filter } : {}),
          },
          (payload) => {
            // Redact at the row boundary so the `map` callback (which
            // typically embeds row fields into the event payload) sees
            // only the redacted version. The fact-level
            // createFactPIIGuardrail is the second line of defense.
            const safe: SupabasePayload = {
              ...payload,
              new: redactRow(payload.new),
              old: redactRow(payload.old),
            };
            const result = binding.map(safe);
            if (result === null) return;
            publish(result.name, result.payload);
          },
        );
      }

      // Presence bindings (optional). Registered separately from
      // `postgres_changes` so consumers wiring lobby/roster/typing
      // features get the sync/join/leave events Supabase publishes on
      // the same channel. Each binding's `map` runs on every matching
      // event; the source publishes the returned Directive event.
      if (presence) {
        for (const binding of presence) {
          chan = chan.on("presence", { event: binding.event }, (payload) => {
            const result = binding.map(payload);
            if (result === null) return;
            publish(result.name, result.payload);
          });
        }
      }

      // Broadcast bindings (optional). Same pattern — fan out custom JSON
      // payloads the channel emits via the broadcast surface.
      if (broadcast) {
        for (const binding of broadcast) {
          chan = chan.on("broadcast", { event: binding.event }, (payload) => {
            const result = binding.map(payload);
            if (result === null) return;
            publish(result.name, result.payload);
          });
        }
      }

      // Open the subscription. `subscribe()` is async on the wire but
      // returns the channel synchronously — the status callback fires
      // once the realtime server acknowledges. Our `attach` contract is
      // sync; we capture the status callback for the consumer.
      chan.subscribe((status) => onStatus?.(status));

      // Cleanup: unsubscribe via the client so the internal channel
      // registry is cleared. `removeChannel` returns a Promise; per RFC
      // 0009 we await it so `system.stopAsync()` does not resolve
      // before the broker has dropped the subscription. Without this
      // await, a `start → stopAsync → start` cycle double-subscribes
      // (the broker still holds the old channel when the new attach
      // races in). Engines pre-RFC-0009 that call the legacy sync
      // `cleanupAll` ignore the returned promise — that's the same
      // fire-and-forget behavior as before, just with the broker drop
      // observable to consumers who DO use `stopAsync`.
      return async () => {
        await client.removeChannel(chan);
      };
    },
    meta: {
      label: `Supabase realtime: ${channelName}`,
      tags: ["source", "supabase"],
    },
  };
}
