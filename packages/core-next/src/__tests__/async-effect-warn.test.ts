import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function build(effects: Record<string, unknown>) {
  const module = createModule("m", {
    schema: { facts: { n: t.number() }, events: { inc: {} } },
    init: (f) => {
      f.n = 0;
    },
    events: {
      inc: (f) => {
        f.n = f.n + 1;
      },
    },
    effects: effects as never,
  });

  return createSystem({ module } as never) as any;
}

describe("async auto-tracked effect with no reads before first await", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns once per effect, not for deps / pre-await reads / sync", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sys = build({
      bare: { run: async () => { await sleep(0); } },
      explicit: { deps: ["n"], run: async () => { await sleep(0); } },
      reads: { run: async (f: { n: number }) => { void f.n; await sleep(0); } },
      sync: { run: () => {} },
    });
    sys.start?.();
    await sleep(10);
    sys.events.inc();
    await sleep(10);
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.filter((m) => m.includes('"bare"'))).toHaveLength(1);
    expect(msgs.filter((m) => /"(explicit|reads|sync)"/.test(m))).toHaveLength(0);
    expect(msgs[0]).toContain("recorded no dependencies");
  });
});
