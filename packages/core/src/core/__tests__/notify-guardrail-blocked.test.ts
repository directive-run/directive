/**
 * Tests for `system.notify.guardrailBlocked` — RFC 0010 plugin
 * authoring surface + .
 *
 * The notify surface is public on `System` so external guardrail
 * plugins can emit `"guardrail.blocked"` events through the same
 * fabric as engine-internal events. Two surfaces are closed:
 *   1. `plugin` field validation — must match a registered plugin
 *      name; unknown names are dropped + warned.
 *   2. Reentry depth cap — a plugin's `onGuardrailBlocked` hook
 *      that re-emits via `notify.guardrailBlocked` is allowed to
 *      depth 4, then dropped (prevents stack-overflow recursion).
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const module = createModule("nt", {
  schema: {
    facts: { tick: t.number() },
    events: { bump: { v: t.number() } },
  },
  init: (f) => {
    f.tick = 0;
  },
  events: {
    bump: (f, p) => {
      f.tick = p.v;
    },
  },
});

describe("system.notify.guardrailBlocked — ", () => {
  it("emits the typed event when plugin name matches a registered plugin", () => {
    const events: Array<{
      type: string;
      plugin?: string;
      key?: string;
      kind?: string;
    }> = [];
    const system = createSystem({
      module,
      plugins: [
        {
          name: "my-guardrail",
        },
      ],
    });
    system.observe((e) => {
      if (e.type === "guardrail.blocked") events.push(e);
    });
    system.start();
    system.notify.guardrailBlocked(
      "my-guardrail",
      "tick",
      "alert",
      1,
      "synthetic",
    );
    expect(events.length).toBe(1);
    expect(events[0]?.plugin).toBe("my-guardrail");
    expect(events[0]?.key).toBe("tick");
    expect(events[0]?.kind).toBe("alert");
    system.destroy();
  });

  it("drops + warns when called with an unknown plugin name (forgery defense)", () => {
    const events: Array<{ type: string }> = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = createSystem({
      module,
      plugins: [{ name: "my-guardrail" }],
    });
    system.observe((e) => {
      if (e.type === "guardrail.blocked") events.push(e);
    });
    system.start();
    // A malicious / third-party plugin tries to forge a fact-pii event.
    system.notify.guardrailBlocked(
      "fact-pii-guardrail", // not registered in this system
      "tick",
      "redact",
      1,
    );
    expect(events.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown plugin "fact-pii-guardrail"'),
    );
    warnSpy.mockRestore();
    system.destroy();
  });

  it("caps reentry depth to prevent infinite recursion through the broadcast fabric", () => {
    let emissionCount = 0;
    const system = createSystem({
      module,
      plugins: [
        {
          name: "echo",
          // This plugin re-emits on every guardrail.blocked event it
          // sees. Without the reentry cap, this would recurse forever.
          onGuardrailBlocked: () => {
            emissionCount += 1;
            system.notify.guardrailBlocked("echo", "tick", "alert", 1);
          },
        },
      ],
    });
    system.start();
    // Bootstrap the first emission. The plugin's hook fires, which
    // re-emits, which fires the hook again, etc. The depth cap drops
    // emissions past depth 4 so the recursion terminates.
    system.notify.guardrailBlocked("echo", "tick", "alert", 1);
    // First emission + depth 1..4 re-emissions = at most 5 hook
    // invocations. The exact number depends on whether the cap is
    // before or after the increment; the GUARANTEE is bounded.
    expect(emissionCount).toBeLessThanOrEqual(8);
    expect(emissionCount).toBeGreaterThan(0);
    system.destroy();
  });

  it("is a no-op after destroy", () => {
    const events: Array<{ type: string }> = [];
    const system = createSystem({
      module,
      plugins: [{ name: "guard" }],
    });
    system.observe((e) => {
      if (e.type === "guardrail.blocked") events.push(e);
    });
    system.start();
    system.destroy();
    system.notify.guardrailBlocked("guard", "tick", "alert", 1);
    expect(events.length).toBe(0);
  });
});
