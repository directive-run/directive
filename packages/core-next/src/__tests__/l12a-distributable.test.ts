/**
 * L12a: withDistributable (the RFC's D1 to D9), the observer channel (H4)
 * and the snapshot tools (G1 to G6), with the three rows approved on the
 * owner's instruction ("I approve you for to do everything", 2026-11-15):
 * (bx) a watch hears its included facts, (bu) signing in JSON form, (bv)
 * signing refuses what it cannot cover. The conformance suite carries the
 * 1.35 cases; this file pins 2.0's side of each row and the cross-version
 * bytes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import * as root from "../index.js";
import {
  diffSnapshots,
  isSignedSnapshot,
  isSnapshotExpired,
  signSnapshot,
  validateSnapshot,
  verifySnapshotSignature,
} from "../utils/snapshot.js";

const acct = (id = "acct") =>
  createModule(id, {
    schema: {
      facts: { name: t.string(), count: t.number(), plan: t.string() },
      derivations: { display: t.string(), boom: t.number(), none: t.any() },
    },
    init: (f: any) => {
      f.name = "Ada";
      f.count = 1;
      f.plan = "free";
    },
    derive: {
      display: (f: any) => `${f.name} (${f.count})`,
      boom: (f: any) => {
        if (f.count > 1) {
          throw new Error("boom");
        }
        return 1;
      },
      none: () => undefined,
    },
  } as never);

const SECRET = "secret-of-32-characters-exactly!";
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDistributableSnapshot (D1 to D5)", () => {
  it("copies the chosen derivations and facts, with ttl, version and metadata", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: acct() }) as any;
    system.start();
    const metadata = { by: "test" };
    const snap = system.getDistributableSnapshot({
      includeDerivations: ["display"],
      includeFacts: ["count"],
      ttlSeconds: 60,
      metadata,
      includeVersion: true,
    });
    expect(snap.data).toEqual({ display: "Ada (1)", count: 1 });
    expect(snap.expiresAt).toBe(snap.createdAt + 60_000);
    expect(snap.version).toMatch(/^[0-9a-f]{1,8}$/);
    expect(snap.metadata).toBe(metadata);
    // D1b: every derivation by default, no fact; D4: a throw is left out.
    expect(Object.keys(system.getDistributableSnapshot().data)).toEqual([
      "display",
      "boom",
      "none",
    ]);
    system.facts.count = 2;
    expect(
      Object.keys(
        system.getDistributableSnapshot({
          includeDerivations: ["boom", "display"],
        }).data,
      ),
    ).toEqual(["display"]);
    system.destroy();
  });

  it("a namespaced system takes dotted keys and nests data by module (D5)", () => {
    const system = createSystem({ modules: { a: acct("a") } }) as any;
    system.start();
    expect(
      system.getDistributableSnapshot({
        includeDerivations: ["a.display"],
        includeFacts: ["a.count"],
      }).data,
    ).toEqual({ a: { display: "Ada (1)", count: 1 } });
    system.destroy();
  });
});

describe("watchDistributableSnapshot (D6 to D8, row (bx))", () => {
  it("(bx): a write to an included fact calls back; an equal write does not", () => {
    const system = createSystem({ module: acct() }) as any;
    system.start();
    const calls: any[] = [];
    const off = system.watchDistributableSnapshot(
      { includeDerivations: ["display"], includeFacts: ["plan"] },
      (snap: any) => calls.push(snap),
    );
    // 1.35 makes no call here: it hears only the watched derivations.
    system.facts.plan = "pro";
    expect(calls.map((c) => c.data)).toEqual([
      { display: "Ada (1)", plan: "pro" },
    ]);
    system.facts.count = 5;
    system.facts.count = 5;
    expect(calls).toHaveLength(2);
    // D7: once per batch, synchronously, every snapshot with a version.
    system.batch(() => {
      system.facts.count = 6;
      system.facts.plan = "team";
      system.facts.count = 7;
    });
    expect(calls).toHaveLength(3);
    expect(calls[2].data).toEqual({ display: "Ada (7)", plan: "team" });
    expect(calls.every((c) => typeof c.version === "string")).toBe(true);
    off();
    system.facts.plan = "free";
    system.facts.count = 8;
    expect(calls).toHaveLength(3);
    system.destroy();
  });

  it("(bx) on a namespaced system: the dotted fact is heard and data nests", () => {
    const system = createSystem({ modules: { a: acct("a") } }) as any;
    system.start();
    const calls: any[] = [];
    const off = system.watchDistributableSnapshot(
      { includeDerivations: ["a.display"], includeFacts: ["a.plan"] },
      (snap: any) => calls.push(snap.data),
    );
    system.facts.a.plan = "pro";
    expect(calls).toEqual([{ a: { display: "Ada (1)", plan: "pro" } }]);
    off();
    system.destroy();
  });

  it("with nothing to watch it warns and returns a no-op (D8)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({ module: acct() }) as any;
    const callback = vi.fn();
    const off = system.watchDistributableSnapshot(
      { includeDerivations: [], includeFacts: ["plan"] },
      callback,
    );
    system.facts.plan = "pro";
    expect(callback).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[Directive] watchDistributableSnapshot: No derivations to watch. Callback will never be called.",
    );
    system.destroy();
  });
});

describe("the observer channel (H4)", () => {
  it("hands notify's clobber-loop event object itself to an observer, with no plugin", () => {
    const system = createSystem({ module: acct() }) as any;
    const seen: unknown[] = [];
    system.observe((event: unknown) => seen.push(event));
    const detected = { type: "resolver.clobber.loop.detected", fact: "x" };
    const resolved = { fact: "no type" };
    system.notify.clobberLoopDetected(detected);
    system.notify.clobberLoopResolved(resolved);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(detected);
    expect(seen[1]).toBe(resolved);
    expect(seen[1]).toEqual({ fact: "no type" });
    system.destroy();
  });
});

describe("the snapshot tools (G1 to G6)", () => {
  it("five are root exports; signSnapshot waits on the surface gate's stock name", () => {
    for (const name of [
      "diffSnapshots",
      "isSignedSnapshot",
      "isSnapshotExpired",
      "validateSnapshot",
      "verifySnapshotSignature",
    ]) {
      expect(typeof (root as Record<string, unknown>)[name], name).toBe(
        "function",
      );
    }
    expect((root as Record<string, unknown>).signSnapshot).toBeUndefined();
  });

  it("(bu): a plain JSON snapshot signs to 1.35's bytes, either way", async () => {
    // Each signature was made by 1.35.0's signSnapshot.
    const a = await signSnapshot(
      { data: { a: 1, b: [1, "x", null], c: { d: true } }, createdAt: 0 },
      SECRET,
    );
    expect(a.signature).toBe(
      "8d4b9fe42acbb7e09727473c948ad5e6feed9c7a03e0ec22ed5ea8af7000755b",
    );
    expect(a.algorithm).toBe("hmac-sha256");
    const b = await signSnapshot(
      {
        data: { a: 1 },
        createdAt: 5,
        expiresAt: 10,
        version: "abc",
        metadata: { k: "v" },
      },
      "s",
    );
    expect(b.signature).toBe(
      "0c6a4e3484546ec78d7f11df27a24c4071a43ca2848f2f6df243a2f2c5291502",
    );
    expect(await verifySnapshotSignature(json(a), SECRET)).toBe(true);
  });

  it("(bu): undefined and a Date verify in place and after JSON", async () => {
    const system = createSystem({ module: acct() }) as any;
    system.start();
    const signed = await signSnapshot(
      system.getDistributableSnapshot({
        includeDerivations: ["display", "none"],
      }),
      SECRET,
    );
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
    expect(await verifySnapshotSignature(json(signed), SECRET)).toBe(true);
    const dated = await signSnapshot(
      { data: { at: new Date(0) }, createdAt: 0 },
      SECRET,
    );
    expect(await verifySnapshotSignature(dated, SECRET)).toBe(true);
    expect(await verifySnapshotSignature(json(dated), SECRET)).toBe(true);
    system.destroy();
  });

  it("(bv): data past 50 levels throws at signing and does not verify", async () => {
    const deep = (leaf: string) => {
      let v: unknown = leaf;
      for (let i = 0; i < 60; i++) {
        v = { n: v };
      }
      return v as Record<string, unknown>;
    };
    await expect(
      signSnapshot({ data: deep("a"), createdAt: 0 }, SECRET),
    ).rejects.toThrow(/more than 50 levels/);
    const shallow = await signSnapshot(
      { data: { n: "a" }, createdAt: 0 },
      SECRET,
    );
    expect(
      await verifySnapshotSignature(
        { ...shallow, data: deep("EVIL") } as never,
        SECRET,
      ),
    ).toBe(false);
    // 49 levels inside data is still covered.
    let ok: unknown = "a";
    for (let i = 0; i < 48; i++) {
      ok = { n: ok };
    }
    const fine = await signSnapshot(
      { data: ok as Record<string, unknown>, createdAt: 0 },
      SECRET,
    );
    expect(await verifySnapshotSignature(fine, SECRET)).toBe(true);
  });

  it('(bv): a function is dropped, so "[function]" does not verify in its place; a cycle throws', async () => {
    const signed = await signSnapshot(
      { data: { f: () => 1, k: 1 } as never, createdAt: 0 },
      SECRET,
    );
    expect(
      await verifySnapshotSignature(
        { ...signed, data: { f: "[function]", k: 1 } } as never,
        SECRET,
      ),
    ).toBe(false);
    expect(
      await verifySnapshotSignature(
        { ...signed, data: { k: 1 } } as never,
        SECRET,
      ),
    ).toBe(true);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(
      signSnapshot({ data: cycle, createdAt: 0 }, SECRET),
    ).rejects.toThrow(TypeError);
  });

  it("(bu): a BigInt, Map, Set or RegExp has no JSON form, so it signs to 1.35's bytes and both cross-verify", async () => {
    // Each signature was made by 1.35.0's signSnapshot (packages/core/src).
    const cases: [object, string][] = [
      [
        { data: { b: 10n }, createdAt: 0, metadata: { n: 2n } },
        "62fb26b1f4efc836b8ce30c03945ed671a4b5a37012977a843ac7e36ec22a5fb",
      ],
      [
        {
          data: {
            m: new Map<string, unknown>([
              ["k", 1],
              ["j", { x: [1, null] }],
            ]),
          },
          createdAt: 0,
        },
        "368a993d1b8988eab1135f56f6d83705096dc9ac33a144d6f08d0c93042cb5f6",
      ],
      [
        { data: { s: new Set([2, 1, "a"]) }, createdAt: 0 },
        "63b11a3dbf4a06769ddd9a1a007edee08cd26ff4fce3ab60ad50a4ad7b1b6e91",
      ],
      [
        { data: { r: /ab+/gi }, createdAt: 0 },
        "5d2c2922525cd4e7bf5c3fe0b7b900cd53c98c6dd41f5e522cfe75f5a48626d8",
      ],
    ];
    for (const [snapshot, signature] of cases) {
      expect(
        await verifySnapshotSignature(
          { ...snapshot, signature, algorithm: "hmac-sha256" } as never,
          SECRET,
        ),
      ).toBe(true);
      const signed = await signSnapshot(snapshot as never, SECRET);
      expect(signed.signature).toBe(signature);
    }
  });

  it("(bv): a Map edited in place does not verify", async () => {
    const signed = await signSnapshot(
      { data: { a: 1, m: new Map([["k", 1]]) }, createdAt: 0 },
      SECRET,
    );
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
    expect(
      await verifySnapshotSignature(
        { ...signed, data: { a: 1, m: new Map([["k", 999]]) } },
        SECRET,
      ),
    ).toBe(false);
    expect(
      await verifySnapshotSignature(
        { ...signed, data: { a: 1, m: new Set([1]) } } as never,
        SECRET,
      ),
    ).toBe(false);
  });

  it("(bv): a Symbol, a function in a Map, or a non-Date toJSON is refused, never signed uncovered", async () => {
    for (const data of [
      { s: Symbol("x") },
      { t: { toJSON: () => "T", hidden: 1 } },
      { m: new Map([["f", () => 1]]) },
    ]) {
      await expect(
        signSnapshot({ data, createdAt: 0 } as never, SECRET),
      ).rejects.toThrow(
        "[Directive] signSnapshot: the snapshot's data or metadata holds a Symbol",
      );
      expect(
        await verifySnapshotSignature(
          {
            data,
            createdAt: 0,
            signature: "0".repeat(64),
            algorithm: "hmac-sha256",
          } as never,
          SECRET,
        ),
      ).toBe(false);
    }
  });

  it("expiry, metadata and the other tools keep 1.35's rules (G2, G6)", async () => {
    const signed = await signSnapshot(
      { data: { a: 1 }, createdAt: 0, expiresAt: 1000, metadata: { m: 1 } },
      SECRET,
    );
    expect(await verifySnapshotSignature(signed, SECRET, { now: 1000 })).toBe(
      true,
    );
    expect(await verifySnapshotSignature(signed, SECRET, { now: 1001 })).toBe(
      false,
    );
    expect(
      await verifySnapshotSignature(signed, SECRET, {
        now: 1001,
        ignoreExpiry: true,
      }),
    ).toBe(true);
    expect(
      await verifySnapshotSignature({ ...signed, metadata: { m: 2 } }, SECRET),
    ).toBe(false);
    expect(await verifySnapshotSignature(signed, "other")).toBe(false);
    expect(isSignedSnapshot(signed)).toBe(true);
    expect(isSignedSnapshot({ data: {}, createdAt: 0 })).toBe(false);
    expect(isSnapshotExpired(signed, 1000)).toBe(false);
    expect(() => validateSnapshot(signed, 1001)).toThrow(
      "[Directive] Snapshot expired at 1970-01-01T00:00:01.000Z. Obtain a fresh snapshot from the source.",
    );
    expect(validateSnapshot(signed, 1000)).toEqual({ a: 1 });
    await expect(
      signSnapshot({ data: {}, createdAt: 0 }, ""),
    ).rejects.toThrow();
    const diff = diffSnapshots(
      { data: { a: 1, b: { c: 1 } }, createdAt: 0 },
      { data: { a: 2, b: { c: 2 }, d: 1 }, createdAt: 0 },
    );
    expect(diff.changes.map((c) => [c.path, c.type])).toEqual([
      ["a", "changed"],
      ["b.c", "changed"],
      ["d", "added"],
    ]);
    expect(diff.versionChanged).toBe(false);
  });
});
