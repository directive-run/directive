import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bisectCommand } from "../src/commands/bisect.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `directive-cli-bisect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("directive bisect command — argument parsing", () => {
  it("prints usage and exits 1 with no args", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bisectCommand([])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Usage: directive bisect");
  });

  it("emits help and exits 0 with --help", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bisectCommand(["--help"])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Binary-search a recorded timeline");
  });

  it("--help includes the SECURITY block explaining --assert eval", async () => {
    // `bisect --assert` evaluates user-supplied JavaScript in the CLI's own
    // process via `new Function(...)`. The SECURITY block in the help text is
    // the only place that warns about it. If a future docs refactor drops the
    // block, this test fails loudly so the warning can't be lost silently.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bisectCommand(["--help"])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("SECURITY");
    expect(calls).toContain("evaluated as JavaScript");
  });

  it("errors when --system is missing", async () => {
    const fakeJson = join(tmpDir, "t.json");
    writeFileSync(
      fakeJson,
      JSON.stringify({ version: 1, id: "x", startedAtMs: 0, frames: [] }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(bisectCommand([fakeJson, "--assert", "true"])).rejects.toThrow(
      "__exit__",
    );
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("--system");
  });

  it("errors when --assert is missing", async () => {
    const fakeJson = join(tmpDir, "t.json");
    writeFileSync(
      fakeJson,
      JSON.stringify({ version: 1, id: "x", startedAtMs: 0, frames: [] }),
    );
    const fakeSys = join(tmpDir, "factory.ts");
    writeFileSync(fakeSys, "export function createSystem() { return {}; }");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      bisectCommand([fakeJson, "--system", fakeSys]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("--assert");
  });

  it("errors when timeline JSON file does not exist", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fakeSys = join(tmpDir, "factory.ts");
    writeFileSync(fakeSys, "export function createSystem() { return {}; }");
    await expect(
      bisectCommand([
        join(tmpDir, "missing.json"),
        "--system",
        fakeSys,
        "--assert",
        "true",
      ]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("not found");
  });

  it("errors when JSON file is unparseable", async () => {
    const fakeJson = join(tmpDir, "bad.json");
    writeFileSync(fakeJson, "{ not valid json");
    const fakeSys = join(tmpDir, "factory.ts");
    writeFileSync(fakeSys, "export function createSystem() { return {}; }");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      bisectCommand([fakeJson, "--system", fakeSys, "--assert", "true"]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls.toLowerCase()).toContain("not valid json");
  });

  it("errors with friendly message on malformed --assert expression", async () => {
    const fakeJson = join(tmpDir, "t.json");
    writeFileSync(
      fakeJson,
      JSON.stringify({ version: 1, id: "x", startedAtMs: 0, frames: [] }),
    );
    const fakeSys = join(tmpDir, "factory.ts");
    writeFileSync(
      fakeSys,
      "export function createSystem() { return { dispatch: () => {}, start: () => {}, stop: () => {}, inspect: () => ({}), facts: {} }; }",
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      bisectCommand([fakeJson, "--system", fakeSys, "--assert", "facts.x ==="]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Failed to compile --assert");
  });

  it("errors when factory module exports no factory function", async () => {
    const fakeJson = join(tmpDir, "t.json");
    writeFileSync(
      fakeJson,
      JSON.stringify({ version: 1, id: "x", startedAtMs: 0, frames: [] }),
    );
    const fakeSys = join(tmpDir, "no-factory.ts");
    writeFileSync(fakeSys, "export const notAFactory = 42;");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      bisectCommand([fakeJson, "--system", fakeSys, "--assert", "true"]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("system factory");
  });
});

describe("directive bisect command — full happy path", () => {
  it("locates the first failing frame index in a synthetic 4-frame timeline", async () => {
    // Stub system factory: each MUTATE inc bumps facts.count.
    // Factory MUST be a fresh instance per call — that's what bisect
    // depends on for hermetic midpoint replays.
    const sysFile = join(tmpDir, "bisect-system.ts");
    const sysSource = `
export function createSystem() {
  const sys = {
    dispatch: (e) => {
      if (e.type === "MUTATE" && e.kind === "inc") sys.facts.count++;
    },
    start: () => {},
    stop: () => {},
    inspect: () => ({}),
    facts: { count: 0 },
  };
  return sys;
}
`;
    writeFileSync(sysFile, sysSource);

    // 4 inc frames. Assertion fails as soon as count > 1.
    // First failing prefix length = 2, so first failing frame index = 1.
    const timeline = {
      version: 1,
      id: "synthetic-bisect",
      startedAtMs: 0,
      frames: Array.from({ length: 4 }, (_, i) => ({
        ts: i + 1,
        event: {
          type: "fact.change",
          key: "pendingMutation",
          prev: null,
          next: {
            kind: "inc",
            payload: { seq: i },
            status: "pending",
            error: null,
          },
        },
      })),
    };
    const tlFile = join(tmpDir, "tl.json");
    writeFileSync(tlFile, JSON.stringify(timeline));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      bisectCommand([
        tlFile,
        "--system",
        sysFile,
        "--assert",
        "facts.count <= 1",
        "--json",
      ]),
    ).rejects.toThrow("__exit__");

    const stdout = logSpy.mock.calls.flat().join("\n");
    expect(stdout).toContain('"firstFailingFrameIndex": 1');
    expect(stdout).toContain('"noFailureFound": false');
    expect(stdout).toContain('"failsOnEmptyReplay": false');
  });

  it("reports noFailureFound in human output when assertion always passes", async () => {
    const sysFile = join(tmpDir, "always-good.ts");
    writeFileSync(
      sysFile,
      `export function createSystem() {
        return {
          dispatch: () => {},
          start: () => {},
          stop: () => {},
          inspect: () => ({}),
          facts: { count: 0 },
        };
      }`,
    );

    const timeline = {
      version: 1,
      id: "always-good",
      startedAtMs: 0,
      frames: Array.from({ length: 2 }, (_, i) => ({
        ts: i + 1,
        event: {
          type: "fact.change",
          key: "pendingMutation",
          prev: null,
          next: {
            kind: "noop",
            payload: {},
            status: "pending",
            error: null,
          },
        },
      })),
    };
    const tlFile = join(tmpDir, "tl.json");
    writeFileSync(tlFile, JSON.stringify(timeline));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      bisectCommand([tlFile, "--system", sysFile, "--assert", "true"]),
    ).rejects.toThrow("__exit__");

    const stderr = errSpy.mock.calls.flat().join("\n");
    expect(stderr).toContain("no failure to bisect");
  });
});
