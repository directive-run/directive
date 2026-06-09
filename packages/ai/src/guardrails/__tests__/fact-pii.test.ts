/**
 * Tests for createFactPIIGuardrail — input guardrail at the fact-store boundary.
 *
 * Covers the source → fact → agent prompt PII bypass that R5's red-team /
 * privacy / AI-integration reviewers flagged: a source publishes PII into a
 * fact, the agent prompt embeds the fact, the LLM call ships the PII —
 * and the input-guardrail chain at runStream entry never saw it.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createFactPIIGuardrail } from "../fact-pii.js";

function makeCustomerModule() {
  return createModule("customer", {
    schema: {
      facts: {
        email: t.string().meta({ tags: ["pii"] }),
        ssn: t.string().meta({ tags: ["pii"] }),
        notes: t.string(),
      },
      events: {
        wireProfile: {
          email: t.string(),
          ssn: t.string(),
          notes: t.string(),
        },
      },
    },
    init: (f) => {
      f.email = "";
      f.ssn = "";
      f.notes = "";
    },
    events: {
      wireProfile: (f, payload) => {
        f.email = payload.email;
        f.ssn = payload.ssn;
        f.notes = payload.notes;
      },
    },
  });
}

describe("createFactPIIGuardrail — redact mode", () => {
  it("redacts SSN written into a pii-tagged fact", () => {
    const onBlocked = vi.fn();
    const system = createSystem({
      module: makeCustomerModule(),
      plugins: [createFactPIIGuardrail({ mode: "redact", onBlocked })],
    });
    system.start();
    system.events.wireProfile({
      email: "ok@example.com",
      ssn: "Account SSN 123-45-6789",
      notes: "free-form notes",
    });
    // PII-tagged facts get redacted in place.
    expect(system.facts.ssn).toBe("Account SSN [SSN]");
    expect(system.facts.email).toBe("[EMAIL]");
    // Non-pii fact is untouched.
    expect(system.facts.notes).toBe("free-form notes");
    expect(onBlocked).toHaveBeenCalled();
    const callArgs = onBlocked.mock.calls[0];
    expect(callArgs?.[2]).toBe("redact");
    system.destroy();
  });

  it("does not redact non-pii-tagged facts even if they look like PII", () => {
    const system = createSystem({
      module: makeCustomerModule(),
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();
    system.events.wireProfile({
      email: "ok@example.com",
      ssn: "123-45-6789",
      notes: "the customer's SSN is 999-99-9999",
    });
    expect(system.facts.notes).toBe("the customer's SSN is 999-99-9999");
    system.destroy();
  });

  it("redacts credit card numbers (Luhn-valid)", () => {
    const cardModule = createModule("payment", {
      schema: {
        facts: {
          payload: t.string().meta({ tags: ["pii"] }),
        },
        events: { wire: { payload: t.string() } },
      },
      init: (f) => {
        f.payload = "";
      },
      events: {
        wire: (f, payload) => {
          f.payload = payload.payload;
        },
      },
    });
    const system = createSystem({
      module: cardModule,
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();
    // 4111 1111 1111 1111 is the canonical Visa test number (Luhn-valid).
    system.events.wire({ payload: "Card 4111 1111 1111 1111" });
    expect(system.facts.payload).toBe("Card [CREDIT_CARD]");
    system.destroy();
  });

  it("does NOT redact non-Luhn-valid 16-digit sequences (phone numbers, tracking IDs)", () => {
    const cardModule = createModule("payment", {
      schema: {
        facts: { payload: t.string().meta({ tags: ["pii"] }) },
        events: { wire: { payload: t.string() } },
      },
      init: (f) => {
        f.payload = "";
      },
      events: {
        wire: (f, p) => {
          f.payload = p.payload;
        },
      },
    });
    const system = createSystem({
      module: cardModule,
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();
    // 1234 5678 9012 3456 — 16 digits, NOT Luhn-valid.
    // A naive regex would mis-classify this as a credit card. With the
    // Luhn validator it stays put.
    system.events.wire({ payload: "Tracking 1234 5678 9012 3456" });
    expect(system.facts.payload).toBe("Tracking 1234 5678 9012 3456");
    system.destroy();
  });
});

describe("createFactPIIGuardrail — alert mode", () => {
  it("fires onBlocked without mutating the fact in alert mode", () => {
    const onBlocked = vi.fn();
    const system = createSystem({
      module: makeCustomerModule(),
      plugins: [createFactPIIGuardrail({ mode: "alert", onBlocked })],
    });
    system.start();
    system.events.wireProfile({
      email: "leak@example.com",
      ssn: "123-45-6789",
      notes: "",
    });
    // Alert mode: onBlocked fires for every match, but the raw value
    // stays in the store. Operators rely on the alert path (Sentry,
    // Honeycomb, etc.) to surface the violation.
    expect(onBlocked).toHaveBeenCalled();
    expect(system.facts.ssn).toBe("123-45-6789");
    expect(system.facts.email).toBe("leak@example.com");
    const modes = onBlocked.mock.calls.map((c) => c[2]);
    expect(modes.every((m) => m === "alert")).toBe(true);
    system.destroy();
  });
});

describe("createFactPIIGuardrail — includeKeys / excludeKeys", () => {
  it("scans includeKeys even when not pii-tagged", () => {
    const onBlocked = vi.fn();
    const module = createModule("untagged", {
      schema: {
        facts: { internal: t.string() },
        events: { set: { internal: t.string() } },
      },
      init: (f) => {
        f.internal = "";
      },
      events: {
        set: (f, payload) => {
          f.internal = payload.internal;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [
        createFactPIIGuardrail({
          mode: "redact",
          includeKeys: ["internal"],
          onBlocked,
        }),
      ],
    });
    system.start();
    system.events.set({ internal: "leak 555-11-2222 here" });
    expect(system.facts.internal).toBe("leak [SSN] here");
    expect(onBlocked).toHaveBeenCalled();
    system.destroy();
  });

  it("excludes pii-tagged keys via excludeKeys escape hatch", () => {
    const system = createSystem({
      module: makeCustomerModule(),
      plugins: [
        createFactPIIGuardrail({
          mode: "redact",
          excludeKeys: ["email"],
        }),
      ],
    });
    system.start();
    system.events.wireProfile({
      email: "kept@example.com",
      ssn: "123-45-6789",
      notes: "",
    });
    expect(system.facts.email).toBe("kept@example.com");
    expect(system.facts.ssn).toBe("[SSN]");
    system.destroy();
  });
});

describe("createFactPIIGuardrail — customDetector", () => {
  it("composes with custom detector", () => {
    const onBlocked = vi.fn();
    const accountPattern = /\bACC-\d{6}\b/g;
    const customDetector = (text: string) => {
      const out: Array<{
        type: "ssn";
        value: string;
        start: number;
        end: number;
      }> = [];
      let m: RegExpExecArray | null;
      accountPattern.lastIndex = 0;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec loop
      while ((m = accountPattern.exec(text)) !== null) {
        out.push({
          type: "ssn",
          value: m[0],
          start: m.index,
          end: m.index + m[0].length,
        });
      }
      return out;
    };
    const system = createSystem({
      module: makeCustomerModule(),
      plugins: [
        createFactPIIGuardrail({
          mode: "redact",
          types: [],
          customDetector,
          onBlocked,
        }),
      ],
    });
    system.start();
    system.events.wireProfile({
      email: "ACC-123456 acct",
      ssn: "ACC-654321",
      notes: "",
    });
    // Both pii-tagged facts get screened by the custom detector.
    expect(system.facts.email).toBe("[SSN] acct"); // custom detector maps to "ssn" type → [SSN]
    expect(system.facts.ssn).toBe("[SSN]");
    expect(onBlocked).toHaveBeenCalled();
    system.destroy();
  });
});

describe("createFactPIIGuardrail — object payloads", () => {
  it("walks one level deep on object payloads", () => {
    const module = createModule("nested", {
      schema: {
        facts: {
          profile: t
            .object<{ email: string; name: string }>()
            .meta({ tags: ["pii"] }),
        },
        events: {
          wire: { profile: t.object<{ email: string; name: string }>() },
        },
      },
      init: (f) => {
        f.profile = { email: "", name: "" };
      },
      events: {
        wire: (f, payload) => {
          f.profile = payload.profile;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();
    system.events.wire({
      profile: { email: "leak@example.com", name: "Alice" },
    });
    expect(system.facts.profile).toEqual({ email: "[EMAIL]", name: "Alice" });
    system.destroy();
  });

  it("does NOT walk past walkDepth (default 1) — deeper PII passes through", () => {
    interface Nested {
      meta: { email: string };
    }
    const module = createModule("deep", {
      schema: {
        facts: { account: t.object<Nested>().meta({ tags: ["pii"] }) },
        events: { wire: { account: t.object<Nested>() } },
      },
      init: (f) => {
        f.account = { meta: { email: "" } };
      },
      events: {
        wire: (f, p) => {
          f.account = p.account;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();
    system.events.wire({ account: { meta: { email: "deep@example.com" } } });
    // At default walkDepth: 1, the nested `meta.email` is NOT walked.
    expect(system.facts.account.meta.email).toBe("deep@example.com");
    system.destroy();
  });

  it("walkDepth: 3 walks deeper objects", () => {
    interface Nested {
      meta: { contact: { email: string } };
    }
    const module = createModule("deep3", {
      schema: {
        facts: { account: t.object<Nested>().meta({ tags: ["pii"] }) },
        events: { wire: { account: t.object<Nested>() } },
      },
      init: (f) => {
        f.account = { meta: { contact: { email: "" } } };
      },
      events: {
        wire: (f, p) => {
          f.account = p.account;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [createFactPIIGuardrail({ mode: "redact", walkDepth: 3 })],
    });
    system.start();
    system.events.wire({
      account: { meta: { contact: { email: "deep@example.com" } } },
    });
    expect(system.facts.account.meta.contact.email).toBe("[EMAIL]");
    system.destroy();
  });
});

// R13-C6 regression — the walker MUST recurse into arrays. Without
// this, the dominant Supabase realtime shape (`payload.new = [{...}]`)
// and MCP resource-list notifications silently bypass the Tier 0 guard.
describe("createFactPIIGuardrail — array payloads (R13-C6)", () => {
  it("redacts PII inside an array of objects", () => {
    interface UserRow {
      email: string;
      name: string;
    }
    interface Roster {
      users: UserRow[];
    }
    const module = createModule("roster", {
      schema: {
        facts: { roster: t.object<Roster>().meta({ tags: ["pii"] }) },
        events: { batch: { roster: t.object<Roster>() } },
      },
      init: (f) => {
        f.roster = { users: [] };
      },
      events: {
        batch: (f, p) => {
          f.roster = p.roster;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [createFactPIIGuardrail({ mode: "redact", walkDepth: 3 })],
    });
    system.start();
    system.events.batch({
      roster: {
        users: [
          { email: "alice@example.com", name: "Alice" },
          { email: "bob@example.com", name: "Bob" },
        ],
      },
    });
    expect(system.facts.roster.users[0]?.email).toBe("[EMAIL]");
    expect(system.facts.roster.users[1]?.email).toBe("[EMAIL]");
    // Non-PII fields preserved.
    expect(system.facts.roster.users[0]?.name).toBe("Alice");
    expect(system.facts.roster.users[1]?.name).toBe("Bob");
    system.destroy();
  });

  it("redacts a top-level array of PII strings", () => {
    const module = createModule("emails", {
      schema: {
        facts: { addresses: t.array<string>().meta({ tags: ["pii"] }) },
        events: { wire: { addresses: t.array<string>() } },
      },
      init: (f) => {
        f.addresses = [];
      },
      events: {
        wire: (f, p) => {
          f.addresses = p.addresses;
        },
      },
    });
    const system = createSystem({
      module,
      plugins: [createFactPIIGuardrail({ mode: "redact", walkDepth: 2 })],
    });
    system.start();
    system.events.wire({
      addresses: ["one@example.com", "two@example.com", "no-pii-here"],
    });
    expect(system.facts.addresses).toEqual([
      "[EMAIL]",
      "[EMAIL]",
      "no-pii-here",
    ]);
    system.destroy();
  });
});
