(() => {
  const n = document.createElement("link").relList;
  if (n && n.supports && n.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) o(i);
  new MutationObserver((i) => {
    for (const s of i)
      if (s.type === "childList")
        for (const d of s.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && o(d);
  }).observe(document, { childList: !0, subtree: !0 });
  function a(i) {
    const s = {};
    return (
      i.integrity && (s.integrity = i.integrity),
      i.referrerPolicy && (s.referrerPolicy = i.referrerPolicy),
      i.crossOrigin === "use-credentials"
        ? (s.credentials = "include")
        : i.crossOrigin === "anonymous"
          ? (s.credentials = "omit")
          : (s.credentials = "same-origin"),
      s
    );
  }
  function o(i) {
    if (i.ep) return;
    i.ep = !0;
    const s = a(i);
    fetch(i.href, s);
  }
})();
var Pe = class extends Error {
    constructor(n, a, o, i, s = !0) {
      super(n),
        (this.source = a),
        (this.sourceId = o),
        (this.context = i),
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
    track(n) {
      e.add(n);
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
  const n = bt();
  pe.push(n);
  try {
    return { value: e(), deps: n.getDependencies() };
  } finally {
    pe.pop();
  }
}
function Fe(e) {
  const n = pe.splice(0, pe.length);
  try {
    return e();
  } finally {
    pe.push(...n);
  }
}
function je(e) {
  St().track(e);
}
function xt(e, n = 100) {
  try {
    return JSON.stringify(e)?.slice(0, n) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Ce(e = [], n, a, o, i, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: n,
    _default: a,
    _transform: o,
    _description: i,
    _refinements: s,
    validate(d) {
      return Ce([...e, d], n, a, o, i, s);
    },
  };
}
function ee(e, n, a, o, i, s) {
  return {
    ...Ce(e, n, a, o, i, s),
    default(d) {
      return ee(e, n, d, o, i, s);
    },
    transform(d) {
      return ee(
        [],
        n,
        void 0,
        (u) => {
          const h = o ? o(u) : u;
          return d(h);
        },
        i,
      );
    },
    brand() {
      return ee(e, `Branded<${n}>`, a, o, i, s);
    },
    describe(d) {
      return ee(e, n, a, o, d, s);
    },
    refine(d, u) {
      const h = [...(s ?? []), { predicate: d, message: u }];
      return ee([...e, d], n, a, o, i, h);
    },
    nullable() {
      return ee(
        [(d) => d === null || e.every((u) => u(d))],
        `${n} | null`,
        a,
        o,
        i,
      );
    },
    optional() {
      return ee(
        [(d) => d === void 0 || e.every((u) => u(d))],
        `${n} | undefined`,
        a,
        o,
        i,
      );
    },
  };
}
var oe = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (n, a, o, i, s) => ({
      ...ee(n, "number", a, o, i, s),
      min(d) {
        return e([...n, (u) => u >= d], a, o, i, s);
      },
      max(d) {
        return e([...n, (u) => u <= d], a, o, i, s);
      },
      default(d) {
        return e(n, d, o, i, s);
      },
      describe(d) {
        return e(n, a, o, d, s);
      },
      refine(d, u) {
        const h = [...(s ?? []), { predicate: d, message: u }];
        return e([...n, d], a, o, i, h);
      },
    });
    return e([(n) => typeof n == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (n, a, o, i, s) => {
      const d = ee(n, "array", o, void 0, i),
        u = s ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(h) {
          u.value = h;
        },
        of(h) {
          const f = { value: -1 };
          return e(
            [
              ...n,
              (c) => {
                for (let $ = 0; $ < c.length; $++) {
                  const q = c[$];
                  if (!h._validators.every((D) => D(q)))
                    return (f.value = $), !1;
                }
                return !0;
              },
            ],
            h,
            o,
            i,
            f,
          );
        },
        nonEmpty() {
          return e([...n, (h) => h.length > 0], a, o, i, u);
        },
        maxLength(h) {
          return e([...n, (f) => f.length <= h], a, o, i, u);
        },
        minLength(h) {
          return e([...n, (f) => f.length >= h], a, o, i, u);
        },
        default(h) {
          return e(n, a, h, i, u);
        },
        describe(h) {
          return e(n, a, o, h, u);
        },
      };
    };
    return e([(n) => Array.isArray(n)]);
  },
  object() {
    const e = (n, a, o) => ({
      ...ee(n, "object", a, void 0, o),
      shape(i) {
        return e(
          [
            ...n,
            (s) => {
              for (const [d, u] of Object.entries(i)) {
                const h = s[d],
                  f = u;
                if (f && !f._validators.every((c) => c(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          o,
        );
      },
      nonNull() {
        return e([...n, (i) => i != null], a, o);
      },
      hasKeys(...i) {
        return e([...n, (s) => i.every((d) => d in s)], a, o);
      },
      default(i) {
        return e(n, i, o);
      },
      describe(i) {
        return e(n, a, i);
      },
    });
    return e([(n) => typeof n == "object" && n !== null && !Array.isArray(n)]);
  },
  enum(...e) {
    const n = new Set(e);
    return ee(
      [(a) => typeof a == "string" && n.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(n) => n === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const n = e._typeName ?? "unknown";
    return Ce(
      [(a) => (a === null ? !0 : e._validators.every((o) => o(a)))],
      `${n} | null`,
    );
  },
  optional(e) {
    const n = e._typeName ?? "unknown";
    return Ce(
      [(a) => (a === void 0 ? !0 : e._validators.every((o) => o(a)))],
      `${n} | undefined`,
    );
  },
  union(...e) {
    const n = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [(a) => e.some((o) => o._validators.every((i) => i(a)))],
      n.join(" | "),
    );
  },
  record(e) {
    const n = e._typeName ?? "unknown";
    return ee(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((o) => e._validators.every((i) => i(o))),
      ],
      `Record<string, ${n}>`,
    );
  },
  tuple(...e) {
    const n = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((o, i) => o._validators.every((s) => s(a[i]))),
      ],
      `[${n.join(", ")}]`,
    );
  },
  date() {
    return ee([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ee([(n) => typeof n == "string" && e.test(n)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return ee([(n) => typeof n == "string" && e.test(n)], "email");
  },
  url() {
    return ee(
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
    return ee([(e) => typeof e == "bigint"], "bigint");
  },
};
function $t(e) {
  const { schema: n, onChange: a, onBatch: o } = e;
  Object.keys(n).length;
  let i = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    u = new Map(),
    h = new Set(),
    f = new Map(),
    c = new Set(),
    $ = 0,
    q = [],
    D = new Set(),
    j = !1,
    O = [],
    b = 100;
  function R(p) {
    return (
      p !== null &&
      typeof p == "object" &&
      "safeParse" in p &&
      typeof p.safeParse == "function" &&
      "_def" in p &&
      "parse" in p &&
      typeof p.parse == "function"
    );
  }
  function L(p) {
    const w = p;
    if (w._typeName) return w._typeName;
    if (R(p)) {
      const S = p._def;
      if (S?.typeName) return S.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function T(p) {
    return d ? "[redacted]" : xt(p);
  }
  function m(p, w) {
    if (!i) return;
    const S = n[p];
    if (!S) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${p}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${p}"`);
      return;
    }
    if (R(S)) {
      const P = S.safeParse(w);
      if (!P.success) {
        const y = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          k = T(w),
          t =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          r = L(S);
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${r}, got ${y} ${k}. ${t}`,
        );
      }
      return;
    }
    const I = S,
      N = I._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const K = I._typeName ?? "unknown";
    for (let P = 0; P < N.length; P++) {
      const y = N[P];
      if (typeof y == "function" && !y(w)) {
        let k = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          t = T(w),
          r = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((r = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const l = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${K}, got ${k} ${t}${l}${r}`,
        );
      }
    }
  }
  function E(p) {
    f.get(p)?.forEach((w) => w());
  }
  function v() {
    c.forEach((p) => p());
  }
  function C(p, w, S) {
    if (j) {
      O.push({ key: p, value: w, prev: S });
      return;
    }
    j = !0;
    try {
      a?.(p, w, S), E(p), v();
      let I = 0;
      while (O.length > 0) {
        if (++I > b)
          throw (
            ((O.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${b} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...O];
        O.length = 0;
        for (const K of N) a?.(K.key, K.value, K.prev), E(K.key);
        v();
      }
    } finally {
      j = !1;
    }
  }
  function A() {
    if (!($ > 0)) {
      if ((o && q.length > 0 && o([...q]), D.size > 0)) {
        j = !0;
        try {
          for (const w of D) E(w);
          v();
          let p = 0;
          while (O.length > 0) {
            if (++p > b)
              throw (
                ((O.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${b} iterations.`,
                ))
              );
            const w = [...O];
            O.length = 0;
            for (const S of w) a?.(S.key, S.value, S.prev), E(S.key);
            v();
          }
        } finally {
          j = !1;
        }
      }
      (q.length = 0), D.clear();
    }
  }
  const z = {
    get(p) {
      return je(p), u.get(p);
    },
    has(p) {
      return je(p), u.has(p);
    },
    set(p, w) {
      m(p, w);
      const S = u.get(p);
      Object.is(S, w) ||
        (u.set(p, w),
        h.add(p),
        $ > 0
          ? (q.push({ key: p, value: w, prev: S, type: "set" }), D.add(p))
          : C(p, w, S));
    },
    delete(p) {
      const w = u.get(p);
      u.delete(p),
        h.delete(p),
        $ > 0
          ? (q.push({ key: p, value: void 0, prev: w, type: "delete" }),
            D.add(p))
          : C(p, void 0, w);
    },
    batch(p) {
      $++;
      try {
        p();
      } finally {
        $--, A();
      }
    },
    subscribe(p, w) {
      for (const S of p) {
        const I = S;
        f.has(I) || f.set(I, new Set()), f.get(I).add(w);
      }
      return () => {
        for (const S of p) {
          const I = f.get(S);
          I && (I.delete(w), I.size === 0 && f.delete(S));
        }
      };
    },
    subscribeAll(p) {
      return c.add(p), () => c.delete(p);
    },
    toObject() {
      const p = {};
      for (const w of h) u.has(w) && (p[w] = u.get(w));
      return p;
    },
  };
  return (
    (z.registerKeys = (p) => {
      for (const w of Object.keys(p)) ye.has(w) || ((n[w] = p[w]), h.add(w));
    }),
    z
  );
}
var ye = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Et(e, n) {
  const a = () => ({
    get: (o) => Fe(() => e.get(o)),
    has: (o) => Fe(() => e.has(o)),
  });
  return new Proxy(
    {},
    {
      get(o, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return a;
        if (typeof i != "symbol" && !ye.has(i)) return e.get(i);
      },
      set(o, i, s) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.set(i, s), !0);
      },
      deleteProperty(o, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(o, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || ye.has(i)
            ? !1
            : e.has(i);
      },
      ownKeys() {
        return Object.keys(n);
      },
      getOwnPropertyDescriptor(o, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Ct(e) {
  const n = $t(e),
    a = Et(n, e.schema);
  return { store: n, facts: a };
}
function st(e, n) {
  const a = "crossModuleDeps" in n ? n.crossModuleDeps : void 0;
  return {
    id: e,
    schema: n.schema,
    init: n.init,
    derive: n.derive ?? {},
    events: n.events ?? {},
    effects: n.effects,
    constraints: n.constraints,
    resolvers: n.resolvers,
    hooks: n.hooks,
    snapshotEvents: n.snapshotEvents,
    crossModuleDeps: a,
  };
}
async function Se(e, n, a) {
  let o,
    i = new Promise((s, d) => {
      o = setTimeout(() => d(new Error(a)), n);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(o);
  }
}
function lt(e, n = 50) {
  const a = new WeakSet();
  function o(i, s) {
    if (s > n) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const d = typeof i;
    if (d === "string") return JSON.stringify(i);
    if (d === "number" || d === "boolean") return String(i);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (a.has(i)) return '"[circular]"';
      a.add(i);
      const u = `[${i.map((h) => o(h, s + 1)).join(",")}]`;
      return a.delete(i), u;
    }
    if (d === "object") {
      const u = i;
      if (a.has(u)) return '"[circular]"';
      a.add(u);
      const h = `{${Object.keys(u)
        .sort()
        .map((f) => `${JSON.stringify(f)}:${o(u[f], s + 1)}`)
        .join(",")}}`;
      return a.delete(u), h;
    }
    return '"[unknown]"';
  }
  return o(e, 0);
}
function ve(e, n = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, d) {
    if (d > n) return !1;
    if (s == null || typeof s != "object") return !0;
    const u = s;
    if (o.has(u)) return !0;
    if ((o.add(u), Array.isArray(u))) {
      for (const h of u) if (!i(h, d + 1)) return o.delete(u), !1;
      return o.delete(u), !0;
    }
    for (const h of Object.keys(u))
      if (a.has(h) || !i(u[h], d + 1)) return o.delete(u), !1;
    return o.delete(u), !0;
  }
  return i(e, 0);
}
function kt(e) {
  let n = lt(e),
    a = 5381;
  for (let o = 0; o < n.length; o++) a = ((a << 5) + a) ^ n.charCodeAt(o);
  return (a >>> 0).toString(16);
}
function Rt(e, n) {
  if (n) return n(e);
  const { type: a, ...o } = e,
    i = lt(o);
  return `${a}:${i}`;
}
function At(e, n, a) {
  return { requirement: e, id: Rt(e, a), fromConstraint: n };
}
var Me = class at {
    map = new Map();
    add(n) {
      this.map.has(n.id) || this.map.set(n.id, n);
    }
    remove(n) {
      return this.map.delete(n);
    }
    has(n) {
      return this.map.has(n);
    }
    get(n) {
      return this.map.get(n);
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
      const n = new at();
      for (const a of this.map.values()) n.add(a);
      return n;
    }
    diff(n) {
      const a = [],
        o = [],
        i = [];
      for (const s of this.map.values()) n.has(s.id) ? i.push(s) : a.push(s);
      for (const s of n.map.values()) this.map.has(s.id) || o.push(s);
      return { added: a, removed: o, unchanged: i };
    }
  },
  Ot = 5e3;
function Dt(e) {
  let {
      definitions: n,
      facts: a,
      requirementKeys: o = {},
      defaultTimeout: i = Ot,
      onEvaluate: s,
      onError: d,
    } = e,
    u = new Map(),
    h = new Set(),
    f = new Set(),
    c = new Map(),
    $ = new Map(),
    q = new Set(),
    D = new Map(),
    j = new Map(),
    O = !1,
    b = new Set(),
    R = new Set(),
    L = new Map(),
    T = [],
    m = new Map();
  function E() {
    for (const [t, r] of Object.entries(n))
      if (r.after)
        for (const l of r.after)
          n[l] && (L.has(l) || L.set(l, new Set()), L.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      r = new Set(),
      l = [];
    function g(x, M) {
      if (t.has(x)) return;
      if (r.has(x)) {
        const W = M.indexOf(x),
          _ = [...M.slice(W), x].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${_}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      r.add(x), M.push(x);
      const F = n[x];
      if (F?.after) for (const W of F.after) n[W] && g(W, M);
      M.pop(), r.delete(x), t.add(x), l.push(x);
    }
    for (const x of Object.keys(n)) g(x, []);
    (T = l), (m = new Map(T.map((x, M) => [x, M])));
  }
  v(), E();
  function C(t, r) {
    return r.async !== void 0 ? r.async : !!f.has(t);
  }
  function A(t) {
    const r = n[t];
    if (!r) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const l = C(t, r);
    l && f.add(t);
    const g = {
      id: t,
      priority: r.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: r.after ?? [],
    };
    return u.set(t, g), g;
  }
  function z(t) {
    return u.get(t) ?? A(t);
  }
  function p(t, r) {
    const l = c.get(t) ?? new Set();
    for (const g of l) {
      const x = $.get(g);
      x?.delete(t), x && x.size === 0 && $.delete(g);
    }
    for (const g of r) $.has(g) || $.set(g, new Set()), $.get(g).add(t);
    c.set(t, r);
  }
  function w(t) {
    const r = n[t];
    if (!r) return !1;
    const l = z(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (r.deps) (g = r.when(a)), D.set(t, new Set(r.deps));
      else {
        const x = Ee(() => r.when(a));
        (g = x.value), D.set(t, x.deps);
      }
      return g instanceof Promise
        ? (f.add(t),
          (l.isAsync = !0),
          g
            .then(
              (x) => ((l.lastResult = x), (l.isEvaluating = !1), s?.(t, x), x),
            )
            .catch(
              (x) => (
                (l.error = x instanceof Error ? x : new Error(String(x))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                d?.(t, x),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), s?.(t, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        d?.(t, g),
        !1
      );
    }
  }
  async function S(t) {
    const r = n[t];
    if (!r) return !1;
    const l = z(t),
      g = r.timeout ?? i;
    if (((l.isEvaluating = !0), (l.error = null), r.deps?.length)) {
      const x = new Set(r.deps);
      p(t, x), D.set(t, x);
    }
    try {
      const x = r.when(a),
        M = await Se(x, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = M), (l.isEvaluating = !1), s?.(t, M), M;
    } catch (x) {
      return (
        (l.error = x instanceof Error ? x : new Error(String(x))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        d?.(t, x),
        !1
      );
    }
  }
  function I(t, r) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const r = n[t];
    if (!r) return { requirements: [], deps: new Set() };
    const l = r.require;
    if (typeof l == "function") {
      const { value: g, deps: x } = Ee(() => l(a));
      return { requirements: I(g), deps: x };
    }
    return { requirements: I(l), deps: new Set() };
  }
  function K(t, r) {
    if (r.size === 0) return;
    const l = c.get(t) ?? new Set();
    for (const g of r)
      l.add(g), $.has(g) || $.set(g, new Set()), $.get(g).add(t);
    c.set(t, l);
  }
  let P = null;
  function y() {
    return (
      P ||
        (P = Object.keys(n).sort((t, r) => {
          const l = z(t),
            g = z(r).priority - l.priority;
          if (g !== 0) return g;
          const x = m.get(t) ?? 0,
            M = m.get(r) ?? 0;
          return x - M;
        })),
      P
    );
  }
  for (const t of Object.keys(n)) A(t);
  function k(t) {
    const r = u.get(t);
    if (!r || r.after.length === 0) return !0;
    for (const l of r.after)
      if (n[l] && !h.has(l) && !R.has(l) && !b.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const r = new Me();
      R.clear();
      let l = y().filter((_) => !h.has(_)),
        g;
      if (!O || !t || t.size === 0) (g = l), (O = !0);
      else {
        const _ = new Set();
        for (const V of t) {
          const Y = $.get(V);
          if (Y) for (const te of Y) h.has(te) || _.add(te);
        }
        for (const V of q) h.has(V) || _.add(V);
        q.clear(), (g = [..._]);
        for (const V of l)
          if (!_.has(V)) {
            const Y = j.get(V);
            if (Y) for (const te of Y) r.add(te);
          }
      }
      function x(_, V) {
        if (h.has(_)) return;
        const Y = D.get(_);
        if (!V) {
          Y !== void 0 && p(_, Y), R.add(_), j.set(_, []);
          return;
        }
        R.delete(_);
        let te, Z;
        try {
          const X = N(_);
          (te = X.requirements), (Z = X.deps);
        } catch (X) {
          d?.(_, X), Y !== void 0 && p(_, Y), j.set(_, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const U of Z) X.add(U);
          p(_, X);
        } else K(_, Z);
        if (te.length > 0) {
          const X = o[_],
            U = te.map((J) => At(J, _, X));
          for (const J of U) r.add(J);
          j.set(_, U);
        } else j.set(_, []);
      }
      async function M(_) {
        const V = [],
          Y = [];
        for (const U of _)
          if (k(U)) Y.push(U);
          else {
            V.push(U);
            const J = j.get(U);
            if (J) for (const G of J) r.add(G);
          }
        if (Y.length === 0) return V;
        const te = [],
          Z = [];
        for (const U of Y) z(U).isAsync ? Z.push(U) : te.push(U);
        const X = [];
        for (const U of te) {
          const J = w(U);
          if (J instanceof Promise) {
            X.push({ id: U, promise: J });
            continue;
          }
          x(U, J);
        }
        if (X.length > 0) {
          const U = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of U) x(J, G);
        }
        if (Z.length > 0) {
          const U = await Promise.all(
            Z.map(async (J) => ({ id: J, active: await S(J) })),
          );
          for (const { id: J, active: G } of U) x(J, G);
        }
        return V;
      }
      let F = g,
        W = g.length + 1;
      while (F.length > 0 && W > 0) {
        const _ = F.length;
        if (((F = await M(F)), F.length === _)) break;
        W--;
      }
      return r.all();
    },
    getState(t) {
      return u.get(t);
    },
    getAllStates() {
      return [...u.values()];
    },
    disable(t) {
      h.add(t), (P = null), j.delete(t);
      const r = c.get(t);
      if (r) {
        for (const l of r) {
          const g = $.get(l);
          g && (g.delete(t), g.size === 0 && $.delete(l));
        }
        c.delete(t);
      }
      D.delete(t);
    },
    enable(t) {
      h.delete(t), (P = null), q.add(t);
    },
    invalidate(t) {
      const r = $.get(t);
      if (r) for (const l of r) q.add(l);
    },
    markResolved(t) {
      b.add(t);
      const r = u.get(t);
      r && (r.lastResolvedAt = Date.now());
      const l = L.get(t);
      if (l) for (const g of l) q.add(g);
    },
    isResolved(t) {
      return b.has(t);
    },
    registerDefinitions(t) {
      for (const [r, l] of Object.entries(t)) (n[r] = l), A(r), q.add(r);
      (P = null), v(), E();
    },
  };
}
function jt(e) {
  let {
      definitions: n,
      facts: a,
      onCompute: o,
      onInvalidate: i,
      onError: s,
    } = e,
    d = new Map(),
    u = new Map(),
    h = new Map(),
    f = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    q = new Set(),
    D = !1,
    j = 100,
    O;
  function b(v) {
    if (!n[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const C = {
      id: v,
      compute: () => L(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(v, C), C;
  }
  function R(v) {
    return d.get(v) ?? b(v);
  }
  function L(v) {
    const C = R(v),
      A = n[v];
    if (!A) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    C.isComputing = !0;
    try {
      const { value: z, deps: p } = Ee(() => A(a, O));
      return (
        (C.cachedValue = z), (C.isStale = !1), T(v, p), o?.(v, z, [...p]), z
      );
    } catch (z) {
      throw (s?.(v, z), z);
    } finally {
      C.isComputing = !1;
    }
  }
  function T(v, C) {
    const A = R(v),
      z = A.dependencies;
    for (const p of z)
      if (d.has(p)) {
        const w = f.get(p);
        w?.delete(v), w && w.size === 0 && f.delete(p);
      } else {
        const w = h.get(p);
        w?.delete(v), w && w.size === 0 && h.delete(p);
      }
    for (const p of C)
      n[p]
        ? (f.has(p) || f.set(p, new Set()), f.get(p).add(v))
        : (h.has(p) || h.set(p, new Set()), h.get(p).add(v));
    A.dependencies = C;
  }
  function m() {
    if (!($ > 0 || D)) {
      D = !0;
      try {
        let v = 0;
        while (q.size > 0) {
          if (++v > j) {
            const A = [...q];
            throw (
              (q.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${j} iterations. Remaining: ${A.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [...q];
          q.clear();
          for (const A of C) u.get(A)?.forEach((z) => z());
        }
      } finally {
        D = !1;
      }
    }
  }
  function E(v, C = new Set()) {
    if (C.has(v)) return;
    C.add(v);
    const A = d.get(v);
    if (!A || A.isStale) return;
    (A.isStale = !0), i?.(v), q.add(v);
    const z = f.get(v);
    if (z) for (const p of z) E(p, C);
  }
  return (
    (O = new Proxy(
      {},
      {
        get(v, C) {
          if (typeof C == "symbol" || c.has(C)) return;
          je(C);
          const A = R(C);
          return A.isStale && L(C), A.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const C = R(v);
        return C.isStale && L(v), C.cachedValue;
      },
      isStale(v) {
        return d.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const C = h.get(v);
        if (C) {
          $++;
          try {
            for (const A of C) E(A);
          } finally {
            $--, m();
          }
        }
      },
      invalidateMany(v) {
        $++;
        try {
          for (const C of v) {
            const A = h.get(C);
            if (A) for (const z of A) E(z);
          }
        } finally {
          $--, m();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const v of d.values())
            v.isStale || ((v.isStale = !0), q.add(v.id));
        } finally {
          $--, m();
        }
      },
      subscribe(v, C) {
        for (const A of v) {
          const z = A;
          u.has(z) || u.set(z, new Set()), u.get(z).add(C);
        }
        return () => {
          for (const A of v) {
            const z = A,
              p = u.get(z);
            p?.delete(C), p && p.size === 0 && u.delete(z);
          }
        };
      },
      getProxy() {
        return O;
      },
      getDependencies(v) {
        return R(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [C, A] of Object.entries(v)) (n[C] = A), b(C);
      },
    }
  );
}
function Mt(e) {
  let { definitions: n, facts: a, store: o, onRun: i, onError: s } = e,
    d = new Map(),
    u = null,
    h = !1;
  function f(b) {
    const R = n[b];
    if (!R) throw new Error(`[Directive] Unknown effect: ${b}`);
    const L = {
      id: b,
      enabled: !0,
      hasExplicitDeps: !!R.deps,
      dependencies: R.deps ? new Set(R.deps) : null,
      cleanup: null,
    };
    return d.set(b, L), L;
  }
  function c(b) {
    return d.get(b) ?? f(b);
  }
  function $() {
    return o.toObject();
  }
  function q(b, R) {
    const L = c(b);
    if (!L.enabled) return !1;
    if (L.dependencies) {
      for (const T of L.dependencies) if (R.has(T)) return !0;
      return !1;
    }
    return !0;
  }
  function D(b) {
    if (b.cleanup) {
      try {
        b.cleanup();
      } catch (R) {
        s?.(b.id, R),
          console.error(
            `[Directive] Effect "${b.id}" cleanup threw an error:`,
            R,
          );
      }
      b.cleanup = null;
    }
  }
  function j(b, R) {
    if (typeof R == "function")
      if (h)
        try {
          R();
        } catch (L) {
          s?.(b.id, L),
            console.error(
              `[Directive] Effect "${b.id}" cleanup threw an error:`,
              L,
            );
        }
      else b.cleanup = R;
  }
  async function O(b) {
    const R = c(b),
      L = n[b];
    if (!(!R.enabled || !L)) {
      D(R), i?.(b);
      try {
        if (R.hasExplicitDeps) {
          let T;
          if (
            (o.batch(() => {
              T = L.run(a, u);
            }),
            T instanceof Promise)
          ) {
            const m = await T;
            j(R, m);
          } else j(R, T);
        } else {
          let T = null,
            m,
            E = Ee(
              () => (
                o.batch(() => {
                  m = L.run(a, u);
                }),
                m
              ),
            );
          T = E.deps;
          let v = E.value;
          v instanceof Promise && (v = await v),
            j(R, v),
            (R.dependencies = T.size > 0 ? T : null);
        }
      } catch (T) {
        s?.(b, T),
          console.error(`[Directive] Effect "${b}" threw an error:`, T);
      }
    }
  }
  for (const b of Object.keys(n)) f(b);
  return {
    async runEffects(b) {
      const R = [];
      for (const L of Object.keys(n)) q(L, b) && R.push(L);
      await Promise.all(R.map(O)), (u = $());
    },
    async runAll() {
      const b = Object.keys(n);
      await Promise.all(
        b.map((R) => (c(R).enabled ? O(R) : Promise.resolve())),
      ),
        (u = $());
    },
    disable(b) {
      const R = c(b);
      R.enabled = !1;
    },
    enable(b) {
      const R = c(b);
      R.enabled = !0;
    },
    isEnabled(b) {
      return c(b).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const b of d.values()) D(b);
    },
    registerDefinitions(b) {
      for (const [R, L] of Object.entries(b)) (n[R] = L), f(R);
    },
  };
}
function It(e = {}) {
  const {
      delayMs: n = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: o = 2,
      maxDelayMs: i = 3e4,
    } = e,
    s = new Map();
  function d(u) {
    const h = n * Math.pow(o, u - 1);
    return Math.min(h, i);
  }
  return {
    scheduleRetry(u, h, f, c, $) {
      if (c > a) return null;
      const q = d(c),
        D = {
          source: u,
          sourceId: h,
          context: f,
          attempt: c,
          nextRetryTime: Date.now() + q,
          callback: $,
        };
      return s.set(h, D), D;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const u = Date.now(),
        h = [];
      for (const [f, c] of s) c.nextRetryTime <= u && (h.push(c), s.delete(f));
      return h;
    },
    cancelRetry(u) {
      s.delete(u);
    },
    clearAll() {
      s.clear();
    },
  };
}
var qt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Tt(e = {}) {
  const { config: n = {}, onError: a, onRecovery: o } = e,
    i = [],
    s = 100,
    d = It(n.retryLater),
    u = new Map();
  function h(c, $, q, D) {
    if (q instanceof Pe) return q;
    const j = q instanceof Error ? q.message : String(q),
      O = c !== "system";
    return new Pe(j, c, $, D, O);
  }
  function f(c, $, q) {
    const D = (() => {
      switch (c) {
        case "constraint":
          return n.onConstraintError;
        case "resolver":
          return n.onResolverError;
        case "effect":
          return n.onEffectError;
        case "derivation":
          return n.onDerivationError;
        default:
          return;
      }
    })();
    if (typeof D == "function") {
      try {
        D(q, $);
      } catch (j) {
        console.error("[Directive] Error in error handler callback:", j);
      }
      return "skip";
    }
    return typeof D == "string" ? D : qt[c];
  }
  return {
    handleError(c, $, q, D) {
      const j = h(c, $, q, D);
      i.push(j), i.length > s && i.shift();
      try {
        a?.(j);
      } catch (b) {
        console.error("[Directive] Error in onError callback:", b);
      }
      try {
        n.onError?.(j);
      } catch (b) {
        console.error("[Directive] Error in config.onError callback:", b);
      }
      let O = f(c, $, q instanceof Error ? q : new Error(String(q)));
      if (O === "retry-later") {
        const b = (u.get($) ?? 0) + 1;
        u.set($, b),
          d.scheduleRetry(c, $, D, b) ||
            ((O = "skip"), u.delete($), typeof process < "u");
      }
      try {
        o?.(j, O);
      } catch (b) {
        console.error("[Directive] Error in onRecovery callback:", b);
      }
      if (O === "throw") throw j;
      return O;
    },
    getLastError() {
      return i[i.length - 1] ?? null;
    },
    getAllErrors() {
      return [...i];
    },
    clearErrors() {
      i.length = 0;
    },
    getRetryLaterManager() {
      return d;
    },
    processDueRetries() {
      return d.processDueRetries();
    },
    clearRetryAttempts(c) {
      u.delete(c), d.cancelRetry(c);
    },
  };
}
function Bt() {
  const e = [];
  function n(o) {
    if (o)
      try {
        return o();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  async function a(o) {
    if (o)
      try {
        return await o();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  return {
    register(o) {
      e.some((i) => i.name === o.name) &&
        (console.warn(
          `[Directive] Plugin "${o.name}" is already registered, replacing...`,
        ),
        this.unregister(o.name)),
        e.push(o);
    },
    unregister(o) {
      const i = e.findIndex((s) => s.name === o);
      i !== -1 && e.splice(i, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(o) {
      for (const i of e) await a(() => i.onInit?.(o));
    },
    emitStart(o) {
      for (const i of e) n(() => i.onStart?.(o));
    },
    emitStop(o) {
      for (const i of e) n(() => i.onStop?.(o));
    },
    emitDestroy(o) {
      for (const i of e) n(() => i.onDestroy?.(o));
    },
    emitFactSet(o, i, s) {
      for (const d of e) n(() => d.onFactSet?.(o, i, s));
    },
    emitFactDelete(o, i) {
      for (const s of e) n(() => s.onFactDelete?.(o, i));
    },
    emitFactsBatch(o) {
      for (const i of e) n(() => i.onFactsBatch?.(o));
    },
    emitDerivationCompute(o, i, s) {
      for (const d of e) n(() => d.onDerivationCompute?.(o, i, s));
    },
    emitDerivationInvalidate(o) {
      for (const i of e) n(() => i.onDerivationInvalidate?.(o));
    },
    emitReconcileStart(o) {
      for (const i of e) n(() => i.onReconcileStart?.(o));
    },
    emitReconcileEnd(o) {
      for (const i of e) n(() => i.onReconcileEnd?.(o));
    },
    emitConstraintEvaluate(o, i) {
      for (const s of e) n(() => s.onConstraintEvaluate?.(o, i));
    },
    emitConstraintError(o, i) {
      for (const s of e) n(() => s.onConstraintError?.(o, i));
    },
    emitRequirementCreated(o) {
      for (const i of e) n(() => i.onRequirementCreated?.(o));
    },
    emitRequirementMet(o, i) {
      for (const s of e) n(() => s.onRequirementMet?.(o, i));
    },
    emitRequirementCanceled(o) {
      for (const i of e) n(() => i.onRequirementCanceled?.(o));
    },
    emitResolverStart(o, i) {
      for (const s of e) n(() => s.onResolverStart?.(o, i));
    },
    emitResolverComplete(o, i, s) {
      for (const d of e) n(() => d.onResolverComplete?.(o, i, s));
    },
    emitResolverError(o, i, s) {
      for (const d of e) n(() => d.onResolverError?.(o, i, s));
    },
    emitResolverRetry(o, i, s) {
      for (const d of e) n(() => d.onResolverRetry?.(o, i, s));
    },
    emitResolverCancel(o, i) {
      for (const s of e) n(() => s.onResolverCancel?.(o, i));
    },
    emitEffectRun(o) {
      for (const i of e) n(() => i.onEffectRun?.(o));
    },
    emitEffectError(o, i) {
      for (const s of e) n(() => s.onEffectError?.(o, i));
    },
    emitSnapshot(o) {
      for (const i of e) n(() => i.onSnapshot?.(o));
    },
    emitTimeTravel(o, i) {
      for (const s of e) n(() => s.onTimeTravel?.(o, i));
    },
    emitError(o) {
      for (const i of e) n(() => i.onError?.(o));
    },
    emitErrorRecovery(o, i) {
      for (const s of e) n(() => s.onErrorRecovery?.(o, i));
    },
  };
}
var Ne = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  We = { enabled: !1, windowMs: 50 };
function Ke(e, n) {
  let { backoff: a, initialDelay: o = 100, maxDelay: i = 3e4 } = e,
    s;
  switch (a) {
    case "none":
      s = o;
      break;
    case "linear":
      s = o * n;
      break;
    case "exponential":
      s = o * Math.pow(2, n - 1);
      break;
    default:
      s = o;
  }
  return Math.max(1, Math.min(s, i));
}
function _t(e) {
  const {
      definitions: n,
      facts: a,
      store: o,
      onStart: i,
      onComplete: s,
      onError: d,
      onRetry: u,
      onCancel: h,
      onResolutionComplete: f,
    } = e,
    c = new Map(),
    $ = new Map(),
    q = 1e3,
    D = new Map(),
    j = new Map(),
    O = 1e3;
  function b() {
    if ($.size > q) {
      const p = $.size - q,
        w = $.keys();
      for (let S = 0; S < p; S++) {
        const I = w.next().value;
        I && $.delete(I);
      }
    }
  }
  function R(p) {
    return (
      typeof p == "object" &&
      p !== null &&
      "requirement" in p &&
      typeof p.requirement == "string"
    );
  }
  function L(p) {
    return (
      typeof p == "object" &&
      p !== null &&
      "requirement" in p &&
      typeof p.requirement == "function"
    );
  }
  function T(p, w) {
    return R(p) ? w.type === p.requirement : L(p) ? p.requirement(w) : !1;
  }
  function m(p) {
    const w = p.type,
      S = j.get(w);
    if (S)
      for (const I of S) {
        const N = n[I];
        if (N && T(N, p)) return I;
      }
    for (const [I, N] of Object.entries(n))
      if (T(N, p)) {
        if (!j.has(w)) {
          if (j.size >= O) {
            const P = j.keys().next().value;
            P !== void 0 && j.delete(P);
          }
          j.set(w, []);
        }
        const K = j.get(w);
        return K.includes(I) || K.push(I), I;
      }
    return null;
  }
  function E(p) {
    return { facts: a, signal: p, snapshot: () => a.$snapshot() };
  }
  async function v(p, w, S) {
    const I = n[p];
    if (!I) return;
    let N = { ...Ne, ...I.retry },
      K = null;
    for (let P = 1; P <= N.attempts; P++) {
      if (S.signal.aborted) return;
      const y = c.get(w.id);
      y &&
        ((y.attempt = P),
        (y.status = {
          state: "running",
          requirementId: w.id,
          startedAt: y.startedAt,
          attempt: P,
        }));
      try {
        const k = E(S.signal);
        if (I.resolve) {
          let r;
          o.batch(() => {
            r = I.resolve(w.requirement, k);
          });
          const l = I.timeout;
          l && l > 0
            ? await Se(r, l, `Resolver "${p}" timed out after ${l}ms`)
            : await r;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        $.set(w.id, {
          state: "success",
          requirementId: w.id,
          completedAt: Date.now(),
          duration: t,
        }),
          b(),
          s?.(p, w, t);
        return;
      } catch (k) {
        if (
          ((K = k instanceof Error ? k : new Error(String(k))),
          S.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(K, P)) break;
        if (P < N.attempts) {
          if (S.signal.aborted) return;
          const t = Ke(N, P);
          if (
            (u?.(p, w, P + 1),
            await new Promise((r) => {
              const l = setTimeout(r, t),
                g = () => {
                  clearTimeout(l), r();
                };
              S.signal.addEventListener("abort", g, { once: !0 });
            }),
            S.signal.aborted)
          )
            return;
        }
      }
    }
    $.set(w.id, {
      state: "error",
      requirementId: w.id,
      error: K,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      b(),
      d?.(p, w, K);
  }
  async function C(p, w) {
    const S = n[p];
    if (!S) return;
    if (!S.resolveBatch && !S.resolveBatchWithResults) {
      await Promise.all(
        w.map((t) => {
          const r = new AbortController();
          return v(p, t, r);
        }),
      );
      return;
    }
    let I = { ...Ne, ...S.retry },
      N = { ...We, ...S.batch },
      K = new AbortController(),
      P = Date.now(),
      y = null,
      k = N.timeoutMs ?? S.timeout;
    for (let t = 1; t <= I.attempts; t++) {
      if (K.signal.aborted) return;
      try {
        const r = E(K.signal),
          l = w.map((g) => g.requirement);
        if (S.resolveBatchWithResults) {
          let g, x;
          if (
            (o.batch(() => {
              x = S.resolveBatchWithResults(l, r);
            }),
            k && k > 0
              ? (g = await Se(
                  x,
                  k,
                  `Batch resolver "${p}" timed out after ${k}ms`,
                ))
              : (g = await x),
            g.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${p}" returned ${g.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let M = Date.now() - P,
            F = !1;
          for (let W = 0; W < w.length; W++) {
            const _ = w[W],
              V = g[W];
            if (V.success)
              $.set(_.id, {
                state: "success",
                requirementId: _.id,
                completedAt: Date.now(),
                duration: M,
              }),
                s?.(p, _, M);
            else {
              F = !0;
              const Y = V.error ?? new Error("Batch item failed");
              $.set(_.id, {
                state: "error",
                requirementId: _.id,
                error: Y,
                failedAt: Date.now(),
                attempts: t,
              }),
                d?.(p, _, Y);
            }
          }
          if (!F || w.some((W, _) => g[_]?.success)) return;
        } else {
          let g;
          o.batch(() => {
            g = S.resolveBatch(l, r);
          }),
            k && k > 0
              ? await Se(g, k, `Batch resolver "${p}" timed out after ${k}ms`)
              : await g;
          const x = Date.now() - P;
          for (const M of w)
            $.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: x,
            }),
              s?.(p, M, x);
          return;
        }
      } catch (r) {
        if (
          ((y = r instanceof Error ? r : new Error(String(r))),
          K.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, t)) break;
        if (t < I.attempts) {
          const l = Ke(I, t);
          for (const g of w) u?.(p, g, t + 1);
          if (
            (await new Promise((g) => {
              const x = setTimeout(g, l),
                M = () => {
                  clearTimeout(x), g();
                };
              K.signal.addEventListener("abort", M, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of w)
      $.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        d?.(p, t, y);
    b();
  }
  function A(p, w) {
    const S = n[p];
    if (!S) return;
    const I = { ...We, ...S.batch };
    D.has(p) || D.set(p, { resolverId: p, requirements: [], timer: null });
    const N = D.get(p);
    N.requirements.push(w),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        z(p);
      }, I.windowMs));
  }
  function z(p) {
    const w = D.get(p);
    if (!w || w.requirements.length === 0) return;
    const S = [...w.requirements];
    (w.requirements = []),
      (w.timer = null),
      C(p, S).then(() => {
        f?.();
      });
  }
  return {
    resolve(p) {
      if (c.has(p.id)) return;
      const w = m(p.requirement);
      if (!w) {
        console.warn(`[Directive] No resolver found for requirement: ${p.id}`);
        return;
      }
      const S = n[w];
      if (!S) return;
      if (S.batch?.enabled) {
        A(w, p);
        return;
      }
      const I = new AbortController(),
        N = Date.now(),
        K = {
          requirementId: p.id,
          resolverId: w,
          controller: I,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: p.id, startedAt: N },
          originalRequirement: p,
        };
      c.set(p.id, K),
        i?.(w, p),
        v(w, p, I).finally(() => {
          c.delete(p.id) && f?.();
        });
    },
    cancel(p) {
      const w = c.get(p);
      w &&
        (w.controller.abort(),
        c.delete(p),
        $.set(p, {
          state: "canceled",
          requirementId: p,
          canceledAt: Date.now(),
        }),
        b(),
        h?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [p] of c) this.cancel(p);
      for (const p of D.values()) p.timer && clearTimeout(p.timer);
      D.clear();
    },
    getStatus(p) {
      const w = c.get(p);
      return w ? w.status : $.get(p) || { state: "idle" };
    },
    getInflight() {
      return [...c.keys()];
    },
    getInflightInfo() {
      return [...c.values()].map((p) => ({
        id: p.requirementId,
        resolverId: p.resolverId,
        startedAt: p.startedAt,
      }));
    },
    isResolving(p) {
      return c.has(p);
    },
    processBatches() {
      for (const p of D.keys()) z(p);
    },
    registerDefinitions(p) {
      for (const [w, S] of Object.entries(p)) n[w] = S;
      j.clear();
    },
  };
}
function zt(e) {
  let { config: n, facts: a, store: o, onSnapshot: i, onTimeTravel: s } = e,
    d = n.timeTravel ?? !1,
    u = n.maxSnapshots ?? 100,
    h = [],
    f = -1,
    c = 1,
    $ = !1,
    q = !1,
    D = [],
    j = null,
    O = -1;
  function b() {
    return o.toObject();
  }
  function R() {
    const T = b();
    return structuredClone(T);
  }
  function L(T) {
    if (!ve(T)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    o.batch(() => {
      for (const [m, E] of Object.entries(T)) {
        if (m === "__proto__" || m === "constructor" || m === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${m}" during fact restoration`,
          );
          continue;
        }
        a[m] = E;
      }
    });
  }
  return {
    get isEnabled() {
      return d;
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
      return f;
    },
    takeSnapshot(T) {
      if (!d || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: T };
      const m = { id: c++, timestamp: Date.now(), facts: R(), trigger: T };
      for (
        f < h.length - 1 && h.splice(f + 1), h.push(m), f = h.length - 1;
        h.length > u;
      )
        h.shift(), f--;
      return i?.(m), m;
    },
    restore(T) {
      if (d) {
        ($ = !0), (q = !0);
        try {
          L(T.facts);
        } finally {
          ($ = !1), (q = !1);
        }
      }
    },
    goBack(T = 1) {
      if (!d || h.length === 0) return;
      let m = f,
        E = f,
        v = D.find((A) => f > A.startIndex && f <= A.endIndex);
      if (v) E = v.startIndex;
      else if (D.find((A) => f === A.startIndex)) {
        const A = D.find((z) => z.endIndex < f && f - z.endIndex <= T);
        E = A ? A.startIndex : Math.max(0, f - T);
      } else E = Math.max(0, f - T);
      if (m === E) return;
      f = E;
      const C = h[f];
      C && (this.restore(C), s?.(m, E));
    },
    goForward(T = 1) {
      if (!d || h.length === 0) return;
      let m = f,
        E = f,
        v = D.find((A) => f >= A.startIndex && f < A.endIndex);
      if ((v ? (E = v.endIndex) : (E = Math.min(h.length - 1, f + T)), m === E))
        return;
      f = E;
      const C = h[f];
      C && (this.restore(C), s?.(m, E));
    },
    goTo(T) {
      if (!d) return;
      const m = h.findIndex((C) => C.id === T);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${T} not found`);
        return;
      }
      const E = f;
      f = m;
      const v = h[f];
      v && (this.restore(v), s?.(E, m));
    },
    replay() {
      if (!d || h.length === 0) return;
      f = 0;
      const T = h[0];
      T && this.restore(T);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: f });
    },
    import(T) {
      if (d)
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
            if (!ve(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...m.snapshots), (f = m.currentIndex);
          const E = h[f];
          E && this.restore(E);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(T) {
      d && ((j = T), (O = f));
    },
    endChangeset() {
      !d ||
        j === null ||
        (f > O && D.push({ label: j, startIndex: O, endIndex: f }),
        (j = null),
        (O = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function Lt() {
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
var le = new Set(["__proto__", "constructor", "prototype"]);
function ct(e) {
  const n = Object.create(null),
    a = Object.create(null),
    o = Object.create(null),
    i = Object.create(null),
    s = Object.create(null),
    d = Object.create(null);
  for (const t of e.modules) {
    const r = (l, g) => {
      if (l) {
        for (const x of Object.keys(l))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${x}" in ${g}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    r(t.schema, "schema"),
      r(t.events, "events"),
      r(t.derive, "derive"),
      r(t.effects, "effects"),
      r(t.constraints, "constraints"),
      r(t.resolvers, "resolvers"),
      Object.assign(n, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && Object.assign(o, t.derive),
      t.effects && Object.assign(i, t.effects),
      t.constraints && Object.assign(s, t.constraints),
      t.resolvers && Object.assign(d, t.resolvers);
  }
  let u = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    u = new Set();
    for (const t of e.modules) {
      const r = t;
      if (r.snapshotEvents) for (const l of r.snapshotEvents) u.add(l);
      else if (r.events) for (const l of Object.keys(r.events)) u.add(l);
    }
  }
  let h = 0,
    f = !1,
    c = Bt();
  for (const t of e.plugins ?? []) c.register(t);
  let $ = Tt({
      config: e.errorBoundary,
      onError: (t) => c.emitError(t),
      onRecovery: (t, r) => c.emitErrorRecovery(t, r),
    }),
    q = () => {},
    D = () => {},
    j = null,
    { store: O, facts: b } = Ct({
      schema: n,
      onChange: (t, r, l) => {
        c.emitFactSet(t, r, l),
          q(t),
          !j?.isRestoring && (h === 0 && (f = !0), S.changedKeys.add(t), I());
      },
      onBatch: (t) => {
        c.emitFactsBatch(t);
        const r = [];
        for (const l of t) r.push(l.key);
        if ((D(r), !j?.isRestoring)) {
          h === 0 && (f = !0);
          for (const l of t) S.changedKeys.add(l.key);
          I();
        }
      },
    }),
    R = jt({
      definitions: o,
      facts: b,
      onCompute: (t, r, l) => c.emitDerivationCompute(t, r, l),
      onInvalidate: (t) => c.emitDerivationInvalidate(t),
      onError: (t, r) => {
        $.handleError("derivation", t, r);
      },
    });
  (q = (t) => R.invalidate(t)), (D = (t) => R.invalidateMany(t));
  const L = Mt({
      definitions: i,
      facts: b,
      store: O,
      onRun: (t) => c.emitEffectRun(t),
      onError: (t, r) => {
        $.handleError("effect", t, r), c.emitEffectError(t, r);
      },
    }),
    T = Dt({
      definitions: s,
      facts: b,
      onEvaluate: (t, r) => c.emitConstraintEvaluate(t, r),
      onError: (t, r) => {
        $.handleError("constraint", t, r), c.emitConstraintError(t, r);
      },
    }),
    m = _t({
      definitions: d,
      facts: b,
      store: O,
      onStart: (t, r) => c.emitResolverStart(t, r),
      onComplete: (t, r, l) => {
        c.emitResolverComplete(t, r, l),
          c.emitRequirementMet(r, t),
          T.markResolved(r.fromConstraint);
      },
      onError: (t, r, l) => {
        $.handleError("resolver", t, l, r), c.emitResolverError(t, r, l);
      },
      onRetry: (t, r, l) => c.emitResolverRetry(t, r, l),
      onCancel: (t, r) => {
        c.emitResolverCancel(t, r), c.emitRequirementCanceled(r);
      },
      onResolutionComplete: () => {
        z(), I();
      },
    }),
    E = new Set();
  function v() {
    for (const t of E) t();
  }
  const C = e.debug?.timeTravel
    ? zt({
        config: e.debug,
        facts: b,
        store: O,
        onSnapshot: (t) => {
          c.emitSnapshot(t), v();
        },
        onTimeTravel: (t, r) => {
          c.emitTimeTravel(t, r), v();
        },
      })
    : Lt();
  j = C;
  const A = new Set();
  function z() {
    for (const t of A) t();
  }
  let p = 50,
    w = 0,
    S = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Me(),
      readyPromise: null,
      readyResolve: null,
    };
  function I() {
    !S.isRunning ||
      S.reconcileScheduled ||
      S.isInitializing ||
      ((S.reconcileScheduled = !0),
      z(),
      queueMicrotask(() => {
        (S.reconcileScheduled = !1),
          S.isRunning && !S.isInitializing && N().catch((t) => {});
      }));
  }
  async function N() {
    if (!S.isReconciling) {
      if ((w++, w > p)) {
        w = 0;
        return;
      }
      (S.isReconciling = !0), z();
      try {
        S.changedKeys.size > 0 &&
          ((u === null || f) &&
            C.takeSnapshot(`facts-changed:${[...S.changedKeys].join(",")}`),
          (f = !1));
        const t = b.$snapshot();
        c.emitReconcileStart(t), await L.runEffects(S.changedKeys);
        const r = new Set(S.changedKeys);
        S.changedKeys.clear();
        const l = await T.evaluate(r),
          g = new Me();
        for (const _ of l) g.add(_), c.emitRequirementCreated(_);
        const { added: x, removed: M } = g.diff(S.previousRequirements);
        for (const _ of M) m.cancel(_.id);
        for (const _ of x) m.resolve(_);
        S.previousRequirements = g;
        const F = m.getInflightInfo(),
          W = {
            unmet: l.filter((_) => !m.isResolving(_.id)),
            inflight: F,
            completed: [],
            canceled: M.map((_) => ({
              id: _.id,
              resolverId: F.find((V) => V.id === _.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(W),
          S.isReady ||
            ((S.isReady = !0),
            S.readyResolve && (S.readyResolve(), (S.readyResolve = null)));
      } finally {
        (S.isReconciling = !1),
          S.changedKeys.size > 0 ? I() : S.reconcileScheduled || (w = 0),
          z();
      }
    }
  }
  const K = new Proxy(
      {},
      {
        get(t, r) {
          if (typeof r != "symbol" && !le.has(r)) return R.get(r);
        },
        has(t, r) {
          return typeof r == "symbol" || le.has(r) ? !1 : r in o;
        },
        ownKeys() {
          return Object.keys(o);
        },
        getOwnPropertyDescriptor(t, r) {
          if (typeof r != "symbol" && !le.has(r) && r in o)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    P = new Proxy(
      {},
      {
        get(t, r) {
          if (typeof r != "symbol" && !le.has(r))
            return (l) => {
              const g = a[r];
              if (g) {
                h++, (u === null || u.has(r)) && (f = !0);
                try {
                  O.batch(() => {
                    g(b, { type: r, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(t, r) {
          return typeof r == "symbol" || le.has(r) ? !1 : r in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(t, r) {
          if (typeof r != "symbol" && !le.has(r) && r in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: b,
      debug: C.isEnabled ? C : null,
      derive: K,
      events: P,
      constraints: { disable: (t) => T.disable(t), enable: (t) => T.enable(t) },
      effects: {
        disable: (t) => L.disable(t),
        enable: (t) => L.enable(t),
        isEnabled: (t) => L.isEnabled(t),
      },
      initialize() {
        if (!S.isInitialized) {
          S.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              O.batch(() => {
                t.init(b);
              });
          e.onAfterModuleInit &&
            O.batch(() => {
              e.onAfterModuleInit();
            }),
            (S.isInitializing = !1),
            (S.isInitialized = !0);
          for (const t of Object.keys(o)) R.get(t);
        }
      },
      start() {
        if (!S.isRunning) {
          S.isInitialized || this.initialize(), (S.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(y);
          c.emitStart(y), I();
        }
      },
      stop() {
        if (S.isRunning) {
          (S.isRunning = !1), m.cancelAll(), L.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
          c.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (S.isDestroyed = !0),
          A.clear(),
          E.clear(),
          c.emitDestroy(y);
      },
      dispatch(t) {
        if (le.has(t.type)) return;
        const r = a[t.type];
        if (r) {
          h++, (u === null || u.has(t.type)) && (f = !0);
          try {
            O.batch(() => {
              r(b, t);
            });
          } finally {
            h--;
          }
        }
      },
      read(t) {
        return R.get(t);
      },
      subscribe(t, r) {
        const l = [],
          g = [];
        for (const M of t) M in o ? l.push(M) : M in n && g.push(M);
        const x = [];
        return (
          l.length > 0 && x.push(R.subscribe(l, r)),
          g.length > 0 && x.push(O.subscribe(g, r)),
          () => {
            for (const M of x) M();
          }
        );
      },
      watch(t, r, l) {
        const g = l?.equalityFn
          ? (M, F) => l.equalityFn(M, F)
          : (M, F) => Object.is(M, F);
        if (t in o) {
          let M = R.get(t);
          return R.subscribe([t], () => {
            const F = R.get(t);
            if (!g(F, M)) {
              const W = M;
              (M = F), r(F, W);
            }
          });
        }
        let x = O.get(t);
        return O.subscribe([t], () => {
          const M = O.get(t);
          if (!g(M, x)) {
            const F = x;
            (x = M), r(M, F);
          }
        });
      },
      when(t, r) {
        return new Promise((l, g) => {
          const x = O.toObject();
          if (t(x)) {
            l();
            return;
          }
          let M,
            F,
            W = () => {
              M?.(), F !== void 0 && clearTimeout(F);
            };
          (M = O.subscribeAll(() => {
            const _ = O.toObject();
            t(_) && (W(), l());
          })),
            r?.timeout !== void 0 &&
              r.timeout > 0 &&
              (F = setTimeout(() => {
                W(),
                  g(
                    new Error(
                      `[Directive] when: timed out after ${r.timeout}ms`,
                    ),
                  );
              }, r.timeout));
        });
      },
      inspect() {
        return {
          unmet: S.previousRequirements.all(),
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
        const r = S.previousRequirements.all().find((V) => V.id === t);
        if (!r) return null;
        const l = T.getState(r.fromConstraint),
          g = m.getStatus(t),
          x = {},
          M = O.toObject();
        for (const [V, Y] of Object.entries(M)) x[V] = Y;
        const F = [
            `Requirement "${r.requirement.type}" (id: ${r.id})`,
            `├─ Produced by constraint: ${r.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(r.requirement)
            .filter(([V]) => V !== "type")
            .map(([V, Y]) => `${V}=${JSON.stringify(Y)}`)
            .join(", ");
        W && F.push(`├─ Requirement payload: { ${W} }`);
        const _ = Object.entries(x).slice(0, 10);
        return (
          _.length > 0 &&
            (F.push("└─ Relevant facts:"),
            _.forEach(([V, Y], te) => {
              const Z = te === _.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              F.push(
                `${Z} ${V} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          F.join(`
`)
        );
      },
      async settle(t = 5e3) {
        const r = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const l = this.inspect();
          if (
            l.inflight.length === 0 &&
            !S.isReconciling &&
            !S.reconcileScheduled
          )
            return;
          if (Date.now() - r > t) {
            const g = [];
            l.inflight.length > 0 &&
              g.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((M) => M.resolverId).join(", ")}`,
              ),
              S.isReconciling && g.push("reconciliation in progress"),
              S.reconcileScheduled && g.push("reconcile scheduled");
            const x = S.previousRequirements.all();
            throw (
              (x.length > 0 &&
                g.push(
                  `${x.length} unmet requirements: ${x.map((M) => M.requirement.type).join(", ")}`,
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
        return { facts: O.toObject(), version: 1 };
      },
      getDistributableSnapshot(t = {}) {
        let {
            includeDerivations: r,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: x,
            metadata: M,
            includeVersion: F,
          } = t,
          W = {},
          _ = Object.keys(o),
          V;
        if ((r ? (V = r.filter((Z) => _.includes(Z))) : (V = _), l)) {
          const Z = new Set(l);
          V = V.filter((X) => !Z.has(X));
        }
        for (const Z of V)
          try {
            W[Z] = R.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = O.toObject();
          for (const X of g) X in Z && (W[X] = Z[X]);
        }
        const Y = Date.now(),
          te = { data: W, createdAt: Y };
        return (
          x !== void 0 && x > 0 && (te.expiresAt = Y + x * 1e3),
          F && (te.version = kt(W)),
          M && (te.metadata = M),
          te
        );
      },
      watchDistributableSnapshot(t, r) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          x = Object.keys(o),
          M;
        if ((l ? (M = l.filter((W) => x.includes(W))) : (M = x), g)) {
          const W = new Set(g);
          M = M.filter((_) => !W.has(_));
        }
        if (M.length === 0) return () => {};
        let F = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return R.subscribe(M, () => {
          const W = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          W.version !== F && ((F = W.version), r(W));
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
        if (!ve(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        O.batch(() => {
          for (const [r, l] of Object.entries(t.facts))
            le.has(r) || O.set(r, l);
        });
      },
      onSettledChange(t) {
        return (
          A.add(t),
          () => {
            A.delete(t);
          }
        );
      },
      onTimeTravelChange(t) {
        return (
          E.add(t),
          () => {
            E.delete(t);
          }
        );
      },
      batch(t) {
        O.batch(t);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !S.isReconciling &&
          !S.reconcileScheduled
        );
      },
      get isRunning() {
        return S.isRunning;
      },
      get isInitialized() {
        return S.isInitialized;
      },
      get isReady() {
        return S.isReady;
      },
      whenReady() {
        return S.isReady
          ? Promise.resolve()
          : S.isRunning
            ? (S.readyPromise ||
                (S.readyPromise = new Promise((t) => {
                  S.readyResolve = t;
                })),
              S.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function k(t) {
    if (S.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (S.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" on a destroyed system.`,
      );
    const r = (l, g) => {
      if (l) {
        for (const x of Object.keys(l))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${x}" in ${g}.`,
            );
      }
    };
    r(t.schema, "schema"),
      r(t.events, "events"),
      r(t.derive, "derive"),
      r(t.effects, "effects"),
      r(t.constraints, "constraints"),
      r(t.resolvers, "resolvers");
    for (const l of Object.keys(t.schema))
      if (l in n)
        throw new Error(
          `[Directive] Schema collision: Fact "${l}" already exists. Cannot register module "${t.id}".`,
        );
    if (t.snapshotEvents) {
      u === null && (u = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) u.add(l);
    } else if (u !== null && t.events)
      for (const l of Object.keys(t.events)) u.add(l);
    Object.assign(n, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(o, t.derive), R.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(i, t.effects), L.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(s, t.constraints), T.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(d, t.resolvers), m.registerDefinitions(t.resolvers)),
      O.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        O.batch(() => {
          t.init(b);
        }),
      t.hooks?.onInit?.(y),
      S.isRunning && (t.hooks?.onStart?.(y), I());
  }
  (y.registerModule = k), c.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var re = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Pt(e) {
  const n = Object.keys(e),
    a = new Set(),
    o = new Set(),
    i = [],
    s = [];
  function d(u) {
    if (a.has(u)) return;
    if (o.has(u)) {
      const f = s.indexOf(u),
        c = [...s.slice(f), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    o.add(u), s.push(u);
    const h = e[u];
    if (h?.crossModuleDeps)
      for (const f of Object.keys(h.crossModuleDeps)) n.includes(f) && d(f);
    s.pop(), o.delete(u), a.add(u), i.push(u);
  }
  for (const u of n) d(u);
  return i;
}
var He = new WeakMap(),
  Ue = new WeakMap(),
  Ve = new WeakMap(),
  Je = new WeakMap();
function Ft(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Ht(e);
  }
  const n = e;
  if (Array.isArray(n.modules))
    throw new Error(`[Directive] createSystem expects modules as an object, not an array.

Instead of:
  createSystem({ modules: [authModule, dataModule] })

Use:
  createSystem({ modules: { auth: authModule, data: dataModule } })

Or for a single module:
  createSystem({ module: counterModule })`);
  return Nt(n);
}
function Nt(e) {
  const n = e.modules,
    a = new Set(Object.keys(n)),
    o = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      E = Object.keys(n).filter((v) => !m.includes(v));
    if (E.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${E.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = m;
  } else s === "declaration" ? (i = Object.keys(n)) : (i = Pt(n));
  let d = e.debug,
    u = e.errorBoundary;
  e.zeroConfig &&
    ((d = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (u = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const m of Object.keys(n)) {
    if (m.includes(H))
      throw new Error(
        `[Directive] Module name "${m}" contains the reserved separator "${H}". Module names cannot contain "${H}".`,
      );
    const E = n[m];
    if (E) {
      for (const v of Object.keys(E.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const h = [];
  for (const m of i) {
    const E = n[m];
    if (!E) continue;
    const v = E.crossModuleDeps && Object.keys(E.crossModuleDeps).length > 0,
      C = v ? Object.keys(E.crossModuleDeps) : [],
      A = {};
    for (const [y, k] of Object.entries(E.schema.facts)) A[`${m}${H}${y}`] = k;
    const z = {};
    if (E.schema.derivations)
      for (const [y, k] of Object.entries(E.schema.derivations))
        z[`${m}${H}${y}`] = k;
    const p = {};
    if (E.schema.events)
      for (const [y, k] of Object.entries(E.schema.events))
        p[`${m}${H}${y}`] = k;
    const w = E.init
        ? (y) => {
            const k = ne(y, m);
            E.init(k);
          }
        : void 0,
      S = {};
    if (E.derive)
      for (const [y, k] of Object.entries(E.derive))
        S[`${m}${H}${y}`] = (t, r) => {
          const l = v ? ae(t, m, C) : ne(t, m),
            g = Ie(r, m);
          return k(l, g);
        };
    const I = {};
    if (E.events)
      for (const [y, k] of Object.entries(E.events))
        I[`${m}${H}${y}`] = (t, r) => {
          const l = ne(t, m);
          k(l, r);
        };
    const N = {};
    if (E.constraints)
      for (const [y, k] of Object.entries(E.constraints)) {
        const t = k;
        N[`${m}${H}${y}`] = {
          ...t,
          deps: t.deps?.map((r) => `${m}${H}${r}`),
          when: (r) => {
            const l = v ? ae(r, m, C) : ne(r, m);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (r) => {
                  const l = v ? ae(r, m, C) : ne(r, m);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const K = {};
    if (E.resolvers)
      for (const [y, k] of Object.entries(E.resolvers)) {
        const t = k;
        K[`${m}${H}${y}`] = {
          ...t,
          resolve: async (r, l) => {
            const g = Re(l.facts, n, () => Object.keys(n));
            await t.resolve(r, { facts: g[m], signal: l.signal });
          },
        };
      }
    const P = {};
    if (E.effects)
      for (const [y, k] of Object.entries(E.effects)) {
        const t = k;
        P[`${m}${H}${y}`] = {
          ...t,
          run: (r, l) => {
            const g = v ? ae(r, m, C) : ne(r, m),
              x = l ? (v ? ae(l, m, C) : ne(l, m)) : void 0;
            return t.run(g, x);
          },
          deps: t.deps?.map((r) => `${m}${H}${r}`),
        };
      }
    h.push({
      id: E.id,
      schema: {
        facts: A,
        derivations: z,
        events: p,
        requirements: E.schema.requirements ?? {},
      },
      init: w,
      derive: S,
      events: I,
      effects: P,
      constraints: N,
      resolvers: K,
      hooks: E.hooks,
      snapshotEvents:
        o && !o.has(m) ? [] : E.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let f = null,
    c = null;
  function $(m) {
    for (const [E, v] of Object.entries(m))
      if (!re.has(E) && a.has(E)) {
        if (v && typeof v == "object" && !ve(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${E}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, A] of Object.entries(v))
          re.has(C) || (c.facts[`${E}${H}${C}`] = A);
      }
  }
  c = ct({
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
    debug: d,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), f && ($(f), (f = null));
    },
  });
  const q = new Map();
  for (const m of Object.keys(n)) {
    const E = n[m];
    if (!E) continue;
    const v = [];
    for (const C of Object.keys(E.schema.facts)) v.push(`${m}${H}${C}`);
    if (E.schema.derivations)
      for (const C of Object.keys(E.schema.derivations)) v.push(`${m}${H}${C}`);
    q.set(m, v);
  }
  const D = { names: null };
  function j() {
    return D.names === null && (D.names = Object.keys(n)), D.names;
  }
  let O = Re(c.facts, n, j),
    b = Wt(c.derive, n, j),
    R = Kt(c, n, j),
    L = null,
    T = e.tickMs;
  return {
    _mode: "namespaced",
    facts: O,
    debug: c.debug,
    derive: b,
    events: R,
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
      const E = await m();
      E && typeof E == "object" && (f = E);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), T && T > 0)) {
        const m = Object.keys(h[0]?.events ?? {}).find((E) =>
          E.endsWith(`${H}tick`),
        );
        m &&
          (L = setInterval(() => {
            c.dispatch({ type: m });
          }, T));
      }
    },
    stop() {
      L && (clearInterval(L), (L = null)), c.stop();
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
    subscribe(m, E) {
      const v = [];
      for (const C of m)
        if (C.endsWith(".*")) {
          const A = C.slice(0, -2),
            z = q.get(A);
          z && v.push(...z);
        } else v.push(ce(C));
      return c.subscribe(v, E);
    },
    subscribeModule(m, E) {
      const v = q.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, E);
    },
    watch(m, E, v) {
      return c.watch(ce(m), E, v);
    },
    when(m, E) {
      return c.when(() => m(O), E);
    },
    onSettledChange: c.onSettledChange.bind(c),
    onTimeTravelChange: c.onTimeTravelChange.bind(c),
    inspect: c.inspect.bind(c),
    settle: c.settle.bind(c),
    explain: c.explain.bind(c),
    getSnapshot: c.getSnapshot.bind(c),
    restore: c.restore.bind(c),
    getDistributableSnapshot(m) {
      const E = {
          ...m,
          includeDerivations: m?.includeDerivations?.map(ce),
          excludeDerivations: m?.excludeDerivations?.map(ce),
          includeFacts: m?.includeFacts?.map(ce),
        },
        v = c.getDistributableSnapshot(E),
        C = {};
      for (const [A, z] of Object.entries(v.data)) {
        const p = A.indexOf(H);
        if (p > 0) {
          const w = A.slice(0, p),
            S = A.slice(p + H.length);
          C[w] || (C[w] = {}), (C[w][S] = z);
        } else C._root || (C._root = {}), (C._root[A] = z);
      }
      return { ...v, data: C };
    },
    watchDistributableSnapshot(m, E) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ce),
        excludeDerivations: m?.excludeDerivations?.map(ce),
        includeFacts: m?.includeFacts?.map(ce),
      };
      return c.watchDistributableSnapshot(v, (C) => {
        const A = {};
        for (const [z, p] of Object.entries(C.data)) {
          const w = z.indexOf(H);
          if (w > 0) {
            const S = z.slice(0, w),
              I = z.slice(w + H.length);
            A[S] || (A[S] = {}), (A[S][I] = p);
          } else A._root || (A._root = {}), (A._root[z] = p);
        }
        E({ ...C, data: A });
      });
    },
    registerModule(m, E) {
      if (a.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(H))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${H}".`,
        );
      if (re.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys(E.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${H}".`,
          );
      const v = E,
        C = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        A = C ? Object.keys(v.crossModuleDeps) : [],
        z = {};
      for (const [y, k] of Object.entries(v.schema.facts))
        z[`${m}${H}${y}`] = k;
      const p = v.init
          ? (y) => {
              const k = ne(y, m);
              v.init(k);
            }
          : void 0,
        w = {};
      if (v.derive)
        for (const [y, k] of Object.entries(v.derive))
          w[`${m}${H}${y}`] = (t, r) => {
            const l = C ? ae(t, m, A) : ne(t, m),
              g = Ie(r, m);
            return k(l, g);
          };
      const S = {};
      if (v.events)
        for (const [y, k] of Object.entries(v.events))
          S[`${m}${H}${y}`] = (t, r) => {
            const l = ne(t, m);
            k(l, r);
          };
      const I = {};
      if (v.constraints)
        for (const [y, k] of Object.entries(v.constraints)) {
          const t = k;
          I[`${m}${H}${y}`] = {
            ...t,
            deps: t.deps?.map((r) => `${m}${H}${r}`),
            when: (r) => {
              const l = C ? ae(r, m, A) : ne(r, m);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (r) => {
                    const l = C ? ae(r, m, A) : ne(r, m);
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
            resolve: async (r, l) => {
              const g = Re(l.facts, n, j);
              await t.resolve(r, { facts: g[m], signal: l.signal });
            },
          };
        }
      const K = {};
      if (v.effects)
        for (const [y, k] of Object.entries(v.effects)) {
          const t = k;
          K[`${m}${H}${y}`] = {
            ...t,
            run: (r, l) => {
              const g = C ? ae(r, m, A) : ne(r, m),
                x = l ? (C ? ae(l, m, A) : ne(l, m)) : void 0;
              return t.run(g, x);
            },
            deps: t.deps?.map((r) => `${m}${H}${r}`),
          };
        }
      a.add(m), (n[m] = v), (D.names = null);
      const P = [];
      for (const y of Object.keys(v.schema.facts)) P.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          P.push(`${m}${H}${y}`);
      q.set(m, P),
        c.registerModule({
          id: v.id,
          schema: z,
          requirements: v.schema.requirements ?? {},
          init: p,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(S).length > 0 ? S : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            o && !o.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${H}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [n, ...a] = e.split(".");
    return `${n}${H}${a.join(H)}`;
  }
  return e;
}
function ne(e, n) {
  let a = He.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), He.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !re.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${n}${H}${s}`];
      },
      set(i, s, d) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : ((e[`${n}${H}${s}`] = d), !0);
      },
      has(i, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${n}${H}${s}` in e;
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : (delete e[`${n}${H}${s}`], !0);
      },
    },
  );
  return a.set(n, o), o;
}
function Re(e, n, a) {
  const o = Ue.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, d) {
        if (typeof d != "symbol" && !re.has(d) && Object.hasOwn(n, d))
          return ne(e, d);
      },
      has(s, d) {
        return typeof d == "symbol" || re.has(d) ? !1 : Object.hasOwn(n, d);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, d) {
        if (typeof d != "symbol" && Object.hasOwn(n, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ue.set(e, i), i;
}
var Ye = new WeakMap();
function ae(e, n, a) {
  let o = `${n}:${JSON.stringify([...a].sort())}`,
    i = Ye.get(e);
  if (i) {
    const h = i.get(o);
    if (h) return h;
  } else (i = new Map()), Ye.set(e, i);
  const s = new Set(a),
    d = ["self", ...a],
    u = new Proxy(
      {},
      {
        get(h, f) {
          if (typeof f != "symbol" && !re.has(f)) {
            if (f === "self") return ne(e, n);
            if (s.has(f)) return ne(e, f);
          }
        },
        has(h, f) {
          return typeof f == "symbol" || re.has(f)
            ? !1
            : f === "self" || s.has(f);
        },
        ownKeys() {
          return d;
        },
        getOwnPropertyDescriptor(h, f) {
          if (typeof f != "symbol" && (f === "self" || s.has(f)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(o, u), u;
}
function Ie(e, n) {
  let a = Je.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), Je.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !re.has(s)) return e[`${n}${H}${s}`];
      },
      has(i, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${n}${H}${s}` in e;
      },
    },
  );
  return a.set(n, o), o;
}
function Wt(e, n, a) {
  const o = Ve.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, d) {
        if (typeof d != "symbol" && !re.has(d) && Object.hasOwn(n, d))
          return Ie(e, d);
      },
      has(s, d) {
        return typeof d == "symbol" || re.has(d) ? !1 : Object.hasOwn(n, d);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, d) {
        if (typeof d != "symbol" && Object.hasOwn(n, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ve.set(e, i), i;
}
var Ge = new WeakMap();
function Kt(e, n, a) {
  let o = Ge.get(e);
  return (
    o || ((o = new Map()), Ge.set(e, o)),
    new Proxy(
      {},
      {
        get(i, s) {
          if (typeof s == "symbol" || re.has(s) || !Object.hasOwn(n, s)) return;
          const d = o.get(s);
          if (d) return d;
          const u = new Proxy(
            {},
            {
              get(h, f) {
                if (typeof f != "symbol" && !re.has(f))
                  return (c) => {
                    e.dispatch({ type: `${s}${H}${f}`, ...c });
                  };
              },
            },
          );
          return o.set(s, u), u;
        },
        has(i, s) {
          return typeof s == "symbol" || re.has(s) ? !1 : Object.hasOwn(n, s);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(i, s) {
          if (typeof s != "symbol" && Object.hasOwn(n, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Ht(e) {
  const n = e.module;
  if (!n)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof n,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !ve(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let a = e.debug,
    o = e.errorBoundary;
  e.zeroConfig &&
    ((a = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (o = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
    s = null;
  s = ct({
    modules: [
      {
        id: n.id,
        schema: n.schema.facts,
        requirements: n.schema.requirements,
        init: n.init,
        derive: n.derive,
        events: n.events,
        effects: n.effects,
        constraints: n.constraints,
        resolvers: n.resolvers,
        hooks: n.hooks,
        snapshotEvents: n.snapshotEvents,
      },
    ],
    plugins: e.plugins,
    debug: a,
    errorBoundary: o,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [f, c] of Object.entries(e.initialFacts))
          re.has(f) || (s.facts[f] = c);
      if (i) {
        for (const [f, c] of Object.entries(i)) re.has(f) || (s.facts[f] = c);
        i = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(f, c) {
          if (typeof c != "symbol" && !re.has(c))
            return ($) => {
              s.dispatch({ type: c, ...$ });
            };
        },
      },
    ),
    u = null,
    h = e.tickMs;
  return {
    _mode: "single",
    facts: s.facts,
    debug: s.debug,
    derive: s.derive,
    events: d,
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
    async hydrate(f) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await f();
      c && typeof c == "object" && (i = c);
    },
    initialize() {
      s.initialize();
    },
    start() {
      s.start(),
        h &&
          h > 0 &&
          n.events &&
          "tick" in n.events &&
          (u = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      u && (clearInterval(u), (u = null)), s.stop();
    },
    destroy() {
      this.stop(), s.destroy();
    },
    dispatch(f) {
      s.dispatch(f);
    },
    batch: s.batch.bind(s),
    read(f) {
      return s.read(f);
    },
    subscribe(f, c) {
      return s.subscribe(f, c);
    },
    watch(f, c, $) {
      return s.watch(f, c, $);
    },
    when(f, c) {
      return s.when(f, c);
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
    registerModule(f) {
      s.registerModule({
        id: f.id,
        schema: f.schema.facts,
        requirements: f.schema.requirements,
        init: f.init,
        derive: f.derive,
        events: f.events,
        effects: f.effects,
        constraints: f.constraints,
        resolvers: f.resolvers,
        hooks: f.hooks,
        snapshotEvents: f.snapshotEvents,
      });
    },
  };
}
var ut = class {
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
function Be() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function dt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const n = JSON.stringify(e, (a, o) =>
        typeof o == "bigint"
          ? String(o) + "n"
          : typeof o == "symbol"
            ? String(o)
            : o,
      );
      return n.length > 120 ? n.slice(0, 117) + "..." : n;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function fe(e, n) {
  return e.length <= n ? e : e.slice(0, n - 3) + "...";
}
function xe(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Ut(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Vt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Be() &&
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
  ke = 340,
  he = 16,
  ge = 80,
  Xe = 2,
  Qe = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Gt() {
  return { entries: new ut(Yt), inflight: new Map() };
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
var Qt = 1e4,
  Zt = 100;
function er() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var tr = 50,
  Ze = 200,
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
  Q = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function rr(e, n, a, o) {
  let i = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(n.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(n.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const u = document.createElement("button");
  u.setAttribute("aria-label", "Open Directive DevTools"),
    u.setAttribute("aria-expanded", String(a)),
    (u.title = "Ctrl+Shift+D to toggle"),
    Object.assign(u.style, {
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
    (u.textContent = "Directive");
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
  const f = document.createElement("div");
  Object.assign(f.style, {
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
    f.appendChild(c),
    f.appendChild($),
    h.appendChild(f);
  const q = document.createElement("div");
  (q.style.marginBottom = "6px"), q.setAttribute("aria-live", "polite");
  const D = document.createElement("span");
  (D.style.color = B.green),
    (D.textContent = "Settled"),
    q.appendChild(D),
    h.appendChild(q);
  const j = document.createElement("div");
  Object.assign(j.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const O = document.createElement("button");
  Object.assign(O.style, {
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
    (O.textContent = "◀ Undo"),
    (O.disabled = !0);
  const b = document.createElement("button");
  Object.assign(b.style, {
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
    (b.textContent = "Redo ▶"),
    (b.disabled = !0);
  const R = document.createElement("span");
  (R.style.color = B.muted),
    (R.style.fontSize = "10px"),
    j.appendChild(O),
    j.appendChild(b),
    j.appendChild(R),
    h.appendChild(j);
  function L(U, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const ie = document.createElement("summary");
    Object.assign(ie.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (ie.textContent = `${U} (`),
      ie.appendChild(de),
      ie.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      G.appendChild(ie);
    const ue = document.createElement("table");
    Object.assign(ue.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const _e = document.createElement("thead"),
      ze = document.createElement("tr");
    for (const vt of ["Key", "Value"]) {
      const be = document.createElement("th");
      (be.scope = "col"),
        Object.assign(be.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (be.textContent = vt),
        ze.appendChild(be);
    }
    _e.appendChild(ze), ue.appendChild(_e);
    const Le = document.createElement("tbody");
    return (
      ue.appendChild(Le),
      G.appendChild(ue),
      { details: G, tbody: Le, countSpan: de }
    );
  }
  function T(U, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const ie = document.createElement("summary");
    Object.assign(ie.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (ie.textContent = `${U} (`),
      ie.appendChild(de),
      ie.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      G.appendChild(ie);
    const ue = document.createElement("ul");
    return (
      Object.assign(ue.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(ue),
      { details: G, list: ue, countSpan: de }
    );
  }
  const m = L("Facts", !0);
  h.appendChild(m.details);
  const E = L("Derivations", !1);
  h.appendChild(E.details);
  const v = T("Inflight", B.yellow);
  h.appendChild(v.details);
  const C = T("Unmet", B.red);
  h.appendChild(C.details);
  const A = document.createElement("details");
  A.style.marginBottom = "4px";
  const z = document.createElement("summary");
  Object.assign(z.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (z.textContent = "Performance"),
    A.appendChild(z);
  const p = document.createElement("div");
  (p.style.fontSize = "10px"),
    (p.style.color = B.muted),
    (p.textContent = "No data yet"),
    A.appendChild(p),
    h.appendChild(A);
  const w = document.createElement("details");
  w.style.marginBottom = "4px";
  const S = document.createElement("summary");
  Object.assign(S.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (S.textContent = "Dependency Graph"),
    w.appendChild(S);
  const I = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  I.setAttribute("width", "100%"),
    I.setAttribute("height", "120"),
    I.setAttribute("role", "img"),
    I.setAttribute("aria-label", "System dependency graph"),
    (I.style.display = "block"),
    I.setAttribute("viewBox", "0 0 460 120"),
    I.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(I),
    h.appendChild(w);
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
  const P = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  P.setAttribute("width", "100%"),
    P.setAttribute("height", "60"),
    P.setAttribute("role", "img"),
    P.setAttribute("aria-label", "Resolver execution timeline"),
    (P.style.display = "block"),
    P.setAttribute("viewBox", `0 0 ${ke} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(ke / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", B.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", B.font),
    (y.textContent = "No resolver activity yet"),
    P.appendChild(y),
    N.appendChild(P),
    h.appendChild(N);
  let k, t, r, l;
  if (o) {
    const U = document.createElement("details");
    U.style.marginBottom = "4px";
    const J = document.createElement("summary");
    Object.assign(J.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    }),
      (r = document.createElement("span")),
      (r.textContent = "0"),
      (J.textContent = "Events ("),
      J.appendChild(r),
      J.appendChild(document.createTextNode(")")),
      U.appendChild(J),
      (t = document.createElement("div")),
      Object.assign(t.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      t.setAttribute("role", "log"),
      t.setAttribute("aria-live", "polite"),
      (t.tabIndex = 0);
    const G = document.createElement("div");
    (G.style.color = B.muted),
      (G.style.padding = "4px"),
      (G.textContent = "Waiting for events..."),
      (G.className = "dt-events-empty"),
      t.appendChild(G),
      U.appendChild(t),
      h.appendChild(U),
      (k = U),
      (l = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (t = document.createElement("div")),
      (r = document.createElement("span")),
      (l = document.createElement("div")),
      (l.style.fontSize = "10px"),
      (l.style.color = B.muted),
      (l.style.marginTop = "4px"),
      (l.style.fontStyle = "italic"),
      (l.textContent = "Enable trace: true for event log"),
      h.appendChild(l);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const x = document.createElement("button");
  Object.assign(x.style, {
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
    (x.textContent = "⏺ Record");
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
    g.appendChild(x),
    g.appendChild(M),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (U) => {
        const J = h,
          G = J.scrollTop === 0 && U.deltaY < 0,
          ie = J.scrollTop + J.clientHeight >= J.scrollHeight && U.deltaY > 0;
        (G || ie) && U.preventDefault();
      },
      { passive: !1 },
    );
  let F = a,
    W = new Set();
  function _() {
    (F = !0),
      (h.style.display = "block"),
      (u.style.display = "none"),
      u.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function V() {
    (F = !1),
      (h.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", _), $.addEventListener("click", V);
  function Y(U) {
    U.key === "Escape" && F && V();
  }
  h.addEventListener("keydown", Y);
  function te(U) {
    U.key === "d" &&
      U.shiftKey &&
      (U.ctrlKey || U.metaKey) &&
      (U.preventDefault(), F ? V() : _());
  }
  document.addEventListener("keydown", te);
  function Z() {
    i || (document.body.appendChild(u), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function X() {
    (i = !0),
      u.removeEventListener("click", _),
      $.removeEventListener("click", V),
      h.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", te),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const U of W) clearTimeout(U);
    W.clear(), u.remove(), h.remove(), d.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: u,
      titleEl: c,
      statusEl: D,
      factsBody: m.tbody,
      factsCount: m.countSpan,
      derivBody: E.tbody,
      derivCount: E.countSpan,
      derivSection: E.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: C.list,
      unmetSection: C.details,
      unmetCount: C.countSpan,
      perfSection: A,
      perfBody: p,
      timeTravelSection: j,
      timeTravelLabel: R,
      undoBtn: O,
      redoBtn: b,
      flowSection: w,
      flowSvg: I,
      timelineSection: N,
      timelineSvg: P,
      eventsSection: k,
      eventsList: t,
      eventsCount: r,
      traceHint: l,
      recordBtn: x,
      exportBtn: M,
    },
    destroy: X,
    isOpen: () => F,
    flashTimers: W,
  };
}
function $e(e, n, a, o, i, s) {
  let d = dt(o),
    u = e.get(a);
  if (u) {
    const h = u.cells;
    if (h[1] && ((h[1].textContent = d), i && s)) {
      const f = h[1];
      f.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (f.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${B.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: B.muted }),
      (h.textContent = a);
    const f = document.createElement("td");
    (f.style.padding = "2px 4px"),
      (f.textContent = d),
      u.appendChild(h),
      u.appendChild(f),
      n.appendChild(u),
      e.set(a, u);
  }
}
function nr(e, n) {
  const a = e.get(n);
  a && (a.remove(), e.delete(n));
}
function Ae(e, n, a) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(n.length)),
    n.length > 0)
  )
    for (const o of n) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.resolverId} (${o.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = B.muted),
      (o.textContent = "None"),
      e.inflightList.appendChild(o);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(a.length)),
    a.length > 0)
  )
    for (const o of a) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.requirement.type} from ${o.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = B.muted),
      (o.textContent = "None"),
      e.unmetList.appendChild(o);
  }
}
function Oe(e, n, a) {
  const o = n === 0 && a === 0;
  (e.statusEl.style.color = o ? B.green : B.yellow),
    (e.statusEl.textContent = o ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = o ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${o ? "" : " (system working)"}`,
    );
}
function et(e, n, a, o) {
  const i = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    n.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = B.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      d.appendChild(u),
      e.derivBody.appendChild(d);
    return;
  }
  const s = new Set(i);
  for (const [d, u] of n) s.has(d) || (u.remove(), n.delete(d));
  for (const d of i) {
    let u;
    try {
      u = dt(a.read(d));
    } catch {
      u = "<error>";
    }
    $e(n, e.derivBody, d, u, !0, o);
  }
}
function ir(e, n, a, o) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    u = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const q = JSON.stringify(a);
    h = fe(q, 60);
  } catch {
    h = "{}";
  }
  const f = document.createElement("span");
  (f.style.color = B.closeBtn), (f.textContent = u);
  const c = document.createElement("span");
  (c.style.color = B.accent), (c.textContent = ` ${n} `);
  const $ = document.createElement("span");
  for (
    $.style.color = B.muted,
      $.textContent = h,
      s.appendChild(f),
      s.appendChild(c),
      s.appendChild($),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > tr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(o);
}
function or(e, n) {
  e.perfBody.replaceChildren();
  const a =
      n.reconcileCount > 0
        ? (n.reconcileTotalMs / n.reconcileCount).toFixed(1)
        : "—",
    o = [
      `Reconciles: ${n.reconcileCount}  (avg ${a}ms)`,
      `Effects: ${n.effectRunCount} run, ${n.effectErrorCount} errors`,
    ];
  for (const i of o) {
    const s = document.createElement("div");
    (s.style.marginBottom = "2px"),
      (s.textContent = i),
      e.perfBody.appendChild(s);
  }
  if (n.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = B.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const s = [...n.resolverStats.entries()].sort(
      (d, u) => u[1].totalMs - d[1].totalMs,
    );
    for (const [d, u] of s) {
      const h = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        f = document.createElement("div");
      (f.style.paddingLeft = "8px"),
        (f.textContent = `${d}: ${u.count}x, avg ${h}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (f.style.color = B.red),
        e.perfBody.appendChild(f);
    }
  }
}
function tt(e, n) {
  const a = n.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const o = a.currentIndex,
    i = a.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${o + 1} / ${i}` : "0 snapshots";
  const s = o > 0,
    d = o < i - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function sr(e, n) {
  e.undoBtn.addEventListener("click", () => {
    n.debug && n.debug.currentIndex > 0 && n.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      n.debug &&
        n.debug.currentIndex < n.debug.snapshots.length - 1 &&
        n.debug.goForward(1);
    });
}
var De = new WeakMap();
function lr(e, n, a, o, i, s) {
  return [
    e.join(","),
    n.join(","),
    a.map((d) => `${d.id}:${d.active}`).join(","),
    [...o.entries()].map(([d, u]) => `${d}:${u.status}:${u.type}`).join(","),
    i.join(","),
    s.join(","),
  ].join("|");
}
function ar(e, n, a, o, i) {
  for (const s of a) {
    const d = e.nodes.get(`0:${s}`);
    if (!d) continue;
    const u = n.recentlyChangedFacts.has(s);
    d.rect.setAttribute("fill", u ? B.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of o) {
    const d = e.nodes.get(`1:${s}`);
    if (!d) continue;
    const u = n.recentlyComputedDerivations.has(s);
    d.rect.setAttribute("fill", u ? B.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of i) {
    const d = e.nodes.get(`2:${s}`);
    if (!d) continue;
    const u = n.recentlyActiveConstraints.has(s),
      h = d.rect.getAttribute("stroke") ?? B.muted;
    d.rect.setAttribute("fill", u ? h + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function rt(e, n, a) {
  const o = xe(n);
  if (!o) return;
  let i;
  try {
    i = Object.keys(n.facts.$store.toObject());
  } catch {
    i = [];
  }
  const s = Object.keys(n.derive),
    d = o.constraints,
    u = o.unmet,
    h = o.inflight,
    f = Object.keys(o.resolvers),
    c = new Map();
  for (const y of u)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && s.length === 0 && d.length === 0 && f.length === 0) {
    De.delete(e.flowSvg),
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
    q = lr(i, s, d, c, f, $),
    D = De.get(e.flowSvg);
  if (D && D.fingerprint === q) {
    ar(
      D,
      a,
      i,
      s,
      d.map((y) => y.id),
    );
    return;
  }
  const j = Q.nodeW + Q.colGap,
    O = [5, 5 + j, 5 + j * 2, 5 + j * 3, 5 + j * 4],
    b = O[4] + Q.nodeW + 5;
  function R(y) {
    let k = Q.startY + 12;
    return y.map((t) => {
      const r = { ...t, y: k };
      return (k += Q.nodeH + Q.nodeGap), r;
    });
  }
  const L = R(i.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    T = R(s.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    m = R(
      d.map((y) => ({
        id: y.id,
        label: fe(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    E = R(
      [...c.entries()].map(([y, k]) => ({
        id: y,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    v = R(f.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    C = Math.max(L.length, T.length, m.length, E.length, v.length, 1),
    A = Q.startY + 12 + C * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${b} ${A}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${s.length} derivations, ${d.length} constraints, ${c.size} requirements, ${f.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, k] of z.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(O[y] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", B.accent),
      t.setAttribute("font-size", String(Q.fontSize)),
      t.setAttribute("font-family", B.font),
      (t.textContent = k),
      e.flowSvg.appendChild(t);
  }
  const p = { fingerprint: q, nodes: new Map() };
  function w(y, k, t, r, l, g, x, M) {
    const F = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(k)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", x ? "0.35" : "1"),
      F.appendChild(W);
    const _ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      _.setAttribute("x", String(k + 4)),
      _.setAttribute("y", String(t + 4)),
      _.setAttribute("fill", g),
      _.setAttribute("font-size", String(Q.fontSize)),
      _.setAttribute("font-family", B.font),
      _.setAttribute("opacity", x ? "0.35" : "1"),
      (_.textContent = l),
      F.appendChild(_),
      e.flowSvg.appendChild(F),
      p.nodes.set(`${y}:${r}`, { g: F, rect: W, text: _ }),
      { midX: k + Q.nodeW / 2, midY: t }
    );
  }
  function S(y, k, t, r, l, g) {
    const x = document.createElementNS("http://www.w3.org/2000/svg", "line");
    x.setAttribute("x1", String(y)),
      x.setAttribute("y1", String(k)),
      x.setAttribute("x2", String(t)),
      x.setAttribute("y2", String(r)),
      x.setAttribute("stroke", l),
      x.setAttribute("stroke-width", "1"),
      x.setAttribute("stroke-dasharray", "3,2"),
      x.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(x);
  }
  const I = new Map(),
    N = new Map(),
    K = new Map(),
    P = new Map();
  for (const y of L) {
    const k = a.recentlyChangedFacts.has(y.id),
      t = w(0, O[0], y.y, y.id, y.label, B.text, !1, k);
    I.set(y.id, t);
  }
  for (const y of T) {
    const k = a.recentlyComputedDerivations.has(y.id),
      t = w(1, O[1], y.y, y.id, y.label, B.accent, !1, k);
    N.set(y.id, t);
  }
  for (const y of m) {
    const k = a.recentlyActiveConstraints.has(y.id),
      t = w(
        2,
        O[2],
        y.y,
        y.id,
        y.label,
        y.active ? B.yellow : B.muted,
        !y.active,
        k,
      );
    K.set(y.id, t);
  }
  for (const y of E) {
    const k = y.status === "unmet" ? B.red : B.yellow,
      t = w(3, O[3], y.y, y.id, fe(y.type, Q.labelMaxChars), k, !1, !1);
    P.set(y.id, t);
  }
  for (const y of v) {
    const k = h.some((t) => t.resolverId === y.id);
    w(4, O[4], y.y, y.id, y.label, k ? B.green : B.muted, !k, !1);
  }
  for (const y of T) {
    const k = a.derivationDeps.get(y.id),
      t = N.get(y.id);
    if (k && t)
      for (const r of k) {
        const l = I.get(r);
        l &&
          S(
            l.midX + Q.nodeW / 2,
            l.midY,
            t.midX - Q.nodeW / 2,
            t.midY,
            B.accent,
          );
      }
  }
  for (const y of E) {
    const k = K.get(y.fromConstraint),
      t = P.get(y.id);
    k &&
      t &&
      S(k.midX + Q.nodeW / 2, k.midY, t.midX - Q.nodeW / 2, t.midY, B.muted);
  }
  for (const y of h) {
    const k = P.get(y.id);
    if (k) {
      const t = v.find((r) => r.id === y.resolverId);
      t && S(k.midX + Q.nodeW / 2, k.midY, O[4], t.y, B.green);
    }
  }
  De.set(e.flowSvg, p);
}
function cr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function ur(e, n) {
  const a = n.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let o = 1 / 0,
    i = -1 / 0;
  for (const D of a)
    D.startMs < o && (o = D.startMs), D.endMs > i && (i = D.endMs);
  const s = performance.now();
  for (const D of n.inflight.values()) D < o && (o = D), s > i && (i = s);
  const d = i - o || 1,
    u = ke - ge - 10,
    h = [],
    f = new Set();
  for (const D of a)
    f.has(D.resolver) || (f.add(D.resolver), h.push(D.resolver));
  for (const D of n.inflight.keys()) f.has(D) || (f.add(D), h.push(D));
  const c = h.slice(-12),
    $ = he * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${ke} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const q = 5;
  for (let D = 0; D <= q; D++) {
    const j = ge + (u * D) / q,
      O = (d * D) / q,
      b = document.createElementNS("http://www.w3.org/2000/svg", "text");
    b.setAttribute("x", String(j)),
      b.setAttribute("y", "8"),
      b.setAttribute("fill", B.muted),
      b.setAttribute("font-size", "6"),
      b.setAttribute("font-family", B.font),
      b.setAttribute("text-anchor", "middle"),
      (b.textContent =
        O < 1e3 ? `${O.toFixed(0)}ms` : `${(O / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(b);
    const R = document.createElementNS("http://www.w3.org/2000/svg", "line");
    R.setAttribute("x1", String(j)),
      R.setAttribute("y1", "10"),
      R.setAttribute("x2", String(j)),
      R.setAttribute("y2", String($)),
      R.setAttribute("stroke", B.border),
      R.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(R);
  }
  for (let D = 0; D < c.length; D++) {
    const j = c[D],
      O = 12 + D * he,
      b = D % Qe.length,
      R = Qe[b],
      L = document.createElementNS("http://www.w3.org/2000/svg", "text");
    L.setAttribute("x", String(ge - 4)),
      L.setAttribute("y", String(O + he / 2 + 3)),
      L.setAttribute("fill", B.muted),
      L.setAttribute("font-size", "7"),
      L.setAttribute("font-family", B.font),
      L.setAttribute("text-anchor", "end"),
      (L.textContent = fe(j, 12)),
      e.timelineSvg.appendChild(L);
    const T = a.filter((E) => E.resolver === j);
    for (const E of T) {
      const v = ge + ((E.startMs - o) / d) * u,
        C = Math.max(((E.endMs - E.startMs) / d) * u, Xe),
        A = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      A.setAttribute("x", String(v)),
        A.setAttribute("y", String(O + 2)),
        A.setAttribute("width", String(C)),
        A.setAttribute("height", String(he - 4)),
        A.setAttribute("rx", "2"),
        A.setAttribute("fill", E.error ? B.red : R),
        A.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        p = E.endMs - E.startMs;
      (z.textContent = `${j}: ${p.toFixed(1)}ms${E.error ? " (error)" : ""}`),
        A.appendChild(z),
        e.timelineSvg.appendChild(A);
    }
    const m = n.inflight.get(j);
    if (m !== void 0) {
      const E = ge + ((m - o) / d) * u,
        v = Math.max(((s - m) / d) * u, Xe),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String(E)),
        C.setAttribute("y", String(O + 2)),
        C.setAttribute("width", String(v)),
        C.setAttribute("height", String(he - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", R),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", R),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const A = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (A.textContent = `${j}: inflight ${(s - m).toFixed(0)}ms`),
        C.appendChild(A),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${c.length} resolvers`,
  );
}
function dr() {
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
      n = {
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
        explain(a, o) {
          return this.getSystem(o)?.explain(a) ?? null;
        },
        subscribe(a, o) {
          const i = o ? e.get(o) : e.values().next().value;
          if (!i) {
            let s = !1,
              d = setInterval(() => {
                const h = o ? e.get(o) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              u = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(u);
              for (const h of e.values()) h.subscribers.delete(a);
            };
          }
          return (
            i.subscribers.add(a),
            () => {
              i.subscribers.delete(a);
            }
          );
        },
        exportSession(a) {
          const o = a ? e.get(a) : e.values().next().value;
          return o
            ? JSON.stringify({
                version: 1,
                name: a ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: o.events.toArray(),
              })
            : null;
        },
        importSession(a, o) {
          try {
            if (a.length > 10 * 1024 * 1024) return !1;
            const i = JSON.parse(a);
            if (
              !i ||
              typeof i != "object" ||
              Array.isArray(i) ||
              !Array.isArray(i.events)
            )
              return !1;
            const s = o ? e.get(o) : e.values().next().value;
            if (!s) return !1;
            const d = s.maxEvents,
              u = i.events,
              h = u.length > d ? u.length - d : 0;
            s.events.clear();
            for (let f = h; f < u.length; f++) {
              const c = u[f];
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
          const o = a ? e.get(a) : e.values().next().value;
          o && o.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: n,
        writable: !1,
        configurable: Be(),
        enumerable: !0,
      }),
      n
    );
  }
  return window.__DIRECTIVE__;
}
function fr(e = {}) {
  const {
      name: n = "default",
      trace: a = !1,
      maxEvents: o,
      panel: i = !1,
      position: s = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    u = Vt(o),
    h = dr(),
    f = {
      system: null,
      events: new ut(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  h.systems.set(n, f);
  let c = (r, l) => {
      const g = { timestamp: Date.now(), type: r, data: l };
      a && f.events.push(g);
      for (const x of f.subscribers)
        try {
          x(g);
        } catch {}
    },
    $ = null,
    q = new Map(),
    D = new Map(),
    j = Jt(),
    O = Xt(),
    b = er(),
    R = Gt(),
    L = i && typeof window < "u" && typeof document < "u" && Be(),
    T = null,
    m = 0,
    E = 1,
    v = 2,
    C = 4,
    A = 8,
    z = 16,
    p = 32,
    w = 64,
    S = 128,
    I = new Map(),
    N = new Set(),
    K = null;
  function P(r) {
    (m |= r),
      T === null &&
        typeof requestAnimationFrame < "u" &&
        (T = requestAnimationFrame(y));
  }
  function y() {
    if (((T = null), !$ || !f.system)) {
      m = 0;
      return;
    }
    const r = $.refs,
      l = f.system,
      g = m;
    if (((m = 0), g & E)) {
      for (const x of N) nr(q, x);
      N.clear();
      for (const [x, { value: M, flash: F }] of I)
        $e(q, r.factsBody, x, M, F, $.flashTimers);
      I.clear(), (r.factsCount.textContent = String(q.size));
    }
    if ((g & v && et(r, D, l, $.flashTimers), g & A))
      if (K) Oe(r, K.inflight.length, K.unmet.length);
      else {
        const x = xe(l);
        x && Oe(r, x.inflight.length, x.unmet.length);
      }
    if (g & C)
      if (K) Ae(r, K.inflight, K.unmet);
      else {
        const x = xe(l);
        x && Ae(r, x.inflight, x.unmet);
      }
    g & z && or(r, j),
      g & p && rt(r, l, O),
      g & w && tt(r, l),
      g & S && ur(r, R);
  }
  function k(r, l) {
    $ && a && ir($.refs, r, l, f.events.size);
  }
  function t(r, l) {
    b.isRecording &&
      b.recordedEvents.length < Qt &&
      b.recordedEvents.push({ timestamp: Date.now(), type: r, data: Ut(l) });
  }
  return {
    name: "devtools",
    onInit: (r) => {
      if (
        ((f.system = r),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${n}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        L)
      ) {
        const l = f.system;
        $ = rr(n, s, d, a);
        const g = $.refs;
        try {
          const M = l.facts.$store.toObject();
          for (const [F, W] of Object.entries(M)) $e(q, g.factsBody, F, W, !1);
          g.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        et(g, D, l);
        const x = xe(l);
        x &&
          (Oe(g, x.inflight.length, x.unmet.length),
          Ae(g, x.inflight, x.unmet)),
          tt(g, l),
          sr(g, l),
          rt(g, l, O),
          g.recordBtn.addEventListener("click", () => {
            if (
              ((b.isRecording = !b.isRecording),
              (g.recordBtn.textContent = b.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = b.isRecording ? B.red : B.text),
              b.isRecording)
            ) {
              (b.recordedEvents = []), (b.snapshots = []);
              try {
                b.snapshots.push({
                  timestamp: Date.now(),
                  facts: l.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          g.exportBtn.addEventListener("click", () => {
            const M =
                b.recordedEvents.length > 0
                  ? b.recordedEvents
                  : f.events.toArray(),
              F = JSON.stringify(
                {
                  version: 1,
                  name: n,
                  exportedAt: Date.now(),
                  events: M,
                  snapshots: b.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([F], { type: "application/json" }),
              _ = URL.createObjectURL(W),
              V = document.createElement("a");
            (V.href = _),
              (V.download = `directive-session-${n}-${Date.now()}.json`),
              V.click(),
              URL.revokeObjectURL(_);
          });
      }
    },
    onStart: (r) => {
      c("start", {}), k("start", {}), t("start", {});
    },
    onStop: (r) => {
      c("stop", {}), k("stop", {}), t("stop", {});
    },
    onDestroy: (r) => {
      c("destroy", {}),
        h.systems.delete(n),
        T !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(T), (T = null)),
        O.animationTimer && clearTimeout(O.animationTimer),
        $ && ($.destroy(), ($ = null), q.clear(), D.clear());
    },
    onFactSet: (r, l, g) => {
      c("fact.set", { key: r, value: l, prev: g }),
        t("fact.set", { key: r, value: l, prev: g }),
        O.recentlyChangedFacts.add(r),
        $ &&
          f.system &&
          (I.set(r, { value: l, flash: !0 }),
          N.delete(r),
          P(E),
          k("fact.set", { key: r, value: l }));
    },
    onFactDelete: (r, l) => {
      c("fact.delete", { key: r, prev: l }),
        t("fact.delete", { key: r, prev: l }),
        $ && (N.add(r), I.delete(r), P(E), k("fact.delete", { key: r }));
    },
    onFactsBatch: (r) => {
      if (
        (c("facts.batch", { changes: r }),
        t("facts.batch", { count: r.length }),
        $ && f.system)
      ) {
        for (const l of r)
          l.type === "delete"
            ? (N.add(l.key), I.delete(l.key))
            : (O.recentlyChangedFacts.add(l.key),
              I.set(l.key, { value: l.value, flash: !0 }),
              N.delete(l.key));
        P(E), k("facts.batch", { count: r.length });
      }
    },
    onDerivationCompute: (r, l, g) => {
      c("derivation.compute", { id: r, value: l, deps: g }),
        t("derivation.compute", { id: r, deps: g }),
        O.derivationDeps.set(r, g),
        O.recentlyComputedDerivations.add(r),
        k("derivation.compute", { id: r, deps: g });
    },
    onDerivationInvalidate: (r) => {
      c("derivation.invalidate", { id: r }),
        k("derivation.invalidate", { id: r });
    },
    onReconcileStart: (r) => {
      c("reconcile.start", {}),
        (j.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (r) => {
      if (
        (c("reconcile.end", r),
        t("reconcile.end", {
          unmet: r.unmet.length,
          inflight: r.inflight.length,
          completed: r.completed.length,
        }),
        j.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - j.lastReconcileStartMs;
        j.reconcileCount++,
          (j.reconcileTotalMs += l),
          (j.lastReconcileStartMs = 0);
      }
      if (b.isRecording && f.system && b.snapshots.length < Zt)
        try {
          b.snapshots.push({
            timestamp: Date.now(),
            facts: f.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        f.system &&
        ((K = r),
        cr(O),
        P(v | A | C | z | p | w),
        k("reconcile.end", {
          unmet: r.unmet.length,
          inflight: r.inflight.length,
        }));
    },
    onConstraintEvaluate: (r, l) => {
      c("constraint.evaluate", { id: r, active: l }),
        t("constraint.evaluate", { id: r, active: l }),
        l
          ? (O.activeConstraints.add(r), O.recentlyActiveConstraints.add(r))
          : O.activeConstraints.delete(r),
        k("constraint.evaluate", { id: r, active: l });
    },
    onConstraintError: (r, l) => {
      c("constraint.error", { id: r, error: String(l) }),
        k("constraint.error", { id: r, error: String(l) });
    },
    onRequirementCreated: (r) => {
      c("requirement.created", { id: r.id, type: r.requirement.type }),
        t("requirement.created", { id: r.id, type: r.requirement.type }),
        k("requirement.created", { id: r.id, type: r.requirement.type });
    },
    onRequirementMet: (r, l) => {
      c("requirement.met", { id: r.id, byResolver: l }),
        t("requirement.met", { id: r.id, byResolver: l }),
        k("requirement.met", { id: r.id, byResolver: l });
    },
    onRequirementCanceled: (r) => {
      c("requirement.canceled", { id: r.id }),
        t("requirement.canceled", { id: r.id }),
        k("requirement.canceled", { id: r.id });
    },
    onResolverStart: (r, l) => {
      c("resolver.start", { resolver: r, requirementId: l.id }),
        t("resolver.start", { resolver: r, requirementId: l.id }),
        R.inflight.set(r, performance.now()),
        $ &&
          f.system &&
          (P(C | A | S),
          k("resolver.start", { resolver: r, requirementId: l.id }));
    },
    onResolverComplete: (r, l, g) => {
      c("resolver.complete", { resolver: r, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: r,
          requirementId: l.id,
          duration: g,
        });
      const x = j.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (x.count++,
        (x.totalMs += g),
        j.resolverStats.set(r, x),
        j.resolverStats.size > Ze)
      ) {
        const F = j.resolverStats.keys().next().value;
        F !== void 0 && j.resolverStats.delete(F);
      }
      const M = R.inflight.get(r);
      R.inflight.delete(r),
        M !== void 0 &&
          R.entries.push({
            resolver: r,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          f.system &&
          (P(C | A | z | S),
          k("resolver.complete", { resolver: r, duration: g }));
    },
    onResolverError: (r, l, g) => {
      c("resolver.error", {
        resolver: r,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: r,
          requirementId: l.id,
          error: String(g),
        });
      const x = j.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((x.errors++, j.resolverStats.set(r, x), j.resolverStats.size > Ze)) {
        const F = j.resolverStats.keys().next().value;
        F !== void 0 && j.resolverStats.delete(F);
      }
      const M = R.inflight.get(r);
      R.inflight.delete(r),
        M !== void 0 &&
          R.entries.push({
            resolver: r,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          f.system &&
          (P(C | A | z | S),
          k("resolver.error", { resolver: r, error: String(g) }));
    },
    onResolverRetry: (r, l, g) => {
      c("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        k("resolver.retry", { resolver: r, attempt: g });
    },
    onResolverCancel: (r, l) => {
      c("resolver.cancel", { resolver: r, requirementId: l.id }),
        t("resolver.cancel", { resolver: r, requirementId: l.id }),
        R.inflight.delete(r),
        k("resolver.cancel", { resolver: r });
    },
    onEffectRun: (r) => {
      c("effect.run", { id: r }),
        t("effect.run", { id: r }),
        j.effectRunCount++,
        k("effect.run", { id: r });
    },
    onEffectError: (r, l) => {
      c("effect.error", { id: r, error: String(l) }),
        j.effectErrorCount++,
        k("effect.error", { id: r, error: String(l) });
    },
    onSnapshot: (r) => {
      c("timetravel.snapshot", { id: r.id, trigger: r.trigger }),
        $ && f.system && P(w),
        k("timetravel.snapshot", { id: r.id, trigger: r.trigger });
    },
    onTimeTravel: (r, l) => {
      if (
        (c("timetravel.jump", { from: r, to: l }),
        t("timetravel.jump", { from: r, to: l }),
        $ && f.system)
      ) {
        const g = f.system;
        try {
          const x = g.facts.$store.toObject();
          q.clear(), $.refs.factsBody.replaceChildren();
          for (const [M, F] of Object.entries(x))
            $e(q, $.refs.factsBody, M, F, !1);
          $.refs.factsCount.textContent = String(Object.keys(x).length);
        } catch {}
        D.clear(),
          O.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (K = null),
          P(v | A | C | p | w),
          k("timetravel.jump", { from: r, to: l });
      }
    },
    onError: (r) => {
      c("error", {
        source: r.source,
        sourceId: r.sourceId,
        message: r.message,
      }),
        t("error", { source: r.source, message: r.message }),
        k("error", { source: r.source, message: r.message });
    },
    onErrorRecovery: (r, l) => {
      c("error.recovery", {
        source: r.source,
        sourceId: r.sourceId,
        strategy: l,
      }),
        k("error.recovery", { source: r.source, strategy: l });
    },
  };
}
function pr(e, n = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, d) {
    if (d > n) return !1;
    if (s == null || typeof s != "object") return !0;
    const u = s;
    if (o.has(u)) return !0;
    if ((o.add(u), Array.isArray(u))) {
      for (const h of u) if (!i(h, d + 1)) return o.delete(u), !1;
      return o.delete(u), !0;
    }
    for (const h of Object.keys(u))
      if (a.has(h) || !i(u[h], d + 1)) return o.delete(u), !1;
    return o.delete(u), !0;
  }
  return i(e, 0);
}
function mr(e) {
  let {
      storage: n,
      key: a,
      include: o,
      exclude: i = [],
      debounce: s = 100,
      onRestore: d,
      onSave: u,
      onError: h,
    } = e,
    f = null,
    c = null,
    $ = new Set(),
    q = (b) => (i.includes(b) ? !1 : o ? o.includes(b) : !0),
    D = () => {
      try {
        const b = n.getItem(a);
        if (!b) return null;
        const R = JSON.parse(b);
        return typeof R != "object" || R === null
          ? null
          : pr(R)
            ? R
            : (h?.(
                new Error(
                  "Potential prototype pollution detected in stored data",
                ),
              ),
              null);
      } catch (b) {
        return h?.(b instanceof Error ? b : new Error(String(b))), null;
      }
    },
    j = () => {
      if (c)
        try {
          const b = {};
          for (const R of $) q(R) && (b[R] = c.facts[R]);
          n.setItem(a, JSON.stringify(b)), u?.(b);
        } catch (b) {
          h?.(b instanceof Error ? b : new Error(String(b)));
        }
    },
    O = () => {
      f && clearTimeout(f), (f = setTimeout(j, s));
    };
  return {
    name: "persistence",
    onInit: (b) => {
      c = b;
      const R = D();
      R &&
        (c.facts.$store.batch(() => {
          for (const [L, T] of Object.entries(R))
            q(L) && ((c.facts[L] = T), $.add(L));
        }),
        d?.(R));
    },
    onDestroy: () => {
      f && clearTimeout(f), j();
    },
    onFactSet: (b) => {
      $.add(b), q(b) && O();
    },
    onFactDelete: (b) => {
      $.delete(b), q(b) && O();
    },
    onFactsBatch: (b) => {
      let R = !1;
      for (const L of b)
        L.type === "set" ? $.add(L.key) : $.delete(L.key), q(L.key) && (R = !0);
      R && O();
    },
  };
}
const nt = {
  en: {
    greeting: "Hello",
    settings: "Settings",
    theme: "Theme",
    language: "Language",
    sidebar: "Sidebar",
  },
  es: {
    greeting: "Hola",
    settings: "Configuración",
    theme: "Tema",
    language: "Idioma",
    sidebar: "Barra lateral",
  },
  fr: {
    greeting: "Bonjour",
    settings: "Paramètres",
    theme: "Thème",
    language: "Langue",
    sidebar: "Barre latérale",
  },
};
function it(e) {
  return nt[e] ?? nt.en;
}
const hr = {
    facts: {
      theme: oe.string(),
      locale: oe.string(),
      sidebarOpen: oe.boolean(),
      systemPrefersDark: oe.boolean(),
      loadedLocale: oe.string(),
      translations: oe.object(),
    },
    derivations: { effectiveTheme: oe.string(), isRTL: oe.boolean() },
    events: {
      setTheme: { value: oe.string() },
      setLocale: { value: oe.string() },
      toggleSidebar: {},
      setSystemPreference: { value: oe.boolean() },
    },
    requirements: {},
  },
  gr = {
    facts: { breakpoint: oe.string() },
    derivations: {},
    events: { setBreakpoint: { value: oe.string() } },
    requirements: {},
  },
  yr = st("preferences", {
    schema: hr,
    init: (e) => {
      (e.theme = "system"),
        (e.locale = "en"),
        (e.sidebarOpen = !0),
        (e.systemPrefersDark = !1),
        (e.loadedLocale = "en"),
        (e.translations = it("en"));
    },
    derive: {
      effectiveTheme: (e) =>
        e.theme === "system"
          ? e.systemPrefersDark
            ? "dark"
            : "light"
          : e.theme,
      isRTL: (e) => ["ar", "he", "fa", "ur"].includes(e.locale),
    },
    events: {
      setTheme: (e, { value: n }) => {
        e.theme = n;
      },
      setLocale: (e, { value: n }) => {
        (e.locale = n), (e.loadedLocale = n), (e.translations = it(n));
      },
      toggleSidebar: (e) => {
        e.sidebarOpen = !e.sidebarOpen;
      },
      setSystemPreference: (e, { value: n }) => {
        e.systemPrefersDark = n;
      },
    },
    effects: {
      applyTheme: {
        run: (e) => {
          const n =
            e.theme === "system"
              ? e.systemPrefersDark
                ? "dark"
                : "light"
              : e.theme;
          document.documentElement.setAttribute("data-theme", n);
        },
      },
    },
  }),
  vr = st("layout", {
    schema: gr,
    init: (e) => {
      e.breakpoint = "desktop";
    },
    events: {
      setBreakpoint: (e, { value: n }) => {
        e.breakpoint = n;
      },
    },
  }),
  se = Ft({
    modules: { preferences: yr, layout: vr },
    plugins: [
      fr({ name: "theme-locale" }),
      mr({
        storage: localStorage,
        key: "directive-theme-locale-example",
        include: [
          "preferences::theme",
          "preferences::locale",
          "preferences::sidebarOpen",
        ],
      }),
    ],
  });
se.start();
const br = ["preferences.*", "layout.*"],
  ft = window.matchMedia("(prefers-color-scheme: dark)");
se.events.preferences.setSystemPreference({ value: ft.matches });
ft.addEventListener("change", (e) => {
  se.events.preferences.setSystemPreference({ value: e.matches });
});
function pt() {
  const e = window.innerWidth;
  return e < 640 ? "mobile" : e < 1024 ? "tablet" : "desktop";
}
se.events.layout.setBreakpoint({ value: pt() });
window.addEventListener("resize", () => {
  se.events.layout.setBreakpoint({ value: pt() });
});
const mt = document.getElementById("tl-theme-light"),
  ht = document.getElementById("tl-theme-dark"),
  gt = document.getElementById("tl-theme-system"),
  qe = document.getElementById("tl-locale-select"),
  Te = document.getElementById("tl-sidebar-toggle"),
  ot = document.getElementById("tl-effective-theme"),
  wr = document.getElementById("tl-header-locale"),
  Sr = document.getElementById("tl-header-breakpoint"),
  we = document.getElementById("tl-preview");
function yt() {
  const e = se.facts,
    n = se.derive,
    a = e.preferences.theme,
    o = e.preferences.locale,
    i = e.preferences.sidebarOpen,
    s = e.preferences.translations,
    d = n.preferences.effectiveTheme,
    u = n.preferences.isRTL,
    h = e.layout.breakpoint;
  (ot.textContent = d),
    (ot.className = `tl-badge tl-badge-${d}`),
    (wr.textContent = o.toUpperCase()),
    (Sr.textContent = h);
  const f = [
    { el: mt, value: "light" },
    { el: ht, value: "dark" },
    { el: gt, value: "system" },
  ];
  for (const $ of f) $.el.classList.toggle("tl-btn-active", a === $.value);
  (qe.value = o),
    (Te.textContent = i ? "Hide Sidebar" : "Show Sidebar"),
    Te.classList.toggle("tl-btn-active", i);
  const c =
    d === "dark"
      ? { bg: "#1e293b", text: "#cbd5e1", accent: "#5ba3a3", muted: "#94a3b8" }
      : { bg: "#f8fafc", text: "#1e293b", accent: "#0d9488", muted: "#64748b" };
  (we.style.background = c.bg),
    (we.style.color = c.text),
    we.setAttribute("dir", u ? "rtl" : "ltr"),
    (we.innerHTML = `
    <div class="tl-preview-header" style="color: ${c.accent}; font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem;">
      ${me(s.greeting)}!
    </div>
    <div class="tl-preview-grid">
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${c.muted};">${me(s.settings)}</span>
        <span class="tl-preview-icon">&#9881;</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${c.muted};">${me(s.theme)}</span>
        <span class="tl-preview-icon">${d === "dark" ? "&#9790;" : "&#9728;"}</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${c.muted};">${me(s.language)}</span>
        <span class="tl-preview-icon">${me(o.toUpperCase())}</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${c.muted};">${me(s.sidebar)}</span>
        <span class="tl-preview-icon">${i ? "&#9776;" : "&#10005;"}</span>
      </div>
    </div>
  `);
}
se.subscribe(br, yt);
mt.addEventListener("click", () => {
  se.events.preferences.setTheme({ value: "light" });
});
ht.addEventListener("click", () => {
  se.events.preferences.setTheme({ value: "dark" });
});
gt.addEventListener("click", () => {
  se.events.preferences.setTheme({ value: "system" });
});
qe.addEventListener("change", () => {
  se.events.preferences.setLocale({ value: qe.value });
});
Te.addEventListener("click", () => {
  se.events.preferences.toggleSidebar();
});
function me(e) {
  const n = document.createElement("div");
  return (n.textContent = e), n.innerHTML;
}
yt();
document.body.setAttribute("data-theme-locale-ready", "true");
