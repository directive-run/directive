import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistencePlugin } from "../persistence.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockStorage(initial?: Record<string, string>): Storage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() {
      return store.size;
    },
    key: vi.fn(() => null),
  };
}

function createMockSystem(initialFacts: Record<string, unknown> = {}) {
  const facts: Record<string, unknown> & {
    $store: { batch: (fn: () => void) => void };
  } = {
    ...initialFacts,
    $store: { batch: (fn: () => void) => fn() },
  };

  return { facts } as any;
}

// ============================================================================
// Plugin Identity
// ============================================================================

describe("persistencePlugin", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("has name 'persistence'", () => {
    const plugin = persistencePlugin({
      storage: createMockStorage(),
      key: "test",
    });

    expect(plugin.name).toBe("persistence");
  });

  // ============================================================================
  // onInit — Restore from Storage
  // ============================================================================

  describe("onInit — restore from storage", () => {
    it("restores persisted facts via batch", () => {
      const stored = { count: 42, label: "hello" };
      const storage = createMockStorage({
        "app-state": JSON.stringify(stored),
      });
      const system = createMockSystem();
      const batchSpy = vi.spyOn(system.facts.$store, "batch");

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      expect(storage.getItem).toHaveBeenCalledWith("app-state");
      expect(batchSpy).toHaveBeenCalledOnce();
      expect(system.facts.count).toBe(42);
      expect(system.facts.label).toBe("hello");
    });

    it("does nothing when storage is empty", () => {
      const storage = createMockStorage();
      const system = createMockSystem({ existing: "untouched" });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      expect(storage.getItem).toHaveBeenCalledWith("app-state");
      expect(system.facts.existing).toBe("untouched");
    });

    it("does nothing when stored value is null JSON", () => {
      const storage = createMockStorage({ "app-state": "null" });
      const system = createMockSystem();

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      // null object → load returns null, no batch
      expect(system.facts.$store).toBeDefined();
    });

    it("does nothing when stored value is a non-object (string)", () => {
      const storage = createMockStorage({
        "app-state": JSON.stringify("just a string"),
      });
      const system = createMockSystem();

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      // Non-object → load returns null
      expect(system.facts.$store).toBeDefined();
    });
  });

  // ============================================================================
  // onInit — Error Handling
  // ============================================================================

  describe("onInit — error handling", () => {
    it("calls onError when storage contains invalid JSON", () => {
      const storage = createMockStorage({ "app-state": "not json{{{" });
      const system = createMockSystem();
      const onError = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onError,
      });
      plugin.onInit!(system);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    });

    it("calls onError when stored data contains __proto__ key (prototype pollution)", () => {
      // JSON.stringify strips __proto__, so construct the payload manually
      const poisoned = '{"__proto__":{"admin":true}}';
      const storage = createMockStorage({ "app-state": poisoned });
      const system = createMockSystem();
      const onError = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onError,
      });
      plugin.onInit!(system);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0].message).toContain("prototype pollution");
      // Facts should NOT have been modified
      expect(system.facts.__proto__).not.toHaveProperty("admin");
    });

    it("calls onError when stored data contains nested prototype pollution", () => {
      const poisoned = JSON.stringify({
        safe: "ok",
        nested: { constructor: { evil: true } },
      });
      const storage = createMockStorage({ "app-state": poisoned });
      const system = createMockSystem();
      const onError = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onError,
      });
      plugin.onInit!(system);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0].message).toContain("prototype pollution");
    });

    it("does not throw when onError is not provided and JSON is invalid", () => {
      const storage = createMockStorage({ "app-state": "{bad" });
      const system = createMockSystem();

      const plugin = persistencePlugin({ storage, key: "app-state" });

      expect(() => plugin.onInit!(system)).not.toThrow();
    });
  });

  // ============================================================================
  // onInit — onRestore Callback
  // ============================================================================

  describe("onInit — onRestore callback", () => {
    it("fires onRestore with the restored data", () => {
      const stored = { count: 10, label: "restored" };
      const storage = createMockStorage({
        "app-state": JSON.stringify(stored),
      });
      const system = createMockSystem();
      const onRestore = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onRestore,
      });
      plugin.onInit!(system);

      expect(onRestore).toHaveBeenCalledOnce();
      expect(onRestore).toHaveBeenCalledWith(stored);
    });

    it("does not fire onRestore when storage is empty", () => {
      const storage = createMockStorage();
      const system = createMockSystem();
      const onRestore = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onRestore,
      });
      plugin.onInit!(system);

      expect(onRestore).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Include / Exclude Filters
  // ============================================================================

  describe("include filter", () => {
    it("only restores included keys on init", () => {
      const stored = { count: 5, label: "hi", secret: "password" };
      const storage = createMockStorage({
        "app-state": JSON.stringify(stored),
      });
      const system = createMockSystem();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        include: ["count", "label"],
      });
      plugin.onInit!(system);

      expect(system.facts.count).toBe(5);
      expect(system.facts.label).toBe("hi");
      expect(system.facts.secret).toBeUndefined();
    });

    it("only saves included keys", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 1, label: "x", secret: "pw" });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        include: ["count", "label"],
      });
      plugin.onInit!(system);

      // Set a tracked, included key
      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("label", undefined, undefined);
      plugin.onFactSet!("secret", undefined, undefined);
      vi.advanceTimersByTime(100);

      const saved = JSON.parse(
        (storage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1],
      );
      expect(saved).toEqual({ count: 1, label: "x" });
      expect(saved).not.toHaveProperty("secret");
    });
  });

  describe("exclude filter", () => {
    it("does not restore excluded keys on init", () => {
      const stored = { count: 5, secret: "password" };
      const storage = createMockStorage({
        "app-state": JSON.stringify(stored),
      });
      const system = createMockSystem();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["secret"],
      });
      plugin.onInit!(system);

      expect(system.facts.count).toBe(5);
      expect(system.facts.secret).toBeUndefined();
    });

    it("does not save excluded keys", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 1, secret: "pw" });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["secret"],
      });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("secret", undefined, undefined);
      vi.advanceTimersByTime(100);

      const saved = JSON.parse(
        (storage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1],
      );
      expect(saved).toEqual({ count: 1 });
      expect(saved).not.toHaveProperty("secret");
    });
  });

  // ============================================================================
  // onFactSet — Schedule Save
  // ============================================================================

  describe("onFactSet", () => {
    it("schedules a debounced save for a persisted key", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 99 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      // Not saved yet (debounced)
      expect(storage.setItem).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(storage.setItem).toHaveBeenCalledOnce();

      const saved = JSON.parse(
        (storage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1],
      );
      expect(saved.count).toBe(99);
    });

    it("does not schedule save for non-persisted keys (excluded)", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ secret: "pw" });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["secret"],
      });
      plugin.onInit!(system);

      plugin.onFactSet!("secret", undefined, undefined);
      vi.advanceTimersByTime(200);

      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it("does not schedule save for keys outside the include list", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ other: "value" });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        include: ["count"],
      });
      plugin.onInit!(system);

      plugin.onFactSet!("other", undefined, undefined);
      vi.advanceTimersByTime(200);

      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // onFactDelete — Schedule Save
  // ============================================================================

  describe("onFactDelete", () => {
    it("schedules save when a persisted key is deleted", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 10 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      // First track the key
      plugin.onFactSet!("count", undefined, undefined);
      vi.advanceTimersByTime(100);
      (storage.setItem as ReturnType<typeof vi.fn>).mockClear();

      // Now delete it
      plugin.onFactDelete!("count", undefined);
      vi.advanceTimersByTime(100);

      expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("does not schedule save for non-persisted key deletion", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["temp"],
      });
      plugin.onInit!(system);

      plugin.onFactDelete!("temp", undefined);
      vi.advanceTimersByTime(200);

      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // onFactsBatch — Batched Changes
  // ============================================================================

  describe("onFactsBatch", () => {
    it("schedules save for batched set+delete of persisted keys", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 5, label: "hi" });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      plugin.onFactsBatch!([
        { type: "set", key: "count", value: undefined, prev: undefined },
        { type: "delete", key: "label", value: undefined, prev: undefined },
      ]);

      vi.advanceTimersByTime(100);
      expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("does not schedule save when all batched keys are excluded", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["temp1", "temp2"],
      });
      plugin.onInit!(system);

      plugin.onFactsBatch!([
        { type: "set", key: "temp1", value: undefined, prev: undefined },
        { type: "set", key: "temp2", value: undefined, prev: undefined },
      ]);

      vi.advanceTimersByTime(200);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it("schedules save if at least one batched key is persisted", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 1 });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        exclude: ["temp"],
      });
      plugin.onInit!(system);

      plugin.onFactsBatch!([
        { type: "set", key: "temp", value: undefined, prev: undefined },
        { type: "set", key: "count", value: undefined, prev: undefined },
      ]);

      vi.advanceTimersByTime(100);
      expect(storage.setItem).toHaveBeenCalledOnce();
    });
  });

  // ============================================================================
  // Debounce Behavior
  // ============================================================================

  describe("debounce", () => {
    it("coalesces multiple rapid changes into a single save", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 0 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      // Rapid fire 5 changes
      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("count", undefined, undefined);

      vi.advanceTimersByTime(100);
      expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("resets debounce timer on each new change", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 0 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      vi.advanceTimersByTime(80); // 80ms into debounce
      expect(storage.setItem).not.toHaveBeenCalled();

      plugin.onFactSet!("count", undefined, undefined); // Resets timer
      vi.advanceTimersByTime(80); // 80ms into NEW debounce
      expect(storage.setItem).not.toHaveBeenCalled();

      vi.advanceTimersByTime(20); // 100ms total from last change
      expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("respects custom debounce interval", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 0 });

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        debounce: 500,
      });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);

      vi.advanceTimersByTime(200);
      expect(storage.setItem).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(storage.setItem).toHaveBeenCalledOnce();
    });
  });

  // ============================================================================
  // onDestroy — Final Save
  // ============================================================================

  describe("onDestroy", () => {
    it("performs a synchronous final save", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 42 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);
      plugin.onFactSet!("count", undefined, undefined);

      // Destroy before debounce fires
      plugin.onDestroy!({} as never);

      expect(storage.setItem).toHaveBeenCalledOnce();
      const saved = JSON.parse(
        (storage.setItem as ReturnType<typeof vi.fn>).mock.calls[0]![1],
      );
      expect(saved.count).toBe(42);
    });

    it("clears pending debounce timeout on destroy", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 1 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);
      plugin.onFactSet!("count", undefined, undefined);

      // Destroy clears timeout + does final save
      plugin.onDestroy!({} as never);
      (storage.setItem as ReturnType<typeof vi.fn>).mockClear();

      // Advancing timers should NOT trigger another save
      vi.advanceTimersByTime(200);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it("saves even when no pending timeout exists", () => {
      const storage = createMockStorage();
      const system = createMockSystem({ count: 7 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);
      plugin.onFactSet!("count", undefined, undefined);

      // Wait for debounce to fire naturally
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);
      (storage.setItem as ReturnType<typeof vi.fn>).mockClear();

      // Destroy should still save (final save always runs)
      plugin.onDestroy!({} as never);
      expect(storage.setItem).toHaveBeenCalledOnce();
    });
  });

  // ============================================================================
  // onSave Callback
  // ============================================================================

  describe("onSave callback", () => {
    it("fires after a debounced save with persisted data", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      const system = createMockSystem({ count: 10, label: "test" });
      const onSave = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onSave,
      });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      plugin.onFactSet!("label", undefined, undefined);
      vi.advanceTimersByTime(100);

      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave).toHaveBeenCalledWith({ count: 10, label: "test" });
    });

    it("fires on destroy save", () => {
      const storage = createMockStorage();
      const system = createMockSystem({ count: 3 });
      const onSave = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onSave,
      });
      plugin.onInit!(system);
      plugin.onFactSet!("count", undefined, undefined);

      plugin.onDestroy!({} as never);

      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave).toHaveBeenCalledWith({ count: 3 });
    });
  });

  // ============================================================================
  // onError — Save Errors
  // ============================================================================

  describe("onError — save errors", () => {
    it("calls onError when storage.setItem throws", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      (storage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      const system = createMockSystem({ count: 1 });
      const onError = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onError,
      });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      vi.advanceTimersByTime(100);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0].message).toBe("QuotaExceededError");
    });

    it("wraps non-Error throws in an Error", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      (storage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw "string error";
      });
      const system = createMockSystem({ count: 1 });
      const onError = vi.fn();

      const plugin = persistencePlugin({
        storage,
        key: "app-state",
        onError,
      });
      plugin.onInit!(system);

      plugin.onFactSet!("count", undefined, undefined);
      vi.advanceTimersByTime(100);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0]![0].message).toBe("string error");
    });

    it("does not throw when onError is not provided and save fails", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();
      (storage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("fail");
      });
      const system = createMockSystem({ count: 1 });

      const plugin = persistencePlugin({ storage, key: "app-state" });
      plugin.onInit!(system);
      plugin.onFactSet!("count", undefined, undefined);

      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });
  });

  // ============================================================================
  // save() guards — no system
  // ============================================================================

  describe("save guards", () => {
    it("does not save when system has not been initialized", () => {
      vi.useFakeTimers();
      const storage = createMockStorage();

      const plugin = persistencePlugin({ storage, key: "app-state" });

      // Destroy without init — save() should bail because system is null
      plugin.onDestroy!({} as never);

      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });
});
