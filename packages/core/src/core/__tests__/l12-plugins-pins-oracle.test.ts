import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "../../index.js";

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
