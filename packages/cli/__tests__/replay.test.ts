import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayCommand } from "../src/commands/replay.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `directive-cli-replay-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
    throw new Error("__exit__");
  }) as never);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("directive replay command — argument parsing", () => {
  it("prints usage and exits 1 with no args", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(replayCommand([])).rejects.toThrow("__exit__");
    // The first call sends usage to stderr.
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Usage: directive replay");
  });

  it("emits help and exits 0 with --help", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(replayCommand(["--help"])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Replay a serialized Directive timeline");
  });

  it("errors when --system is missing", async () => {
    const fakeJson = join(tmpDir, "t.json");
    writeFileSync(fakeJson, JSON.stringify({ version: 1, id: "x", startedAtMs: 0, frames: [] }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(replayCommand([fakeJson])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("--system");
  });

  it("errors when timeline JSON file does not exist", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fakeSys = join(tmpDir, "sys.ts");
    writeFileSync(fakeSys, "export const system = {};");
    await expect(
      replayCommand([
        join(tmpDir, "missing.json"),
        "--system",
        fakeSys,
      ]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("not found");
  });

  it("errors when JSON file is unparseable", async () => {
    const fakeJson = join(tmpDir, "bad.json");
    writeFileSync(fakeJson, "{ not valid json");
    const fakeSys = join(tmpDir, "sys.ts");
    writeFileSync(fakeSys, "export const system = {};");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      replayCommand([fakeJson, "--system", fakeSys]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls.toLowerCase()).toContain("not valid json");
  });

  it("errors with friendly message when timeline JSON has invalid structure", async () => {
    const fakeJson = join(tmpDir, "wrong-shape.json");
    writeFileSync(fakeJson, JSON.stringify({ version: 99, id: "x" }));
    const fakeSys = join(tmpDir, "sys.ts");
    writeFileSync(
      fakeSys,
      "export const system = { dispatch: () => {}, start: () => {} };",
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      replayCommand([fakeJson, "--system", fakeSys]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("validation");
  });
});

describe("directive replay command — full happy path", () => {
  it("replays a synthetic MUTATE-shaped frame against a stub system", async () => {
    // Create a tiny stub system that captures dispatched events.
    const sysFile = join(tmpDir, "stub-system.ts");
    // Satisfy the loader's isSystem duck-type: requires inspect/start/
    // stop/facts. Only dispatch is functionally needed for replay,
    // but the existing loader is shared with inspect/explain/graph.
    const sysSource = `
let dispatched = [];
export const system = {
  dispatch: (e) => { dispatched.push(e); },
  start: () => {},
  stop: () => {},
  inspect: () => ({}),
  facts: {},
  __dispatched: () => dispatched,
};
export default system;
`;
    writeFileSync(sysFile, sysSource);

    // Build a synthetic timeline with one mutator-shape fact.change.
    const timeline = {
      version: 1,
      id: "synthetic",
      startedAtMs: 0,
      frames: [
        {
          ts: 1,
          event: {
            type: "fact.change",
            key: "pendingMutation",
            prev: null,
            next: {
              kind: "submit",
              payload: { values: ["a"] },
              status: "pending",
              error: null,
            },
          },
        },
      ],
    };
    const tlFile = join(tmpDir, "tl.json");
    writeFileSync(tlFile, JSON.stringify(timeline));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      replayCommand([tlFile, "--system", sysFile, "--json"]),
    ).rejects.toThrow("__exit__");

    // When --json mode is used, the result is on stdout. Assert the
    // dispatched count came through.
    const stdout = logSpy.mock.calls.flat().join("\n");
    expect(stdout).toContain('"dispatched": 1');
    expect(stdout).toContain('"skipped": 0');
  });
});
