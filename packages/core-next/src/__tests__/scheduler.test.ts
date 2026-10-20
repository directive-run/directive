import { describe, expect, it } from "vitest";
import {
  type HostCallback,
  type Lane,
  type SchedulerTarget,
  createScheduler,
} from "../scheduler.js";

/** A host callback that queues until `run()` is called. */
function manualHost() {
  const cbs: Array<() => void> = [];
  const host: HostCallback = (cb) => {
    cbs.push(cb);
  };

  return {
    host,
    get armed() {
      return cbs.length;
    },
    run() {
      for (const cb of cbs.splice(0)) {
        cb();
      }
    },
  };
}

function target(log: string[], name: string): SchedulerTarget {
  return { flush: (lane) => log.push(`${name}:${lane}`) };
}

function hosts() {
  const micro = manualHost();
  const frame = manualHost();
  const idle = manualHost();
  const s = createScheduler({
    micro: micro.host,
    frame: frame.host,
    idle: idle.host,
  });

  return { s, micro, frame, idle };
}

describe("lanes", () => {
  it("sync flushes before request returns", () => {
    const log: string[] = [];
    const { s } = hosts();
    s.request("sync", target(log, "a"));
    expect(log).toEqual(["a:sync"]);
    expect(s.pending()).toBe(false);
  });

  it.each(["micro", "frame", "idle"] as Lane[])(
    "%s waits for its host callback, armed once",
    (lane) => {
      const log: string[] = [];
      const h = hosts();
      const a = target(log, "a");
      h.s.request(lane, a);
      h.s.request(lane, a);
      expect(log).toEqual([]);
      const host = h[lane as "micro" | "frame" | "idle"];
      expect(host.armed).toBe(1);
      host.run();
      expect(log).toEqual([`a:${lane}`]);
    },
  );

  it("manual flushes only on an explicit flush", () => {
    const log: string[] = [];
    const h = hosts();
    h.s.request("manual", target(log, "a"));
    h.micro.run();
    h.frame.run();
    h.idle.run();
    expect(log).toEqual([]);
    expect(h.s.pending("manual")).toBe(true);
    h.s.flush("manual");
    expect(log).toEqual(["a:manual"]);
  });

  it("flush() with no lane drains every lane in order", () => {
    const log: string[] = [];
    const { s } = hosts();
    const a = target(log, "a");
    s.request("manual", a);
    s.request("idle", a);
    s.request("micro", a);
    s.request("frame", a);
    s.flush();
    expect(log).toEqual(["a:micro", "a:frame", "a:idle", "a:manual"]);
  });

  it("a late host callback with nothing waiting is a no-op", () => {
    const log: string[] = [];
    const h = hosts();
    h.s.request("micro", target(log, "a"));
    h.s.flush("micro");
    h.micro.run();
    expect(log).toEqual(["a:micro"]);
  });

  it("uses real microtasks by default", async () => {
    const log: string[] = [];
    const s = createScheduler();
    s.request("micro", target(log, "a"));
    expect(log).toEqual([]);
    await Promise.resolve();
    expect(log).toEqual(["a:micro"]);
  });

  it("does not read host globals at import time", async () => {
    const g = globalThis as any;
    const saved = g.queueMicrotask;
    let used = 0;
    g.queueMicrotask = (cb: () => void) => {
      used++;
      saved(cb);
    };
    try {
      const s = createScheduler();
      s.request("micro", { flush() {} });
      expect(used).toBe(1);
    } finally {
      g.queueMicrotask = saved;
    }
  });
});

describe("sharing", () => {
  it("500 systems requesting in one tick flush once each, one host callback", () => {
    const h = hosts();
    const counts = new Array(500).fill(0);
    const targets = counts.map((_, i) => ({
      flush: () => {
        counts[i]++;
      },
    }));
    for (const t of targets) {
      h.s.request("micro", t);
      h.s.request("micro", t);
    }
    expect(h.micro.armed).toBe(1);
    h.micro.run();
    expect(counts.every((c) => c === 1)).toBe(true);
  });

  it("flushes in registration order regardless of request order", () => {
    const log: string[] = [];
    const h = hosts();
    const a = target(log, "a");
    const b = target(log, "b");
    const c = target(log, "c");
    expect([a, b, c].map((t) => h.s.register(t))).toEqual([0, 1, 2]);
    h.s.request("micro", c);
    h.s.request("micro", a);
    h.s.request("micro", b);
    h.micro.run();
    expect(log).toEqual(["a:micro", "b:micro", "c:micro"]);
  });

  it("flush(lane, only) flushes one target and leaves the rest waiting", () => {
    const log: string[] = [];
    const h = hosts();
    const a = target(log, "a");
    const b = target(log, "b");
    h.s.request("manual", a);
    h.s.request("manual", b);
    h.s.flush("manual", b);
    expect(log).toEqual(["b:manual"]);
    h.s.flush("manual");
    expect(log).toEqual(["b:manual", "a:manual"]);
  });

  it("a request made during a flush runs in the same flush", () => {
    const log: string[] = [];
    const h = hosts();
    const b = target(log, "b");
    const a: SchedulerTarget = {
      flush(lane) {
        log.push(`a:${lane}`);
        h.s.request("micro", b);
      },
    };
    h.s.request("micro", a);
    h.micro.run();
    expect(log).toEqual(["a:micro", "b:micro"]);
  });

  it("throws when a lane never settles", () => {
    const s = createScheduler({ micro: () => {}, maxPasses: 5 });
    const a: SchedulerTarget = { flush: () => s.request("manual", a) };
    s.request("manual", a);
    expect(() => s.flush("manual")).toThrow(/did not settle/);
  });

  it("unregister drops pending work", () => {
    const log: string[] = [];
    const h = hosts();
    const a = target(log, "a");
    h.s.request("micro", a);
    h.s.unregister(a);
    h.micro.run();
    expect(log).toEqual([]);
  });

  it("one failing target does not stop the others; the first error is rethrown", () => {
    const log: string[] = [];
    const h = hosts();
    h.s.request("manual", {
      flush() {
        throw Error("first");
      },
    });
    h.s.request("manual", {
      flush() {
        throw Error("second");
      },
    });
    h.s.request("manual", target(log, "c"));
    expect(() => h.s.flush("manual")).toThrow("first");
    expect(log).toEqual(["c:manual"]);
  });
});

describe("isolation", () => {
  it("two schedulers share nothing", () => {
    const log: string[] = [];
    const h1 = hosts();
    const h2 = hosts();
    const a = target(log, "a");
    expect(h1.s.register(a)).toBe(0);
    expect(h2.s.register(target(log, "b"))).toBe(0);
    h1.s.request("manual", a);
    expect(h2.s.pending()).toBe(false);
  });
});
