(() => {
  const n = document.createElement("link").relList;
  if (n && n.supports && n.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) o(i);
  new MutationObserver((i) => {
    for (const s of i)
      if (s.type === "childList")
        for (const u of s.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && o(u);
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
var Ye = class extends Error {
    constructor(n, a, o, i, s = !0) {
      super(n),
        (this.source = a),
        (this.sourceId = o),
        (this.context = i),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  me = [];
function kt() {
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
var Rt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function At() {
  return me[me.length - 1] ?? Rt;
}
function Ce(e) {
  const n = kt();
  me.push(n);
  try {
    return { value: e(), deps: n.getDependencies() };
  } finally {
    me.pop();
  }
}
function Ge(e) {
  const n = me.splice(0, me.length);
  try {
    return e();
  } finally {
    me.push(...n);
  }
}
function Be(e) {
  At().track(e);
}
function Ot(e, n = 100) {
  try {
    return JSON.stringify(e)?.slice(0, n) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function ke(e = [], n, a, o, i, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: n,
    _default: a,
    _transform: o,
    _description: i,
    _refinements: s,
    validate(u) {
      return ke([...e, u], n, a, o, i, s);
    },
  };
}
function te(e, n, a, o, i, s) {
  return {
    ...ke(e, n, a, o, i, s),
    default(u) {
      return te(e, n, u, o, i, s);
    },
    transform(u) {
      return te(
        [],
        n,
        void 0,
        (c) => {
          const h = o ? o(c) : c;
          return u(h);
        },
        i,
      );
    },
    brand() {
      return te(e, `Branded<${n}>`, a, o, i, s);
    },
    describe(u) {
      return te(e, n, a, o, u, s);
    },
    refine(u, c) {
      const h = [...(s ?? []), { predicate: u, message: c }];
      return te([...e, u], n, a, o, i, h);
    },
    nullable() {
      return te(
        [(u) => u === null || e.every((c) => c(u))],
        `${n} | null`,
        a,
        o,
        i,
      );
    },
    optional() {
      return te(
        [(u) => u === void 0 || e.every((c) => c(u))],
        `${n} | undefined`,
        a,
        o,
        i,
      );
    },
  };
}
var Z = {
  string() {
    return te([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (n, a, o, i, s) => ({
      ...te(n, "number", a, o, i, s),
      min(u) {
        return e([...n, (c) => c >= u], a, o, i, s);
      },
      max(u) {
        return e([...n, (c) => c <= u], a, o, i, s);
      },
      default(u) {
        return e(n, u, o, i, s);
      },
      describe(u) {
        return e(n, a, o, u, s);
      },
      refine(u, c) {
        const h = [...(s ?? []), { predicate: u, message: c }];
        return e([...n, u], a, o, i, h);
      },
    });
    return e([(n) => typeof n == "number"]);
  },
  boolean() {
    return te([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (n, a, o, i, s) => {
      const u = te(n, "array", o, void 0, i),
        c = s ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return c.value;
        },
        set _lastFailedIndex(h) {
          c.value = h;
        },
        of(h) {
          const f = { value: -1 };
          return e(
            [
              ...n,
              (d) => {
                for (let x = 0; x < d.length; x++) {
                  const M = d[x];
                  if (!h._validators.every((O) => O(M)))
                    return (f.value = x), !1;
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
          return e([...n, (h) => h.length > 0], a, o, i, c);
        },
        maxLength(h) {
          return e([...n, (f) => f.length <= h], a, o, i, c);
        },
        minLength(h) {
          return e([...n, (f) => f.length >= h], a, o, i, c);
        },
        default(h) {
          return e(n, a, h, i, c);
        },
        describe(h) {
          return e(n, a, o, h, c);
        },
      };
    };
    return e([(n) => Array.isArray(n)]);
  },
  object() {
    const e = (n, a, o) => ({
      ...te(n, "object", a, void 0, o),
      shape(i) {
        return e(
          [
            ...n,
            (s) => {
              for (const [u, c] of Object.entries(i)) {
                const h = s[u],
                  f = c;
                if (f && !f._validators.every((d) => d(h))) return !1;
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
        return e([...n, (s) => i.every((u) => u in s)], a, o);
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
    return te(
      [(a) => typeof a == "string" && n.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return te([(n) => n === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const n = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === null ? !0 : e._validators.every((o) => o(a)))],
      `${n} | null`,
    );
  },
  optional(e) {
    const n = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === void 0 ? !0 : e._validators.every((o) => o(a)))],
      `${n} | undefined`,
    );
  },
  union(...e) {
    const n = e.map((a) => a._typeName ?? "unknown");
    return te(
      [(a) => e.some((o) => o._validators.every((i) => i(a)))],
      n.join(" | "),
    );
  },
  record(e) {
    const n = e._typeName ?? "unknown";
    return te(
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
    return te(
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
    return te([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return te([(n) => typeof n == "string" && e.test(n)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return te([(n) => typeof n == "string" && e.test(n)], "email");
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
function jt(e) {
  const { schema: n, onChange: a, onBatch: o } = e;
  Object.keys(n).length;
  let i = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    c = new Map(),
    h = new Set(),
    f = new Map(),
    d = new Set(),
    x = 0,
    M = [],
    O = new Set(),
    j = !1,
    D = [],
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
  function F(p) {
    const w = p;
    if (w._typeName) return w._typeName;
    if (R(p)) {
      const S = p._def;
      if (S?.typeName) return S.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function z(p) {
    return u ? "[redacted]" : Ot(p);
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
      const L = S.safeParse(w);
      if (!L.success) {
        const y = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          k = z(w),
          t =
            L.error?.message ??
            L.error?.issues?.[0]?.message ??
            "Validation failed",
          r = F(S);
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${r}, got ${y} ${k}. ${t}`,
        );
      }
      return;
    }
    const q = S,
      N = q._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const W = q._typeName ?? "unknown";
    for (let L = 0; L < N.length; L++) {
      const y = N[L];
      if (typeof y == "function" && !y(w)) {
        let k = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          t = z(w),
          r = "";
        typeof q._lastFailedIndex == "number" &&
          q._lastFailedIndex >= 0 &&
          ((r = ` (element at index ${q._lastFailedIndex} failed)`),
          (q._lastFailedIndex = -1));
        const l = L === 0 ? "" : ` (validator ${L + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${W}, got ${k} ${t}${l}${r}`,
        );
      }
    }
  }
  function $(p) {
    f.get(p)?.forEach((w) => w());
  }
  function v() {
    d.forEach((p) => p());
  }
  function C(p, w, S) {
    if (j) {
      D.push({ key: p, value: w, prev: S });
      return;
    }
    j = !0;
    try {
      a?.(p, w, S), $(p), v();
      let q = 0;
      while (D.length > 0) {
        if (++q > b)
          throw (
            ((D.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${b} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...D];
        D.length = 0;
        for (const W of N) a?.(W.key, W.value, W.prev), $(W.key);
        v();
      }
    } finally {
      j = !1;
    }
  }
  function A() {
    if (!(x > 0)) {
      if ((o && M.length > 0 && o([...M]), O.size > 0)) {
        j = !0;
        try {
          for (const w of O) $(w);
          v();
          let p = 0;
          while (D.length > 0) {
            if (++p > b)
              throw (
                ((D.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${b} iterations.`,
                ))
              );
            const w = [...D];
            D.length = 0;
            for (const S of w) a?.(S.key, S.value, S.prev), $(S.key);
            v();
          }
        } finally {
          j = !1;
        }
      }
      (M.length = 0), O.clear();
    }
  }
  const T = {
    get(p) {
      return Be(p), c.get(p);
    },
    has(p) {
      return Be(p), c.has(p);
    },
    set(p, w) {
      m(p, w);
      const S = c.get(p);
      Object.is(S, w) ||
        (c.set(p, w),
        h.add(p),
        x > 0
          ? (M.push({ key: p, value: w, prev: S, type: "set" }), O.add(p))
          : C(p, w, S));
    },
    delete(p) {
      const w = c.get(p);
      c.delete(p),
        h.delete(p),
        x > 0
          ? (M.push({ key: p, value: void 0, prev: w, type: "delete" }),
            O.add(p))
          : C(p, void 0, w);
    },
    batch(p) {
      x++;
      try {
        p();
      } finally {
        x--, A();
      }
    },
    subscribe(p, w) {
      for (const S of p) {
        const q = S;
        f.has(q) || f.set(q, new Set()), f.get(q).add(w);
      }
      return () => {
        for (const S of p) {
          const q = f.get(S);
          q && (q.delete(w), q.size === 0 && f.delete(S));
        }
      };
    },
    subscribeAll(p) {
      return d.add(p), () => d.delete(p);
    },
    toObject() {
      const p = {};
      for (const w of h) c.has(w) && (p[w] = c.get(w));
      return p;
    },
  };
  return (
    (T.registerKeys = (p) => {
      for (const w of Object.keys(p)) ve.has(w) || ((n[w] = p[w]), h.add(w));
    }),
    T
  );
}
var ve = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Dt(e, n) {
  const a = () => ({
    get: (o) => Ge(() => e.get(o)),
    has: (o) => Ge(() => e.has(o)),
  });
  return new Proxy(
    {},
    {
      get(o, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return a;
        if (typeof i != "symbol" && !ve.has(i)) return e.get(i);
      },
      set(o, i, s) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ve.has(i)
          ? !1
          : (e.set(i, s), !0);
      },
      deleteProperty(o, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ve.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(o, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || ve.has(i)
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
function It(e) {
  const n = jt(e),
    a = Dt(n, e.schema);
  return { store: n, facts: a };
}
function gt(e, n) {
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
async function Ee(e, n, a) {
  let o,
    i = new Promise((s, u) => {
      o = setTimeout(() => u(new Error(a)), n);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(o);
  }
}
function yt(e, n = 50) {
  const a = new WeakSet();
  function o(i, s) {
    if (s > n) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const u = typeof i;
    if (u === "string") return JSON.stringify(i);
    if (u === "number" || u === "boolean") return String(i);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (a.has(i)) return '"[circular]"';
      a.add(i);
      const c = `[${i.map((h) => o(h, s + 1)).join(",")}]`;
      return a.delete(i), c;
    }
    if (u === "object") {
      const c = i;
      if (a.has(c)) return '"[circular]"';
      a.add(c);
      const h = `{${Object.keys(c)
        .sort()
        .map((f) => `${JSON.stringify(f)}:${o(c[f], s + 1)}`)
        .join(",")}}`;
      return a.delete(c), h;
    }
    return '"[unknown]"';
  }
  return o(e, 0);
}
function be(e, n = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, u) {
    if (u > n) return !1;
    if (s == null || typeof s != "object") return !0;
    const c = s;
    if (o.has(c)) return !0;
    if ((o.add(c), Array.isArray(c))) {
      for (const h of c) if (!i(h, u + 1)) return o.delete(c), !1;
      return o.delete(c), !0;
    }
    for (const h of Object.keys(c))
      if (a.has(h) || !i(c[h], u + 1)) return o.delete(c), !1;
    return o.delete(c), !0;
  }
  return i(e, 0);
}
function Mt(e) {
  let n = yt(e),
    a = 5381;
  for (let o = 0; o < n.length; o++) a = ((a << 5) + a) ^ n.charCodeAt(o);
  return (a >>> 0).toString(16);
}
function qt(e, n) {
  if (n) return n(e);
  const { type: a, ...o } = e,
    i = yt(o);
  return `${a}:${i}`;
}
function zt(e, n, a) {
  return { requirement: e, id: qt(e, a), fromConstraint: n };
}
var _e = class vt {
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
      const n = new vt();
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
  Bt = 5e3;
function _t(e) {
  let {
      definitions: n,
      facts: a,
      requirementKeys: o = {},
      defaultTimeout: i = Bt,
      onEvaluate: s,
      onError: u,
    } = e,
    c = new Map(),
    h = new Set(),
    f = new Set(),
    d = new Map(),
    x = new Map(),
    M = new Set(),
    O = new Map(),
    j = new Map(),
    D = !1,
    b = new Set(),
    R = new Set(),
    F = new Map(),
    z = [],
    m = new Map();
  function $() {
    for (const [t, r] of Object.entries(n))
      if (r.after)
        for (const l of r.after)
          n[l] && (F.has(l) || F.set(l, new Set()), F.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      r = new Set(),
      l = [];
    function g(E, I) {
      if (t.has(E)) return;
      if (r.has(E)) {
        const V = I.indexOf(E),
          _ = [...I.slice(V), E].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${_}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      r.add(E), I.push(E);
      const P = n[E];
      if (P?.after) for (const V of P.after) n[V] && g(V, I);
      I.pop(), r.delete(E), t.add(E), l.push(E);
    }
    for (const E of Object.keys(n)) g(E, []);
    (z = l), (m = new Map(z.map((E, I) => [E, I])));
  }
  v(), $();
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
    return c.set(t, g), g;
  }
  function T(t) {
    return c.get(t) ?? A(t);
  }
  function p(t, r) {
    const l = d.get(t) ?? new Set();
    for (const g of l) {
      const E = x.get(g);
      E?.delete(t), E && E.size === 0 && x.delete(g);
    }
    for (const g of r) x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    d.set(t, r);
  }
  function w(t) {
    const r = n[t];
    if (!r) return !1;
    const l = T(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (r.deps) (g = r.when(a)), O.set(t, new Set(r.deps));
      else {
        const E = Ce(() => r.when(a));
        (g = E.value), O.set(t, E.deps);
      }
      return g instanceof Promise
        ? (f.add(t),
          (l.isAsync = !0),
          g
            .then(
              (E) => ((l.lastResult = E), (l.isEvaluating = !1), s?.(t, E), E),
            )
            .catch(
              (E) => (
                (l.error = E instanceof Error ? E : new Error(String(E))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                u?.(t, E),
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
  async function S(t) {
    const r = n[t];
    if (!r) return !1;
    const l = T(t),
      g = r.timeout ?? i;
    if (((l.isEvaluating = !0), (l.error = null), r.deps?.length)) {
      const E = new Set(r.deps);
      p(t, E), O.set(t, E);
    }
    try {
      const E = r.when(a),
        I = await Ee(E, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = I), (l.isEvaluating = !1), s?.(t, I), I;
    } catch (E) {
      return (
        (l.error = E instanceof Error ? E : new Error(String(E))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(t, E),
        !1
      );
    }
  }
  function q(t, r) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const r = n[t];
    if (!r) return { requirements: [], deps: new Set() };
    const l = r.require;
    if (typeof l == "function") {
      const { value: g, deps: E } = Ce(() => l(a));
      return { requirements: q(g), deps: E };
    }
    return { requirements: q(l), deps: new Set() };
  }
  function W(t, r) {
    if (r.size === 0) return;
    const l = d.get(t) ?? new Set();
    for (const g of r)
      l.add(g), x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    d.set(t, l);
  }
  let L = null;
  function y() {
    return (
      L ||
        (L = Object.keys(n).sort((t, r) => {
          const l = T(t),
            g = T(r).priority - l.priority;
          if (g !== 0) return g;
          const E = m.get(t) ?? 0,
            I = m.get(r) ?? 0;
          return E - I;
        })),
      L
    );
  }
  for (const t of Object.keys(n)) A(t);
  function k(t) {
    const r = c.get(t);
    if (!r || r.after.length === 0) return !0;
    for (const l of r.after)
      if (n[l] && !h.has(l) && !R.has(l) && !b.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const r = new _e();
      R.clear();
      let l = y().filter((_) => !h.has(_)),
        g;
      if (!D || !t || t.size === 0) (g = l), (D = !0);
      else {
        const _ = new Set();
        for (const U of t) {
          const Y = x.get(U);
          if (Y) for (const re of Y) h.has(re) || _.add(re);
        }
        for (const U of M) h.has(U) || _.add(U);
        M.clear(), (g = [..._]);
        for (const U of l)
          if (!_.has(U)) {
            const Y = j.get(U);
            if (Y) for (const re of Y) r.add(re);
          }
      }
      function E(_, U) {
        if (h.has(_)) return;
        const Y = O.get(_);
        if (!U) {
          Y !== void 0 && p(_, Y), R.add(_), j.set(_, []);
          return;
        }
        R.delete(_);
        let re, ee;
        try {
          const X = N(_);
          (re = X.requirements), (ee = X.deps);
        } catch (X) {
          u?.(_, X), Y !== void 0 && p(_, Y), j.set(_, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const H of ee) X.add(H);
          p(_, X);
        } else W(_, ee);
        if (re.length > 0) {
          const X = o[_],
            H = re.map((J) => zt(J, _, X));
          for (const J of H) r.add(J);
          j.set(_, H);
        } else j.set(_, []);
      }
      async function I(_) {
        const U = [],
          Y = [];
        for (const H of _)
          if (k(H)) Y.push(H);
          else {
            U.push(H);
            const J = j.get(H);
            if (J) for (const G of J) r.add(G);
          }
        if (Y.length === 0) return U;
        const re = [],
          ee = [];
        for (const H of Y) T(H).isAsync ? ee.push(H) : re.push(H);
        const X = [];
        for (const H of re) {
          const J = w(H);
          if (J instanceof Promise) {
            X.push({ id: H, promise: J });
            continue;
          }
          E(H, J);
        }
        if (X.length > 0) {
          const H = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of H) E(J, G);
        }
        if (ee.length > 0) {
          const H = await Promise.all(
            ee.map(async (J) => ({ id: J, active: await S(J) })),
          );
          for (const { id: J, active: G } of H) E(J, G);
        }
        return U;
      }
      let P = g,
        V = g.length + 1;
      while (P.length > 0 && V > 0) {
        const _ = P.length;
        if (((P = await I(P)), P.length === _)) break;
        V--;
      }
      return r.all();
    },
    getState(t) {
      return c.get(t);
    },
    getAllStates() {
      return [...c.values()];
    },
    disable(t) {
      h.add(t), (L = null), j.delete(t);
      const r = d.get(t);
      if (r) {
        for (const l of r) {
          const g = x.get(l);
          g && (g.delete(t), g.size === 0 && x.delete(l));
        }
        d.delete(t);
      }
      O.delete(t);
    },
    enable(t) {
      h.delete(t), (L = null), M.add(t);
    },
    invalidate(t) {
      const r = x.get(t);
      if (r) for (const l of r) M.add(l);
    },
    markResolved(t) {
      b.add(t);
      const r = c.get(t);
      r && (r.lastResolvedAt = Date.now());
      const l = F.get(t);
      if (l) for (const g of l) M.add(g);
    },
    isResolved(t) {
      return b.has(t);
    },
    registerDefinitions(t) {
      for (const [r, l] of Object.entries(t)) (n[r] = l), A(r), M.add(r);
      (L = null), v(), $();
    },
  };
}
function Tt(e) {
  let {
      definitions: n,
      facts: a,
      onCompute: o,
      onInvalidate: i,
      onError: s,
    } = e,
    u = new Map(),
    c = new Map(),
    h = new Map(),
    f = new Map(),
    d = new Set(["__proto__", "constructor", "prototype"]),
    x = 0,
    M = new Set(),
    O = !1,
    j = 100,
    D;
  function b(v) {
    if (!n[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const C = {
      id: v,
      compute: () => F(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(v, C), C;
  }
  function R(v) {
    return u.get(v) ?? b(v);
  }
  function F(v) {
    const C = R(v),
      A = n[v];
    if (!A) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    C.isComputing = !0;
    try {
      const { value: T, deps: p } = Ce(() => A(a, D));
      return (
        (C.cachedValue = T), (C.isStale = !1), z(v, p), o?.(v, T, [...p]), T
      );
    } catch (T) {
      throw (s?.(v, T), T);
    } finally {
      C.isComputing = !1;
    }
  }
  function z(v, C) {
    const A = R(v),
      T = A.dependencies;
    for (const p of T)
      if (u.has(p)) {
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
    if (!(x > 0 || O)) {
      O = !0;
      try {
        let v = 0;
        while (M.size > 0) {
          if (++v > j) {
            const A = [...M];
            throw (
              (M.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${j} iterations. Remaining: ${A.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [...M];
          M.clear();
          for (const A of C) c.get(A)?.forEach((T) => T());
        }
      } finally {
        O = !1;
      }
    }
  }
  function $(v, C = new Set()) {
    if (C.has(v)) return;
    C.add(v);
    const A = u.get(v);
    if (!A || A.isStale) return;
    (A.isStale = !0), i?.(v), M.add(v);
    const T = f.get(v);
    if (T) for (const p of T) $(p, C);
  }
  return (
    (D = new Proxy(
      {},
      {
        get(v, C) {
          if (typeof C == "symbol" || d.has(C)) return;
          Be(C);
          const A = R(C);
          return A.isStale && F(C), A.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const C = R(v);
        return C.isStale && F(v), C.cachedValue;
      },
      isStale(v) {
        return u.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const C = h.get(v);
        if (C) {
          x++;
          try {
            for (const A of C) $(A);
          } finally {
            x--, m();
          }
        }
      },
      invalidateMany(v) {
        x++;
        try {
          for (const C of v) {
            const A = h.get(C);
            if (A) for (const T of A) $(T);
          }
        } finally {
          x--, m();
        }
      },
      invalidateAll() {
        x++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), M.add(v.id));
        } finally {
          x--, m();
        }
      },
      subscribe(v, C) {
        for (const A of v) {
          const T = A;
          c.has(T) || c.set(T, new Set()), c.get(T).add(C);
        }
        return () => {
          for (const A of v) {
            const T = A,
              p = c.get(T);
            p?.delete(C), p && p.size === 0 && c.delete(T);
          }
        };
      },
      getProxy() {
        return D;
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
function Ft(e) {
  let { definitions: n, facts: a, store: o, onRun: i, onError: s } = e,
    u = new Map(),
    c = null,
    h = !1;
  function f(b) {
    const R = n[b];
    if (!R) throw new Error(`[Directive] Unknown effect: ${b}`);
    const F = {
      id: b,
      enabled: !0,
      hasExplicitDeps: !!R.deps,
      dependencies: R.deps ? new Set(R.deps) : null,
      cleanup: null,
    };
    return u.set(b, F), F;
  }
  function d(b) {
    return u.get(b) ?? f(b);
  }
  function x() {
    return o.toObject();
  }
  function M(b, R) {
    const F = d(b);
    if (!F.enabled) return !1;
    if (F.dependencies) {
      for (const z of F.dependencies) if (R.has(z)) return !0;
      return !1;
    }
    return !0;
  }
  function O(b) {
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
        } catch (F) {
          s?.(b.id, F),
            console.error(
              `[Directive] Effect "${b.id}" cleanup threw an error:`,
              F,
            );
        }
      else b.cleanup = R;
  }
  async function D(b) {
    const R = d(b),
      F = n[b];
    if (!(!R.enabled || !F)) {
      O(R), i?.(b);
      try {
        if (R.hasExplicitDeps) {
          let z;
          if (
            (o.batch(() => {
              z = F.run(a, c);
            }),
            z instanceof Promise)
          ) {
            const m = await z;
            j(R, m);
          } else j(R, z);
        } else {
          let z = null,
            m,
            $ = Ce(
              () => (
                o.batch(() => {
                  m = F.run(a, c);
                }),
                m
              ),
            );
          z = $.deps;
          let v = $.value;
          v instanceof Promise && (v = await v),
            j(R, v),
            (R.dependencies = z.size > 0 ? z : null);
        }
      } catch (z) {
        s?.(b, z),
          console.error(`[Directive] Effect "${b}" threw an error:`, z);
      }
    }
  }
  for (const b of Object.keys(n)) f(b);
  return {
    async runEffects(b) {
      const R = [];
      for (const F of Object.keys(n)) M(F, b) && R.push(F);
      await Promise.all(R.map(D)), (c = x());
    },
    async runAll() {
      const b = Object.keys(n);
      await Promise.all(
        b.map((R) => (d(R).enabled ? D(R) : Promise.resolve())),
      ),
        (c = x());
    },
    disable(b) {
      const R = d(b);
      R.enabled = !1;
    },
    enable(b) {
      const R = d(b);
      R.enabled = !0;
    },
    isEnabled(b) {
      return d(b).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const b of u.values()) O(b);
    },
    registerDefinitions(b) {
      for (const [R, F] of Object.entries(b)) (n[R] = F), f(R);
    },
  };
}
function Lt(e = {}) {
  const {
      delayMs: n = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: o = 2,
      maxDelayMs: i = 3e4,
    } = e,
    s = new Map();
  function u(c) {
    const h = n * Math.pow(o, c - 1);
    return Math.min(h, i);
  }
  return {
    scheduleRetry(c, h, f, d, x) {
      if (d > a) return null;
      const M = u(d),
        O = {
          source: c,
          sourceId: h,
          context: f,
          attempt: d,
          nextRetryTime: Date.now() + M,
          callback: x,
        };
      return s.set(h, O), O;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const c = Date.now(),
        h = [];
      for (const [f, d] of s) d.nextRetryTime <= c && (h.push(d), s.delete(f));
      return h;
    },
    cancelRetry(c) {
      s.delete(c);
    },
    clearAll() {
      s.clear();
    },
  };
}
var Pt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Nt(e = {}) {
  const { config: n = {}, onError: a, onRecovery: o } = e,
    i = [],
    s = 100,
    u = Lt(n.retryLater),
    c = new Map();
  function h(d, x, M, O) {
    if (M instanceof Ye) return M;
    const j = M instanceof Error ? M.message : String(M),
      D = d !== "system";
    return new Ye(j, d, x, O, D);
  }
  function f(d, x, M) {
    const O = (() => {
      switch (d) {
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
    if (typeof O == "function") {
      try {
        O(M, x);
      } catch (j) {
        console.error("[Directive] Error in error handler callback:", j);
      }
      return "skip";
    }
    return typeof O == "string" ? O : Pt[d];
  }
  return {
    handleError(d, x, M, O) {
      const j = h(d, x, M, O);
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
      let D = f(d, x, M instanceof Error ? M : new Error(String(M)));
      if (D === "retry-later") {
        const b = (c.get(x) ?? 0) + 1;
        c.set(x, b),
          u.scheduleRetry(d, x, O, b) ||
            ((D = "skip"), c.delete(x), typeof process < "u");
      }
      try {
        o?.(j, D);
      } catch (b) {
        console.error("[Directive] Error in onRecovery callback:", b);
      }
      if (D === "throw") throw j;
      return D;
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
      return u;
    },
    processDueRetries() {
      return u.processDueRetries();
    },
    clearRetryAttempts(d) {
      c.delete(d), u.cancelRetry(d);
    },
  };
}
function Vt() {
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
      for (const u of e) n(() => u.onFactSet?.(o, i, s));
    },
    emitFactDelete(o, i) {
      for (const s of e) n(() => s.onFactDelete?.(o, i));
    },
    emitFactsBatch(o) {
      for (const i of e) n(() => i.onFactsBatch?.(o));
    },
    emitDerivationCompute(o, i, s) {
      for (const u of e) n(() => u.onDerivationCompute?.(o, i, s));
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
      for (const u of e) n(() => u.onResolverComplete?.(o, i, s));
    },
    emitResolverError(o, i, s) {
      for (const u of e) n(() => u.onResolverError?.(o, i, s));
    },
    emitResolverRetry(o, i, s) {
      for (const u of e) n(() => u.onResolverRetry?.(o, i, s));
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
var Xe = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Qe = { enabled: !1, windowMs: 50 };
function Ze(e, n) {
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
function Wt(e) {
  const {
      definitions: n,
      facts: a,
      store: o,
      onStart: i,
      onComplete: s,
      onError: u,
      onRetry: c,
      onCancel: h,
      onResolutionComplete: f,
    } = e,
    d = new Map(),
    x = new Map(),
    M = 1e3,
    O = new Map(),
    j = new Map(),
    D = 1e3;
  function b() {
    if (x.size > M) {
      const p = x.size - M,
        w = x.keys();
      for (let S = 0; S < p; S++) {
        const q = w.next().value;
        q && x.delete(q);
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
  function F(p) {
    return (
      typeof p == "object" &&
      p !== null &&
      "requirement" in p &&
      typeof p.requirement == "function"
    );
  }
  function z(p, w) {
    return R(p) ? w.type === p.requirement : F(p) ? p.requirement(w) : !1;
  }
  function m(p) {
    const w = p.type,
      S = j.get(w);
    if (S)
      for (const q of S) {
        const N = n[q];
        if (N && z(N, p)) return q;
      }
    for (const [q, N] of Object.entries(n))
      if (z(N, p)) {
        if (!j.has(w)) {
          if (j.size >= D) {
            const L = j.keys().next().value;
            L !== void 0 && j.delete(L);
          }
          j.set(w, []);
        }
        const W = j.get(w);
        return W.includes(q) || W.push(q), q;
      }
    return null;
  }
  function $(p) {
    return { facts: a, signal: p, snapshot: () => a.$snapshot() };
  }
  async function v(p, w, S) {
    const q = n[p];
    if (!q) return;
    let N = { ...Xe, ...q.retry },
      W = null;
    for (let L = 1; L <= N.attempts; L++) {
      if (S.signal.aborted) return;
      const y = d.get(w.id);
      y &&
        ((y.attempt = L),
        (y.status = {
          state: "running",
          requirementId: w.id,
          startedAt: y.startedAt,
          attempt: L,
        }));
      try {
        const k = $(S.signal);
        if (q.resolve) {
          let r;
          o.batch(() => {
            r = q.resolve(w.requirement, k);
          });
          const l = q.timeout;
          l && l > 0
            ? await Ee(r, l, `Resolver "${p}" timed out after ${l}ms`)
            : await r;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        x.set(w.id, {
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
          ((W = k instanceof Error ? k : new Error(String(k))),
          S.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(W, L)) break;
        if (L < N.attempts) {
          if (S.signal.aborted) return;
          const t = Ze(N, L);
          if (
            (c?.(p, w, L + 1),
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
    x.set(w.id, {
      state: "error",
      requirementId: w.id,
      error: W,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      b(),
      u?.(p, w, W);
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
    let q = { ...Xe, ...S.retry },
      N = { ...Qe, ...S.batch },
      W = new AbortController(),
      L = Date.now(),
      y = null,
      k = N.timeoutMs ?? S.timeout;
    for (let t = 1; t <= q.attempts; t++) {
      if (W.signal.aborted) return;
      try {
        const r = $(W.signal),
          l = w.map((g) => g.requirement);
        if (S.resolveBatchWithResults) {
          let g, E;
          if (
            (o.batch(() => {
              E = S.resolveBatchWithResults(l, r);
            }),
            k && k > 0
              ? (g = await Ee(
                  E,
                  k,
                  `Batch resolver "${p}" timed out after ${k}ms`,
                ))
              : (g = await E),
            g.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${p}" returned ${g.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let I = Date.now() - L,
            P = !1;
          for (let V = 0; V < w.length; V++) {
            const _ = w[V],
              U = g[V];
            if (U.success)
              x.set(_.id, {
                state: "success",
                requirementId: _.id,
                completedAt: Date.now(),
                duration: I,
              }),
                s?.(p, _, I);
            else {
              P = !0;
              const Y = U.error ?? new Error("Batch item failed");
              x.set(_.id, {
                state: "error",
                requirementId: _.id,
                error: Y,
                failedAt: Date.now(),
                attempts: t,
              }),
                u?.(p, _, Y);
            }
          }
          if (!P || w.some((V, _) => g[_]?.success)) return;
        } else {
          let g;
          o.batch(() => {
            g = S.resolveBatch(l, r);
          }),
            k && k > 0
              ? await Ee(g, k, `Batch resolver "${p}" timed out after ${k}ms`)
              : await g;
          const E = Date.now() - L;
          for (const I of w)
            x.set(I.id, {
              state: "success",
              requirementId: I.id,
              completedAt: Date.now(),
              duration: E,
            }),
              s?.(p, I, E);
          return;
        }
      } catch (r) {
        if (
          ((y = r instanceof Error ? r : new Error(String(r))),
          W.signal.aborted)
        )
          return;
        if (q.shouldRetry && !q.shouldRetry(y, t)) break;
        if (t < q.attempts) {
          const l = Ze(q, t);
          for (const g of w) c?.(p, g, t + 1);
          if (
            (await new Promise((g) => {
              const E = setTimeout(g, l),
                I = () => {
                  clearTimeout(E), g();
                };
              W.signal.addEventListener("abort", I, { once: !0 });
            }),
            W.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of w)
      x.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: q.attempts,
      }),
        u?.(p, t, y);
    b();
  }
  function A(p, w) {
    const S = n[p];
    if (!S) return;
    const q = { ...Qe, ...S.batch };
    O.has(p) || O.set(p, { resolverId: p, requirements: [], timer: null });
    const N = O.get(p);
    N.requirements.push(w),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        T(p);
      }, q.windowMs));
  }
  function T(p) {
    const w = O.get(p);
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
      if (d.has(p.id)) return;
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
      const q = new AbortController(),
        N = Date.now(),
        W = {
          requirementId: p.id,
          resolverId: w,
          controller: q,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: p.id, startedAt: N },
          originalRequirement: p,
        };
      d.set(p.id, W),
        i?.(w, p),
        v(w, p, q).finally(() => {
          d.delete(p.id) && f?.();
        });
    },
    cancel(p) {
      const w = d.get(p);
      w &&
        (w.controller.abort(),
        d.delete(p),
        x.set(p, {
          state: "canceled",
          requirementId: p,
          canceledAt: Date.now(),
        }),
        b(),
        h?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [p] of d) this.cancel(p);
      for (const p of O.values()) p.timer && clearTimeout(p.timer);
      O.clear();
    },
    getStatus(p) {
      const w = d.get(p);
      return w ? w.status : x.get(p) || { state: "idle" };
    },
    getInflight() {
      return [...d.keys()];
    },
    getInflightInfo() {
      return [...d.values()].map((p) => ({
        id: p.requirementId,
        resolverId: p.resolverId,
        startedAt: p.startedAt,
      }));
    },
    isResolving(p) {
      return d.has(p);
    },
    processBatches() {
      for (const p of O.keys()) T(p);
    },
    registerDefinitions(p) {
      for (const [w, S] of Object.entries(p)) n[w] = S;
      j.clear();
    },
  };
}
function Kt(e) {
  let { config: n, facts: a, store: o, onSnapshot: i, onTimeTravel: s } = e,
    u = n.timeTravel ?? !1,
    c = n.maxSnapshots ?? 100,
    h = [],
    f = -1,
    d = 1,
    x = !1,
    M = !1,
    O = [],
    j = null,
    D = -1;
  function b() {
    return o.toObject();
  }
  function R() {
    const z = b();
    return structuredClone(z);
  }
  function F(z) {
    if (!be(z)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    o.batch(() => {
      for (const [m, $] of Object.entries(z)) {
        if (m === "__proto__" || m === "constructor" || m === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${m}" during fact restoration`,
          );
          continue;
        }
        a[m] = $;
      }
    });
  }
  return {
    get isEnabled() {
      return u;
    },
    get isRestoring() {
      return M;
    },
    get isPaused() {
      return x;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return f;
    },
    takeSnapshot(z) {
      if (!u || x)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: z };
      const m = { id: d++, timestamp: Date.now(), facts: R(), trigger: z };
      for (
        f < h.length - 1 && h.splice(f + 1), h.push(m), f = h.length - 1;
        h.length > c;
      )
        h.shift(), f--;
      return i?.(m), m;
    },
    restore(z) {
      if (u) {
        (x = !0), (M = !0);
        try {
          F(z.facts);
        } finally {
          (x = !1), (M = !1);
        }
      }
    },
    goBack(z = 1) {
      if (!u || h.length === 0) return;
      let m = f,
        $ = f,
        v = O.find((A) => f > A.startIndex && f <= A.endIndex);
      if (v) $ = v.startIndex;
      else if (O.find((A) => f === A.startIndex)) {
        const A = O.find((T) => T.endIndex < f && f - T.endIndex <= z);
        $ = A ? A.startIndex : Math.max(0, f - z);
      } else $ = Math.max(0, f - z);
      if (m === $) return;
      f = $;
      const C = h[f];
      C && (this.restore(C), s?.(m, $));
    },
    goForward(z = 1) {
      if (!u || h.length === 0) return;
      let m = f,
        $ = f,
        v = O.find((A) => f >= A.startIndex && f < A.endIndex);
      if ((v ? ($ = v.endIndex) : ($ = Math.min(h.length - 1, f + z)), m === $))
        return;
      f = $;
      const C = h[f];
      C && (this.restore(C), s?.(m, $));
    },
    goTo(z) {
      if (!u) return;
      const m = h.findIndex((C) => C.id === z);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${z} not found`);
        return;
      }
      const $ = f;
      f = m;
      const v = h[f];
      v && (this.restore(v), s?.($, m));
    },
    replay() {
      if (!u || h.length === 0) return;
      f = 0;
      const z = h[0];
      z && this.restore(z);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: f });
    },
    import(z) {
      if (u)
        try {
          const m = JSON.parse(z);
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
            if (!be(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...m.snapshots), (f = m.currentIndex);
          const $ = h[f];
          $ && this.restore($);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(z) {
      u && ((j = z), (D = f));
    },
    endChangeset() {
      !u ||
        j === null ||
        (f > D && O.push({ label: j, startIndex: D, endIndex: f }),
        (j = null),
        (D = -1));
    },
    pause() {
      x = !0;
    },
    resume() {
      x = !1;
    },
  };
}
function Ht() {
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
function bt(e) {
  const n = Object.create(null),
    a = Object.create(null),
    o = Object.create(null),
    i = Object.create(null),
    s = Object.create(null),
    u = Object.create(null);
  for (const t of e.modules) {
    const r = (l, g) => {
      if (l) {
        for (const E of Object.keys(l))
          if (le.has(E))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${E}" in ${g}. This could indicate a prototype pollution attempt.`,
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
      t.resolvers && Object.assign(u, t.resolvers);
  }
  let c = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    c = new Set();
    for (const t of e.modules) {
      const r = t;
      if (r.snapshotEvents) for (const l of r.snapshotEvents) c.add(l);
      else if (r.events) for (const l of Object.keys(r.events)) c.add(l);
    }
  }
  let h = 0,
    f = !1,
    d = Vt();
  for (const t of e.plugins ?? []) d.register(t);
  let x = Nt({
      config: e.errorBoundary,
      onError: (t) => d.emitError(t),
      onRecovery: (t, r) => d.emitErrorRecovery(t, r),
    }),
    M = () => {},
    O = () => {},
    j = null,
    { store: D, facts: b } = It({
      schema: n,
      onChange: (t, r, l) => {
        d.emitFactSet(t, r, l),
          M(t),
          !j?.isRestoring && (h === 0 && (f = !0), S.changedKeys.add(t), q());
      },
      onBatch: (t) => {
        d.emitFactsBatch(t);
        const r = [];
        for (const l of t) r.push(l.key);
        if ((O(r), !j?.isRestoring)) {
          h === 0 && (f = !0);
          for (const l of t) S.changedKeys.add(l.key);
          q();
        }
      },
    }),
    R = Tt({
      definitions: o,
      facts: b,
      onCompute: (t, r, l) => d.emitDerivationCompute(t, r, l),
      onInvalidate: (t) => d.emitDerivationInvalidate(t),
      onError: (t, r) => {
        x.handleError("derivation", t, r);
      },
    });
  (M = (t) => R.invalidate(t)), (O = (t) => R.invalidateMany(t));
  const F = Ft({
      definitions: i,
      facts: b,
      store: D,
      onRun: (t) => d.emitEffectRun(t),
      onError: (t, r) => {
        x.handleError("effect", t, r), d.emitEffectError(t, r);
      },
    }),
    z = _t({
      definitions: s,
      facts: b,
      onEvaluate: (t, r) => d.emitConstraintEvaluate(t, r),
      onError: (t, r) => {
        x.handleError("constraint", t, r), d.emitConstraintError(t, r);
      },
    }),
    m = Wt({
      definitions: u,
      facts: b,
      store: D,
      onStart: (t, r) => d.emitResolverStart(t, r),
      onComplete: (t, r, l) => {
        d.emitResolverComplete(t, r, l),
          d.emitRequirementMet(r, t),
          z.markResolved(r.fromConstraint);
      },
      onError: (t, r, l) => {
        x.handleError("resolver", t, l, r), d.emitResolverError(t, r, l);
      },
      onRetry: (t, r, l) => d.emitResolverRetry(t, r, l),
      onCancel: (t, r) => {
        d.emitResolverCancel(t, r), d.emitRequirementCanceled(r);
      },
      onResolutionComplete: () => {
        T(), q();
      },
    }),
    $ = new Set();
  function v() {
    for (const t of $) t();
  }
  const C = e.debug?.timeTravel
    ? Kt({
        config: e.debug,
        facts: b,
        store: D,
        onSnapshot: (t) => {
          d.emitSnapshot(t), v();
        },
        onTimeTravel: (t, r) => {
          d.emitTimeTravel(t, r), v();
        },
      })
    : Ht();
  j = C;
  const A = new Set();
  function T() {
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
      previousRequirements: new _e(),
      readyPromise: null,
      readyResolve: null,
    };
  function q() {
    !S.isRunning ||
      S.reconcileScheduled ||
      S.isInitializing ||
      ((S.reconcileScheduled = !0),
      T(),
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
      (S.isReconciling = !0), T();
      try {
        S.changedKeys.size > 0 &&
          ((c === null || f) &&
            C.takeSnapshot(`facts-changed:${[...S.changedKeys].join(",")}`),
          (f = !1));
        const t = b.$snapshot();
        d.emitReconcileStart(t), await F.runEffects(S.changedKeys);
        const r = new Set(S.changedKeys);
        S.changedKeys.clear();
        const l = await z.evaluate(r),
          g = new _e();
        for (const _ of l) g.add(_), d.emitRequirementCreated(_);
        const { added: E, removed: I } = g.diff(S.previousRequirements);
        for (const _ of I) m.cancel(_.id);
        for (const _ of E) m.resolve(_);
        S.previousRequirements = g;
        const P = m.getInflightInfo(),
          V = {
            unmet: l.filter((_) => !m.isResolving(_.id)),
            inflight: P,
            completed: [],
            canceled: I.map((_) => ({
              id: _.id,
              resolverId: P.find((U) => U.id === _.id)?.resolverId ?? "unknown",
            })),
          };
        d.emitReconcileEnd(V),
          S.isReady ||
            ((S.isReady = !0),
            S.readyResolve && (S.readyResolve(), (S.readyResolve = null)));
      } finally {
        (S.isReconciling = !1),
          S.changedKeys.size > 0 ? q() : S.reconcileScheduled || (w = 0),
          T();
      }
    }
  }
  const W = new Proxy(
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
    L = new Proxy(
      {},
      {
        get(t, r) {
          if (typeof r != "symbol" && !le.has(r))
            return (l) => {
              const g = a[r];
              if (g) {
                h++, (c === null || c.has(r)) && (f = !0);
                try {
                  D.batch(() => {
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
      derive: W,
      events: L,
      constraints: { disable: (t) => z.disable(t), enable: (t) => z.enable(t) },
      effects: {
        disable: (t) => F.disable(t),
        enable: (t) => F.enable(t),
        isEnabled: (t) => F.isEnabled(t),
      },
      initialize() {
        if (!S.isInitialized) {
          S.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              D.batch(() => {
                t.init(b);
              });
          e.onAfterModuleInit &&
            D.batch(() => {
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
          d.emitStart(y), q();
        }
      },
      stop() {
        if (S.isRunning) {
          (S.isRunning = !1), m.cancelAll(), F.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
          d.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (S.isDestroyed = !0),
          A.clear(),
          $.clear(),
          d.emitDestroy(y);
      },
      dispatch(t) {
        if (le.has(t.type)) return;
        const r = a[t.type];
        if (r) {
          h++, (c === null || c.has(t.type)) && (f = !0);
          try {
            D.batch(() => {
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
        for (const I of t) I in o ? l.push(I) : I in n && g.push(I);
        const E = [];
        return (
          l.length > 0 && E.push(R.subscribe(l, r)),
          g.length > 0 && E.push(D.subscribe(g, r)),
          () => {
            for (const I of E) I();
          }
        );
      },
      watch(t, r, l) {
        const g = l?.equalityFn
          ? (I, P) => l.equalityFn(I, P)
          : (I, P) => Object.is(I, P);
        if (t in o) {
          let I = R.get(t);
          return R.subscribe([t], () => {
            const P = R.get(t);
            if (!g(P, I)) {
              const V = I;
              (I = P), r(P, V);
            }
          });
        }
        let E = D.get(t);
        return D.subscribe([t], () => {
          const I = D.get(t);
          if (!g(I, E)) {
            const P = E;
            (E = I), r(I, P);
          }
        });
      },
      when(t, r) {
        return new Promise((l, g) => {
          const E = D.toObject();
          if (t(E)) {
            l();
            return;
          }
          let I,
            P,
            V = () => {
              I?.(), P !== void 0 && clearTimeout(P);
            };
          (I = D.subscribeAll(() => {
            const _ = D.toObject();
            t(_) && (V(), l());
          })),
            r?.timeout !== void 0 &&
              r.timeout > 0 &&
              (P = setTimeout(() => {
                V(),
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
          constraints: z.getAllStates().map((t) => ({
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
        const r = S.previousRequirements.all().find((U) => U.id === t);
        if (!r) return null;
        const l = z.getState(r.fromConstraint),
          g = m.getStatus(t),
          E = {},
          I = D.toObject();
        for (const [U, Y] of Object.entries(I)) E[U] = Y;
        const P = [
            `Requirement "${r.requirement.type}" (id: ${r.id})`,
            `├─ Produced by constraint: ${r.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          V = Object.entries(r.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, Y]) => `${U}=${JSON.stringify(Y)}`)
            .join(", ");
        V && P.push(`├─ Requirement payload: { ${V} }`);
        const _ = Object.entries(E).slice(0, 10);
        return (
          _.length > 0 &&
            (P.push("└─ Relevant facts:"),
            _.forEach(([U, Y], re) => {
              const ee = re === _.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              P.push(
                `${ee} ${U} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          P.join(`
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
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((I) => I.resolverId).join(", ")}`,
              ),
              S.isReconciling && g.push("reconciliation in progress"),
              S.reconcileScheduled && g.push("reconcile scheduled");
            const E = S.previousRequirements.all();
            throw (
              (E.length > 0 &&
                g.push(
                  `${E.length} unmet requirements: ${E.map((I) => I.requirement.type).join(", ")}`,
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
            includeDerivations: r,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: E,
            metadata: I,
            includeVersion: P,
          } = t,
          V = {},
          _ = Object.keys(o),
          U;
        if ((r ? (U = r.filter((ee) => _.includes(ee))) : (U = _), l)) {
          const ee = new Set(l);
          U = U.filter((X) => !ee.has(X));
        }
        for (const ee of U)
          try {
            V[ee] = R.get(ee);
          } catch {}
        if (g && g.length > 0) {
          const ee = D.toObject();
          for (const X of g) X in ee && (V[X] = ee[X]);
        }
        const Y = Date.now(),
          re = { data: V, createdAt: Y };
        return (
          E !== void 0 && E > 0 && (re.expiresAt = Y + E * 1e3),
          P && (re.version = Mt(V)),
          I && (re.metadata = I),
          re
        );
      },
      watchDistributableSnapshot(t, r) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          E = Object.keys(o),
          I;
        if ((l ? (I = l.filter((V) => E.includes(V))) : (I = E), g)) {
          const V = new Set(g);
          I = I.filter((_) => !V.has(_));
        }
        if (I.length === 0) return () => {};
        let P = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return R.subscribe(I, () => {
          const V = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          V.version !== P && ((P = V.version), r(V));
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
        if (!be(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [r, l] of Object.entries(t.facts))
            le.has(r) || D.set(r, l);
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
          $.add(t),
          () => {
            $.delete(t);
          }
        );
      },
      batch(t) {
        D.batch(t);
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
        for (const E of Object.keys(l))
          if (le.has(E))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${E}" in ${g}.`,
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
      c === null && (c = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) c.add(l);
    } else if (c !== null && t.events)
      for (const l of Object.keys(t.events)) c.add(l);
    Object.assign(n, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(o, t.derive), R.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(i, t.effects), F.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(s, t.constraints), z.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(u, t.resolvers), m.registerDefinitions(t.resolvers)),
      D.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        D.batch(() => {
          t.init(b);
        }),
      t.hooks?.onInit?.(y),
      S.isRunning && (t.hooks?.onStart?.(y), q());
  }
  (y.registerModule = k), d.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  K = "::";
function Ut(e) {
  const n = Object.keys(e),
    a = new Set(),
    o = new Set(),
    i = [],
    s = [];
  function u(c) {
    if (a.has(c)) return;
    if (o.has(c)) {
      const f = s.indexOf(c),
        d = [...s.slice(f), c].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${d}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    o.add(c), s.push(c);
    const h = e[c];
    if (h?.crossModuleDeps)
      for (const f of Object.keys(h.crossModuleDeps)) n.includes(f) && u(f);
    s.pop(), o.delete(c), a.add(c), i.push(c);
  }
  for (const c of n) u(c);
  return i;
}
var et = new WeakMap(),
  tt = new WeakMap(),
  rt = new WeakMap(),
  nt = new WeakMap();
function Jt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Qt(e);
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
  return Yt(n);
}
function Yt(e) {
  const n = e.modules,
    a = new Set(Object.keys(n)),
    o = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      $ = Object.keys(n).filter((v) => !m.includes(v));
    if ($.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${$.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = m;
  } else s === "declaration" ? (i = Object.keys(n)) : (i = Ut(n));
  let u = e.debug,
    c = e.errorBoundary;
  e.zeroConfig &&
    ((u = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (c = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const m of Object.keys(n)) {
    if (m.includes(K))
      throw new Error(
        `[Directive] Module name "${m}" contains the reserved separator "${K}". Module names cannot contain "${K}".`,
      );
    const $ = n[m];
    if ($) {
      for (const v of Object.keys($.schema.facts))
        if (v.includes(K))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${K}". Schema keys cannot contain "${K}".`,
          );
    }
  }
  const h = [];
  for (const m of i) {
    const $ = n[m];
    if (!$) continue;
    const v = $.crossModuleDeps && Object.keys($.crossModuleDeps).length > 0,
      C = v ? Object.keys($.crossModuleDeps) : [],
      A = {};
    for (const [y, k] of Object.entries($.schema.facts)) A[`${m}${K}${y}`] = k;
    const T = {};
    if ($.schema.derivations)
      for (const [y, k] of Object.entries($.schema.derivations))
        T[`${m}${K}${y}`] = k;
    const p = {};
    if ($.schema.events)
      for (const [y, k] of Object.entries($.schema.events))
        p[`${m}${K}${y}`] = k;
    const w = $.init
        ? (y) => {
            const k = ie(y, m);
            $.init(k);
          }
        : void 0,
      S = {};
    if ($.derive)
      for (const [y, k] of Object.entries($.derive))
        S[`${m}${K}${y}`] = (t, r) => {
          const l = v ? ae(t, m, C) : ie(t, m),
            g = Te(r, m);
          return k(l, g);
        };
    const q = {};
    if ($.events)
      for (const [y, k] of Object.entries($.events))
        q[`${m}${K}${y}`] = (t, r) => {
          const l = ie(t, m);
          k(l, r);
        };
    const N = {};
    if ($.constraints)
      for (const [y, k] of Object.entries($.constraints)) {
        const t = k;
        N[`${m}${K}${y}`] = {
          ...t,
          deps: t.deps?.map((r) => `${m}${K}${r}`),
          when: (r) => {
            const l = v ? ae(r, m, C) : ie(r, m);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (r) => {
                  const l = v ? ae(r, m, C) : ie(r, m);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const W = {};
    if ($.resolvers)
      for (const [y, k] of Object.entries($.resolvers)) {
        const t = k;
        W[`${m}${K}${y}`] = {
          ...t,
          resolve: async (r, l) => {
            const g = Ie(l.facts, n, () => Object.keys(n));
            await t.resolve(r, { facts: g[m], signal: l.signal });
          },
        };
      }
    const L = {};
    if ($.effects)
      for (const [y, k] of Object.entries($.effects)) {
        const t = k;
        L[`${m}${K}${y}`] = {
          ...t,
          run: (r, l) => {
            const g = v ? ae(r, m, C) : ie(r, m),
              E = l ? (v ? ae(l, m, C) : ie(l, m)) : void 0;
            return t.run(g, E);
          },
          deps: t.deps?.map((r) => `${m}${K}${r}`),
        };
      }
    h.push({
      id: $.id,
      schema: {
        facts: A,
        derivations: T,
        events: p,
        requirements: $.schema.requirements ?? {},
      },
      init: w,
      derive: S,
      events: q,
      effects: L,
      constraints: N,
      resolvers: W,
      hooks: $.hooks,
      snapshotEvents:
        o && !o.has(m) ? [] : $.snapshotEvents?.map((y) => `${m}${K}${y}`),
    });
  }
  let f = null,
    d = null;
  function x(m) {
    for (const [$, v] of Object.entries(m))
      if (!ne.has($) && a.has($)) {
        if (v && typeof v == "object" && !be(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${$}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, A] of Object.entries(v))
          ne.has(C) || (d.facts[`${$}${K}${C}`] = A);
      }
  }
  d = bt({
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
    errorBoundary: c,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && x(e.initialFacts), f && (x(f), (f = null));
    },
  });
  const M = new Map();
  for (const m of Object.keys(n)) {
    const $ = n[m];
    if (!$) continue;
    const v = [];
    for (const C of Object.keys($.schema.facts)) v.push(`${m}${K}${C}`);
    if ($.schema.derivations)
      for (const C of Object.keys($.schema.derivations)) v.push(`${m}${K}${C}`);
    M.set(m, v);
  }
  const O = { names: null };
  function j() {
    return O.names === null && (O.names = Object.keys(n)), O.names;
  }
  let D = Ie(d.facts, n, j),
    b = Gt(d.derive, n, j),
    R = Xt(d, n, j),
    F = null,
    z = e.tickMs;
  return {
    _mode: "namespaced",
    facts: D,
    debug: d.debug,
    derive: b,
    events: R,
    constraints: d.constraints,
    effects: d.effects,
    get isRunning() {
      return d.isRunning;
    },
    get isSettled() {
      return d.isSettled;
    },
    get isInitialized() {
      return d.isInitialized;
    },
    get isReady() {
      return d.isReady;
    },
    whenReady: d.whenReady.bind(d),
    async hydrate(m) {
      if (d.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const $ = await m();
      $ && typeof $ == "object" && (f = $);
    },
    initialize() {
      d.initialize();
    },
    start() {
      if ((d.start(), z && z > 0)) {
        const m = Object.keys(h[0]?.events ?? {}).find(($) =>
          $.endsWith(`${K}tick`),
        );
        m &&
          (F = setInterval(() => {
            d.dispatch({ type: m });
          }, z));
      }
    },
    stop() {
      F && (clearInterval(F), (F = null)), d.stop();
    },
    destroy() {
      this.stop(), d.destroy();
    },
    dispatch(m) {
      d.dispatch(m);
    },
    batch: d.batch.bind(d),
    read(m) {
      return d.read(ce(m));
    },
    subscribe(m, $) {
      const v = [];
      for (const C of m)
        if (C.endsWith(".*")) {
          const A = C.slice(0, -2),
            T = M.get(A);
          T && v.push(...T);
        } else v.push(ce(C));
      return d.subscribe(v, $);
    },
    subscribeModule(m, $) {
      const v = M.get(m);
      return !v || v.length === 0 ? () => {} : d.subscribe(v, $);
    },
    watch(m, $, v) {
      return d.watch(ce(m), $, v);
    },
    when(m, $) {
      return d.when(() => m(D), $);
    },
    onSettledChange: d.onSettledChange.bind(d),
    onTimeTravelChange: d.onTimeTravelChange.bind(d),
    inspect: d.inspect.bind(d),
    settle: d.settle.bind(d),
    explain: d.explain.bind(d),
    getSnapshot: d.getSnapshot.bind(d),
    restore: d.restore.bind(d),
    getDistributableSnapshot(m) {
      const $ = {
          ...m,
          includeDerivations: m?.includeDerivations?.map(ce),
          excludeDerivations: m?.excludeDerivations?.map(ce),
          includeFacts: m?.includeFacts?.map(ce),
        },
        v = d.getDistributableSnapshot($),
        C = {};
      for (const [A, T] of Object.entries(v.data)) {
        const p = A.indexOf(K);
        if (p > 0) {
          const w = A.slice(0, p),
            S = A.slice(p + K.length);
          C[w] || (C[w] = {}), (C[w][S] = T);
        } else C._root || (C._root = {}), (C._root[A] = T);
      }
      return { ...v, data: C };
    },
    watchDistributableSnapshot(m, $) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ce),
        excludeDerivations: m?.excludeDerivations?.map(ce),
        includeFacts: m?.includeFacts?.map(ce),
      };
      return d.watchDistributableSnapshot(v, (C) => {
        const A = {};
        for (const [T, p] of Object.entries(C.data)) {
          const w = T.indexOf(K);
          if (w > 0) {
            const S = T.slice(0, w),
              q = T.slice(w + K.length);
            A[S] || (A[S] = {}), (A[S][q] = p);
          } else A._root || (A._root = {}), (A._root[T] = p);
        }
        $({ ...C, data: A });
      });
    },
    registerModule(m, $) {
      if (a.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(K))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${K}".`,
        );
      if (ne.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys($.schema.facts))
        if (y.includes(K))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${K}".`,
          );
      const v = $,
        C = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        A = C ? Object.keys(v.crossModuleDeps) : [],
        T = {};
      for (const [y, k] of Object.entries(v.schema.facts))
        T[`${m}${K}${y}`] = k;
      const p = v.init
          ? (y) => {
              const k = ie(y, m);
              v.init(k);
            }
          : void 0,
        w = {};
      if (v.derive)
        for (const [y, k] of Object.entries(v.derive))
          w[`${m}${K}${y}`] = (t, r) => {
            const l = C ? ae(t, m, A) : ie(t, m),
              g = Te(r, m);
            return k(l, g);
          };
      const S = {};
      if (v.events)
        for (const [y, k] of Object.entries(v.events))
          S[`${m}${K}${y}`] = (t, r) => {
            const l = ie(t, m);
            k(l, r);
          };
      const q = {};
      if (v.constraints)
        for (const [y, k] of Object.entries(v.constraints)) {
          const t = k;
          q[`${m}${K}${y}`] = {
            ...t,
            deps: t.deps?.map((r) => `${m}${K}${r}`),
            when: (r) => {
              const l = C ? ae(r, m, A) : ie(r, m);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (r) => {
                    const l = C ? ae(r, m, A) : ie(r, m);
                    return t.require(l);
                  }
                : t.require,
          };
        }
      const N = {};
      if (v.resolvers)
        for (const [y, k] of Object.entries(v.resolvers)) {
          const t = k;
          N[`${m}${K}${y}`] = {
            ...t,
            resolve: async (r, l) => {
              const g = Ie(l.facts, n, j);
              await t.resolve(r, { facts: g[m], signal: l.signal });
            },
          };
        }
      const W = {};
      if (v.effects)
        for (const [y, k] of Object.entries(v.effects)) {
          const t = k;
          W[`${m}${K}${y}`] = {
            ...t,
            run: (r, l) => {
              const g = C ? ae(r, m, A) : ie(r, m),
                E = l ? (C ? ae(l, m, A) : ie(l, m)) : void 0;
              return t.run(g, E);
            },
            deps: t.deps?.map((r) => `${m}${K}${r}`),
          };
        }
      a.add(m), (n[m] = v), (O.names = null);
      const L = [];
      for (const y of Object.keys(v.schema.facts)) L.push(`${m}${K}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          L.push(`${m}${K}${y}`);
      M.set(m, L),
        d.registerModule({
          id: v.id,
          schema: T,
          requirements: v.schema.requirements ?? {},
          init: p,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(S).length > 0 ? S : void 0,
          effects: Object.keys(W).length > 0 ? W : void 0,
          constraints: Object.keys(q).length > 0 ? q : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            o && !o.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${K}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [n, ...a] = e.split(".");
    return `${n}${K}${a.join(K)}`;
  }
  return e;
}
function ie(e, n) {
  let a = et.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), et.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ne.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${n}${K}${s}`];
      },
      set(i, s, u) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : ((e[`${n}${K}${s}`] = u), !0);
      },
      has(i, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${n}${K}${s}` in e;
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : (delete e[`${n}${K}${s}`], !0);
      },
    },
  );
  return a.set(n, o), o;
}
function Ie(e, n, a) {
  const o = tt.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(n, u))
          return ie(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(n, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(n, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return tt.set(e, i), i;
}
var it = new WeakMap();
function ae(e, n, a) {
  let o = `${n}:${JSON.stringify([...a].sort())}`,
    i = it.get(e);
  if (i) {
    const h = i.get(o);
    if (h) return h;
  } else (i = new Map()), it.set(e, i);
  const s = new Set(a),
    u = ["self", ...a],
    c = new Proxy(
      {},
      {
        get(h, f) {
          if (typeof f != "symbol" && !ne.has(f)) {
            if (f === "self") return ie(e, n);
            if (s.has(f)) return ie(e, f);
          }
        },
        has(h, f) {
          return typeof f == "symbol" || ne.has(f)
            ? !1
            : f === "self" || s.has(f);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(h, f) {
          if (typeof f != "symbol" && (f === "self" || s.has(f)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(o, c), c;
}
function Te(e, n) {
  let a = nt.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), nt.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ne.has(s)) return e[`${n}${K}${s}`];
      },
      has(i, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${n}${K}${s}` in e;
      },
    },
  );
  return a.set(n, o), o;
}
function Gt(e, n, a) {
  const o = rt.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(n, u))
          return Te(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(n, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(n, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return rt.set(e, i), i;
}
var ot = new WeakMap();
function Xt(e, n, a) {
  let o = ot.get(e);
  return (
    o || ((o = new Map()), ot.set(e, o)),
    new Proxy(
      {},
      {
        get(i, s) {
          if (typeof s == "symbol" || ne.has(s) || !Object.hasOwn(n, s)) return;
          const u = o.get(s);
          if (u) return u;
          const c = new Proxy(
            {},
            {
              get(h, f) {
                if (typeof f != "symbol" && !ne.has(f))
                  return (d) => {
                    e.dispatch({ type: `${s}${K}${f}`, ...d });
                  };
              },
            },
          );
          return o.set(s, c), c;
        },
        has(i, s) {
          return typeof s == "symbol" || ne.has(s) ? !1 : Object.hasOwn(n, s);
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
function Qt(e) {
  const n = e.module;
  if (!n)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof n,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !be(e.initialFacts))
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
  s = bt({
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
        for (const [f, d] of Object.entries(e.initialFacts))
          ne.has(f) || (s.facts[f] = d);
      if (i) {
        for (const [f, d] of Object.entries(i)) ne.has(f) || (s.facts[f] = d);
        i = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(f, d) {
          if (typeof d != "symbol" && !ne.has(d))
            return (x) => {
              s.dispatch({ type: d, ...x });
            };
        },
      },
    ),
    c = null,
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
    async hydrate(f) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const d = await f();
      d && typeof d == "object" && (i = d);
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
          (c = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      c && (clearInterval(c), (c = null)), s.stop();
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
    subscribe(f, d) {
      return s.subscribe(f, d);
    },
    watch(f, d, x) {
      return s.watch(f, d, x);
    },
    when(f, d) {
      return s.when(f, d);
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
var wt = class {
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
function Ke() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function St(e) {
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
function pe(e, n) {
  return e.length <= n ? e : e.slice(0, n - 3) + "...";
}
function xe(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Zt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function er(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Ke() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function tr() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var rr = 200,
  Re = 340,
  ge = 16,
  ye = 80,
  st = 2,
  lt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function nr() {
  return { entries: new wt(rr), inflight: new Map() };
}
function ir() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var or = 1e4,
  sr = 100;
function lr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var ar = 50,
  at = 200,
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
function cr(e, n, a, o) {
  let i = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(n.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(n.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const c = document.createElement("button");
  c.setAttribute("aria-label", "Open Directive DevTools"),
    c.setAttribute("aria-expanded", String(a)),
    (c.title = "Ctrl+Shift+D to toggle"),
    Object.assign(c.style, {
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
    (c.textContent = "Directive");
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
  const d = document.createElement("strong");
  (d.style.color = B.accent),
    (d.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const x = document.createElement("button");
  x.setAttribute("aria-label", "Close DevTools"),
    Object.assign(x.style, {
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
    (x.textContent = "×"),
    f.appendChild(d),
    f.appendChild(x),
    h.appendChild(f);
  const M = document.createElement("div");
  (M.style.marginBottom = "6px"), M.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = B.green),
    (O.textContent = "Settled"),
    M.appendChild(O),
    h.appendChild(M);
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
    j.appendChild(D),
    j.appendChild(b),
    j.appendChild(R),
    h.appendChild(j);
  function F(H, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (se.textContent = `${H} (`),
      se.appendChild(fe),
      se.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      G.appendChild(se);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const He = document.createElement("thead"),
      Ue = document.createElement("tr");
    for (const Ct of ["Key", "Value"]) {
      const we = document.createElement("th");
      (we.scope = "col"),
        Object.assign(we.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (we.textContent = Ct),
        Ue.appendChild(we);
    }
    He.appendChild(Ue), de.appendChild(He);
    const Je = document.createElement("tbody");
    return (
      de.appendChild(Je),
      G.appendChild(de),
      { details: G, tbody: Je, countSpan: fe }
    );
  }
  function z(H, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (se.textContent = `${H} (`),
      se.appendChild(fe),
      se.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      G.appendChild(se);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(de),
      { details: G, list: de, countSpan: fe }
    );
  }
  const m = F("Facts", !0);
  h.appendChild(m.details);
  const $ = F("Derivations", !1);
  h.appendChild($.details);
  const v = z("Inflight", B.yellow);
  h.appendChild(v.details);
  const C = z("Unmet", B.red);
  h.appendChild(C.details);
  const A = document.createElement("details");
  A.style.marginBottom = "4px";
  const T = document.createElement("summary");
  Object.assign(T.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (T.textContent = "Performance"),
    A.appendChild(T);
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
  const q = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  q.setAttribute("width", "100%"),
    q.setAttribute("height", "120"),
    q.setAttribute("role", "img"),
    q.setAttribute("aria-label", "System dependency graph"),
    (q.style.display = "block"),
    q.setAttribute("viewBox", "0 0 460 120"),
    q.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(q),
    h.appendChild(w);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const W = document.createElement("summary");
  Object.assign(W.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (W.textContent = "Timeline"),
    N.appendChild(W);
  const L = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  L.setAttribute("width", "100%"),
    L.setAttribute("height", "60"),
    L.setAttribute("role", "img"),
    L.setAttribute("aria-label", "Resolver execution timeline"),
    (L.style.display = "block"),
    L.setAttribute("viewBox", `0 0 ${Re} 60`),
    L.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Re / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", B.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", B.font),
    (y.textContent = "No resolver activity yet"),
    L.appendChild(y),
    N.appendChild(L),
    h.appendChild(N);
  let k, t, r, l;
  if (o) {
    const H = document.createElement("details");
    H.style.marginBottom = "4px";
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
      H.appendChild(J),
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
      H.appendChild(t),
      h.appendChild(H),
      (k = H),
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
  const E = document.createElement("button");
  Object.assign(E.style, {
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
    (E.textContent = "⏺ Record");
  const I = document.createElement("button");
  Object.assign(I.style, {
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
    (I.textContent = "⤓ Export"),
    g.appendChild(E),
    g.appendChild(I),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (H) => {
        const J = h,
          G = J.scrollTop === 0 && H.deltaY < 0,
          se = J.scrollTop + J.clientHeight >= J.scrollHeight && H.deltaY > 0;
        (G || se) && H.preventDefault();
      },
      { passive: !1 },
    );
  let P = a,
    V = new Set();
  function _() {
    (P = !0),
      (h.style.display = "block"),
      (c.style.display = "none"),
      c.setAttribute("aria-expanded", "true"),
      x.focus();
  }
  function U() {
    (P = !1),
      (h.style.display = "none"),
      (c.style.display = "block"),
      c.setAttribute("aria-expanded", "false"),
      c.focus();
  }
  c.addEventListener("click", _), x.addEventListener("click", U);
  function Y(H) {
    H.key === "Escape" && P && U();
  }
  h.addEventListener("keydown", Y);
  function re(H) {
    H.key === "d" &&
      H.shiftKey &&
      (H.ctrlKey || H.metaKey) &&
      (H.preventDefault(), P ? U() : _());
  }
  document.addEventListener("keydown", re);
  function ee() {
    i || (document.body.appendChild(c), document.body.appendChild(h));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function X() {
    (i = !0),
      c.removeEventListener("click", _),
      x.removeEventListener("click", U),
      h.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", re),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const H of V) clearTimeout(H);
    V.clear(), c.remove(), h.remove(), u.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: c,
      titleEl: d,
      statusEl: O,
      factsBody: m.tbody,
      factsCount: m.countSpan,
      derivBody: $.tbody,
      derivCount: $.countSpan,
      derivSection: $.details,
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
      undoBtn: D,
      redoBtn: b,
      flowSection: w,
      flowSvg: q,
      timelineSection: N,
      timelineSvg: L,
      eventsSection: k,
      eventsList: t,
      eventsCount: r,
      traceHint: l,
      recordBtn: E,
      exportBtn: I,
    },
    destroy: X,
    isOpen: () => P,
    flashTimers: V,
  };
}
function $e(e, n, a, o, i, s) {
  let u = St(o),
    c = e.get(a);
  if (c) {
    const h = c.cells;
    if (h[1] && ((h[1].textContent = u), i && s)) {
      const f = h[1];
      f.style.background = "rgba(139, 154, 255, 0.25)";
      const d = setTimeout(() => {
        (f.style.background = ""), s.delete(d);
      }, 300);
      s.add(d);
    }
  } else {
    (c = document.createElement("tr")),
      (c.style.borderBottom = `1px solid ${B.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: B.muted }),
      (h.textContent = a);
    const f = document.createElement("td");
    (f.style.padding = "2px 4px"),
      (f.textContent = u),
      c.appendChild(h),
      c.appendChild(f),
      n.appendChild(c),
      e.set(a, c);
  }
}
function dr(e, n) {
  const a = e.get(n);
  a && (a.remove(), e.delete(n));
}
function Me(e, n, a) {
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
function qe(e, n, a) {
  const o = n === 0 && a === 0;
  (e.statusEl.style.color = o ? B.green : B.yellow),
    (e.statusEl.textContent = o ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = o ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${o ? "" : " (system working)"}`,
    );
}
function ct(e, n, a, o) {
  const i = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    n.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      c = document.createElement("td");
    (c.colSpan = 2),
      (c.style.color = B.muted),
      (c.style.fontSize = "10px"),
      (c.textContent = "No derivations defined"),
      u.appendChild(c),
      e.derivBody.appendChild(u);
    return;
  }
  const s = new Set(i);
  for (const [u, c] of n) s.has(u) || (c.remove(), n.delete(u));
  for (const u of i) {
    let c;
    try {
      c = St(a.read(u));
    } catch {
      c = "<error>";
    }
    $e(n, e.derivBody, u, c, !0, o);
  }
}
function ur(e, n, a, o) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    c = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const M = JSON.stringify(a);
    h = pe(M, 60);
  } catch {
    h = "{}";
  }
  const f = document.createElement("span");
  (f.style.color = B.closeBtn), (f.textContent = c);
  const d = document.createElement("span");
  (d.style.color = B.accent), (d.textContent = ` ${n} `);
  const x = document.createElement("span");
  for (
    x.style.color = B.muted,
      x.textContent = h,
      s.appendChild(f),
      s.appendChild(d),
      s.appendChild(x),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > ar;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(o);
}
function fr(e, n) {
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
      (u, c) => c[1].totalMs - u[1].totalMs,
    );
    for (const [u, c] of s) {
      const h = c.count > 0 ? (c.totalMs / c.count).toFixed(1) : "0",
        f = document.createElement("div");
      (f.style.paddingLeft = "8px"),
        (f.textContent = `${u}: ${c.count}x, avg ${h}ms${c.errors > 0 ? `, ${c.errors} err` : ""}`),
        c.errors > 0 && (f.style.color = B.red),
        e.perfBody.appendChild(f);
    }
  }
}
function dt(e, n) {
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
    u = o < i - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function pr(e, n) {
  e.undoBtn.addEventListener("click", () => {
    n.debug && n.debug.currentIndex > 0 && n.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      n.debug &&
        n.debug.currentIndex < n.debug.snapshots.length - 1 &&
        n.debug.goForward(1);
    });
}
var ze = new WeakMap();
function mr(e, n, a, o, i, s) {
  return [
    e.join(","),
    n.join(","),
    a.map((u) => `${u.id}:${u.active}`).join(","),
    [...o.entries()].map(([u, c]) => `${u}:${c.status}:${c.type}`).join(","),
    i.join(","),
    s.join(","),
  ].join("|");
}
function hr(e, n, a, o, i) {
  for (const s of a) {
    const u = e.nodes.get(`0:${s}`);
    if (!u) continue;
    const c = n.recentlyChangedFacts.has(s);
    u.rect.setAttribute("fill", c ? B.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
  for (const s of o) {
    const u = e.nodes.get(`1:${s}`);
    if (!u) continue;
    const c = n.recentlyComputedDerivations.has(s);
    u.rect.setAttribute("fill", c ? B.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
  for (const s of i) {
    const u = e.nodes.get(`2:${s}`);
    if (!u) continue;
    const c = n.recentlyActiveConstraints.has(s),
      h = u.rect.getAttribute("stroke") ?? B.muted;
    u.rect.setAttribute("fill", c ? h + "33" : "none"),
      u.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
}
function ut(e, n, a) {
  const o = xe(n);
  if (!o) return;
  let i;
  try {
    i = Object.keys(n.facts.$store.toObject());
  } catch {
    i = [];
  }
  const s = Object.keys(n.derive),
    u = o.constraints,
    c = o.unmet,
    h = o.inflight,
    f = Object.keys(o.resolvers),
    d = new Map();
  for (const y of c)
    d.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    d.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && s.length === 0 && u.length === 0 && f.length === 0) {
    ze.delete(e.flowSvg),
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
  const x = h.map((y) => y.resolverId).sort(),
    M = mr(i, s, u, d, f, x),
    O = ze.get(e.flowSvg);
  if (O && O.fingerprint === M) {
    hr(
      O,
      a,
      i,
      s,
      u.map((y) => y.id),
    );
    return;
  }
  const j = Q.nodeW + Q.colGap,
    D = [5, 5 + j, 5 + j * 2, 5 + j * 3, 5 + j * 4],
    b = D[4] + Q.nodeW + 5;
  function R(y) {
    let k = Q.startY + 12;
    return y.map((t) => {
      const r = { ...t, y: k };
      return (k += Q.nodeH + Q.nodeGap), r;
    });
  }
  const F = R(i.map((y) => ({ id: y, label: pe(y, Q.labelMaxChars) }))),
    z = R(s.map((y) => ({ id: y, label: pe(y, Q.labelMaxChars) }))),
    m = R(
      u.map((y) => ({
        id: y.id,
        label: pe(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    $ = R(
      [...d.entries()].map(([y, k]) => ({
        id: y,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    v = R(f.map((y) => ({ id: y, label: pe(y, Q.labelMaxChars) }))),
    C = Math.max(F.length, z.length, m.length, $.length, v.length, 1),
    A = Q.startY + 12 + C * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${b} ${A}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${s.length} derivations, ${u.length} constraints, ${d.size} requirements, ${f.length} resolvers`,
    );
  const T = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, k] of T.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(D[y] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", B.accent),
      t.setAttribute("font-size", String(Q.fontSize)),
      t.setAttribute("font-family", B.font),
      (t.textContent = k),
      e.flowSvg.appendChild(t);
  }
  const p = { fingerprint: M, nodes: new Map() };
  function w(y, k, t, r, l, g, E, I) {
    const P = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      V = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    V.setAttribute("x", String(k)),
      V.setAttribute("y", String(t - 6)),
      V.setAttribute("width", String(Q.nodeW)),
      V.setAttribute("height", String(Q.nodeH)),
      V.setAttribute("rx", "3"),
      V.setAttribute("fill", I ? g + "33" : "none"),
      V.setAttribute("stroke", g),
      V.setAttribute("stroke-width", I ? "2" : "1"),
      V.setAttribute("opacity", E ? "0.35" : "1"),
      P.appendChild(V);
    const _ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      _.setAttribute("x", String(k + 4)),
      _.setAttribute("y", String(t + 4)),
      _.setAttribute("fill", g),
      _.setAttribute("font-size", String(Q.fontSize)),
      _.setAttribute("font-family", B.font),
      _.setAttribute("opacity", E ? "0.35" : "1"),
      (_.textContent = l),
      P.appendChild(_),
      e.flowSvg.appendChild(P),
      p.nodes.set(`${y}:${r}`, { g: P, rect: V, text: _ }),
      { midX: k + Q.nodeW / 2, midY: t }
    );
  }
  function S(y, k, t, r, l, g) {
    const E = document.createElementNS("http://www.w3.org/2000/svg", "line");
    E.setAttribute("x1", String(y)),
      E.setAttribute("y1", String(k)),
      E.setAttribute("x2", String(t)),
      E.setAttribute("y2", String(r)),
      E.setAttribute("stroke", l),
      E.setAttribute("stroke-width", "1"),
      E.setAttribute("stroke-dasharray", "3,2"),
      E.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(E);
  }
  const q = new Map(),
    N = new Map(),
    W = new Map(),
    L = new Map();
  for (const y of F) {
    const k = a.recentlyChangedFacts.has(y.id),
      t = w(0, D[0], y.y, y.id, y.label, B.text, !1, k);
    q.set(y.id, t);
  }
  for (const y of z) {
    const k = a.recentlyComputedDerivations.has(y.id),
      t = w(1, D[1], y.y, y.id, y.label, B.accent, !1, k);
    N.set(y.id, t);
  }
  for (const y of m) {
    const k = a.recentlyActiveConstraints.has(y.id),
      t = w(
        2,
        D[2],
        y.y,
        y.id,
        y.label,
        y.active ? B.yellow : B.muted,
        !y.active,
        k,
      );
    W.set(y.id, t);
  }
  for (const y of $) {
    const k = y.status === "unmet" ? B.red : B.yellow,
      t = w(3, D[3], y.y, y.id, pe(y.type, Q.labelMaxChars), k, !1, !1);
    L.set(y.id, t);
  }
  for (const y of v) {
    const k = h.some((t) => t.resolverId === y.id);
    w(4, D[4], y.y, y.id, y.label, k ? B.green : B.muted, !k, !1);
  }
  for (const y of z) {
    const k = a.derivationDeps.get(y.id),
      t = N.get(y.id);
    if (k && t)
      for (const r of k) {
        const l = q.get(r);
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
  for (const y of $) {
    const k = W.get(y.fromConstraint),
      t = L.get(y.id);
    k &&
      t &&
      S(k.midX + Q.nodeW / 2, k.midY, t.midX - Q.nodeW / 2, t.midY, B.muted);
  }
  for (const y of h) {
    const k = L.get(y.id);
    if (k) {
      const t = v.find((r) => r.id === y.resolverId);
      t && S(k.midX + Q.nodeW / 2, k.midY, D[4], t.y, B.green);
    }
  }
  ze.set(e.flowSvg, p);
}
function gr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function yr(e, n) {
  const a = n.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let o = 1 / 0,
    i = -1 / 0;
  for (const O of a)
    O.startMs < o && (o = O.startMs), O.endMs > i && (i = O.endMs);
  const s = performance.now();
  for (const O of n.inflight.values()) O < o && (o = O), s > i && (i = s);
  const u = i - o || 1,
    c = Re - ye - 10,
    h = [],
    f = new Set();
  for (const O of a)
    f.has(O.resolver) || (f.add(O.resolver), h.push(O.resolver));
  for (const O of n.inflight.keys()) f.has(O) || (f.add(O), h.push(O));
  const d = h.slice(-12),
    x = ge * d.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Re} ${x}`),
    e.timelineSvg.setAttribute("height", String(Math.min(x, 200)));
  const M = 5;
  for (let O = 0; O <= M; O++) {
    const j = ye + (c * O) / M,
      D = (u * O) / M,
      b = document.createElementNS("http://www.w3.org/2000/svg", "text");
    b.setAttribute("x", String(j)),
      b.setAttribute("y", "8"),
      b.setAttribute("fill", B.muted),
      b.setAttribute("font-size", "6"),
      b.setAttribute("font-family", B.font),
      b.setAttribute("text-anchor", "middle"),
      (b.textContent =
        D < 1e3 ? `${D.toFixed(0)}ms` : `${(D / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(b);
    const R = document.createElementNS("http://www.w3.org/2000/svg", "line");
    R.setAttribute("x1", String(j)),
      R.setAttribute("y1", "10"),
      R.setAttribute("x2", String(j)),
      R.setAttribute("y2", String(x)),
      R.setAttribute("stroke", B.border),
      R.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(R);
  }
  for (let O = 0; O < d.length; O++) {
    const j = d[O],
      D = 12 + O * ge,
      b = O % lt.length,
      R = lt[b],
      F = document.createElementNS("http://www.w3.org/2000/svg", "text");
    F.setAttribute("x", String(ye - 4)),
      F.setAttribute("y", String(D + ge / 2 + 3)),
      F.setAttribute("fill", B.muted),
      F.setAttribute("font-size", "7"),
      F.setAttribute("font-family", B.font),
      F.setAttribute("text-anchor", "end"),
      (F.textContent = pe(j, 12)),
      e.timelineSvg.appendChild(F);
    const z = a.filter(($) => $.resolver === j);
    for (const $ of z) {
      const v = ye + (($.startMs - o) / u) * c,
        C = Math.max((($.endMs - $.startMs) / u) * c, st),
        A = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      A.setAttribute("x", String(v)),
        A.setAttribute("y", String(D + 2)),
        A.setAttribute("width", String(C)),
        A.setAttribute("height", String(ge - 4)),
        A.setAttribute("rx", "2"),
        A.setAttribute("fill", $.error ? B.red : R),
        A.setAttribute("opacity", "0.8");
      const T = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        p = $.endMs - $.startMs;
      (T.textContent = `${j}: ${p.toFixed(1)}ms${$.error ? " (error)" : ""}`),
        A.appendChild(T),
        e.timelineSvg.appendChild(A);
    }
    const m = n.inflight.get(j);
    if (m !== void 0) {
      const $ = ye + ((m - o) / u) * c,
        v = Math.max(((s - m) / u) * c, st),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String($)),
        C.setAttribute("y", String(D + 2)),
        C.setAttribute("width", String(v)),
        C.setAttribute("height", String(ge - 4)),
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
    `Timeline: ${a.length} resolver executions across ${d.length} resolvers`,
  );
}
function vr() {
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
              u = setInterval(() => {
                const h = o ? e.get(o) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              c = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(c);
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
            const u = s.maxEvents,
              c = i.events,
              h = c.length > u ? c.length - u : 0;
            s.events.clear();
            for (let f = h; f < c.length; f++) {
              const d = c[f];
              d &&
                typeof d == "object" &&
                !Array.isArray(d) &&
                typeof d.timestamp == "number" &&
                typeof d.type == "string" &&
                d.type !== "__proto__" &&
                d.type !== "constructor" &&
                d.type !== "prototype" &&
                s.events.push({
                  timestamp: d.timestamp,
                  type: d.type,
                  data: d.data ?? null,
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
        configurable: Ke(),
        enumerable: !0,
      }),
      n
    );
  }
  return window.__DIRECTIVE__;
}
function br(e = {}) {
  const {
      name: n = "default",
      trace: a = !1,
      maxEvents: o,
      panel: i = !1,
      position: s = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    c = er(o),
    h = vr(),
    f = {
      system: null,
      events: new wt(c),
      maxEvents: c,
      subscribers: new Set(),
    };
  h.systems.set(n, f);
  let d = (r, l) => {
      const g = { timestamp: Date.now(), type: r, data: l };
      a && f.events.push(g);
      for (const E of f.subscribers)
        try {
          E(g);
        } catch {}
    },
    x = null,
    M = new Map(),
    O = new Map(),
    j = tr(),
    D = ir(),
    b = lr(),
    R = nr(),
    F = i && typeof window < "u" && typeof document < "u" && Ke(),
    z = null,
    m = 0,
    $ = 1,
    v = 2,
    C = 4,
    A = 8,
    T = 16,
    p = 32,
    w = 64,
    S = 128,
    q = new Map(),
    N = new Set(),
    W = null;
  function L(r) {
    (m |= r),
      z === null &&
        typeof requestAnimationFrame < "u" &&
        (z = requestAnimationFrame(y));
  }
  function y() {
    if (((z = null), !x || !f.system)) {
      m = 0;
      return;
    }
    const r = x.refs,
      l = f.system,
      g = m;
    if (((m = 0), g & $)) {
      for (const E of N) dr(M, E);
      N.clear();
      for (const [E, { value: I, flash: P }] of q)
        $e(M, r.factsBody, E, I, P, x.flashTimers);
      q.clear(), (r.factsCount.textContent = String(M.size));
    }
    if ((g & v && ct(r, O, l, x.flashTimers), g & A))
      if (W) qe(r, W.inflight.length, W.unmet.length);
      else {
        const E = xe(l);
        E && qe(r, E.inflight.length, E.unmet.length);
      }
    if (g & C)
      if (W) Me(r, W.inflight, W.unmet);
      else {
        const E = xe(l);
        E && Me(r, E.inflight, E.unmet);
      }
    g & T && fr(r, j),
      g & p && ut(r, l, D),
      g & w && dt(r, l),
      g & S && yr(r, R);
  }
  function k(r, l) {
    x && a && ur(x.refs, r, l, f.events.size);
  }
  function t(r, l) {
    b.isRecording &&
      b.recordedEvents.length < or &&
      b.recordedEvents.push({ timestamp: Date.now(), type: r, data: Zt(l) });
  }
  return {
    name: "devtools",
    onInit: (r) => {
      if (
        ((f.system = r),
        d("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${n}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        F)
      ) {
        const l = f.system;
        x = cr(n, s, u, a);
        const g = x.refs;
        try {
          const I = l.facts.$store.toObject();
          for (const [P, V] of Object.entries(I)) $e(M, g.factsBody, P, V, !1);
          g.factsCount.textContent = String(Object.keys(I).length);
        } catch {}
        ct(g, O, l);
        const E = xe(l);
        E &&
          (qe(g, E.inflight.length, E.unmet.length),
          Me(g, E.inflight, E.unmet)),
          dt(g, l),
          pr(g, l),
          ut(g, l, D),
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
            const I =
                b.recordedEvents.length > 0
                  ? b.recordedEvents
                  : f.events.toArray(),
              P = JSON.stringify(
                {
                  version: 1,
                  name: n,
                  exportedAt: Date.now(),
                  events: I,
                  snapshots: b.snapshots,
                },
                null,
                2,
              ),
              V = new Blob([P], { type: "application/json" }),
              _ = URL.createObjectURL(V),
              U = document.createElement("a");
            (U.href = _),
              (U.download = `directive-session-${n}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(_);
          });
      }
    },
    onStart: (r) => {
      d("start", {}), k("start", {}), t("start", {});
    },
    onStop: (r) => {
      d("stop", {}), k("stop", {}), t("stop", {});
    },
    onDestroy: (r) => {
      d("destroy", {}),
        h.systems.delete(n),
        z !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(z), (z = null)),
        D.animationTimer && clearTimeout(D.animationTimer),
        x && (x.destroy(), (x = null), M.clear(), O.clear());
    },
    onFactSet: (r, l, g) => {
      d("fact.set", { key: r, value: l, prev: g }),
        t("fact.set", { key: r, value: l, prev: g }),
        D.recentlyChangedFacts.add(r),
        x &&
          f.system &&
          (q.set(r, { value: l, flash: !0 }),
          N.delete(r),
          L($),
          k("fact.set", { key: r, value: l }));
    },
    onFactDelete: (r, l) => {
      d("fact.delete", { key: r, prev: l }),
        t("fact.delete", { key: r, prev: l }),
        x && (N.add(r), q.delete(r), L($), k("fact.delete", { key: r }));
    },
    onFactsBatch: (r) => {
      if (
        (d("facts.batch", { changes: r }),
        t("facts.batch", { count: r.length }),
        x && f.system)
      ) {
        for (const l of r)
          l.type === "delete"
            ? (N.add(l.key), q.delete(l.key))
            : (D.recentlyChangedFacts.add(l.key),
              q.set(l.key, { value: l.value, flash: !0 }),
              N.delete(l.key));
        L($), k("facts.batch", { count: r.length });
      }
    },
    onDerivationCompute: (r, l, g) => {
      d("derivation.compute", { id: r, value: l, deps: g }),
        t("derivation.compute", { id: r, deps: g }),
        D.derivationDeps.set(r, g),
        D.recentlyComputedDerivations.add(r),
        k("derivation.compute", { id: r, deps: g });
    },
    onDerivationInvalidate: (r) => {
      d("derivation.invalidate", { id: r }),
        k("derivation.invalidate", { id: r });
    },
    onReconcileStart: (r) => {
      d("reconcile.start", {}),
        (j.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (r) => {
      if (
        (d("reconcile.end", r),
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
      if (b.isRecording && f.system && b.snapshots.length < sr)
        try {
          b.snapshots.push({
            timestamp: Date.now(),
            facts: f.system.facts.$store.toObject(),
          });
        } catch {}
      x &&
        f.system &&
        ((W = r),
        gr(D),
        L(v | A | C | T | p | w),
        k("reconcile.end", {
          unmet: r.unmet.length,
          inflight: r.inflight.length,
        }));
    },
    onConstraintEvaluate: (r, l) => {
      d("constraint.evaluate", { id: r, active: l }),
        t("constraint.evaluate", { id: r, active: l }),
        l
          ? (D.activeConstraints.add(r), D.recentlyActiveConstraints.add(r))
          : D.activeConstraints.delete(r),
        k("constraint.evaluate", { id: r, active: l });
    },
    onConstraintError: (r, l) => {
      d("constraint.error", { id: r, error: String(l) }),
        k("constraint.error", { id: r, error: String(l) });
    },
    onRequirementCreated: (r) => {
      d("requirement.created", { id: r.id, type: r.requirement.type }),
        t("requirement.created", { id: r.id, type: r.requirement.type }),
        k("requirement.created", { id: r.id, type: r.requirement.type });
    },
    onRequirementMet: (r, l) => {
      d("requirement.met", { id: r.id, byResolver: l }),
        t("requirement.met", { id: r.id, byResolver: l }),
        k("requirement.met", { id: r.id, byResolver: l });
    },
    onRequirementCanceled: (r) => {
      d("requirement.canceled", { id: r.id }),
        t("requirement.canceled", { id: r.id }),
        k("requirement.canceled", { id: r.id });
    },
    onResolverStart: (r, l) => {
      d("resolver.start", { resolver: r, requirementId: l.id }),
        t("resolver.start", { resolver: r, requirementId: l.id }),
        R.inflight.set(r, performance.now()),
        x &&
          f.system &&
          (L(C | A | S),
          k("resolver.start", { resolver: r, requirementId: l.id }));
    },
    onResolverComplete: (r, l, g) => {
      d("resolver.complete", { resolver: r, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: r,
          requirementId: l.id,
          duration: g,
        });
      const E = j.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (E.count++,
        (E.totalMs += g),
        j.resolverStats.set(r, E),
        j.resolverStats.size > at)
      ) {
        const P = j.resolverStats.keys().next().value;
        P !== void 0 && j.resolverStats.delete(P);
      }
      const I = R.inflight.get(r);
      R.inflight.delete(r),
        I !== void 0 &&
          R.entries.push({
            resolver: r,
            startMs: I,
            endMs: performance.now(),
            error: !1,
          }),
        x &&
          f.system &&
          (L(C | A | T | S),
          k("resolver.complete", { resolver: r, duration: g }));
    },
    onResolverError: (r, l, g) => {
      d("resolver.error", {
        resolver: r,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: r,
          requirementId: l.id,
          error: String(g),
        });
      const E = j.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((E.errors++, j.resolverStats.set(r, E), j.resolverStats.size > at)) {
        const P = j.resolverStats.keys().next().value;
        P !== void 0 && j.resolverStats.delete(P);
      }
      const I = R.inflight.get(r);
      R.inflight.delete(r),
        I !== void 0 &&
          R.entries.push({
            resolver: r,
            startMs: I,
            endMs: performance.now(),
            error: !0,
          }),
        x &&
          f.system &&
          (L(C | A | T | S),
          k("resolver.error", { resolver: r, error: String(g) }));
    },
    onResolverRetry: (r, l, g) => {
      d("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        k("resolver.retry", { resolver: r, attempt: g });
    },
    onResolverCancel: (r, l) => {
      d("resolver.cancel", { resolver: r, requirementId: l.id }),
        t("resolver.cancel", { resolver: r, requirementId: l.id }),
        R.inflight.delete(r),
        k("resolver.cancel", { resolver: r });
    },
    onEffectRun: (r) => {
      d("effect.run", { id: r }),
        t("effect.run", { id: r }),
        j.effectRunCount++,
        k("effect.run", { id: r });
    },
    onEffectError: (r, l) => {
      d("effect.error", { id: r, error: String(l) }),
        j.effectErrorCount++,
        k("effect.error", { id: r, error: String(l) });
    },
    onSnapshot: (r) => {
      d("timetravel.snapshot", { id: r.id, trigger: r.trigger }),
        x && f.system && L(w),
        k("timetravel.snapshot", { id: r.id, trigger: r.trigger });
    },
    onTimeTravel: (r, l) => {
      if (
        (d("timetravel.jump", { from: r, to: l }),
        t("timetravel.jump", { from: r, to: l }),
        x && f.system)
      ) {
        const g = f.system;
        try {
          const E = g.facts.$store.toObject();
          M.clear(), x.refs.factsBody.replaceChildren();
          for (const [I, P] of Object.entries(E))
            $e(M, x.refs.factsBody, I, P, !1);
          x.refs.factsCount.textContent = String(Object.keys(E).length);
        } catch {}
        O.clear(),
          D.derivationDeps.clear(),
          x.refs.derivBody.replaceChildren(),
          (W = null),
          L(v | A | C | p | w),
          k("timetravel.jump", { from: r, to: l });
      }
    },
    onError: (r) => {
      d("error", {
        source: r.source,
        sourceId: r.sourceId,
        message: r.message,
      }),
        t("error", { source: r.source, message: r.message }),
        k("error", { source: r.source, message: r.message });
    },
    onErrorRecovery: (r, l) => {
      d("error.recovery", {
        source: r.source,
        sourceId: r.sourceId,
        strategy: l,
      }),
        k("error.recovery", { source: r.source, strategy: l });
    },
  };
}
function wr(e, n = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, u) {
    if (u > n) return !1;
    if (s == null || typeof s != "object") return !0;
    const c = s;
    if (o.has(c)) return !0;
    if ((o.add(c), Array.isArray(c))) {
      for (const h of c) if (!i(h, u + 1)) return o.delete(c), !1;
      return o.delete(c), !0;
    }
    for (const h of Object.keys(c))
      if (a.has(h) || !i(c[h], u + 1)) return o.delete(c), !1;
    return o.delete(c), !0;
  }
  return i(e, 0);
}
function Sr(e) {
  let {
      storage: n,
      key: a,
      include: o,
      exclude: i = [],
      debounce: s = 100,
      onRestore: u,
      onSave: c,
      onError: h,
    } = e,
    f = null,
    d = null,
    x = new Set(),
    M = (b) => (i.includes(b) ? !1 : o ? o.includes(b) : !0),
    O = () => {
      try {
        const b = n.getItem(a);
        if (!b) return null;
        const R = JSON.parse(b);
        return typeof R != "object" || R === null
          ? null
          : wr(R)
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
      if (d)
        try {
          const b = {};
          for (const R of x) M(R) && (b[R] = d.facts[R]);
          n.setItem(a, JSON.stringify(b)), c?.(b);
        } catch (b) {
          h?.(b instanceof Error ? b : new Error(String(b)));
        }
    },
    D = () => {
      f && clearTimeout(f), (f = setTimeout(j, s));
    };
  return {
    name: "persistence",
    onInit: (b) => {
      d = b;
      const R = O();
      R &&
        (d.facts.$store.batch(() => {
          for (const [F, z] of Object.entries(R))
            M(F) && ((d.facts[F] = z), x.add(F));
        }),
        u?.(R));
    },
    onDestroy: () => {
      f && clearTimeout(f), j();
    },
    onFactSet: (b) => {
      x.add(b), M(b) && D();
    },
    onFactDelete: (b) => {
      x.delete(b), M(b) && D();
    },
    onFactsBatch: (b) => {
      let R = !1;
      for (const F of b)
        F.type === "set" ? x.add(F.key) : x.delete(F.key), M(F.key) && (R = !0);
      R && D();
    },
  };
}
const Ae = {
  facts: {
    currentStep: Z.number(),
    totalSteps: Z.number(),
    advanceRequested: Z.boolean(),
    email: Z.string(),
    password: Z.string(),
    name: Z.string(),
    company: Z.string(),
    plan: Z.string(),
    newsletter: Z.boolean(),
    submitted: Z.boolean(),
  },
  derivations: {
    step0Valid: Z.boolean(),
    step1Valid: Z.boolean(),
    step2Valid: Z.boolean(),
    currentStepValid: Z.boolean(),
    canAdvance: Z.boolean(),
    canGoBack: Z.boolean(),
    progress: Z.number(),
    isLastStep: Z.boolean(),
  },
  events: {
    requestAdvance: {},
    goBack: {},
    setField: { field: Z.string(), value: Z.object() },
    reset: {},
  },
  requirements: { ADVANCE_STEP: {}, SUBMIT_FORM: {} },
};
function ft(e, n) {
  return n === 0
    ? e.email.includes("@") && e.password.length >= 8
    : n === 1
      ? e.name.trim().length > 0
      : n === 2
        ? e.plan !== ""
        : !1;
}
const Er = gt("wizard", {
    schema: Ae,
    init: (e) => {
      (e.currentStep = 0),
        (e.totalSteps = 3),
        (e.advanceRequested = !1),
        (e.email = ""),
        (e.password = ""),
        (e.name = ""),
        (e.company = ""),
        (e.plan = "free"),
        (e.newsletter = !1),
        (e.submitted = !1);
    },
    derive: {
      step0Valid: (e) => e.email.includes("@") && e.password.length >= 8,
      step1Valid: (e) => e.name.trim().length > 0,
      step2Valid: (e) => e.plan !== "",
      currentStepValid: (e, n) =>
        e.currentStep === 0
          ? n.step0Valid
          : e.currentStep === 1
            ? n.step1Valid
            : e.currentStep === 2
              ? n.step2Valid
              : !1,
      canAdvance: (e, n) =>
        n.currentStepValid && e.currentStep < e.totalSteps - 1,
      canGoBack: (e) => e.currentStep > 0,
      progress: (e) => Math.round(((e.currentStep + 1) / e.totalSteps) * 100),
      isLastStep: (e) => e.currentStep === e.totalSteps - 1,
    },
    events: {
      requestAdvance: (e) => {
        e.advanceRequested = !0;
      },
      goBack: (e) => {
        e.currentStep > 0 && (e.currentStep = e.currentStep - 1);
      },
      setField: (e, { field: n, value: a }) => {
        e[n] = a;
      },
      reset: (e) => {
        (e.currentStep = 0),
          (e.advanceRequested = !1),
          (e.email = ""),
          (e.password = ""),
          (e.name = ""),
          (e.company = ""),
          (e.plan = "free"),
          (e.newsletter = !1),
          (e.submitted = !1);
      },
    },
    constraints: {
      submit: {
        priority: 60,
        when: (e) => {
          const n = e.currentStep === e.totalSteps - 1,
            a = ft(e, e.currentStep);
          return e.advanceRequested && n && a;
        },
        require: { type: "SUBMIT_FORM" },
      },
      advance: {
        priority: 50,
        when: (e) => {
          const n = e.currentStep === e.totalSteps - 1,
            a = ft(e, e.currentStep);
          return e.advanceRequested && !n && a;
        },
        require: { type: "ADVANCE_STEP" },
      },
    },
    resolvers: {
      advanceStep: {
        requirement: "ADVANCE_STEP",
        resolve: async (e, n) => {
          (n.facts.currentStep = n.facts.currentStep + 1),
            (n.facts.advanceRequested = !1);
        },
      },
      submitForm: {
        requirement: "SUBMIT_FORM",
        timeout: 1e4,
        resolve: async (e, n) => {
          await new Promise((a) => setTimeout(a, 800)),
            (n.facts.submitted = !0),
            (n.facts.advanceRequested = !1);
        },
      },
    },
  }),
  Et = {
    facts: {
      emailAvailable: Z.boolean(),
      checkingEmail: Z.boolean(),
      emailChecked: Z.string(),
    },
    derivations: {},
    events: {},
    requirements: { CHECK_EMAIL: { email: Z.string() } },
  },
  xr = gt("validation", {
    schema: Et,
    crossModuleDeps: { wizard: Ae },
    init: (e) => {
      (e.emailAvailable = !0), (e.checkingEmail = !1), (e.emailChecked = "");
    },
    constraints: {
      checkEmail: {
        when: (e) => {
          const n = e.wizard.email,
            a = e.self.emailChecked;
          return n.includes("@") && n !== a;
        },
        require: (e) => ({ type: "CHECK_EMAIL", email: e.wizard.email }),
      },
    },
    resolvers: {
      checkEmail: {
        requirement: "CHECK_EMAIL",
        resolve: async (e, n) => {
          n.facts.checkingEmail = !0;
          try {
            await new Promise((a) => setTimeout(a, 500)),
              (n.facts.emailAvailable = e.email !== "taken@test.com"),
              (n.facts.emailChecked = e.email);
          } finally {
            n.facts.checkingEmail = !1;
          }
        },
      },
    },
  }),
  oe = Jt({
    modules: { wizard: Er, validation: xr },
    plugins: [
      br({ name: "form-wizard" }),
      Sr({
        storage: localStorage,
        key: "form-wizard-draft",
        include: [
          "wizard::email",
          "wizard::name",
          "wizard::company",
          "wizard::plan",
          "wizard::currentStep",
        ],
      }),
    ],
  });
oe.start();
const $r = [
    ...Object.keys(Ae.facts).map((e) => `wizard::${e}`),
    ...Object.keys(Ae.derivations).map((e) => `wizard::${e}`),
    ...Object.keys(Et.facts).map((e) => `validation::${e}`),
  ],
  Cr = document.getElementById("fw-progress-fill"),
  kr = document.getElementById("fw-progress-text"),
  Rr = document.querySelectorAll(".fw-step-indicator"),
  Ar = document.getElementById("fw-step-0"),
  Or = document.getElementById("fw-step-1"),
  jr = document.getElementById("fw-step-2"),
  Dr = [Ar, Or, jr],
  Oe = document.getElementById("fw-email"),
  pt = document.getElementById("fw-password"),
  je = document.getElementById("fw-name"),
  De = document.getElementById("fw-company"),
  Fe = document.getElementById("fw-plan-free"),
  Le = document.getElementById("fw-plan-pro"),
  Pe = document.getElementById("fw-plan-enterprise"),
  Ne = document.getElementById("fw-newsletter"),
  xt = document.getElementById("fw-back-btn"),
  Ve = document.getElementById("fw-next-btn"),
  We = document.getElementById("fw-submit-btn"),
  ue = document.getElementById("fw-email-status"),
  he = document.getElementById("fw-password-hint"),
  Se = document.getElementById("fw-name-hint"),
  mt = document.getElementById("fw-success"),
  ht = document.getElementById("fw-form-container");
function $t() {
  const e = oe.facts,
    n = oe.derive,
    a = e.wizard.currentStep,
    o = e.wizard.submitted,
    i = n.wizard.progress,
    s = n.wizard.canAdvance,
    u = n.wizard.canGoBack,
    c = n.wizard.isLastStep,
    h = n.wizard.currentStepValid,
    f = e.validation.emailAvailable,
    d = e.validation.checkingEmail;
  if (o) {
    (ht.style.display = "none"), (mt.style.display = "flex");
    return;
  }
  (ht.style.display = ""),
    (mt.style.display = "none"),
    (Cr.style.width = `${i}%`),
    (kr.textContent = `Step ${a + 1} of ${e.wizard.totalSteps}`),
    Rr.forEach((O, j) => {
      O.classList.remove("active", "completed"),
        j === a
          ? O.classList.add("active")
          : j < a && O.classList.add("completed");
    }),
    Dr.forEach((O, j) => {
      O.style.display = j === a ? "" : "none";
    }),
    Oe.value !== e.wizard.email && (Oe.value = e.wizard.email),
    je.value !== e.wizard.name && (je.value = e.wizard.name),
    De.value !== e.wizard.company && (De.value = e.wizard.company);
  const x = e.wizard.plan;
  (Fe.checked = x === "free"),
    (Le.checked = x === "pro"),
    (Pe.checked = x === "enterprise"),
    (Ne.checked = e.wizard.newsletter),
    d
      ? ((ue.textContent = "Checking availability..."),
        (ue.className = "fw-field-status checking"))
      : e.wizard.email.includes("@")
        ? f
          ? ((ue.textContent = "Email available"),
            (ue.className = "fw-field-status available"))
          : ((ue.textContent = "Email already taken"),
            (ue.className = "fw-field-status taken"))
        : ((ue.textContent = ""), (ue.className = "fw-field-status"));
  const M = e.wizard.password;
  M.length > 0 && M.length < 8
    ? ((he.textContent = `${8 - M.length} more characters needed`),
      (he.className = "fw-field-hint invalid"))
    : M.length >= 8
      ? ((he.textContent = "Password strength: OK"),
        (he.className = "fw-field-hint valid"))
      : ((he.textContent = ""), (he.className = "fw-field-hint")),
    a === 1 && e.wizard.name.trim().length === 0
      ? ((Se.textContent = "Name is required"),
        (Se.className = "fw-field-hint invalid"))
      : ((Se.textContent = ""), (Se.className = "fw-field-hint")),
    (xt.style.display = u ? "" : "none"),
    (Ve.style.display = c ? "none" : ""),
    (We.style.display = c ? "" : "none"),
    (Ve.disabled = !s),
    (We.disabled = !h);
}
oe.subscribe($r, $t);
Oe.addEventListener("input", () => {
  oe.events.wizard.setField({ field: "email", value: Oe.value });
});
pt.addEventListener("input", () => {
  oe.events.wizard.setField({ field: "password", value: pt.value });
});
je.addEventListener("input", () => {
  oe.events.wizard.setField({ field: "name", value: je.value });
});
De.addEventListener("input", () => {
  oe.events.wizard.setField({ field: "company", value: De.value });
});
Fe.addEventListener("change", () => {
  Fe.checked && oe.events.wizard.setField({ field: "plan", value: "free" });
});
Le.addEventListener("change", () => {
  Le.checked && oe.events.wizard.setField({ field: "plan", value: "pro" });
});
Pe.addEventListener("change", () => {
  Pe.checked &&
    oe.events.wizard.setField({ field: "plan", value: "enterprise" });
});
Ne.addEventListener("change", () => {
  oe.events.wizard.setField({ field: "newsletter", value: Ne.checked });
});
xt.addEventListener("click", () => {
  oe.events.wizard.goBack();
});
Ve.addEventListener("click", () => {
  oe.events.wizard.requestAdvance();
});
We.addEventListener("click", () => {
  oe.events.wizard.requestAdvance();
});
document.getElementById("fw-start-over")?.addEventListener("click", () => {
  oe.events.wizard.reset(), localStorage.removeItem("form-wizard-draft");
});
$t();
document.body.setAttribute("data-form-wizard-ready", "true");
