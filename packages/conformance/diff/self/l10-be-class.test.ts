import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIKE } from "../fingerprint.js";

// Row (be) at L10 (GATE-9.md, run 2): the class of the restore key the
// (be) fuzz entry bounds, and that one entry is its only user.
describe("historyFactKey, row (be)'s restore key", () => {
  const like = LIKE.historyFactKey;

  it("takes a seed's facts, when, the L10 dynamic facts and module z's", () => {
    for (const k of [
      "f0",
      "b::f2",
      "when",
      "b::when",
      "zf",
      "a::zf",
      "a::zw",
      "g0",
      "z::g1",
    ]) {
      expect(like(k)).toBe(true);
    }
  });

  it("rejects a value in a name's place and every other name", () => {
    for (const v of [
      0,
      -2,
      null,
      true,
      "z::h0",
      "a::zin",
      "a::zq",
      "d0",
      "r0",
      "a::b::f0",
      "stranger",
      "F0",
    ]) {
      expect(like(v as never)).toBe(false);
    }
  });

  it("is named by one entry only, the (be) changed-restore entry with its requires", () => {
    const entries = JSON.parse(
      readFileSync(new URL("../divergences.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>[];
    const users = entries.filter((e) =>
      JSON.stringify(e.bound ?? null).includes('"historyFactKey"'),
    );
    expect(users.map((e) => e.id)).toEqual([
      "l10-fuzz-be-hook-onFactsBatch-changed-back",
    ]);
    expect(users[0]).toMatchObject({
      when: ["changesetSteps"],
      during: "back",
      ends: true,
      requires: {
        stream: "hook",
        kind: "onHistoryNavigate",
        op: "changed",
        // (be) lands a `back` earlier on 2.0, never later.
        bound: {
          match: [
            {
              path: "args[1]",
              from: { $like: "integer" },
              to: { $lt: "from" },
            },
          ],
        },
      },
    });
  });
});
