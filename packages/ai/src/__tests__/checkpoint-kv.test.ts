/**
 * `KvCheckpointStore` — the store that survives the process.
 *
 * The in-memory store is a `Map`, so every checkpoint dies with the
 * isolate. That is right for a test and useless for what checkpoints
 * are FOR: a long run interrupted and resumed later, possibly
 * elsewhere.
 *
 * ⚠ THE FAKE BELOW IS DELIBERATELY DUMB. It is a `Map` behind the four
 * verbs, with no ordering help, no transactions and no list — because a
 * fake that quietly provided any of those would let this store pass
 * while depending on something Cloudflare KV does not give it.
 */
import { describe, expect, it } from "vitest";
import {
  type Checkpoint,
  createCheckpointId,
} from "../checkpoint.js";
import { type CheckpointKv, KvCheckpointStore } from "../checkpoint-kv.js";

function fakeKv(): CheckpointKv & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
  };
}

function checkpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    version: 1,
    id: createCheckpointId(),
    createdAt: new Date().toISOString(),
    systemExport: "{}",
    timelineExport: null,
    localState: { type: "single" },
    memoryExport: null,
    orchestratorType: "single",
    ...overrides,
  };
}

describe("round-trips through a key-value store", () => {
  it("saves and loads", async () => {
    const kv = fakeKv();
    const store = new KvCheckpointStore(kv);
    const cp = checkpoint({ label: "before the risky step" });
    await store.save(cp);
    const back = await store.load(cp.id);
    expect(back?.id).toBe(cp.id);
    expect(back?.label).toBe("before the risky step");
  });

  it("⚠ survives a NEW store over the same storage — the whole point", async () => {
    // An in-memory store cannot do this, and it is the only reason to
    // have written this file.
    const kv = fakeKv();
    const cp = checkpoint();
    await new KvCheckpointStore(kv).save(cp);
    const afterRestart = new KvCheckpointStore(kv);
    expect((await afterRestart.load(cp.id))?.id).toBe(cp.id);
    expect(await afterRestart.list()).toHaveLength(1);
  });

  it("returns null for an unknown id rather than throwing", async () => {
    expect(await new KvCheckpointStore(fakeKv()).load("ckpt_nope")).toBeNull();
  });
});

describe("⚠ list() is INSERTION order, which a key scan cannot give", () => {
  it("keeps the order things were saved in", async () => {
    /*
     * Key-value stores list lexicographically, if at all. Deriving
     * order from a scan looks right with three checkpoints and is
     * silently wrong at fifty — so the order is stored explicitly, and
     * this is the assertion that costs a second write per save.
     */
    /*
     * ⚠ IDS ARE PINNED IN DESCENDING ORDER, NOT GENERATED. The first
     * version of this test used `createCheckpointId()`, whose random
     * suffixes happened to sort in insertion order — so replacing
     * `list()` with a SORT passed all 15 tests. The assertion was true
     * by luck, which is the shape this repo keeps paying for.
     *
     * Saved z → a → m, so any sort produces a different answer than
     * insertion order and the mutation cannot hide.
     */
    const store = new KvCheckpointStore(fakeKv());
    const ids = ["ckpt_zzz", "ckpt_aaa", "ckpt_mmm"];
    for (const [i, id] of ids.entries()) {
      await store.save(
        checkpoint({ id, label: ["zulu", "alpha", "mike"][i] as string }),
      );
    }
    expect((await store.list()).map((e) => e.id)).toEqual(ids);
    // and explicitly NOT what a sort would give
    expect((await store.list()).map((e) => e.id)).not.toEqual([...ids].sort());
    // and NOT sorted, which is what a scan would have produced
    expect((await store.list()).map((e) => e.label)).toEqual([
      "zulu",
      "alpha",
      "mike",
    ]);
  });

  it("re-saving an id moves it to the end rather than duplicating", async () => {
    const store = new KvCheckpointStore(fakeKv());
    const a = checkpoint();
    const b = checkpoint();
    await store.save(a);
    await store.save(b);
    await store.save(a);
    expect((await store.list()).map((e) => e.id)).toEqual([b.id, a.id]);
  });
});

describe("⚠ FIFO eviction and retention match the in-memory store", () => {
  it("evicts the oldest past the cap, and deletes the value too", async () => {
    const kv = fakeKv();
    const store = new KvCheckpointStore(kv, { maxCheckpoints: 2 });
    const a = checkpoint();
    const b = checkpoint();
    const c = checkpoint();
    await store.save(a);
    await store.save(b);
    await store.save(c);
    expect((await store.list()).map((e) => e.id)).toEqual([b.id, c.id]);
    // ⚠ The VALUE is gone, not just the index entry. An eviction that
    // only forgot the id would leak every checkpoint it ever evicted.
    expect(await store.load(a.id)).toBeNull();
    expect([...kv.map.keys()].some((k) => k.includes(a.id))).toBe(false);
  });

  it("preserveLabeled keeps a labeled checkpoint past the cap", async () => {
    const store = new KvCheckpointStore(fakeKv(), {
      maxCheckpoints: 2,
      preserveLabeled: true,
    });
    const keep = checkpoint({ label: "keep me" });
    await store.save(keep);
    await store.save(checkpoint());
    await store.save(checkpoint());
    expect((await store.list()).some((e) => e.id === keep.id)).toBe(true);
  });

  it("prunes by age, and returns how many", async () => {
    const now = 1_757_000_000_000;
    const store = new KvCheckpointStore(fakeKv(), {
      retentionMs: 1_000,
      now: () => now,
    });
    await store.save(
      checkpoint({ createdAt: new Date(now - 5_000).toISOString() }),
    );
    const fresh = checkpoint({ createdAt: new Date(now).toISOString() });
    await store.save(fresh);
    expect(await store.prune()).toBe(1);
    expect((await store.list()).map((e) => e.id)).toEqual([fresh.id]);
  });

  it("⚠ prunes NOTHING when no retention is set", async () => {
    // `Infinity` is the default, and a store that pruned by default
    // would delete a caller's checkpoints for asking nothing.
    const store = new KvCheckpointStore(fakeKv());
    await store.save(
      checkpoint({ createdAt: new Date(1_000).toISOString() }),
    );
    expect(await store.prune()).toBe(0);
    expect(await store.list()).toHaveLength(1);
  });

  it("⚠ keeps a checkpoint whose date cannot be parsed", async () => {
    // Deleting data because a timestamp was unreadable is destroying
    // it over a formatting problem.
    const store = new KvCheckpointStore(fakeKv(), {
      retentionMs: 1,
      now: () => 1_757_000_000_000,
    });
    await store.save(checkpoint({ createdAt: "not-a-date" }));
    expect(await store.prune()).toBe(0);
  });
});

describe("⚠ a corrupt store degrades, it does not throw", () => {
  it("an unparseable index lists nothing rather than crashing a resume", async () => {
    const kv = fakeKv();
    kv.map.set("directive:checkpoint:__index", "{ not json");
    const store = new KvCheckpointStore(kv);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("a corrupt checkpoint VALUE loads as null, not as half an object", async () => {
    // Validated on the way out as well as in: resuming from half a
    // checkpoint is worse than not resuming.
    const kv = fakeKv();
    const store = new KvCheckpointStore(kv);
    const cp = checkpoint();
    await store.save(cp);
    kv.map.set(`directive:checkpoint:${cp.id}`, '{"version":1}');
    expect(await store.load(cp.id)).toBeNull();
  });

  it("refuses to save an invalid checkpoint", async () => {
    const store = new KvCheckpointStore(fakeKv());
    await expect(
      store.save({ version: 1 } as unknown as Checkpoint),
    ).rejects.toThrow(/Invalid checkpoint/);
  });

  it("⚠ rejects maxCheckpoints < 1, which would evict everything", async () => {
    expect(() => new KvCheckpointStore(fakeKv(), { maxCheckpoints: 0 })).toThrow(
      /maxCheckpoints/,
    );
  });
});

describe("⚠ the prefix keeps one KV usable for more than checkpoints", () => {
  it("touches no key outside its own prefix", async () => {
    const kv = fakeKv();
    kv.map.set("someone-elses-key", "do not touch");
    const store = new KvCheckpointStore(kv, { prefix: "cp:" });
    const cp = checkpoint();
    await store.save(cp);
    await store.clear();
    expect(kv.map.get("someone-elses-key")).toBe("do not touch");
    expect([...kv.map.keys()].every((k) => k.startsWith("cp:"))).toBe(false);
  });
});
