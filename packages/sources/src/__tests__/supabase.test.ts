/**
 * Tests for `sourceFromSupabaseChannel` — Supabase realtime → typed
 * Directive event publish.
 *
 * Uses a fake Supabase client (matches the documented runtime shape)
 * so the optional peerDep doesn't need to be installed at test time.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { sourceFromSupabaseChannel } from "../supabase.js";

interface FakeChannel {
  bindings: Array<{
    type: string;
    filter: { event: string; schema?: string; table?: string; filter?: string };
    handler: (payload: {
      schema: string;
      table: string;
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => void;
  }>;
  statusCallback?: (status: string) => void;
  fireEvent: (
    table: string,
    eventType: "INSERT" | "UPDATE" | "DELETE",
    next: Record<string, unknown>,
    prev?: Record<string, unknown>,
  ) => void;
}

function makeFakeClient(): {
  client: {
    channel: (name: string) => FakeChannel;
    removeChannel: (chan: FakeChannel) => Promise<"ok">;
  };
  lastChannel: FakeChannel | null;
} {
  let lastChannel: FakeChannel | null = null;
  return {
    get lastChannel() {
      return lastChannel;
    },
    client: {
      channel(_name: string) {
        const chan: FakeChannel = {
          bindings: [],
          fireEvent(table, eventType, next, prev = {}) {
            for (const b of this.bindings) {
              const wantsAny = b.filter.event === "*";
              const matches =
                (wantsAny || b.filter.event === eventType) &&
                (b.filter.table === undefined || b.filter.table === table);
              if (matches) {
                b.handler({
                  schema: "public",
                  table,
                  eventType,
                  new: next,
                  old: prev,
                });
              }
            }
          },
        };
        // The on() method returns `this` (the channel) per Supabase's
        // fluent API.
        (chan as unknown as { on: unknown }).on = function (
          this: FakeChannel,
          type: string,
          filter: FakeChannel["bindings"][number]["filter"],
          handler: FakeChannel["bindings"][number]["handler"],
        ) {
          this.bindings.push({ type, filter, handler });
          return this;
        };
        (chan as unknown as { subscribe: unknown }).subscribe = function (
          this: FakeChannel,
          callback?: (status: string) => void,
        ) {
          this.statusCallback = callback;
          callback?.("SUBSCRIBED");
          return this;
        };
        (chan as unknown as { unsubscribe: unknown }).unsubscribe = async () =>
          "ok" as const;
        lastChannel = chan;
        return chan;
      },
      async removeChannel(_chan: FakeChannel) {
        return "ok";
      },
    },
  };
}

describe("sourceFromSupabaseChannel", () => {
  it("publishes a typed event when a matching postgres_changes payload arrives", () => {
    const fake = makeFakeClient();
    const module = createModule("game", {
      schema: {
        facts: { snapshot: t.string() },
        events: { GAME_UPDATED: { snapshot: t.string() } },
      },
      init: (f) => {
        f.snapshot = "";
      },
      events: {
        GAME_UPDATED: (f, p) => {
          f.snapshot = p.snapshot;
        },
      },
      sources: {
        game: sourceFromSupabaseChannel({
          client: fake.client as unknown as Parameters<
            typeof sourceFromSupabaseChannel
          >[0]["client"],
          channel: "game:abc",
          events: [
            {
              event: "UPDATE",
              table: "games",
              filter: "id=eq.abc",
              map: (payload) => ({
                name: "GAME_UPDATED",
                payload: { snapshot: String(payload.new.snapshot) },
              }),
            },
          ],
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    expect(fake.lastChannel).not.toBeNull();
    fake.lastChannel?.fireEvent("games", "UPDATE", { snapshot: "live-1" });
    expect(system.facts.snapshot).toBe("live-1");
    system.destroy();
  });

  it("returning null from `map` skips the publish", () => {
    const fake = makeFakeClient();
    const eventHandler = vi.fn();
    const module = createModule("filtered", {
      schema: {
        facts: { v: t.number() },
        events: { CHANGE: { v: t.number() } },
      },
      init: (f) => {
        f.v = 0;
      },
      events: {
        CHANGE: (f, p) => {
          eventHandler();
          f.v = p.v;
        },
      },
      sources: {
        soft: sourceFromSupabaseChannel({
          client: fake.client as unknown as Parameters<
            typeof sourceFromSupabaseChannel
          >[0]["client"],
          channel: "filtered:1",
          events: [
            {
              event: "UPDATE",
              table: "rows",
              // Only publish when the row contains a positive value.
              map: (payload) => {
                if (typeof payload.new.v !== "number" || payload.new.v <= 0)
                  return null;
                return {
                  name: "CHANGE",
                  payload: { v: payload.new.v as number },
                };
              },
            },
          ],
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    fake.lastChannel?.fireEvent("rows", "UPDATE", { v: -1 });
    fake.lastChannel?.fireEvent("rows", "UPDATE", { v: 5 });
    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(system.facts.v).toBe(5);
    system.destroy();
  });

  it("redactRow runs BEFORE map so PII never reaches the event payload", () => {
    const fake = makeFakeClient();
    const module = createModule("safe", {
      schema: {
        facts: { display: t.string() },
        events: { UPDATED: { display: t.string() } },
      },
      init: (f) => {
        f.display = "";
      },
      events: {
        UPDATED: (f, p) => {
          f.display = p.display;
        },
      },
      sources: {
        s: sourceFromSupabaseChannel({
          client: fake.client as unknown as Parameters<
            typeof sourceFromSupabaseChannel
          >[0]["client"],
          channel: "safe:1",
          events: [
            {
              event: "UPDATE",
              table: "customers",
              map: (payload) => ({
                name: "UPDATED",
                payload: { display: String(payload.new.email) },
              }),
            },
          ],
          redactRow: (row) => {
            if (typeof row.email !== "string") return row;
            return { ...row, email: "[EMAIL]" };
          },
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    fake.lastChannel?.fireEvent("customers", "UPDATE", {
      email: "leak@example.com",
    });
    expect(system.facts.display).toBe("[EMAIL]");
    system.destroy();
  });

  it("system.stop() unsubscribes the channel", () => {
    const fake = makeFakeClient();
    const handler = vi.fn();
    const module = createModule("teardown", {
      schema: {
        facts: { v: t.number() },
        events: { CHANGE: { v: t.number() } },
      },
      init: (f) => {
        f.v = 0;
      },
      events: {
        CHANGE: (f, p) => {
          handler();
          f.v = p.v;
        },
      },
      sources: {
        s: sourceFromSupabaseChannel({
          client: fake.client as unknown as Parameters<
            typeof sourceFromSupabaseChannel
          >[0]["client"],
          channel: "teardown:1",
          events: [
            {
              event: "UPDATE",
              table: "x",
              map: (p) => ({
                name: "CHANGE",
                payload: { v: p.new.v as number },
              }),
            },
          ],
        }),
      },
    });
    const system = createSystem({ module });
    system.start();
    fake.lastChannel?.fireEvent("x", "UPDATE", { v: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    system.stop();
    // After stop the source's dispatch is muted by the engine's
    // !state.isRunning guard. The fake channel still receives the
    // event, but the publish dispatch drops at the engine boundary.
    fake.lastChannel?.fireEvent("x", "UPDATE", { v: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    system.destroy();
  });
});
