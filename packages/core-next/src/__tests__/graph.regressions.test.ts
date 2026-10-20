import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type ReactiveNode, createGraph } from "../graph";

describe("flush() while effects are held", () => {
  it("is a no-op inside an effect's first run, so the effect never re-enters", () => {
    const g = createGraph();
    const t = g.signal(0);
    let depth = 0;
    let maxDepth = 0;
    let runs = 0;
    expect(() =>
      g.effect(() => {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        runs++;
        const v = g.read(t);
        if (v < 5) {
          g.write(t, v + 1);
          g.flush();
        }
        depth--;
      }),
    ).not.toThrow();
    expect(maxDepth).toBe(1);
    expect(runs).toBe(6);
    expect(t.value).toBe(5);
  });

  it("does not re-enter a running owner through a child's flush", () => {
    const g = createGraph();
    const s = g.signal(0);
    const t = g.signal(0);
    const log: string[] = [];
    let depth = 0;
    let maxDepth = 0;
    g.effect(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      const v = g.read(t);
      log.push(`p${v}`);
      g.effect(() => {
        log.push(`c${g.read(s)}`);
      });
      if (v === 0) {
        g.write(s, 1);
        g.write(t, 1);
        g.flush();
      }
      depth--;
    });
    expect(maxDepth).toBe(1);
    // The owner re-runs first (disposing the old child); the new child reads 1.
    expect(log).toEqual(["p0", "c0", "p1", "c1"]);
  });

  it("is a no-op inside a batch; the batch end flushes", () => {
    const g = createGraph();
    const s = g.signal(0);
    const seen: number[] = [];
    g.effect(() => {
      seen.push(g.read(s));
    });
    g.batch(() => {
      g.write(s, 1);
      g.flush();
      expect(seen).toEqual([0]);
    });
    expect(seen).toEqual([0, 1]);
  });
});

describe("effect() when the flush after its first run throws", () => {
  it("keeps the new effect alive when another effect throws", () => {
    const g = createGraph();
    const s = g.signal(0);
    g.effect(() => {
      if (g.read(s) === 1) {
        throw new Error("other");
      }
    });
    const t = g.signal(0);
    let runs = 0;
    expect(() =>
      g.effect(() => {
        runs++;
        g.read(t);
        g.write(s, 1);
      }),
    ).toThrow("other");
    expect(runs).toBe(1);
    g.write(t, 2);
    expect(runs).toBe(2);
  });

  it("rethrows the new effect's own error, carrying the flush error as cause", () => {
    const g = createGraph();
    const s = g.signal(0);
    const other = new Error("other");
    g.effect(() => {
      if (g.read(s) === 1) {
        throw other;
      }
    });
    const t = g.signal(0);
    let runs = 0;
    let caught: unknown;
    try {
      g.effect(() => {
        runs++;
        g.read(t);
        g.write(s, 1);
        throw new Error("mine");
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toBe("mine");
    expect((caught as Error).cause).toBe(other);
    // Its own run failed, so it is disposed.
    g.write(t, 1);
    expect(runs).toBe(1);
    expect(t.subs).toBe(null);
  });
});

describe("build-private names", () => {
  // `_`-suffixed members are mangled per build (tsup `mangleProps: /_$/`), so
  // a public name ending in `_` would ship under a random short name.
  it("no exported name or public member name ends in `_`", () => {
    const file = new URL("../graph.ts", import.meta.url).pathname;
    const src = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const bad: string[] = [];
    const isExported = (n: ts.Node) =>
      ts.canHaveModifiers(n) &&
      !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isPrivate = (n: ts.Node) =>
      ts.canHaveModifiers(n) &&
      !!ts
        .getModifiers(n)
        ?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
    let publicMembers = 0;
    for (const stmt of src.statements) {
      if (!isExported(stmt)) {
        continue;
      }
      const decl = stmt as ts.DeclarationStatement;
      const name = decl.name?.getText();
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (d.name.getText().endsWith("_")) {
            bad.push(d.name.getText());
          }
        }
      } else if (name?.endsWith("_")) {
        bad.push(name);
      }
      if (ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) {
        for (const m of stmt.members) {
          if (!m.name || isPrivate(m)) {
            continue;
          }
          publicMembers++;
          if (m.name.getText().endsWith("_")) {
            bad.push(`${name}.${m.name.getText()}`);
          }
        }
      }
    }
    expect(publicMembers).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("a live node exposes no `_` keys", () => {
    const g = createGraph();
    const nodes: ReactiveNode[] = [g.signal(0), g.computed(() => 1)];
    nodes.push(g.effect(() => g.read(nodes[0]!)));
    for (const node of nodes) {
      expect(Object.keys(node).filter((k) => k.endsWith("_"))).toEqual([]);
    }
  });
});
