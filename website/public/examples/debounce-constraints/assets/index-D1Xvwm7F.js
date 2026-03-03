(() => {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const o of document.querySelectorAll('link[rel="modulepreload"]')) i(o);
  new MutationObserver((o) => {
    for (const s of o)
      if (s.type === "childList")
        for (const u of s.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && i(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function a(o) {
    const s = {};
    return (
      o.integrity && (s.integrity = o.integrity),
      o.referrerPolicy && (s.referrerPolicy = o.referrerPolicy),
      o.crossOrigin === "use-credentials"
        ? (s.credentials = "include")
        : o.crossOrigin === "anonymous"
          ? (s.credentials = "omit")
          : (s.credentials = "same-origin"),
      s
    );
  }
  function i(o) {
    if (o.ep) return;
    o.ep = !0;
    const s = a(o);
    fetch(o.href, s);
  }
})();
var Ke = class extends Error {
    constructor(r, a, i, o, s = !0) {
      super(r),
        (this.source = a),
        (this.sourceId = i),
        (this.context = o),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  pe = [];
function bt() {
  const e = new Set();
  return {
    get isTracking() {
      return !0;
    },
    track(r) {
      e.add(r);
    },
    getDependencies() {
      return e;
    },
  };
}
var wt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function St() {
  return pe[pe.length - 1] ?? wt;
}
function Ee(e) {
  const r = bt();
  pe.push(r);
  try {
    return { value: e(), deps: r.getDependencies() };
  } finally {
    pe.pop();
  }
}
function He(e) {
  const r = pe.splice(0, pe.length);
  try {
    return e();
  } finally {
    pe.push(...r);
  }
}
function Be(e) {
  St().track(e);
}
function Ct(e, r = 100) {
  try {
    return JSON.stringify(e)?.slice(0, r) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function ke(e = [], r, a, i, o, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: r,
    _default: a,
    _transform: i,
    _description: o,
    _refinements: s,
    validate(u) {
      return ke([...e, u], r, a, i, o, s);
    },
  };
}
function te(e, r, a, i, o, s) {
  return {
    ...ke(e, r, a, i, o, s),
    default(u) {
      return te(e, r, u, i, o, s);
    },
    transform(u) {
      return te(
        [],
        r,
        void 0,
        (d) => {
          const h = i ? i(d) : d;
          return u(h);
        },
        o,
      );
    },
    brand() {
      return te(e, `Branded<${r}>`, a, i, o, s);
    },
    describe(u) {
      return te(e, r, a, i, u, s);
    },
    refine(u, d) {
      const h = [...(s ?? []), { predicate: u, message: d }];
      return te([...e, u], r, a, i, o, h);
    },
    nullable() {
      return te(
        [(u) => u === null || e.every((d) => d(u))],
        `${r} | null`,
        a,
        i,
        o,
      );
    },
    optional() {
      return te(
        [(u) => u === void 0 || e.every((d) => d(u))],
        `${r} | undefined`,
        a,
        i,
        o,
      );
    },
  };
}
var ee = {
  string() {
    return te([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (r, a, i, o, s) => ({
      ...te(r, "number", a, i, o, s),
      min(u) {
        return e([...r, (d) => d >= u], a, i, o, s);
      },
      max(u) {
        return e([...r, (d) => d <= u], a, i, o, s);
      },
      default(u) {
        return e(r, u, i, o, s);
      },
      describe(u) {
        return e(r, a, i, u, s);
      },
      refine(u, d) {
        const h = [...(s ?? []), { predicate: u, message: d }];
        return e([...r, u], a, i, o, h);
      },
    });
    return e([(r) => typeof r == "number"]);
  },
  boolean() {
    return te([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (r, a, i, o, s) => {
      const u = te(r, "array", i, void 0, o),
        d = s ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return d.value;
        },
        set _lastFailedIndex(h) {
          d.value = h;
        },
        of(h) {
          const p = { value: -1 };
          return e(
            [
              ...r,
              (c) => {
                for (let $ = 0; $ < c.length; $++) {
                  const q = c[$];
                  if (!h._validators.every((j) => j(q)))
                    return (p.value = $), !1;
                }
                return !0;
              },
            ],
            h,
            i,
            o,
            p,
          );
        },
        nonEmpty() {
          return e([...r, (h) => h.length > 0], a, i, o, d);
        },
        maxLength(h) {
          return e([...r, (p) => p.length <= h], a, i, o, d);
        },
        minLength(h) {
          return e([...r, (p) => p.length >= h], a, i, o, d);
        },
        default(h) {
          return e(r, a, h, o, d);
        },
        describe(h) {
          return e(r, a, i, h, d);
        },
      };
    };
    return e([(r) => Array.isArray(r)]);
  },
  object() {
    const e = (r, a, i) => ({
      ...te(r, "object", a, void 0, i),
      shape(o) {
        return e(
          [
            ...r,
            (s) => {
              for (const [u, d] of Object.entries(o)) {
                const h = s[u],
                  p = d;
                if (p && !p._validators.every((c) => c(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          i,
        );
      },
      nonNull() {
        return e([...r, (o) => o != null], a, i);
      },
      hasKeys(...o) {
        return e([...r, (s) => o.every((u) => u in s)], a, i);
      },
      default(o) {
        return e(r, o, i);
      },
      describe(o) {
        return e(r, a, o);
      },
    });
    return e([(r) => typeof r == "object" && r !== null && !Array.isArray(r)]);
  },
  enum(...e) {
    const r = new Set(e);
    return te(
      [(a) => typeof a == "string" && r.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return te([(r) => r === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const r = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === null ? !0 : e._validators.every((i) => i(a)))],
      `${r} | null`,
    );
  },
  optional(e) {
    const r = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === void 0 ? !0 : e._validators.every((i) => i(a)))],
      `${r} | undefined`,
    );
  },
  union(...e) {
    const r = e.map((a) => a._typeName ?? "unknown");
    return te(
      [(a) => e.some((i) => i._validators.every((o) => o(a)))],
      r.join(" | "),
    );
  },
  record(e) {
    const r = e._typeName ?? "unknown";
    return te(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((i) => e._validators.every((o) => o(i))),
      ],
      `Record<string, ${r}>`,
    );
  },
  tuple(...e) {
    const r = e.map((a) => a._typeName ?? "unknown");
    return te(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((i, o) => i._validators.every((s) => s(a[o]))),
      ],
      `[${r.join(", ")}]`,
    );
  },
  date() {
    return te([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return te([(r) => typeof r == "string" && e.test(r)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return te([(r) => typeof r == "string" && e.test(r)], "email");
  },
  url() {
    return te(
      [
        (e) => {
          if (typeof e != "string") return !1;
          try {
            return new URL(e), !0;
          } catch {
            return !1;
          }
        },
      ],
      "url",
    );
  },
  bigint() {
    return te([(e) => typeof e == "bigint"], "bigint");
  },
};
function $t(e) {
  const { schema: r, onChange: a, onBatch: i } = e;
  Object.keys(r).length;
  let o = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    d = new Map(),
    h = new Set(),
    p = new Map(),
    c = new Set(),
    $ = 0,
    q = [],
    j = new Set(),
    A = !1,
    D = [],
    x = 100;
  function O(f) {
    return (
      f !== null &&
      typeof f == "object" &&
      "safeParse" in f &&
      typeof f.safeParse == "function" &&
      "_def" in f &&
      "parse" in f &&
      typeof f.parse == "function"
    );
  }
  function P(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (O(f)) {
      const w = f._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function T(f) {
    return u ? "[redacted]" : Ct(f);
  }
  function m(f, b) {
    if (!o) return;
    const w = r[f];
    if (!w) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (O(w)) {
      const z = w.safeParse(b);
      if (!z.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          k = T(b),
          t =
            z.error?.message ??
            z.error?.issues?.[0]?.message ??
            "Validation failed",
          n = P(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${k}. ${t}`,
        );
      }
      return;
    }
    const I = w,
      N = I._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const K = I._typeName ?? "unknown";
    for (let z = 0; z < N.length; z++) {
      const y = N[z];
      if (typeof y == "function" && !y(b)) {
        let k = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          t = T(b),
          n = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const l = z === 0 ? "" : ` (validator ${z + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${K}, got ${k} ${t}${l}${n}`,
        );
      }
    }
  }
  function C(f) {
    p.get(f)?.forEach((b) => b());
  }
  function v() {
    c.forEach((f) => f());
  }
  function E(f, b, w) {
    if (A) {
      D.push({ key: f, value: b, prev: w });
      return;
    }
    A = !0;
    try {
      a?.(f, b, w), C(f), v();
      let I = 0;
      while (D.length > 0) {
        if (++I > x)
          throw (
            ((D.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${x} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...D];
        D.length = 0;
        for (const K of N) a?.(K.key, K.value, K.prev), C(K.key);
        v();
      }
    } finally {
      A = !1;
    }
  }
  function R() {
    if (!($ > 0)) {
      if ((i && q.length > 0 && i([...q]), j.size > 0)) {
        A = !0;
        try {
          for (const b of j) C(b);
          v();
          let f = 0;
          while (D.length > 0) {
            if (++f > x)
              throw (
                ((D.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${x} iterations.`,
                ))
              );
            const b = [...D];
            D.length = 0;
            for (const w of b) a?.(w.key, w.value, w.prev), C(w.key);
            v();
          }
        } finally {
          A = !1;
        }
      }
      (q.length = 0), j.clear();
    }
  }
  const L = {
    get(f) {
      return Be(f), d.get(f);
    },
    has(f) {
      return Be(f), d.has(f);
    },
    set(f, b) {
      m(f, b);
      const w = d.get(f);
      Object.is(w, b) ||
        (d.set(f, b),
        h.add(f),
        $ > 0
          ? (q.push({ key: f, value: b, prev: w, type: "set" }), j.add(f))
          : E(f, b, w));
    },
    delete(f) {
      const b = d.get(f);
      d.delete(f),
        h.delete(f),
        $ > 0
          ? (q.push({ key: f, value: void 0, prev: b, type: "delete" }),
            j.add(f))
          : E(f, void 0, b);
    },
    batch(f) {
      $++;
      try {
        f();
      } finally {
        $--, R();
      }
    },
    subscribe(f, b) {
      for (const w of f) {
        const I = w;
        p.has(I) || p.set(I, new Set()), p.get(I).add(b);
      }
      return () => {
        for (const w of f) {
          const I = p.get(w);
          I && (I.delete(b), I.size === 0 && p.delete(w));
        }
      };
    },
    subscribeAll(f) {
      return c.add(f), () => c.delete(f);
    },
    toObject() {
      const f = {};
      for (const b of h) d.has(b) && (f[b] = d.get(b));
      return f;
    },
  };
  return (
    (L.registerKeys = (f) => {
      for (const b of Object.keys(f)) be.has(b) || ((r[b] = f[b]), h.add(b));
    }),
    L
  );
}
var be = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function xt(e, r) {
  const a = () => ({
    get: (i) => He(() => e.get(i)),
    has: (i) => He(() => e.has(i)),
  });
  return new Proxy(
    {},
    {
      get(i, o) {
        if (o === "$store") return e;
        if (o === "$snapshot") return a;
        if (typeof o != "symbol" && !be.has(o)) return e.get(o);
      },
      set(i, o, s) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          be.has(o)
          ? !1
          : (e.set(o, s), !0);
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          be.has(o)
          ? !1
          : (e.delete(o), !0);
      },
      has(i, o) {
        return o === "$store" || o === "$snapshot"
          ? !0
          : typeof o == "symbol" || be.has(o)
            ? !1
            : e.has(o);
      },
      ownKeys() {
        return Object.keys(r);
      },
      getOwnPropertyDescriptor(i, o) {
        return o === "$store" || o === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Et(e) {
  const r = $t(e),
    a = xt(r, e.schema);
  return { store: r, facts: a };
}
function kt(e, r) {
  const a = "crossModuleDeps" in r ? r.crossModuleDeps : void 0;
  return {
    id: e,
    schema: r.schema,
    init: r.init,
    derive: r.derive ?? {},
    events: r.events ?? {},
    effects: r.effects,
    constraints: r.constraints,
    resolvers: r.resolvers,
    hooks: r.hooks,
    snapshotEvents: r.snapshotEvents,
    crossModuleDeps: a,
  };
}
async function Ce(e, r, a) {
  let i,
    o = new Promise((s, u) => {
      i = setTimeout(() => u(new Error(a)), r);
    });
  try {
    return await Promise.race([e, o]);
  } finally {
    clearTimeout(i);
  }
}
function ft(e, r = 50) {
  const a = new WeakSet();
  function i(o, s) {
    if (s > r) return '"[max depth exceeded]"';
    if (o === null) return "null";
    if (o === void 0) return "undefined";
    const u = typeof o;
    if (u === "string") return JSON.stringify(o);
    if (u === "number" || u === "boolean") return String(o);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(o)) {
      if (a.has(o)) return '"[circular]"';
      a.add(o);
      const d = `[${o.map((h) => i(h, s + 1)).join(",")}]`;
      return a.delete(o), d;
    }
    if (u === "object") {
      const d = o;
      if (a.has(d)) return '"[circular]"';
      a.add(d);
      const h = `{${Object.keys(d)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${i(d[p], s + 1)}`)
        .join(",")}}`;
      return a.delete(d), h;
    }
    return '"[unknown]"';
  }
  return i(e, 0);
}
function we(e, r = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    i = new WeakSet();
  function o(s, u) {
    if (u > r) return !1;
    if (s == null || typeof s != "object") return !0;
    const d = s;
    if (i.has(d)) return !0;
    if ((i.add(d), Array.isArray(d))) {
      for (const h of d) if (!o(h, u + 1)) return i.delete(d), !1;
      return i.delete(d), !0;
    }
    for (const h of Object.keys(d))
      if (a.has(h) || !o(d[h], u + 1)) return i.delete(d), !1;
    return i.delete(d), !0;
  }
  return o(e, 0);
}
function Dt(e) {
  let r = ft(e),
    a = 5381;
  for (let i = 0; i < r.length; i++) a = ((a << 5) + a) ^ r.charCodeAt(i);
  return (a >>> 0).toString(16);
}
function Rt(e, r) {
  if (r) return r(e);
  const { type: a, ...i } = e,
    o = ft(i);
  return `${a}:${o}`;
}
function At(e, r, a) {
  return { requirement: e, id: Rt(e, a), fromConstraint: r };
}
var Te = class pt {
    map = new Map();
    add(r) {
      this.map.has(r.id) || this.map.set(r.id, r);
    }
    remove(r) {
      return this.map.delete(r);
    }
    has(r) {
      return this.map.has(r);
    }
    get(r) {
      return this.map.get(r);
    }
    all() {
      return [...this.map.values()];
    }
    ids() {
      return [...this.map.keys()];
    }
    get size() {
      return this.map.size;
    }
    clear() {
      this.map.clear();
    }
    clone() {
      const r = new pt();
      for (const a of this.map.values()) r.add(a);
      return r;
    }
    diff(r) {
      const a = [],
        i = [],
        o = [];
      for (const s of this.map.values()) r.has(s.id) ? o.push(s) : a.push(s);
      for (const s of r.map.values()) this.map.has(s.id) || i.push(s);
      return { added: a, removed: i, unchanged: o };
    }
  },
  Ot = 5e3;
function jt(e) {
  let {
      definitions: r,
      facts: a,
      requirementKeys: i = {},
      defaultTimeout: o = Ot,
      onEvaluate: s,
      onError: u,
    } = e,
    d = new Map(),
    h = new Set(),
    p = new Set(),
    c = new Map(),
    $ = new Map(),
    q = new Set(),
    j = new Map(),
    A = new Map(),
    D = !1,
    x = new Set(),
    O = new Set(),
    P = new Map(),
    T = [],
    m = new Map();
  function C() {
    for (const [t, n] of Object.entries(r))
      if (n.after)
        for (const l of n.after)
          r[l] && (P.has(l) || P.set(l, new Set()), P.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      n = new Set(),
      l = [];
    function g(S, M) {
      if (t.has(S)) return;
      if (n.has(S)) {
        const W = M.indexOf(S),
          _ = [...M.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${_}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), M.push(S);
      const F = r[S];
      if (F?.after) for (const W of F.after) r[W] && g(W, M);
      M.pop(), n.delete(S), t.add(S), l.push(S);
    }
    for (const S of Object.keys(r)) g(S, []);
    (T = l), (m = new Map(T.map((S, M) => [S, M])));
  }
  v(), C();
  function E(t, n) {
    return n.async !== void 0 ? n.async : !!p.has(t);
  }
  function R(t) {
    const n = r[t];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const l = E(t, n);
    l && p.add(t);
    const g = {
      id: t,
      priority: n.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return d.set(t, g), g;
  }
  function L(t) {
    return d.get(t) ?? R(t);
  }
  function f(t, n) {
    const l = c.get(t) ?? new Set();
    for (const g of l) {
      const S = $.get(g);
      S?.delete(t), S && S.size === 0 && $.delete(g);
    }
    for (const g of n) $.has(g) || $.set(g, new Set()), $.get(g).add(t);
    c.set(t, n);
  }
  function b(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(a)), j.set(t, new Set(n.deps));
      else {
        const S = Ee(() => n.when(a));
        (g = S.value), j.set(t, S.deps);
      }
      return g instanceof Promise
        ? (p.add(t),
          (l.isAsync = !0),
          g
            .then(
              (S) => ((l.lastResult = S), (l.isEvaluating = !1), s?.(t, S), S),
            )
            .catch(
              (S) => (
                (l.error = S instanceof Error ? S : new Error(String(S))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                u?.(t, S),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), s?.(t, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(t, g),
        !1
      );
    }
  }
  async function w(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t),
      g = n.timeout ?? o;
    if (((l.isEvaluating = !0), (l.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      f(t, S), j.set(t, S);
    }
    try {
      const S = n.when(a),
        M = await Ce(S, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = M), (l.isEvaluating = !1), s?.(t, M), M;
    } catch (S) {
      return (
        (l.error = S instanceof Error ? S : new Error(String(S))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(t, S),
        !1
      );
    }
  }
  function I(t, n) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const n = r[t];
    if (!n) return { requirements: [], deps: new Set() };
    const l = n.require;
    if (typeof l == "function") {
      const { value: g, deps: S } = Ee(() => l(a));
      return { requirements: I(g), deps: S };
    }
    return { requirements: I(l), deps: new Set() };
  }
  function K(t, n) {
    if (n.size === 0) return;
    const l = c.get(t) ?? new Set();
    for (const g of n)
      l.add(g), $.has(g) || $.set(g, new Set()), $.get(g).add(t);
    c.set(t, l);
  }
  let z = null;
  function y() {
    return (
      z ||
        (z = Object.keys(r).sort((t, n) => {
          const l = L(t),
            g = L(n).priority - l.priority;
          if (g !== 0) return g;
          const S = m.get(t) ?? 0,
            M = m.get(n) ?? 0;
          return S - M;
        })),
      z
    );
  }
  for (const t of Object.keys(r)) R(t);
  function k(t) {
    const n = d.get(t);
    if (!n || n.after.length === 0) return !0;
    for (const l of n.after)
      if (r[l] && !h.has(l) && !O.has(l) && !x.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const n = new Te();
      O.clear();
      let l = y().filter((_) => !h.has(_)),
        g;
      if (!D || !t || t.size === 0) (g = l), (D = !0);
      else {
        const _ = new Set();
        for (const Q of t) {
          const J = $.get(Q);
          if (J) for (const re of J) h.has(re) || _.add(re);
        }
        for (const Q of q) h.has(Q) || _.add(Q);
        q.clear(), (g = [..._]);
        for (const Q of l)
          if (!_.has(Q)) {
            const J = A.get(Q);
            if (J) for (const re of J) n.add(re);
          }
      }
      function S(_, Q) {
        if (h.has(_)) return;
        const J = j.get(_);
        if (!Q) {
          J !== void 0 && f(_, J), O.add(_), A.set(_, []);
          return;
        }
        O.delete(_);
        let re, Z;
        try {
          const G = N(_);
          (re = G.requirements), (Z = G.deps);
        } catch (G) {
          u?.(_, G), J !== void 0 && f(_, J), A.set(_, []);
          return;
        }
        if (J !== void 0) {
          const G = new Set(J);
          for (const V of Z) G.add(V);
          f(_, G);
        } else K(_, Z);
        if (re.length > 0) {
          const G = i[_],
            V = re.map((U) => At(U, _, G));
          for (const U of V) n.add(U);
          A.set(_, V);
        } else A.set(_, []);
      }
      async function M(_) {
        const Q = [],
          J = [];
        for (const V of _)
          if (k(V)) J.push(V);
          else {
            Q.push(V);
            const U = A.get(V);
            if (U) for (const Y of U) n.add(Y);
          }
        if (J.length === 0) return Q;
        const re = [],
          Z = [];
        for (const V of J) L(V).isAsync ? Z.push(V) : re.push(V);
        const G = [];
        for (const V of re) {
          const U = b(V);
          if (U instanceof Promise) {
            G.push({ id: V, promise: U });
            continue;
          }
          S(V, U);
        }
        if (G.length > 0) {
          const V = await Promise.all(
            G.map(async ({ id: U, promise: Y }) => ({
              id: U,
              active: await Y,
            })),
          );
          for (const { id: U, active: Y } of V) S(U, Y);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async (U) => ({ id: U, active: await w(U) })),
          );
          for (const { id: U, active: Y } of V) S(U, Y);
        }
        return Q;
      }
      let F = g,
        W = g.length + 1;
      while (F.length > 0 && W > 0) {
        const _ = F.length;
        if (((F = await M(F)), F.length === _)) break;
        W--;
      }
      return n.all();
    },
    getState(t) {
      return d.get(t);
    },
    getAllStates() {
      return [...d.values()];
    },
    disable(t) {
      h.add(t), (z = null), A.delete(t);
      const n = c.get(t);
      if (n) {
        for (const l of n) {
          const g = $.get(l);
          g && (g.delete(t), g.size === 0 && $.delete(l));
        }
        c.delete(t);
      }
      j.delete(t);
    },
    enable(t) {
      h.delete(t), (z = null), q.add(t);
    },
    invalidate(t) {
      const n = $.get(t);
      if (n) for (const l of n) q.add(l);
    },
    markResolved(t) {
      x.add(t);
      const n = d.get(t);
      n && (n.lastResolvedAt = Date.now());
      const l = P.get(t);
      if (l) for (const g of l) q.add(g);
    },
    isResolved(t) {
      return x.has(t);
    },
    registerDefinitions(t) {
      for (const [n, l] of Object.entries(t)) (r[n] = l), R(n), q.add(n);
      (z = null), v(), C();
    },
  };
}
function Mt(e) {
  let {
      definitions: r,
      facts: a,
      onCompute: i,
      onInvalidate: o,
      onError: s,
    } = e,
    u = new Map(),
    d = new Map(),
    h = new Map(),
    p = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    q = new Set(),
    j = !1,
    A = 100,
    D;
  function x(v) {
    if (!r[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const E = {
      id: v,
      compute: () => P(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(v, E), E;
  }
  function O(v) {
    return u.get(v) ?? x(v);
  }
  function P(v) {
    const E = O(v),
      R = r[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (E.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    E.isComputing = !0;
    try {
      const { value: L, deps: f } = Ee(() => R(a, D));
      return (
        (E.cachedValue = L), (E.isStale = !1), T(v, f), i?.(v, L, [...f]), L
      );
    } catch (L) {
      throw (s?.(v, L), L);
    } finally {
      E.isComputing = !1;
    }
  }
  function T(v, E) {
    const R = O(v),
      L = R.dependencies;
    for (const f of L)
      if (u.has(f)) {
        const b = p.get(f);
        b?.delete(v), b && b.size === 0 && p.delete(f);
      } else {
        const b = h.get(f);
        b?.delete(v), b && b.size === 0 && h.delete(f);
      }
    for (const f of E)
      r[f]
        ? (p.has(f) || p.set(f, new Set()), p.get(f).add(v))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(v));
    R.dependencies = E;
  }
  function m() {
    if (!($ > 0 || j)) {
      j = !0;
      try {
        let v = 0;
        while (q.size > 0) {
          if (++v > A) {
            const R = [...q];
            throw (
              (q.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${A} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const E = [...q];
          q.clear();
          for (const R of E) d.get(R)?.forEach((L) => L());
        }
      } finally {
        j = !1;
      }
    }
  }
  function C(v, E = new Set()) {
    if (E.has(v)) return;
    E.add(v);
    const R = u.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), o?.(v), q.add(v);
    const L = p.get(v);
    if (L) for (const f of L) C(f, E);
  }
  return (
    (D = new Proxy(
      {},
      {
        get(v, E) {
          if (typeof E == "symbol" || c.has(E)) return;
          Be(E);
          const R = O(E);
          return R.isStale && P(E), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const E = O(v);
        return E.isStale && P(v), E.cachedValue;
      },
      isStale(v) {
        return u.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const E = h.get(v);
        if (E) {
          $++;
          try {
            for (const R of E) C(R);
          } finally {
            $--, m();
          }
        }
      },
      invalidateMany(v) {
        $++;
        try {
          for (const E of v) {
            const R = h.get(E);
            if (R) for (const L of R) C(L);
          }
        } finally {
          $--, m();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), q.add(v.id));
        } finally {
          $--, m();
        }
      },
      subscribe(v, E) {
        for (const R of v) {
          const L = R;
          d.has(L) || d.set(L, new Set()), d.get(L).add(E);
        }
        return () => {
          for (const R of v) {
            const L = R,
              f = d.get(L);
            f?.delete(E), f && f.size === 0 && d.delete(L);
          }
        };
      },
      getProxy() {
        return D;
      },
      getDependencies(v) {
        return O(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [E, R] of Object.entries(v)) (r[E] = R), x(E);
      },
    }
  );
}
function It(e) {
  let { definitions: r, facts: a, store: i, onRun: o, onError: s } = e,
    u = new Map(),
    d = null,
    h = !1;
  function p(x) {
    const O = r[x];
    if (!O) throw new Error(`[Directive] Unknown effect: ${x}`);
    const P = {
      id: x,
      enabled: !0,
      hasExplicitDeps: !!O.deps,
      dependencies: O.deps ? new Set(O.deps) : null,
      cleanup: null,
    };
    return u.set(x, P), P;
  }
  function c(x) {
    return u.get(x) ?? p(x);
  }
  function $() {
    return i.toObject();
  }
  function q(x, O) {
    const P = c(x);
    if (!P.enabled) return !1;
    if (P.dependencies) {
      for (const T of P.dependencies) if (O.has(T)) return !0;
      return !1;
    }
    return !0;
  }
  function j(x) {
    if (x.cleanup) {
      try {
        x.cleanup();
      } catch (O) {
        s?.(x.id, O),
          console.error(
            `[Directive] Effect "${x.id}" cleanup threw an error:`,
            O,
          );
      }
      x.cleanup = null;
    }
  }
  function A(x, O) {
    if (typeof O == "function")
      if (h)
        try {
          O();
        } catch (P) {
          s?.(x.id, P),
            console.error(
              `[Directive] Effect "${x.id}" cleanup threw an error:`,
              P,
            );
        }
      else x.cleanup = O;
  }
  async function D(x) {
    const O = c(x),
      P = r[x];
    if (!(!O.enabled || !P)) {
      j(O), o?.(x);
      try {
        if (O.hasExplicitDeps) {
          let T;
          if (
            (i.batch(() => {
              T = P.run(a, d);
            }),
            T instanceof Promise)
          ) {
            const m = await T;
            A(O, m);
          } else A(O, T);
        } else {
          let T = null,
            m,
            C = Ee(
              () => (
                i.batch(() => {
                  m = P.run(a, d);
                }),
                m
              ),
            );
          T = C.deps;
          let v = C.value;
          v instanceof Promise && (v = await v),
            A(O, v),
            (O.dependencies = T.size > 0 ? T : null);
        }
      } catch (T) {
        s?.(x, T),
          console.error(`[Directive] Effect "${x}" threw an error:`, T);
      }
    }
  }
  for (const x of Object.keys(r)) p(x);
  return {
    async runEffects(x) {
      const O = [];
      for (const P of Object.keys(r)) q(P, x) && O.push(P);
      await Promise.all(O.map(D)), (d = $());
    },
    async runAll() {
      const x = Object.keys(r);
      await Promise.all(
        x.map((O) => (c(O).enabled ? D(O) : Promise.resolve())),
      ),
        (d = $());
    },
    disable(x) {
      const O = c(x);
      O.enabled = !1;
    },
    enable(x) {
      const O = c(x);
      O.enabled = !0;
    },
    isEnabled(x) {
      return c(x).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const x of u.values()) j(x);
    },
    registerDefinitions(x) {
      for (const [O, P] of Object.entries(x)) (r[O] = P), p(O);
    },
  };
}
function qt(e = {}) {
  const {
      delayMs: r = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: i = 2,
      maxDelayMs: o = 3e4,
    } = e,
    s = new Map();
  function u(d) {
    const h = r * Math.pow(i, d - 1);
    return Math.min(h, o);
  }
  return {
    scheduleRetry(d, h, p, c, $) {
      if (c > a) return null;
      const q = u(c),
        j = {
          source: d,
          sourceId: h,
          context: p,
          attempt: c,
          nextRetryTime: Date.now() + q,
          callback: $,
        };
      return s.set(h, j), j;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const d = Date.now(),
        h = [];
      for (const [p, c] of s) c.nextRetryTime <= d && (h.push(c), s.delete(p));
      return h;
    },
    cancelRetry(d) {
      s.delete(d);
    },
    clearAll() {
      s.clear();
    },
  };
}
var Bt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Tt(e = {}) {
  const { config: r = {}, onError: a, onRecovery: i } = e,
    o = [],
    s = 100,
    u = qt(r.retryLater),
    d = new Map();
  function h(c, $, q, j) {
    if (q instanceof Ke) return q;
    const A = q instanceof Error ? q.message : String(q),
      D = c !== "system";
    return new Ke(A, c, $, j, D);
  }
  function p(c, $, q) {
    const j = (() => {
      switch (c) {
        case "constraint":
          return r.onConstraintError;
        case "resolver":
          return r.onResolverError;
        case "effect":
          return r.onEffectError;
        case "derivation":
          return r.onDerivationError;
        default:
          return;
      }
    })();
    if (typeof j == "function") {
      try {
        j(q, $);
      } catch (A) {
        console.error("[Directive] Error in error handler callback:", A);
      }
      return "skip";
    }
    return typeof j == "string" ? j : Bt[c];
  }
  return {
    handleError(c, $, q, j) {
      const A = h(c, $, q, j);
      o.push(A), o.length > s && o.shift();
      try {
        a?.(A);
      } catch (x) {
        console.error("[Directive] Error in onError callback:", x);
      }
      try {
        r.onError?.(A);
      } catch (x) {
        console.error("[Directive] Error in config.onError callback:", x);
      }
      let D = p(c, $, q instanceof Error ? q : new Error(String(q)));
      if (D === "retry-later") {
        const x = (d.get($) ?? 0) + 1;
        d.set($, x),
          u.scheduleRetry(c, $, j, x) ||
            ((D = "skip"), d.delete($), typeof process < "u");
      }
      try {
        i?.(A, D);
      } catch (x) {
        console.error("[Directive] Error in onRecovery callback:", x);
      }
      if (D === "throw") throw A;
      return D;
    },
    getLastError() {
      return o[o.length - 1] ?? null;
    },
    getAllErrors() {
      return [...o];
    },
    clearErrors() {
      o.length = 0;
    },
    getRetryLaterManager() {
      return u;
    },
    processDueRetries() {
      return u.processDueRetries();
    },
    clearRetryAttempts(c) {
      d.delete(c), u.cancelRetry(c);
    },
  };
}
function _t() {
  const e = [];
  function r(i) {
    if (i)
      try {
        return i();
      } catch (o) {
        console.error("[Directive] Plugin error:", o);
        return;
      }
  }
  async function a(i) {
    if (i)
      try {
        return await i();
      } catch (o) {
        console.error("[Directive] Plugin error:", o);
        return;
      }
  }
  return {
    register(i) {
      e.some((o) => o.name === i.name) &&
        (console.warn(
          `[Directive] Plugin "${i.name}" is already registered, replacing...`,
        ),
        this.unregister(i.name)),
        e.push(i);
    },
    unregister(i) {
      const o = e.findIndex((s) => s.name === i);
      o !== -1 && e.splice(o, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(i) {
      for (const o of e) await a(() => o.onInit?.(i));
    },
    emitStart(i) {
      for (const o of e) r(() => o.onStart?.(i));
    },
    emitStop(i) {
      for (const o of e) r(() => o.onStop?.(i));
    },
    emitDestroy(i) {
      for (const o of e) r(() => o.onDestroy?.(i));
    },
    emitFactSet(i, o, s) {
      for (const u of e) r(() => u.onFactSet?.(i, o, s));
    },
    emitFactDelete(i, o) {
      for (const s of e) r(() => s.onFactDelete?.(i, o));
    },
    emitFactsBatch(i) {
      for (const o of e) r(() => o.onFactsBatch?.(i));
    },
    emitDerivationCompute(i, o, s) {
      for (const u of e) r(() => u.onDerivationCompute?.(i, o, s));
    },
    emitDerivationInvalidate(i) {
      for (const o of e) r(() => o.onDerivationInvalidate?.(i));
    },
    emitReconcileStart(i) {
      for (const o of e) r(() => o.onReconcileStart?.(i));
    },
    emitReconcileEnd(i) {
      for (const o of e) r(() => o.onReconcileEnd?.(i));
    },
    emitConstraintEvaluate(i, o) {
      for (const s of e) r(() => s.onConstraintEvaluate?.(i, o));
    },
    emitConstraintError(i, o) {
      for (const s of e) r(() => s.onConstraintError?.(i, o));
    },
    emitRequirementCreated(i) {
      for (const o of e) r(() => o.onRequirementCreated?.(i));
    },
    emitRequirementMet(i, o) {
      for (const s of e) r(() => s.onRequirementMet?.(i, o));
    },
    emitRequirementCanceled(i) {
      for (const o of e) r(() => o.onRequirementCanceled?.(i));
    },
    emitResolverStart(i, o) {
      for (const s of e) r(() => s.onResolverStart?.(i, o));
    },
    emitResolverComplete(i, o, s) {
      for (const u of e) r(() => u.onResolverComplete?.(i, o, s));
    },
    emitResolverError(i, o, s) {
      for (const u of e) r(() => u.onResolverError?.(i, o, s));
    },
    emitResolverRetry(i, o, s) {
      for (const u of e) r(() => u.onResolverRetry?.(i, o, s));
    },
    emitResolverCancel(i, o) {
      for (const s of e) r(() => s.onResolverCancel?.(i, o));
    },
    emitEffectRun(i) {
      for (const o of e) r(() => o.onEffectRun?.(i));
    },
    emitEffectError(i, o) {
      for (const s of e) r(() => s.onEffectError?.(i, o));
    },
    emitSnapshot(i) {
      for (const o of e) r(() => o.onSnapshot?.(i));
    },
    emitTimeTravel(i, o) {
      for (const s of e) r(() => s.onTimeTravel?.(i, o));
    },
    emitError(i) {
      for (const o of e) r(() => o.onError?.(i));
    },
    emitErrorRecovery(i, o) {
      for (const s of e) r(() => s.onErrorRecovery?.(i, o));
    },
  };
}
var Ve = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Qe = { enabled: !1, windowMs: 50 };
function Ue(e, r) {
  let { backoff: a, initialDelay: i = 100, maxDelay: o = 3e4 } = e,
    s;
  switch (a) {
    case "none":
      s = i;
      break;
    case "linear":
      s = i * r;
      break;
    case "exponential":
      s = i * Math.pow(2, r - 1);
      break;
    default:
      s = i;
  }
  return Math.max(1, Math.min(s, o));
}
function Lt(e) {
  const {
      definitions: r,
      facts: a,
      store: i,
      onStart: o,
      onComplete: s,
      onError: u,
      onRetry: d,
      onCancel: h,
      onResolutionComplete: p,
    } = e,
    c = new Map(),
    $ = new Map(),
    q = 1e3,
    j = new Map(),
    A = new Map(),
    D = 1e3;
  function x() {
    if ($.size > q) {
      const f = $.size - q,
        b = $.keys();
      for (let w = 0; w < f; w++) {
        const I = b.next().value;
        I && $.delete(I);
      }
    }
  }
  function O(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "string"
    );
  }
  function P(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function T(f, b) {
    return O(f) ? b.type === f.requirement : P(f) ? f.requirement(b) : !1;
  }
  function m(f) {
    const b = f.type,
      w = A.get(b);
    if (w)
      for (const I of w) {
        const N = r[I];
        if (N && T(N, f)) return I;
      }
    for (const [I, N] of Object.entries(r))
      if (T(N, f)) {
        if (!A.has(b)) {
          if (A.size >= D) {
            const z = A.keys().next().value;
            z !== void 0 && A.delete(z);
          }
          A.set(b, []);
        }
        const K = A.get(b);
        return K.includes(I) || K.push(I), I;
      }
    return null;
  }
  function C(f) {
    return { facts: a, signal: f, snapshot: () => a.$snapshot() };
  }
  async function v(f, b, w) {
    const I = r[f];
    if (!I) return;
    let N = { ...Ve, ...I.retry },
      K = null;
    for (let z = 1; z <= N.attempts; z++) {
      if (w.signal.aborted) return;
      const y = c.get(b.id);
      y &&
        ((y.attempt = z),
        (y.status = {
          state: "running",
          requirementId: b.id,
          startedAt: y.startedAt,
          attempt: z,
        }));
      try {
        const k = C(w.signal);
        if (I.resolve) {
          let n;
          i.batch(() => {
            n = I.resolve(b.requirement, k);
          });
          const l = I.timeout;
          l && l > 0
            ? await Ce(n, l, `Resolver "${f}" timed out after ${l}ms`)
            : await n;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        $.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: t,
        }),
          x(),
          s?.(f, b, t);
        return;
      } catch (k) {
        if (
          ((K = k instanceof Error ? k : new Error(String(k))),
          w.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(K, z)) break;
        if (z < N.attempts) {
          if (w.signal.aborted) return;
          const t = Ue(N, z);
          if (
            (d?.(f, b, z + 1),
            await new Promise((n) => {
              const l = setTimeout(n, t),
                g = () => {
                  clearTimeout(l), n();
                };
              w.signal.addEventListener("abort", g, { once: !0 });
            }),
            w.signal.aborted)
          )
            return;
        }
      }
    }
    $.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: K,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      x(),
      u?.(f, b, K);
  }
  async function E(f, b) {
    const w = r[f];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((t) => {
          const n = new AbortController();
          return v(f, t, n);
        }),
      );
      return;
    }
    let I = { ...Ve, ...w.retry },
      N = { ...Qe, ...w.batch },
      K = new AbortController(),
      z = Date.now(),
      y = null,
      k = N.timeoutMs ?? w.timeout;
    for (let t = 1; t <= I.attempts; t++) {
      if (K.signal.aborted) return;
      try {
        const n = C(K.signal),
          l = b.map((g) => g.requirement);
        if (w.resolveBatchWithResults) {
          let g, S;
          if (
            (i.batch(() => {
              S = w.resolveBatchWithResults(l, n);
            }),
            k && k > 0
              ? (g = await Ce(
                  S,
                  k,
                  `Batch resolver "${f}" timed out after ${k}ms`,
                ))
              : (g = await S),
            g.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${g.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let M = Date.now() - z,
            F = !1;
          for (let W = 0; W < b.length; W++) {
            const _ = b[W],
              Q = g[W];
            if (Q.success)
              $.set(_.id, {
                state: "success",
                requirementId: _.id,
                completedAt: Date.now(),
                duration: M,
              }),
                s?.(f, _, M);
            else {
              F = !0;
              const J = Q.error ?? new Error("Batch item failed");
              $.set(_.id, {
                state: "error",
                requirementId: _.id,
                error: J,
                failedAt: Date.now(),
                attempts: t,
              }),
                u?.(f, _, J);
            }
          }
          if (!F || b.some((W, _) => g[_]?.success)) return;
        } else {
          let g;
          i.batch(() => {
            g = w.resolveBatch(l, n);
          }),
            k && k > 0
              ? await Ce(g, k, `Batch resolver "${f}" timed out after ${k}ms`)
              : await g;
          const S = Date.now() - z;
          for (const M of b)
            $.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: S,
            }),
              s?.(f, M, S);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          K.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, t)) break;
        if (t < I.attempts) {
          const l = Ue(I, t);
          for (const g of b) d?.(f, g, t + 1);
          if (
            (await new Promise((g) => {
              const S = setTimeout(g, l),
                M = () => {
                  clearTimeout(S), g();
                };
              K.signal.addEventListener("abort", M, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of b)
      $.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        u?.(f, t, y);
    x();
  }
  function R(f, b) {
    const w = r[f];
    if (!w) return;
    const I = { ...Qe, ...w.batch };
    j.has(f) || j.set(f, { resolverId: f, requirements: [], timer: null });
    const N = j.get(f);
    N.requirements.push(b),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        L(f);
      }, I.windowMs));
  }
  function L(f) {
    const b = j.get(f);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      E(f, w).then(() => {
        p?.();
      });
  }
  return {
    resolve(f) {
      if (c.has(f.id)) return;
      const b = m(f.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${f.id}`);
        return;
      }
      const w = r[b];
      if (!w) return;
      if (w.batch?.enabled) {
        R(b, f);
        return;
      }
      const I = new AbortController(),
        N = Date.now(),
        K = {
          requirementId: f.id,
          resolverId: b,
          controller: I,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: N },
          originalRequirement: f,
        };
      c.set(f.id, K),
        o?.(b, f),
        v(b, f, I).finally(() => {
          c.delete(f.id) && p?.();
        });
    },
    cancel(f) {
      const b = c.get(f);
      b &&
        (b.controller.abort(),
        c.delete(f),
        $.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        x(),
        h?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of c) this.cancel(f);
      for (const f of j.values()) f.timer && clearTimeout(f.timer);
      j.clear();
    },
    getStatus(f) {
      const b = c.get(f);
      return b ? b.status : $.get(f) || { state: "idle" };
    },
    getInflight() {
      return [...c.keys()];
    },
    getInflightInfo() {
      return [...c.values()].map((f) => ({
        id: f.requirementId,
        resolverId: f.resolverId,
        startedAt: f.startedAt,
      }));
    },
    isResolving(f) {
      return c.has(f);
    },
    processBatches() {
      for (const f of j.keys()) L(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) r[b] = w;
      A.clear();
    },
  };
}
function zt(e) {
  let { config: r, facts: a, store: i, onSnapshot: o, onTimeTravel: s } = e,
    u = r.timeTravel ?? !1,
    d = r.maxSnapshots ?? 100,
    h = [],
    p = -1,
    c = 1,
    $ = !1,
    q = !1,
    j = [],
    A = null,
    D = -1;
  function x() {
    return i.toObject();
  }
  function O() {
    const T = x();
    return structuredClone(T);
  }
  function P(T) {
    if (!we(T)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    i.batch(() => {
      for (const [m, C] of Object.entries(T)) {
        if (m === "__proto__" || m === "constructor" || m === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${m}" during fact restoration`,
          );
          continue;
        }
        a[m] = C;
      }
    });
  }
  return {
    get isEnabled() {
      return u;
    },
    get isRestoring() {
      return q;
    },
    get isPaused() {
      return $;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(T) {
      if (!u || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: T };
      const m = { id: c++, timestamp: Date.now(), facts: O(), trigger: T };
      for (
        p < h.length - 1 && h.splice(p + 1), h.push(m), p = h.length - 1;
        h.length > d;
      )
        h.shift(), p--;
      return o?.(m), m;
    },
    restore(T) {
      if (u) {
        ($ = !0), (q = !0);
        try {
          P(T.facts);
        } finally {
          ($ = !1), (q = !1);
        }
      }
    },
    goBack(T = 1) {
      if (!u || h.length === 0) return;
      let m = p,
        C = p,
        v = j.find((R) => p > R.startIndex && p <= R.endIndex);
      if (v) C = v.startIndex;
      else if (j.find((R) => p === R.startIndex)) {
        const R = j.find((L) => L.endIndex < p && p - L.endIndex <= T);
        C = R ? R.startIndex : Math.max(0, p - T);
      } else C = Math.max(0, p - T);
      if (m === C) return;
      p = C;
      const E = h[p];
      E && (this.restore(E), s?.(m, C));
    },
    goForward(T = 1) {
      if (!u || h.length === 0) return;
      let m = p,
        C = p,
        v = j.find((R) => p >= R.startIndex && p < R.endIndex);
      if ((v ? (C = v.endIndex) : (C = Math.min(h.length - 1, p + T)), m === C))
        return;
      p = C;
      const E = h[p];
      E && (this.restore(E), s?.(m, C));
    },
    goTo(T) {
      if (!u) return;
      const m = h.findIndex((E) => E.id === T);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${T} not found`);
        return;
      }
      const C = p;
      p = m;
      const v = h[p];
      v && (this.restore(v), s?.(C, m));
    },
    replay() {
      if (!u || h.length === 0) return;
      p = 0;
      const T = h[0];
      T && this.restore(T);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: p });
    },
    import(T) {
      if (u)
        try {
          const m = JSON.parse(T);
          if (typeof m != "object" || m === null)
            throw new Error("Invalid time-travel data: expected object");
          if (m.version !== 1)
            throw new Error(
              `Unsupported time-travel export version: ${m.version}`,
            );
          if (!Array.isArray(m.snapshots))
            throw new Error(
              "Invalid time-travel data: snapshots must be an array",
            );
          if (typeof m.currentIndex != "number")
            throw new Error(
              "Invalid time-travel data: currentIndex must be a number",
            );
          for (const v of m.snapshots) {
            if (typeof v != "object" || v === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof v.id != "number" ||
              typeof v.timestamp != "number" ||
              typeof v.trigger != "string" ||
              typeof v.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!we(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...m.snapshots), (p = m.currentIndex);
          const C = h[p];
          C && this.restore(C);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(T) {
      u && ((A = T), (D = p));
    },
    endChangeset() {
      !u ||
        A === null ||
        (p > D && j.push({ label: A, startIndex: D, endIndex: p }),
        (A = null),
        (D = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function Pt() {
  const e = { id: -1, timestamp: 0, facts: {}, trigger: "" };
  return {
    isEnabled: !1,
    isRestoring: !1,
    isPaused: !1,
    snapshots: [],
    currentIndex: -1,
    takeSnapshot: () => e,
    restore: () => {},
    goBack: () => {},
    goForward: () => {},
    goTo: () => {},
    replay: () => {},
    export: () => "{}",
    import: () => {},
    beginChangeset: () => {},
    endChangeset: () => {},
    pause: () => {},
    resume: () => {},
  };
}
var se = new Set(["__proto__", "constructor", "prototype"]);
function mt(e) {
  const r = Object.create(null),
    a = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    s = Object.create(null),
    u = Object.create(null);
  for (const t of e.modules) {
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (se.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    n(t.schema, "schema"),
      n(t.events, "events"),
      n(t.derive, "derive"),
      n(t.effects, "effects"),
      n(t.constraints, "constraints"),
      n(t.resolvers, "resolvers"),
      Object.assign(r, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && Object.assign(i, t.derive),
      t.effects && Object.assign(o, t.effects),
      t.constraints && Object.assign(s, t.constraints),
      t.resolvers && Object.assign(u, t.resolvers);
  }
  let d = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    d = new Set();
    for (const t of e.modules) {
      const n = t;
      if (n.snapshotEvents) for (const l of n.snapshotEvents) d.add(l);
      else if (n.events) for (const l of Object.keys(n.events)) d.add(l);
    }
  }
  let h = 0,
    p = !1,
    c = _t();
  for (const t of e.plugins ?? []) c.register(t);
  let $ = Tt({
      config: e.errorBoundary,
      onError: (t) => c.emitError(t),
      onRecovery: (t, n) => c.emitErrorRecovery(t, n),
    }),
    q = () => {},
    j = () => {},
    A = null,
    { store: D, facts: x } = Et({
      schema: r,
      onChange: (t, n, l) => {
        c.emitFactSet(t, n, l),
          q(t),
          !A?.isRestoring && (h === 0 && (p = !0), w.changedKeys.add(t), I());
      },
      onBatch: (t) => {
        c.emitFactsBatch(t);
        const n = [];
        for (const l of t) n.push(l.key);
        if ((j(n), !A?.isRestoring)) {
          h === 0 && (p = !0);
          for (const l of t) w.changedKeys.add(l.key);
          I();
        }
      },
    }),
    O = Mt({
      definitions: i,
      facts: x,
      onCompute: (t, n, l) => c.emitDerivationCompute(t, n, l),
      onInvalidate: (t) => c.emitDerivationInvalidate(t),
      onError: (t, n) => {
        $.handleError("derivation", t, n);
      },
    });
  (q = (t) => O.invalidate(t)), (j = (t) => O.invalidateMany(t));
  const P = It({
      definitions: o,
      facts: x,
      store: D,
      onRun: (t) => c.emitEffectRun(t),
      onError: (t, n) => {
        $.handleError("effect", t, n), c.emitEffectError(t, n);
      },
    }),
    T = jt({
      definitions: s,
      facts: x,
      onEvaluate: (t, n) => c.emitConstraintEvaluate(t, n),
      onError: (t, n) => {
        $.handleError("constraint", t, n), c.emitConstraintError(t, n);
      },
    }),
    m = Lt({
      definitions: u,
      facts: x,
      store: D,
      onStart: (t, n) => c.emitResolverStart(t, n),
      onComplete: (t, n, l) => {
        c.emitResolverComplete(t, n, l),
          c.emitRequirementMet(n, t),
          T.markResolved(n.fromConstraint);
      },
      onError: (t, n, l) => {
        $.handleError("resolver", t, l, n), c.emitResolverError(t, n, l);
      },
      onRetry: (t, n, l) => c.emitResolverRetry(t, n, l),
      onCancel: (t, n) => {
        c.emitResolverCancel(t, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        L(), I();
      },
    }),
    C = new Set();
  function v() {
    for (const t of C) t();
  }
  const E = e.debug?.timeTravel
    ? zt({
        config: e.debug,
        facts: x,
        store: D,
        onSnapshot: (t) => {
          c.emitSnapshot(t), v();
        },
        onTimeTravel: (t, n) => {
          c.emitTimeTravel(t, n), v();
        },
      })
    : Pt();
  A = E;
  const R = new Set();
  function L() {
    for (const t of R) t();
  }
  let f = 50,
    b = 0,
    w = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Te(),
      readyPromise: null,
      readyResolve: null,
    };
  function I() {
    !w.isRunning ||
      w.reconcileScheduled ||
      w.isInitializing ||
      ((w.reconcileScheduled = !0),
      L(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && N().catch((t) => {});
      }));
  }
  async function N() {
    if (!w.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), L();
      try {
        w.changedKeys.size > 0 &&
          ((d === null || p) &&
            E.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (p = !1));
        const t = x.$snapshot();
        c.emitReconcileStart(t), await P.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const l = await T.evaluate(n),
          g = new Te();
        for (const _ of l) g.add(_), c.emitRequirementCreated(_);
        const { added: S, removed: M } = g.diff(w.previousRequirements);
        for (const _ of M) m.cancel(_.id);
        for (const _ of S) m.resolve(_);
        w.previousRequirements = g;
        const F = m.getInflightInfo(),
          W = {
            unmet: l.filter((_) => !m.isResolving(_.id)),
            inflight: F,
            completed: [],
            canceled: M.map((_) => ({
              id: _.id,
              resolverId: F.find((Q) => Q.id === _.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(W),
          w.isReady ||
            ((w.isReady = !0),
            w.readyResolve && (w.readyResolve(), (w.readyResolve = null)));
      } finally {
        (w.isReconciling = !1),
          w.changedKeys.size > 0 ? I() : w.reconcileScheduled || (b = 0),
          L();
      }
    }
  }
  const K = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !se.has(n)) return O.get(n);
        },
        has(t, n) {
          return typeof n == "symbol" || se.has(n) ? !1 : n in i;
        },
        ownKeys() {
          return Object.keys(i);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !se.has(n) && n in i)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    z = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !se.has(n))
            return (l) => {
              const g = a[n];
              if (g) {
                h++, (d === null || d.has(n)) && (p = !0);
                try {
                  D.batch(() => {
                    g(x, { type: n, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(t, n) {
          return typeof n == "symbol" || se.has(n) ? !1 : n in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !se.has(n) && n in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: x,
      debug: E.isEnabled ? E : null,
      derive: K,
      events: z,
      constraints: { disable: (t) => T.disable(t), enable: (t) => T.enable(t) },
      effects: {
        disable: (t) => P.disable(t),
        enable: (t) => P.enable(t),
        isEnabled: (t) => P.isEnabled(t),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              D.batch(() => {
                t.init(x);
              });
          e.onAfterModuleInit &&
            D.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const t of Object.keys(i)) O.get(t);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(y);
          c.emitStart(y), I();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), m.cancelAll(), P.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
          c.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (w.isDestroyed = !0),
          R.clear(),
          C.clear(),
          c.emitDestroy(y);
      },
      dispatch(t) {
        if (se.has(t.type)) return;
        const n = a[t.type];
        if (n) {
          h++, (d === null || d.has(t.type)) && (p = !0);
          try {
            D.batch(() => {
              n(x, t);
            });
          } finally {
            h--;
          }
        }
      },
      read(t) {
        return O.get(t);
      },
      subscribe(t, n) {
        const l = [],
          g = [];
        for (const M of t) M in i ? l.push(M) : M in r && g.push(M);
        const S = [];
        return (
          l.length > 0 && S.push(O.subscribe(l, n)),
          g.length > 0 && S.push(D.subscribe(g, n)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(t, n, l) {
        const g = l?.equalityFn
          ? (M, F) => l.equalityFn(M, F)
          : (M, F) => Object.is(M, F);
        if (t in i) {
          let M = O.get(t);
          return O.subscribe([t], () => {
            const F = O.get(t);
            if (!g(F, M)) {
              const W = M;
              (M = F), n(F, W);
            }
          });
        }
        let S = D.get(t);
        return D.subscribe([t], () => {
          const M = D.get(t);
          if (!g(M, S)) {
            const F = S;
            (S = M), n(M, F);
          }
        });
      },
      when(t, n) {
        return new Promise((l, g) => {
          const S = D.toObject();
          if (t(S)) {
            l();
            return;
          }
          let M,
            F,
            W = () => {
              M?.(), F !== void 0 && clearTimeout(F);
            };
          (M = D.subscribeAll(() => {
            const _ = D.toObject();
            t(_) && (W(), l());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (F = setTimeout(() => {
                W(),
                  g(
                    new Error(
                      `[Directive] when: timed out after ${n.timeout}ms`,
                    ),
                  );
              }, n.timeout));
        });
      },
      inspect() {
        return {
          unmet: w.previousRequirements.all(),
          inflight: m.getInflightInfo(),
          constraints: T.getAllStates().map((t) => ({
            id: t.id,
            active: t.lastResult ?? !1,
            priority: t.priority,
          })),
          resolvers: Object.fromEntries(
            m.getInflight().map((t) => [t, m.getStatus(t)]),
          ),
        };
      },
      explain(t) {
        const n = w.previousRequirements.all().find((Q) => Q.id === t);
        if (!n) return null;
        const l = T.getState(n.fromConstraint),
          g = m.getStatus(t),
          S = {},
          M = D.toObject();
        for (const [Q, J] of Object.entries(M)) S[Q] = J;
        const F = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([Q]) => Q !== "type")
            .map(([Q, J]) => `${Q}=${JSON.stringify(J)}`)
            .join(", ");
        W && F.push(`├─ Requirement payload: { ${W} }`);
        const _ = Object.entries(S).slice(0, 10);
        return (
          _.length > 0 &&
            (F.push("└─ Relevant facts:"),
            _.forEach(([Q, J], re) => {
              const Z = re === _.length - 1 ? "   └─" : "   ├─",
                G = typeof J == "object" ? JSON.stringify(J) : String(J);
              F.push(
                `${Z} ${Q} = ${G.slice(0, 50)}${G.length > 50 ? "..." : ""}`,
              );
            })),
          F.join(`
`)
        );
      },
      async settle(t = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const l = this.inspect();
          if (
            l.inflight.length === 0 &&
            !w.isReconciling &&
            !w.reconcileScheduled
          )
            return;
          if (Date.now() - n > t) {
            const g = [];
            l.inflight.length > 0 &&
              g.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((M) => M.resolverId).join(", ")}`,
              ),
              w.isReconciling && g.push("reconciliation in progress"),
              w.reconcileScheduled && g.push("reconcile scheduled");
            const S = w.previousRequirements.all();
            throw (
              (S.length > 0 &&
                g.push(
                  `${S.length} unmet requirements: ${S.map((M) => M.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${t}ms. ${g.join("; ")}`,
              ))
            );
          }
          await new Promise((g) => setTimeout(g, 10));
        }
      },
      getSnapshot() {
        return { facts: D.toObject(), version: 1 };
      },
      getDistributableSnapshot(t = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: S,
            metadata: M,
            includeVersion: F,
          } = t,
          W = {},
          _ = Object.keys(i),
          Q;
        if ((n ? (Q = n.filter((Z) => _.includes(Z))) : (Q = _), l)) {
          const Z = new Set(l);
          Q = Q.filter((G) => !Z.has(G));
        }
        for (const Z of Q)
          try {
            W[Z] = O.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = D.toObject();
          for (const G of g) G in Z && (W[G] = Z[G]);
        }
        const J = Date.now(),
          re = { data: W, createdAt: J };
        return (
          S !== void 0 && S > 0 && (re.expiresAt = J + S * 1e3),
          F && (re.version = Dt(W)),
          M && (re.metadata = M),
          re
        );
      },
      watchDistributableSnapshot(t, n) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          S = Object.keys(i),
          M;
        if ((l ? (M = l.filter((W) => S.includes(W))) : (M = S), g)) {
          const W = new Set(g);
          M = M.filter((_) => !W.has(_));
        }
        if (M.length === 0) return () => {};
        let F = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return O.subscribe(M, () => {
          const W = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          W.version !== F && ((F = W.version), n(W));
        });
      },
      restore(t) {
        if (!t || typeof t != "object")
          throw new Error(
            "[Directive] restore() requires a valid snapshot object",
          );
        if (!t.facts || typeof t.facts != "object")
          throw new Error(
            "[Directive] restore() snapshot must have a facts object",
          );
        if (!we(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [n, l] of Object.entries(t.facts))
            se.has(n) || D.set(n, l);
        });
      },
      onSettledChange(t) {
        return (
          R.add(t),
          () => {
            R.delete(t);
          }
        );
      },
      onTimeTravelChange(t) {
        return (
          C.add(t),
          () => {
            C.delete(t);
          }
        );
      },
      batch(t) {
        D.batch(t);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !w.isReconciling &&
          !w.reconcileScheduled
        );
      },
      get isRunning() {
        return w.isRunning;
      },
      get isInitialized() {
        return w.isInitialized;
      },
      get isReady() {
        return w.isReady;
      },
      whenReady() {
        return w.isReady
          ? Promise.resolve()
          : w.isRunning
            ? (w.readyPromise ||
                (w.readyPromise = new Promise((t) => {
                  w.readyResolve = t;
                })),
              w.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function k(t) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" on a destroyed system.`,
      );
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (se.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}.`,
            );
      }
    };
    n(t.schema, "schema"),
      n(t.events, "events"),
      n(t.derive, "derive"),
      n(t.effects, "effects"),
      n(t.constraints, "constraints"),
      n(t.resolvers, "resolvers");
    for (const l of Object.keys(t.schema))
      if (l in r)
        throw new Error(
          `[Directive] Schema collision: Fact "${l}" already exists. Cannot register module "${t.id}".`,
        );
    if (t.snapshotEvents) {
      d === null && (d = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) d.add(l);
    } else if (d !== null && t.events)
      for (const l of Object.keys(t.events)) d.add(l);
    Object.assign(r, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(i, t.derive), O.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(o, t.effects), P.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(s, t.constraints), T.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(u, t.resolvers), m.registerDefinitions(t.resolvers)),
      D.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        D.batch(() => {
          t.init(x);
        }),
      t.hooks?.onInit?.(y),
      w.isRunning && (t.hooks?.onStart?.(y), I());
  }
  (y.registerModule = k), c.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Ft(e) {
  const r = Object.keys(e),
    a = new Set(),
    i = new Set(),
    o = [],
    s = [];
  function u(d) {
    if (a.has(d)) return;
    if (i.has(d)) {
      const p = s.indexOf(d),
        c = [...s.slice(p), d].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    i.add(d), s.push(d);
    const h = e[d];
    if (h?.crossModuleDeps)
      for (const p of Object.keys(h.crossModuleDeps)) r.includes(p) && u(p);
    s.pop(), i.delete(d), a.add(d), o.push(d);
  }
  for (const d of r) u(d);
  return o;
}
var Je = new WeakMap(),
  Ye = new WeakMap(),
  Ge = new WeakMap(),
  Xe = new WeakMap();
function Nt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Vt(e);
  }
  const r = e;
  if (Array.isArray(r.modules))
    throw new Error(`[Directive] createSystem expects modules as an object, not an array.

Instead of:
  createSystem({ modules: [authModule, dataModule] })

Use:
  createSystem({ modules: { auth: authModule, data: dataModule } })

Or for a single module:
  createSystem({ module: counterModule })`);
  return Wt(r);
}
function Wt(e) {
  const r = e.modules,
    a = new Set(Object.keys(r)),
    i = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let o,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      C = Object.keys(r).filter((v) => !m.includes(v));
    if (C.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${C.join(", ")}. All modules must be included in the explicit order.`,
      );
    o = m;
  } else s === "declaration" ? (o = Object.keys(r)) : (o = Ft(r));
  let u = e.debug,
    d = e.errorBoundary;
  e.zeroConfig &&
    ((u = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (d = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const m of Object.keys(r)) {
    if (m.includes(H))
      throw new Error(
        `[Directive] Module name "${m}" contains the reserved separator "${H}". Module names cannot contain "${H}".`,
      );
    const C = r[m];
    if (C) {
      for (const v of Object.keys(C.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const h = [];
  for (const m of o) {
    const C = r[m];
    if (!C) continue;
    const v = C.crossModuleDeps && Object.keys(C.crossModuleDeps).length > 0,
      E = v ? Object.keys(C.crossModuleDeps) : [],
      R = {};
    for (const [y, k] of Object.entries(C.schema.facts)) R[`${m}${H}${y}`] = k;
    const L = {};
    if (C.schema.derivations)
      for (const [y, k] of Object.entries(C.schema.derivations))
        L[`${m}${H}${y}`] = k;
    const f = {};
    if (C.schema.events)
      for (const [y, k] of Object.entries(C.schema.events))
        f[`${m}${H}${y}`] = k;
    const b = C.init
        ? (y) => {
            const k = ie(y, m);
            C.init(k);
          }
        : void 0,
      w = {};
    if (C.derive)
      for (const [y, k] of Object.entries(C.derive))
        w[`${m}${H}${y}`] = (t, n) => {
          const l = v ? le(t, m, E) : ie(t, m),
            g = _e(n, m);
          return k(l, g);
        };
    const I = {};
    if (C.events)
      for (const [y, k] of Object.entries(C.events))
        I[`${m}${H}${y}`] = (t, n) => {
          const l = ie(t, m);
          k(l, n);
        };
    const N = {};
    if (C.constraints)
      for (const [y, k] of Object.entries(C.constraints)) {
        const t = k;
        N[`${m}${H}${y}`] = {
          ...t,
          deps: t.deps?.map((n) => `${m}${H}${n}`),
          when: (n) => {
            const l = v ? le(n, m, E) : ie(n, m);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (n) => {
                  const l = v ? le(n, m, E) : ie(n, m);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const K = {};
    if (C.resolvers)
      for (const [y, k] of Object.entries(C.resolvers)) {
        const t = k;
        K[`${m}${H}${y}`] = {
          ...t,
          resolve: async (n, l) => {
            const g = Re(l.facts, r, () => Object.keys(r));
            await t.resolve(n, { facts: g[m], signal: l.signal });
          },
        };
      }
    const z = {};
    if (C.effects)
      for (const [y, k] of Object.entries(C.effects)) {
        const t = k;
        z[`${m}${H}${y}`] = {
          ...t,
          run: (n, l) => {
            const g = v ? le(n, m, E) : ie(n, m),
              S = l ? (v ? le(l, m, E) : ie(l, m)) : void 0;
            return t.run(g, S);
          },
          deps: t.deps?.map((n) => `${m}${H}${n}`),
        };
      }
    h.push({
      id: C.id,
      schema: {
        facts: R,
        derivations: L,
        events: f,
        requirements: C.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: I,
      effects: z,
      constraints: N,
      resolvers: K,
      hooks: C.hooks,
      snapshotEvents:
        i && !i.has(m) ? [] : C.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let p = null,
    c = null;
  function $(m) {
    for (const [C, v] of Object.entries(m))
      if (!ne.has(C) && a.has(C)) {
        if (v && typeof v == "object" && !we(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${C}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [E, R] of Object.entries(v))
          ne.has(E) || (c.facts[`${C}${H}${E}`] = R);
      }
  }
  c = mt({
    modules: h.map((m) => ({
      id: m.id,
      schema: m.schema.facts,
      requirements: m.schema.requirements,
      init: m.init,
      derive: m.derive,
      events: m.events,
      effects: m.effects,
      constraints: m.constraints,
      resolvers: m.resolvers,
      hooks: m.hooks,
      snapshotEvents: m.snapshotEvents,
    })),
    plugins: e.plugins,
    debug: u,
    errorBoundary: d,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), p && ($(p), (p = null));
    },
  });
  const q = new Map();
  for (const m of Object.keys(r)) {
    const C = r[m];
    if (!C) continue;
    const v = [];
    for (const E of Object.keys(C.schema.facts)) v.push(`${m}${H}${E}`);
    if (C.schema.derivations)
      for (const E of Object.keys(C.schema.derivations)) v.push(`${m}${H}${E}`);
    q.set(m, v);
  }
  const j = { names: null };
  function A() {
    return j.names === null && (j.names = Object.keys(r)), j.names;
  }
  let D = Re(c.facts, r, A),
    x = Kt(c.derive, r, A),
    O = Ht(c, r, A),
    P = null,
    T = e.tickMs;
  return {
    _mode: "namespaced",
    facts: D,
    debug: c.debug,
    derive: x,
    events: O,
    constraints: c.constraints,
    effects: c.effects,
    get isRunning() {
      return c.isRunning;
    },
    get isSettled() {
      return c.isSettled;
    },
    get isInitialized() {
      return c.isInitialized;
    },
    get isReady() {
      return c.isReady;
    },
    whenReady: c.whenReady.bind(c),
    async hydrate(m) {
      if (c.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const C = await m();
      C && typeof C == "object" && (p = C);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), T && T > 0)) {
        const m = Object.keys(h[0]?.events ?? {}).find((C) =>
          C.endsWith(`${H}tick`),
        );
        m &&
          (P = setInterval(() => {
            c.dispatch({ type: m });
          }, T));
      }
    },
    stop() {
      P && (clearInterval(P), (P = null)), c.stop();
    },
    destroy() {
      this.stop(), c.destroy();
    },
    dispatch(m) {
      c.dispatch(m);
    },
    batch: c.batch.bind(c),
    read(m) {
      return c.read(ce(m));
    },
    subscribe(m, C) {
      const v = [];
      for (const E of m)
        if (E.endsWith(".*")) {
          const R = E.slice(0, -2),
            L = q.get(R);
          L && v.push(...L);
        } else v.push(ce(E));
      return c.subscribe(v, C);
    },
    subscribeModule(m, C) {
      const v = q.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, C);
    },
    watch(m, C, v) {
      return c.watch(ce(m), C, v);
    },
    when(m, C) {
      return c.when(() => m(D), C);
    },
    onSettledChange: c.onSettledChange.bind(c),
    onTimeTravelChange: c.onTimeTravelChange.bind(c),
    inspect: c.inspect.bind(c),
    settle: c.settle.bind(c),
    explain: c.explain.bind(c),
    getSnapshot: c.getSnapshot.bind(c),
    restore: c.restore.bind(c),
    getDistributableSnapshot(m) {
      const C = {
          ...m,
          includeDerivations: m?.includeDerivations?.map(ce),
          excludeDerivations: m?.excludeDerivations?.map(ce),
          includeFacts: m?.includeFacts?.map(ce),
        },
        v = c.getDistributableSnapshot(C),
        E = {};
      for (const [R, L] of Object.entries(v.data)) {
        const f = R.indexOf(H);
        if (f > 0) {
          const b = R.slice(0, f),
            w = R.slice(f + H.length);
          E[b] || (E[b] = {}), (E[b][w] = L);
        } else E._root || (E._root = {}), (E._root[R] = L);
      }
      return { ...v, data: E };
    },
    watchDistributableSnapshot(m, C) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ce),
        excludeDerivations: m?.excludeDerivations?.map(ce),
        includeFacts: m?.includeFacts?.map(ce),
      };
      return c.watchDistributableSnapshot(v, (E) => {
        const R = {};
        for (const [L, f] of Object.entries(E.data)) {
          const b = L.indexOf(H);
          if (b > 0) {
            const w = L.slice(0, b),
              I = L.slice(b + H.length);
            R[w] || (R[w] = {}), (R[w][I] = f);
          } else R._root || (R._root = {}), (R._root[L] = f);
        }
        C({ ...E, data: R });
      });
    },
    registerModule(m, C) {
      if (a.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(H))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${H}".`,
        );
      if (ne.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys(C.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${H}".`,
          );
      const v = C,
        E = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = E ? Object.keys(v.crossModuleDeps) : [],
        L = {};
      for (const [y, k] of Object.entries(v.schema.facts))
        L[`${m}${H}${y}`] = k;
      const f = v.init
          ? (y) => {
              const k = ie(y, m);
              v.init(k);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, k] of Object.entries(v.derive))
          b[`${m}${H}${y}`] = (t, n) => {
            const l = E ? le(t, m, R) : ie(t, m),
              g = _e(n, m);
            return k(l, g);
          };
      const w = {};
      if (v.events)
        for (const [y, k] of Object.entries(v.events))
          w[`${m}${H}${y}`] = (t, n) => {
            const l = ie(t, m);
            k(l, n);
          };
      const I = {};
      if (v.constraints)
        for (const [y, k] of Object.entries(v.constraints)) {
          const t = k;
          I[`${m}${H}${y}`] = {
            ...t,
            deps: t.deps?.map((n) => `${m}${H}${n}`),
            when: (n) => {
              const l = E ? le(n, m, R) : ie(n, m);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (n) => {
                    const l = E ? le(n, m, R) : ie(n, m);
                    return t.require(l);
                  }
                : t.require,
          };
        }
      const N = {};
      if (v.resolvers)
        for (const [y, k] of Object.entries(v.resolvers)) {
          const t = k;
          N[`${m}${H}${y}`] = {
            ...t,
            resolve: async (n, l) => {
              const g = Re(l.facts, r, A);
              await t.resolve(n, { facts: g[m], signal: l.signal });
            },
          };
        }
      const K = {};
      if (v.effects)
        for (const [y, k] of Object.entries(v.effects)) {
          const t = k;
          K[`${m}${H}${y}`] = {
            ...t,
            run: (n, l) => {
              const g = E ? le(n, m, R) : ie(n, m),
                S = l ? (E ? le(l, m, R) : ie(l, m)) : void 0;
              return t.run(g, S);
            },
            deps: t.deps?.map((n) => `${m}${H}${n}`),
          };
        }
      a.add(m), (r[m] = v), (j.names = null);
      const z = [];
      for (const y of Object.keys(v.schema.facts)) z.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          z.push(`${m}${H}${y}`);
      q.set(m, z),
        c.registerModule({
          id: v.id,
          schema: L,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            i && !i.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${H}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [r, ...a] = e.split(".");
    return `${r}${H}${a.join(H)}`;
  }
  return e;
}
function ie(e, r) {
  let a = Je.get(e);
  if (a) {
    const o = a.get(r);
    if (o) return o;
  } else (a = new Map()), Je.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !ne.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${r}${H}${s}`];
      },
      set(o, s, u) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : ((e[`${r}${H}${s}`] = u), !0);
      },
      has(o, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${r}${H}${s}` in e;
      },
      deleteProperty(o, s) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : (delete e[`${r}${H}${s}`], !0);
      },
    },
  );
  return a.set(r, i), i;
}
function Re(e, r, a) {
  const i = Ye.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(r, u))
          return ie(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(r, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(r, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ye.set(e, o), o;
}
var Ze = new WeakMap();
function le(e, r, a) {
  let i = `${r}:${JSON.stringify([...a].sort())}`,
    o = Ze.get(e);
  if (o) {
    const h = o.get(i);
    if (h) return h;
  } else (o = new Map()), Ze.set(e, o);
  const s = new Set(a),
    u = ["self", ...a],
    d = new Proxy(
      {},
      {
        get(h, p) {
          if (typeof p != "symbol" && !ne.has(p)) {
            if (p === "self") return ie(e, r);
            if (s.has(p)) return ie(e, p);
          }
        },
        has(h, p) {
          return typeof p == "symbol" || ne.has(p)
            ? !1
            : p === "self" || s.has(p);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(h, p) {
          if (typeof p != "symbol" && (p === "self" || s.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return o.set(i, d), d;
}
function _e(e, r) {
  let a = Xe.get(e);
  if (a) {
    const o = a.get(r);
    if (o) return o;
  } else (a = new Map()), Xe.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !ne.has(s)) return e[`${r}${H}${s}`];
      },
      has(o, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${r}${H}${s}` in e;
      },
    },
  );
  return a.set(r, i), i;
}
function Kt(e, r, a) {
  const i = Ge.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(r, u))
          return _e(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(r, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(r, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ge.set(e, o), o;
}
var et = new WeakMap();
function Ht(e, r, a) {
  let i = et.get(e);
  return (
    i || ((i = new Map()), et.set(e, i)),
    new Proxy(
      {},
      {
        get(o, s) {
          if (typeof s == "symbol" || ne.has(s) || !Object.hasOwn(r, s)) return;
          const u = i.get(s);
          if (u) return u;
          const d = new Proxy(
            {},
            {
              get(h, p) {
                if (typeof p != "symbol" && !ne.has(p))
                  return (c) => {
                    e.dispatch({ type: `${s}${H}${p}`, ...c });
                  };
              },
            },
          );
          return i.set(s, d), d;
        },
        has(o, s) {
          return typeof s == "symbol" || ne.has(s) ? !1 : Object.hasOwn(r, s);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(o, s) {
          if (typeof s != "symbol" && Object.hasOwn(r, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Vt(e) {
  const r = e.module;
  if (!r)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof r,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !we(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let a = e.debug,
    i = e.errorBoundary;
  e.zeroConfig &&
    ((a = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (i = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let o = null,
    s = null;
  s = mt({
    modules: [
      {
        id: r.id,
        schema: r.schema.facts,
        requirements: r.schema.requirements,
        init: r.init,
        derive: r.derive,
        events: r.events,
        effects: r.effects,
        constraints: r.constraints,
        resolvers: r.resolvers,
        hooks: r.hooks,
        snapshotEvents: r.snapshotEvents,
      },
    ],
    plugins: e.plugins,
    debug: a,
    errorBoundary: i,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, c] of Object.entries(e.initialFacts))
          ne.has(p) || (s.facts[p] = c);
      if (o) {
        for (const [p, c] of Object.entries(o)) ne.has(p) || (s.facts[p] = c);
        o = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(p, c) {
          if (typeof c != "symbol" && !ne.has(c))
            return ($) => {
              s.dispatch({ type: c, ...$ });
            };
        },
      },
    ),
    d = null,
    h = e.tickMs;
  return {
    _mode: "single",
    facts: s.facts,
    debug: s.debug,
    derive: s.derive,
    events: u,
    constraints: s.constraints,
    effects: s.effects,
    get isRunning() {
      return s.isRunning;
    },
    get isSettled() {
      return s.isSettled;
    },
    get isInitialized() {
      return s.isInitialized;
    },
    get isReady() {
      return s.isReady;
    },
    whenReady: s.whenReady.bind(s),
    async hydrate(p) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await p();
      c && typeof c == "object" && (o = c);
    },
    initialize() {
      s.initialize();
    },
    start() {
      s.start(),
        h &&
          h > 0 &&
          r.events &&
          "tick" in r.events &&
          (d = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      d && (clearInterval(d), (d = null)), s.stop();
    },
    destroy() {
      this.stop(), s.destroy();
    },
    dispatch(p) {
      s.dispatch(p);
    },
    batch: s.batch.bind(s),
    read(p) {
      return s.read(p);
    },
    subscribe(p, c) {
      return s.subscribe(p, c);
    },
    watch(p, c, $) {
      return s.watch(p, c, $);
    },
    when(p, c) {
      return s.when(p, c);
    },
    onSettledChange: s.onSettledChange.bind(s),
    onTimeTravelChange: s.onTimeTravelChange.bind(s),
    inspect: s.inspect.bind(s),
    settle: s.settle.bind(s),
    explain: s.explain.bind(s),
    getSnapshot: s.getSnapshot.bind(s),
    restore: s.restore.bind(s),
    getDistributableSnapshot: s.getDistributableSnapshot.bind(s),
    watchDistributableSnapshot: s.watchDistributableSnapshot.bind(s),
    registerModule(p) {
      s.registerModule({
        id: p.id,
        schema: p.schema.facts,
        requirements: p.schema.requirements,
        init: p.init,
        derive: p.derive,
        events: p.events,
        effects: p.effects,
        constraints: p.constraints,
        resolvers: p.resolvers,
        hooks: p.hooks,
        snapshotEvents: p.snapshotEvents,
      });
    },
  };
}
var ht = class {
  constructor(e) {
    (this.capacity = e), (this.buf = new Array(e));
  }
  buf;
  head = 0;
  _size = 0;
  get size() {
    return this._size;
  }
  push(e) {
    (this.buf[this.head] = e),
      (this.head = (this.head + 1) % this.capacity),
      this._size < this.capacity && this._size++;
  }
  toArray() {
    return this._size === 0
      ? []
      : this._size < this.capacity
        ? this.buf.slice(0, this._size)
        : [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }
  clear() {
    (this.buf = new Array(this.capacity)), (this.head = 0), (this._size = 0);
  }
};
function Pe() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function gt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const r = JSON.stringify(e, (a, i) =>
        typeof i == "bigint"
          ? String(i) + "n"
          : typeof i == "symbol"
            ? String(i)
            : i,
      );
      return r.length > 120 ? r.slice(0, 117) + "..." : r;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function fe(e, r) {
  return e.length <= r ? e : e.slice(0, r - 3) + "...";
}
function $e(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Qt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Ut(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Pe() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function Jt() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var Yt = 200,
  De = 340,
  me = 16,
  he = 80,
  tt = 2,
  rt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Gt() {
  return { entries: new ht(Yt), inflight: new Map() };
}
function Xt() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var Zt = 1e4,
  er = 100;
function tr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var rr = 50,
  nt = 200,
  B = {
    bg: "#1a1a2e",
    text: "#e0e0e0",
    accent: "#8b9aff",
    muted: "#b0b0d0",
    border: "#333",
    rowBorder: "#2a2a4a",
    green: "#4ade80",
    yellow: "#fbbf24",
    red: "#f87171",
    closeBtn: "#aaa",
    font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  X = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function nr(e, r, a, i) {
  let o = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(r.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(r.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const d = document.createElement("button");
  d.setAttribute("aria-label", "Open Directive DevTools"),
    d.setAttribute("aria-expanded", String(a)),
    (d.title = "Ctrl+Shift+D to toggle"),
    Object.assign(d.style, {
      ...s,
      background: B.bg,
      color: B.text,
      border: `1px solid ${B.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: B.font,
      fontSize: "12px",
      display: a ? "none" : "block",
    }),
    (d.textContent = "Directive");
  const h = document.createElement("div");
  h.setAttribute("role", "region"),
    h.setAttribute("aria-label", "Directive DevTools"),
    h.setAttribute("data-directive-devtools", ""),
    (h.tabIndex = -1),
    Object.assign(h.style, {
      ...s,
      background: B.bg,
      color: B.text,
      border: `1px solid ${B.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: B.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: a ? "block" : "none",
    });
  const p = document.createElement("div");
  Object.assign(p.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const c = document.createElement("strong");
  (c.style.color = B.accent),
    (c.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
      background: "none",
      border: "none",
      color: B.closeBtn,
      cursor: "pointer",
      fontSize: "16px",
      padding: "8px 12px",
      minWidth: "44px",
      minHeight: "44px",
      lineHeight: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }),
    ($.textContent = "×"),
    p.appendChild(c),
    p.appendChild($),
    h.appendChild(p);
  const q = document.createElement("div");
  (q.style.marginBottom = "6px"), q.setAttribute("aria-live", "polite");
  const j = document.createElement("span");
  (j.style.color = B.green),
    (j.textContent = "Settled"),
    q.appendChild(j),
    h.appendChild(q);
  const A = document.createElement("div");
  Object.assign(A.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const D = document.createElement("button");
  Object.assign(D.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (D.textContent = "◀ Undo"),
    (D.disabled = !0);
  const x = document.createElement("button");
  Object.assign(x.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (x.textContent = "Redo ▶"),
    (x.disabled = !0);
  const O = document.createElement("span");
  (O.style.color = B.muted),
    (O.style.fontSize = "10px"),
    A.appendChild(D),
    A.appendChild(x),
    A.appendChild(O),
    h.appendChild(A);
  function P(V, U) {
    const Y = document.createElement("details");
    U && (Y.open = !0), (Y.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(de),
      oe.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      Y.appendChild(oe);
    const ue = document.createElement("table");
    Object.assign(ue.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Fe = document.createElement("thead"),
      Ne = document.createElement("tr");
    for (const vt of ["Key", "Value"]) {
      const Se = document.createElement("th");
      (Se.scope = "col"),
        Object.assign(Se.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (Se.textContent = vt),
        Ne.appendChild(Se);
    }
    Fe.appendChild(Ne), ue.appendChild(Fe);
    const We = document.createElement("tbody");
    return (
      ue.appendChild(We),
      Y.appendChild(ue),
      { details: Y, tbody: We, countSpan: de }
    );
  }
  function T(V, U) {
    const Y = document.createElement("details");
    Y.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: U,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(de),
      oe.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      Y.appendChild(oe);
    const ue = document.createElement("ul");
    return (
      Object.assign(ue.style, { margin: "0", paddingLeft: "16px" }),
      Y.appendChild(ue),
      { details: Y, list: ue, countSpan: de }
    );
  }
  const m = P("Facts", !0);
  h.appendChild(m.details);
  const C = P("Derivations", !1);
  h.appendChild(C.details);
  const v = T("Inflight", B.yellow);
  h.appendChild(v.details);
  const E = T("Unmet", B.red);
  h.appendChild(E.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const L = document.createElement("summary");
  Object.assign(L.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (L.textContent = "Performance"),
    R.appendChild(L);
  const f = document.createElement("div");
  (f.style.fontSize = "10px"),
    (f.style.color = B.muted),
    (f.textContent = "No data yet"),
    R.appendChild(f),
    h.appendChild(R);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const w = document.createElement("summary");
  Object.assign(w.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (w.textContent = "Dependency Graph"),
    b.appendChild(w);
  const I = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  I.setAttribute("width", "100%"),
    I.setAttribute("height", "120"),
    I.setAttribute("role", "img"),
    I.setAttribute("aria-label", "System dependency graph"),
    (I.style.display = "block"),
    I.setAttribute("viewBox", "0 0 460 120"),
    I.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    b.appendChild(I),
    h.appendChild(b);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const K = document.createElement("summary");
  Object.assign(K.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (K.textContent = "Timeline"),
    N.appendChild(K);
  const z = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  z.setAttribute("width", "100%"),
    z.setAttribute("height", "60"),
    z.setAttribute("role", "img"),
    z.setAttribute("aria-label", "Resolver execution timeline"),
    (z.style.display = "block"),
    z.setAttribute("viewBox", `0 0 ${De} 60`),
    z.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(De / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", B.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", B.font),
    (y.textContent = "No resolver activity yet"),
    z.appendChild(y),
    N.appendChild(z),
    h.appendChild(N);
  let k, t, n, l;
  if (i) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
    const U = document.createElement("summary");
    Object.assign(U.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (U.textContent = "Events ("),
      U.appendChild(n),
      U.appendChild(document.createTextNode(")")),
      V.appendChild(U),
      (t = document.createElement("div")),
      Object.assign(t.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      t.setAttribute("role", "log"),
      t.setAttribute("aria-live", "polite"),
      (t.tabIndex = 0);
    const Y = document.createElement("div");
    (Y.style.color = B.muted),
      (Y.style.padding = "4px"),
      (Y.textContent = "Waiting for events..."),
      (Y.className = "dt-events-empty"),
      t.appendChild(Y),
      V.appendChild(t),
      h.appendChild(V),
      (k = V),
      (l = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (t = document.createElement("div")),
      (n = document.createElement("span")),
      (l = document.createElement("div")),
      (l.style.fontSize = "10px"),
      (l.style.color = B.muted),
      (l.style.marginTop = "4px"),
      (l.style.fontStyle = "italic"),
      (l.textContent = "Enable trace: true for event log"),
      h.appendChild(l);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const S = document.createElement("button");
  Object.assign(S.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (S.textContent = "⏺ Record");
  const M = document.createElement("button");
  Object.assign(M.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (M.textContent = "⤓ Export"),
    g.appendChild(S),
    g.appendChild(M),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (V) => {
        const U = h,
          Y = U.scrollTop === 0 && V.deltaY < 0,
          oe = U.scrollTop + U.clientHeight >= U.scrollHeight && V.deltaY > 0;
        (Y || oe) && V.preventDefault();
      },
      { passive: !1 },
    );
  let F = a,
    W = new Set();
  function _() {
    (F = !0),
      (h.style.display = "block"),
      (d.style.display = "none"),
      d.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function Q() {
    (F = !1),
      (h.style.display = "none"),
      (d.style.display = "block"),
      d.setAttribute("aria-expanded", "false"),
      d.focus();
  }
  d.addEventListener("click", _), $.addEventListener("click", Q);
  function J(V) {
    V.key === "Escape" && F && Q();
  }
  h.addEventListener("keydown", J);
  function re(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), F ? Q() : _());
  }
  document.addEventListener("keydown", re);
  function Z() {
    o || (document.body.appendChild(d), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function G() {
    (o = !0),
      d.removeEventListener("click", _),
      $.removeEventListener("click", Q),
      h.removeEventListener("keydown", J),
      document.removeEventListener("keydown", re),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const V of W) clearTimeout(V);
    W.clear(), d.remove(), h.remove(), u.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: d,
      titleEl: c,
      statusEl: j,
      factsBody: m.tbody,
      factsCount: m.countSpan,
      derivBody: C.tbody,
      derivCount: C.countSpan,
      derivSection: C.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: E.list,
      unmetSection: E.details,
      unmetCount: E.countSpan,
      perfSection: R,
      perfBody: f,
      timeTravelSection: A,
      timeTravelLabel: O,
      undoBtn: D,
      redoBtn: x,
      flowSection: b,
      flowSvg: I,
      timelineSection: N,
      timelineSvg: z,
      eventsSection: k,
      eventsList: t,
      eventsCount: n,
      traceHint: l,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: G,
    isOpen: () => F,
    flashTimers: W,
  };
}
function xe(e, r, a, i, o, s) {
  let u = gt(i),
    d = e.get(a);
  if (d) {
    const h = d.cells;
    if (h[1] && ((h[1].textContent = u), o && s)) {
      const p = h[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (p.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (d = document.createElement("tr")),
      (d.style.borderBottom = `1px solid ${B.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: B.muted }),
      (h.textContent = a);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = u),
      d.appendChild(h),
      d.appendChild(p),
      r.appendChild(d),
      e.set(a, d);
  }
}
function ir(e, r) {
  const a = e.get(r);
  a && (a.remove(), e.delete(r));
}
function Ae(e, r, a) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(r.length)),
    r.length > 0)
  )
    for (const i of r) {
      const o = document.createElement("li");
      (o.style.fontSize = "11px"),
        (o.textContent = `${i.resolverId} (${i.id})`),
        e.inflightList.appendChild(o);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = B.muted),
      (i.textContent = "None"),
      e.inflightList.appendChild(i);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(a.length)),
    a.length > 0)
  )
    for (const i of a) {
      const o = document.createElement("li");
      (o.style.fontSize = "11px"),
        (o.textContent = `${i.requirement.type} from ${i.fromConstraint}`),
        e.unmetList.appendChild(o);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = B.muted),
      (i.textContent = "None"),
      e.unmetList.appendChild(i);
  }
}
function Oe(e, r, a) {
  const i = r === 0 && a === 0;
  (e.statusEl.style.color = i ? B.green : B.yellow),
    (e.statusEl.textContent = i ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = i ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${i ? "" : " (system working)"}`,
    );
}
function it(e, r, a, i) {
  const o = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(o.length)), o.length === 0)) {
    r.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      d = document.createElement("td");
    (d.colSpan = 2),
      (d.style.color = B.muted),
      (d.style.fontSize = "10px"),
      (d.textContent = "No derivations defined"),
      u.appendChild(d),
      e.derivBody.appendChild(u);
    return;
  }
  const s = new Set(o);
  for (const [u, d] of r) s.has(u) || (d.remove(), r.delete(u));
  for (const u of o) {
    let d;
    try {
      d = gt(a.read(u));
    } catch {
      d = "<error>";
    }
    xe(r, e.derivBody, u, d, !0, i);
  }
}
function or(e, r, a, i) {
  const o = e.eventsList.querySelector(".dt-events-empty");
  o && o.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    d = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const q = JSON.stringify(a);
    h = fe(q, 60);
  } catch {
    h = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = B.closeBtn), (p.textContent = d);
  const c = document.createElement("span");
  (c.style.color = B.accent), (c.textContent = ` ${r} `);
  const $ = document.createElement("span");
  for (
    $.style.color = B.muted,
      $.textContent = h,
      s.appendChild(p),
      s.appendChild(c),
      s.appendChild($),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > rr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(i);
}
function sr(e, r) {
  e.perfBody.replaceChildren();
  const a =
      r.reconcileCount > 0
        ? (r.reconcileTotalMs / r.reconcileCount).toFixed(1)
        : "—",
    i = [
      `Reconciles: ${r.reconcileCount}  (avg ${a}ms)`,
      `Effects: ${r.effectRunCount} run, ${r.effectErrorCount} errors`,
    ];
  for (const o of i) {
    const s = document.createElement("div");
    (s.style.marginBottom = "2px"),
      (s.textContent = o),
      e.perfBody.appendChild(s);
  }
  if (r.resolverStats.size > 0) {
    const o = document.createElement("div");
    (o.style.marginTop = "4px"),
      (o.style.marginBottom = "2px"),
      (o.style.color = B.accent),
      (o.textContent = "Resolvers:"),
      e.perfBody.appendChild(o);
    const s = [...r.resolverStats.entries()].sort(
      (u, d) => d[1].totalMs - u[1].totalMs,
    );
    for (const [u, d] of s) {
      const h = d.count > 0 ? (d.totalMs / d.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${u}: ${d.count}x, avg ${h}ms${d.errors > 0 ? `, ${d.errors} err` : ""}`),
        d.errors > 0 && (p.style.color = B.red),
        e.perfBody.appendChild(p);
    }
  }
}
function ot(e, r) {
  const a = r.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const i = a.currentIndex,
    o = a.snapshots.length;
  e.timeTravelLabel.textContent = o > 0 ? `${i + 1} / ${o}` : "0 snapshots";
  const s = i > 0,
    u = i < o - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function lr(e, r) {
  e.undoBtn.addEventListener("click", () => {
    r.debug && r.debug.currentIndex > 0 && r.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      r.debug &&
        r.debug.currentIndex < r.debug.snapshots.length - 1 &&
        r.debug.goForward(1);
    });
}
var je = new WeakMap();
function ar(e, r, a, i, o, s) {
  return [
    e.join(","),
    r.join(","),
    a.map((u) => `${u.id}:${u.active}`).join(","),
    [...i.entries()].map(([u, d]) => `${u}:${d.status}:${d.type}`).join(","),
    o.join(","),
    s.join(","),
  ].join("|");
}
function cr(e, r, a, i, o) {
  for (const s of a) {
    const u = e.nodes.get(`0:${s}`);
    if (!u) continue;
    const d = r.recentlyChangedFacts.has(s);
    u.rect.setAttribute("fill", d ? B.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of i) {
    const u = e.nodes.get(`1:${s}`);
    if (!u) continue;
    const d = r.recentlyComputedDerivations.has(s);
    u.rect.setAttribute("fill", d ? B.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of o) {
    const u = e.nodes.get(`2:${s}`);
    if (!u) continue;
    const d = r.recentlyActiveConstraints.has(s),
      h = u.rect.getAttribute("stroke") ?? B.muted;
    u.rect.setAttribute("fill", d ? h + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
}
function st(e, r, a) {
  const i = $e(r);
  if (!i) return;
  let o;
  try {
    o = Object.keys(r.facts.$store.toObject());
  } catch {
    o = [];
  }
  const s = Object.keys(r.derive),
    u = i.constraints,
    d = i.unmet,
    h = i.inflight,
    p = Object.keys(i.resolvers),
    c = new Map();
  for (const y of d)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (o.length === 0 && s.length === 0 && u.length === 0 && p.length === 0) {
    je.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
    y.setAttribute("x", "230"),
      y.setAttribute("y", "24"),
      y.setAttribute("text-anchor", "middle"),
      y.setAttribute("fill", B.muted),
      y.setAttribute("font-size", "10"),
      y.setAttribute("font-family", B.font),
      (y.textContent = "No system topology"),
      e.flowSvg.appendChild(y);
    return;
  }
  const $ = h.map((y) => y.resolverId).sort(),
    q = ar(o, s, u, c, p, $),
    j = je.get(e.flowSvg);
  if (j && j.fingerprint === q) {
    cr(
      j,
      a,
      o,
      s,
      u.map((y) => y.id),
    );
    return;
  }
  const A = X.nodeW + X.colGap,
    D = [5, 5 + A, 5 + A * 2, 5 + A * 3, 5 + A * 4],
    x = D[4] + X.nodeW + 5;
  function O(y) {
    let k = X.startY + 12;
    return y.map((t) => {
      const n = { ...t, y: k };
      return (k += X.nodeH + X.nodeGap), n;
    });
  }
  const P = O(o.map((y) => ({ id: y, label: fe(y, X.labelMaxChars) }))),
    T = O(s.map((y) => ({ id: y, label: fe(y, X.labelMaxChars) }))),
    m = O(
      u.map((y) => ({
        id: y.id,
        label: fe(y.id, X.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    C = O(
      [...c.entries()].map(([y, k]) => ({
        id: y,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    v = O(p.map((y) => ({ id: y, label: fe(y, X.labelMaxChars) }))),
    E = Math.max(P.length, T.length, m.length, C.length, v.length, 1),
    R = X.startY + 12 + E * (X.nodeH + X.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${x} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${o.length} facts, ${s.length} derivations, ${u.length} constraints, ${c.size} requirements, ${p.length} resolvers`,
    );
  const L = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, k] of L.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(D[y] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", B.accent),
      t.setAttribute("font-size", String(X.fontSize)),
      t.setAttribute("font-family", B.font),
      (t.textContent = k),
      e.flowSvg.appendChild(t);
  }
  const f = { fingerprint: q, nodes: new Map() };
  function b(y, k, t, n, l, g, S, M) {
    const F = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(k)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(X.nodeW)),
      W.setAttribute("height", String(X.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      F.appendChild(W);
    const _ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      _.setAttribute("x", String(k + 4)),
      _.setAttribute("y", String(t + 4)),
      _.setAttribute("fill", g),
      _.setAttribute("font-size", String(X.fontSize)),
      _.setAttribute("font-family", B.font),
      _.setAttribute("opacity", S ? "0.35" : "1"),
      (_.textContent = l),
      F.appendChild(_),
      e.flowSvg.appendChild(F),
      f.nodes.set(`${y}:${n}`, { g: F, rect: W, text: _ }),
      { midX: k + X.nodeW / 2, midY: t }
    );
  }
  function w(y, k, t, n, l, g) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(k)),
      S.setAttribute("x2", String(t)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", l),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const I = new Map(),
    N = new Map(),
    K = new Map(),
    z = new Map();
  for (const y of P) {
    const k = a.recentlyChangedFacts.has(y.id),
      t = b(0, D[0], y.y, y.id, y.label, B.text, !1, k);
    I.set(y.id, t);
  }
  for (const y of T) {
    const k = a.recentlyComputedDerivations.has(y.id),
      t = b(1, D[1], y.y, y.id, y.label, B.accent, !1, k);
    N.set(y.id, t);
  }
  for (const y of m) {
    const k = a.recentlyActiveConstraints.has(y.id),
      t = b(
        2,
        D[2],
        y.y,
        y.id,
        y.label,
        y.active ? B.yellow : B.muted,
        !y.active,
        k,
      );
    K.set(y.id, t);
  }
  for (const y of C) {
    const k = y.status === "unmet" ? B.red : B.yellow,
      t = b(3, D[3], y.y, y.id, fe(y.type, X.labelMaxChars), k, !1, !1);
    z.set(y.id, t);
  }
  for (const y of v) {
    const k = h.some((t) => t.resolverId === y.id);
    b(4, D[4], y.y, y.id, y.label, k ? B.green : B.muted, !k, !1);
  }
  for (const y of T) {
    const k = a.derivationDeps.get(y.id),
      t = N.get(y.id);
    if (k && t)
      for (const n of k) {
        const l = I.get(n);
        l &&
          w(
            l.midX + X.nodeW / 2,
            l.midY,
            t.midX - X.nodeW / 2,
            t.midY,
            B.accent,
          );
      }
  }
  for (const y of C) {
    const k = K.get(y.fromConstraint),
      t = z.get(y.id);
    k &&
      t &&
      w(k.midX + X.nodeW / 2, k.midY, t.midX - X.nodeW / 2, t.midY, B.muted);
  }
  for (const y of h) {
    const k = z.get(y.id);
    if (k) {
      const t = v.find((n) => n.id === y.resolverId);
      t && w(k.midX + X.nodeW / 2, k.midY, D[4], t.y, B.green);
    }
  }
  je.set(e.flowSvg, f);
}
function ur(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function dr(e, r) {
  const a = r.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let i = 1 / 0,
    o = -1 / 0;
  for (const j of a)
    j.startMs < i && (i = j.startMs), j.endMs > o && (o = j.endMs);
  const s = performance.now();
  for (const j of r.inflight.values()) j < i && (i = j), s > o && (o = s);
  const u = o - i || 1,
    d = De - he - 10,
    h = [],
    p = new Set();
  for (const j of a)
    p.has(j.resolver) || (p.add(j.resolver), h.push(j.resolver));
  for (const j of r.inflight.keys()) p.has(j) || (p.add(j), h.push(j));
  const c = h.slice(-12),
    $ = me * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${De} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const q = 5;
  for (let j = 0; j <= q; j++) {
    const A = he + (d * j) / q,
      D = (u * j) / q,
      x = document.createElementNS("http://www.w3.org/2000/svg", "text");
    x.setAttribute("x", String(A)),
      x.setAttribute("y", "8"),
      x.setAttribute("fill", B.muted),
      x.setAttribute("font-size", "6"),
      x.setAttribute("font-family", B.font),
      x.setAttribute("text-anchor", "middle"),
      (x.textContent =
        D < 1e3 ? `${D.toFixed(0)}ms` : `${(D / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(x);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "line");
    O.setAttribute("x1", String(A)),
      O.setAttribute("y1", "10"),
      O.setAttribute("x2", String(A)),
      O.setAttribute("y2", String($)),
      O.setAttribute("stroke", B.border),
      O.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(O);
  }
  for (let j = 0; j < c.length; j++) {
    const A = c[j],
      D = 12 + j * me,
      x = j % rt.length,
      O = rt[x],
      P = document.createElementNS("http://www.w3.org/2000/svg", "text");
    P.setAttribute("x", String(he - 4)),
      P.setAttribute("y", String(D + me / 2 + 3)),
      P.setAttribute("fill", B.muted),
      P.setAttribute("font-size", "7"),
      P.setAttribute("font-family", B.font),
      P.setAttribute("text-anchor", "end"),
      (P.textContent = fe(A, 12)),
      e.timelineSvg.appendChild(P);
    const T = a.filter((C) => C.resolver === A);
    for (const C of T) {
      const v = he + ((C.startMs - i) / u) * d,
        E = Math.max(((C.endMs - C.startMs) / u) * d, tt),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(D + 2)),
        R.setAttribute("width", String(E)),
        R.setAttribute("height", String(me - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", C.error ? B.red : O),
        R.setAttribute("opacity", "0.8");
      const L = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = C.endMs - C.startMs;
      (L.textContent = `${A}: ${f.toFixed(1)}ms${C.error ? " (error)" : ""}`),
        R.appendChild(L),
        e.timelineSvg.appendChild(R);
    }
    const m = r.inflight.get(A);
    if (m !== void 0) {
      const C = he + ((m - i) / u) * d,
        v = Math.max(((s - m) / u) * d, tt),
        E = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      E.setAttribute("x", String(C)),
        E.setAttribute("y", String(D + 2)),
        E.setAttribute("width", String(v)),
        E.setAttribute("height", String(me - 4)),
        E.setAttribute("rx", "2"),
        E.setAttribute("fill", O),
        E.setAttribute("opacity", "0.4"),
        E.setAttribute("stroke", O),
        E.setAttribute("stroke-width", "1"),
        E.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${A}: inflight ${(s - m).toFixed(0)}ms`),
        E.appendChild(R),
        e.timelineSvg.appendChild(E);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${c.length} resolvers`,
  );
}
function fr() {
  if (typeof window > "u")
    return {
      systems: new Map(),
      getSystem: () => null,
      getSystems: () => [],
      inspect: () => null,
      getEvents: () => [],
      explain: () => null,
      exportSession: () => null,
      importSession: () => !1,
      clearEvents: () => {},
      subscribe: () => () => {},
    };
  if (!window.__DIRECTIVE__) {
    const e = new Map(),
      r = {
        systems: e,
        getSystem(a) {
          return a
            ? (e.get(a)?.system ?? null)
            : (e.values().next().value?.system ?? null);
        },
        getSystems() {
          return [...e.keys()];
        },
        inspect(a) {
          return this.getSystem(a)?.inspect() ?? null;
        },
        getEvents(a) {
          return a
            ? (e.get(a)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(a, i) {
          return this.getSystem(i)?.explain(a) ?? null;
        },
        subscribe(a, i) {
          const o = i ? e.get(i) : e.values().next().value;
          if (!o) {
            let s = !1,
              u = setInterval(() => {
                const h = i ? e.get(i) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              d = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(d);
              for (const h of e.values()) h.subscribers.delete(a);
            };
          }
          return (
            o.subscribers.add(a),
            () => {
              o.subscribers.delete(a);
            }
          );
        },
        exportSession(a) {
          const i = a ? e.get(a) : e.values().next().value;
          return i
            ? JSON.stringify({
                version: 1,
                name: a ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: i.events.toArray(),
              })
            : null;
        },
        importSession(a, i) {
          try {
            if (a.length > 10 * 1024 * 1024) return !1;
            const o = JSON.parse(a);
            if (
              !o ||
              typeof o != "object" ||
              Array.isArray(o) ||
              !Array.isArray(o.events)
            )
              return !1;
            const s = i ? e.get(i) : e.values().next().value;
            if (!s) return !1;
            const u = s.maxEvents,
              d = o.events,
              h = d.length > u ? d.length - u : 0;
            s.events.clear();
            for (let p = h; p < d.length; p++) {
              const c = d[p];
              c &&
                typeof c == "object" &&
                !Array.isArray(c) &&
                typeof c.timestamp == "number" &&
                typeof c.type == "string" &&
                c.type !== "__proto__" &&
                c.type !== "constructor" &&
                c.type !== "prototype" &&
                s.events.push({
                  timestamp: c.timestamp,
                  type: c.type,
                  data: c.data ?? null,
                });
            }
            return !0;
          } catch {
            return !1;
          }
        },
        clearEvents(a) {
          const i = a ? e.get(a) : e.values().next().value;
          i && i.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: r,
        writable: !1,
        configurable: Pe(),
        enumerable: !0,
      }),
      r
    );
  }
  return window.__DIRECTIVE__;
}
function pr(e = {}) {
  const {
      name: r = "default",
      trace: a = !1,
      maxEvents: i,
      panel: o = !1,
      position: s = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    d = Ut(i),
    h = fr(),
    p = {
      system: null,
      events: new ht(d),
      maxEvents: d,
      subscribers: new Set(),
    };
  h.systems.set(r, p);
  let c = (n, l) => {
      const g = { timestamp: Date.now(), type: n, data: l };
      a && p.events.push(g);
      for (const S of p.subscribers)
        try {
          S(g);
        } catch {}
    },
    $ = null,
    q = new Map(),
    j = new Map(),
    A = Jt(),
    D = Xt(),
    x = tr(),
    O = Gt(),
    P = o && typeof window < "u" && typeof document < "u" && Pe(),
    T = null,
    m = 0,
    C = 1,
    v = 2,
    E = 4,
    R = 8,
    L = 16,
    f = 32,
    b = 64,
    w = 128,
    I = new Map(),
    N = new Set(),
    K = null;
  function z(n) {
    (m |= n),
      T === null &&
        typeof requestAnimationFrame < "u" &&
        (T = requestAnimationFrame(y));
  }
  function y() {
    if (((T = null), !$ || !p.system)) {
      m = 0;
      return;
    }
    const n = $.refs,
      l = p.system,
      g = m;
    if (((m = 0), g & C)) {
      for (const S of N) ir(q, S);
      N.clear();
      for (const [S, { value: M, flash: F }] of I)
        xe(q, n.factsBody, S, M, F, $.flashTimers);
      I.clear(), (n.factsCount.textContent = String(q.size));
    }
    if ((g & v && it(n, j, l, $.flashTimers), g & R))
      if (K) Oe(n, K.inflight.length, K.unmet.length);
      else {
        const S = $e(l);
        S && Oe(n, S.inflight.length, S.unmet.length);
      }
    if (g & E)
      if (K) Ae(n, K.inflight, K.unmet);
      else {
        const S = $e(l);
        S && Ae(n, S.inflight, S.unmet);
      }
    g & L && sr(n, A),
      g & f && st(n, l, D),
      g & b && ot(n, l),
      g & w && dr(n, O);
  }
  function k(n, l) {
    $ && a && or($.refs, n, l, p.events.size);
  }
  function t(n, l) {
    x.isRecording &&
      x.recordedEvents.length < Zt &&
      x.recordedEvents.push({ timestamp: Date.now(), type: n, data: Qt(l) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((p.system = n),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${r}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        P)
      ) {
        const l = p.system;
        $ = nr(r, s, u, a);
        const g = $.refs;
        try {
          const M = l.facts.$store.toObject();
          for (const [F, W] of Object.entries(M)) xe(q, g.factsBody, F, W, !1);
          g.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        it(g, j, l);
        const S = $e(l);
        S &&
          (Oe(g, S.inflight.length, S.unmet.length),
          Ae(g, S.inflight, S.unmet)),
          ot(g, l),
          lr(g, l),
          st(g, l, D),
          g.recordBtn.addEventListener("click", () => {
            if (
              ((x.isRecording = !x.isRecording),
              (g.recordBtn.textContent = x.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = x.isRecording ? B.red : B.text),
              x.isRecording)
            ) {
              (x.recordedEvents = []), (x.snapshots = []);
              try {
                x.snapshots.push({
                  timestamp: Date.now(),
                  facts: l.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          g.exportBtn.addEventListener("click", () => {
            const M =
                x.recordedEvents.length > 0
                  ? x.recordedEvents
                  : p.events.toArray(),
              F = JSON.stringify(
                {
                  version: 1,
                  name: r,
                  exportedAt: Date.now(),
                  events: M,
                  snapshots: x.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([F], { type: "application/json" }),
              _ = URL.createObjectURL(W),
              Q = document.createElement("a");
            (Q.href = _),
              (Q.download = `directive-session-${r}-${Date.now()}.json`),
              Q.click(),
              URL.revokeObjectURL(_);
          });
      }
    },
    onStart: (n) => {
      c("start", {}), k("start", {}), t("start", {});
    },
    onStop: (n) => {
      c("stop", {}), k("stop", {}), t("stop", {});
    },
    onDestroy: (n) => {
      c("destroy", {}),
        h.systems.delete(r),
        T !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(T), (T = null)),
        D.animationTimer && clearTimeout(D.animationTimer),
        $ && ($.destroy(), ($ = null), q.clear(), j.clear());
    },
    onFactSet: (n, l, g) => {
      c("fact.set", { key: n, value: l, prev: g }),
        t("fact.set", { key: n, value: l, prev: g }),
        D.recentlyChangedFacts.add(n),
        $ &&
          p.system &&
          (I.set(n, { value: l, flash: !0 }),
          N.delete(n),
          z(C),
          k("fact.set", { key: n, value: l }));
    },
    onFactDelete: (n, l) => {
      c("fact.delete", { key: n, prev: l }),
        t("fact.delete", { key: n, prev: l }),
        $ && (N.add(n), I.delete(n), z(C), k("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        t("facts.batch", { count: n.length }),
        $ && p.system)
      ) {
        for (const l of n)
          l.type === "delete"
            ? (N.add(l.key), I.delete(l.key))
            : (D.recentlyChangedFacts.add(l.key),
              I.set(l.key, { value: l.value, flash: !0 }),
              N.delete(l.key));
        z(C), k("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, l, g) => {
      c("derivation.compute", { id: n, value: l, deps: g }),
        t("derivation.compute", { id: n, deps: g }),
        D.derivationDeps.set(n, g),
        D.recentlyComputedDerivations.add(n),
        k("derivation.compute", { id: n, deps: g });
    },
    onDerivationInvalidate: (n) => {
      c("derivation.invalidate", { id: n }),
        k("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      c("reconcile.start", {}),
        (A.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (c("reconcile.end", n),
        t("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
          completed: n.completed.length,
        }),
        A.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - A.lastReconcileStartMs;
        A.reconcileCount++,
          (A.reconcileTotalMs += l),
          (A.lastReconcileStartMs = 0);
      }
      if (x.isRecording && p.system && x.snapshots.length < er)
        try {
          x.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        p.system &&
        ((K = n),
        ur(D),
        z(v | R | E | L | f | b),
        k("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, l) => {
      c("constraint.evaluate", { id: n, active: l }),
        t("constraint.evaluate", { id: n, active: l }),
        l
          ? (D.activeConstraints.add(n), D.recentlyActiveConstraints.add(n))
          : D.activeConstraints.delete(n),
        k("constraint.evaluate", { id: n, active: l });
    },
    onConstraintError: (n, l) => {
      c("constraint.error", { id: n, error: String(l) }),
        k("constraint.error", { id: n, error: String(l) });
    },
    onRequirementCreated: (n) => {
      c("requirement.created", { id: n.id, type: n.requirement.type }),
        t("requirement.created", { id: n.id, type: n.requirement.type }),
        k("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, l) => {
      c("requirement.met", { id: n.id, byResolver: l }),
        t("requirement.met", { id: n.id, byResolver: l }),
        k("requirement.met", { id: n.id, byResolver: l });
    },
    onRequirementCanceled: (n) => {
      c("requirement.canceled", { id: n.id }),
        t("requirement.canceled", { id: n.id }),
        k("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, l) => {
      c("resolver.start", { resolver: n, requirementId: l.id }),
        t("resolver.start", { resolver: n, requirementId: l.id }),
        O.inflight.set(n, performance.now()),
        $ &&
          p.system &&
          (z(E | R | w),
          k("resolver.start", { resolver: n, requirementId: l.id }));
    },
    onResolverComplete: (n, l, g) => {
      c("resolver.complete", { resolver: n, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: n,
          requirementId: l.id,
          duration: g,
        });
      const S = A.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += g),
        A.resolverStats.set(n, S),
        A.resolverStats.size > nt)
      ) {
        const F = A.resolverStats.keys().next().value;
        F !== void 0 && A.resolverStats.delete(F);
      }
      const M = O.inflight.get(n);
      O.inflight.delete(n),
        M !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          p.system &&
          (z(E | R | L | w),
          k("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, l, g) => {
      c("resolver.error", {
        resolver: n,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: n,
          requirementId: l.id,
          error: String(g),
        });
      const S = A.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, A.resolverStats.set(n, S), A.resolverStats.size > nt)) {
        const F = A.resolverStats.keys().next().value;
        F !== void 0 && A.resolverStats.delete(F);
      }
      const M = O.inflight.get(n);
      O.inflight.delete(n),
        M !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          p.system &&
          (z(E | R | L | w),
          k("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, l, g) => {
      c("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        k("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, l) => {
      c("resolver.cancel", { resolver: n, requirementId: l.id }),
        t("resolver.cancel", { resolver: n, requirementId: l.id }),
        O.inflight.delete(n),
        k("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        t("effect.run", { id: n }),
        A.effectRunCount++,
        k("effect.run", { id: n });
    },
    onEffectError: (n, l) => {
      c("effect.error", { id: n, error: String(l) }),
        A.effectErrorCount++,
        k("effect.error", { id: n, error: String(l) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        $ && p.system && z(b),
        k("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, l) => {
      if (
        (c("timetravel.jump", { from: n, to: l }),
        t("timetravel.jump", { from: n, to: l }),
        $ && p.system)
      ) {
        const g = p.system;
        try {
          const S = g.facts.$store.toObject();
          q.clear(), $.refs.factsBody.replaceChildren();
          for (const [M, F] of Object.entries(S))
            xe(q, $.refs.factsBody, M, F, !1);
          $.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        j.clear(),
          D.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (K = null),
          z(v | R | E | f | b),
          k("timetravel.jump", { from: n, to: l });
      }
    },
    onError: (n) => {
      c("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        t("error", { source: n.source, message: n.message }),
        k("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, l) => {
      c("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: l,
      }),
        k("error.recovery", { source: n.source, strategy: l });
    },
  };
}
const mr = [
  { id: "1", title: "JavaScript", category: "Language" },
  { id: "2", title: "TypeScript", category: "Language" },
  { id: "3", title: "Python", category: "Language" },
  { id: "4", title: "Rust", category: "Language" },
  { id: "5", title: "Go", category: "Language" },
  { id: "6", title: "Java", category: "Language" },
  { id: "7", title: "C++", category: "Language" },
  { id: "8", title: "Swift", category: "Language" },
  { id: "9", title: "Kotlin", category: "Language" },
  { id: "10", title: "Ruby", category: "Language" },
  { id: "11", title: "React", category: "Framework" },
  { id: "12", title: "Vue", category: "Framework" },
  { id: "13", title: "Angular", category: "Framework" },
  { id: "14", title: "Svelte", category: "Framework" },
  { id: "15", title: "Solid", category: "Framework" },
  { id: "16", title: "Next.js", category: "Framework" },
  { id: "17", title: "Remix", category: "Framework" },
  { id: "18", title: "Astro", category: "Framework" },
  { id: "19", title: "Node.js", category: "Runtime" },
  { id: "20", title: "Deno", category: "Runtime" },
  { id: "21", title: "Bun", category: "Runtime" },
  { id: "22", title: "PostgreSQL", category: "Database" },
  { id: "23", title: "MongoDB", category: "Database" },
  { id: "24", title: "Redis", category: "Database" },
  { id: "25", title: "SQLite", category: "Database" },
  { id: "26", title: "Docker", category: "Tool" },
  { id: "27", title: "Kubernetes", category: "Tool" },
  { id: "28", title: "Git", category: "Tool" },
  { id: "29", title: "Webpack", category: "Tool" },
  { id: "30", title: "Vite", category: "Tool" },
];
async function hr(e, r) {
  await new Promise((i) => setTimeout(i, r));
  const a = e.toLowerCase();
  return mr.filter(
    (i) =>
      i.title.toLowerCase().includes(a) || i.category.toLowerCase().includes(a),
  );
}
const Le = {
  facts: {
    query: ee.string(),
    queryChangedAt: ee.number(),
    debouncedQuery: ee.string(),
    lastSearchedQuery: ee.string(),
    results: ee.object(),
    isSearching: ee.boolean(),
    now: ee.number(),
    keystrokeCount: ee.number(),
    apiCallCount: ee.number(),
    debounceDelay: ee.number(),
    apiDelay: ee.number(),
    minChars: ee.number(),
    eventLog: ee.object(),
  },
  derivations: {
    isDebouncing: ee.boolean(),
    debounceProgress: ee.number(),
    resultCount: ee.number(),
    savedCalls: ee.number(),
  },
  events: {
    setQuery: { value: ee.string() },
    tick: {},
    clearSearch: {},
    setDebounceDelay: { value: ee.number() },
    setApiDelay: { value: ee.number() },
    setMinChars: { value: ee.number() },
  },
  requirements: { SETTLE_DEBOUNCE: {}, SEARCH: { query: ee.string() } },
};
function ge(e, r, a) {
  const i = [...e.eventLog];
  i.push({ timestamp: Date.now(), event: r, detail: a }),
    i.length > 100 && i.splice(0, i.length - 100),
    (e.eventLog = i);
}
const gr = kt("debounce-search", {
    schema: Le,
    init: (e) => {
      (e.query = ""),
        (e.queryChangedAt = 0),
        (e.debouncedQuery = ""),
        (e.lastSearchedQuery = ""),
        (e.results = []),
        (e.isSearching = !1),
        (e.now = Date.now()),
        (e.keystrokeCount = 0),
        (e.apiCallCount = 0),
        (e.debounceDelay = 300),
        (e.apiDelay = 500),
        (e.minChars = 2),
        (e.eventLog = []);
    },
    derive: {
      isDebouncing: (e) => e.query !== e.debouncedQuery && e.queryChangedAt > 0,
      debounceProgress: (e, r) => {
        if (!r.isDebouncing) return 0;
        const a = e.now - e.queryChangedAt,
          i = e.debounceDelay;
        return Math.min(1, a / i);
      },
      resultCount: (e) => e.results.length,
      savedCalls: (e) => Math.max(0, e.keystrokeCount - e.apiCallCount),
    },
    events: {
      setQuery: (e, { value: r }) => {
        (e.query = r),
          (e.queryChangedAt = Date.now()),
          (e.keystrokeCount = e.keystrokeCount + 1),
          r === "" &&
            ((e.debouncedQuery = ""),
            (e.results = []),
            (e.lastSearchedQuery = ""),
            (e.queryChangedAt = 0));
      },
      tick: (e) => {
        e.now = Date.now();
      },
      clearSearch: (e) => {
        (e.query = ""),
          (e.debouncedQuery = ""),
          (e.results = []),
          (e.lastSearchedQuery = ""),
          (e.queryChangedAt = 0);
      },
      setDebounceDelay: (e, { value: r }) => {
        e.debounceDelay = r;
      },
      setApiDelay: (e, { value: r }) => {
        e.apiDelay = r;
      },
      setMinChars: (e, { value: r }) => {
        e.minChars = r;
      },
    },
    constraints: {
      debounceSettled: {
        priority: 100,
        when: (e) =>
          e.query !== e.debouncedQuery &&
          e.queryChangedAt > 0 &&
          e.now - e.queryChangedAt >= e.debounceDelay,
        require: () => ({ type: "SETTLE_DEBOUNCE" }),
      },
      needsSearch: {
        priority: 90,
        when: (e) =>
          e.debouncedQuery.length >= e.minChars &&
          e.debouncedQuery !== e.lastSearchedQuery &&
          !e.isSearching,
        require: (e) => ({ type: "SEARCH", query: e.debouncedQuery }),
      },
    },
    resolvers: {
      settleDebounce: {
        requirement: "SETTLE_DEBOUNCE",
        resolve: async (e, r) => {
          const a = r.facts.query;
          (r.facts.debouncedQuery = a),
            ge(r.facts, "debounce-settled", `"${a}"`),
            (a === "" || a.length < r.facts.minChars) &&
              ((r.facts.results = []), (r.facts.lastSearchedQuery = ""));
        },
      },
      search: {
        requirement: "SEARCH",
        key: (e) => `search-${e.query}`,
        timeout: 1e4,
        resolve: async (e, r) => {
          (r.facts.isSearching = !0),
            (r.facts.apiCallCount = r.facts.apiCallCount + 1),
            ge(r.facts, "search-start", `"${e.query}"`);
          const a = r.facts.apiDelay,
            i = await hr(e.query, a);
          r.facts.debouncedQuery === e.query
            ? ((r.facts.results = i),
              (r.facts.lastSearchedQuery = e.query),
              ge(
                r.facts,
                "search-complete",
                `${i.length} results for "${e.query}"`,
              ))
            : ge(r.facts, "search-stale", `Discarded results for "${e.query}"`),
            (r.facts.isSearching = !1);
        },
      },
    },
    effects: {
      logQueryChange: {
        deps: ["query"],
        run: (e, r) => {
          r &&
            r.query !== e.query &&
            e.query !== "" &&
            ge(e, "keystroke", `"${e.query}"`);
        },
      },
    },
  }),
  ae = Nt({ module: gr, plugins: [pr({ name: "debounce-constraints" })] });
ae.start();
const yr = [...Object.keys(Le.facts), ...Object.keys(Le.derivations)],
  Me = document.getElementById("dc-status-indicator"),
  Ie = document.getElementById("dc-status-text"),
  ze = document.getElementById("dc-search-input"),
  vr = document.getElementById("dc-clear-btn"),
  lt = document.getElementById("dc-progress-wrap"),
  at = document.getElementById("dc-progress-bar"),
  br = document.getElementById("dc-raw-query"),
  wr = document.getElementById("dc-debounced-query"),
  ye = document.getElementById("dc-results-list"),
  Sr = document.getElementById("dc-results-footer"),
  Cr = document.getElementById("dc-stat-keystrokes"),
  $r = document.getElementById("dc-stat-api-calls"),
  xr = document.getElementById("dc-stat-saved"),
  ct = document.getElementById("dc-debounce-delay"),
  Er = document.getElementById("dc-debounce-val"),
  ut = document.getElementById("dc-api-delay"),
  kr = document.getElementById("dc-api-delay-val"),
  dt = document.getElementById("dc-min-chars"),
  Dr = document.getElementById("dc-min-chars-val"),
  qe = document.getElementById("dc-timeline");
function yt() {
  const e = ae.facts,
    r = ae.derive,
    a = e.query,
    i = e.debouncedQuery,
    o = e.results,
    s = e.isSearching,
    u = e.keystrokeCount,
    d = e.apiCallCount,
    h = r.isDebouncing,
    p = r.debounceProgress,
    c = r.resultCount,
    $ = r.savedCalls,
    q = e.eventLog;
  if (
    (h
      ? ((Me.className = "dc-status-indicator debouncing"),
        (Ie.textContent = "Debouncing..."))
      : s
        ? ((Me.className = "dc-status-indicator searching"),
          (Ie.textContent = "Searching..."))
        : ((Me.className = "dc-status-indicator"), (Ie.textContent = "")),
    p > 0
      ? (lt.classList.remove("hidden"), (at.style.width = `${p * 100}%`))
      : (lt.classList.add("hidden"), (at.style.width = "0%")),
    (br.textContent = `"${a}"`),
    (wr.textContent = `"${i}"`),
    a === "" && o.length === 0)
  )
    ye.innerHTML =
      '<div class="dc-results-empty">Type to search 30 tech items...</div>';
  else if (o.length === 0 && i.length > 0 && !s && !h)
    ye.innerHTML = `<div class="dc-results-empty">No results for "${ve(i)}"</div>`;
  else if (o.length === 0 && (s || h))
    ye.innerHTML = '<div class="dc-results-empty">Searching...</div>';
  else {
    ye.innerHTML = "";
    for (const A of o) {
      const D = document.createElement("div");
      D.className = "dc-result-item";
      const x = A.category.toLowerCase();
      (D.innerHTML = `
        <span class="dc-result-title">${ve(A.title)}</span>
        <span class="dc-result-badge ${x}">${ve(A.category)}</span>
      `),
        ye.appendChild(D);
    }
  }
  const j = u > 0 ? Math.round(($ / u) * 100) : 0;
  if (
    ((Sr.textContent = `${c} result${c !== 1 ? "s" : ""} · ${u} keystroke${u !== 1 ? "s" : ""} · ${d} API call${d !== 1 ? "s" : ""} (${$} saved)`),
    (Cr.textContent = `${u}`),
    ($r.textContent = `${d}`),
    (xr.textContent = `${$} (${j}%)`),
    (Er.textContent = `${e.debounceDelay}ms`),
    (kr.textContent = `${e.apiDelay}ms`),
    (Dr.textContent = `${e.minChars}`),
    q.length === 0)
  )
    qe.innerHTML =
      '<div class="dc-timeline-empty">Events will appear here after typing</div>';
  else {
    qe.innerHTML = "";
    for (let A = q.length - 1; A >= 0; A--) {
      const D = q[A],
        x = document.createElement("div");
      x.className = `dc-timeline-entry ${D.event}`;
      const P = new Date(D.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (x.innerHTML = `
        <span class="dc-timeline-time">${P}</span>
        <span class="dc-timeline-event">${ve(D.event)}</span>
        <span class="dc-timeline-detail">${ve(D.detail)}</span>
      `),
        qe.appendChild(x);
    }
  }
}
ae.subscribe(yr, yt);
setInterval(() => {
  ae.events.tick();
}, 100);
ze.addEventListener("input", () => {
  ae.events.setQuery({ value: ze.value });
});
vr.addEventListener("click", () => {
  ae.events.clearSearch(), (ze.value = "");
});
ct.addEventListener("input", () => {
  ae.events.setDebounceDelay({ value: Number(ct.value) });
});
ut.addEventListener("input", () => {
  ae.events.setApiDelay({ value: Number(ut.value) });
});
dt.addEventListener("input", () => {
  ae.events.setMinChars({ value: Number(dt.value) });
});
function ve(e) {
  const r = document.createElement("div");
  return (r.textContent = e), r.innerHTML;
}
yt();
document.body.setAttribute("data-debounce-constraints-ready", "true");
