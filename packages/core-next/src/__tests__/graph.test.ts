import { describe, expect, it, vi } from "vitest";
import { type Link, type ReactiveNode, createGraph } from "../graph.js";

function links(node: ReactiveNode): Link[] {
  const out: Link[] = [];
  for (let l = node.deps; l; l = l.nextDep) {
    out.push(l);
  }

  return out;
}

function subCount(node: ReactiveNode): number {
  let n = 0;
  for (let l = node.subs; l; l = l.nextSub) {
    n++;
  }

  return n;
}

describe("signals and computeds", () => {
  it("reads, writes and derives", () => {
    const g = createGraph();
    const a = g.signal(1);
    const double = g.computed(() => g.read(a) * 2);
    expect(g.read(double)).toBe(2);
    g.write(a, 5);
    expect(g.read(double)).toBe(10);
  });

  it("is lazy and caches until a dependency changes", () => {
    const g = createGraph();
    const a = g.signal(1);
    const fn = vi.fn(() => g.read(a) + 1);
    const c = g.computed(fn);
    expect(fn).not.toHaveBeenCalled();
    g.read(c);
    g.read(c);
    expect(fn).toHaveBeenCalledTimes(1);
    g.write(a, 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(g.read(c)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("passes the previous value to computeds", () => {
    const g = createGraph();
    const a = g.signal(1);
    const sum = g.computed<number>((prev) => (prev ?? 0) + g.read(a));
    expect(g.read(sum)).toBe(1);
    g.write(a, 2);
    expect(g.read(sum)).toBe(3);
  });

  it("bumps versions only on change", () => {
    const g = createGraph();
    const a = g.signal(1);
    const v = a.version;
    g.write(a, 1);
    expect(a.version).toBe(v);
    g.write(a, 2);
    expect(a.version).toBe(v + 1);
  });

  it("gives every node a unique numeric id per graph", () => {
    const g = createGraph();
    const ids = [g.signal(0), g.computed(() => 0), g.effect(() => {})].map(
      (n) => n.id,
    );
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => Number.isInteger(id))).toBe(true);
  });
});

describe("glitch freedom", () => {
  it("diamond: computes the join once with consistent inputs", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.computed(() => g.read(a) + 1);
    const c = g.computed(() => g.read(a) * 10);
    const seen: [number, number][] = [];
    const d = g.computed(() => {
      seen.push([g.read(b), g.read(c)]);

      return g.read(b) + g.read(c);
    });
    const runs: number[] = [];
    g.effect(() => {
      runs.push(g.read(d));
    });
    g.write(a, 2);
    expect(seen).toEqual([
      [2, 10],
      [3, 20],
    ]);
    expect(runs).toEqual([12, 23]);
  });

  it("an effect never observes a half-updated graph", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.computed(() => g.read(a) * 2);
    const observed: boolean[] = [];
    g.effect(() => {
      observed.push(g.read(b) === g.read(a) * 2);
    });
    for (let i = 0; i < 5; i++) {
      g.write(a, i);
    }
    expect(observed.every(Boolean)).toBe(true);
  });

  it("nested computeds three deep with a shortcut edge", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.computed(() => g.read(a) + 1);
    const c = g.computed(() => g.read(b) + 1);
    const d = g.computed(() => g.read(c) + g.read(a));
    const fn = vi.fn(() => g.read(d));
    g.effect(fn);
    g.write(a, 10);
    expect(g.read(d)).toBe(22);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("dependency tracking", () => {
  it("drops and adds conditional dependencies", () => {
    const g = createGraph();
    const useA = g.signal(true);
    const a = g.signal("a");
    const b = g.signal("b");
    const fn = vi.fn(() => (g.read(useA) ? g.read(a) : g.read(b)));
    const c = g.computed(fn);
    g.effect(() => g.read(c));
    expect(subCount(b)).toBe(0);
    g.write(useA, false);
    expect(subCount(a)).toBe(0);
    expect(subCount(b)).toBe(1);
    const calls = fn.mock.calls.length;
    g.write(a, "a2");
    expect(fn).toHaveBeenCalledTimes(calls);
    g.write(b, "b2");
    expect(g.read(c)).toBe("b2");
  });

  it("de-duplicates repeated reads", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(2);
    const c = g.computed(
      () => g.read(a) + g.read(a) + g.read(b) + g.read(a) + g.read(b),
    );
    g.read(c);
    expect(links(c).map((l) => l.source)).toEqual([a, b]);
    expect(subCount(a)).toBe(1);
  });

  it("untracked reads do not subscribe", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(1);
    const fn = vi.fn(() => g.read(a) + g.untracked(() => g.read(b)));
    g.effect(fn);
    g.write(b, 2);
    expect(fn).toHaveBeenCalledTimes(1);
    g.write(a, 2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("static nodes keep their first-run links and still see changes", () => {
    const g = createGraph();
    const flag = g.signal(true);
    const a = g.signal(1);
    const b = g.signal(10);
    const values: number[] = [];
    const e = g.effect(
      () => {
        values.push(g.read(flag) ? g.read(a) : g.read(b));
      },
      { static: true },
    );
    const first = links(e);
    expect(first.map((l) => l.source)).toEqual([flag, a]);
    g.write(a, 2);
    g.write(flag, false);
    // b was never tracked: a static node does not pick up new dependencies.
    g.write(b, 20);
    expect(values).toEqual([1, 2, 10]);
    expect(links(e)).toEqual(first);
    g.write(a, 3);
    expect(values).toEqual([1, 2, 10, 20]);
  });

  it("equality short-circuits downstream work", () => {
    const g = createGraph();
    const a = g.signal(1);
    const parity = g.computed(() => g.read(a) % 2);
    const fn = vi.fn(() => g.read(parity));
    g.effect(fn);
    g.write(a, 3);
    g.write(a, 5);
    expect(fn).toHaveBeenCalledTimes(1);
    g.write(a, 4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("supports custom and disabled equality", () => {
    const g = createGraph();
    const p = g.signal({ x: 1 }, { equals: (prev, next) => prev.x === next.x });
    const always = g.signal(1, { equals: false });
    const fp = vi.fn(() => g.read(p));
    const fa = vi.fn(() => g.read(always));
    g.effect(fp);
    g.effect(fa);
    g.write(p, { x: 1 });
    g.write(always, 1);
    expect(fp).toHaveBeenCalledTimes(1);
    expect(fa).toHaveBeenCalledTimes(2);
    const box = g.computed(() => ({ x: g.read(p).x }), {
      equals: (prev, next) => prev.x === next.x,
    });
    const fb = vi.fn(() => g.read(box));
    g.effect(fb);
    g.write(p, { x: 2 });
    expect(fb).toHaveBeenCalledTimes(2);
  });
});

describe("effects", () => {
  it("passes the previous return value", () => {
    const g = createGraph();
    const a = g.signal(1);
    const pairs: [number | undefined, number][] = [];
    g.effect<number>((prev) => {
      const next = g.read(a);
      pairs.push([prev, next]);

      return next;
    });
    g.write(a, 2);
    expect(pairs).toEqual([
      [undefined, 1],
      [1, 2],
    ]);
  });

  it("runs cleanups in reverse before each re-run and on dispose", () => {
    const g = createGraph();
    const a = g.signal(1);
    const log: string[] = [];
    const e = g.effect(() => {
      const v = g.read(a);
      log.push(`run ${v}`);
      g.onCleanup(() => log.push(`first ${v}`));
      g.onCleanup(() => log.push(`second ${v}`));
    });
    g.write(a, 2);
    g.dispose(e);
    g.write(a, 3);
    expect(log).toEqual([
      "run 1",
      "second 1",
      "first 1",
      "run 2",
      "second 2",
      "first 2",
    ]);
    expect(subCount(a)).toBe(0);
  });

  it("disposes owned child effects before the parent re-runs", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(1);
    const log: string[] = [];
    g.effect(() => {
      const v = g.read(a);
      g.effect(() => {
        log.push(`child ${v}/${g.read(b)}`);
        g.onCleanup(() => log.push(`child cleanup ${v}`));
      });
    });
    g.batch(() => {
      g.write(b, 2);
      g.write(a, 2);
    });
    expect(log).toEqual(["child 1/1", "child cleanup 1", "child 2/2"]);
    expect(subCount(b)).toBe(1);
  });

  it("flushes effects in the order they were notified", () => {
    const g = createGraph();
    const a = g.signal(0);
    const order: string[] = [];
    for (const name of ["x", "y", "z"]) {
      g.effect(() => {
        g.read(a);
        order.push(name);
      });
    }
    order.length = 0;
    g.write(a, 1);
    expect(order).toEqual(["x", "y", "z"]);
  });

  it("batches writes into one flush", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(1);
    const fn = vi.fn(() => g.read(a) + g.read(b));
    g.effect(fn);
    const result = g.batch(() => {
      g.write(a, 2);
      g.batch(() => g.write(b, 2));
      expect(fn).toHaveBeenCalledTimes(1);

      return "done";
    });
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-runs an effect that writes its own dependency, after it returns", () => {
    const g = createGraph();
    const a = g.signal(0);
    const seen: number[] = [];
    g.effect(() => {
      const v = g.read(a);
      seen.push(v);
      if (v < 3) {
        g.write(a, v + 1);
      }
    });
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("defers flushing to a custom scheduler", () => {
    let pending: (() => void) | null = null;
    const g = createGraph({
      schedule: (graph) => {
        pending = () => graph.flush();
      },
    });
    const a = g.signal(1);
    const fn = vi.fn(() => g.read(a));
    g.effect(fn);
    g.write(a, 2);
    expect(fn).toHaveBeenCalledTimes(1);
    pending!();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps flushing other effects when one throws, then rethrows", () => {
    const g = createGraph();
    const a = g.signal(0);
    const ok = vi.fn(() => g.read(a));
    g.effect(() => {
      if (g.read(a) === 1) {
        throw new Error("boom");
      }
    });
    g.effect(ok);
    expect(() => g.write(a, 1)).toThrow("boom");
    expect(ok).toHaveBeenCalledTimes(2);
    g.write(a, 2);
    expect(ok).toHaveBeenCalledTimes(3);
  });
});

describe("errors and cycles", () => {
  it("a throwing computed rethrows until a dependency changes", () => {
    const g = createGraph();
    const a = g.signal(0);
    const fn = vi.fn(() => {
      if (g.read(a) === 0) {
        throw new Error("zero");
      }

      return g.read(a);
    });
    const c = g.computed(fn);
    const seen: unknown[] = [];
    g.effect(() => {
      try {
        seen.push(g.read(c));
      } catch (e) {
        seen.push((e as Error).message);
      }
    });
    expect(() => g.read(c)).toThrow("zero");
    expect(fn).toHaveBeenCalledTimes(1);
    g.write(a, 1);
    expect(g.read(c)).toBe(1);
    expect(seen).toEqual(["zero", 1]);
  });

  it("throws on a computed cycle instead of hanging", () => {
    const g = createGraph();
    const flag = g.signal(false);
    const holder: { b?: ReactiveNode<number> } = {};
    const a: ReactiveNode<number> = g.computed(() =>
      g.read(flag) ? g.read(holder.b!) : 1,
    );
    holder.b = g.computed(() => g.read(a) + 1);
    expect(g.read(holder.b)).toBe(2);
    g.write(flag, true);
    expect(() => g.read(holder.b!)).toThrow(/Cycle/);
  });

  it("throws on a self-read", () => {
    const g = createGraph();
    const holder: { c?: ReactiveNode<number> } = {};
    holder.c = g.computed(() => g.read(holder.c!) + 1);
    expect(() => g.read(holder.c!)).toThrow(/Cycle/);
  });

  it("stops an effect write loop", () => {
    const g = createGraph({ maxRuns: 50 });
    const a = g.signal(0);
    const trigger = g.signal(false);
    let runs = 0;
    g.effect(() => {
      if (g.read(trigger)) {
        runs++;
        g.write(a, g.read(a) + 1);
      }
    });
    expect(() => g.write(trigger, true)).toThrow(/Cycle/);
    expect(runs).toBeLessThanOrEqual(51);
  });
});

describe("isolation", () => {
  it("two graphs share nothing", () => {
    const g1 = createGraph();
    const g2 = createGraph();
    const a1 = g1.signal(1);
    const a2 = g2.signal(1);
    const f1 = vi.fn(() => g1.read(a1));
    const f2 = vi.fn(() => g2.read(a2));
    g1.effect(f1);
    g2.effect(f2);
    g1.batch(() => {
      g2.write(a2, 2);
      g1.write(a1, 2);
      expect(f2).toHaveBeenCalledTimes(2);
      expect(f1).toHaveBeenCalledTimes(1);
    });
    expect(f1).toHaveBeenCalledTimes(2);
    // A graph-2 effect running inside a graph-1 effect is not tracked by it.
    const b1 = g1.signal(0);
    const inner = vi.fn(() => g1.read(b1));
    g2.effect(() => {
      g2.read(a2);
      inner();
    });
    expect(subCount(b1)).toBe(0);
  });
});

describe("memory", () => {
  it("reuses links in steady state", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(2);
    const c = g.computed(() => g.read(a) + g.read(b));
    const e = g.effect(() => g.read(c) + g.read(a));
    const before = [...links(c), ...links(e)];
    for (let i = 0; i < 100; i++) {
      g.write(a, i);
      g.write(b, i);
    }
    const after = [...links(c), ...links(e)];
    expect(after.length).toBe(before.length);
    for (const [i, l] of before.entries()) {
      expect(after[i]).toBe(l);
    }
    expect(subCount(a)).toBe(2);
  });

  it("releases an unobserved computed's subscriptions when its last subscriber goes", () => {
    const g = createGraph();
    const a = g.signal(1);
    const c = g.computed(() => g.read(a) * 2);
    const e = g.effect(() => g.read(c));
    expect(subCount(a)).toBe(1);
    g.dispose(e);
    expect(subCount(c)).toBe(0);
    expect(subCount(a)).toBe(0);
    g.write(a, 3);
    expect(g.read(c)).toBe(6);
  });
});

describe("deep graphs", () => {
  it("handles a 10,000-deep chain without overflowing the stack", () => {
    const g = createGraph();
    const head = g.signal(0);
    let node: ReactiveNode<number> = head;
    const chain: ReactiveNode<number>[] = [];
    for (let i = 0; i < 10_000; i++) {
      const prev = node;
      node = g.computed(() => g.read(prev) + 1);
      chain.push(node);
      // Built bottom-up: each level computes once against a fresh parent.
      g.read(node);
    }
    const tail = node;
    const seen: number[] = [];
    g.effect(() => {
      seen.push(g.read(tail));
    });
    g.write(head, 1);
    g.write(head, 2);
    expect(seen).toEqual([10_000, 10_001, 10_002]);
    // Dispose cascades through the whole chain iteratively.
    g.dispose(tail);
    expect(subCount(head)).toBe(0);
    expect(chain.every((n) => n.deps === null)).toBe(true);
  });
});

describe("review fixes (PR #199)", () => {
  it("refreshes every stale owner top-down, so a child never runs ahead of its DIRTY parent", () => {
    const g = createGraph();
    const s2 = g.signal(0);
    const s3 = g.signal(0);
    // Re-evaluates when s3 changes, but its value never changes.
    const k = g.computed(() => {
      g.read(s3);

      return 1;
    });
    const log: string[] = [];
    g.effect(() => {
      g.read(k);
      log.push("G");
      g.effect(() => {
        log.push("P");
        g.effect(() => {
          log.push(`C${g.read(s2)}`);
        });
        g.read(s2);
      });
    });
    log.length = 0;
    g.batch(() => {
      g.write(s2, 1);
      g.write(s3, 1);
    });
    expect(log).toEqual(["P", "C1"]);
  });

  it("an effect that disposes itself mid-run leaves no links behind", () => {
    const g = createGraph();
    const a = g.signal(0);
    const b = g.signal(0);
    let n = 0;
    let runs = 0;
    const e = g.effect(() => {
      runs++;
      g.read(a);
      if (n++) {
        g.dispose(e);
      }
      g.read(b);
    });
    g.write(a, 1);
    expect(subCount(a) + subCount(b)).toBe(0);
    expect(e.deps).toBe(null);
    g.write(b, 1);
    expect(runs).toBe(2);
  });

  it("onCleanup inside a computed does not attach to the effect that pulled it", () => {
    const g = createGraph();
    const s = g.signal(0);
    const t = g.signal(0);
    let cleaned = 0;
    const c = g.computed(() => {
      g.onCleanup(() => cleaned++);

      return g.read(s);
    });
    g.effect(() => {
      g.read(t);
      g.untracked(() => g.read(c));
    });
    g.write(t, 1);
    expect(cleaned).toBe(0);
  });

  it("an effect created inside a computed is not owned by the pulling effect", () => {
    const g = createGraph();
    const s = g.signal(0);
    const t = g.signal(0);
    let inner: ReactiveNode | null = null;
    const c = g.computed(() => {
      inner ??= g.effect(() => {});

      return g.read(s);
    });
    const outer = g.effect(() => {
      g.read(t);
      g.read(c);
    });
    expect(inner!.parent).toBe(null);
    expect(outer.children ?? []).toHaveLength(0);
  });

  it("touch notifies subscribers of an in-place change without replacing the value", () => {
    const g = createGraph();
    const list = g.signal<number[]>([1]);
    const original = list.value;
    const len = g.computed(() => g.read(list).length);
    const seen: number[] = [];
    g.effect(() => {
      seen.push(g.read(len));
    });
    g.read(list).push(2);
    const before = list.version;
    g.touch(list);
    expect(list.value).toBe(original);
    expect(list.version).toBe(before + 1);
    expect(seen).toEqual([1, 2]);
    g.batch(() => {
      g.read(list).push(3);
      g.touch(list);
      expect(seen).toEqual([1, 2]);
    });
    expect(seen).toEqual([1, 2, 3]);
    // A plain write of the same array is a no-op (Object.is); touch is not.
    g.write(list, original);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("perf restructure (L0a2)", () => {
  it("keeps one link for A, C(reads A), A", () => {
    const g = createGraph();
    const a = g.signal(1);
    const c = g.computed(() => g.read(a) * 2);
    const x = g.computed(() => g.read(a) + g.read(c) + g.read(a));
    expect(g.read(x)).toBe(4);
    expect(links(x).map((l) => l.source)).toEqual([a, c]);
    // a's subscribers: x once, c once.
    expect(subCount(a)).toBe(2);
    g.write(a, 2);
    expect(g.read(x)).toBe(8);
    expect(links(x).map((l) => l.source)).toEqual([a, c]);
    expect(subCount(a)).toBe(2);
  });

  it("keeps one link per dependency when reads interleave across runs", () => {
    const g = createGraph();
    const head = g.signal(0);
    const even = g.computed(() => g.read(head) * 2);
    const odd = g.computed(() => -g.read(head));
    const pick = g.computed(() => {
      let s = 0;
      for (let i = 0; i < 5; i++) {
        s += g.read(head) % 2 ? g.read(odd) : g.read(even);
      }

      return s;
    });
    for (let i = 0; i < 4; i++) {
      g.write(head, i);
      g.read(pick);
      expect(links(pick)).toHaveLength(2);
    }
  });

  it("re-runs a CHECK node whose input was refreshed by another reader first", () => {
    const g = createGraph();
    const s = g.signal(1);
    const mid = g.computed(() => g.read(s) + 1);
    const top = g.computed(() => g.read(mid) * 10);
    expect(g.read(top)).toBe(20);
    g.write(s, 2);
    // Pull mid on its own: it changes, and must mark top DIRTY on the spot.
    expect(g.read(mid)).toBe(3);
    expect(g.read(top)).toBe(30);
  });

  it("stops below an unchanged computed", () => {
    const g = createGraph();
    const s = g.signal(1);
    const parity = g.computed(() => g.read(s) % 2);
    const fn = vi.fn(() => g.read(parity));
    const below = g.computed(fn);
    g.read(below);
    g.write(s, 3);
    expect(g.read(below)).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onCleanup inside untracked inside a computed attaches to nothing", () => {
    const g = createGraph();
    const s = g.signal(0);
    const cleanup = vi.fn();
    const c = g.computed(() => {
      g.untracked(() => g.onCleanup(cleanup));

      return g.read(s);
    });
    const outer = g.effect(() => {
      g.read(c);
    });
    g.write(s, 1);
    g.dispose(outer);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("runs cleanups newest first and stops at one that throws", () => {
    const g = createGraph();
    const s = g.signal(0);
    const calls: string[] = [];
    g.effect(() => {
      g.read(s);
      g.onCleanup(() => calls.push("a"));
      g.onCleanup(() => {
        calls.push("b");
        throw new Error("cleanup");
      });
    });
    expect(() => g.write(s, 1)).toThrow("cleanup");
    expect(calls).toEqual(["b"]);
  });

  it("resets the write-loop counter between flushes", () => {
    const g = createGraph({ maxRuns: 3 });
    const s = g.signal(0);
    let runs = 0;
    g.effect(() => {
      g.read(s);
      runs++;
    });
    for (let i = 1; i <= 10; i++) {
      g.write(s, i);
    }
    expect(runs).toBe(11);
  });

  it("a static computed keeps its first-run links and still sees changes", () => {
    const g = createGraph();
    const a = g.signal(1);
    const b = g.signal(2);
    const sum = g.computed(() => g.read(a) + g.read(b), { static: true });
    expect(g.read(sum)).toBe(3);
    const before = links(sum);
    g.write(b, 5);
    expect(g.read(sum)).toBe(6);
    expect(links(sum)).toEqual(before);
  });
});
