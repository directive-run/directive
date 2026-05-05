import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timelineDiffCommand } from "../src/commands/timeline-diff.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `directive-cli-tldiff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function writeTimeline(name: string, items: unknown[]): string {
  const path = join(tmpDir, name);
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      id: name,
      startedAtMs: 0,
      frames: items.map((event, i) => ({ ts: i + 1, event })),
    }),
  );
  return path;
}

describe("directive timeline diff command — argument parsing", () => {
  it("prints usage and exits 1 with no args", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(timelineDiffCommand([])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("Usage: directive timeline diff");
  });

  it("emits help and exits 0 with --help", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(timelineDiffCommand(["--help"])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("structured causal-graph");
  });

  it("errors when only one positional arg is given", async () => {
    const a = writeTimeline("a.json", []);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(timelineDiffCommand([a])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("required");
  });

  it("errors when a timeline file is missing", async () => {
    const a = writeTimeline("a.json", []);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      timelineDiffCommand([a, join(tmpDir, "missing.json")]),
    ).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("not found");
  });

  it("errors with friendly message on unparseable JSON", async () => {
    const a = writeTimeline("a.json", []);
    const bad = join(tmpDir, "bad.json");
    writeFileSync(bad, "{ not json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(timelineDiffCommand([a, bad])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls.toLowerCase()).toContain("not valid json");
  });

  it("errors with friendly message on invalid timeline shape", async () => {
    const a = writeTimeline("a.json", []);
    const bad = join(tmpDir, "wrong.json");
    writeFileSync(bad, JSON.stringify({ version: 99 }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(timelineDiffCommand([a, bad])).rejects.toThrow("__exit__");
    const calls = errSpy.mock.calls.flat().join(" ");
    expect(calls).toContain("validation");
  });
});

describe("directive timeline diff command — output", () => {
  it("identical timelines exit 0 and print success", async () => {
    const events = [
      { type: "constraint.evaluate", id: "x", active: true },
      { type: "resolver.start", resolver: "r", requirementId: "req-1" },
      {
        type: "resolver.complete",
        resolver: "r",
        requirementId: "req-1",
        duration: 5,
      },
    ];
    const a = writeTimeline("a.json", events);
    const b = writeTimeline("b.json", events);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let exitCode = -1;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("__exit__");
    }) as never);

    await expect(timelineDiffCommand([a, b])).rejects.toThrow("__exit__");
    expect(exitCode).toBe(0);
    const stdout = logSpy.mock.calls.flat().join("\n");
    expect(stdout).toContain("identical");
  });

  it("diverging timelines exit 2 and print structured report", async () => {
    const a = writeTimeline("a.json", [
      { type: "constraint.evaluate", id: "loadOnLoading", active: true },
    ]);
    const b = writeTimeline("b.json", [
      { type: "constraint.evaluate", id: "loadOnLoading", active: true },
      { type: "constraint.evaluate", id: "loadOnLoading", active: true },
      { type: "constraint.evaluate", id: "loadOnLoading", active: true },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let exitCode = -1;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("__exit__");
    }) as never);

    await expect(timelineDiffCommand([a, b])).rejects.toThrow("__exit__");
    expect(exitCode).toBe(2);
    const stdout = logSpy.mock.calls.flat().join("\n");
    expect(stdout).toContain("Constraint fires");
    expect(stdout).toContain("loadOnLoading");
  });

  it("--json mode emits the raw TimelineDiff", async () => {
    const a = writeTimeline("a.json", [
      { type: "constraint.evaluate", id: "x", active: true },
    ]);
    const b = writeTimeline("b.json", [
      { type: "constraint.evaluate", id: "x", active: true },
      { type: "constraint.evaluate", id: "x", active: true },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let exitCode = -1;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("__exit__");
    }) as never);

    await expect(timelineDiffCommand([a, b, "--json"])).rejects.toThrow(
      "__exit__",
    );
    expect(exitCode).toBe(2);
    const stdout = logSpy.mock.calls.flat().join("\n");
    // Pull just the printed JSON (stdout may include other lines).
    const parsed = JSON.parse(stdout);
    expect(parsed.identical).toBe(false);
    expect(parsed.frameCountDelta).toBe(1);
    expect(parsed.constraintFires).toEqual([
      { id: "x", aCount: 1, bCount: 2, delta: 1 },
    ]);
  });
});
