// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";
import { persistQueryCache } from "../persist";

// Mock storage
function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    _store: store,
  };
}

// Mock system with query facts
function createMockSystem(facts: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(facts));
  return {
    facts: {
      $store: {
        toObject: () => Object.fromEntries(store),
        set: (key: string, value: unknown) => store.set(key, value),
        get: (key: string) => store.get(key),
      },
    },
    _store: store,
  };
}

describe("persistQueryCache", () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    vi.useFakeTimers();
  });

  it("saves query states to storage on fact change", () => {
    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: { id: 1 }, dataUpdatedAt: 1000 },
      _q_user_key: '{"id":"1"}',
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    expect(storage.setItem).toHaveBeenCalled();
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(saved.version).toBe(1);
    expect(saved.queries.user.state.data).toEqual({ id: 1 });
    expect(saved.queries.user.key).toBe('{"id":"1"}');
  });

  it("restores cache on init", () => {
    const cache = {
      version: 1,
      savedAt: Date.now(),
      queries: {
        user: {
          state: { status: "success", data: { id: 42 }, dataUpdatedAt: 5000 },
          key: '{"id":"42"}',
        },
      },
    };
    storage._store.set("cache", JSON.stringify(cache));

    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem();

    plugin.onInit(system);

    expect(system._store.get("_q_user_state")).toMatchObject({
      status: "success",
      data: { id: 42 },
      isStale: true, // marked stale for revalidation
    });
    expect(system._store.get("_q_user_key")).toBe('{"id":"42"}');
  });

  it("does not persist pending queries", () => {
    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem({
      _q_loading_state: { status: "pending", data: null },
      _q_loading_key: null,
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_loading_state");
    vi.advanceTimersByTime(300);

    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(saved.queries.loading).toBeUndefined();
  });

  it("respects include filter", () => {
    const plugin = persistQueryCache({
      storage,
      key: "cache",
      include: ["user"],
    });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: { id: 1 } },
      _q_user_key: "1",
      _q_todos_state: { status: "success", data: [1, 2, 3] },
      _q_todos_key: "all",
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(saved.queries.user).toBeDefined();
    expect(saved.queries.todos).toBeUndefined();
  });

  it("respects exclude filter", () => {
    const plugin = persistQueryCache({
      storage,
      key: "cache",
      exclude: ["ephemeral"],
    });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: { id: 1 } },
      _q_ephemeral_state: { status: "success", data: "temp" },
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(saved.queries.user).toBeDefined();
    expect(saved.queries.ephemeral).toBeUndefined();
  });

  it("discards expired cache on restore", () => {
    const cache = {
      version: 1,
      savedAt: Date.now() - 60_000, // 1 minute ago
      queries: { user: { state: { status: "success", data: {} }, key: null } },
    };
    storage._store.set("cache", JSON.stringify(cache));

    const plugin = persistQueryCache({
      storage,
      key: "cache",
      maxAge: 30_000, // 30 seconds
    });
    const system = createMockSystem();

    plugin.onInit(system);

    expect(system._store.has("_q_user_state")).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith("cache");
  });

  it("fires onRestore callback with count", () => {
    const onRestore = vi.fn();
    const cache = {
      version: 1,
      savedAt: Date.now(),
      queries: {
        a: { state: { status: "success", data: 1 }, key: null },
        b: { state: { status: "success", data: 2 }, key: null },
      },
    };
    storage._store.set("cache", JSON.stringify(cache));

    const plugin = persistQueryCache({ storage, key: "cache", onRestore });
    plugin.onInit(createMockSystem());

    expect(onRestore).toHaveBeenCalledWith(2);
  });

  it("fires onSave callback with count", () => {
    const onSave = vi.fn();
    const plugin = persistQueryCache({ storage, key: "cache", onSave });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: {} },
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    expect(onSave).toHaveBeenCalledWith(1);
  });

  it("fires onError on corrupt storage", () => {
    const onError = vi.fn();
    storage._store.set("cache", "{invalid json");

    const plugin = persistQueryCache({ storage, key: "cache", onError });
    plugin.onInit(createMockSystem());

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("saves on destroy even if debounce hasn't fired", () => {
    const plugin = persistQueryCache({ storage, key: "cache", debounce: 5000 });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: { id: 1 } },
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    // Don't advance timer — destroy should save immediately
    plugin.onDestroy();

    expect(storage.setItem).toHaveBeenCalled();
  });

  it("does not save after destroy", () => {
    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem({
      _q_user_state: { status: "success", data: {} },
    });

    plugin.onInit(system);
    plugin.onDestroy();

    storage.setItem.mockClear();
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("clears isFetching/isPending on save", () => {
    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem({
      _q_user_state: {
        status: "success",
        data: { id: 1 },
        isFetching: true,
        isPending: true,
      },
    });

    plugin.onInit(system);
    plugin.onFactSet("_q_user_state");
    vi.advanceTimersByTime(300);

    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)[1]);
    expect(saved.queries.user.state.isFetching).toBe(false);
    expect(saved.queries.user.state.isPending).toBe(false);
  });

  it("handles empty storage gracefully", () => {
    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem();

    // Should not throw
    plugin.onInit(system);

    expect(storage.getItem).toHaveBeenCalledWith("cache");
  });

  it("ignores invalid version", () => {
    storage._store.set("cache", JSON.stringify({ version: 99, queries: {} }));

    const plugin = persistQueryCache({ storage, key: "cache" });
    const system = createMockSystem();

    plugin.onInit(system);

    expect(system._store.size).toBe(0);
  });
});
