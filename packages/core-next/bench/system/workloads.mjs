/**
 * The ONE source of workload code for the whole-system bench. Both entries
 * (entry-v1.mjs, entry-v2.mjs) import this file and hand it the same public
 * 1.35 API ({ createModule, createSystem, t }) from their own engine. Each runs
 * in its own Node process, so no call site is ever shared or megamorphic
 * across engines. Only the public API is used: createModule, createSystem,
 * t.*, facts writes, derive reads, basic effects run(facts), subscribe,
 * batch, settle, crossModuleDeps.
 *
 * A workload is { op, ops?, async?, build(api) }. build() returns:
 *   step()        one step (returns a promise when `async` is true)
 *   check(steps)  throws unless the world holds exactly what `steps` steps
 *                 must have produced. Expectations are worked out here from
 *                 first principles, never read off either engine. Returns
 *                 notes: work counts the engines may legitimately differ on,
 *                 which the driver prints side by side.
 *   done()        destroy everything
 *   cleanBlock()  optional, untimed cleanup that runs after each timed block
 * One step is `ops` ops (default 1); the runner reports ns/op.
 */

const tick = () => new Promise((resolve) => setImmediate(resolve));

function expect(workload, what, got, want) {
  if (got !== want) {
    throw new Error(`${workload}: ${what}: got ${got}, want ${want}`);
  }
}

// The schema a dependent module declares for the module it reads.
function numbers(t, names) {
  const out = {};
  for (const name of names) {
    out[name] = t.number();
  }

  return out;
}

// One hub module plus count-1 dependents, each reading the hub's fact v
// through crossModuleDeps. The hub is written; the dependents are read.
function hubModules({ createModule, t }, count) {
  const hubSchema = { facts: { v: t.number() } };
  const modules = {
    hub: createModule("hub", {
      schema: hubSchema,
      init: (f) => {
        f.v = 0;
      },
    }),
  };
  const names = [];
  for (let k = 1; k < count; k++) {
    const name = `m${k}`;
    names.push(name);
    modules[name] = createModule(name, {
      schema: { facts: { w: t.number() }, derivations: { x: t.number() } },
      crossModuleDeps: { hub: hubSchema },
      init: (f) => {
        f.w = k;
      },
      derive: { x: (f) => f.self.w + f.hub.v },
    });
  }

  return { modules, names };
}

// A chain of modules: m0 alone, every later mi reads its predecessor through
// crossModuleDeps. Each has 3 facts, 2 derivations and 1 basic effect.
function chainModules({ createModule, t }, count, onEffect) {
  const schema = {
    facts: numbers(t, ["a", "b", "c"]),
    derivations: numbers(t, ["sum", "twice"]),
  };
  const modules = {};
  for (let i = 0; i < count; i++) {
    const name = `m${i}`;
    const prev = `m${i - 1}`;
    const init = (f) => {
      f.a = i;
      f.b = 1;
      f.c = 2;
    };
    const twice = (_f, d) => d.sum * 2;
    modules[name] =
      i === 0
        ? createModule(name, {
            schema,
            init,
            derive: { sum: (f) => f.a + f.b + f.c, twice },
            effects: { touch: { run: (f) => onEffect(f.a) } },
          })
        : createModule(name, {
            schema,
            crossModuleDeps: { [prev]: schema },
            init,
            derive: {
              sum: (f) => f.self.a + f.self.b + f.self.c + f[prev].a,
              twice,
            },
            effects: { touch: { run: (f) => onEffect(f.self.a) } },
          });
  }

  return modules;
}

export const workloads = {
  // 1,000 writes to one number fact (one basic effect reads it), then settle.
  "scalar-writes": {
    op: "1 fact write (1,000 writes, then 1 settle)",
    ops: 1000,
    async: true,
    async build({ createModule, createSystem, t }) {
      let seen = -1;
      const sys = createSystem({
        module: createModule("scalar", {
          schema: { facts: { n: t.number() } },
          init: (f) => {
            f.n = 0;
          },
          effects: {
            watch: {
              run: (f) => {
                seen = f.n;
              },
            },
          },
        }),
      });
      sys.start();
      await sys.settle();
      let i = 0;
      const writes = (count) => {
        const f = sys.facts;
        for (let k = 0; k < count; k++) {
          f.n = ++i;
        }
      };

      return {
        writes,
        settle: () => sys.settle(),
        step() {
          writes(1000);

          return sys.settle();
        },
        check(steps) {
          expect("scalar-writes", "fact", sys.facts.n, steps * 1000);
          expect("scalar-writes", "effect saw", seen, steps * 1000);

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // A depth-10 derivation chain: write the root fact, read the tail.
  "chain-10": {
    op: "1 write + read of the depth-10 chain tail",
    async build({ createModule, createSystem, t }) {
      const derivations = {};
      const derive = {};
      for (let k = 0; k < 10; k++) {
        const prev = `d${k - 1}`;
        derivations[`d${k}`] = t.number();
        derive[`d${k}`] = k === 0 ? (f) => f.n + 1 : (_f, d) => d[prev] + 1;
      }
      const sys = createSystem({
        module: createModule("chain", {
          schema: { facts: { n: t.number() }, derivations },
          init: (f) => {
            f.n = 0;
          },
          derive,
        }),
      });
      sys.start();
      let i = 0;
      let sum = 0;

      return {
        step() {
          sys.facts.n = ++i;
          sum += sys.derive.d9;
        },
        check(steps) {
          expect(
            "chain-10",
            "sum of tails",
            sum,
            (steps * (steps + 1)) / 2 + 10 * steps,
          );

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // One fact feeds 50 derivations; write it, read all 50.
  "fanout-derive-50": {
    op: "1 write + read of all 50 derivations",
    async build({ createModule, createSystem, t }) {
      const keys = [];
      const derivations = {};
      const derive = {};
      for (let k = 0; k < 50; k++) {
        keys.push(`x${k}`);
        derivations[`x${k}`] = t.number();
        derive[`x${k}`] = (f) => f.n + k;
      }
      const sys = createSystem({
        module: createModule("fan", {
          schema: { facts: { n: t.number() }, derivations },
          init: (f) => {
            f.n = 0;
          },
          derive,
        }),
      });
      sys.start();
      let i = 0;
      let sum = 0;

      return {
        step() {
          sys.facts.n = ++i;
          const d = sys.derive;
          for (let k = 0; k < 50; k++) {
            sum += d[keys[k]];
          }
        },
        check(steps) {
          expect(
            "fanout-derive-50",
            "sum of reads",
            sum,
            25 * steps * (steps + 1) + 1225 * steps,
          );

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // 50 basic effects read one fact; write it, settle (all 50 re-run).
  "fanout-effect-50": {
    op: "1 write + settle (50 effects re-run)",
    async: true,
    async build({ createModule, createSystem, t }) {
      const runs = new Array(50).fill(0);
      const last = new Array(50).fill(-1);
      const effects = {};
      for (let k = 0; k < 50; k++) {
        effects[`e${k}`] = {
          run: (f) => {
            runs[k]++;
            last[k] = f.n;
          },
        };
      }
      const sys = createSystem({
        module: createModule("effects", {
          schema: { facts: { n: t.number() } },
          init: (f) => {
            f.n = 0;
          },
          effects,
        }),
      });
      sys.start();
      await sys.settle();
      const base = runs.slice();
      let i = 0;

      return {
        step() {
          sys.facts.n = ++i;

          return sys.settle();
        },
        check(steps) {
          for (let k = 0; k < 50; k++) {
            expect(
              "fanout-effect-50",
              `effect ${k} reruns`,
              runs[k] - base[k],
              steps,
            );
            expect("fanout-effect-50", `effect ${k} saw`, last[k], steps);
          }

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // 1,000 subscribers on one fact; one write notifies them all.
  "subscribe-1000": {
    op: "1 write notifying 1,000 subscribers",
    async build({ createModule, createSystem, t }) {
      const sys = createSystem({
        module: createModule("subs", {
          schema: { facts: { n: t.number() } },
          init: (f) => {
            f.n = 0;
          },
        }),
      });
      sys.start();
      let hits = 0;
      for (let k = 0; k < 1000; k++) {
        sys.subscribe(["n"], () => {
          hits++;
        });
      }
      let i = 0;

      return {
        step() {
          sys.facts.n = ++i;
        },
        check(steps) {
          expect("subscribe-1000", "notifications", hits, 1000 * steps);

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // 100 writes in one batch; one subscriber and one derivation observe it.
  "batch-100": {
    op: "1 batch of 100 writes (+ derivation read)",
    async build({ createModule, createSystem, t }) {
      const sys = createSystem({
        module: createModule("batch", {
          schema: {
            facts: { n: t.number() },
            derivations: { twice: t.number() },
          },
          init: (f) => {
            f.n = 0;
          },
          derive: { twice: (f) => f.n * 2 },
        }),
      });
      sys.start();
      let hits = 0;
      sys.subscribe(["n"], () => {
        hits++;
      });
      let i = 0;
      let sum = 0;

      return {
        step() {
          sys.batch(() => {
            const f = sys.facts;
            for (let k = 0; k < 100; k++) {
              f.n = ++i;
            }
          });
          sum += sys.derive.twice;
        },
        check(steps) {
          expect("batch-100", "sum of reads", sum, 100 * steps * (steps + 1));

          return { notificationsPerBatch: hits / steps };
        },
        done: () => sys.destroy(),
      };
    },
  },
  // 20 modules (a hub and 19 readers via crossModuleDeps): write the hub,
  // read every other module.
  "multi-module-20": {
    op: "1 write in 1 module + read of 19 others",
    async build(api) {
      const { modules, names } = hubModules(api, 20);
      const sys = api.createSystem({ modules });
      sys.start();
      let i = 0;
      let sum = 0;

      return {
        step() {
          sys.facts.hub.v = ++i;
          for (let k = 0; k < 19; k++) {
            sum += sys.derive[names[k]].x;
          }
        },
        check(steps) {
          expect(
            "multi-module-20",
            "sum of reads",
            sum,
            190 * steps + (19 * steps * (steps + 1)) / 2,
          );

          return null;
        },
        done: () => sys.destroy(),
      };
    },
  },
  // 1,000 systems made, started and destroyed, one after another.
  "create-destroy-1000": {
    op: "1 system: createSystem + start + destroy",
    ops: 1000,
    async: true,
    async build({ createModule, createSystem, t }) {
      let hits = 0;
      let created = 0;
      const module = createModule("life", {
        schema: {
          facts: numbers(t, ["a", "b", "c"]),
          derivations: { sum: t.number() },
        },
        init: (f) => {
          f.a = 1;
          f.b = 2;
          f.c = 3;
        },
        derive: { sum: (f) => f.a + f.b + f.c },
        effects: {
          touch: {
            run: (f) => {
              hits += f.a;
            },
          },
        },
      });

      return {
        async step() {
          for (let k = 0; k < 1000; k++) {
            const sys = createSystem({ module });
            sys.start();
            if (k === 0) {
              expect("create-destroy-1000", "sum", sys.derive.sum, 6);
            }
            sys.destroy();
            created++;
          }
          // Whatever the engine deferred must finish inside the step.
          await tick();
        },
        check(steps) {
          expect("create-destroy-1000", "systems made", created, 1000 * steps);

          return { effectRunsPerSystem: hits / created };
        },
        done() {},
      };
    },
  },
  // Time to a running, settled 10-module system (destroy is not timed).
  "startup-10-modules": {
    op: "1 system: createSystem + start + settle (10 modules)",
    async: true,
    async build(api) {
      let hits = 0;
      const modules = chainModules(api, 10, () => {
        hits++;
      });
      const live = [];
      let steps = 0;

      return {
        async step() {
          const sys = api.createSystem({ modules });
          sys.start();
          await sys.settle();
          live.push(sys);
          steps++;
        },
        check(n) {
          const sys = live[live.length - 1];
          expect("startup-10-modules", "systems", steps, n);
          expect("startup-10-modules", "m0.twice", sys.derive.m0.twice, 6);
          expect("startup-10-modules", "m9.twice", sys.derive.m9.twice, 40);

          return { effectRunsPerStartup: hits / n };
        },
        cleanBlock() {
          for (const sys of live) {
            sys.destroy();
          }
          live.length = 0;
        },
        done() {
          this.cleanBlock();
        },
      };
    },
  },
};
