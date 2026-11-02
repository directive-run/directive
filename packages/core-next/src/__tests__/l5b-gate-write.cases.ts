/**
 * L5b review blocker: a source's key/active gate that writes a fact in a
 * namespaced system. 1.35 refuses the write in development and production
 * (system-proxies.ts rejectGateWrite) with the module's name and the local
 * key; the gate fails closed (phase "gate"), the source stays detached and
 * the fact keeps its value. Shared by the development and production files.
 */
import { expect, it, vi } from "vitest";

const text = (ns: string, key: string) =>
  `[Directive] Module "${ns}": a source's key/active gate wrote "${key}". Gates are pure reads of facts; change facts from an event handler or resolver.`;

export function gateWriteCases(lib: any, mode: string) {
  const { createModule, createSystem, t } = lib;
  const mod = (ns: string, write: (f: any) => void, deps?: object) =>
    createModule(ns, {
      schema: { facts: { v: t.number() }, derivations: {}, events: {} },
      ...(deps && { crossModuleDeps: deps }),
      init: (f: any) => {
        f.v = 0;
      },
      sources: {
        w: {
          key: (f: any) => {
            write(f);

            return "k";
          },
          attach: () => () => undefined,
        },
      },
    });

  it(`${mode}: a namespaced gate's write is refused with 1.35's text, bare and through self`, () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = mod("p", (f) => {
      f.v = 7;
    });
    const deps = { p: p.schema };
    const q = mod(
      "q",
      (f) => {
        f.self.v = 7;
      },
      deps,
    );
    // A bare name under crossModuleDeps, and a delete through `self`.
    const r = mod(
      "r",
      (f) => {
        f.v = 7;
      },
      deps,
    );
    const s = mod(
      "s",
      (f) => {
        delete f.self.v;
      },
      deps,
    );
    const errors: unknown[][] = [];
    const system = createSystem({
      modules: { p, q, r, s },
      plugins: [
        {
          name: "rec",
          onSourceAttach: (id: string) => errors.push(["attach", id]),
          onSourceError: (id: string, m: string, phase: string, e: Error) =>
            errors.push([id, m, phase, e.message]),
        },
      ],
    });
    try {
      system.start();
      expectRefused(system, errors);
    } finally {
      system.destroy();
    }
  });
}

/** Every gate failed closed with 1.35's text; no source attached; no write. */
function expectRefused(system: any, errors: unknown[][]) {
  const want = ["p", "q", "r", "s"].map((ns) => [
    `${ns}::w`,
    ns,
    "gate",
    text(ns, "v"),
  ]);
  expect(errors).toEqual(want);
  const info = system.inspect();
  expect(info.attachedSourceCount).toBe(0);
  for (const row of info.sources) {
    const ns = row.id.split("::")[0];
    expect(row.attached).toBe(false);
    expect(row.lastError).toMatchObject({
      phase: "gate",
      message: text(ns, "v"),
    });
    expect(system.facts[ns].v).toBe(0);
  }
}
