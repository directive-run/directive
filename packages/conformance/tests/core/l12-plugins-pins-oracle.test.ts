// Ported from packages/core/src/core/__tests__/l12-plugins-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import {
  createAuditLedger,
  createModule,
  createRequirementStatusPlugin,
  createSystem,
  createSystemWithStatus,
  isSnapshotExpired,
  signSnapshot,
  t,
  validateSnapshot,
  verifySnapshotSignature,
} from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The L12 RFC's probe pins (development): U3, U4, U5 to U10, U13 and U17 of
// its untested list. Each pins 1.35's behaviour. U5, U6 and U10 are where
// the rows (bu), (bv) and (bw) live. (bu) and (bv) are built (L12a), so at
// the L12 gate U5 and U6 keep only what both engines share and name their
// rows (as at L6 to L11); core-next's l12a-distributable pins 2.0's side.
// (bw) is declined, so U10 still pins 1.35. U1, U2 and U16 are diff
// scenarios ("L12 pins"); the production halves of U3 and U4 are in
// l12-plugins-pins-oracle-production.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function warned(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map((args) => args.map(String).join(" "));
}

/** The probes' module: three facts, a derivation that throws past 1, one undefined. */
function acct() {
  return createModule("acct", {
    schema: {
      facts: { name: t.string(), count: t.number(), plan: t.string() },
      derivations: { display: t.string(), boom: t.number(), none: t.any() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.name = "Ada";
      facts.count = 1;
      facts.plan = "free";
    },
    derive: {
      display: (facts: any) => `${facts.name} (${facts.count})`,
      boom: (facts: any) => {
        if (facts.count > 1) {
          throw new Error("boom");
        }

        return facts.count;
      },
      none: () => undefined,
    },
  } as never);
}

function started(): any {
  const system = createSystem({ module: acct() } as never) as any;
  system.start();

  return system;
}

/** `depth` objects nested under `v`, ending in `leaf`. */
function nested(depth: number, leaf: unknown): unknown {
  let out: unknown = leaf;
  for (let i = 0; i < depth; i++) {
    out = { v: out };
  }

  return out;
}

const SECRET = "0123456789abcdef0123456789abcdef";

describe("L12 probe pins (development)", () => {
  it("U3: a watch with nothing to watch warns, returns a no-op and never calls (D5)", async () => {
    const system = started();
    const calls: unknown[] = [];
    const stop = system.watchDistributableSnapshot(
      { includeDerivations: [] },
      (snapshot: unknown) => calls.push(snapshot),
    );

    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
    system.facts.count = 5;
    await wait();
    expect(calls).toEqual([]);
    expect(
      warned().filter((line) =>
        line.includes("watchDistributableSnapshot: No derivations to watch"),
      ),
    ).toHaveLength(1);
    system.destroy();
  });

  it("U4: unknown keys are ignored with a warning naming what is available (D2)", () => {
    const system = started();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display", "nope"],
      includeFacts: ["count", "missing"],
    });

    expect(snapshot.data).toEqual({ display: "Ada (1)", count: 1 });
    const lines = warned();
    expect(
      lines.filter((line) => line.includes("Unknown derivation keys ignored")),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.includes("Unknown fact keys ignored")),
    ).toHaveLength(1);
    expect(lines.join("\n")).toContain("nope");
    expect(lines.join("\n")).toContain("missing");
    system.destroy();
  });

  it("U4: a throwing derivation is left out with a warning (D3)", () => {
    const system = started();
    system.facts.count = 2;
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display", "boom"],
    });

    expect(snapshot.data).toEqual({ display: "Ada (2)" });
    expect("boom" in snapshot.data).toBe(false);
    expect(
      warned().filter((line) => line.includes('Skipping derivation "boom"')),
    ).toHaveLength(1);
    system.destroy();
  });

  it("U4: with no options every derivation is in and no fact (D1b)", () => {
    const system = started();
    const snapshot = system.getDistributableSnapshot();

    expect(Object.keys(snapshot.data).sort()).toEqual([
      "boom",
      "display",
      "none",
    ]);
    expect(snapshot.data.display).toBe("Ada (1)");
    expect(snapshot.version).toBeUndefined();
    expect(snapshot.expiresAt).toBeUndefined();
    system.destroy();
  });

  it("U4: namespaced keys nest under their module (D7)", () => {
    const system = createSystem({ modules: { a: acct() } } as never) as any;
    system.start();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["a.display"],
      includeFacts: ["a.count"],
    });

    expect(snapshot.data).toEqual({ a: { display: "Ada (1)", count: 1 } });
    system.destroy();
  });

  // Row (bu), approved ("I approve you for to do everything", 2026-11-15):
  // 2.0 signs data and metadata in their JSON form, so a snapshot holding
  // undefined or a Date also verifies after a JSON round trip. 1.35 fails
  // it there: that is 1.35's side only, so these keep what both engines
  // share. 2.0's side: core-next l12a-distributable "(bu): undefined and a
  // Date verify in place and after JSON".
  it("U5: a snapshot holding undefined verifies in place (S2; row (bu))", async () => {
    const system = started();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display", "none"],
    });
    expect("none" in snapshot.data).toBe(true);
    const signed = await signSnapshot(snapshot, SECRET);

    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
    system.destroy();
  });

  it("U5: a snapshot holding a Date verifies in place (S3; row (bu))", async () => {
    const signed = await signSnapshot(
      { data: { at: new Date(0) }, createdAt: 0 },
      SECRET,
    );

    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
  });

  it("U5: plain JSON data verifies in place and after JSON (S1)", async () => {
    const signed = await signSnapshot({ data: { a: 1 }, createdAt: 0 }, SECRET);

    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.algorithm).toBe("hmac-sha256");
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
    expect(
      await verifySnapshotSignature(JSON.parse(JSON.stringify(signed)), SECRET),
    ).toBe(true);
  });

  // Row (bv), approved ("I approve you for to do everything", 2026-11-15):
  // 2.0 refuses to sign data past 50 levels (signSnapshot throws) and drops
  // a function as JSON does, so "[function]" no longer verifies in its
  // place. 1.35 signs a "[max depth exceeded]" placeholder, so a change
  // below 50 levels still verifies, and signs a function as "[function]":
  // that is 1.35's side only, so these keep what both engines share. 2.0's
  // side: core-next l12a-distributable "(bv): data past 50 levels throws at
  // signing and does not verify" and "(bv): a function is dropped, so
  // "[function]" does not verify in its place; a cycle throws".
  it("U6: data 60 levels deep under a shallow snapshot's signature does not verify (S5; row (bv))", async () => {
    const signed = await signSnapshot(
      { data: nested(3, "a"), createdAt: 0 },
      SECRET,
    );
    const forged = { ...signed, data: nested(60, "a") };

    expect(await verifySnapshotSignature(forged as never, SECRET)).toBe(false);
  });

  it("U6: a change at a shallow level does not verify", async () => {
    const signed = await signSnapshot(
      { data: nested(3, "a"), createdAt: 0 },
      SECRET,
    );
    const forged = { ...signed, data: nested(3, "EVIL") };

    expect(await verifySnapshotSignature(forged as never, SECRET)).toBe(false);
  });

  it("U6: a snapshot holding a function signs and verifies in place (S6; row (bv))", async () => {
    const signed = await signSnapshot(
      { data: { f: () => 1 }, createdAt: 0 },
      SECRET,
    );

    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
  });

  it("U7: an empty secret throws (S4)", async () => {
    await expect(
      signSnapshot({ data: { a: 1 }, createdAt: 0 }, ""),
    ).rejects.toBeDefined();
  });

  it("U8: verify is true at exactly expiresAt and false after (S7)", async () => {
    const snapshot = { data: { a: 1 }, createdAt: 0, expiresAt: 1000 };
    const signed = await signSnapshot(snapshot, SECRET);

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
    expect(isSnapshotExpired(snapshot, 1000)).toBe(false);
    expect(isSnapshotExpired(snapshot, 1001)).toBe(true);
    expect(() => validateSnapshot(snapshot, 1001)).toThrow(
      /Snapshot expired at 1970-01-01T00:00:01\.000Z/,
    );
    expect(validateSnapshot(snapshot, 1000)).toEqual({ a: 1 });
  });

  it("U8: metadata and an added expiresAt are covered by the signature (S8)", async () => {
    const signed = await signSnapshot(
      { data: { a: 1 }, createdAt: 0, metadata: { by: "server" } },
      SECRET,
    );

    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);
    expect(
      await verifySnapshotSignature(
        { ...signed, metadata: { by: "client" } },
        SECRET,
      ),
    ).toBe(false);
    expect(
      await verifySnapshotSignature({ ...signed, expiresAt: 10 ** 15 }, SECRET),
    ).toBe(false);
  });

  // U9 sits at L12: the observer channel for the clobber-loop events (H4)
  // is L12a's, and the audit ledger is its consumer (it reads them through
  // `observe()`, audit-ledger/index.ts's two `case` labels). Each test reads
  // the events both ways.
  function ledgerKinds(ledger: any, kind: string): any[] {
    return (ledger.query({}) as any[]).filter((e) => e.kind === kind);
  }

  it("U9: the clobber-loop events reach an observer as the object given, with no type added (C1)", async () => {
    const heard: unknown[] = [];
    const hooks: unknown[] = [];
    const ledger = createAuditLedger();
    const system = createSystem({
      module: acct(),
      plugins: [
        {
          name: "loop-hook",
          onClobberLoopDetected: (event: unknown) => hooks.push(event),
        },
        ledger.plugin,
      ],
    } as never) as any;
    system.start();
    await wait();
    const stop = system.observe((event: any) => {
      if (
        event?.type?.startsWith?.("resolver.clobber.loop") ||
        event?.fact === "no type"
      ) {
        heard.push(event);
      }
    });
    const detected = {
      type: "resolver.clobber.loop.detected",
      fact: "count",
      participants: ["a", "b"],
      count: 3,
    };
    const resolved = {
      type: "resolver.clobber.loop.resolved",
      fact: "count",
      participants: ["a", "b"],
    };
    system.notify.clobberLoopDetected(detected);
    system.notify.clobberLoopResolved(resolved);
    const untyped = { fact: "no type" };
    system.notify.clobberLoopDetected(untyped);

    expect(heard).toHaveLength(3);
    expect(heard[0]).toBe(detected);
    expect(heard[1]).toBe(resolved);
    expect(heard[2]).toBe(untyped);
    expect(untyped).toEqual({ fact: "no type" });
    expect(hooks).toEqual([detected, untyped]);
    // The ledger keeps one entry per typed event; the untyped one matches
    // no case label.
    const loops = ledgerKinds(ledger, "resolver.clobber.loop.detected");
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({
      fact: "count",
      participants: ["a", "b"],
      count: 3,
    });
    expect(ledgerKinds(ledger, "resolver.clobber.loop.resolved")).toHaveLength(
      1,
    );
    expect(ledger.verify().valid).toBe(true);
    stop();
    system.destroy();
    ledger.destroy();
  });

  it("U9: with no hook for the event, the observers alone hear it (C2)", async () => {
    // The ledger defines no onClobberLoopDetected hook: it hears the event
    // only through observe(), like the plain observer beside it.
    const ledger = createAuditLedger();
    const system = createSystem({
      module: acct(),
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    await wait();
    const heard: unknown[] = [];
    const stop = system.observe((event: any) => {
      if (event?.type?.startsWith?.("resolver.clobber.loop")) {
        heard.push(event);
      }
    });
    const detected = {
      type: "resolver.clobber.loop.detected",
      fact: "count",
    };
    system.notify.clobberLoopDetected(detected);

    expect(heard).toEqual([detected]);
    expect(heard[0]).toBe(detected);
    expect(ledgerKinds(ledger, "resolver.clobber.loop.detected")).toHaveLength(
      1,
    );
    stop();
    system.destroy();
    ledger.destroy();
  });

  it("U9: after the observer leaves and with no plugin, a notify reaches no one and does not throw", () => {
    const system = createSystem({ module: acct() } as never) as any;
    system.start();
    const heard: unknown[] = [];
    const stop = system.observe((event: any) => heard.push(event));
    stop();

    expect(() =>
      system.notify.clobberLoopDetected({
        type: "resolver.clobber.loop.detected",
        fact: "count",
      }),
    ).not.toThrow();
    expect(
      heard.filter((e: any) => e?.type?.startsWith?.("resolver.clobber")),
    ).toEqual([]);
    system.destroy();
  });

  it('U10: verify({ strong: true }) throws 1.35\'s "reserved for v2"; entries are djb2-1, chained by hex hashes of at most 8 characters (A1)', async () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: acct(),
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    await wait();
    system.facts.count = 2;
    await wait();

    const verdict = ledger.verify();
    expect(verdict.valid).toBe(true);
    expect(() => ledger.verify({ strong: true } as never)).toThrow(
      /reserved for v2/,
    );
    const entries = ledger.query({}) as unknown as Array<
      Record<string, unknown>
    >;
    expect(entries.length).toBeGreaterThan(0);
    // One genesis entry; every other is chained by a 32-bit djb2 hash in
    // lowercase hex, not zero-padded, so at most 8 characters (the RFC's A1
    // probe said "8-character"; a run found a 7-character one).
    expect(entries.filter((e) => e.prevHash === null)).toHaveLength(1);
    for (const entry of entries) {
      expect(entry.hashAlgo).toBe("djb2-1");
      if (entry.prevHash !== null) {
        expect(entry.prevHash).toMatch(/^[0-9a-f]{1,8}$/);
      }
    }
    expect(entries.some((e) => e.kind === "fact.change")).toBe(true);
    system.destroy();
    ledger.destroy();
  });

  it("U13: the status plugin tracks a requirement from pending to settled", async () => {
    const status = createRequirementStatusPlugin();
    let release: () => void = () => {};
    const mod = createModule("load", {
      schema: {
        facts: { want: t.boolean(), got: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: {} },
      },
      init: (facts: any) => {
        facts.want = false;
        facts.got = 0;
      },
      constraints: {
        fetch: {
          when: (facts: any) => facts.want && facts.got === 0,
          require: { type: "FETCH" },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          resolve: async (_req: unknown, context: any) => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            context.facts.got = 1;
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [status.plugin],
    } as never) as any;
    let changes = 0;
    const unsubscribe = status.subscribe(() => {
      changes++;
    });
    system.start();
    await wait();

    expect(status.getStatus("FETCH")).toMatchObject({
      pending: 0,
      inflight: 0,
      failed: 0,
      isLoading: false,
      hasError: false,
      lastError: null,
    });
    system.facts.want = true;
    await wait();
    expect(status.getStatus("FETCH").isLoading).toBe(true);
    expect(status.getAllStatus().has("FETCH")).toBe(true);
    release();
    await wait();
    await wait();
    expect(system.facts.got).toBe(1);
    expect(status.getStatus("FETCH")).toMatchObject({
      inflight: 0,
      isLoading: false,
      hasError: false,
    });
    expect(changes).toBeGreaterThan(0);
    unsubscribe();
    status.reset();
    expect(status.getAllStatus().size).toBe(0);
    system.destroy();
  });

  it("U13: the status plugin records a failed requirement's error", async () => {
    const status = createRequirementStatusPlugin();
    const mod = createModule("load", {
      schema: {
        facts: { want: t.boolean() },
        derivations: {},
        events: {},
        requirements: { FETCH: {} },
      },
      init: (facts: any) => {
        facts.want = true;
      },
      constraints: {
        fetch: {
          when: (facts: any) => facts.want,
          require: { type: "FETCH" },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          resolve: async () => {
            throw new Error("down");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [status.plugin],
    } as never) as any;
    let sawError = false;
    status.subscribe(() => {
      sawError ||= status.getStatus("FETCH").hasError;
    });
    system.start();
    await wait(5);
    await wait(5);

    // The failure is reported; the error stays as lastError.
    expect(sawError).toBe(true);
    const s = status.getStatus("FETCH");
    expect(s.lastError).toBeInstanceOf(Error);
    expect(String((s.lastError as Error).message)).toContain("down");
    system.destroy();
  });

  it("U13: createSystemWithStatus wires the status plugin into the system", async () => {
    const mod = createModule("load", {
      schema: {
        facts: { want: t.boolean(), got: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: {} },
      },
      init: (facts: any) => {
        facts.want = true;
        facts.got = 0;
      },
      constraints: {
        fetch: {
          when: (facts: any) => facts.want && facts.got === 0,
          require: { type: "FETCH" },
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          resolve: async (_req: unknown, context: any) => {
            context.facts.got = 1;
          },
        },
      },
    } as never);
    const { system, statusPlugin } = createSystemWithStatus({
      module: mod,
    } as never) as any;
    const seen: boolean[] = [];
    statusPlugin.subscribe(() => {
      seen.push(statusPlugin.getStatus("FETCH").isLoading);
    });
    system.start();
    await wait(5);
    await wait(5);

    expect(system.facts.got).toBe(1);
    expect(seen).toContain(true);
    expect(statusPlugin.getStatus("FETCH").isLoading).toBe(false);
    system.destroy();
  });

  it("U17: registerModule and unregisterModule reach an observer as { type, id }", async () => {
    const system = createSystem({ modules: { a: acct() } } as never) as any;
    system.start();
    const heard: unknown[] = [];
    const stop = system.observe((event: any) => {
      if (event?.type?.startsWith?.("module.")) {
        heard.push(event);
      }
    });
    system.registerModule(
      "x",
      createModule("x", {
        schema: { facts: { c: t.number() } },
        init: (facts: any) => {
          facts.c = 10;
        },
      } as never),
    );
    await wait(5);
    await system.unregisterModule("x");
    await wait(5);

    expect(heard).toEqual([
      { type: "module.registered", id: "x" },
      { type: "module.unregistered", id: "x" },
    ]);
    stop();
    system.destroy();
  });
});

// The L12 gate's mutation pins (run 3): the feature-layer mutants of
// getDistributableSnapshot and watchDistributableSnapshot the gate=L12 run
// 44937079779 left alive or unreached (engine.ts 4138 to 4256): the full
// unknown-key warnings, "(none)" when nothing is available, exclusions in a
// snapshot and in a watch, a watch of every derivation, and metadata. Both
// engines print and behave the same (core-next api/distributable.ts).
function bare() {
  return createModule("bare", {
    schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
    init: () => {},
    derive: {},
  } as never);
}

describe("L12 gate mutation pins (development)", () => {
  it("U4: the unknown-key warnings name the ignored keys and every available one", () => {
    const system = started();
    system.getDistributableSnapshot({
      includeDerivations: ["display", "nope"],
      includeFacts: ["count", "missing"],
    });

    expect(warned()).toEqual([
      "[Directive] getDistributableSnapshot: Unknown derivation keys ignored: nope. Available: display, boom, none",
      "[Directive] getDistributableSnapshot: Unknown fact keys ignored: missing. Available: name, count, plan",
    ]);
    system.destroy();
  });

  it("U4: with nothing available the warnings say (none)", () => {
    const system = createSystem({ module: bare() } as never) as any;
    system.start();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["nope"],
      includeFacts: ["missing"],
    });

    expect(snapshot.data).toEqual({});
    expect(warned()).toEqual([
      "[Directive] getDistributableSnapshot: Unknown derivation keys ignored: nope. Available: (none)",
      "[Directive] getDistributableSnapshot: Unknown fact keys ignored: missing. Available: (none)",
    ]);
    system.destroy();
  });

  it("U4: excludeDerivations leaves those derivations out, with or without an include list", () => {
    const system = started();

    expect(
      Object.keys(
        system.getDistributableSnapshot({ excludeDerivations: ["boom"] }).data,
      ).sort(),
    ).toEqual(["display", "none"]);
    expect(
      system.getDistributableSnapshot({
        includeDerivations: ["display", "boom"],
        excludeDerivations: ["display"],
      }).data,
    ).toEqual({ boom: 1 });
    expect(warned()).toEqual([]);
    system.destroy();
  });

  it("U4: metadata is carried as given", () => {
    const system = started();
    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["display"],
      metadata: { source: "pin", n: 1 },
    });

    expect(snapshot.metadata).toEqual({ source: "pin", n: 1 });
    expect(
      "metadata" in system.getDistributableSnapshot({ includeDerivations: [] }),
    ).toBe(false);
    system.destroy();
  });

  it("a watch with no include list watches every derivation, less its exclusions", async () => {
    const system = started();
    const all: any[] = [];
    const some: any[] = [];
    const stopAll = system.watchDistributableSnapshot({}, (s: any) =>
      all.push(s.data),
    );
    const stopSome = system.watchDistributableSnapshot(
      { excludeDerivations: ["display", "none"] },
      (s: any) => some.push(s.data),
    );

    system.facts.name = "Bo";
    await wait();
    expect(all).toEqual([{ display: "Bo (1)", boom: 1, none: undefined }]);
    expect(some).toEqual([]);
    system.facts.count = 0;
    await wait();
    expect(all).toHaveLength(2);
    expect(some).toEqual([{ boom: 0 }]);
    stopAll();
    stopSome();
    system.destroy();
  });

  it("a watch whose exclusions remove every derivation warns and never calls", async () => {
    const system = started();
    const calls: unknown[] = [];
    const stop = system.watchDistributableSnapshot(
      { excludeDerivations: ["display", "boom", "none"] },
      (s: unknown) => calls.push(s),
    );

    system.facts.name = "Bo";
    system.facts.count = 0;
    await wait();
    expect(calls).toEqual([]);
    expect(warned()).toEqual([
      "[Directive] watchDistributableSnapshot: No derivations to watch. Callback will never be called.",
    ]);
    stop();
    system.destroy();
  });
});

// The L12 principal review (2026-11-27): three weakenings of
// verifySnapshotSignature and 14 dropped ledger payload fields passed every
// test on both engines. Each pin below states what 1.35 does.
describe("L12 review pins: a signature is checked whole (development)", () => {
  const SNAPSHOT = { data: { a: 1 }, createdAt: 0 };

  it("a wrong, missing or differently cased algorithm does not verify", async () => {
    const signed = await signSnapshot(SNAPSHOT, SECRET);
    expect(await verifySnapshotSignature(signed, SECRET)).toBe(true);

    for (const algorithm of ["hmac-sha512", "none", "", "HMAC-SHA256"]) {
      expect(
        await verifySnapshotSignature(
          { ...signed, algorithm } as never,
          SECRET,
        ),
      ).toBe(false);
    }
    const { algorithm: _dropped, ...bare } = signed;
    expect(await verifySnapshotSignature(bare as never, SECRET)).toBe(false);
  });

  it("a signature right only in its first 8 hex characters does not verify", async () => {
    const signed = await signSnapshot(SNAPSHOT, SECRET);
    const flip = (c: string) => (c === "0" ? "1" : "0");
    const head = signed.signature.slice(0, 8);
    const tail = [...signed.signature.slice(8)].map(flip).join("");
    expect(`${head}${tail}`).toHaveLength(64);

    expect(
      await verifySnapshotSignature(
        { ...signed, signature: `${head}${tail}` },
        SECRET,
      ),
    ).toBe(false);
    // One wrong character, at each position past the eighth and at the last.
    for (const i of [8, 9, 31, 32, 63]) {
      const s = signed.signature;
      const signature = `${s.slice(0, i)}${flip(s[i] as string)}${s.slice(i + 1)}`;
      expect(
        await verifySnapshotSignature({ ...signed, signature }, SECRET),
      ).toBe(false);
    }
  });

  it("a signature of the wrong length does not verify, though every character it has is right", async () => {
    const signed = await signSnapshot(SNAPSHOT, SECRET);
    const s = signed.signature;

    for (const signature of [
      s.slice(0, 8),
      s.slice(0, 32),
      s.slice(0, 63),
      `${s}0`,
      `${s}${s}`,
    ]) {
      expect(
        await verifySnapshotSignature({ ...signed, signature }, SECRET),
      ).toBe(false);
    }
  });
});

describe("L12 review pins: the audit ledger's payload, field by field (development)", () => {
  /** An entry less what the chain adds (its place, time and hash link). */
  function payload(entry: any): Record<string, unknown> {
    const { seq, ts, prevHash, hashAlgo, schemaVersion, ...rest } = entry;
    expect(typeof seq).toBe("number");
    expect(typeof ts).toBe("number");
    expect(hashAlgo).toBe("djb2-1");
    expect(schemaVersion).toBe(2);
    expect(prevHash === null || typeof prevHash === "string").toBe(true);

    return rest;
  }

  /** Every entry of `kind`, oldest first, as payloads. */
  function payloads(ledger: any, kind: string): Record<string, unknown>[] {
    return (ledger.query({}) as any[])
      .filter((e) => e.kind === kind)
      .sort((a, b) => a.seq - b.seq)
      .map(payload);
  }

  const FUNCTION_WHEN = {
    kind: "function",
    sourceHash: expect.stringMatching(/^[0-9a-f]{1,8}$/),
  };

  /** A load that succeeds, a FAIL that throws, history on: run, then go back. */
  async function worked() {
    const module = createModule("m", {
      schema: {
        facts: { count: t.number(), label: t.string(), boom: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: { id: t.number() }, FAIL: {} },
      },
      init: (facts: any) => {
        facts.count = 0;
        facts.label = "start";
        facts.boom = false;
      },
      constraints: {
        needLoad: {
          when: (facts: any) => facts.count >= 2 && facts.label !== "loaded",
          require: (facts: any) => ({ type: "LOAD", id: facts.count }),
        },
        needFail: {
          when: (facts: any) => facts.boom === true,
          require: { type: "FAIL" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, ctx: any) => {
            ctx.facts.label = "loaded";
          },
        },
        fail: {
          requirement: "FAIL",
          resolve: async () => {
            throw new Error("nope");
          },
        },
      },
    } as never);
    const ledger = createAuditLedger();
    const system = createSystem({
      module,
      history: true,
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    await system.settle();
    system.facts.count = 2;
    await system.settle();
    system.facts.boom = true;
    try {
      await system.settle();
    } catch {
      // The FAIL resolver's error; the ledger has it.
    }
    await wait(10);
    system.history.goBack();
    await wait(5);
    system.stop();

    return { ledger, system };
  }

  it("system.init, system.start and system.stop carry the kind alone", async () => {
    const { ledger, system } = await worked();

    for (const kind of ["system.init", "system.start", "system.stop"]) {
      expect(payloads(ledger, kind)).toEqual([{ kind }]);
    }
    system.destroy();
  });

  it("fact.change: key, prior, next and origin; no prior on a first write", async () => {
    const { ledger, system } = await worked();

    expect(payloads(ledger, "fact.change")).toEqual([
      { kind: "fact.change", key: "count", next: 0, origin: "authored" },
      { kind: "fact.change", key: "label", next: "start", origin: "authored" },
      { kind: "fact.change", key: "boom", next: false, origin: "authored" },
      {
        kind: "fact.change",
        key: "count",
        prior: 0,
        next: 2,
        origin: "authored",
      },
      {
        kind: "fact.change",
        key: "label",
        prior: "start",
        next: "loaded",
        origin: "authored",
      },
      {
        kind: "fact.change",
        key: "boom",
        prior: false,
        next: true,
        origin: "authored",
      },
      {
        kind: "fact.change",
        key: "boom",
        prior: true,
        next: false,
        origin: "restore",
      },
    ]);
    system.destroy();
  });

  it("constraint.evaluate: constraintId, active and a function when's source hash", async () => {
    const { ledger, system } = await worked();
    const evaluate = (constraintId: string, active: boolean) => ({
      kind: "constraint.evaluate",
      constraintId,
      active,
      whenSource: FUNCTION_WHEN,
    });

    expect(payloads(ledger, "constraint.evaluate")).toEqual([
      evaluate("needLoad", false),
      evaluate("needFail", false),
      evaluate("needLoad", true),
      evaluate("needLoad", false),
      evaluate("needFail", true),
      evaluate("needLoad", false),
      evaluate("needFail", false),
    ]);
    system.destroy();
  });

  it("resolver.complete: resolverId, requirementId and a duration", async () => {
    const { ledger, system } = await worked();

    expect(payloads(ledger, "resolver.complete")).toEqual([
      {
        kind: "resolver.complete",
        resolverId: "load",
        requirementId: 'LOAD:{"id":2}',
        duration: expect.any(Number),
      },
    ]);
    system.destroy();
  });

  it("resolver.error: resolverId, requirementId and the error as a string", async () => {
    const { ledger, system } = await worked();

    expect(payloads(ledger, "resolver.error")).toEqual([
      {
        kind: "resolver.error",
        resolverId: "fail",
        requirementId: "FAIL:{}",
        error: "Error: nope",
      },
    ]);
    system.destroy();
  });

  it("system.snapshot: snapshotId and trigger, and no facts", async () => {
    const { ledger, system } = await worked();

    expect(payloads(ledger, "system.snapshot")).toEqual([
      {
        kind: "system.snapshot",
        snapshotId: 1,
        trigger: "facts-changed:count,label,boom",
      },
      {
        kind: "system.snapshot",
        snapshotId: 2,
        trigger: "facts-changed:count",
      },
      {
        kind: "system.snapshot",
        snapshotId: 3,
        trigger: "facts-changed:label",
      },
      { kind: "system.snapshot", snapshotId: 4, trigger: "facts-changed:boom" },
    ]);
    system.destroy();
  });

  it("system.history.navigate: from and to", async () => {
    const { ledger, system } = await worked();

    expect(payloads(ledger, "system.history.navigate")).toEqual([
      { kind: "system.history.navigate", from: 3, to: 2 },
    ]);
    system.destroy();
  });

  it("resolver.write.rejected: a rejection names the fact and both values, the summary the count dropped", async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const facts: Record<string, unknown> = { status: t.string() };
    for (const key of keys) {
      facts[key] = t.string();
    }
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const module = createModule("clob", {
      schema: {
        facts,
        derivations: {},
        events: {},
        requirements: { ACT: {} },
      },
      init: (f: any) => {
        f.status = "idle";
        for (const key of keys) {
          f[key] = "a";
        }
      },
      constraints: {
        mutate: {
          when: (f: any) => f.status === "go",
          require: { type: "ACT" },
          abortOn: keys,
        },
      },
      resolvers: {
        run: {
          requirement: "ACT",
          resolve: async (_req: unknown, ctx: any) => {
            await blocker;
            for (const key of keys) {
              ctx.facts[key] = "mine";
            }
          },
        },
      },
    } as never);
    const ledger = createAuditLedger();
    const system = createSystem({
      module,
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    await wait();
    system.facts.status = "go";
    await wait();
    system.batch(() => {
      for (const key of keys) {
        system.facts[key] = "theirs";
      }
    });
    await wait();
    release();
    await wait(5);

    const rejected = {
      kind: "resolver.write.rejected",
      resolverId: "run",
      requirementId: "ACT:{}",
      reason: "clobbered",
    };
    expect(payloads(ledger, "resolver.write.rejected")).toEqual([
      ...keys.slice(0, 10).map((fact) => ({
        ...rejected,
        rejection: "rejection",
        fact,
        expected: "a",
        actual: "theirs",
      })),
      { ...rejected, rejection: "summary", dropped: 1 },
    ]);
    system.destroy();
  });

  it("the clobber-loop entries: every field of the event, and the overlap's verdict alone", () => {
    const ledger = createAuditLedger();
    const system = createSystem({
      module: acct(),
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    const detected = {
      type: "resolver.clobber.loop.detected",
      systemId: "sys-1",
      fact: "count",
      participants: ["a", "b"],
      windowMs: 5000,
      count: 3,
      severity: "warn",
      rejectionSeqs: [4, 6, 9],
    };
    system.notify.clobberLoopDetected({
      ...detected,
      predicateOverlap: { verdict: "overlap", detail: "kept out" },
    });
    system.notify.clobberLoopDetected(detected);
    system.notify.clobberLoopResolved({
      type: "resolver.clobber.loop.resolved",
      systemId: "sys-1",
      fact: "count",
      participants: ["a", "b"],
      durationMs: 1200,
      resolution: "quiet",
    });

    const { type: _type, ...fields } = detected;
    expect(payloads(ledger, "resolver.clobber.loop.detected")).toEqual([
      {
        kind: "resolver.clobber.loop.detected",
        ...fields,
        overlapVerdict: "overlap",
      },
      { kind: "resolver.clobber.loop.detected", ...fields },
    ]);
    expect(payloads(ledger, "resolver.clobber.loop.resolved")).toEqual([
      {
        kind: "resolver.clobber.loop.resolved",
        systemId: "sys-1",
        fact: "count",
        participants: ["a", "b"],
        durationMs: 1200,
        resolution: "quiet",
      },
    ]);
    system.destroy();
  });

  it("source.attach, source.detach and source.error: the source, its module, and an error's phase and message", async () => {
    const module = createModule("src", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.n = 0;
      },
      sources: {
        ticker: { attach: () => () => undefined },
        bad: {
          attach: () => {
            throw new Error("attach failed");
          },
        },
      },
    } as never);
    const ledger = createAuditLedger();
    const system = createSystem({
      module,
      plugins: [ledger.plugin],
    } as never) as any;
    system.start();
    await wait();
    system.stop();

    expect(payloads(ledger, "source.attach")).toEqual([
      { kind: "source.attach", sourceId: "ticker", moduleId: "src" },
    ]);
    expect(payloads(ledger, "source.error")).toEqual([
      {
        kind: "source.error",
        sourceId: "bad",
        moduleId: "src",
        phase: "attach",
        error: "attach failed",
      },
    ]);
    expect(payloads(ledger, "source.detach")).toEqual([
      { kind: "source.detach", sourceId: "ticker", moduleId: "src" },
    ]);
    system.destroy();
  });
});
